/**
 * Med Shifter API Server
 * Supabase Edition
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Services
const { logger, httpLogger } = require('./services/logger');

// Middleware
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Routes
const authRoutes = require('./routes/auth');
const calendarRoutes = require('./routes/calendars');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');
const aiRoutes = require('./routes/ai');
const checkoutRoutes = require('./routes/checkout');

// Initialize
const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy (behind Nginx reverse proxy)
app.set('trust proxy', 1);

// Supabase Admin Client (service_role for backend operations)
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Basic Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({
    origin: process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://medshifter.app' : '*'),
    credentials: true
}));

// HTTP logging middleware
app.use(httpLogger);

// ============================================
// Rate Limiting Configuration
// ============================================

// General API rate limiter
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: {
        error: 'Çok fazla istek. Lütfen biraz bekleyin.',
        code: 6001,
        type: 'RATE_LIMITED'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Limiter for calendar creation
const createCalendarLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: {
        error: 'Çok fazla takvim oluşturuldu. 1 saat sonra tekrar deneyin.',
        code: 6001,
        type: 'RATE_LIMITED'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Apply general limiter to all API routes
app.use('/api/', generalLimiter);
app.post('/api/calendars', createCalendarLimiter);

// Make supabaseAdmin available to routes
app.use((req, res, next) => {
    req.supabaseAdmin = supabaseAdmin;
    next();
});

// ============================================
// Routes
// ============================================
app.use('/api/auth', authRoutes);
app.use('/api/calendars', calendarRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/ai', aiRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '2.0.0'
    });
});

// ============================================
// Error Handling
// ============================================
app.use(notFoundHandler);
app.use(errorHandler);

// ============================================
// Server Startup
// ============================================
app.listen(PORT, () => {
    logger.info(`🚀 Med Shifter API running on port ${PORT}`, {
        environment: process.env.NODE_ENV || 'development',
        port: PORT
    });

    // Security warnings
    if (!process.env.ADMIN_JWT_SECRET) {
        logger.warn('⚠️  ADMIN_JWT_SECRET is not set — using predictable fallback. Set it in .env for production!');
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Shutting down gracefully...');
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', { reason: String(reason) });
});
