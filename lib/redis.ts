import EventEmitter from 'events';
import Redis from 'ioredis';
import { Client } from 'redis-om';

// Define types for better type safety
interface SentinelConfig {
  host: string;
  port: number;
}

interface MasterAddress {
  host: string;
  port: number;
}

interface RedisConfig {
  masterName: string;
  password: string;
  sentinelPassword: string;
  port: number;
  pollIntervalMs: number;
  hosts: {
    development: string;
    production: string;
  };
  sentinels: {
    development: string;
    production: string;
  };
}

// Environment configuration with defaults
const config: RedisConfig = {
  masterName: process.env.REDIS_MASTER_NAME || 'mymaster',
  password: process.env.REDIS_PASSWORD || '',
  sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD || '',
  port: Number(process.env.REDIS_PORT || '6379'),
  pollIntervalMs: Number(process.env.MASTER_POLL_INTERVAL_MS || '5000'),
  hosts: {
    development: process.env.REDIS_HOST_DEV || '157.230.253.3',
    production: process.env.REDIS_HOST_PROD || 'redis-master',
  },
  sentinels: {
    development:
      process.env.REDIS_SENTINELS_DEV ||
      '157.230.253.3:26379,157.230.253.3:26380,157.230.253.3:26381',
    production:
      process.env.REDIS_SENTINELS_PROD ||
      'sentinel-1:26379,sentinel-2:26380,sentinel-3:26381',
  },
};

class RedisConnectionManager {
  private static instance: RedisConnectionManager;

  private redisClient: Redis | null = null;
  private redisOmClient: Client | null = null;
  private currentMaster: MasterAddress | null = null;
  private sentinels: SentinelConfig[] = [];
  private isProduction: boolean;
  private redisHost: string;
  private pollInterval: NodeJS.Timeout | null = null;
  private retryCount = 0;
  private readonly MAX_RETRIES = 5;
  private directConnectionMode = false;

  public readonly events = new EventEmitter();

  private constructor() {
    this.isProduction = process.env.NODE_ENV === 'production';
    this.redisHost = this.isProduction
      ? config.hosts.production
      : config.hosts.development;

    console.log(
      `Using ${this.isProduction ? 'production' : 'development'} Redis host: ${
        this.redisHost
      }`
    );

    // Parse sentinel addresses
    const sentinelsStr = this.isProduction
      ? config.sentinels.production
      : config.sentinels.development;
    this.sentinels = this.parseSentinels(sentinelsStr);

    if (this.sentinels.length === 0) {
      throw new Error('🚨 No valid Sentinels found in configuration');
    }
  }

  /**
   * Get the singleton instance of RedisConnectionManager
   */
  public static getInstance(): RedisConnectionManager {
    if (!RedisConnectionManager.instance) {
      RedisConnectionManager.instance = new RedisConnectionManager();
    }
    return RedisConnectionManager.instance;
  }

  /**
   * Parse sentinel configuration from string
   */
  private parseSentinels(sentinelStr: string): SentinelConfig[] {
    return sentinelStr
      .split(',')
      .map((sentinel) => {
        const [host, port] = sentinel.split(':');
        return host && port ? { host, port: Number(port) } : null;
      })
      .filter(Boolean) as SentinelConfig[];
  }

  /**
   * Get the current Redis master address from Sentinel
   */
  private async getMasterAddress(): Promise<MasterAddress> {
    // If already in direct connection mode, skip sentinel query
    if (this.directConnectionMode) {
      return {
        host: this.redisHost,
        port: config.port,
      };
    }

    const errors: Error[] = [];

    for (const sentinel of this.sentinels) {
      const sentinelClient = new Redis({
        host: sentinel.host,
        port: sentinel.port,
        password: config.sentinelPassword,
        connectionName: 'sentinel-query',
        connectTimeout: 3000,
        retryStrategy: (times) => Math.min(times * 500, 3000),
      });

      try {
        const response = await sentinelClient.call(
          'SENTINEL',
          'get-master-addr-by-name',
          config.masterName
        );

        // Don't call quit() directly - this causes the "ERR unknown command 'quit'" error
        // Instead, gracefully disconnect
        sentinelClient.disconnect(false);

        if (Array.isArray(response) && response.length === 2) {
          let [host, portStr] = response;
          let port = Number(portStr);

          // Override internal IPs if detected in development
          if (
            !this.isProduction &&
            (host.startsWith('172.') ||
              host.startsWith('10.') ||
              host.startsWith('192.168.'))
          ) {
            host = this.redisHost;
            port = config.port;
          }

          console.log(`✅ Master Address: ${host}:${port}`);
          return { host, port };
        }
      } catch (error: any) {
        errors.push(error);
        console.warn(
          `⚠️ Sentinel ${sentinel.host}:${sentinel.port} failed: ${error.message}`
        );
      } finally {
        try {
          // Use disconnect with "force" parameter set to true
          // This avoids sending QUIT command that's causing the error
          sentinelClient.disconnect(true);
        } catch (e) {
          // Ignore disconnect errors
        }
      }
    }

    // If all sentinels failed, switch to direct connection mode
    console.warn(
      '⚠️ All sentinels failed, switching to direct connection mode'
    );
    this.directConnectionMode = true;

    // Return direct connection to Redis host
    return {
      host: this.redisHost,
      port: config.port,
    };
  }

  /**
   * Create a new Redis client using Sentinel configuration
   */
  private createRedisClient(): Redis {
    let redisOptions: any;

    if (this.directConnectionMode) {
      // Direct connection without sentinel
      redisOptions = {
        host: this.redisHost,
        port: config.port,
        password: config.password,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        connectionName: 'app-connection',
        retryStrategy: (times: number) => {
          if (times > 10) return null; // Stop retrying after 10 attempts
          return Math.min(times * 100, 3000); // Incremental backoff
        },
      };
    } else {
      // Sentinel connection
      redisOptions = {
        sentinels: this.sentinels,
        name: config.masterName,
        sentinelPassword: config.sentinelPassword,
        password: config.password,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        connectionName: 'app-connection',
        retryStrategy: (times: number) => {
          if (times > 10) {
            // After 10 retries, switch to direct connection
            this.directConnectionMode = true;
            return null; // Stop retrying after 10 attempts
          }
          return Math.min(times * 100, 3000); // Incremental backoff
        },
        sentinelRetryStrategy: (times: number) => Math.min(times * 500, 5000),
      };
    }

    const redis = new Redis(redisOptions);

    redis.on('connect', () => console.log('✅ Redis connection established'));
    redis.on('ready', () => {
      console.log('🔥 Redis client ready');
      this.retryCount = 0; // Reset retry counter on successful connection
      this.events.emit('client-ready', redis);
    });
    redis.on('error', (err) => {
      console.error('❌ Redis client error:', err.message);
      this.events.emit('client-error', err);

      // If connection keeps failing, try direct connection mode
      if (
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('ECONNREFUSED')
      ) {
        this.directConnectionMode = true;
      }
    });
    redis.on('end', () => {
      console.log('❌ Redis connection closed');
      this.events.emit('client-disconnected');
    });
    redis.on('reconnecting', () => {
      console.log('⏳ Redis client reconnecting...');
      this.events.emit('client-reconnecting');
    });

    return redis;
  }

  /**
   * Get or initialize the Redis client
   */
  public getRedisClient(): Redis {
    if (!this.redisClient) {
      this.redisClient = this.createRedisClient();
    }
    return this.redisClient;
  }

  /**
   * Get or initialize Redis-OM client
   */
  public async getRedisOmClient(): Promise<Client> {
    if (!this.redisOmClient || !this.redisOmClient.isOpen()) {
      await this.initializeRedisOmClient();
    }
    return this.redisOmClient as Client;
  }

  /**
   * Initialize Redis-OM client with connection to master
   */
  private async initializeRedisOmClient(): Promise<Client> {
    try {
      if (this.redisOmClient && this.redisOmClient.isOpen()) {
        await this.redisOmClient.close();
        console.log('✅ Closed existing Redis-OM client');
      }

      this.redisOmClient = new Client();

      const { host, port } = await this.getMasterAddress();
      this.currentMaster = { host, port };

      let redisUrl = `redis://${host}:${port}`;
      if (config.password) {
        redisUrl = `redis://:${encodeURIComponent(
          config.password
        )}@${host}:${port}`;
      }

      console.log('🔌 Connecting Redis-OM to:', redisUrl);
      await this.redisOmClient.open(redisUrl);

      if (!this.redisOmClient.isOpen()) {
        throw new Error('❌ Redis-OM client failed to connect');
      }

      console.log('✅ Redis-OM client connected successfully');
      this.events.emit('om-client-initialized', this.redisOmClient);
      this.retryCount = 0; // Reset retry count on successful connection
      return this.redisOmClient;
    } catch (error: any) {
      console.error('❌ Failed to connect Redis-OM:', error.message);

      // Enable direct connection mode if sentinel communication fails
      if (error.message.includes('Unable to retrieve master address')) {
        this.directConnectionMode = true;
        console.log('⚠️ Switching to direct connection mode');
      }

      // Implement exponential backoff for retries
      this.retryCount++;
      if (this.retryCount < this.MAX_RETRIES) {
        const backoffTime = Math.min(2 ** this.retryCount * 1000, 30000);
        console.log(
          `⏳ Retrying Redis-OM connection in ${
            backoffTime / 1000
          } seconds (attempt ${this.retryCount}/${this.MAX_RETRIES})...`
        );

        await new Promise((resolve) => setTimeout(resolve, backoffTime));
        return this.initializeRedisOmClient();
      }

      throw error;
    }
  }

  /**
   * Handle Redis master failover by reconnecting clients
   */
  private async handleFailover(): Promise<void> {
    try {
      // Skip if using direct connection mode
      if (this.directConnectionMode) {
        return;
      }

      const { host, port } = await this.getMasterAddress();

      // Check if master has changed
      if (
        !this.currentMaster ||
        this.currentMaster.host !== host ||
        this.currentMaster.port !== port
      ) {
        console.log(`⚠️ Redis master has changed to ${host}:${port}`);

        // Close and reinitialize Redis-OM client
        if (this.redisOmClient) {
          try {
            await this.redisOmClient.close();
            console.log('✅ Closed old Redis-OM client');
          } catch (error: any) {
            console.warn('⚠️ Error closing Redis-OM client:', error.message);
          }
          this.redisOmClient = null;
        }

        // Reconnect to the new master
        await this.initializeRedisOmClient();
        console.log('✅ Reconnected Redis-OM to new master');
        this.events.emit('failover-complete', { host, port });

        // Update current master record
        this.currentMaster = { host, port };
      }
    } catch (error: any) {
      console.error('❌ Failed to handle failover:', error.message);
      this.events.emit('failover-error', error);

      // If failover handling fails repeatedly, switch to direct connection
      if (!this.directConnectionMode) {
        console.warn(
          '⚠️ Failover handling failed, switching to direct connection mode'
        );
        this.directConnectionMode = true;
      }
    }
  }

  /**
   * Start polling for Redis master changes
   */
  public startMasterPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.pollInterval = setInterval(
      () => this.handleFailover(),
      config.pollIntervalMs
    );

    console.log(
      `⏰ Started master polling (interval: ${config.pollIntervalMs}ms)`
    );
  }

  /**
   * Stop polling for Redis master changes
   */
  public stopMasterPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('⏰ Stopped master polling');
    }
  }

  /**
   * Initialize all Redis connections
   */
  public async initialize(): Promise<void> {
    try {
      // Initialize Redis client
      this.getRedisClient();

      // Initialize Redis-OM client
      await this.getRedisOmClient();

      // Start master polling if not in direct connection mode
      if (!this.directConnectionMode) {
        this.startMasterPolling();
      }

      console.log('🚀 Redis connection manager initialized successfully');
      this.events.emit('initialization-complete');
    } catch (error: any) {
      console.error(
        '❌ Failed to initialize Redis connections:',
        error.message
      );
      this.events.emit('initialization-failed', error);

      // If initialization fails, try direct connection mode
      if (!this.directConnectionMode) {
        console.warn('⚠️ Initialization failed, trying direct connection mode');
        this.directConnectionMode = true;

        // Try again with direct connection
        try {
          // Initialize Redis client
          this.getRedisClient();

          // Initialize Redis-OM client
          await this.getRedisOmClient();

          console.log(
            '🚀 Redis connection manager initialized using direct connection'
          );
          this.events.emit('initialization-complete');
        } catch (directError: any) {
          console.error(
            '❌ Direct connection also failed:',
            directError.message
          );
          this.events.emit('initialization-failed', directError);
          throw directError;
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Gracefully shut down all Redis connections
   */
  public async shutdown(): Promise<void> {
    this.stopMasterPolling();

    try {
      if (this.redisOmClient && this.redisOmClient.isOpen()) {
        await this.redisOmClient.close();
        this.redisOmClient = null;
        console.log('✅ Redis-OM client closed');
      }

      if (this.redisClient) {
        // Use disconnect instead of quit to avoid sending a QUIT command
        this.redisClient.disconnect(false);
        this.redisClient = null;
        console.log('✅ Redis client closed');
      }

      console.log('🛑 Redis connections shut down gracefully');
      this.events.emit('shutdown-complete');
    } catch (error: any) {
      console.error('❌ Error during Redis shutdown:', error.message);
      this.events.emit('shutdown-error', error);
    }
  }
}

// Export singleton instance
const redisManager = RedisConnectionManager.getInstance();

// Helper functions to maintain backward compatibility
async function initializeRedisClient(): Promise<Redis> {
  return redisManager.getRedisClient();
}

async function initializeRedisOmClient(): Promise<Client> {
  return redisManager.getRedisOmClient();
}

// Initialize on module load
redisManager.initialize().catch((error) => {
  console.error('Failed to initialize Redis connections:', error);
  // Don't exit process on failure - allow application to continue with degraded functionality
  // process.exit(1);
});

export {
  redisManager,
  initializeRedisClient,
  initializeRedisOmClient,
  RedisConnectionManager,
};
