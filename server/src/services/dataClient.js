const { createClient } = require('@supabase/supabase-js');
const { PostgrestClient } = require('@supabase/postgrest-js');
const fs = require('node:fs');

function createDataClient() {
    if ((process.env.DATA_PROVIDER === 'postgres') !== (process.env.AUTH_PROVIDER === 'firebase')) {
        throw new Error('PostgreSQL data and Firebase authentication must be enabled together');
    }
    if (process.env.DATA_PROVIDER !== 'postgres') {
        return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    }

    if (!process.env.POSTGREST_URL || !process.env.FIREBASE_PROJECT_ID ||
        !process.env.GOOGLE_APPLICATION_CREDENTIALS || !fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
        throw new Error('Local PostgREST and Firebase Admin credentials are required for PostgreSQL mode');
    }

    const url = new URL(process.env.POSTGREST_URL);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
        throw new Error('PostgREST must only be accessible on the local host');
    }

    const data = new PostgrestClient(url.origin);
    const { getAuth } = require('./firebaseAuth');
    data.auth = { admin: {
        async getUserById(id) {
            try {
                const record = await getAuth().getUser(id);
                return { data: { user: {
                    id: record.uid,
                    email: record.email,
                    user_metadata: { full_name: record.displayName }
                } }, error: null };
            } catch (error) {
                return { data: { user: null }, error };
            }
        },
        async createUser({ email, password, email_confirm }) {
            let record;
            try {
                record = await getAuth().createUser({ email, password, emailVerified: !!email_confirm });
                const { error } = await data.from('profiles').insert({
                    id: record.uid, email: record.email,
                    name: record.displayName || record.email.split('@')[0], plan: 'FREE'
                });
                if (error) throw error;
                return { data: { user: { id: record.uid, email: record.email } }, error: null };
            } catch (error) {
                if (record) await getAuth().deleteUser(record.uid).catch(() => {});
                return { data: { user: null }, error };
            }
        }
    } };
    return data;
}

module.exports = { createDataClient };
