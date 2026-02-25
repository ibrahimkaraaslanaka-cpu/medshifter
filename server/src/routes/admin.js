/**
 * Admin Routes (Supabase Edition)
 * /api/admin/*
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { adminAuthMiddleware, superAdminOnly, generateAdminToken } = require('../middleware/adminAuth');
const { logger } = require('../services/logger');

const router = express.Router();

/**
 * POST /api/admin/login
 * Admin login
 */
router.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                error: 'Kullanıcı adı ve şifre gerekli',
                code: 3002,
                type: 'MISSING_FIELD'
            });
        }

        // Find admin
        const { data: admin, error } = await req.supabaseAdmin
            .from('admins')
            .select('*')
            .eq('username', username.toLowerCase())
            .single();

        if (error || !admin) {
            logger.warn('Admin login failed: user not found', { username });
            return res.status(401).json({
                error: 'Geçersiz kullanıcı adı veya şifre',
                code: 1004,
                type: 'AUTH_FAILED'
            });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, admin.password_hash);

        if (!validPassword) {
            logger.warn('Admin login failed: wrong password', { username });
            return res.status(401).json({
                error: 'Geçersiz kullanıcı adı veya şifre',
                code: 1004,
                type: 'AUTH_FAILED'
            });
        }

        // Update last login
        await req.supabaseAdmin
            .from('admins')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', admin.id);

        // Generate token
        const token = generateAdminToken(admin);

        logger.info('Admin login successful', { adminId: admin.id, username });

        res.json({
            message: 'Admin girişi başarılı',
            token,
            admin: {
                id: admin.id,
                username: admin.username,
                name: admin.name,
                role: admin.role
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/me
 * Get current admin info
 */
router.get('/me', adminAuthMiddleware, async (req, res, next) => {
    try {
        const { data: admin, error } = await req.supabaseAdmin
            .from('admins')
            .select('id, username, name, role, last_login_at, created_at')
            .eq('id', req.adminId)
            .single();

        if (error || !admin) {
            return res.status(404).json({
                error: 'Admin bulunamadı',
                code: 4002,
                type: 'NOT_FOUND'
            });
        }

        res.json({ admin });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/dashboard
 * Get dashboard statistics
 */
router.get('/dashboard', adminAuthMiddleware, async (req, res, next) => {
    try {
        // Get total users
        const { count: totalUsers } = await req.supabaseAdmin
            .from('profiles')
            .select('id', { count: 'exact', head: true });

        // Get total calendars
        const { count: totalCalendars } = await req.supabaseAdmin
            .from('calendars')
            .select('id', { count: 'exact', head: true });

        // Get users registered today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { count: usersToday } = await req.supabaseAdmin
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', today.toISOString());

        // Get users registered this month
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const { count: usersThisMonth } = await req.supabaseAdmin
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', monthStart.toISOString());

        // Get calendars created this month
        const { count: calendarsThisMonth } = await req.supabaseAdmin
            .from('calendars')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', monthStart.toISOString());

        // Get recent registrations
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        const { data: recentUsers } = await req.supabaseAdmin
            .from('profiles')
            .select('id, email, name, plan, created_at')
            .gte('created_at', weekAgo.toISOString())
            .order('created_at', { ascending: false })
            .limit(10);

        // Get plan distribution
        const { data: allProfiles } = await req.supabaseAdmin
            .from('profiles')
            .select('plan');

        const planDistribution = { FREE: 0, INDIVIDUAL: 0, BUSINESS: 0 };
        (allProfiles || []).forEach(p => {
            if (planDistribution[p.plan] !== undefined) {
                planDistribution[p.plan]++;
            }
        });

        res.json({
            stats: {
                totalUsers: totalUsers || 0,
                totalCalendars: totalCalendars || 0,
                usersToday: usersToday || 0,
                usersThisMonth: usersThisMonth || 0,
                calendarsThisMonth: calendarsThisMonth || 0
            },
            planDistribution,
            recentUsers: recentUsers || []
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/users
 * Get all users with pagination
 */
router.get('/users', adminAuthMiddleware, async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const plan = req.query.plan || '';

        const offset = (page - 1) * limit;

        let query = req.supabaseAdmin
            .from('profiles')
            .select('id, email, name, avatar, plan, plan_expires_at, calendars_used_this_month, saves_used_this_month, exports_used_this_month, created_at', { count: 'exact' });

        if (search) {
            query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
        }
        if (plan) {
            query = query.eq('plan', plan);
        }

        const { data: users, count: total, error } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        res.json({
            users: users || [],
            pagination: {
                page,
                limit,
                total: total || 0,
                totalPages: Math.ceil((total || 0) / limit)
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/users/:id
 * Get user details with calendars
 */
router.get('/users/:id', adminAuthMiddleware, async (req, res, next) => {
    try {
        const { data: profile, error } = await req.supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error || !profile) {
            return res.status(404).json({
                error: 'Kullanıcı bulunamadı',
                code: 4002,
                type: 'USER_NOT_FOUND'
            });
        }

        const { data: calendars } = await req.supabaseAdmin
            .from('calendars')
            .select('id, title, month, year, created_at, updated_at')
            .eq('user_id', req.params.id)
            .order('created_at', { ascending: false });

        res.json({
            user: {
                ...profile,
                calendars: calendars || []
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/admin/users/:id/plan
 * Update user plan
 */
router.put('/users/:id/plan', adminAuthMiddleware, async (req, res, next) => {
    try {
        const { plan, expiresAt } = req.body;

        const validPlans = ['FREE', 'INDIVIDUAL', 'BUSINESS'];
        if (!validPlans.includes(plan)) {
            return res.status(400).json({
                error: 'Geçersiz plan',
                code: 3001,
                type: 'VALIDATION_ERROR'
            });
        }

        const { data: user, error } = await req.supabaseAdmin
            .from('profiles')
            .update({
                plan,
                plan_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
                calendars_used_this_month: 0,
                saves_used_this_month: 0,
                exports_used_this_month: 0,
                usage_reset_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) {
            return res.status(404).json({
                error: 'Kullanıcı bulunamadı',
                code: 4002,
                type: 'USER_NOT_FOUND'
            });
        }

        logger.info('User plan updated by admin', {
            adminId: req.adminId,
            userId: req.params.id,
            newPlan: plan
        });

        res.json({
            message: 'Plan güncellendi',
            user: {
                id: user.id,
                email: user.email,
                plan: user.plan,
                plan_expires_at: user.plan_expires_at
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/calendars
 * Get recent calendars
 */
router.get('/calendars', adminAuthMiddleware, async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const { data: calendars, count: total, error } = await req.supabaseAdmin
            .from('calendars')
            .select('*, profiles!inner(id, email, name)', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        // Reshape for frontend compatibility
        const formattedCalendars = (calendars || []).map(c => ({
            ...c,
            user: c.profiles,
            profiles: undefined
        }));

        res.json({
            calendars: formattedCalendars,
            pagination: {
                page,
                limit,
                total: total || 0,
                totalPages: Math.ceil((total || 0) / limit)
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/admins
 * Get all admins (superadmin only)
 */
router.get('/admins', adminAuthMiddleware, superAdminOnly, async (req, res, next) => {
    try {
        const { data: admins, error } = await req.supabaseAdmin
            .from('admins')
            .select('id, username, name, role, last_login_at, created_at')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ admins: admins || [] });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/admin/admins
 * Create new admin (superadmin only)
 */
router.post('/admins', adminAuthMiddleware, superAdminOnly, async (req, res, next) => {
    try {
        const { username, password, name, role = 'admin' } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                error: 'Kullanıcı adı ve şifre gerekli',
                code: 3002,
                type: 'MISSING_FIELD'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                error: 'Şifre en az 8 karakter olmalı',
                code: 3001,
                type: 'VALIDATION_ERROR'
            });
        }

        // Check if username exists
        const { data: existing } = await req.supabaseAdmin
            .from('admins')
            .select('id')
            .eq('username', username.toLowerCase())
            .single();

        if (existing) {
            return res.status(400).json({
                error: 'Bu kullanıcı adı zaten mevcut',
                code: 4004,
                type: 'ALREADY_EXISTS'
            });
        }

        // Hash password
        const password_hash = await bcrypt.hash(password, 12);

        // Create admin
        const { data: admin, error } = await req.supabaseAdmin
            .from('admins')
            .insert({
                username: username.toLowerCase(),
                password_hash,
                name: name || null,
                role: role === 'superadmin' ? 'superadmin' : 'admin'
            })
            .select()
            .single();

        if (error) throw error;

        logger.info('New admin created', {
            createdBy: req.adminId,
            newAdminId: admin.id,
            username: admin.username,
            role: admin.role
        });

        res.status(201).json({
            message: 'Admin oluşturuldu',
            admin: {
                id: admin.id,
                username: admin.username,
                name: admin.name,
                role: admin.role
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/admin/admins/:id
 * Delete an admin (superadmin only, cannot delete self)
 */
router.delete('/admins/:id', adminAuthMiddleware, superAdminOnly, async (req, res, next) => {
    try {
        if (req.params.id === req.adminId) {
            return res.status(400).json({
                error: 'Kendinizi silemezsiniz',
                code: 3001,
                type: 'VALIDATION_ERROR'
            });
        }

        const { error } = await req.supabaseAdmin
            .from('admins')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;

        logger.info('Admin deleted', {
            deletedBy: req.adminId,
            deletedAdminId: req.params.id
        });

        res.json({ message: 'Admin silindi' });
    } catch (error) {
        next(error);
    }
});

// ========== COUPON MANAGEMENT ==========

/**
 * GET /api/admin/coupons
 * List all coupons
 */
router.get('/coupons', adminAuthMiddleware, async (req, res, next) => {
    try {
        const { data: coupons, error } = await req.supabaseAdmin
            .from('coupons')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ coupons: coupons || [] });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/admin/coupons
 * Create a new coupon
 */
router.post('/coupons', adminAuthMiddleware, async (req, res, next) => {
    try {
        const { code, discount_percent, valid_from, valid_until, max_uses, applicable_plans } = req.body;

        if (!code || !discount_percent) {
            return res.status(400).json({
                error: 'Kupon kodu ve indirim yüzdesi gerekli',
                code: 3002,
                type: 'MISSING_FIELD'
            });
        }

        if (discount_percent < 1 || discount_percent > 100) {
            return res.status(400).json({
                error: 'İndirim yüzdesi 1-100 arasında olmalı',
                code: 3001,
                type: 'VALIDATION_ERROR'
            });
        }

        // Check if code already exists
        const { data: existing } = await req.supabaseAdmin
            .from('coupons')
            .select('id')
            .eq('code', code.toUpperCase())
            .single();

        if (existing) {
            return res.status(400).json({
                error: 'Bu kupon kodu zaten mevcut',
                code: 4004,
                type: 'ALREADY_EXISTS'
            });
        }

        const { data: coupon, error } = await req.supabaseAdmin
            .from('coupons')
            .insert({
                code: code.toUpperCase(),
                discount_percent,
                valid_from: valid_from || new Date().toISOString(),
                valid_until: valid_until || null,
                max_uses: max_uses || 0,
                applicable_plans: applicable_plans || ['INDIVIDUAL', 'BUSINESS'],
                created_by: req.adminId,
                is_active: true
            })
            .select()
            .single();

        if (error) throw error;

        logger.info('Coupon created', { adminId: req.adminId, couponId: coupon.id, code: coupon.code });

        res.status(201).json({ message: 'Kupon oluşturuldu', coupon });
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/admin/coupons/:id
 * Update a coupon
 */
router.put('/coupons/:id', adminAuthMiddleware, async (req, res, next) => {
    try {
        const { discount_percent, valid_until, max_uses, applicable_plans, is_active } = req.body;

        const updateData = {};
        if (discount_percent !== undefined) updateData.discount_percent = discount_percent;
        if (valid_until !== undefined) updateData.valid_until = valid_until;
        if (max_uses !== undefined) updateData.max_uses = max_uses;
        if (applicable_plans !== undefined) updateData.applicable_plans = applicable_plans;
        if (is_active !== undefined) updateData.is_active = is_active;

        const { data: coupon, error } = await req.supabaseAdmin
            .from('coupons')
            .update(updateData)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        logger.info('Coupon updated', { adminId: req.adminId, couponId: req.params.id });

        res.json({ message: 'Kupon güncellendi', coupon });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/admin/coupons/:id
 * Delete a coupon
 */
router.delete('/coupons/:id', adminAuthMiddleware, async (req, res, next) => {
    try {
        const { error } = await req.supabaseAdmin
            .from('coupons')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;

        logger.info('Coupon deleted', { adminId: req.adminId, couponId: req.params.id });

        res.json({ message: 'Kupon silindi' });
    } catch (error) {
        next(error);
    }
});

// ========== ORDER MANAGEMENT ==========

/**
 * GET /api/admin/orders
 * List all orders with pagination
 */
router.get('/orders', adminAuthMiddleware, async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status || '';
        const offset = (page - 1) * limit;

        let query = req.supabaseAdmin
            .from('orders')
            .select('*, profiles!inner(id, email, name), coupons(id, code, discount_percent)', { count: 'exact' });

        if (status) {
            query = query.eq('status', status);
        }

        const { data: orders, count: total, error } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        const formattedOrders = (orders || []).map(o => ({
            ...o,
            user: o.profiles,
            coupon: o.coupons,
            profiles: undefined,
            coupons: undefined
        }));

        res.json({
            orders: formattedOrders,
            pagination: {
                page,
                limit,
                total: total || 0,
                totalPages: Math.ceil((total || 0) / limit)
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/admin/orders/:id/status
 * Update order status
 */
router.put('/orders/:id/status', adminAuthMiddleware, async (req, res, next) => {
    try {
        const { status } = req.body;
        const validStatuses = ['pending', 'completed', 'failed', 'cancelled'];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                error: 'Geçersiz sipariş durumu',
                code: 3001,
                type: 'VALIDATION_ERROR'
            });
        }

        const { data: order, error } = await req.supabaseAdmin
            .from('orders')
            .update({ status })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        // If order completed, upgrade user plan
        if (status === 'completed' && order) {
            const expiresAt = new Date();
            if (order.billing_period === 'yearly') {
                expiresAt.setFullYear(expiresAt.getFullYear() + 1);
            } else {
                expiresAt.setMonth(expiresAt.getMonth() + 1);
            }

            await req.supabaseAdmin
                .from('profiles')
                .update({
                    plan: order.plan,
                    plan_expires_at: expiresAt.toISOString(),
                    calendars_used_this_month: 0,
                    saves_used_this_month: 0,
                    exports_used_this_month: 0,
                    usage_reset_at: new Date().toISOString()
                })
                .eq('id', order.user_id);

            logger.info('User plan upgraded via order', { userId: order.user_id, plan: order.plan });
        }

        logger.info('Order status updated', { adminId: req.adminId, orderId: req.params.id, status });

        res.json({ message: 'Sipariş durumu güncellendi', order });
    } catch (error) {
        next(error);
    }
});

// ========== CALENDAR DETAIL ==========

/**
 * GET /api/admin/calendars/:id
 * Get calendar detail
 */
router.get('/calendars/:id', adminAuthMiddleware, async (req, res, next) => {
    try {
        const { data: calendar, error } = await req.supabaseAdmin
            .from('calendars')
            .select('*, profiles!inner(id, email, name)')
            .eq('id', req.params.id)
            .single();

        if (error || !calendar) {
            return res.status(404).json({
                error: 'Takvim bulunamadı',
                code: 4002,
                type: 'NOT_FOUND'
            });
        }

        res.json({
            calendar: {
                ...calendar,
                user: calendar.profiles,
                profiles: undefined
            }
        });
    } catch (error) {
        next(error);
    }
});

// ========== USER CREATION ==========

/**
 * POST /api/admin/users
 * Create a new user with plan assignment
 */
router.post('/users', adminAuthMiddleware, async (req, res, next) => {
    try {
        const { email, password, name, plan = 'FREE' } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                error: 'E-posta ve şifre gerekli',
                code: 3002,
                type: 'MISSING_FIELD'
            });
        }

        const validPlans = ['FREE', 'INDIVIDUAL', 'BUSINESS'];
        if (!validPlans.includes(plan)) {
            return res.status(400).json({
                error: 'Geçersiz plan',
                code: 3001,
                type: 'VALIDATION_ERROR'
            });
        }

        // Create auth user via Supabase Admin
        const { data: authData, error: authError } = await req.supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true
        });

        if (authError) {
            return res.status(400).json({
                error: authError.message,
                code: 3001,
                type: 'CREATION_FAILED'
            });
        }

        // Update profile with plan
        const { data: profile, error: profileError } = await req.supabaseAdmin
            .from('profiles')
            .update({
                name: name || null,
                plan
            })
            .eq('id', authData.user.id)
            .select()
            .single();

        if (profileError) {
            logger.warn('Profile update failed after user creation', { error: profileError });
        }

        logger.info('User created by admin', {
            adminId: req.adminId,
            userId: authData.user.id,
            email,
            plan
        });

        res.status(201).json({
            message: 'Kullanıcı oluşturuldu',
            user: profile || { id: authData.user.id, email, plan }
        });
    } catch (error) {
        next(error);
    }
});

// ========== ADMIN PASSWORD CHANGE ==========

/**
 * PUT /api/admin/me/password
 * Change own admin password
 */
router.put('/me/password', adminAuthMiddleware, async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'Mevcut ve yeni şifre gerekli',
                code: 3002,
                type: 'MISSING_FIELD'
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                error: 'Yeni şifre en az 8 karakter olmalı',
                code: 3001,
                type: 'VALIDATION_ERROR'
            });
        }

        // Get current admin
        const { data: admin, error: fetchError } = await req.supabaseAdmin
            .from('admins')
            .select('*')
            .eq('id', req.adminId)
            .single();

        if (fetchError || !admin) {
            return res.status(404).json({ error: 'Admin bulunamadı' });
        }

        // Verify current password
        const valid = await bcrypt.compare(currentPassword, admin.password_hash);
        if (!valid) {
            return res.status(401).json({
                error: 'Mevcut şifre hatalı',
                code: 1004,
                type: 'AUTH_FAILED'
            });
        }

        // Hash new password
        const password_hash = await bcrypt.hash(newPassword, 12);

        const { error: updateError } = await req.supabaseAdmin
            .from('admins')
            .update({ password_hash })
            .eq('id', req.adminId);

        if (updateError) throw updateError;

        logger.info('Admin password changed', { adminId: req.adminId });

        res.json({ message: 'Şifre başarıyla değiştirildi' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
