/**
 * Admin Authentication Middleware
 * Validates admin JWT tokens (separate from user auth)
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Admin JWT secret - should be different from user JWT secret
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_JWT_SECRET) {
    throw new Error('ADMIN_JWT_SECRET must be set in production');
}
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || crypto.randomBytes(32).toString('hex');

/**
 * Middleware to verify admin JWT token
 */
async function adminAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Admin yetkilendirmesi gerekli',
            code: 1001,
            type: 'AUTH_REQUIRED'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, ADMIN_JWT_SECRET);

        // Ensure this is an admin token
        if (!decoded.adminId) {
            return res.status(401).json({
                error: 'Geçersiz admin token',
                code: 1002,
                type: 'AUTH_INVALID_TOKEN'
            });
        }

        // Re-check the current database role so deleting or demoting an admin
        // revokes old tokens immediately instead of waiting eight hours.
        const { data: admin, error } = await req.supabaseAdmin
            .from('admins').select('id, role').eq('id', decoded.adminId).single();
        if (error || !admin) {
            return res.status(401).json({ error: 'Admin hesabı geçersiz', code: 1002, type: 'AUTH_INVALID_TOKEN' });
        }
        req.adminId = admin.id;
        req.adminRole = admin.role;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Admin oturumu süresi doldu',
                code: 1003,
                type: 'AUTH_EXPIRED'
            });
        }
        return res.status(401).json({
            error: 'Geçersiz admin token',
            code: 1002,
            type: 'AUTH_INVALID_TOKEN'
        });
    }
}

/**
 * Middleware to require superadmin role
 */
function superAdminOnly(req, res, next) {
    if (req.adminRole !== 'superadmin') {
        return res.status(403).json({
            error: 'Bu işlem için superadmin yetkisi gerekli',
            code: 2001,
            type: 'FORBIDDEN'
        });
    }
    next();
}

/**
 * Generate admin JWT token
 */
function generateAdminToken(admin) {
    return jwt.sign(
        {
            adminId: admin.id,
            role: admin.role
        },
        ADMIN_JWT_SECRET,
        { expiresIn: '8h' } // Admin tokens expire after 8 hours
    );
}

module.exports = {
    adminAuthMiddleware,
    superAdminOnly,
    generateAdminToken,
    ADMIN_JWT_SECRET
};
