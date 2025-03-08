// import Redis, { SentinelAddress } from 'ioredis';
// import { Client } from 'redis-om';
// import * as baseLogger from './logger';

// const logger = baseLogger.createContextLogger('Redis');

// // Helper function to parse Redis Sentinel addresses
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

// // Define Redis configuration with `isDev`
// function loadRedisConfig() {
//   const isDev = process.env.IS_DEV === 'true'; // This check defines whether it's dev or prod

//   const sentinelsString = isDev
//     ? process.env.REDIS_SENTINELS_DEV
//     : process.env.REDIS_SENTINELS_PROD;

//   const sentinels = sentinelsString ? parseSentinels(sentinelsString) : [];

//   const directHost = isDev
//     ? process.env.REDIS_HOST_DEV // Localhost for dev
//     : process.env.REDIS_HOST_PROD; // Redis server for prod

//   const directPort = parseInt(process.env.REDIS_PORT || '6379', 10);

//   return {
//     sentinels,
//     directHost,
//     directPort,
//     masterName: process.env.REDIS_MASTER_NAME || 'mymaster',
//     password: process.env.REDIS_PASSWORD,
//     sentinelPassword:
//       process.env.REDIS_SENTINEL_PASSWORD || process.env.REDIS_PASSWORD,
//     useDirectConnection: isDev || sentinels.length === 0,
//   };
// }

// const config = loadRedisConfig();

// // Create Redis client (either direct or via Sentinel)
// let redisClient: Redis;

// if (config.useDirectConnection) {
//   console.log(
//     `Using direct Redis connection to ${config.directHost}:${config.directPort}`
//   );
//   redisClient = new Redis({
//     host: config.directHost,
//     port: config.directPort,
//     password: config.password,
//     maxRetriesPerRequest: 3,
//     enableReadyCheck: true,
//     connectionName: 'app-connection',
//     retryStrategy: (times: number) =>
//       times > 10 ? null : Math.min(times * 100, 3000),
//   });
// } else {
//   console.log(
//     `Using Redis Sentinel connection with master: ${config.masterName}`
//   );
//   redisClient = new Redis({
//     sentinels: config.sentinels,
//     name: config.masterName,
//     password: config.password,
//     sentinelPassword: config.sentinelPassword,
//     maxRetriesPerRequest: 3,
//     enableReadyCheck: true,
//     connectionName: 'app-connection',
//     retryStrategy: (times: number) =>
//       times > 10 ? null : Math.min(times * 100, 3000),
//     sentinelRetryStrategy: (times: number) => Math.min(times * 500, 5000),
//     reconnectOnError: (err: Error) => {
//       const shouldReconnect = err.message.includes('READONLY');
//       if (shouldReconnect) {
//         console.log('READONLY error detected, reconnecting...');
//       }
//       return shouldReconnect;
//     },
//   });
// }

// // Set up Redis client event listeners
// redisClient.on('error', (err) => {
//   console.error('Redis client error:', err);
// });

// redisClient.on('connect', () => {
//   console.log('Redis client connected successfully');
// });

// redisClient.on('ready', () => {
//   console.log('Redis client is ready');
// });

// redisClient.on('reconnecting', () => {
//   console.log('Reconnecting to Redis...');
// });

// redisClient.on('end', () => {
//   console.log('Redis connection ended');
// });

// // Sentinel-specific events
// if (!config.useDirectConnection) {
//   redisClient.on('+switch-master', (master: string) => {
//     console.log(`Switch to new master detected for ${master}`);
//     // Force Redis-OM to reconnect on next call
//     isRedisOmConnected = false;
//     // Close Redis-OM client to force reconnection
//     if (redisOmClient && redisOmClient.isOpen()) {
//       redisOmClient.close().catch((err) => {
//         console.error('Error closing Redis-OM client during failover:', err);
//       });
//     }
//   });
// }

// // Create Redis-OM client
// const redisOmClient = new Client();

// // Flag to track Redis-OM connection status
// let isRedisOmConnected = false;
// let lastMasterCheck = 0;
// const MASTER_CHECK_INTERVAL = 5000; // 5 seconds

// // Helper function to get current master from Sentinel setup
// async function getCurrentMaster() {
//   if (config.useDirectConnection) {
//     return { host: config.directHost, port: config.directPort };
//   }

//   try {
//     const sentinel = config.sentinels[0];
//     if (!sentinel) {
//       throw new Error('No sentinels configured');
//     }

//     const sentinelClient = new Redis({
//       host: sentinel.host,
//       port: sentinel.port,
//       password: config.sentinelPassword,
//       connectTimeout: 2000,
//     });

//     try {
//       const result = (await sentinelClient.call(
//         'SENTINEL',
//         'get-master-addr-by-name',
//         config.masterName
//       )) as string[];

//       await sentinelClient.disconnect();

//       if (Array.isArray(result) && result.length === 2) {
//         const master = {
//           host: result[0],
//           port: parseInt(result[1], 10),
//         };
//         console.log(
//           `Current master from Sentinel: ${master.host}:${master.port}`
//         );
//         return master;
//       }
//     } catch (err) {
//       await sentinelClient.disconnect();
//       throw err;
//     }

//     console.log(
//       'Sentinel did not return expected result, using fallback connection'
//     );
//     return { host: config.directHost, port: config.directPort };
//   } catch (err) {
//     console.error(
//       'Error getting master from Sentinel, using fallback connection:',
//       err
//     );
//     return { host: config.directHost, port: config.directPort };
//   }
// }

// // Function to check if master has changed
// async function shouldReconnect(): Promise<boolean> {
//   if (config.useDirectConnection) return false;

//   const now = Date.now();
//   if (now - lastMasterCheck < MASTER_CHECK_INTERVAL) return false;

//   try {
//     const currentMaster = await getCurrentMaster();

//     const connInfo =
//       redisClient.status === 'ready'
//         ? { host: redisClient.options.host, port: redisClient.options.port }
//         : null;

//     if (
//       connInfo &&
//       (connInfo.host !== currentMaster.host ||
//         connInfo.port !== currentMaster.port)
//     ) {
//       console.log(
//         `Master changed from ${connInfo.host}:${connInfo.port} to ${currentMaster.host}:${currentMaster.port}`
//       );
//       return true;
//     }

//     return false;
//   } catch (err) {
//     console.error('Error checking master status:', err);
//     return false;
//   } finally {
//     lastMasterCheck = now;
//   }
// }

// // Function to connect Redis-OM client
// // export async function connectRedisOmClient(): Promise<void> {
// //   if (isRedisOmConnected && redisOmClient.isOpen()) {
// //     const shouldReconnectToMaster = await shouldReconnect();
// //     if (!shouldReconnectToMaster) {
// //       return;
// //     }
// //     console.log('Master has changed, reconnecting Redis-OM client');
// //     isRedisOmConnected = false;
// //     await redisOmClient.close().catch((err) => {
// //       console.error('Error closing Redis-OM client before reconnection:', err);
// //     });
// //   }

// //   if (!isRedisOmConnected && redisOmClient && !redisOmClient.isOpen()) {
// //     console.log('Redis-OM client was closed, creating a new client');
// //   }

// //   let retries = 5;
// //   while (retries > 0) {
// //     try {
// //       let redisUrl: string;

// //       if (!config.useDirectConnection) {
// //         try {
// //           const masterInfo = await getCurrentMaster();
// //           const host = masterInfo.host;
// //           const port = masterInfo.port;

// //           redisUrl = config.password
// //             ? `redis://:${encodeURIComponent(config.password)}@${host}:${port}`
// //             : `redis://${host}:${port}`;
// //         } catch (err) {
// //           console.log(
// //             'Failed to get Sentinel master, falling back to direct connection'
// //           );
// //           redisUrl = config.password
// //             ? `redis://:${encodeURIComponent(config.password)}@${
// //                 config.directHost
// //               }:${config.directPort}`
// //             : `redis://${config.directHost}:${config.directPort}`;
// //         }
// //       } else {
// //         redisUrl = config.password
// //           ? `redis://:${encodeURIComponent(config.password)}@${
// //               config.directHost
// //             }:${config.directPort}`
// //           : `redis://${config.directHost}:${config.directPort}`;
// //       }

// //       console.log(
// //         `Connecting Redis-OM to: ${redisUrl.replace(/:[^:]*@/, ':****@')}`
// //       );

// //       if (redisOmClient.isOpen()) {
// //         await redisOmClient.close();
// //       }

// //       await redisOmClient.open(redisUrl);

// //       if (!redisOmClient.isOpen()) {
// //         throw new Error('Redis-OM client is not open after connection attempt');
// //       }

// //       console.log('Redis-OM client connected successfully');
// //       isRedisOmConnected = true;
// //       lastMasterCheck = Date.now();
// //       return;
// //     } catch (err) {
// //       console.error('Failed to connect Redis-OM client:', err);
// //       retries--;
// //       if (retries === 0) {
// //         throw err;
// //       }
// //       console.log(`Retrying in 5 seconds... (${retries} retries left)`);
// //       await new Promise((resolve) => setTimeout(resolve, 5000));
// //     }
// //   }
// // }

// // export async function ensureMasterConnection(): Promise<void> {
// //   isRedisOmConnected = false; // Force check and reconnect
// //   await connectRedisOmClient();
// // }

// // Modify the connectRedisOmClient function in your redis.ts file

// export async function connectRedisOmClient(): Promise<void> {
//   if (isRedisOmConnected && redisOmClient.isOpen()) {
//     const shouldReconnectToMaster = await shouldReconnect();
//     if (!shouldReconnectToMaster) {
//       return;
//     }
//     console.log('Master has changed, reconnecting Redis-OM client');
//     isRedisOmConnected = false;
    
//     // Explicitly close the client and wait for it to complete
//     try {
//       await redisOmClient.close();
//       console.log('Successfully closed previous Redis-OM connection');
//     } catch (err) {
//       console.error('Error closing Redis-OM client before reconnection:', err);
//       // Continue anyway as we need a new connection
//     }
//   }

//   // Always create a new client if we're not connected
//   if (!isRedisOmConnected || !redisOmClient.isOpen()) {
//     console.log('Redis-OM client needs connection, creating a new client');
//   }

//   let retries = 5;
//   while (retries > 0) {
//     try {
//       let redisUrl: string;

//       // Get current master information
//       if (!config.useDirectConnection) {
//         try {
//           const masterInfo = await getCurrentMaster();
//           const host = masterInfo.host;
//           const port = masterInfo.port;

//           console.log(`Connecting to master at ${host}:${port}`);

//           redisUrl = config.password
//             ? `redis://:${encodeURIComponent(config.password)}@${host}:${port}`
//             : `redis://${host}:${port}`;
//         } catch (err) {
//           console.log(
//             'Failed to get Sentinel master, falling back to direct connection'
//           );
//           redisUrl = config.password
//             ? `redis://:${encodeURIComponent(config.password)}@${
//                 config.directHost
//               }:${config.directPort}`
//             : `redis://${config.directHost}:${config.directPort}`;
//         }
//       } else {
//         redisUrl = config.password
//           ? `redis://:${encodeURIComponent(config.password)}@${
//               config.directHost
//             }:${config.directPort}`
//           : `redis://${config.directHost}:${config.directPort}`;
//       }

//       console.log(
//         `Connecting Redis-OM to: ${redisUrl.replace(/:[^:]*@/, ':****@')}`
//       );

//       // Ensure we close any existing connection properly
//       if (redisOmClient.isOpen()) {
//         try {
//           await redisOmClient.close();
//           console.log('Closed existing Redis-OM connection');
//         } catch (closeErr) {
//           console.error('Error closing existing Redis-OM connection:', closeErr);
//         }
//       }

//       // Add a small delay before reconnecting
//       await new Promise((resolve) => setTimeout(resolve, 1000));

//       // Open connection with timeout
//       const connectionPromise = redisOmClient.open(redisUrl);
//       const timeoutPromise = new Promise((_, reject) => 
//         setTimeout(() => reject(new Error('Connection timeout')), 10000)
//       );

//       await Promise.race([connectionPromise, timeoutPromise]);

//       // Verify connection is actually open
//       if (!redisOmClient.isOpen()) {
//         throw new Error('Redis-OM client is not open after connection attempt');
//       }

//       // Test connection with a simple command
//       await redisClient.ping();
      
//       console.log('Redis-OM client connected successfully and verified');
//       isRedisOmConnected = true;
//       lastMasterCheck = Date.now();
//       return;
//     } catch (err) {
//       console.error('Failed to connect Redis-OM client:', err);
//       retries--;
//       if (retries === 0) {
//         throw err;
//       }
//       console.log(`Retrying in 5 seconds... (${retries} retries left)`);
//       await new Promise((resolve) => setTimeout(resolve, 5000));
//     }
//   }
// }

// // Also update the ensureMasterConnection function to be more robust
// export async function ensureMasterConnection(): Promise<void> {
//   try {
//     // Check if we need to reconnect by checking the master
//     const needsReconnect = await shouldReconnect();
    
//     if (needsReconnect || !isRedisOmConnected || !redisOmClient.isOpen()) {
//       console.log('Master connection needs to be refreshed');
//       isRedisOmConnected = false; // Force reconnect
      
//       // Close existing connection if open
//       if (redisOmClient.isOpen()) {
//         try {
//           await redisOmClient.close();
//         } catch (err) {
//           console.error('Error closing Redis-OM during master refresh:', err);
//         }
//       }
      
//       await connectRedisOmClient();
//     } else {
//       // Even if everything looks OK, do a quick ping test
//       try {
//         await redisClient.ping();
//       } catch (err) {
//         console.error('Connection test failed, reconnecting:', err);
//         isRedisOmConnected = false;
//         await connectRedisOmClient();
//       }
//     }
//   } catch (error) {
//     console.error('Error ensuring master connection:', error);
//     // Force a complete reconnection
//     isRedisOmConnected = false;
//     await connectRedisOmClient();
//   }
// }

// // Export public APIs
// export { redisClient, redisOmClient };



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
  logger.info(
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
  logger.info(
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
        logger.warn('READONLY error detected, reconnecting...');
      }
      return shouldReconnect;
    },
  });
}

// Set up Redis client event listeners
redisClient.on('error', (err) => {
  logger.error('Redis client error:', err);
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

// Store the last known master info for comparison
let lastKnownMaster = {
  host: config.useDirectConnection ? config.directHost : '',
  port: config.useDirectConnection ? config.directPort : 0,
};

// Flag to track if a master change is in progress
let masterChangeInProgress = false;
let lastMasterCheckTime = 0;
const MASTER_CHECK_INTERVAL = 3000; // 3 seconds

// Use a factory pattern to manage Redis-OM client instances
let redisOmClientInstance: Client | null = null;

// Sentinel-specific events
if (!config.useDirectConnection) {
  // When sentinel notifies about master change
  redisClient.on('+switch-master', (master: string) => {
    if (master === config.masterName) {
      logger.warn(`Switch to new master detected for ${master}`);
      masterChangeInProgress = true;

      // Force Redis-OM client recreation on next call
      clearRedisOmClient();

      // Also force IORedis client to reconnect
      logger.info('Forcing IORedis client to reconnect to the new master');
      redisClient.disconnect();
      redisClient.connect();
    }
  });

  // On IORedis reconnection, verify we're connected to the right master
  redisClient.on('reconnected', async () => {
    try {
      logger.info('IORedis reconnected, verifying master connection');
      const currentMaster = await getCurrentMaster();
      lastKnownMaster = currentMaster;
      logger.info(
        `Reconnected to master at ${currentMaster.host}:${currentMaster.port}`
      );
      masterChangeInProgress = false;
    } catch (err) {
      logger.error('Error verifying master after reconnection:', err);
    }
  });
}

/**
 * Clear the Redis-OM client instance and ensure it's properly closed
 */
async function clearRedisOmClient(): Promise<void> {
  if (redisOmClientInstance) {
    try {
      if (isClientConnected(redisOmClientInstance)) {
        await redisOmClientInstance.close();
        logger.info('Closed existing Redis-OM client');
      }
    } catch (err) {
      logger.error('Error closing Redis-OM client:', err);
    }
    redisOmClientInstance = null;
  }
}

/**
 * Check if the master has changed and we need to reconnect
 */
async function hasMasterChanged(): Promise<boolean> {
  if (config.useDirectConnection) return false;

  // Throttle checks to avoid too many sentinel queries
  const now = Date.now();
  if (
    now - lastMasterCheckTime < MASTER_CHECK_INTERVAL &&
    !masterChangeInProgress
  ) {
    return false;
  }
  lastMasterCheckTime = now;

  try {
    const currentMaster = await getCurrentMaster();

    // If we don't have a last known master yet, store and return false
    if (!lastKnownMaster.host) {
      lastKnownMaster = currentMaster;
      return false;
    }

    // Compare with last known master
    if (
      currentMaster.host !== lastKnownMaster.host ||
      currentMaster.port !== lastKnownMaster.port
    ) {
      logger.warn(
        `Master changed from ${lastKnownMaster.host}:${lastKnownMaster.port} to ${currentMaster.host}:${currentMaster.port}`
      );
      lastKnownMaster = currentMaster;
      return true;
    }

    return masterChangeInProgress; // Return true if we're in the middle of a master change
  } catch (err) {
    logger.error('Error checking master status:', err);
    return masterChangeInProgress; // Return current status on error
  }
}

/**
 * Get or create a Redis-OM client instance
 * This approach completely recreates the client on each master change
 */
async function getRedisOmClient(): Promise<Client> {
  try {
    // Check if master has changed (includes throttling to prevent too frequent checks)
    const masterChanged = await hasMasterChanged();

    // If we have an existing client and no master change, verify it's working
    if (
      redisOmClientInstance &&
      !masterChanged &&
      isClientConnected(redisOmClientInstance)
    ) {
      try {
        // Test the connection with a simple ping
        await redisClient.ping();
        return redisOmClientInstance;
      } catch (err) {
        logger.warn('Existing Redis-OM client failed connection test:', err);
        await clearRedisOmClient();
      }
    } else if (masterChanged && redisOmClientInstance) {
      logger.info('Master changed, clearing Redis-OM client');
      await clearRedisOmClient();
    }

    // Get current master information (retries built in)
    const masterInfo = await getCurrentMaster();
    logger.info(
      `Creating new Redis-OM client for ${masterInfo.host}:${masterInfo.port}`
    );

    // Create a new client instance
    const client = new Client();

    try {
      const redisUrl = config.password
        ? `redis://:${encodeURIComponent(config.password)}@${masterInfo.host}:${
            masterInfo.port
          }`
        : `redis://${masterInfo.host}:${masterInfo.port}`;

      logger.info(
        `Connecting Redis-OM to: ${redisUrl.replace(/:[^:]*@/, ':****@')}`
      );

      // Open with a timeout
      await Promise.race([
        client.open(redisUrl),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Redis-OM connection timeout')),
            5000
          )
        ),
      ]);

      // Verify the connection is working
      if (!client.isOpen()) {
        throw new Error('Redis-OM client not open after connection');
      }

      // Verify the underlying Redis connection
      await redisClient.ping();

      // Update master status
      masterChangeInProgress = false;
      lastKnownMaster = masterInfo;

      logger.info(
        `Redis-OM client connected successfully to ${masterInfo.host}:${masterInfo.port}`
      );
      redisOmClientInstance = client;
      return client;
    } catch (err:any) {
      logger.error('Failed to create new Redis-OM client:', err);

      // Clean up failed connection attempt
      try {
        if (isClientConnected(client)) {
          await client.close();
        }
      } catch (closeErr) {
        logger.error('Error closing failed client:', closeErr);
      }

      // Throw an informative error
      throw new Error(`Failed to connect Redis-OM: ${err.message}`);
    }
  } catch (err) {
    logger.error('Error in getRedisOmClient:', err);
    throw err;
  }
}

// Helper function to check client connection status
function isClientConnected(client: Client): boolean {
  try {
    return client.isOpen();
  } catch (err) {
    logger.error('Error checking client connection status:', err);
    return false;
  }
}

// Helper function to get current master from Sentinel setup with retries
async function getCurrentMaster(
  retries = 3
): Promise<{ host: string; port: number }> {
  if (config.useDirectConnection) {
    return { host: config.directHost || 'localhost', port: config.directPort };
  }

  let lastError: Error | null = null;
  let attemptCount = 0;

  while (attemptCount < retries) {
    attemptCount++;

    // Try each sentinel in the list
    for (const sentinel of config.sentinels) {
      let sentinelClient: Redis | null = null;

      try {
        logger.debug(
          `Querying sentinel at ${sentinel.host}:${sentinel.port} (attempt ${attemptCount})`
        );

        sentinelClient = new Redis({
          host: sentinel.host,
          port: sentinel.port,
          password: config.sentinelPassword,
          connectTimeout: 2000,
          maxRetriesPerRequest: 1,
        });

        // Set a timeout for the sentinel query
        const result = (await Promise.race([
          sentinelClient.call(
            'SENTINEL',
            'get-master-addr-by-name',
            config.masterName
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Sentinel query timeout')), 2000)
          ),
        ])) as string[];

        if (Array.isArray(result) && result.length === 2) {
          const master = {
            host: result[0],
            port: parseInt(result[1], 10),
          };

          logger.info(
            `Current master from Sentinel: ${master.host}:${master.port}`
          );

          // Clean up sentinel connection
          if (sentinelClient) {
            sentinelClient.disconnect();
          }

          return master;
        } else {
          logger.warn(
            `Unexpected result from sentinel: ${JSON.stringify(result)}`
          );
        }
      } catch (err: any) {
        lastError = err;
        logger.warn(
          `Error querying sentinel ${sentinel.host}:${sentinel.port}: ${err.message}`
        );
      } finally {
        // Ensure sentinel client is always closed
        if (sentinelClient) {
          try {
            sentinelClient.disconnect();
          } catch (closeErr) {
            logger.error('Error disconnecting sentinel client:', closeErr);
          }
        }
      }
    }

    // If we've tried all sentinels and failed, wait before retrying
    if (attemptCount < retries) {
      logger.info(
        `All sentinels failed, retrying in 1 second (${
          retries - attemptCount
        } retries left)`
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // If we exhausted all retries, use fallback connection
  logger.warn(
    `Could not get master info after ${retries} attempts, using fallback connection`
  );
  if (lastError) {
    logger.error('Last sentinel error:', lastError);
  }

  return { host: config.directHost || 'localhost', port: config.directPort };
}

// Export the getRedisOmClient function instead of a client instance
export { redisClient, getRedisOmClient };