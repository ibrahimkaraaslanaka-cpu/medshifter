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
        SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhrb2ljaWttd2JrYm13eGJweHRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NDUwOTcsImV4cCI6MjA4NjEyMTA5N30.B0nl_WAWWWeHvgEqu9TBwVbDWgxq1MUzw18ozp0hUA8'
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
