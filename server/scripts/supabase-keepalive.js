/** Generate real database activity so low-traffic Free projects stay available. */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
    const baseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceKey) {
        throw new Error('Supabase keepalive configuration is incomplete');
    }

    const endpoint = new URL('/rest/v1/profiles?select=id&limit=1', baseUrl);
    const response = await fetch(endpoint, {
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`
        },
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
        throw new Error(`Supabase database query returned HTTP ${response.status}`);
    }
    console.log('Supabase database query succeeded');
}

main().catch(error => {
    console.error(`Supabase keepalive failed: ${error.message}`);
    process.exitCode = 1;
});
