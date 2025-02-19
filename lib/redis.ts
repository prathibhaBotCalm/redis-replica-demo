import EventEmitter from 'events';
import Redis from 'ioredis';
import { Client } from 'redis-om';

const {
  NODE_ENV = 'development', // Default to development if not set
  REDIS_PASSWORD = '',
  REDIS_SENTINEL_PASSWORD = '',
  REDIS_MASTER_NAME = 'mymaster',
  REDIS_PORT = '6379',
  MASTER_POLL_INTERVAL_MS = '5000',
  REDIS_HOST_DEV = '157.230.253.3', // Default dev host
  REDIS_HOST_PROD = 'redis-master', // Default prod host
  REDIS_SENTINELS_DEV = '157.230.253.3:26379,157.230.253.3:26380,157.230.253.3:26381', // Default dev sentinels
  REDIS_SENTINELS_PROD = 'sentinel-1:26379,sentinel-2:26380,sentinel-3:26381', // Default prod sentinels
} = process.env;

// Conditional configuration based on NODE_ENV (development or production)
let REDIS_SENTINELS = '';
let REDIS_HOST = '';

if (NODE_ENV === 'production') {
  REDIS_SENTINELS = REDIS_SENTINELS_PROD;
  REDIS_HOST = REDIS_HOST_PROD;
  console.log(`Using production Redis host: ${REDIS_HOST}`); // Debug log
} else {
  REDIS_SENTINELS = REDIS_SENTINELS_DEV;
  REDIS_HOST = REDIS_HOST_DEV;
  console.log(`Using development Redis host: ${REDIS_HOST}`); // Debug log
}

// Parse Sentinel addresses
const sentinels = REDIS_SENTINELS.split(',')
  .map((sentinel) => {
    const [host, port] = sentinel.split(':');
    return host && port ? { host, port: Number(port) } : null;
  })
  .filter(Boolean) as { host: string; port: number }[];

if (sentinels.length === 0) {
  throw new Error('🚨 No valid Sentinels found in REDIS_SENTINELS!');
}

// EventEmitter for Redis-OM and client events
class RedisEventEmitter extends EventEmitter {}
const redisEventEmitter = new RedisEventEmitter();

let redisClient: Redis | null = null;
let redisOmClient: Client | null = null;
let currentMaster: { host: string; port: number } | null = null;

/**
 * Retrieves the Redis Master Address from Sentinel.
 * @returns {Promise<{ host: string; port: number }>} Redis master address
 */
async function getMasterAddress(): Promise<{ host: string; port: number }> {
  for (const sentinel of sentinels) {
    const sentinelClient = new Redis({
      host: sentinel.host,
      port: sentinel.port,
      password: REDIS_SENTINEL_PASSWORD,
      retryStrategy: (times) => Math.min(times * 1000, 5000),
    });

    try {
      const response = await sentinelClient.call(
        'SENTINEL',
        'get-master-addr-by-name',
        REDIS_MASTER_NAME
      );

      if (Array.isArray(response) && response.length === 2) {
        let [host, portStr] = response;
        let port = Number(portStr);

        // Override internal IPs if detected and force external IP usage
        if (
          (NODE_ENV !== 'production' && host.startsWith('172.')) ||
          host.startsWith('10.') ||
          host.startsWith('192.168.')
        ) {
          host = REDIS_HOST;
          port = Number(REDIS_PORT);
        }

        console.log(`✅ Master Address Used: ${host}:${port}`);
        return { host, port };
      }
    } catch (error: any) {
      console.warn(
        `⚠️ Sentinel ${sentinel.host}:${sentinel.port} failed:`,
        error.message
      );
    } finally {
      sentinelClient.disconnect(); // Ensure proper resource cleanup
    }
  }

  throw new Error('❌ Unable to retrieve master address from Sentinels');
}

/**
 * Creates a new ioredis client with proper configuration.
 * @returns {Redis} Redis client instance
 */
function createRedisClient(): Redis {
  const redisOptions: any = {
    sentinels,
    name: REDIS_MASTER_NAME,
    sentinelPassword: REDIS_SENTINEL_PASSWORD,
    password: REDIS_PASSWORD,
    sentinelRetryStrategy: (times: number) => Math.min(times * 1000, 5000),
  };

  const redis = new Redis(redisOptions);
  redis.on('connect', () => console.log('✅ ioredis connected'));
  redis.on('ready', () => console.log('🔥 ioredis is ready'));
  redis.on('error', (err) => console.error('❌ ioredis error:', err));
  redis.on('end', () => console.log('❌ ioredis connection closed'));

  return redis;
}

/**
 * Initializes Redis client. If client already exists, returns the existing one.
 * @returns {Redis} Redis client instance
 */
function initializeRedisClient(): Redis {
  if (!redisClient) {
    redisClient = createRedisClient();
  }
  return redisClient;
}

/**
 * Initializes the Redis-OM client and opens a connection to the Redis master.
 * @returns {Promise<Client>} Redis-OM client instance
 */
async function initializeRedisOmClient(): Promise<Client> {
  if (!redisOmClient) {
    redisOmClient = new Client();

    try {
      const { host, port } = await getMasterAddress();
      currentMaster = { host, port };

      let redisUrl = `redis://${host}:${port}`;
      if (REDIS_PASSWORD) {
        redisUrl = `redis://:${REDIS_PASSWORD}@${host}:${port}`;
      }

      console.log('🔌 Connecting Redis-OM:', redisUrl);
      await redisOmClient.open(redisUrl);

      // Ensure the Redis-OM client is properly connected
      if (!redisOmClient.isOpen()) {
        console.error('❌ Redis-OM client failed to connect.');
        throw new Error('❌ Redis-OM client connection failed.');
      }

      console.log('✅ Redis-OM client connected');
      redisEventEmitter.emit('client-initialized', redisOmClient);
    } catch (error) {
      console.error('❌ Failed to connect Redis-OM:', error);
      throw error;
    }
  }
  return redisOmClient;
}

/**
 * Handles failover by reconnecting to the new Redis master.
 */
async function handleFailover() {
  try {
    // Detect the new master address after failover
    const { host, port } = await getMasterAddress();

    // If master has changed, we need to reconnect
    if (
      !currentMaster ||
      currentMaster.host !== host ||
      currentMaster.port !== port
    ) {
      console.log(`⚠️ Master changed to ${host}:${port}`);

      // Close the current Redis-OM client if it's connected to the old master
      if (redisOmClient) {
        try {
          await redisOmClient.close();
          console.log('✅ Closed old Redis-OM client');
        } catch (error: any) {
          console.warn('⚠️ Error closing Redis-OM:', error.message);
        }
        redisOmClient = null;
      }

      // Reconnect to the new master
      await initializeRedisOmClient();
      console.log('✅ Reconnected Redis-OM to new master');
      redisEventEmitter.emit('client-reinitialized', redisOmClient);

      // Update the current master to reflect the new master
      currentMaster = { host, port };
    }
  } catch (error) {
    console.error('❌ Failed to handle failover:', error);
  }
}

/**
 * Polls the Redis master address periodically to detect changes in the master node.
 */
async function pollMasterAddress() {
  const intervalMs = Number(MASTER_POLL_INTERVAL_MS) || 5000;

  setInterval(async () => {
    // console.log('⚠️ Checking for master changes...');
    await handleFailover();
  }, intervalMs);
}

/**
 * Initializes all Redis clients and starts the polling process.
 */
async function initializeClients() {
  try {
    initializeRedisClient(); // Initialize ioredis client
    await initializeRedisOmClient(); // Initialize Redis-OM client
    pollMasterAddress(); // Start polling for master address changes
  } catch (error) {
    console.error('❌ Failed to initialize Redis:', error);
    process.exit(1); // Exit process if initialization fails
  }
}

// Initialize clients on startup
initializeClients();

export {
  initializeRedisClient,
  initializeRedisOmClient,
  redisClient,
  redisEventEmitter,
  redisOmClient,
};
