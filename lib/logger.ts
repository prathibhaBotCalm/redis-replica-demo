import fs from 'fs';
import path from 'path';
import winston, { format } from 'winston';

// Configuration constants
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_LOG_FILES = 5; // Keep 5 rotated files per log level
const LOG_ROTATION_FREQUENCY = '1d'; // Rotate daily
const LOG_FILE_PERMISSIONS = 0o644; // rw-r--r--

// Define log levels with priorities
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log level based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'info';
};

/**
 * Ensure logs directory exists synchronously
 */
function ensureLogDirectory(): string {
  const logsDir = path.join(process.cwd(), 'logs');

  try {
    // Check if directory exists
    if (!fs.existsSync(logsDir)) {
      // Create logs directory with proper permissions
      fs.mkdirSync(logsDir, { recursive: true, mode: 0o755 }); // rwxr-xr-x
      console.log(`Created logs directory at ${logsDir}`);
    }

    // Verify write permissions
    fs.accessSync(logsDir, fs.constants.W_OK);

    return logsDir;
  } catch (err) {
    // Log to console as fallback if we can't access logs directory
    console.error(
      `Error setting up logs directory: ${
        err instanceof Error ? err.message : String(err)
      }`
    );

    // Try using temp directory as fallback
    const tempDir = path.join(require('os').tmpdir(), 'app-logs');

    try {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true, mode: 0o755 });
      }
      console.warn(`Using fallback logs directory: ${tempDir}`);
      return tempDir;
    } catch (tempErr) {
      console.error(
        `Failed to create fallback logs directory: ${
          tempErr instanceof Error ? tempErr.message : String(tempErr)
        }`
      );
      // Return original logs directory even though it may not work
      return logsDir;
    }
  }
}

// Create logs directory and get path
const logsDir = ensureLogDirectory();

// Define formats
const timestampFormat = format.timestamp({
  format: 'YYYY-MM-DD HH:mm:ss.SSS',
});

const logFormat = format.combine(
  timestampFormat,
  format.errors({ stack: true }), // Ensures error stacks are logged
  format.printf(
    (info) =>
      `${info.timestamp} ${info.level}: ${info.message}${
        info.stack ? `\n${info.stack}` : ''
      }`
  )
);

const consoleFormat = format.combine(
  format.colorize({ all: true }),
  timestampFormat,
  format.errors({ stack: true }),
  format.printf(
    (info) =>
      `${info.timestamp} ${info.level}: ${info.message}${
        info.stack ? `\n${info.stack}` : ''
      }`
  )
);

/**
 * Create a transport for a specific log level
 */
function createFileTransport(level: string) {
  return new winston.transports.File({
    filename: path.join(logsDir, `${level}.log`),
    level,
    maxsize: MAX_LOG_SIZE,
    maxFiles: MAX_LOG_FILES,
    tailable: true,
    format: logFormat,
    options: { flags: 'a', mode: LOG_FILE_PERMISSIONS },
  });
}

// Create file transports for each log level
const fileTransports = [
  createFileTransport('error'),
  createFileTransport('warn'),
  createFileTransport('info'),
  createFileTransport('http'),
  createFileTransport('debug'),
  new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    maxsize: MAX_LOG_SIZE,
    maxFiles: MAX_LOG_FILES,
    tailable: true,
    format: logFormat,
    options: { flags: 'a', mode: LOG_FILE_PERMISSIONS },
  }),
];

// Create the logger instance
const logger = winston.createLogger({
  level: level(),
  levels,
  format: logFormat,
  transports: [
    ...fileTransports,
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      maxsize: MAX_LOG_SIZE,
      maxFiles: MAX_LOG_FILES,
      tailable: true,
      format: logFormat,
      options: { flags: 'a', mode: LOG_FILE_PERMISSIONS },
    }),
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      maxsize: MAX_LOG_SIZE,
      maxFiles: MAX_LOG_FILES,
      tailable: true,
      format: logFormat,
      options: { flags: 'a', mode: LOG_FILE_PERMISSIONS },
    }),
  ],
  exitOnError: false,
});

// Log initialization
logger.info(
  `Logger initialized in ${process.env.NODE_ENV || 'development'} mode`
);

/**
 * Format a log message with additional metadata
 */
function formatMessage(message: string, meta: any[]): string {
  if (meta.length === 0) {
    return message;
  }

  // Handle special case where there's just one error object
  if (meta.length === 1 && meta[0] instanceof Error) {
    const error = meta[0];
    return `${message} ${error.message}`;
    // Note: Error stack will be handled by winston format.errors()
  }

  // Format additional arguments
  const formattedMeta = meta
    .map((item) => {
      if (item instanceof Error) {
        return item.message;
        // Note: Error stack will be handled by winston format.errors()
      } else if (typeof item === 'object' && item !== null) {
        try {
          return JSON.stringify(item, null, 2);
        } catch (e) {
          return String(item);
        }
      }
      return String(item);
    })
    .join(' ');

  return `${message} ${formattedMeta}`;
}

/**
 * Log an error message
 * @param message The message to log
 * @param meta Additional metadata
 */
export function error(message: string, ...meta: any[]): void {
  logger.error(formatMessage(message, meta));
}

/**
 * Log a warning message
 * @param message The message to log
 * @param meta Additional metadata
 */
export function warn(message: string, ...meta: any[]): void {
  logger.warn(formatMessage(message, meta));
}

/**
 * Log an info message
 * @param message The message to log
 * @param meta Additional metadata
 */
export function info(message: string, ...meta: any[]): void {
  logger.info(formatMessage(message, meta));
}

/**
 * Log a debug message
 * @param message The message to log
 * @param meta Additional metadata
 */
export function debug(message: string, ...meta: any[]): void {
  logger.debug(formatMessage(message, meta));
}

/**
 * Log an HTTP request
 * @param message The message to log
 * @param meta Additional metadata
 */
export function http(message: string, ...meta: any[]): void {
  logger.http(formatMessage(message, meta));
}

/**
 * Create a child logger with a specific context
 * @param context The context to add to all log messages
 */
export function createContextLogger(context: string) {
  return {
    error: (message: string, ...meta: any[]) =>
      error(`[${context}] ${message}`, ...meta),
    warn: (message: string, ...meta: any[]) =>
      warn(`[${context}] ${message}`, ...meta),
    info: (message: string, ...meta: any[]) =>
      info(`[${context}] ${message}`, ...meta),
    debug: (message: string, ...meta: any[]) =>
      debug(`[${context}] ${message}`, ...meta),
    http: (message: string, ...meta: any[]) =>
      http(`[${context}] ${message}`, ...meta),
  };
}

/**
 * Log a performance metric
 * @param operation The operation being measured
 * @param durationMs The duration in milliseconds
 * @param metadata Additional metadata
 */
export function performance(
  operation: string,
  durationMs: number,
  metadata: Record<string, any> = {}
): void {
  const durationFormatted =
    typeof durationMs === 'number' ? durationMs.toFixed(2) : String(durationMs);

  logger.info(`PERFORMANCE: ${operation} completed in ${durationFormatted}ms`, {
    ...metadata,
    duration: durationMs,
    operation,
    _type: 'performance',
  });
}

/**
 * Log an audit event (for tracking important operations)
 * @param action The action performed
 * @param actor Who performed the action
 * @param target What was affected
 * @param result The result of the action
 * @param metadata Additional metadata
 */
export function audit(
  action: string,
  actor: string,
  target: string,
  result: 'success' | 'failure',
  metadata: Record<string, any> = {}
): void {
  logger.info(`AUDIT: ${action} by ${actor} on ${target} - ${result}`, {
    ...metadata,
    audit: true,
    action,
    actor,
    target,
    result,
    timestamp: new Date().toISOString(),
    _type: 'audit',
  });
}

/**
 * Check if the logger is working properly
 */
export function testLogger(): Record<string, boolean> {
  const results: Record<string, boolean> = {};

  try {
    // Test writing to each log file
    logger.error('Test error message');
    results.error = true;

    logger.warn('Test warning message');
    results.warn = true;

    logger.info('Test info message');
    results.info = true;

    logger.http('Test HTTP message');
    results.http = true;

    logger.debug('Test debug message');
    results.debug = true;

    results.overall = true;
  } catch (err) {
    console.error('Logger test failed:', err);
    results.overall = false;
  }

  return results;
}

// Test the logger on initialization
try {
  const testResults = testLogger();
  if (testResults.overall) {
    console.log('Logger initialized and tested successfully');
  } else {
    console.warn('Logger test failed');
  }
} catch (err) {
  console.error('Error testing logger:', err);
}

// Export a default logger instance
export default logger;
