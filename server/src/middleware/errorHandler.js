/**
 * Centralized Error Handler
 * Structured error handling with error codes
 */

const { logger } = require('../services/logger');

// Error codes for frontend handling
const ErrorCodes = {
    // Authentication errors (1xxx)
    AUTH_REQUIRED: { code: 1001, status: 401, message: 'Yetkilendirme gerekli' },
    AUTH_INVALID_TOKEN: { code: 1002, status: 401, message: 'Geçersiz token' },
    AUTH_EXPIRED: { code: 1003, status: 401, message: 'Oturum süresi doldu' },
    AUTH_FAILED: { code: 1004, status: 401, message: 'Geçersiz email veya şifre' },

    // Authorization errors (2xxx)
    FORBIDDEN: { code: 2001, status: 403, message: 'Bu işlem için yetkiniz yok' },
    LIMIT_EXCEEDED: { code: 2002, status: 403, message: 'Limit aşıldı' },
    PLAN_LIMIT: { code: 2003, status: 403, message: 'Plan limitleri aşıldı' },

    // Validation errors (3xxx)
    VALIDATION_ERROR: { code: 3001, status: 400, message: 'Geçersiz veri' },
    MISSING_FIELD: { code: 3002, status: 400, message: 'Zorunlu alan eksik' },
    INVALID_FORMAT: { code: 3003, status: 400, message: 'Geçersiz format' },

    // Resource errors (4xxx)
    NOT_FOUND: { code: 4001, status: 404, message: 'Kaynak bulunamadı' },
    USER_NOT_FOUND: { code: 4002, status: 404, message: 'Kullanıcı bulunamadı' },
    CALENDAR_NOT_FOUND: { code: 4003, status: 404, message: 'Takvim bulunamadı' },
    ALREADY_EXISTS: { code: 4004, status: 400, message: 'Bu kayıt zaten mevcut' },

    // Server errors (5xxx)
    INTERNAL_ERROR: { code: 5001, status: 500, message: 'Sunucu hatası' },
    DATABASE_ERROR: { code: 5002, status: 500, message: 'Veritabanı hatası' },
    EXTERNAL_SERVICE: { code: 5003, status: 502, message: 'Harici servis hatası' },

    // Rate limiting (6xxx)
    RATE_LIMITED: { code: 6001, status: 429, message: 'Çok fazla istek. Lütfen bekleyin.' }
};

/**
 * Custom Application Error
 */
class AppError extends Error {
    constructor(errorType, details = null, originalError = null) {
        const errorInfo = ErrorCodes[errorType] || ErrorCodes.INTERNAL_ERROR;

        super(errorInfo.message);

        this.name = 'AppError';
        this.code = errorInfo.code;
        this.status = errorInfo.status;
        this.type = errorType;
        this.details = details;
        this.originalError = originalError;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            error: this.message,
            code: this.code,
            type: this.type,
            details: this.details
        };
    }
}

/**
 * Error handler middleware
 */
function errorHandler(err, req, res, next) {
    // Get request ID for logging
    const requestId = req.requestId || 'unknown';

    // Determine if this is an operational error
    const isOperational = err instanceof AppError;

    // Log the error
    const logData = {
        requestId,
        errorType: err.type || 'UNHANDLED',
        errorCode: err.code,
        message: err.message,
        path: req.path,
        method: req.method,
        userId: req.userId
    };

    if (!isOperational) {
        // Log full stack for unexpected errors
        logData.stack = err.stack;
        logger.error('Unexpected error', logData);
    } else if (err.status >= 500) {
        logger.error('Server error', logData);
    } else if (err.status >= 400) {
        logger.warn('Client error', logData);
    }

    // Prepare response
    const response = {
        error: isOperational ? err.message : 'Sunucu hatası',
        code: isOperational ? err.code : 5001,
        type: isOperational ? err.type : 'INTERNAL_ERROR'
    };

    // Add details if present
    if (isOperational && err.details) {
        response.details = err.details;
    }

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development' && err.stack) {
        response.stack = err.stack;
    }

    // Add request ID for tracking
    response.requestId = requestId;

    // Send response
    res.status(isOperational ? err.status : 500).json(response);
}

/**
 * 404 handler for unknown routes
 */
function notFoundHandler(req, res, next) {
    const error = new AppError('NOT_FOUND', { path: req.path });
    next(error);
}

/**
 * Async handler wrapper to catch promise rejections
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = {
    AppError,
    ErrorCodes,
    errorHandler,
    notFoundHandler,
    asyncHandler
};
