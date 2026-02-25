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
        const { data: profile, error } = await req.supabaseUser
            .from('profiles')
            .select('*')
            .eq('id', req.userId)
            .single();

        if (error || !profile) {
            return res.status(404).json({ error: 'Kullanıcı profili bulunamadı' });
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
