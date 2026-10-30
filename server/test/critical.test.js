const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const authRouter = require('../src/routes/auth');
const meRoute = authRouter.stack.find(layer => layer.route?.path === '/me');
const getMe = meRoute.route.stack.at(-1).handle;

function profile(id = 'user-1') {
    return {
        id, email: 'doctor@example.com', name: 'Doctor', avatar: null,
        plan: 'FREE', calendars_used_this_month: 0,
        saves_used_this_month: 0, exports_used_this_month: 0,
        usage_reset_at: new Date().toISOString(), created_at: new Date().toISOString()
    };
}

async function callGetMe(existing) {
    const calls = [];
    const db = {
        from(table) {
            assert.equal(table, 'profiles');
            return {
                select() { return this; },
                eq(column, value) { assert.equal(column, 'id'); assert.equal(value, 'user-1'); return this; },
                async single() {
                    if (calls.at(-1) === 'insert') return { data: profile(), error: null };
                    return existing
                        ? { data: profile(), error: null }
                        : { data: null, error: { code: 'PGRST116' } };
                },
                insert(data) {
                    calls.push('insert');
                    assert.equal(data.id, 'user-1');
                    assert.equal(data.email, 'doctor@example.com');
                    assert.equal(data.name, 'Doctor');
                    assert.equal(data.plan, 'FREE');
                    return this;
                }
            };
        }
    };
    const req = {
        userId: 'user-1', userEmail: 'doctor@example.com',
        authUser: { user_metadata: { full_name: 'Doctor' } },
        supabaseAdmin: db
    };
    let result;
    const res = { json(value) { result = value; } };
    await getMe(req, res, error => { throw error; });
    return { result, calls };
}

test('OAuth user with a missing profile gets a usable FREE profile', async () => {
    const { result, calls } = await callGetMe(false);
    assert.deepEqual(calls, ['insert']);
    assert.equal(result.user.email, 'doctor@example.com');
    assert.equal(result.usage.remaining.calendars, 1);
});

test('existing profile is preserved on login', async () => {
    const { result, calls } = await callGetMe(true);
    assert.deepEqual(calls, []);
    assert.equal(result.user.plan, 'FREE');
});

test('infeasible pair rule leaves a slot empty instead of assigning a forbidden pair', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
    const context = vm.createContext({
        window: {}, document: { addEventListener() {} },
        localStorage: { setItem() {} }, console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Date
    });
    vm.runInContext(source, context);
    vm.runInContext(`
        state.people = ['A', 'B', 'C'];
        state.workAreas = [{id: 1, name: 'Acil'}, {id: 2, name: 'Servis'}, {id: 3, name: 'Poliklinik'}];
        state.schedule = [{date: new Date(2026, 9, 30), dayName: 'Cuma', nobetErtesi: '', workArea1: 'A', workArea2: 'B', workArea3: 'C'}];
        visualConstraints.pairRules = [{person1: 'A', person2: 'B'}];
        visualConstraints.personAreaRules = {};
        visualConstraints.dayOffRules = {};
        visualConstraints.weeklyPriority = {};
        visualConstraints.seniorityOrder = [];
        renderScheduleTable = updateStats = renderDetailedStats = renderActiveConstraints = saveToLocalStorage = () => {};
        Toast.success = Toast.warning = Toast.info = () => {};
    `, context);
    await vm.runInContext('startAssignment()', context);
    const assigned = vm.runInContext('state.schedule[0]', context);
    const names = [assigned.workArea1, assigned.workArea2, assigned.workArea3].filter(Boolean);
    assert.ok(names.length < 3, 'an infeasible roster must be shown as incomplete');
    assert.ok(!(names.includes('A') && names.includes('B')), 'forbidden pair must not work on one day');
});

test('Google signup uses the Supabase OAuth callback on the login page', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../../login.html'), 'utf8');
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
    let oauthOptions;
    const elements = new Map();
    const context = vm.createContext({
        window: {
            supabaseClient: { auth: {
                async signInWithOAuth(options) { oauthOptions = options; return { data: {}, error: null }; }
            } },
            location: { origin: 'https://medshifter.app', search: '?redirect=https://evil.example', hash: '' }
        },
        document: {
            addEventListener() {},
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, { style: {}, textContent: '' });
                return elements.get(id);
            }
        },
        URLSearchParams
    });
    vm.runInContext(script, context);
    assert.equal(vm.runInContext('destinationAfterLogin()', context), '/app.html');
    await vm.runInContext('handleGoogleSignIn()', context);
    assert.equal(oauthOptions.provider, 'google');
    assert.equal(oauthOptions.options.redirectTo, 'https://medshifter.app/login.html?redirect=app.html');
});

test('a feasible roster fills each area once per day and respects leave and post-shift rest', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
    const context = vm.createContext({
        window: {}, document: { addEventListener() {} },
        localStorage: { setItem() {} }, console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Date
    });
    vm.runInContext(source, context);
    vm.runInContext(`
        state.people = ['A', 'B', 'C', 'D', 'E'];
        state.workAreas = [{id: 1, name: 'Acil'}, {id: 2, name: 'Servis'}, {id: 3, name: 'Poliklinik'}];
        state.schedule = Array.from({length: 10}, (_, i) => ({
            date: new Date(2026, 9, i + 1), dayName: 'Gün',
            nobetErtesi: i === 1 ? 'B' : '',
            workArea1: '', workArea2: '', workArea3: ''
        }));
        visualConstraints.pairRules = [];
        visualConstraints.personAreaRules = {};
        visualConstraints.dayOffRules = {'2026-10-03': ['A']};
        visualConstraints.weeklyPriority = {};
        visualConstraints.seniorityOrder = [];
        renderScheduleTable = updateStats = renderDetailedStats = renderActiveConstraints = saveToLocalStorage = () => {};
        Toast.success = Toast.warning = Toast.info = () => {};
    `, context);
    await vm.runInContext('startAssignment()', context);
    const schedule = vm.runInContext('state.schedule', context);
    const counts = Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(name => [name, 0]));
    for (const day of schedule) {
        const names = [day.workArea1, day.workArea2, day.workArea3];
        assert.equal(new Set(names).size, 3);
        assert.ok(names.every(Boolean));
        for (const name of names) counts[name]++;
    }
    assert.ok(![schedule[1].workArea1, schedule[1].workArea2, schedule[1].workArea3].includes('B'));
    assert.ok(![schedule[2].workArea1, schedule[2].workArea2, schedule[2].workArea3].includes('A'));
    assert.ok(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 1);
});

test('a specialist is assigned to the area only they can cover', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
    const context = vm.createContext({
        window: {}, document: { addEventListener() {} },
        localStorage: { setItem() {} }, console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Date
    });
    vm.runInContext(source, context);
    vm.runInContext(`
        state.people = ['A', 'B', 'C'];
        state.workAreas = [{id: 1, name: 'Genel'}, {id: 2, name: 'Uzman'}];
        state.schedule = [{date: new Date(2026, 9, 30), dayName: 'Cuma', nobetErtesi: '', workArea1: '', workArea2: ''}];
        visualConstraints.pairRules = [];
        visualConstraints.personAreaRules = {B: {2: 'blocked'}, C: {2: 'blocked'}};
        visualConstraints.dayOffRules = {};
        visualConstraints.weeklyPriority = {};
        visualConstraints.seniorityOrder = [];
        renderScheduleTable = updateStats = renderDetailedStats = renderActiveConstraints = saveToLocalStorage = () => {};
        Toast.success = Toast.warning = Toast.info = () => {};
    `, context);
    await vm.runInContext('startAssignment()', context);
    const day = vm.runInContext('state.schedule[0]', context);
    assert.equal(day.workArea2, 'A');
    assert.ok(['B', 'C'].includes(day.workArea1));
});
