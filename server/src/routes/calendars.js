/**
 * Calendar Routes (Supabase Edition)
 * /api/calendars/*
 */

const express = require('express');
const crypto = require('crypto');
const { authMiddleware } = require('../middleware/auth');
const {
    canCreateCalendar,
    canSaveCalendar,
    validateCalendarData,
    getUsageStatus
} = require('../services/limits');

const router = express.Router();

/**
 * GET /api/calendars
 * Get all calendars for current user
 */
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const { data: calendars, error } = await req.supabaseAdmin
            .from('calendars')
            .select('id, title, month, year, created_at, updated_at')
            .eq('user_id', req.userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ calendars });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/calendars/:id
 * Get a specific calendar
 */
router.get('/:id', authMiddleware, async (req, res, next) => {
    try {
        const { data: calendar, error } = await req.supabaseAdmin
            .from('calendars')
            .select('*')
            .eq('id', req.params.id)
            .eq('user_id', req.userId)
            .single();

        if (error || !calendar) {
            return res.status(404).json({ error: 'Takvim bulunamadı' });
        }

        res.json({ calendar });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/calendars
 * Create a new calendar
 */
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        // Get user profile with current usage
        const { data: profile, error: profileError } = await req.supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', req.userId)
            .single();

        if (profileError || !profile) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }

        // Check calendar creation limit
        if (!canCreateCalendar(profile)) {
            return res.status(403).json({
                error: 'Takvim oluşturma limitinize ulaştınız',
                usage: getUsageStatus(profile)
            });
        }

        const { title, month, year, people, workAreas, schedule, conditions, shiftDelays } = req.body;

        // Validate against plan limits
        const validationErrors = validateCalendarData(profile, { people, conditions });
        if (validationErrors.length > 0) {
            return res.status(400).json({
                error: 'Plan limitleri aşıldı',
                details: validationErrors
            });
        }

        // Create calendar
        const { data: calendar, error: calError } = await req.supabaseAdmin
            .from('calendars')
            .insert({
                user_id: req.userId,
                title: title || `${month + 1}/${year} Takvimi`,
                month: month || new Date().getMonth(),
                year: year || new Date().getFullYear(),
                people: people || [],
                work_areas: workAreas || [],
                schedule: schedule || [],
                conditions: conditions || '',
                shift_delays: shiftDelays || {}
            })
            .select()
            .single();

        if (calError) throw calError;

        // Increment usage counter
        const { data: updatedProfile } = await req.supabaseAdmin
            .from('profiles')
            .update({
                calendars_used_this_month: profile.calendars_used_this_month + 1
            })
            .eq('id', req.userId)
            .select()
            .single();

        res.status(201).json({
            message: 'Takvim oluşturuldu',
            calendar,
            usage: getUsageStatus(updatedProfile || profile)
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/calendars/:id
 * Update a calendar (save)
 */
router.put('/:id', authMiddleware, async (req, res, next) => {
    try {
        // Check ownership
        const { data: existing, error: findError } = await req.supabaseAdmin
            .from('calendars')
            .select('*')
            .eq('id', req.params.id)
            .eq('user_id', req.userId)
            .single();

        if (findError || !existing) {
            return res.status(404).json({ error: 'Takvim bulunamadı' });
        }

        // Get user profile for limit check
        const { data: profile } = await req.supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', req.userId)
            .single();

        // Check version limit
        if (!canSaveCalendar(profile)) {
            return res.status(403).json({
                error: 'Versiyon limitinize ulaştınız',
                usage: getUsageStatus(profile)
            });
        }

        const { title, people, workAreas, schedule, conditions, shiftDelays } = req.body;

        // Validate against plan limits
        const validationErrors = validateCalendarData(profile, { people, conditions });
        if (validationErrors.length > 0) {
            return res.status(400).json({
                error: 'Plan limitleri aşıldı',
                details: validationErrors
            });
        }

        // Update calendar
        const updateData = { updated_at: new Date().toISOString() };
        if (title !== undefined) updateData.title = title;
        if (people !== undefined) updateData.people = people;
        if (workAreas !== undefined) updateData.work_areas = workAreas;
        if (schedule !== undefined) updateData.schedule = schedule;
        if (conditions !== undefined) updateData.conditions = conditions;
        if (shiftDelays !== undefined) updateData.shift_delays = shiftDelays;

        const { data: calendar, error: updateError } = await req.supabaseAdmin
            .from('calendars')
            .update(updateData)
            .eq('id', req.params.id)
            .select()
            .single();

        if (updateError) throw updateError;

        // Increment save counter (skip if auto-save for share)
        if (req.query.skipCounter !== 'true') {
            await req.supabaseAdmin
                .from('profiles')
                .update({
                    saves_used_this_month: profile.saves_used_this_month + 1
                })
                .eq('id', req.userId);
        }

        res.json({
            message: 'Takvim kaydedildi',
            calendar
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/calendars/:id
 * Delete a calendar
 */
router.delete('/:id', authMiddleware, async (req, res, next) => {
    try {
        // Check ownership
        const { data: existing } = await req.supabaseAdmin
            .from('calendars')
            .select('id')
            .eq('id', req.params.id)
            .eq('user_id', req.userId)
            .single();

        if (!existing) {
            return res.status(404).json({ error: 'Takvim bulunamadı' });
        }

        const { error } = await req.supabaseAdmin
            .from('calendars')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;

        res.json({ message: 'Takvim silindi' });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/calendars/:id/share
 * Create a public share link for the calendar
 */
router.post('/:id/share', authMiddleware, async (req, res, next) => {
    try {
        // Check ownership
        const { data: existing } = await req.supabaseAdmin
            .from('calendars')
            .select('*')
            .eq('id', req.params.id)
            .eq('user_id', req.userId)
            .single();

        if (!existing) {
            return res.status(404).json({ error: 'Takvim bulunamadı' });
        }

        // If already shared, return existing token
        if (existing.share_token && existing.is_public) {
            return res.json({
                message: 'Takvim zaten paylaşılıyor',
                shareToken: existing.share_token,
                shareUrl: `https://medshifter.app/view/${existing.share_token}`
            });
        }

        // Generate unique 8-character token
        const generateToken = () => {
            return crypto.randomBytes(4).toString('hex');
        };

        let shareToken;
        let attempts = 0;

        // Ensure token is unique
        while (attempts < 10) {
            shareToken = generateToken();
            const { data: exists } = await req.supabaseAdmin
                .from('calendars')
                .select('id')
                .eq('share_token', shareToken)
                .single();

            if (!exists) break;
            attempts++;
        }

        if (attempts >= 10) {
            return res.status(500).json({ error: 'Token oluşturulamadı, tekrar deneyin' });
        }

        // Update calendar with share token
        const { data: updated, error } = await req.supabaseAdmin
            .from('calendars')
            .update({
                share_token: shareToken,
                is_public: true,
                published_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        res.json({
            message: 'Takvim paylaşıma açıldı',
            shareToken: updated.share_token,
            shareUrl: `https://medshifter.app/view/${updated.share_token}`
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/calendars/:id/share
 * Remove public share link
 */
router.delete('/:id/share', authMiddleware, async (req, res, next) => {
    try {
        // Check ownership
        const { data: existing } = await req.supabaseAdmin
            .from('calendars')
            .select('id')
            .eq('id', req.params.id)
            .eq('user_id', req.userId)
            .single();

        if (!existing) {
            return res.status(404).json({ error: 'Takvim bulunamadı' });
        }

        const { error } = await req.supabaseAdmin
            .from('calendars')
            .update({
                share_token: null,
                is_public: false,
                published_at: null
            })
            .eq('id', req.params.id);

        if (error) throw error;

        res.json({ message: 'Paylaşım kaldırıldı' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
