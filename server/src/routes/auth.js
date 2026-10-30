/**
 * Authentication Routes (Supabase Edition)
 * /api/auth/*
 * 
 * Auth is handled client-side by Supabase.
 * These routes just return user profile data.
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { getUsageStatus, resetUsageIfNeeded } = require('../services/limits');

const router = express.Router();

/**
 * GET /api/auth/me
 * Get current user info + usage from profiles table
 */
router.get('/me', authMiddleware, async (req, res, next) => {
    try {
        let { data: profile, error } = await req.supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', req.userId)
            .single();

        if (error && error.code !== 'PGRST116') throw error;

        // An OAuth account can exist even if the database's signup trigger was
        // absent or failed. Create only the missing row, preserving paid plans.
        if (!profile) {
            const metadata = req.authUser.user_metadata || {};
            const { data: created, error: createError } = await req.supabaseAdmin
                .from('profiles')
                .insert({
                    id: req.userId,
                    email: req.userEmail,
                    name: metadata.full_name || metadata.name || req.userEmail.split('@')[0],
                    avatar: metadata.avatar_url || metadata.picture || null,
                    plan: 'FREE',
                    calendars_used_this_month: 0,
                    saves_used_this_month: 0,
                    exports_used_this_month: 0,
                    usage_reset_at: new Date().toISOString()
                })
                .select()
                .single();

            if (createError && createError.code !== '23505') throw createError;
            if (created) profile = created;
            else {
                const retry = await req.supabaseAdmin.from('profiles')
                    .select('*').eq('id', req.userId).single();
                if (retry.error) throw retry.error;
                profile = retry.data;
            }
        }

        // Reset usage if new month
        const updatedProfile = await resetUsageIfNeeded(req.supabaseAdmin, profile);

        res.json({
            user: {
                id: updatedProfile.id,
                email: updatedProfile.email,
                name: updatedProfile.name,
                avatar: updatedProfile.avatar,
                plan: updatedProfile.plan,
                createdAt: updatedProfile.created_at
            },
            usage: getUsageStatus(updatedProfile)
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/auth/logout
 * Logout acknowledgement (actual signout is client-side)
 */
router.post('/logout', authMiddleware, async (req, res) => {
    res.json({ message: 'Çıkış yapıldı' });
});

module.exports = router;
