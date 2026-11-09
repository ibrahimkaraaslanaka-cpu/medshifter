/** Verify a user token from the configured authentication provider. */
const { createClient } = require('@supabase/supabase-js');

async function resolveUser(token) {
    if (process.env.AUTH_PROVIDER === 'firebase') {
        const { getAuth } = require('../services/firebaseAuth');
        const claims = await getAuth().verifyIdToken(token);
        if (!claims.email || !claims.email_verified) throw new Error('Email is not verified');
        return {
            id: claims.uid,
            email: claims.email,
            user_metadata: {
                full_name: claims.name || claims.email.split('@')[0],
                avatar_url: claims.picture || null
            }
        };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) throw error || new Error('Invalid token');
    return user;
}

function bearerToken(req) {
    const header = req.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

function attachUser(req, user) {
    req.userId = user.id;
    req.userEmail = user.email;
    req.authUser = user;
}

async function authMiddleware(req, res, next) {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'Yetkilendirme gerekli' });
    try {
        attachUser(req, await resolveUser(token));
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş oturum' });
    }
}

async function optionalAuth(req, res, next) {
    const token = bearerToken(req);
    if (token) {
        try { attachUser(req, await resolveUser(token)); } catch (_) { /* Guest request. */ }
    }
    next();
}

module.exports = { authMiddleware, optionalAuth, resolveUser };
