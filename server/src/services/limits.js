/**
 * Plan Limits Service (Supabase Edition)
 * Handles plan restrictions and usage tracking
 */

// Plan limits configuration
const PLAN_LIMITS = {
    FREE: {
        calendarsPerMonth: 1,
        conditionsLimit: 5,
        peopleLimit: 5,
        versionsPerMonth: 3,
        isLifetime: true
    },
    INDIVIDUAL: {
        calendarsPerMonth: 5,
        conditionsLimit: 10,
        peopleLimit: 15,
        versionsPerMonth: 15,
        isLifetime: false
    },
    BUSINESS: {
        calendarsPerMonth: 25,
        conditionsLimit: 50,
        peopleLimit: 50,
        versionsPerMonth: 75,
        isLifetime: false
    }
};

/**
 * Check if a paid plan has expired
 */
function isPlanExpired(profile) {
    if (!profile.plan || profile.plan === 'FREE') return false;
    if (!profile.plan_expires_at) return false;
    return new Date(profile.plan_expires_at) < new Date();
}

/**
 * Get effective plan (falls back to FREE if expired)
 */
function getEffectivePlan(profile) {
    if (isPlanExpired(profile)) return 'FREE';
    return profile.plan || 'FREE';
}

/**
 * Get limits for a specific plan
 */
function getPlanLimits(plan) {
    return PLAN_LIMITS[plan] || PLAN_LIMITS.FREE;
}

/**
 * Check if user needs usage reset (new month)
 */
function needsUsageReset(profile) {
    const now = new Date();
    const resetAt = new Date(profile.usage_reset_at);

    return now.getMonth() !== resetAt.getMonth() ||
        now.getFullYear() !== resetAt.getFullYear();
}

/**
 * Reset monthly usage counters via Supabase
 */
async function resetUsageIfNeeded(supabaseAdmin, profile) {
    if (!needsUsageReset(profile)) {
        return profile;
    }

    // Free plan doesn't reset
    if (profile.plan === 'FREE') {
        return profile;
    }

    const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({
            calendars_used_this_month: 0,
            saves_used_this_month: 0,
            exports_used_this_month: 0,
            usage_reset_at: new Date().toISOString()
        })
        .eq('id', profile.id)
        .select()
        .single();

    if (error) {
        console.error('Reset usage error:', error);
        return profile;
    }

    return data;
}

/**
 * Check if user can create a calendar
 */
function canCreateCalendar(profile) {
    const effectivePlan = getEffectivePlan(profile);
    const limits = getPlanLimits(effectivePlan);
    return profile.calendars_used_this_month < limits.calendarsPerMonth;
}

/**
 * Check if user can save/version a calendar
 */
function canSaveCalendar(profile) {
    const effectivePlan = getEffectivePlan(profile);
    const limits = getPlanLimits(effectivePlan);
    return profile.saves_used_this_month < limits.versionsPerMonth;
}

/**
 * Validate calendar data against plan limits
 */
function validateCalendarData(profile, data) {
    const effectivePlan = getEffectivePlan(profile);
    const limits = getPlanLimits(effectivePlan);
    const errors = [];

    if (data.people && data.people.length > limits.peopleLimit) {
        errors.push(`Personel limiti aşıldı. Maksimum: ${limits.peopleLimit}`);
    }

    if (data.conditions) {
        let conditionCount = 0;
        if (Array.isArray(data.conditions)) {
            // Visual Builder format
            conditionCount = data.conditions.length;
        } else if (typeof data.conditions === 'string') {
            // Legacy text format
            conditionCount = data.conditions.split('\n').filter(c => c.trim()).length;
        }
        if (conditionCount > limits.conditionsLimit) {
            errors.push(`Koşul limiti aşıldı. Maksimum: ${limits.conditionsLimit}`);
        }
    }

    return errors;
}

/**
 * Get user's current usage status
 */
function getUsageStatus(profile) {
    const effectivePlan = getEffectivePlan(profile);
    const limits = getPlanLimits(effectivePlan);
    const expired = isPlanExpired(profile);

    return {
        plan: profile.plan,
        effectivePlan,
        planExpired: expired,
        limits: {
            calendarsPerMonth: limits.calendarsPerMonth,
            conditionsLimit: limits.conditionsLimit,
            peopleLimit: limits.peopleLimit,
            versionsPerMonth: limits.versionsPerMonth
        },
        usage: {
            calendarsUsed: profile.calendars_used_this_month,
            versionsUsed: profile.saves_used_this_month
        },
        remaining: {
            calendars: limits.calendarsPerMonth - profile.calendars_used_this_month,
            versions: limits.versionsPerMonth - profile.saves_used_this_month
        },
        planExpiresAt: profile.plan_expires_at
    };
}

module.exports = {
    PLAN_LIMITS,
    getPlanLimits,
    getEffectivePlan,
    isPlanExpired,
    resetUsageIfNeeded,
    canCreateCalendar,
    canSaveCalendar,
    validateCalendarData,
    getUsageStatus
};
