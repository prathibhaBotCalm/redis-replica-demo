import {
  MasterAddress,
  RedisConfig,
  RedisManagerEvents,
  SentinelConfig,
} from '@/types/redis.types';
import EventEmitter from 'events';
import Redis from 'ioredis';
import { Client } from 'redis-om';
import * as baseLogger from './logger';

const logger = baseLogger.createContextLogger('Redis');

// Load configuration from environment variables
function loadConfig(): RedisConfig {
  return {
    masterName: process.env.REDIS_MASTER_NAME || 'mymaster',
    password: process.env.REDIS_PASSWORD,
    sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD,
    port: Number(process.env.REDIS_PORT || '6379'),
    pollIntervalMs: Number(process.env.MASTER_POLL_INTERVAL_MS || '5000'),
    hosts: {
      development: process.env.REDIS_HOST_DEV || 'localhost',
      production: process.env.REDIS_HOST_PROD || 'redis',
    },
    sentinels: {
      development:
        process.env.REDIS_SENTINELS_DEV?.trim() ||
        '157.230.253.3:26379,157.230.253.3:26380,157.230.253.3:26381',
      production:
        process.env.REDIS_SENTINELS_PROD?.trim() ||
        'sentinel-1:26379,sentinel-2:26380,sentinel-3:26381',
    },
    maxRetries: Number(process.env.REDIS_MAX_RETRIES || '5'),
    connectionTimeout: Number(process.env.REDIS_CONNECTION_TIMEOUT || '3000'),
  };
}

// Redis connection manager class
export class RedisConnectionManager {
  private static instance: RedisConnectionManager;
  private readonly config: RedisConfig;
  private redisClient: Redis | null = null;
  private redisOmClient: Client | null = null;
  private currentMaster: MasterAddress | null = null;
  private sentinels: SentinelConfig[] = [];
  private isProduction: boolean;
  private redisHost: string;
  private pollInterval: NodeJS.Timeout | null = null;
  private retryCount = 0;
  private directConnectionMode = false;
  private activeSentinelClients: Redis[] = [];
  private isClosing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  // Type-safe event emitter
  public readonly events = new EventEmitter() as EventEmitter & {
    on: <K extends keyof RedisManagerEvents>(
      event: K,
      listener: RedisManagerEvents[K]
    ) => EventEmitter;
    emit: <K extends keyof RedisManagerEvents>(
      event: K,
      ...args: Parameters<RedisManagerEvents[K]>
    ) => boolean;
  };

  private constructor() {
    this.config = loadConfig();
    this.isProduction = process.env.IS_DEV !== 'true';
    this.redisHost = this.isProduction
      ? this.config.hosts.production
      : this.config.hosts.development;
    logger.info(
      `Using ${this.isProduction ? 'production' : 'development'} Redis host: ${
        this.redisHost
      }`
    );
    this.sentinels = this.parseSentinels(
      this.isProduction
        ? this.config.sentinels.production
        : this.config.sentinels.development
    );

    if (this.sentinels.length === 0) {
      logger.warn(
        'No valid Sentinels found, switching to direct connection mode'
      );
      this.directConnectionMode = true;
    }
  }

  // Singleton pattern
  public static getInstance(): RedisConnectionManager {
    if (!RedisConnectionManager.instance) {
      RedisConnectionManager.instance = new RedisConnectionManager();
    }
    return RedisConnectionManager.instance;
  }

  // Parse the sentinel string into an array of SentinelConfig objects
  private parseSentinels(sentinelStr: string): SentinelConfig[] {
    return sentinelStr
      .split(',')
      .map((sentinel) => {
        const [host, port] = sentinel.trim().split(':');
        return host && port ? { host, port: Number(port) } : null;
      })
      .filter((sentinel): sentinel is SentinelConfig => sentinel !== null);
  }

  // Fetch the master address from Sentinels or fall back to direct connection
  private async getMasterAddress(): Promise<MasterAddress> {
    if (this.directConnectionMode) {
      return { host: this.redisHost, port: this.config.port };
    }

    const errors: Error[] = [];
    this.cleanupSentinelClients();
    for (const sentinel of this.sentinels) {
      try {
        const masterAddr = await this.querySentinelForMaster(sentinel);
        if (masterAddr) return masterAddr;
      } catch (error: any) {
        errors.push(error);
        logger.warn(
          `Sentinel ${sentinel.host}:${sentinel.port} failed: ${error.message}`
        );
      }
    }

    // If all sentinels fail, switch to direct connection mode
    this.directConnectionMode = true;
    logger.warn('All sentinels failed, switching to direct connection mode');
    return { host: this.redisHost, port: this.config.port };
  }

  private async querySentinelForMaster(
    sentinel: SentinelConfig
  ): Promise<MasterAddress | null> {
    const sentinelClient = new Redis({
      host: sentinel.host,
      port: sentinel.port,
      password: this.config.sentinelPassword,
      connectTimeout: this.config.connectionTimeout,
    });

    // Add to active sentinel clients for proper cleanup
    this.activeSentinelClients.push(sentinelClient);

    try {
      const response = await Promise.race([
        sentinelClient.call(
          'SENTINEL',
          'get-master-addr-by-name',
          this.config.masterName
        ),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Sentinel query timed out')),
            this.config.connectionTimeout
          )
        ),
      ]);

      if (Array.isArray(response) && response.length === 2) {
        let [host, portStr] = response;
        let port = Number(portStr);

        if (!this.isProduction && this.isPrivateIP(host)) {
          logger.info(
            `Replacing internal IP ${host} with configured host ${this.redisHost}`
          );
          host = this.redisHost;
          port = this.config.port;
        }

        logger.info(`Master Address: ${host}:${port}`);
        return { host, port };
      }
      return null;
    } catch (err: any) {
      logger.warn(`Sentinel query failed: ${err.message}`);
      return null;
    } finally {
      // Remove from active clients list
      const index = this.activeSentinelClients.indexOf(sentinelClient);
      if (index !== -1) {
        this.activeSentinelClients.splice(index, 1);
      }
      sentinelClient.disconnect();
    }
  }

  // Utility to check if the host is a private IP
  private isPrivateIP(host: string): boolean {
    return (
      host.startsWith('172.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.')
    );
  }

  // Clean up the active sentinel clients
  private cleanupSentinelClients(): void {
    this.activeSentinelClients.forEach((client) => {
      try {
        client.disconnect(true);
      } catch (err) {
        /* Ignore errors */
      }
    });
    this.activeSentinelClients = [];
  }

  private setupSentinelEventListeners(): void {
    if (this.directConnectionMode || !this.redisClient) {
      logger.info(
        'Direct connection mode or Redis client not initialized. Skipping event listener setup.'
      );
      return;
    }

    logger.info('Setting up Sentinel event listeners...');

    // Event: Reconnected to Sentinel
    this.redisClient.on('sentinelReconnect', () => {
      logger.info('Reconnected to Sentinel');
    });

    // Event: Sentinel error
    this.redisClient.on('sentinelError', (err) => {
      logger.error(`Sentinel error: ${err.message}`);
      this.events.emit('connection-error', err);
    });

    // Event: Sentinel master change
    this.redisClient.on(
      '+switch-master',
      async (
        masterName: string,
        oldHost: string,
        oldPort: string,
        newHost: string,
        newPort: string
      ) => {
        logger.info(
          `+switch-master event triggered: masterName=${masterName}, oldHost=${oldHost}, oldPort=${oldPort}, newHost=${newHost}, newPort=${newPort}`
        );

        if (masterName === this.config.masterName) {
          logger.info(
            `Switch master detected for ${masterName}: ${oldHost}:${oldPort} -> ${newHost}:${newPort}`
          );

          // Update the current master info
          this.currentMaster = { host: newHost, port: Number(newPort) };
          logger.info(`Updated current master to ${newHost}:${newPort}`);

          // Trigger a reconnection to the new master
          try {
            await this.handleFailover(true);
            logger.info('Reconnection to the new master was successful.');
          } catch (err: any) {
            logger.error(`Failed to handle master switch: ${err.message}`);
          }
        } else {
          logger.info(
            `Master name mismatch: expected ${this.config.masterName}, but got ${masterName}`
          );
        }
      }
    );

    // Event: Client connection error
    this.redisClient.on('error', (err) => {
      logger.error(`Redis client error: ${err.message}`);
      this.events.emit('connection-error', err);
    });

    // Event: Client successfully connected
    this.redisClient.on('connect', () => {
      logger.info('Redis client connected successfully.');
    });

    // Event: Client is reconnecting
    this.redisClient.on('reconnecting', () => {
      logger.info('Redis client is reconnecting...');
    });

    // Event: Redis client is ready
    this.redisClient.on('ready', () => {
      logger.info('Redis client is ready to handle commands.');
    });

    // Event: Client disconnected
    this.redisClient.on('end', () => {
      logger.info('Redis client connection ended.');
    });

    logger.info('Sentinel event listeners setup complete.');
  }

  // Create and return a new Redis client
  private createRedisClient(): Redis {
    const redisOptions = this.directConnectionMode
      ? {
          host: this.redisHost,
          port: this.config.port,
          password: this.config.password,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          connectionName: 'app-connection',
          retryStrategy: (times: number) =>
            times > 10 ? null : Math.min(times * 100, 3000),
        }
      : {
          sentinels: this.sentinels,
          name: this.config.masterName,
          sentinelPassword: this.config.sentinelPassword,
          password: this.config.password,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          connectionName: 'app-connection',
          retryStrategy: (times: number) =>
            times > 10 ? null : Math.min(times * 100, 3000),
          sentinelRetryStrategy: (times: number) => Math.min(times * 500, 5000),
          // Enable auto-discovery of the leader
          autoResendCommands: true,
          // Enable reconnecting when master changes
          reconnectOnError: (err: Error) => {
            // Only reconnect if it's a read-only error or a connection error
            return (
              err.message.includes('READONLY') || this.isConnectionError(err)
            );
          },
        };

    const redis = new Redis(redisOptions);

    redis.on('connect', () => logger.info('Redis connection established'));
    redis.on('ready', () => {
      logger.info('Redis client ready');
      this.retryCount = 0;
      this.events.emit('client-ready', redis);
    });

    redis.on('error', this.handleRedisError.bind(this));
    redis.on('end', () => this.events.emit('client-disconnected'));
    redis.on('reconnecting', () => this.events.emit('client-reconnecting'));

    this.setupSentinelEventListeners();

    return redis;
  }

  // Handle Redis errors
  private handleRedisError(err: Error): void {
    logger.error('Redis client error:', err.message);
    this.events.emit('client-error', err);

    if (this.isConnectionError(err)) {
      logger.warn('Connection error detected, attempting to reconnect');
      this.events.emit('connection-error', err);

      if (!this.isClosing) {
        // Don't switch to direct mode immediately, try a reconnection first
        this.handleFailover(true).catch((failoverErr) => {
          logger.error(
            `Failover after connection error failed: ${failoverErr.message}`
          );
          this.directConnectionMode = true;
          this.gracefullyCloseConnections().catch((closeErr) => {
            logger.error(`Error closing connections: ${closeErr.message}`);
          });
        });
      }
    }
  }

  // Check if the error is a connection error
  private isConnectionError(err: Error): boolean {
    return [
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ENOTFOUND',
      'READONLY',
      'CONNECTION_BROKEN',
    ].some((msg) => err.message.includes(msg));
  }

  // Get the Redis client (creates if not yet created)
  public getRedisClient(): Redis {
    if (!this.redisClient) {
      this.redisClient = this.createRedisClient();
    }
    return this.redisClient;
  }

  // Get or initialize Redis OM client
  public async getRedisOmClient(): Promise<Client> {
    if (!this.redisOmClient || !this.redisOmClient.isOpen()) {
      await this.initializeRedisOmClient();
    }
    return this.redisOmClient as Client;
  }

  // Initialize Redis OM client with current master address
  public async initializeRedisOmClient(): Promise<Client> {
    if (this.redisOmClient && this.redisOmClient.isOpen()) {
      await this.redisOmClient.close();
      logger.info('Closed existing Redis-OM client');
    }

    this.redisOmClient = new Client();
    const masterAddress = await this.getMasterAddress();
    this.currentMaster = masterAddress;

    let redisUrl = `redis://${masterAddress.host}:${masterAddress.port}`;
    if (this.config.password) {
      redisUrl = `redis://:${encodeURIComponent(this.config.password)}@${
        masterAddress.host
      }:${masterAddress.port}`;
    }

    logger.info('Connecting Redis-OM to:', redisUrl);
    await this.redisOmClient.open(redisUrl);

    if (!this.redisOmClient.isOpen()) {
      throw new Error('Redis-OM client failed to connect');
    }

    logger.info('Redis-OM client connected');
    this.events.emit('om-client-initialized', this.redisOmClient);
    this.retryCount = 0;
    return this.redisOmClient;
  }

  // Start polling for Redis master failover
  public startMasterPolling(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);

    // this.pollInterval = setInterval(
    //   () => this.handleFailover(),
    //   this.config.pollIntervalMs
    // );
    this.pollInterval = setInterval(async () => {
      try {
        await this.handleFailover(); // Make sure failover is handled asynchronously
      } catch (err: any) {
        logger.error('Error during polling for master failover:', err.message);
      }
    }, this.config.pollIntervalMs);
    logger.info(
      `Started master polling (interval: ${this.config.pollIntervalMs}ms)`
    );
  }

  // Stop polling for Redis master failover
  public stopMasterPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      logger.info('Stopped master polling');
    }
  }

  private async isCurrentMasterReachable(): Promise<boolean> {
    if (!this.redisClient || !this.currentMaster) return false;

    try {
      await this.redisClient.ping();
      return true;
    } catch (error: any) {
      logger.warn('Current master is unreachable:', error.message);
      return false;
    }
  }

  // Handle failover and reconnect to the new master if necessary

  private async handleFailover(forceReconnect = false): Promise<void> {
    if (this.directConnectionMode && !forceReconnect) return;

    try {
      // Check if the current master is reachable or force a reconnect
      const isMasterReachable = forceReconnect
        ? false
        : await this.isCurrentMasterReachable();

      if (!isMasterReachable || forceReconnect) {
        logger.warn(
          'Current master is unreachable or reconnect forced, checking for new master'
        );

        // Get the latest master address
        const { host, port } = await this.getMasterAddress();

        // Check if it's different from the current master
        const masterChanged =
          !this.currentMaster ||
          this.currentMaster.host !== host ||
          this.currentMaster.port !== port;

        if (masterChanged || forceReconnect) {
          logger.info(`Master changed or reconnect forced: ${host}:${port}`);

          // Store new master info first
          this.currentMaster = { host, port };

          // Close existing clients
          if (this.redisOmClient) {
            await this.redisOmClient.close();
            this.redisOmClient = null;
          }

          if (this.redisClient) {
            await this.redisClient.quit();
            this.redisClient = null;
          }

          // Create new clients with the new master
          this.redisClient = this.createRedisClient();
          await this.initializeRedisOmClient();

          this.events.emit('failover-complete', { host, port });
          logger.info(`Reconnected to master at ${host}:${port}`);
        }
      }
    } catch (err: any) {
      logger.error('Failover handling failed:', err.message);
      this.events.emit('failover-error', err);

      // If failover fails multiple times, switch to direct connection mode
      this.retryCount++;
      if (
        this.retryCount > this.config.maxRetries &&
        !this.directConnectionMode
      ) {
        this.directConnectionMode = true;
        logger.warn(
          `Switching to direct connection mode after ${this.retryCount} failed attempts`
        );

        // Try a direct connection as a last resort
        try {
          if (this.redisClient) {
            await this.redisClient.quit();
            this.redisClient = null;
          }

          if (this.redisOmClient) {
            await this.redisOmClient.close();
            this.redisOmClient = null;
          }

          this.redisClient = this.createRedisClient();
          await this.initializeRedisOmClient();

          this.retryCount = 0;
          logger.info('Successfully connected using direct connection mode');
        } catch (directError: any) {
          logger.error(`Direct connection also failed: ${directError.message}`);
        }
      }
    }
  }

  private async validateSentinels(): Promise<boolean> {
    if (this.directConnectionMode) return true;

    for (const sentinel of this.sentinels) {
      try {
        const sentinelClient = new Redis({
          host: sentinel.host,
          port: sentinel.port,
          password: this.config.sentinelPassword,
          connectTimeout: this.config.connectionTimeout,
        });

        await sentinelClient.ping();
        await sentinelClient.quit();
        return true; // At least one Sentinel is reachable
      } catch (error: any) {
        logger.warn(
          `Sentinel ${sentinel.host}:${sentinel.port} is unreachable: ${error.message}`
        );
      }
    }

    logger.warn(
      'All Sentinels are unreachable, switching to direct connection mode'
    );
    this.directConnectionMode = true;
    return false;
  }

  // Initialize Redis connections and handle failover
  public async initialize(): Promise<void> {
    try {
      await this.validateSentinels(); // Validate Sentinels before proceeding

      // Get the initial master address
      const masterAddress = await this.getMasterAddress();
      this.currentMaster = masterAddress;

      // Initialize clients
      this.redisClient = this.createRedisClient();
      await this.initializeRedisOmClient();

      // Start failover detection if not in direct mode
      if (!this.directConnectionMode) {
        this.startMasterPolling();
      }

      logger.info('Redis connection manager initialized');
      this.events.emit('initialization-complete');
    } catch (error: any) {
      logger.error('Initialization failed:', error.message);
      this.events.emit('initialization-failed', error);

      if (!this.directConnectionMode) {
        this.directConnectionMode = true;
        try {
          this.redisClient = this.createRedisClient();
          await this.initializeRedisOmClient();

          logger.info('Initialized with direct connection');
          this.events.emit('initialization-complete');
        } catch (directError: any) {
          logger.error('Direct connection failed:', directError.message);
          this.events.emit('initialization-failed', directError);
          throw directError;
        }
      } else {
        throw error;
      }
    }
  }

  // Gracefully shutdown connections
  public async shutdown(): Promise<void> {
    this.stopMasterPolling();

    try {
      if (this.redisOmClient) {
        await this.redisOmClient.close();
        this.redisOmClient = null;
      }

      if (this.redisClient) {
        await this.redisClient.quit();
        this.redisClient = null;
      }

      logger.info('Redis connections shut down');
      this.events.emit('shutdown-complete');
    } catch (err: any) {
      logger.error('Error shutting down Redis connections:', err.message);
      this.events.emit('shutdown-error', err);
    }
  }

  // Gracefully close connections during failures
  public async gracefullyCloseConnections(): Promise<void> {
    if (this.isClosing) return;

    this.isClosing = true;
    logger.warn('Gracefully closing Redis connections due to issues');

    this.stopMasterPolling();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      const closePromises = [];

      if (this.redisOmClient) {
        closePromises.push(this.redisOmClient.close());
      }

      if (this.redisClient) {
        closePromises.push(this.redisClient.quit());
      }

      // Also close all sentinel clients
      this.activeSentinelClients.forEach((client) => {
        closePromises.push(client.disconnect(true));
      });

      await Promise.all(closePromises);

      this.redisOmClient = null;
      this.redisClient = null;
      this.activeSentinelClients = [];

      logger.info('All Redis connections closed');
      this.events.emit('connections-closed');

      this.reconnectTimer = setTimeout(() => {
        this.isClosing = false;
        this.initialize().catch((err) => {
          logger.error('Reconnect failed:', err.message);
        });
      }, 5000); // Retry reconnecting after 5 seconds
    } catch (err: any) {
      logger.error('Error during graceful connection close:', err.message);
    } finally {
      this.isClosing = false;
    }
  }
}

// Singleton instance
export const redisManager = RedisConnectionManager.getInstance();

// Initialize Redis at application startup
export async function initializeRedisConnections(): Promise<void> {
  await redisManager.initialize();
}

// For backward compatibility
export async function initializeRedisClient(): Promise<Redis> {
  return redisManager.getRedisClient();
}

export async function initializeRedisOmClient(): Promise<Client> {
  return redisManager.getRedisOmClient();
}
