import { Client, Repository, Schema } from 'redis-om';
import * as logger from '../lib/logger';
import { redisManager } from '../lib/redis copy';

const log = logger.createContextLogger('RepositoryManager');

class RepositoryManager {
  private repositories: Record<
    string,
    { repository: Repository; schema: Schema; lastRefreshed: Date }
  > = {};
  private eventHandlersRegistered = false;

  constructor() {
    this.registerEventHandlers();
  }

  /**
   * Utility to detect connection errors.
   */
  private isConnectionError(error: Error): boolean {
    return (
      error.message.includes('ENOTFOUND') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('connection error')
    );
  }

  /**
   * Registers global event handlers for Redis events.
   */
  private registerEventHandlers(): void {
    if (this.eventHandlersRegistered) return;

    redisManager.events.on(
      'om-client-initialized',
      this.handleClientReinitialization.bind(this)
    );
    redisManager.events.on('failover-complete', this.handleFailover.bind(this));
    redisManager.events.on(
      'initialization-complete',
      this.refreshRepositories.bind(this)
    );
    redisManager.events.on('error', this.handleRedisError.bind(this));

    this.eventHandlersRegistered = true;
    log.debug('Global event handlers registered');
  }

  /**
   * Handle Redis errors, particularly connection issues.
   */
  private async handleRedisError(error: Error): Promise<void> {
    if (this.isConnectionError(error)) {
      log.error(`Redis connection error detected: ${error.message}`);

      try {
        await redisManager.gracefullyCloseConnections();
        Object.keys(this.repositories).forEach((schemaName) => {
          log.warn(
            `Repository '${schemaName}' marked as needing refresh due to connection error`
          );
        });
        redisManager.events.emit('connection-error', error);
      } catch (closeError: any) {
        log.error(
          `Error while handling connection error: ${closeError.message}`
        );
      }
    } else {
      log.error(`Redis error: ${error.message}`);
    }
  }

  /**
   * Handle Redis OM client reinitialization event.
   */
  private async handleClientReinitialization(newClient: Client): Promise<void> {
    const schemaNames = Object.keys(this.repositories);
    if (!schemaNames.length) return;

    log.info(
      `Reinitializing ${schemaNames.length} repositories with new client`
    );

    for (const schemaName of schemaNames) {
      try {
        const { schema } = this.repositories[schemaName];
        const repository = newClient.fetchRepository(schema);
        await repository.createIndex();

        this.repositories[schemaName] = {
          repository,
          schema,
          lastRefreshed: new Date(),
        };
        log.info(`Repository '${schemaName}' reinitialized successfully`);
      } catch (error: any) {
        log.error(
          `Failed to reinitialize '${schemaName}' repository: ${error.message}`
        );
      }
    }
  }

  /**
   * Handle Redis failover events.
   */
  private async handleFailover(): Promise<void> {
    try {
      log.warn('Failover detected - reinitializing repositories');
      const client = await redisManager.getRedisOmClient();
      await this.handleClientReinitialization(client);
    } catch (error: any) {
      log.error(`Failed to handle failover for repositories: ${error.message}`);
    }
  }

  /**
   * Initializes a repository for a given Redis-OM schema.
   * Returns it from cache or creates a new one.
   */
  public async initializeRepository<T extends Schema>(
    schema: T,
    forceCreate = false
  ): Promise<Repository> {
    const schemaName = schema.schemaName || '';

    if (!schemaName) {
      throw new Error('Schema must have a name property');
    }

    if (!forceCreate && this.repositories[schemaName]) {
      log.debug(`Using cached repository for '${schemaName}'`);
      return this.repositories[schemaName].repository;
    }

    try {
      log.info(`Initializing repository for '${schemaName}'`);
      const redisOmClient = await redisManager.getRedisOmClient();

      if (!redisOmClient.isOpen()) {
        log.warn('Redis-OM client is not open. Reconnecting...');
        await redisManager.getRedisOmClient();
      }

      const repository = redisOmClient.fetchRepository(schema);
      await this.createIndexWithRetry(repository, schemaName);

      this.repositories[schemaName] = {
        repository,
        schema,
        lastRefreshed: new Date(),
      };

      log.info(
        `Repository and index for '${schemaName}' initialized successfully`
      );
      return repository;
    } catch (error: any) {
      if (this.isConnectionError(error)) {
        log.error(
          `Connection error during '${schemaName}' repository initialization: ${error.message}`
        );
        await redisManager.gracefullyCloseConnections();
        throw new Error(
          `Redis connection error during repository initialization: ${error.message}`
        );
      } else {
        log.error(
          `Failed to initialize '${schemaName}' repository: ${error.message}`
        );
        throw error;
      }
    }
  }

  /**
   * Creates index with retry mechanism for transient errors.
   */
  private async createIndexWithRetry(
    repository: Repository,
    schemaName: string,
    maxRetries = 3
  ): Promise<void> {
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        await repository.createIndex();
        if (attempt > 0) {
          log.info(
            `Successfully created index for '${schemaName}' on attempt ${
              attempt + 1
            }`
          );
        }
        return;
      } catch (error: any) {
        if (this.isConnectionError(error)) {
          log.error(
            `Connection error during index creation for '${schemaName}': ${error.message}`
          );
          await redisManager.gracefullyCloseConnections();
          throw error;
        }

        attempt++;
        if (attempt >= maxRetries) {
          throw error;
        }

        const delay = Math.min(2 ** attempt * 500, 5000);
        log.warn(
          `Error creating index for '${schemaName}', retrying in ${delay}ms (${attempt}/${maxRetries}): ${error.message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  /**
   * Refreshes all cached repositories.
   */
  public async refreshRepositories(
    forceRecreateIndices = false
  ): Promise<void> {
    const schemaNames = Object.keys(this.repositories);
    if (!schemaNames.length) {
      log.debug('No repositories to refresh');
      return;
    }

    log.info(`Refreshing ${schemaNames.length} repositories...`);

    const client = await redisManager.getRedisOmClient();

    await Promise.all(
      schemaNames.map(async (schemaName) => {
        try {
          const { schema } = this.repositories[schemaName];
          const repository = client.fetchRepository(schema);

          if (forceRecreateIndices) {
            await repository.createIndex();
          }

          this.repositories[schemaName] = {
            repository,
            schema,
            lastRefreshed: new Date(),
          };
          log.debug(`Repository '${schemaName}' refreshed`);
        } catch (error: any) {
          log.error(
            `Failed to refresh '${schemaName}' repository: ${error.message}`
          );
        }
      })
    );

    log.info('All repositories refreshed successfully');
  }

  /**
   * Clears all cached repositories.
   */
  public clearRepositories(): void {
    const count = Object.keys(this.repositories).length;
    Object.keys(this.repositories).forEach((key) => {
      delete this.repositories[key];
    });
    log.info(`Repository cache cleared (${count} repositories removed)`);
  }

  /**
   * Returns an already initialized repository, or initializes it if not available.
   */
  public async getRepository<T extends Schema>(schema: T): Promise<Repository> {
    const schemaName = schema.schemaName || '';

    if (!this.repositories[schemaName]) {
      return this.initializeRepository(schema);
    }

    return this.repositories[schemaName].repository;
  }

  /**
   * Returns an already initialized repository if available, otherwise undefined.
   */
  public getCachedRepository<T extends Schema>(
    schema: T
  ): Repository | undefined {
    const schemaName = schema.schemaName || '';
    return this.repositories[schemaName]?.repository;
  }

  /**
   * Checks the health of repositories and Redis OM client.
   */
  public async checkRepositoriesHealth(): Promise<{
    healthy: boolean;
    repositories: Record<string, { healthy: boolean; lastRefreshed: string }>;
    redisOmClientOpen: boolean;
    lastError?: string;
  }> {
    const health = {
      healthy: true,
      repositories: {} as Record<
        string,
        { healthy: boolean; lastRefreshed: string }
      >,
      redisOmClientOpen: false,
      lastError: undefined as string | undefined,
    };

    try {
      const client = await redisManager.getRedisOmClient();
      health.redisOmClientOpen = client.isOpen();

      if (!health.redisOmClientOpen) {
        health.healthy = false;
        health.lastError = 'Redis OM client is not open';
      }

      const schemaNames = Object.keys(this.repositories);

      for (const schemaName of schemaNames) {
        try {
          const { repository, lastRefreshed } = this.repositories[schemaName];

          // Simple health check - try to execute a simple operation
          await repository.search().return.count();

          health.repositories[schemaName] = {
            healthy: true,
            lastRefreshed: lastRefreshed.toISOString(),
          };
        } catch (error: any) {
          health.healthy = false;
          health.repositories[schemaName] = {
            healthy: false,
            lastRefreshed:
              this.repositories[schemaName].lastRefreshed.toISOString(),
          };

          if (!health.lastError) {
            health.lastError = `Repository '${schemaName}' error: ${error.message}`;
          }
        }
      }

      return health;
    } catch (error: any) {
      health.healthy = false;
      health.lastError = `Health check error: ${error.message}`;
      return health;
    }
  }
}

const repositoryManager = new RepositoryManager();
export default repositoryManager;
