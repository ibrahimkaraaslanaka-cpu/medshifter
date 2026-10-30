/** Durable, non-secret site configuration edited through the admin API. */
const fs = require('node:fs');
const path = require('node:path');

const dataDirectory = path.join(__dirname, '../../data');
const settingsFile = path.join(dataDirectory, 'site-settings.json');

const defaults = Object.freeze({
    siteName: 'MedShifter',
    supportEmail: 'destek@medshifter.com',
    announcement: { enabled: false, text: '' },
    prices: {
        INDIVIDUAL: { monthly: { TRY: 380, USD: 19 }, yearly: { TRY: 190, USD: 5 } },
        BUSINESS: { monthly: { TRY: 1180, USD: 59 }, yearly: { TRY: 590, USD: 15 } }
    },
    limits: {
        FREE: { calendarsPerMonth: 1, conditionsLimit: 5, peopleLimit: 5, versionsPerMonth: 3 },
        INDIVIDUAL: { calendarsPerMonth: 5, conditionsLimit: 10, peopleLimit: 15, versionsPerMonth: 15 },
        BUSINESS: { calendarsPerMonth: 25, conditionsLimit: 50, peopleLimit: 50, versionsPerMonth: 75 }
    }
});

function copyDefaults() {
    return structuredClone(defaults);
}

function readSettings() {
    let saved;
    try {
        saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return copyDefaults();
    }
    const result = copyDefaults();
    if (typeof saved.siteName === 'string') result.siteName = saved.siteName;
    if (typeof saved.supportEmail === 'string') result.supportEmail = saved.supportEmail;
    if (saved.announcement) Object.assign(result.announcement, saved.announcement);
    for (const plan of ['INDIVIDUAL', 'BUSINESS']) {
        for (const period of ['monthly', 'yearly']) {
            for (const currency of ['TRY', 'USD']) {
                const value = saved.prices?.[plan]?.[period]?.[currency];
                if (Number.isFinite(value)) result.prices[plan][period][currency] = value;
            }
        }
    }
    for (const plan of ['FREE', 'INDIVIDUAL', 'BUSINESS']) {
        for (const field of ['calendarsPerMonth', 'conditionsLimit', 'peopleLimit', 'versionsPerMonth']) {
            const value = saved.limits?.[plan]?.[field];
            if (Number.isInteger(value)) result.limits[plan][field] = value;
        }
    }
    return result;
}

function validateSettings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Geçersiz ayarlar');
    const next = readSettings();
    if (input.siteName !== undefined) {
        if (typeof input.siteName !== 'string' || !input.siteName.trim() || input.siteName.length > 80) throw new Error('Site adı 1-80 karakter olmalı');
        next.siteName = input.siteName.trim();
    }
    if (input.supportEmail !== undefined) {
        if (typeof input.supportEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.supportEmail) || input.supportEmail.length > 254) throw new Error('Geçerli destek e-postası gerekli');
        next.supportEmail = input.supportEmail;
    }
    if (input.announcement !== undefined) {
        const value = input.announcement;
        if (!value || typeof value.enabled !== 'boolean' || typeof value.text !== 'string' || value.text.length > 300) throw new Error('Duyuru bilgisi geçersiz');
        next.announcement = { enabled: value.enabled, text: value.text.trim() };
    }
    if (input.prices !== undefined) {
        for (const plan of ['INDIVIDUAL', 'BUSINESS']) {
            for (const period of ['monthly', 'yearly']) {
                for (const currency of ['TRY', 'USD']) {
                    const value = input.prices?.[plan]?.[period]?.[currency];
                    if (!Number.isFinite(value) || value <= 0 || value > 1000000) throw new Error('Fiyatlar 0-1.000.000 arasında pozitif olmalı');
                    next.prices[plan][period][currency] = value;
                }
            }
        }
    }
    if (input.limits !== undefined) {
        for (const plan of ['FREE', 'INDIVIDUAL', 'BUSINESS']) {
            for (const field of ['calendarsPerMonth', 'conditionsLimit', 'peopleLimit', 'versionsPerMonth']) {
                const value = input.limits?.[plan]?.[field];
                if (!Number.isInteger(value) || value < 0 || value > 10000) throw new Error('Plan limitleri 0-10.000 arasında tam sayı olmalı');
                next.limits[plan][field] = value;
            }
        }
    }
    return next;
}

function saveSettings(input) {
    const next = validateSettings(input);
    fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    const temporaryFile = `${settingsFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryFile, settingsFile);
    return next;
}

module.exports = { defaults, readSettings, saveSettings, validateSettings };
