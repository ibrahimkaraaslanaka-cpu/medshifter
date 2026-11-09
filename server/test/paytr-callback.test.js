const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.PAYTR_MERCHANT_KEY = 'test-merchant-key';
process.env.PAYTR_MERCHANT_SALT = 'test-merchant-salt';
const router = require('../src/routes/checkout');
const callback = router.stack.find(layer => layer.route?.path === '/paytr-callback')
    .route.stack.at(-1).handle;

function notification(status = 'success') {
    const merchant_oid = 'test-order-id';
    const total_amount = '10000';
    const hash = crypto.createHmac('sha256', process.env.PAYTR_MERCHANT_KEY)
        .update(merchant_oid + process.env.PAYTR_MERCHANT_SALT + status + total_amount)
        .digest('base64');
    return { merchant_oid, status, total_amount, hash };
}

function request(profileFails) {
    const calls = [];
    const order = { id: 'test-order-id', status: 'awaiting_payment',
        user_id: 'user-1', plan: 'INDIVIDUAL', billing_period: 'monthly' };
    const database = {
        from(table) {
            return {
                select() {
                    return { eq() { return { async single() { return { data: order, error: null }; } }; } };
                },
                update(values) {
                    calls.push({ table, values });
                    return { eq() {
                        if (table === 'profiles') return { select() {
                            return { async single() {
                                return profileFails
                                    ? { data: null, error: new Error('database unavailable') }
                                    : { data: { id: 'user-1' }, error: null };
                            } };
                        } };
                        return Promise.resolve({ error: null });
                    } };
                }
            };
        }
    };
    return { req: { body: notification(), supabaseAdmin: database }, calls };
}

async function invoke(req) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
        send(body) { this.body = body; return this; } };
    await callback(req, res);
    return res;
}

test('PayTR callback asks for retry if entitlement update fails', async () => {
    const { req, calls } = request(true);
    const res = await invoke(req);
    assert.equal(res.statusCode, 500);
    assert.notEqual(res.body, 'OK');
    assert.deepEqual(calls.map(call => call.table), ['profiles']);
});

test('PayTR callback acknowledges only after entitlement and order are updated', async () => {
    const { req, calls } = request(false);
    const res = await invoke(req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'OK');
    assert.deepEqual(calls.map(call => call.table), ['profiles', 'orders']);
    assert.equal(calls[1].values.status, 'completed');
});

test('PayTR callback rejects an invalid hash', async () => {
    const { req, calls } = request(false);
    req.body.hash = 'bad';
    const res = await invoke(req);
    assert.equal(res.statusCode, 400);
    assert.equal(calls.length, 0);
});
