/**
 * Admin Authentication Middleware
 * Validates admin JWT tokens (separate from user auth)
 */

const jwt = require('jsonwebtoken');

// Admin JWT secret - should be different from user JWT secret
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET + '_admin';

/**
 * Middleware to verify admin JWT token
 */
function adminAuthMiddleware(req, res, next) {
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

        req.adminId = decoded.adminId;
        req.adminRole = decoded.role;
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
