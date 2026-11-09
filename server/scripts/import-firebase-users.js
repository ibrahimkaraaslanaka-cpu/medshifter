/** Import Supabase Auth users with their original UIDs, bcrypt hashes and Google IDs. */
require('dotenv').config();
const fs = require('fs');
const { getAuth } = require('../src/services/firebaseAuth');

function buildRecords(rows) {
    if (!Array.isArray(rows)) throw new Error('Expected a JSON array');
    const uids = new Set();
    const emails = new Set();
    return rows.map(row => {
        const uid = String(row.uid || '');
        const email = String(row.email || '').toLowerCase();
        if (!uid || !email || uids.has(uid) || emails.has(email)) {
            throw new Error('Missing or duplicate UID/email in source export');
        }
        uids.add(uid);
        emails.add(email);
        const record = {
            uid, email,
            emailVerified: row.email_verified === true,
            displayName: row.display_name || undefined,
            photoURL: row.photo_url || undefined
        };
        if (row.encrypted_password) {
            if (!/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(row.encrypted_password)) {
                throw new Error(`Invalid bcrypt hash format for UID ${uid}`);
            }
            record.passwordHash = Buffer.from(row.encrypted_password, 'utf8');
        }
        const googleId = row.google_id ? String(row.google_id) : '';
        if (googleId) {
            record.providerData = [{ uid: googleId, providerId: 'google.com', email }];
        }
        if (!record.passwordHash && !googleId) throw new Error(`No sign-in method for UID ${uid}`);
        return record;
    });
}

async function importRecords(auth, records) {
    if ((await auth.listUsers(1)).users.length) {
        throw new Error('Firebase target already has users; refusing to overwrite');
    }
    for (let start = 0; start < records.length; start += 1000) {
        const result = await auth.importUsers(records.slice(start, start + 1000), {
            hash: { algorithm: 'BCRYPT' }
        });
        if (result.failureCount) {
            throw new Error(`Firebase import failed for ${result.failureCount} users: ${result.errors.map(e => e.index).join(',')}`);
        }
    }
    let pageToken;
    const imported = new Set();
    do {
        const page = await auth.listUsers(1000, pageToken);
        for (const user of page.users) imported.add(user.uid);
        pageToken = page.pageToken;
    } while (pageToken);
    if (records.some(record => !imported.has(record.uid))) throw new Error('UID verification failed');
    return imported.size;
}

if (require.main === module) {
    (async () => {
        const file = process.argv[2];
        if (!file) throw new Error('Usage: node import-firebase-users.js /secure/auth-export.json [--apply]');
        const stat = fs.statSync(file);
        if (process.platform !== 'win32' && (stat.mode & 0o077)) {
            throw new Error('Auth export must be readable only by its owner (chmod 600)');
        }
        const records = buildRecords(JSON.parse(fs.readFileSync(file, 'utf8')));
        console.log(`Validated ${records.length} users (${records.filter(r => r.passwordHash).length} password, ${records.filter(r => r.providerData).length} Google)`);
        if (process.argv.includes('--apply')) {
            console.log(`Imported and verified ${await importRecords(getAuth(), records)} Firebase users`);
        }
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { buildRecords, importRecords };
