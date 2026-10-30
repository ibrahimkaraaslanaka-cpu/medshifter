/**
 * App Configuration
 * Provides environment-aware settings for the application
 */
(function () {
    // Detect environment based on current hostname
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;

    // Production detection
    const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1';

    // API URL configuration
    let apiUrl;
    if (isProduction) {
        apiUrl = `${protocol}//${hostname}/api`;
    } else {
        apiUrl = 'http://localhost:3001/api';
    }

    // Export configuration
    window.AppConfig = {
        API_URL: apiUrl,
        IS_PRODUCTION: isProduction,
        VERSION: '2.0.0',
        // Supabase
        SUPABASE_URL: 'https://hkoicikmwbkbmwxbpxth.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_kyWsRMP18mnauJXSAaXA7A_-mRU8lCw',
        GOOGLE_CLIENT_ID: '1044013231097-cfrcgnv291j2l5n96i4kfmld210r4t6e.apps.googleusercontent.com'
    };

    // Initialize Supabase client (available globally)
    if (window.supabase) {
        window.supabaseClient = window.supabase.createClient(
            window.AppConfig.SUPABASE_URL,
            window.AppConfig.SUPABASE_ANON_KEY
        );
    }

    if (!isProduction) {
        console.log(`[AppConfig] Environment: Development`);
        console.log(`[AppConfig] API URL: ${apiUrl}`);
    }

    // Public presentation settings are read from the same source as checkout.
    // Insert the announcement with textContent so admin-entered text is never HTML.
    async function loadPresentationSettings() {
        try {
            const response = await fetch(`${apiUrl}/site/settings`, { cache: 'no-store' });
            if (!response.ok) return;
            const { settings } = await response.json();
            if (settings?.siteName && typeof settings.siteName === 'string') {
                document.title = document.title.replace(/Med\s?Shifter/gi, settings.siteName);
            }
            if (settings?.supportEmail && typeof settings.supportEmail === 'string') {
                document.querySelectorAll('[data-site-support]').forEach(link => {
                    link.href = `mailto:${settings.supportEmail}`;
                    link.textContent = `✉️ ${settings.supportEmail}`;
                });
            }
            if (settings?.announcement?.enabled && settings.announcement.text) {
                const banner = document.createElement('div');
                banner.className = 'site-announcement';
                banner.setAttribute('role', 'status');
                banner.textContent = settings.announcement.text;
                Object.assign(banner.style, { padding: '10px 20px', textAlign: 'center', background: '#17466a', color: '#fff', font: '600 14px/1.5 system-ui, sans-serif' });
                document.body.prepend(banner);
            }
        } catch (_) { /* Nonessential presentation settings must not block sign-in. */ }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadPresentationSettings);
    else loadPresentationSettings();
})();
