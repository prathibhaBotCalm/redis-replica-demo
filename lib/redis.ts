// import { MasterInfo, RedisConfiguration } from '@/types/redis.types';
// import Redis, { RedisOptions, SentinelAddress } from 'ioredis';
// import { Client } from 'redis-om';
// import * as baseLogger from './logger';

// const logger = baseLogger.createContextLogger('Redis');

// // Configuration constants
// const DEFAULT_PORT = 6379;
// const DEFAULT_MASTER_NAME = 'mymaster';
// const DEFAULT_MASTER_CHECK_INTERVAL_MS = 5000;
// const DEFAULT_CONNECTION_TIMEOUT_MS = 30000;
// const DEFAULT_RECONNECT_MAX_RETRIES = 5;
// const DEFAULT_EXPONENTIAL_BACKOFF_BASE_MS = 500;
// const DEFAULT_SENTINEL_CONNECT_TIMEOUT_MS = 2000;
// const DEFAULT_CLIENT_READY_TIMEOUT_MS = 5000;

// // Connection state management
// let redisClient: Redis | null = null;
// let redisOmClient: Client | null = null;
// let isRedisOmConnected = false;
// let currentMasterInfo: MasterInfo | null = null;
// let failoverInProgress = false;
// let connectionTimeout: NodeJS.Timeout | null = null;
// let eventHandlersRegistered = false;
// let config: RedisConfiguration;

// /**
//  * Helper function to parse Redis Sentinel addresses
//  */
// function parseSentinels(sentinelsString: string): SentinelAddress[] {
//   if (!sentinelsString) return [];

//   return sentinelsString
//     .split(',')
//     .map((sentinel) => {
//       const [host, port] = sentinel.split(':');
//       if (!host || !port) return null;
//       return { host: host.trim(), port: parseInt(port.trim(), 10) };
//     })
//     .filter((sentinel): sentinel is SentinelAddress => sentinel !== null);
// }

// /**
//  * Load Redis configuration from environment variables
//  */
// function loadRedisConfig(): RedisConfiguration {
//   const isDev = process.env.IS_DEV === 'true';

//   const sentinelsString = isDev
//     ? process.env.REDIS_SENTINELS_DEV
//     : process.env.REDIS_SENTINELS_PROD;

//   const sentinels = sentinelsString ? parseSentinels(sentinelsString) : [];

//   const directHost = isDev
//     ? process.env.REDIS_HOST_DEV || 'localhost'
//     : process.env.REDIS_HOST_PROD || 'redis-master';

//   const directPort = parseInt(process.env.REDIS_PORT || `${DEFAULT_PORT}`, 10);
//   const masterName = process.env.REDIS_MASTER_NAME || DEFAULT_MASTER_NAME;
//   const password = process.env.REDIS_PASSWORD;
//   const sentinelPassword = process.env.REDIS_SENTINEL_PASSWORD || password;
//   const masterCheckIntervalMs = parseInt(
//     process.env.MASTER_CHECK_INTERVAL_MS ||
//       `${DEFAULT_MASTER_CHECK_INTERVAL_MS}`,
//     10
//   );
//   const connectionTimeoutMs = parseInt(
//     process.env.CONNECTION_TIMEOUT_MS || `${DEFAULT_CONNECTION_TIMEOUT_MS}`,
//     10
//   );
//   const maxRetries = parseInt(
//     process.env.REDIS_MAX_RETRIES || `${DEFAULT_RECONNECT_MAX_RETRIES}`,
//     10
//   );

//   // Determine if we should use direct connection
//   // Use direct connection in dev mode or if no sentinels are configured
//   const useDirectConnection = isDev || sentinels.length === 0;

//   return {
//     sentinels,
//     directHost,
//     directPort,
//     masterName,
//     password,
//     sentinelPassword,
//     useDirectConnection,
//     masterCheckIntervalMs,
//     connectionTimeoutMs,
//     maxRetries,
//   };
// }

// /**
//  * Create a Redis client options object
//  */
// function createRedisOptions(direct: boolean): RedisOptions {
//   const baseOptions: RedisOptions = {
//     password: config.password,
//     maxRetriesPerRequest: 3,
//     enableReadyCheck: true,
//     connectionName: 'app-connection',
//     retryStrategy: (times: number) =>
//       times > 10 ? null : Math.min(times * 100, 3000),
//   };

//   if (direct) {
//     return {
//       ...baseOptions,
//       host: config.directHost,
//       port: config.directPort,
//     };
//   } else {
//     return {
//       ...baseOptions,
//       sentinels: config.sentinels,
//       name: config.masterName,
//       sentinelPassword: config.sentinelPassword,
//       sentinelRetryStrategy: (times: number) => Math.min(times * 500, 5000),
//       reconnectOnError: (err: Error) => {
//         return shouldReconnectOnError(err);
//       },
//     };
//   }
// }

// /**
//  * Check if we should reconnect based on error message
//  */
// function shouldReconnectOnError(err: Error): boolean {
//   if (err.message.includes('READONLY')) {
//     logger.warn('READONLY error detected, reconnecting...');
//     triggerReconnection();
//     return true;
//   }
//   return false;
// }

// /**
//  * Create Redis client
//  */
// function createRedisClient(): Redis {
//   const useDirectConnection = config.useDirectConnection;

//   logger.info(
//     useDirectConnection
//       ? `Using direct Redis connection to ${config.directHost}:${config.directPort}`
//       : `Using Redis Sentinel connection with master: ${config.masterName}`
//   );

//   return new Redis(createRedisOptions(useDirectConnection));
// }

// /**
//  * Initialize Redis client with event listeners
//  */
// function initializeRedisClient(): Redis {
//   // Clean up existing client if necessary
//   if (redisClient) {
//     try {
//       redisClient.disconnect();
//     } catch (err) {
//       // Ignore errors on disconnect
//     }
//   }

//   // Create new client
//   redisClient = createRedisClient();

//   // Register event handlers if not already done
//   if (!eventHandlersRegistered) {
//     registerEventHandlers(redisClient);
//     eventHandlersRegistered = true;
//   }

//   return redisClient;
// }

// /**
//  * Register all event handlers for Redis client
//  */
// function registerEventHandlers(client: Redis): void {
//   // Basic connection events
//   client.on('error', handleRedisError);
//   client.on('connect', () =>
//     logger.info('Redis client connected successfully')
//   );
//   client.on('ready', () => logger.info('Redis client is ready'));
//   client.on('reconnecting', () => logger.info('Reconnecting to Redis...'));
//   client.on('end', () => logger.info('Redis connection ended'));

//   // Sentinel-specific events only if using sentinel
//   if (!config.useDirectConnection) {
//     client.on('+switch-master', handleSwitchMaster);
//     client.on('+sentinel', (sentinel, reason) => {
//       logger.info(`New sentinel discovered: ${sentinel}, reason: ${reason}`);
//     });
//     client.on('-sentinel', (sentinel, reason) => {
//       logger.warn(`Sentinel removed: ${sentinel}, reason: ${reason}`);
//     });
//     client.on('+slave', (slave) => {
//       logger.info(`New replica detected: ${slave}`);
//     });
//     client.on('-slave', (slave, reason) => {
//       logger.warn(`Replica removed: ${slave}, reason: ${reason}`);
//     });
//   }
// }

// /**
//  * Handle Redis client errors
//  */
// function handleRedisError(err: Error): void {
//   logger.error('Redis client error:', err);
//   if (
//     err.message.includes('ECONNREFUSED') ||
//     err.message.includes('ETIMEDOUT') ||
//     err.message.includes('ENOTFOUND')
//   ) {
//     triggerReconnection();
//   }
// }

// /**
//  * Handle Sentinel switch-master event
//  */
// function handleSwitchMaster(
//   master: string,
//   oldHost: string,
//   oldPort: string,
//   newHost: string,
//   newPort: string
// ): void {
//   if (master === config.masterName) {
//     logger.info(
//       `Switch to new master detected: ${newHost}:${newPort} (was ${oldHost}:${oldPort})`
//     );

//     const port = parseInt(newPort, 10);

//     // Update current master info
//     currentMasterInfo = {
//       host: newHost,
//       port: port,
//       lastChecked: Date.now(),
//     };

//     // Trigger reconnection to new master
//     triggerReconnection();
//   }
// }

// /**
//  * Helper function to get current master from Sentinel setup with improved error handling
//  */
// async function getCurrentMaster(): Promise<MasterInfo> {
//   // Use direct connection if configured
//   if (config.useDirectConnection) {
//     return {
//       host: config.directHost,
//       port: config.directPort,
//       lastChecked: Date.now(),
//     };
//   }

//   // Check if cached master info is still fresh
//   const now = Date.now();
//   if (
//     currentMasterInfo &&
//     now - currentMasterInfo.lastChecked < config.masterCheckIntervalMs
//   ) {
//     return currentMasterInfo;
//   }

//   // Initialize an array to collect errors for better diagnostics
//   const errors: Error[] = [];

//   // Try each sentinel in order
//   for (const sentinel of config.sentinels) {
//     let sentinelClient: Redis | null = null;

//     try {
//       // Connect to sentinel with timeout
//       sentinelClient = new Redis({
//         host: sentinel.host,
//         port: sentinel.port,
//         password: config.sentinelPassword,
//         connectTimeout: DEFAULT_SENTINEL_CONNECT_TIMEOUT_MS,
//       });

//       // Query sentinel for master address with timeout
//       const result = (await Promise.race([
//         sentinelClient.call(
//           'SENTINEL',
//           'get-master-addr-by-name',
//           config.masterName
//         ),
//         new Promise<never>((_, reject) =>
//           setTimeout(
//             () => reject(new Error('Sentinel query timeout')),
//             DEFAULT_SENTINEL_CONNECT_TIMEOUT_MS
//           )
//         ),
//       ])) as string[];

//       // Validate result
//       if (Array.isArray(result) && result.length === 2) {
//         const host = result[0];
//         const port = parseInt(result[1], 10);

//         logger.info(`Current master from Sentinel: ${host}:${port}`);

//         // Create and cache master info
//         const masterInfo = { host, port, lastChecked: now };
//         currentMasterInfo = masterInfo;

//         // Clean up sentinel client
//         if (sentinelClient) {
//           await sentinelClient.disconnect();
//         }

//         return masterInfo;
//       }

//       // Clean up sentinel client if result was invalid
//       if (sentinelClient) {
//         await sentinelClient.disconnect();
//       }

//       errors.push(
//         new Error(
//           `Invalid response from sentinel ${sentinel.host}:${sentinel.port}`
//         )
//       );
//     } catch (err) {
//       errors.push(err as Error);
//       logger.warn(
//         `Failed to get master from sentinel ${sentinel.host}:${sentinel.port}:`,
//         err
//       );

//       // Clean up sentinel client on error
//       if (sentinelClient) {
//         try {
//           await sentinelClient.disconnect();
//         } catch (discErr) {
//           // Ignore disconnect errors
//         }
//       }
//     }
//   }

//   logger.warn(
//     `All sentinel queries failed: ${errors.map((e) => e.message).join('; ')}`
//   );
//   logger.warn('Using fallback connection');

//   // If all sentinels fail, use cached master or fallback to direct connection
//   return (
//     currentMasterInfo || {
//       host: config.directHost,
//       port: config.directPort,
//       lastChecked: now,
//     }
//   );
// }

// /**
//  * Check if Redis master has changed
//  */
// async function hasMasterChanged(): Promise<boolean> {
//   // No master changes in direct connection mode
//   if (config.useDirectConnection) return false;

//   // Skip check if failover is already in progress
//   if (failoverInProgress) return false;

//   // Skip check if we checked recently
//   const now = Date.now();
//   if (
//     currentMasterInfo &&
//     now - currentMasterInfo.lastChecked < config.masterCheckIntervalMs
//   ) {
//     return false;
//   }

//   try {
//     // Get current master address
//     const currentMaster = await getCurrentMaster();

//     // Auto-detect changes if client doesn't exist
//     if (!redisClient) return true;
//     if (redisClient.status !== 'ready') return true;

//     // Get client's current connection info
//     const connInfo = {
//       host: redisClient.options.host || '',
//       port: redisClient.options.port || 0,
//     };

//     // Check if connection details have changed
//     if (
//       connInfo.host !== currentMaster.host ||
//       connInfo.port !== currentMaster.port
//     ) {
//       logger.info(
//         `Master changed from ${connInfo.host}:${connInfo.port} to ${currentMaster.host}:${currentMaster.port}`
//       );
//       return true;
//     }

//     return false;
//   } catch (err) {
//     logger.error('Error checking master status:', err);
//     return false;
//   }
// }

// /**
//  * Trigger a reconnection of all clients with improved timeout handling
//  */
// function triggerReconnection(): void {
//   // Prevent duplicate reconnection requests
//   if (failoverInProgress) {
//     logger.info('Reconnection already in progress, skipping duplicate request');
//     return;
//   }

//   failoverInProgress = true;
//   isRedisOmConnected = false;

//   logger.info('Triggering reconnection to new master');

//   // Clear any existing timeout
//   if (connectionTimeout) {
//     clearTimeout(connectionTimeout);
//   }

//   // Set a timeout to prevent hanging if the reconnection process gets stuck
//   connectionTimeout = setTimeout(() => {
//     logger.warn('Reconnection process timed out, forcing a clean restart');
//     failoverInProgress = false;
//     // Force cleanup and retry
//     resetAllConnections();
//   }, config.connectionTimeoutMs);

//   // Start the reconnection process
//   reconnectToMaster().catch((err) => {
//     logger.error('Error during reconnection:', err);
//     failoverInProgress = false;

//     if (connectionTimeout) {
//       clearTimeout(connectionTimeout);
//       connectionTimeout = null;
//     }
//   });
// }

// /**
//  * Safely close all Redis connections
//  */
// async function resetAllConnections(): Promise<void> {
//   // Clear any existing timeout
//   if (connectionTimeout) {
//     clearTimeout(connectionTimeout);
//     connectionTimeout = null;
//   }

//   logger.info('Resetting all Redis connections');

//   // Track promise completion
//   const promises: Promise<void>[] = [];

//   // Close Redis OM client if it exists
//   if (redisOmClient) {
//     promises.push(
//       (async () => {
//         try {
//           if (redisOmClient && redisOmClient.isOpen()) {
//             await redisOmClient.close();
//           }
//         } catch (err) {
//           logger.error('Error closing Redis OM client:', err);
//         }
//       })()
//     );
//   }

//   // Close Redis client if it exists
//   if (redisClient) {
//     promises.push(
//       (async () => {
//         try {
//           if (redisClient) {
//             await redisClient.disconnect();
//           }
//         } catch (err) {
//           logger.error('Error disconnecting Redis client:', err);
//         }
//       })()
//     );
//   }

//   // Wait for all cleanup operations to complete with timeout
//   try {
//     await Promise.race([
//       Promise.all(promises),
//       new Promise<void>((_, reject) =>
//         setTimeout(() => reject(new Error('Connection reset timeout')), 5000)
//       ),
//     ]);
//   } catch (err) {
//     logger.warn('Timeout during connection reset, forcing cleanup:', err);
//   }

//   // Reset connection states
//   redisClient = null;
//   redisOmClient = null;
//   isRedisOmConnected = false;
//   failoverInProgress = false;
// }

// /**
//  * Wait for Redis client to be ready with improved promise handling
//  */
// function waitForRedisReady(): Promise<void> {
//   return new Promise((resolve, reject) => {
//     if (!redisClient) {
//       return reject(new Error('Redis client is null'));
//     }

//     // Immediately resolve if client is already ready
//     if (redisClient.status === 'ready') {
//       return resolve();
//     }

//     // Set up event handlers
//     const onReady = () => {
//       cleanup();
//       resolve();
//     };

//     const onError = (err: Error) => {
//       cleanup();
//       reject(err);
//     };

//     const onEnd = () => {
//       cleanup();
//       reject(new Error('Redis connection closed unexpectedly'));
//     };

//     // Cleanup function to remove event listeners
//     const cleanup = () => {
//       if (redisClient) {
//         redisClient.removeListener('ready', onReady);
//         redisClient.removeListener('error', onError);
//         redisClient.removeListener('end', onEnd);
//       }
//       clearTimeout(timeoutId);
//     };

//     // Register event handlers
//     redisClient.once('ready', onReady);
//     redisClient.once('error', onError);
//     redisClient.once('end', onEnd);

//     // Set a timeout to prevent hanging
//     const timeoutId = setTimeout(() => {
//       cleanup();
//       reject(
//         new Error(
//           `Timed out waiting for Redis client to be ready (${DEFAULT_CLIENT_READY_TIMEOUT_MS}ms)`
//         )
//       );
//     }, DEFAULT_CLIENT_READY_TIMEOUT_MS);
//   });
// }

// /**
//  * Reconnect to the current master
//  */
// async function reconnectToMaster(): Promise<void> {
//   try {
//     logger.info('Starting reconnection to master');

//     // Step 1: Clean up existing connections
//     await resetAllConnections();

//     // Step 2: Get current master address
//     await getCurrentMaster();

//     // Step 3: Initialize a new Redis client and wait for it to be ready
//     redisClient = initializeRedisClient();
//     await waitForRedisReady();

//     // Step 4: Initialize a new Redis OM client
//     await connectRedisOmClient(true);

//     logger.info('Successfully reconnected to master');
//   } catch (err) {
//     logger.error('Failed to reconnect to master:', err);
//     throw err;
//   } finally {
//     // Reset connection state
//     failoverInProgress = false;

//     // Clear any existing timeout
//     if (connectionTimeout) {
//       clearTimeout(connectionTimeout);
//       connectionTimeout = null;
//     }
//   }
// }

// /**
//  * Connect Redis-OM client with improved error handling and connection verification
//  */
// export async function connectRedisOmClient(
//   forceReconnect = false
// ): Promise<void> {
//   // Check if reconnection is needed
//   if (!forceReconnect && isRedisOmConnected && redisOmClient?.isOpen()) {
//     // Check for master changes
//     const masterChanged = await hasMasterChanged();
//     if (!masterChanged) {
//       return; // No need to reconnect
//     }
//     logger.info('Master has changed, reconnecting Redis-OM client');
//   }

//   // Initialize Redis client if needed
//   if (!redisClient) {
//     redisClient = initializeRedisClient();
//     await waitForRedisReady();
//   }

//   // Close existing Redis-OM client if necessary
//   if (redisOmClient) {
//     try {
//       if (redisOmClient.isOpen()) {
//         await redisOmClient.close();
//       }
//     } catch (err) {
//       logger.warn('Error closing existing Redis-OM client:', err);
//     }
//   }

//   // Create a new Redis-OM client
//   redisOmClient = new Client();

//   // Retry connection with exponential backoff
//   let retries = config.maxRetries;
//   let lastError: Error | null = null;

//   while (retries > 0) {
//     try {
//       // Get current master info
//       const masterInfo = await getCurrentMaster();

//       // Build Redis URL
//       const redisUrl = config.password
//         ? `redis://:${encodeURIComponent(config.password)}@${masterInfo.host}:${
//             masterInfo.port
//           }`
//         : `redis://${masterInfo.host}:${masterInfo.port}`;

//       logger.info(
//         `Connecting Redis-OM to: ${redisUrl.replace(/:[^:]*@/, ':****@')}`
//       );

//       // Attempt connection with timeout
//       await Promise.race([
//         redisOmClient.open(redisUrl),
//         new Promise<never>((_, reject) =>
//           setTimeout(
//             () => reject(new Error('Redis-OM connection timeout')),
//             DEFAULT_CONNECTION_TIMEOUT_MS
//           )
//         ),
//       ]);

//       // Verify connection is open
//       if (!redisOmClient.isOpen()) {
//         throw new Error('Redis-OM client is not open after connection attempt');
//       }

//       // Update connection state
//       logger.info('Redis-OM client connected successfully');
//       isRedisOmConnected = true;
//       return;
//     } catch (err) {
//       lastError = err instanceof Error ? err : new Error(String(err));
//       logger.error('Failed to connect Redis-OM client:', lastError);
//       retries--;

//       if (retries === 0) {
//         break;
//       }

//       // Exponential backoff with jitter for retries
//       const baseDelay = Math.min(
//         Math.pow(2, config.maxRetries - retries) *
//           DEFAULT_EXPONENTIAL_BACKOFF_BASE_MS,
//         8000
//       );
//       const jitter = Math.random() * 500; // Add randomness to prevent thundering herd
//       const delay = baseDelay + jitter;

//       logger.info(
//         `Retrying in ${Math.round(delay)}ms... (${retries} retries left)`
//       );
//       await new Promise((resolve) => setTimeout(resolve, delay));
//     }
//   }

//   // If we've exhausted retries, throw the last error
//   throw (
//     lastError ||
//     new Error('Failed to connect Redis-OM client after multiple attempts')
//   );
// }

// /**
//  * Ensure connection to the current Redis master
//  */
// export async function ensureMasterConnection(): Promise<void> {
//   try {
//     // First check if master has changed
//     const masterChanged = await hasMasterChanged();

//     // Determine if reconnection is needed
//     if (masterChanged || !isRedisOmConnected || !redisOmClient?.isOpen()) {
//       logger.info('Master connection needs to be established or refreshed');

//       // Handle case where failover is already in progress
//       if (failoverInProgress) {
//         logger.info('Failover already in progress, waiting for completion');
//         // Wait a bit for the failover process to complete
//         await new Promise((resolve) => setTimeout(resolve, 1000));
//       } else {
//         // Trigger a full reconnection
//         await reconnectToMaster();
//       }
//     } else {
//       // Double-check connection with a ping
//       try {
//         if (redisClient) {
//           await Promise.race([
//             redisClient.ping(),
//             new Promise<never>((_, reject) =>
//               setTimeout(() => reject(new Error('Redis ping timeout')), 2000)
//             ),
//           ]);
//         } else {
//           // Redis client doesn't exist, reconnect
//           await reconnectToMaster();
//         }
//       } catch (pingErr) {
//         logger.warn('Redis ping failed, triggering reconnection:', pingErr);
//         await reconnectToMaster();
//       }
//     }

//     // Final validation
//     if (!redisClient || !redisOmClient || !redisOmClient.isOpen()) {
//       throw new Error(
//         'Redis connection validation failed after reconnection attempt'
//       );
//     }
//   } catch (err) {
//     logger.error('Failed to ensure master connection:', err);
//     // Reset connection state to allow future reconnection attempts
//     failoverInProgress = false;
//     throw err;
//   }
// }

// /**
//  * Initialize configuration and Redis client
//  */
// function initialize(): void {
//   // Load configuration
//   config = loadRedisConfig();

//   // Initialize Redis client
//   if (!redisClient) {
//     redisClient = initializeRedisClient();
//   }
// }

// // Initialize on module import
// initialize();

// // Export public APIs
// export { redisClient, redisOmClient };

import { MasterInfo, RedisConfiguration } from '@/types/redis.types';
import Redis, { RedisOptions, SentinelAddress } from 'ioredis';
import { Client } from 'redis-om';
import * as baseLogger from './logger';

const logger = baseLogger.createContextLogger('Redis');

// Configuration constants
const DEFAULT_PORT = 6379;
const DEFAULT_MASTER_NAME = 'mymaster';
const DEFAULT_MASTER_CHECK_INTERVAL_MS = 5000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 30000;
const DEFAULT_RECONNECT_MAX_RETRIES = 5;
const DEFAULT_EXPONENTIAL_BACKOFF_BASE_MS = 500;
const DEFAULT_SENTINEL_CONNECT_TIMEOUT_MS = 2000;
const DEFAULT_CLIENT_READY_TIMEOUT_MS = 5000;

// Detect build environment
const isBuildTime =
  process.env.NODE_ENV === 'production' &&
  process.env.NEXT_PHASE === 'phase-production-build';

// Connection state management
let client: Redis | null;
let redisOmClient: Client | null = null;
let isRedisOmConnected = false;
let currentMasterInfo: MasterInfo | null = null;
let failoverInProgress = false;
let connectionTimeout: NodeJS.Timeout | null = null;
let eventHandlersRegistered = false;
let config: RedisConfiguration;

/**
 * Helper function to parse Redis Sentinel addresses
 */
function parseSentinels(sentinelsString: string): SentinelAddress[] {
  if (!sentinelsString) return [];

  return sentinelsString
    .split(',')
    .map((sentinel) => {
      const [host, port] = sentinel.split(':');
      if (!host || !port) return null;
      return { host: host.trim(), port: parseInt(port.trim(), 10) };
    })
    .filter((sentinel): sentinel is SentinelAddress => sentinel !== null);
}

/**
 * Load Redis configuration from environment variables
 */
function loadRedisConfig(): RedisConfiguration {
  const isDev = process.env.NEXT_PUBLIC_ISDEV === 'true';

  const sentinelsString = isDev
    ? process.env.REDIS_SENTINELS_DEV
    : process.env.REDIS_SENTINELS_PROD;

  const sentinels = sentinelsString ? parseSentinels(sentinelsString) : [];

  const directHost = isDev
    ? process.env.REDIS_HOST_DEV || 'localhost'
    : process.env.REDIS_HOST_PROD || 'redis-master';

  const directPort = parseInt(process.env.REDIS_PORT || `${DEFAULT_PORT}`, 10);
  const masterName = process.env.REDIS_MASTER_NAME || DEFAULT_MASTER_NAME;
  const password = process.env.REDIS_PASSWORD;
  const sentinelPassword = process.env.REDIS_SENTINEL_PASSWORD || password;
  const masterCheckIntervalMs = parseInt(
    process.env.MASTER_CHECK_INTERVAL_MS ||
      `${DEFAULT_MASTER_CHECK_INTERVAL_MS}`,
    10
  );
  const connectionTimeoutMs = parseInt(
    process.env.CONNECTION_TIMEOUT_MS || `${DEFAULT_CONNECTION_TIMEOUT_MS}`,
    10
  );
  const maxRetries = parseInt(
    process.env.REDIS_MAX_RETRIES || `${DEFAULT_RECONNECT_MAX_RETRIES}`,
    10
  );

  // Determine if we should use direct connection
  // Use direct connection in dev mode or if no sentinels are configured
  const useDirectConnection = isDev || sentinels.length === 0;

  return {
    sentinels,
    directHost,
    directPort,
    masterName,
    password,
    sentinelPassword,
    useDirectConnection,
    masterCheckIntervalMs,
    connectionTimeoutMs,
    maxRetries,
  };
}

/**
 * Create a Redis client options object
 */
function createRedisOptions(direct: boolean): RedisOptions {
  const baseOptions: RedisOptions = {
    password: config.password,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectionName: 'app-connection',
    retryStrategy: (times: number) =>
      times > 10 ? null : Math.min(times * 100, 3000),
  };

  if (direct) {
    return {
      ...baseOptions,
      host: config.directHost,
      port: config.directPort,
    };
  } else {
    return {
      ...baseOptions,
      sentinels: config.sentinels,
      name: config.masterName,
      sentinelPassword: config.sentinelPassword,
      sentinelRetryStrategy: (times: number) => Math.min(times * 500, 5000),
      reconnectOnError: (err: Error) => {
        return shouldReconnectOnError(err);
      },
    };
  }
}

/**
 * Check if we should reconnect based on error message
 */
function shouldReconnectOnError(err: Error): boolean {
  if (err.message.includes('READONLY')) {
    logger.warn('READONLY error detected, reconnecting...');
    triggerReconnection();
    return true;
  }
  return false;
}

/**
 * Create Redis client
 */
function createRedisClient(): Redis | null {
  // Skip Redis connection during build time
  if (isBuildTime) {
    logger.info('Skipping Redis connection during build phase');
    return null;
  }

  const useDirectConnection = config.useDirectConnection;

  logger.info(
    useDirectConnection
      ? `Using direct Redis connection to ${config.directHost}:${config.directPort}`
      : `Using Redis Sentinel connection with master: ${config.masterName}`
  );

  return new Redis(createRedisOptions(useDirectConnection));
}

/**
 * Initialize Redis client with event listeners
 */
function initializeRedisClient(): Redis | null {
  // Skip Redis initialization during build time
  if (isBuildTime) {
    return null;
  }

  // Clean up existing client if necessary
  if (client) {
    try {
      client.disconnect();
    } catch (err) {
      // Ignore errors on disconnect
    }
  }

  // Create new client
  client = createRedisClient();

  // Register event handlers if client exists and handlers not already registered
  if (client && !eventHandlersRegistered) {
    registerEventHandlers(client);
    eventHandlersRegistered = true;
  }

  return client;
}

/**
 * Register all event handlers for Redis client
 */
function registerEventHandlers(client: Redis): void {
  // Basic connection events
  client.on('error', handleRedisError);
  client.on('connect', () =>
    logger.info('Redis client connected successfully')
  );
  client.on('ready', () => logger.info('Redis client is ready'));
  client.on('reconnecting', () => logger.info('Reconnecting to Redis...'));
  client.on('end', () => logger.info('Redis connection ended'));

  // Sentinel-specific events only if using sentinel
  if (!config.useDirectConnection) {
    client.on('+switch-master', handleSwitchMaster);
    client.on('+sentinel', (sentinel, reason) => {
      logger.info(`New sentinel discovered: ${sentinel}, reason: ${reason}`);
    });
    client.on('-sentinel', (sentinel, reason) => {
      logger.warn(`Sentinel removed: ${sentinel}, reason: ${reason}`);
    });
    client.on('+slave', (slave) => {
      logger.info(`New replica detected: ${slave}`);
    });
    client.on('-slave', (slave, reason) => {
      logger.warn(`Replica removed: ${slave}, reason: ${reason}`);
    });
  }
}

/**
 * Handle Redis client errors
 */
function handleRedisError(err: Error): void {
  logger.error('Redis client error:', err);
  if (
    err.message.includes('ECONNREFUSED') ||
    err.message.includes('ETIMEDOUT') ||
    err.message.includes('ENOTFOUND')
  ) {
    triggerReconnection();
  }
}

/**
 * Handle Sentinel switch-master event
 */
function handleSwitchMaster(
  master: string,
  oldHost: string,
  oldPort: string,
  newHost: string,
  newPort: string
): void {
  if (master === config.masterName) {
    logger.info(
      `Switch to new master detected: ${newHost}:${newPort} (was ${oldHost}:${oldPort})`
    );

    const port = parseInt(newPort, 10);

    // Update current master info
    currentMasterInfo = {
      host: newHost,
      port: port,
      lastChecked: Date.now(),
    };

    // Trigger reconnection to new master
    triggerReconnection();
  }
}

/**
 * Helper function to get current master from Sentinel setup with improved error handling
 */
async function getCurrentMaster(): Promise<MasterInfo> {
  // Skip for build time
  if (isBuildTime) {
    return {
      host: config.directHost,
      port: config.directPort,
      lastChecked: Date.now(),
    };
  }

  // Use direct connection if configured
  if (config.useDirectConnection) {
    return {
      host: config.directHost,
      port: config.directPort,
      lastChecked: Date.now(),
    };
  }

  // Check if cached master info is still fresh
  const now = Date.now();
  if (
    currentMasterInfo &&
    now - currentMasterInfo.lastChecked < config.masterCheckIntervalMs
  ) {
    return currentMasterInfo;
  }

  // Initialize an array to collect errors for better diagnostics
  const errors: Error[] = [];

  // Try each sentinel in order
  for (const sentinel of config.sentinels) {
    let sentinelClient: Redis | null = null;

    try {
      // Connect to sentinel with timeout
      sentinelClient = new Redis({
        host: sentinel.host,
        port: sentinel.port,
        password: config.sentinelPassword,
        connectTimeout: DEFAULT_SENTINEL_CONNECT_TIMEOUT_MS,
      });

      // Query sentinel for master address with timeout
      const result = (await Promise.race([
        sentinelClient.call(
          'SENTINEL',
          'get-master-addr-by-name',
          config.masterName
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Sentinel query timeout')),
            DEFAULT_SENTINEL_CONNECT_TIMEOUT_MS
          )
        ),
      ])) as string[];

      // Validate result
      if (Array.isArray(result) && result.length === 2) {
        const host = result[0];
        const port = parseInt(result[1], 10);

        logger.info(`Current master from Sentinel: ${host}:${port}`);

        // Create and cache master info
        const masterInfo = { host, port, lastChecked: now };
        currentMasterInfo = masterInfo;

        // Clean up sentinel client
        if (sentinelClient) {
          await sentinelClient.disconnect();
        }

        return masterInfo;
      }

      // Clean up sentinel client if result was invalid
      if (sentinelClient) {
        await sentinelClient.disconnect();
      }

      errors.push(
        new Error(
          `Invalid response from sentinel ${sentinel.host}:${sentinel.port}`
        )
      );
    } catch (err) {
      errors.push(err as Error);
      logger.warn(
        `Failed to get master from sentinel ${sentinel.host}:${sentinel.port}:`,
        err
      );

      // Clean up sentinel client on error
      if (sentinelClient) {
        try {
          await sentinelClient.disconnect();
        } catch (discErr) {
          // Ignore disconnect errors
        }
      }
    }
  }

  logger.warn(
    `All sentinel queries failed: ${errors.map((e) => e.message).join('; ')}`
  );
  logger.warn('Using fallback connection');

  // If all sentinels fail, use cached master or fallback to direct connection
  return (
    currentMasterInfo || {
      host: config.directHost,
      port: config.directPort,
      lastChecked: now,
    }
  );
}

/**
 * Check if Redis master has changed
 */
async function hasMasterChanged(): Promise<boolean> {
  // Skip for build time
  if (isBuildTime) return false;

  // No master changes in direct connection mode
  if (config.useDirectConnection) return false;

  // Skip check if failover is already in progress
  if (failoverInProgress) return false;

  // Skip check if we checked recently
  const now = Date.now();
  if (
    currentMasterInfo &&
    now - currentMasterInfo.lastChecked < config.masterCheckIntervalMs
  ) {
    return false;
  }

  try {
    // Get current master address
    const currentMaster = await getCurrentMaster();

    // Auto-detect changes if client doesn't exist
    if (!client) return true;
    if (client.status !== 'ready') return true;

    // Get client's current connection info
    const connInfo = {
      host: client.options.host || '',
      port: client.options.port || 0,
    };

    // Check if connection details have changed
    if (
      connInfo.host !== currentMaster.host ||
      connInfo.port !== currentMaster.port
    ) {
      logger.info(
        `Master changed from ${connInfo.host}:${connInfo.port} to ${currentMaster.host}:${currentMaster.port}`
      );
      return true;
    }

    return false;
  } catch (err) {
    logger.error('Error checking master status:', err);
    return false;
  }
}

/**
 * Trigger a reconnection of all clients with improved timeout handling
 */
function triggerReconnection(): void {
  // Skip for build time
  if (isBuildTime) return;

  // Prevent duplicate reconnection requests
  if (failoverInProgress) {
    logger.info('Reconnection already in progress, skipping duplicate request');
    return;
  }

  failoverInProgress = true;
  isRedisOmConnected = false;

  logger.info('Triggering reconnection to new master');

  // Clear any existing timeout
  if (connectionTimeout) {
    clearTimeout(connectionTimeout);
  }

  // Set a timeout to prevent hanging if the reconnection process gets stuck
  connectionTimeout = setTimeout(() => {
    logger.warn('Reconnection process timed out, forcing a clean restart');
    failoverInProgress = false;
    // Force cleanup and retry
    resetAllConnections();
  }, config.connectionTimeoutMs);

  // Start the reconnection process
  reconnectToMaster().catch((err) => {
    logger.error('Error during reconnection:', err);
    failoverInProgress = false;

    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
      connectionTimeout = null;
    }
  });
}

/**
 * Safely close all Redis connections
 */
async function resetAllConnections(): Promise<void> {
  // Skip for build time
  if (isBuildTime) {
    failoverInProgress = false;
    return;
  }

  // Clear any existing timeout
  if (connectionTimeout) {
    clearTimeout(connectionTimeout);
    connectionTimeout = null;
  }

  logger.info('Resetting all Redis connections');

  // Track promise completion
  const promises: Promise<void>[] = [];

  // Close Redis OM client if it exists
  if (redisOmClient) {
    promises.push(
      (async () => {
        try {
          if (redisOmClient && redisOmClient.isOpen()) {
            await redisOmClient.close();
          }
        } catch (err) {
          logger.error('Error closing Redis OM client:', err);
        }
      })()
    );
  }

  // Close Redis client if it exists
  if (client) {
    promises.push(
      (async () => {
        try {
          if (client) {
            await client.disconnect();
          }
        } catch (err) {
          logger.error('Error disconnecting Redis client:', err);
        }
      })()
    );
  }

  // Wait for all cleanup operations to complete with timeout
  try {
    await Promise.race([
      Promise.all(promises),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Connection reset timeout')), 5000)
      ),
    ]);
  } catch (err) {
    logger.warn('Timeout during connection reset, forcing cleanup:', err);
  }

  // Reset connection states
  client = null;
  redisOmClient = null;
  isRedisOmConnected = false;
  failoverInProgress = false;
}

/**
 * Wait for Redis client to be ready with improved promise handling
 */
function waitForRedisReady(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Skip for build time
    if (isBuildTime) {
      return resolve();
    }

    if (!client) {
      return reject(new Error('Redis client is null'));
    }

    // Immediately resolve if client is already ready
    if (client.status === 'ready') {
      return resolve();
    }

    // Set up event handlers
    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const onEnd = () => {
      cleanup();
      reject(new Error('Redis connection closed unexpectedly'));
    };

    // Cleanup function to remove event listeners
    const cleanup = () => {
      if (client) {
        client.removeListener('ready', onReady);
        client.removeListener('error', onError);
        client.removeListener('end', onEnd);
      }
      clearTimeout(timeoutId);
    };

    // Register event handlers
    client.once('ready', onReady);
    client.once('error', onError);
    client.once('end', onEnd);

    // Set a timeout to prevent hanging
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for Redis client to be ready (${DEFAULT_CLIENT_READY_TIMEOUT_MS}ms)`
        )
      );
    }, DEFAULT_CLIENT_READY_TIMEOUT_MS);
  });
}

/**
 * Reconnect to the current master
 */
async function reconnectToMaster(): Promise<void> {
  // Skip for build time
  if (isBuildTime) {
    failoverInProgress = false;
    return;
  }

  try {
    logger.info('Starting reconnection to master');

    // Step 1: Clean up existing connections
    await resetAllConnections();

    // Step 2: Get current master address
    await getCurrentMaster();

    // Step 3: Initialize a new Redis client and wait for it to be ready
    client = initializeRedisClient();

    if (client) {
      await waitForRedisReady();

      // Step 4: Initialize a new Redis OM client
      await connectRedisOmClient(true);

      logger.info('Successfully reconnected to master');
    } else {
      logger.info('Redis client initialization skipped');
    }
  } catch (err) {
    logger.error('Failed to reconnect to master:', err);
    throw err;
  } finally {
    // Reset connection state
    failoverInProgress = false;

    // Clear any existing timeout
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
      connectionTimeout = null;
    }
  }
}

/**
 * Connect Redis-OM client with improved error handling and connection verification
 */
export async function connectRedisOmClient(
  forceReconnect = false
): Promise<void> {
  // Skip for build time
  if (isBuildTime) {
    logger.info('Skipping Redis-OM connection during build phase');
    return;
  }

  // Check if reconnection is needed
  if (!forceReconnect && isRedisOmConnected && redisOmClient?.isOpen()) {
    // Check for master changes
    const masterChanged = await hasMasterChanged();
    if (!masterChanged) {
      return; // No need to reconnect
    }
    logger.info('Master has changed, reconnecting Redis-OM client');
  }

  // Initialize Redis client if needed
  if (!client) {
    client = initializeRedisClient();
    if (client) {
      await waitForRedisReady();
    } else {
      logger.info(
        'Redis client initialization skipped, cannot connect Redis-OM'
      );
      return;
    }
  }

  // Close existing Redis-OM client if necessary
  if (redisOmClient) {
    try {
      if (redisOmClient.isOpen()) {
        await redisOmClient.close();
      }
    } catch (err) {
      logger.warn('Error closing existing Redis-OM client:', err);
    }
  }

  // Create a new Redis-OM client
  redisOmClient = new Client();

  // Retry connection with exponential backoff
  let retries = config.maxRetries;
  let lastError: Error | null = null;

  while (retries > 0) {
    try {
      // Get current master info
      const masterInfo = await getCurrentMaster();

      // Build Redis URL
      const redisUrl = config.password
        ? `redis://:${encodeURIComponent(config.password)}@${masterInfo.host}:${
            masterInfo.port
          }`
        : `redis://${masterInfo.host}:${masterInfo.port}`;

      logger.info(
        `Connecting Redis-OM to: ${redisUrl.replace(/:[^:]*@/, ':****@')}`
      );

      // Attempt connection with timeout
      await Promise.race([
        redisOmClient.open(redisUrl),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Redis-OM connection timeout')),
            DEFAULT_CONNECTION_TIMEOUT_MS
          )
        ),
      ]);

      // Verify connection is open
      if (!redisOmClient.isOpen()) {
        throw new Error('Redis-OM client is not open after connection attempt');
      }

      // Update connection state
      logger.info('Redis-OM client connected successfully');
      isRedisOmConnected = true;
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.error('Failed to connect Redis-OM client:', lastError);
      retries--;

      if (retries === 0) {
        break;
      }

      // Exponential backoff with jitter for retries
      const baseDelay = Math.min(
        Math.pow(2, config.maxRetries - retries) *
          DEFAULT_EXPONENTIAL_BACKOFF_BASE_MS,
        8000
      );
      const jitter = Math.random() * 500; // Add randomness to prevent thundering herd
      const delay = baseDelay + jitter;

      logger.info(
        `Retrying in ${Math.round(delay)}ms... (${retries} retries left)`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // If we've exhausted retries, throw the last error
  throw (
    lastError ||
    new Error('Failed to connect Redis-OM client after multiple attempts')
  );
}

/**
 * Ensure connection to the current Redis master
 */
export async function ensureMasterConnection(): Promise<void> {
  // Skip for build time
  if (isBuildTime) {
    logger.info('Skipping Redis master connection check during build phase');
    return;
  }

  try {
    // First check if master has changed
    const masterChanged = await hasMasterChanged();

    // Determine if reconnection is needed
    if (masterChanged || !isRedisOmConnected || !redisOmClient?.isOpen()) {
      logger.info('Master connection needs to be established or refreshed');

      // Handle case where failover is already in progress
      if (failoverInProgress) {
        logger.info('Failover already in progress, waiting for completion');
        // Wait a bit for the failover process to complete
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        // Trigger a full reconnection
        await reconnectToMaster();
      }
    } else {
      // Double-check connection with a ping
      try {
        if (client) {
          await Promise.race([
            client.ping(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Redis ping timeout')), 2000)
            ),
          ]);
        } else {
          // Redis client doesn't exist, reconnect
          await reconnectToMaster();
        }
      } catch (pingErr) {
        logger.warn('Redis ping failed, triggering reconnection:', pingErr);
        await reconnectToMaster();
      }
    }

    // Final validation
    if (
      !isBuildTime &&
      (!client || !redisOmClient || !redisOmClient.isOpen())
    ) {
      throw new Error(
        'Redis connection validation failed after reconnection attempt'
      );
    }
  } catch (err) {
    logger.error('Failed to ensure master connection:', err);
    // Reset connection state to allow future reconnection attempts
    failoverInProgress = false;
    throw err;
  }
}

/**
 * Return mock clients during build time
 */
function createMockRedisClients() {
  const mockRedisOmClient = {
    isOpen: () => true,
    close: async () => {},
    open: async () => {},
    search: async () => ({ count: 0, documents: [] }),
    execute: async () => ({}),
    // Add other methods as needed
  } as unknown as Client;

  const mockRedisClient = {
    status: 'ready',
    ping: async () => 'PONG',
    get: async () => null,
    set: async () => 'OK',
    del: async () => 0,
    // Add other methods as needed
  } as unknown as Redis;

  return { mockRedisClient, mockRedisOmClient };
}

/**
 * Initialize configuration and Redis client
 */
function initialize(): void {
  // Load configuration
  config = loadRedisConfig();

  if (isBuildTime) {
    logger.info('Running in build mode, initializing mock Redis clients');
    const { mockRedisClient, mockRedisOmClient } = createMockRedisClients();
    client = mockRedisClient;
    redisOmClient = mockRedisOmClient;
    isRedisOmConnected = true;
    return;
  }

  // Initialize Redis client
  if (!client) {
    client = initializeRedisClient();
  }
}

// Initialize on module import
initialize();

// Export public APIs
export { client, redisOmClient };
