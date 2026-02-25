/**
 * Authentication Middleware (Supabase)
 * Validates Supabase JWT tokens and attaches user to request
 */

const { createClient } = require('@supabase/supabase-js');

// Middleware to verify Supabase JWT token
async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Yetkilendirme gerekli' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // Create a Supabase client with the user's token
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY,
            {
                global: {
                    headers: { Authorization: `Bearer ${token}` }
                }
            }
        );

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token' });
        }

        req.userId = user.id;
        req.userEmail = user.email;
        req.supabaseUser = supabase; // User-scoped client for RLS
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(401).json({ error: 'Yetkilendirme hatası' });
    }
}

// Optional auth - doesn't fail if no token
async function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
    }

    const token = authHeader.split(' ')[1];

    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY,
            {
                global: {
                    headers: { Authorization: `Bearer ${token}` }
                }
            }
        );

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (!error && user) {
            req.userId = user.id;
            req.userEmail = user.email;
            req.supabaseUser = supabase;
        }
    } catch (error) {
        // Ignore invalid tokens for optional auth
    }

    next();
}

module.exports = { authMiddleware, optionalAuth };
