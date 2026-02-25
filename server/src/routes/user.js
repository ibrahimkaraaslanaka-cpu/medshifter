/**
 * User Routes (Supabase Edition)
 * /api/user/*
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { getUsageStatus, resetUsageIfNeeded } = require('../services/limits');

const router = express.Router();

/**
 * GET /api/user/usage
 * Get current usage status
 */
router.get('/usage', authMiddleware, async (req, res, next) => {
    try {
        const { data: profile, error } = await req.supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', req.userId)
            .single();

        if (error || !profile) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }

        // Reset if new month
        const updatedProfile = await resetUsageIfNeeded(req.supabaseAdmin, profile);

        res.json(getUsageStatus(updatedProfile));
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/user/profile
 * Update user profile
 */
router.put('/profile', authMiddleware, async (req, res, next) => {
    try {
        const { name } = req.body;

        const updateData = {};

        if (name !== undefined) {
            updateData.name = name;
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'Güncellenecek bilgi yok' });
        }

        updateData.updated_at = new Date().toISOString();

        const { data: updatedProfile, error } = await req.supabaseAdmin
            .from('profiles')
            .update(updateData)
            .eq('id', req.userId)
            .select()
            .single();

        if (error) throw error;

        res.json({
            message: 'Profil güncellendi',
            user: {
                id: updatedProfile.id,
                email: updatedProfile.email,
                name: updatedProfile.name,
                plan: updatedProfile.plan
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/user/stats
 * Get user statistics
 */
router.get('/stats', authMiddleware, async (req, res, next) => {
    try {
        const { data: profile, error: profileError } = await req.supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', req.userId)
            .single();

        if (profileError || !profile) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }

        // Get calendar count
        const { count: calendarCount } = await req.supabaseAdmin
            .from('calendars')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', req.userId);

        // Get recent calendars
        const { data: recentCalendars } = await req.supabaseAdmin
            .from('calendars')
            .select('id, title, month, year, created_at')
            .eq('user_id', req.userId)
            .order('created_at', { ascending: false })
            .limit(5);

        res.json({
            totalCalendars: calendarCount || 0,
            recentCalendars: recentCalendars || [],
            memberSince: profile.created_at,
            usage: getUsageStatus(profile)
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
