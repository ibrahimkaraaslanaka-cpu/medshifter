/**
 * Logger Service
 * Winston-based structured logging
 */

const winston = require('winston');
const path = require('path');

// Log levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4
};

// Colors for console output
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'blue'
};

winston.addColors(colors);

// Format for logs
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Console format (colored for development)
const consoleFormat = winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, requestId, ...meta }) => {
        const reqIdStr = requestId ? ` [${requestId}]` : '';
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level}${reqIdStr}: ${message}${metaStr}`;
    })
);

// Determine log level based on environment
const level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

// Create logs directory path
const logsDir = path.join(__dirname, '../../logs');

// Create logger instance
const logger = winston.createLogger({
    level,
    levels,
    format: logFormat,
    defaultMeta: { service: 'med-shifter-api' },
    transports: [
        // Console transport
        new winston.transports.Console({
            format: consoleFormat
        }),
        // File transport for errors
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        // File transport for all logs
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5
        })
    ]
});

// Create child logger with request ID
function createRequestLogger(requestId) {
    return logger.child({ requestId });
}

// HTTP request logging middleware
function httpLogger(req, res, next) {
    const start = Date.now();

    // Generate request ID
    req.requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    req.logger = createRequestLogger(req.requestId);

    // Log on response finish
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('user-agent')
        };

        if (req.userId) {
            logData.userId = req.userId;
        }

        // Log level based on status code
        if (res.statusCode >= 500) {
            logger.error('Request completed', { requestId: req.requestId, ...logData });
        } else if (res.statusCode >= 400) {
            logger.warn('Request completed', { requestId: req.requestId, ...logData });
        } else {
            logger.http('Request completed', { requestId: req.requestId, ...logData });
        }
    });

    next();
}

module.exports = {
    logger,
    httpLogger,
    createRequestLogger
};
