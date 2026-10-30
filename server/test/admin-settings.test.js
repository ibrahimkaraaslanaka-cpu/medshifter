const test = require('node:test');
const assert = require('node:assert/strict');

const { readSettings, validateSettings } = require('../src/services/siteSettings');
const { getPlanLimits } = require('../src/services/limits');
const checkoutRouter = require('../src/routes/checkout');
const adminRouter = require('../src/routes/admin');
const { adminAuthMiddleware, generateAdminToken, superAdminOnly } = require('../src/middleware/adminAuth');

test('admin settings reject invalid prices, limits and announcement types', () => {
    const before = readSettings();
    assert.throws(() => validateSettings({ prices: { INDIVIDUAL: { monthly: { TRY: -1 } } } }), /Fiyatlar/);
    assert.throws(() => validateSettings({ limits: { FREE: { calendarsPerMonth: -1 } } }), /Plan limitleri/);
    assert.throws(() => validateSettings({ announcement: { enabled: 'true', text: '<script>' } }), /Duyuru/);
    const changed = validateSettings({ siteName: '  Yeni Site  ' });
    assert.equal(changed.siteName, 'Yeni Site');
    assert.deepEqual(readSettings(), before, 'validation must not persist changes');
});

test('public checkout prices and plan limits use site settings', () => {
    const route = checkoutRouter.stack.find(layer => layer.route?.path === '/prices');
    let body;
    route.route.stack.at(-1).handle({}, { json(value) { body = value; } });
    assert.deepEqual(body.prices, readSettings().prices);
    assert.deepEqual(getPlanLimits('BUSINESS'), { ...readSettings().limits.BUSINESS, isLifetime: false });
});

async function authorize(adminRecord) {
    const token = generateAdminToken({ id: 'admin-1', role: 'superadmin' });
    const req = {
        headers: { authorization: `Bearer ${token}` },
        supabaseAdmin: { from(table) {
            assert.equal(table, 'admins');
            return { select() { return this; }, eq() { return this; }, async single() { return { data: adminRecord, error: null }; } };
        } }
    };
    let status, body, nextCalled = false;
    const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
    await adminAuthMiddleware(req, res, () => { nextCalled = true; });
    return { req, status, body, nextCalled };
}

test('deleted admins are denied even with a still valid token', async () => {
    const result = await authorize(null);
    assert.equal(result.status, 401);
    assert.equal(result.nextCalled, false);
});

test('role demotion takes effect immediately for old admin tokens', async () => {
    const result = await authorize({ id: 'admin-1', role: 'admin' });
    assert.equal(result.nextCalled, true);
    assert.equal(result.req.adminRole, 'admin');
    let status;
    superAdminOnly(result.req, { status(value) { status = value; return this; }, json() {} }, () => { throw new Error('must not pass'); });
    assert.equal(status, 403);
});

test('admin roster edits reject duplicate people in one day', async () => {
    const handler = adminRouter.stack.find(layer => layer.route?.path === '/calendars/:id/assignments').route.stack.at(-1).handle;
    const calendar = { id: 'cal-1', people: ['A', 'B'], work_areas: [{ id: 1 }, { id: 2 }], schedule: [{ date: '2026-10-30', workArea1: 'A', workArea2: 'B' }] };
    let didUpdate = false;
    const db = { from() { return {
        select() { return this; }, eq() { return this; },
        async single() { return { data: calendar, error: null }; },
        update() { didUpdate = true; return this; }
    }; } };
    let status, body;
    const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
    await handler({ body: { assignments: [{ dayIndex: 0, areaId: '2', person: 'A' }] }, params: { id: 'cal-1' }, supabaseAdmin: db }, res, error => { throw error; });
    assert.equal(status, 400);
    assert.match(body.error, /aynı gün/);
    assert.equal(didUpdate, false);
});
