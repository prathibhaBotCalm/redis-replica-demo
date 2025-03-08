import winston from 'winston';
import fs from 'fs';
import path from 'path';

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

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

// Define custom format for logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Define colorized format for console
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Configure file transports (one for each log level)
const fileTransports = [
  new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
  }),
  new winston.transports.File({
    filename: path.join(logsDir, 'warn.log'),
    level: 'warn',
  }),
  new winston.transports.File({
    filename: path.join(logsDir, 'info.log'),
    level: 'info',
  }),
  new winston.transports.File({
    filename: path.join(logsDir, 'http.log'),
    level: 'http',
  }),
  new winston.transports.File({
    filename: path.join(logsDir, 'debug.log'),
    level: 'debug',
  }),
  new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
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
    }),
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
});

/**
 * Format a log message with additional metadata
 */
function formatMessage(message: string, meta: any[]): string {
  if (meta.length === 0) {
    return message;
  }

  // Handle special case where there's just one error object
  if (meta.length === 1 && meta[0] instanceof Error) {
    return `${message} ${meta[0].stack || meta[0].message}`;
  }

  // Format additional arguments
  const formattedMeta = meta
    .map((item) => {
      if (item instanceof Error) {
        return item.stack || item.message;
      } else if (typeof item === 'object') {
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
  info(`PERFORMANCE: ${operation} completed in ${durationMs.toFixed(2)}ms`, {
    ...metadata,
    duration: durationMs,
    operation,
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
  info(`AUDIT: ${action} by ${actor} on ${target} - ${result}`, {
    ...metadata,
    audit: true,
    action,
    actor,
    target,
    result,
    timestamp: new Date().toISOString(),
  });
}

// Implement a very basic log rotation mechanism
function setupLogRotation() {
  // Run once per day at midnight
  const now = new Date();
  const night = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0
  );
  const timeToMidnight = night.getTime() - now.getTime();

  setTimeout(() => {
    // Create dated backup of each log file
    const date = new Date().toISOString().split('T')[0];
    const logFiles = [
      'error.log',
      'warn.log',
      'info.log',
      'http.log',
      'debug.log',
      'combined.log',
      'exceptions.log',
    ];

    logFiles.forEach((file) => {
      const filePath = path.join(logsDir, file);
      const backupPath = path.join(logsDir, `${file}.${date}`);

      if (fs.existsSync(filePath)) {
        // Check if file has content before rotating
        const stats = fs.statSync(filePath);
        if (stats.size > 0) {
          try {
            fs.copyFileSync(filePath, backupPath);
            fs.truncateSync(filePath);
          } catch (err) {
            console.error(`Failed to rotate log file ${file}:`, err);
          }
        }
      }
    });

    // Setup next rotation
    setupLogRotation();
  }, timeToMidnight);
}

// Start log rotation
setupLogRotation();

// Export a default logger instance
export default logger;
