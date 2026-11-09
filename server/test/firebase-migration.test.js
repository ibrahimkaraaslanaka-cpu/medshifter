const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildRecords } = require('../scripts/import-firebase-users');

test('Firebase adapter exchanges the existing Google credential for a Firebase session', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../firebase-auth-adapter.js'), 'utf8');
    const calls = [];
    const user = { uid: 'old-supabase-uid', email: 'doctor@example.test', emailVerified: true,
        async getIdToken() { return 'firebase-signed-token'; } };
    const auth = {
        currentUser: null,
        onAuthStateChanged(callback) { queueMicrotask(() => callback(this.currentUser)); return () => {}; },
        async signInWithCredential(credential) {
            calls.push(credential);
            this.currentUser = user;
            return { user };
        }
    };
    const firebase = {
        apps: [],
        initializeApp(config) {
            assert.equal(config.projectId, 'medshifter-app');
            this.apps.push({ auth: () => auth });
            return this.apps[0];
        },
        auth: { GoogleAuthProvider: { credential: token => ({ idToken: token }) } }
    };
    const context = { window: { AppConfig: { FIREBASE_CONFIG: {
        apiKey: 'public-key', projectId: 'medshifter-app', appId: 'test-app'
    } }, firebase }, queueMicrotask, console };
    vm.runInNewContext(source, context);
    const client = context.window.FirebaseAuthAdapter.createClient();
    assert.equal((await client.auth.getSession()).data.session, null);
    const result = await client.auth.signInWithIdToken({ provider: 'google', token: 'google-id-token' });
    assert.equal(result.error, null);
    assert.equal(result.data.session.access_token, 'firebase-signed-token');
    assert.equal(result.data.user.uid, 'old-supabase-uid');
    assert.equal(calls[0].idToken, 'google-id-token');
});

test('migration keeps source UIDs and bcrypt hashes, and rejects collisions', () => {
    const hash = '$2a$10$' + 'a'.repeat(53);
    const records = buildRecords([
        { uid: 'old-uid-1', email: 'One@Example.test', encrypted_password: hash, email_verified: true },
        { uid: 'old-uid-2', email: 'two@example.test', google_id: 'google-subject-2', email_verified: true }
    ]);
    assert.equal(records[0].uid, 'old-uid-1');
    assert.equal(records[0].email, 'one@example.test');
    assert.equal(records[0].passwordHash.toString(), hash);
    assert.deepEqual(records[1].providerData, [{ uid: 'google-subject-2', providerId: 'google.com', email: 'two@example.test' }]);
    assert.throws(() => buildRecords([
        { uid: 'duplicate', email: 'same@example.test', google_id: 'one' },
        { uid: 'duplicate', email: 'other@example.test', google_id: 'two' }
    ]), /duplicate/);
});
