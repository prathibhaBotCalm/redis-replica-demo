import Redis, { SentinelAddress } from 'ioredis';
import { Client } from 'redis-om';
import * as baseLogger from './logger';

const logger = baseLogger.createContextLogger('Redis');

// Helper function to parse Redis Sentinel addresses
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

// Define Redis configuration with `isDev`
function loadRedisConfig() {
  const isDev = process.env.IS_DEV === 'true'; // This check defines whether it's dev or prod

  const sentinelsString = isDev
    ? process.env.REDIS_SENTINELS_DEV
    : process.env.REDIS_SENTINELS_PROD;

  const sentinels = sentinelsString ? parseSentinels(sentinelsString) : [];

  const directHost = isDev
    ? process.env.REDIS_HOST_DEV // Localhost for dev
    : process.env.REDIS_HOST_PROD; // Redis server for prod

  const directPort = parseInt(process.env.REDIS_PORT || '6379', 10);

  return {
    sentinels,
    directHost,
    directPort,
    masterName: process.env.REDIS_MASTER_NAME || 'mymaster',
    password: process.env.REDIS_PASSWORD,
    sentinelPassword:
      process.env.REDIS_SENTINEL_PASSWORD || process.env.REDIS_PASSWORD,
    useDirectConnection: isDev || sentinels.length === 0,
  };
}

const config = loadRedisConfig();

// Connection state
let redisClient: Redis | null = null;
let redisOmClient: Client | null = null;
let isRedisOmConnected = false;
let lastMasterCheck = 0;
let currentMasterInfo: { host: string; port: number } | null = null;
const MASTER_CHECK_INTERVAL = 5000; // 5 seconds
let failoverInProgress = false;
let connectionTimeout: NodeJS.Timeout | null = null;

// Timeout for connection attempts (30 seconds)
const CONNECTION_TIMEOUT = 30000;

// Create Redis client (either direct or via Sentinel)
function createRedisClient(): Redis {
  if (config.useDirectConnection) {
    logger.info(
      `Using direct Redis connection to ${config.directHost}:${config.directPort}`
    );
    return new Redis({
      host: config.directHost,
      port: config.directPort,
      password: config.password,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectionName: 'app-connection',
      retryStrategy: (times: number) =>
        times > 10 ? null : Math.min(times * 100, 3000),
    });
  } else {
    logger.info(
      `Using Redis Sentinel connection with master: ${config.masterName}`
    );
    return new Redis({
      sentinels: config.sentinels,
      name: config.masterName,
      password: config.password,
      sentinelPassword: config.sentinelPassword,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectionName: 'app-connection',
      retryStrategy: (times: number) =>
        times > 10 ? null : Math.min(times * 100, 3000),
      sentinelRetryStrategy: (times: number) => Math.min(times * 500, 5000),
      reconnectOnError: (err: Error) => {
        const shouldReconnect = err.message.includes('READONLY');
        if (shouldReconnect) {
          logger.warn('READONLY error detected, reconnecting...');
          // Force reconnection on READONLY errors
          triggerReconnection();
        }
        return shouldReconnect;
      },
    });
  }
}

// Initialize Redis client with event listeners
function initializeRedisClient(): Redis {
  if (redisClient) {
    try {
      redisClient.disconnect();
    } catch (err) {
      // Ignore errors on disconnect
    }
  }

  redisClient = createRedisClient();

  // Set up Redis client event listeners
  redisClient.on('error', (err) => {
    logger.error('Redis client error:', err);
    if (
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('ETIMEDOUT') ||
      err.message.includes('ENOTFOUND')
    ) {
      triggerReconnection();
    }
  });

  redisClient.on('connect', () => {
    logger.info('Redis client connected successfully');
  });

  redisClient.on('ready', () => {
    logger.info('Redis client is ready');
  });

  redisClient.on('reconnecting', () => {
    logger.info('Reconnecting to Redis...');
  });

  redisClient.on('end', () => {
    logger.info('Redis connection ended');
  });

  // Sentinel-specific events
  if (!config.useDirectConnection) {
    // Event: Sentinel reports a new master was elected
    redisClient.on(
      '+switch-master',
      (
        master: string,
        oldHost: string,
        oldPort: string,
        newHost: string,
        newPort: string
      ) => {
        if (master === config.masterName) {
          logger.info(
            `Switch to new master detected: ${newHost}:${newPort} (was ${oldHost}:${oldPort})`
          );
          currentMasterInfo = {
            host: newHost,
            port: parseInt(newPort, 10),
          };
          triggerReconnection();
        }
      }
    );

    // Handle other relevant Sentinel events
    redisClient.on('+sentinel', (sentinel, reason) => {
      logger.info(`New sentinel discovered: ${sentinel}, reason: ${reason}`);
    });

    redisClient.on('-sentinel', (sentinel, reason) => {
      logger.warn(`Sentinel removed: ${sentinel}, reason: ${reason}`);
    });

    redisClient.on('+slave', (slave) => {
      logger.info(`New replica detected: ${slave}`);
    });

    redisClient.on('-slave', (slave, reason) => {
      logger.warn(`Replica removed: ${slave}, reason: ${reason}`);
    });
  }

  return redisClient;
}

// Helper function to get current master from Sentinel setup
async function getCurrentMaster(): Promise<{ host: string; port: number }> {
  if (config.useDirectConnection) {
    return { host: config.directHost || 'localhost', port: config.directPort };
  }

  // First try the cached master info if recent
  if (
    currentMasterInfo &&
    Date.now() - lastMasterCheck < MASTER_CHECK_INTERVAL
  ) {
    return currentMasterInfo;
  }

  let sentinelClient: Redis | null = null;

  for (const sentinel of config.sentinels) {
    try {
      sentinelClient = new Redis({
        host: sentinel.host,
        port: sentinel.port,
        password: config.sentinelPassword,
        connectTimeout: 2000,
      });

      const result = (await sentinelClient.call(
        'SENTINEL',
        'get-master-addr-by-name',
        config.masterName
      )) as string[];

      if (Array.isArray(result) && result.length === 2) {
        const master = {
          host: result[0],
          port: parseInt(result[1], 10),
        };

        logger.info(
          `Current master from Sentinel: ${master.host}:${master.port}`
        );

        lastMasterCheck = Date.now();
        currentMasterInfo = master;

        await sentinelClient.disconnect();
        return master;
      }

      await sentinelClient.disconnect();
    } catch (err) {
      logger.warn(
        `Failed to get master from sentinel ${sentinel.host}:${sentinel.port}:`,
        err
      );
      if (sentinelClient) {
        try {
          await sentinelClient.disconnect();
        } catch (discErr) {
          // Ignore disconnect errors
        }
      }
    }
  }

  logger.warn('All sentinel queries failed, using fallback connection');

  // If all sentinels fail, use the cached master if available, otherwise fallback to direct connection
  return (
    currentMasterInfo || {
      host: config.directHost || 'localhost',
      port: config.directPort,
    }
  );
}

// Function to check if master has changed
async function hasMasterChanged(): Promise<boolean> {
  if (config.useDirectConnection) return false;
  if (failoverInProgress) return false;

  const now = Date.now();
  if (now - lastMasterCheck < MASTER_CHECK_INTERVAL) return false;

  try {
    const currentMaster = await getCurrentMaster();

    // If no client exists, we need a new connection
    if (!redisClient) return true;

    // If client is not ready, we need a new connection
    if (redisClient.status !== 'ready') return true;

    const connInfo = {
      host: redisClient.options.host || '',
      port: redisClient.options.port || 0,
    };

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
  } finally {
    lastMasterCheck = now;
  }
}

// Trigger a reconnection of all clients
function triggerReconnection() {
  if (failoverInProgress) {
    logger.info('Reconnection already in progress, skipping duplicate request');
    return;
  }

  failoverInProgress = true;
  isRedisOmConnected = false;

  logger.info('Triggering reconnection to new master');

  // Set a timeout to prevent hanging if the reconnection process gets stuck
  if (connectionTimeout) {
    clearTimeout(connectionTimeout);
  }

  connectionTimeout = setTimeout(() => {
    logger.warn('Reconnection process timed out, forcing a clean restart');
    failoverInProgress = false;
    // Force cleanup and retry
    resetAllConnections();
  }, CONNECTION_TIMEOUT);

  // Start the actual reconnection process
  reconnectToMaster().catch((err) => {
    logger.error('Error during reconnection:', err);
    failoverInProgress = false;
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
      connectionTimeout = null;
    }
  });
}

// Safely close all Redis connections
async function resetAllConnections() {
  // Clear any existing timeout
  if (connectionTimeout) {
    clearTimeout(connectionTimeout);
    connectionTimeout = null;
  }

  logger.info('Resetting all Redis connections');

  // Close Redis OM client if it exists
  if (redisOmClient) {
    try {
      if (redisOmClient.isOpen()) {
        await redisOmClient.close();
      }
    } catch (err) {
      logger.error('Error closing Redis OM client:', err);
    } finally {
      redisOmClient = null;
    }
  }

  // Close Redis client if it exists
  if (redisClient) {
    try {
      await redisClient.disconnect();
    } catch (err) {
      logger.error('Error disconnecting Redis client:', err);
    } finally {
      redisClient = null;
    }
  }

  isRedisOmConnected = false;
  failoverInProgress = false;
}

// Reconnect to the current master
async function reconnectToMaster() {
  try {
    logger.info('Starting reconnection to master');

    // First, clean up existing connections
    await resetAllConnections();

    // Get current master address
    const masterInfo = await getCurrentMaster();

    // Initialize a new Redis client and ensure it's connected
    redisClient = initializeRedisClient();

    // Wait for the client to be ready
    await waitForRedisReady();

    // Now reinitialize Redis OM client
    await connectRedisOmClient(true);

    logger.info('Successfully reconnected to master');
  } catch (err) {
    logger.error('Failed to reconnect to master:', err);
    throw err;
  } finally {
    failoverInProgress = false;
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
      connectionTimeout = null;
    }
  }
}

// Wait for Redis client to be ready
function waitForRedisReady(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!redisClient) {
      return reject(new Error('Redis client is null'));
    }

    if (redisClient.status === 'ready') {
      return resolve();
    }

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

    const cleanup = () => {
      if (redisClient) {
        redisClient.removeListener('ready', onReady);
        redisClient.removeListener('error', onError);
        redisClient.removeListener('end', onEnd);
      }
    };

    // Set event listeners
    redisClient.once('ready', onReady);
    redisClient.once('error', onError);
    redisClient.once('end', onEnd);

    // Set a timeout to prevent hanging
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for Redis client to be ready'));
    }, 5000);

    // Clear timeout when done
    ['ready', 'error', 'end'].forEach((event) => {
      redisClient?.once(event, () => clearTimeout(timeout));
    });
  });
}

// Function to connect Redis-OM client
export async function connectRedisOmClient(
  forceReconnect = false
): Promise<void> {
  if (!forceReconnect && isRedisOmConnected && redisOmClient?.isOpen()) {
    // Check if master has changed - if yes, force reconnection
    const masterChanged = await hasMasterChanged();
    if (!masterChanged) {
      return; // No need to reconnect
    }
    logger.info('Master has changed, reconnecting Redis-OM client');
  }

  // Initialize Redis client if it doesn't exist
  if (!redisClient) {
    redisClient = initializeRedisClient();
    await waitForRedisReady();
  }

  // Close existing Redis-OM client if open
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

  let retries = 5;
  let lastError: any = null;

  while (retries > 0) {
    try {
      let redisUrl: string;

      // Get master info from sentinel or use direct connection
      const masterInfo = await getCurrentMaster();

      // Build Redis URL
      redisUrl = config.password
        ? `redis://:${encodeURIComponent(config.password)}@${masterInfo.host}:${
            masterInfo.port
          }`
        : `redis://${masterInfo.host}:${masterInfo.port}`;

      logger.info(
        `Connecting Redis-OM to: ${redisUrl.replace(/:[^:]*@/, ':****@')}`
      );

      // Open new connection
      await redisOmClient.open(redisUrl);

      if (!redisOmClient.isOpen()) {
        throw new Error('Redis-OM client is not open after connection attempt');
      }

      logger.info('Redis-OM client connected successfully');
      isRedisOmConnected = true;
      lastMasterCheck = Date.now();
      return;
    } catch (err) {
      lastError = err;
      logger.error('Failed to connect Redis-OM client:', err);
      retries--;

      if (retries === 0) {
        break;
      }

      // Exponential backoff for retries
      const delay = Math.min(Math.pow(2, 5 - retries) * 500, 8000);
      logger.info(`Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // If we've exhausted retries, throw the last error
  throw (
    lastError ||
    new Error('Failed to connect Redis-OM client after multiple attempts')
  );
}

// Function to force a reconnection to the master - this is the critical function
// that fixes the issues with failover
export async function ensureMasterConnection(): Promise<void> {
  try {
    // First check if master has changed
    const masterChanged = await hasMasterChanged();

    if (masterChanged || !isRedisOmConnected || !redisOmClient?.isOpen()) {
      logger.info('Master connection needs to be established or refreshed');

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
        if (redisClient) {
          await redisClient.ping();
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
    if (!redisClient || !redisOmClient || !redisOmClient.isOpen()) {
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

// Initialize the Redis client on module import
if (!redisClient) {
  redisClient = initializeRedisClient();
}

// Export public APIs
export { redisClient, redisOmClient };
