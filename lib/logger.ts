import winston from 'winston';

// Define log levels
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
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'info';
};

// Define custom format for logs
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Define which transports to use based on environment
const transports = [
  // Always log to console
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      format
    ),
  }),

  // In production, also log to file
  ...(process.env.NODE_ENV === 'production'
    ? [
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
        }),
        new winston.transports.File({ filename: 'logs/all.log' }),
      ]
    : []),
];

// Create the logger instance
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
});

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
      if (typeof item === 'object') {
        try {
          return JSON.stringify(item);
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

// Export a default logger instance
export default logger;
