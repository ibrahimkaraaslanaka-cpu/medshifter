/**
 * Public Routes (Supabase Edition)
 * /api/public/*
 * No authentication required
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/public/:token
 * Get a publicly shared calendar (no auth required)
 */
router.get('/:token', async (req, res, next) => {
    try {
        const { data: calendar, error } = await req.supabaseAdmin
            .from('calendars')
            .select('id, title, month, year, people, work_areas, schedule, published_at')
            .eq('share_token', req.params.token)
            .eq('is_public', true)
            .single();

        if (error || !calendar) {
            return res.status(404).json({ error: 'Takvim bulunamadı veya paylaşımda değil' });
        }

        // Map snake_case to camelCase for frontend compatibility
        res.json({
            calendar: {
                id: calendar.id,
                title: calendar.title,
                month: calendar.month,
                year: calendar.year,
                people: calendar.people,
                workAreas: calendar.work_areas,
                schedule: calendar.schedule,
                publishedAt: calendar.published_at
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
