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

// Create Redis client (either direct or via Sentinel)
let redisClient: Redis;

if (config.useDirectConnection) {
  console.log(
    `Using direct Redis connection to ${config.directHost}:${config.directPort}`
  );
  redisClient = new Redis({
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
  console.log(
    `Using Redis Sentinel connection with master: ${config.masterName}`
  );
  redisClient = new Redis({
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
        console.log('READONLY error detected, reconnecting...');
      }
      return shouldReconnect;
    },
  });
}

// Set up Redis client event listeners
redisClient.on('error', (err) => {
  console.error('Redis client error:', err);
});

redisClient.on('connect', () => {
  console.log('Redis client connected successfully');
});

redisClient.on('ready', () => {
  console.log('Redis client is ready');
});

redisClient.on('reconnecting', () => {
  console.log('Reconnecting to Redis...');
});

redisClient.on('end', () => {
  console.log('Redis connection ended');
});

// Sentinel-specific events
if (!config.useDirectConnection) {
  redisClient.on('+switch-master', (master: string) => {
    console.log(`Switch to new master detected for ${master}`);
    // Force Redis-OM to reconnect on next call
    isRedisOmConnected = false;
    // Close Redis-OM client to force reconnection
    if (redisOmClient && redisOmClient.isOpen()) {
      redisOmClient.close().catch((err) => {
        console.error('Error closing Redis-OM client during failover:', err);
      });
    }
  });
}

// Create Redis-OM client
const redisOmClient = new Client();

// Flag to track Redis-OM connection status
let isRedisOmConnected = false;
let lastMasterCheck = 0;
const MASTER_CHECK_INTERVAL = 5000; // 5 seconds

// Helper function to get current master from Sentinel setup
async function getCurrentMaster() {
  if (config.useDirectConnection) {
    return { host: config.directHost, port: config.directPort };
  }

  try {
    const sentinel = config.sentinels[0];
    if (!sentinel) {
      throw new Error('No sentinels configured');
    }

    const sentinelClient = new Redis({
      host: sentinel.host,
      port: sentinel.port,
      password: config.sentinelPassword,
      connectTimeout: 2000,
    });

    try {
      const result = (await sentinelClient.call(
        'SENTINEL',
        'get-master-addr-by-name',
        config.masterName
      )) as string[];

      await sentinelClient.disconnect();

      if (Array.isArray(result) && result.length === 2) {
        const master = {
          host: result[0],
          port: parseInt(result[1], 10),
        };
        console.log(
          `Current master from Sentinel: ${master.host}:${master.port}`
        );
        return master;
      }
    } catch (err) {
      await sentinelClient.disconnect();
      throw err;
    }

    console.log(
      'Sentinel did not return expected result, using fallback connection'
    );
    return { host: config.directHost, port: config.directPort };
  } catch (err) {
    console.error(
      'Error getting master from Sentinel, using fallback connection:',
      err
    );
    return { host: config.directHost, port: config.directPort };
  }
}

// Function to check if master has changed
async function shouldReconnect(): Promise<boolean> {
  if (config.useDirectConnection) return false;

  const now = Date.now();
  if (now - lastMasterCheck < MASTER_CHECK_INTERVAL) return false;

  try {
    const currentMaster = await getCurrentMaster();

    const connInfo =
      redisClient.status === 'ready'
        ? { host: redisClient.options.host, port: redisClient.options.port }
        : null;

    if (
      connInfo &&
      (connInfo.host !== currentMaster.host ||
        connInfo.port !== currentMaster.port)
    ) {
      console.log(
        `Master changed from ${connInfo.host}:${connInfo.port} to ${currentMaster.host}:${currentMaster.port}`
      );
      return true;
    }

    return false;
  } catch (err) {
    console.error('Error checking master status:', err);
    return false;
  } finally {
    lastMasterCheck = now;
  }
}

// Function to connect Redis-OM client
export async function connectRedisOmClient(): Promise<void> {
  if (isRedisOmConnected && redisOmClient.isOpen()) {
    const shouldReconnectToMaster = await shouldReconnect();
    if (!shouldReconnectToMaster) {
      return;
    }
    console.log('Master has changed, reconnecting Redis-OM client');
    isRedisOmConnected = false;
    await redisOmClient.close().catch((err) => {
      console.error('Error closing Redis-OM client before reconnection:', err);
    });
  }

  if (!isRedisOmConnected && redisOmClient && !redisOmClient.isOpen()) {
    console.log('Redis-OM client was closed, creating a new client');
  }

  let retries = 5;
  while (retries > 0) {
    try {
      let redisUrl: string;

      if (!config.useDirectConnection) {
        try {
          const masterInfo = await getCurrentMaster();
          const host = masterInfo.host;
          const port = masterInfo.port;

          redisUrl = config.password
            ? `redis://:${encodeURIComponent(config.password)}@${host}:${port}`
            : `redis://${host}:${port}`;
        } catch (err) {
          console.log(
            'Failed to get Sentinel master, falling back to direct connection'
          );
          redisUrl = config.password
            ? `redis://:${encodeURIComponent(config.password)}@${
                config.directHost
              }:${config.directPort}`
            : `redis://${config.directHost}:${config.directPort}`;
        }
      } else {
        redisUrl = config.password
          ? `redis://:${encodeURIComponent(config.password)}@${
              config.directHost
            }:${config.directPort}`
          : `redis://${config.directHost}:${config.directPort}`;
      }

      console.log(
        `Connecting Redis-OM to: ${redisUrl.replace(/:[^:]*@/, ':****@')}`
      );

      if (redisOmClient.isOpen()) {
        await redisOmClient.close();
      }

      await redisOmClient.open(redisUrl);

      if (!redisOmClient.isOpen()) {
        throw new Error('Redis-OM client is not open after connection attempt');
      }

      console.log('Redis-OM client connected successfully');
      isRedisOmConnected = true;
      lastMasterCheck = Date.now();
      return;
    } catch (err) {
      console.error('Failed to connect Redis-OM client:', err);
      retries--;
      if (retries === 0) {
        throw err;
      }
      console.log(`Retrying in 5 seconds... (${retries} retries left)`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

export async function ensureMasterConnection(): Promise<void> {
  isRedisOmConnected = false; // Force check and reconnect
  await connectRedisOmClient();
}

// Export public APIs
export { redisClient, redisOmClient };
