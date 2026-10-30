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
        SUPABASE_ANON_KEY: 'sb_publishable_kyWsRMP18mnauJXSAaXA7A_-mRU8lCw'
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
})();
