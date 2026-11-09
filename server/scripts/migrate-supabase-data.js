/** One-time public table copy. Run only while writes are paused at cutover. */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { PostgrestClient } = require('@supabase/postgrest-js');

const tables = ['profiles', 'admins', 'calendars', 'coupons', 'orders'];

async function allRows(client, table) {
    const rows = [];
    for (let start = 0; ; start += 500) {
        const { data, error } = await client.from(table).select('*').order('id').range(start, start + 499);
        if (error) throw new Error(`${table} read: ${error.message}`);
        rows.push(...data);
        if (data.length < 500) return rows;
    }
}

async function migrate({ source, destination, apply = false }) {
    const counts = {};
    for (const table of tables) {
        const rows = await allRows(source, table);
        counts[table] = rows.length;
        if (!apply) continue;

        const current = await allRows(destination, table);
        if (current.length) throw new Error(`${table} target is not empty; refusing to overwrite`);
        for (let start = 0; start < rows.length; start += 100) {
            const { error } = await destination.from(table).insert(rows.slice(start, start + 100));
            if (error) throw new Error(`${table} write: ${error.message}`);
        }
        const copied = await allRows(destination, table);
        if (copied.length !== rows.length ||
            copied.some((row, i) => row.id !== rows[i].id)) {
            throw new Error(`${table} verification failed`);
        }
    }
    return counts;
}

if (require.main === module) {
    (async () => {
        const target = new URL(process.env.POSTGREST_URL);
        if (!['127.0.0.1', 'localhost'].includes(target.hostname)) {
            throw new Error('The migration target must be local PostgREST');
        }
        const source = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const destination = new PostgrestClient(target.origin);
        const apply = process.argv.includes('--apply');
        const counts = await migrate({ source, destination, apply });
        console.log(apply ? 'Copied and verified:' : 'Dry run:', counts);
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { migrate, allRows };
