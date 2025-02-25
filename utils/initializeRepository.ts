import { Repository, Schema } from 'redis-om';
import { redisManager, RedisConnectionManager } from '../lib/redis';

// Cache of initialized repositories by schema name
const repositories: Record<string, Repository> = {};

/**
 * Generic function to initialize a repository based on schema.
 * @param schema - Redis-OM schema for the repository.
 * @returns Repository instance.
 */
export async function initializeRepository<T extends Schema>(
  schema: T
): Promise<Repository> {
  const schemaName = (schema as any).name; // Unique identifier for schema

  if (!repositories[schemaName]) {
    try {
      // Get the Redis-OM client (will initialize if needed)
      const redisOmClient = await redisManager.getRedisOmClient();

      // Ensure redis-om client is open before using it
      if (!redisOmClient.isOpen()) {
        console.error('❌ Redis-OM client is not open. Reconnecting...');
        await redisManager.getRedisOmClient(); // This will force a reconnection
      }

      // Create and initialize the repository
      const repository = redisOmClient.fetchRepository(schema);
      await repository.createIndex();

      repositories[schemaName] = repository;
      console.log(`✅ ${schemaName} repository and index initialized`);

      // Listen for client reinitialization events and update repository accordingly
      redisManager.events.on('om-client-initialized', async (newClient) => {
        try {
          console.log(
            `⚙️ Reinitializing ${schemaName} repository with new client`
          );
          repositories[schemaName] = newClient.fetchRepository(schema);
          await repositories[schemaName].createIndex();
          console.log(`✅ ${schemaName} repository reinitialized successfully`);
        } catch (error: any) {
          console.error(
            `❌ Failed to reinitialize ${schemaName} repository: ${error.message}`
          );
        }
      });

      // Handle failover events
      redisManager.events.on('failover-complete', async () => {
        try {
          console.log(
            `⚠️ Failover detected - reinitializing ${schemaName} repository`
          );
          const client = await redisManager.getRedisOmClient();
          repositories[schemaName] = client.fetchRepository(schema);
          await repositories[schemaName].createIndex();
          console.log(
            `✅ ${schemaName} repository reinitialized after failover`
          );
        } catch (error: any) {
          console.error(
            `❌ Failed to reinitialize ${schemaName} repository after failover: ${error.message}`
          );
        }
      });
    } catch (error: any) {
      console.error(
        `❌ Failed to initialize ${schemaName} repository: ${error.message}`
      );
      throw error;
    }
  }

  return repositories[schemaName];
}

/**
 * Get a repository by schema without initialization
 * @param schema - Redis-OM schema
 * @returns Repository instance if already initialized, otherwise undefined
 */
export function getRepository<T extends Schema>(
  schema: T
): Repository | undefined {
  const schemaName = (schema as any).name;
  return repositories[schemaName];
}

/**
 * Clear all cached repositories
 * Use this when shutting down the application or when repositories need to be recreated
 */
export function clearRepositories(): void {
  Object.keys(repositories).forEach((key) => {
    delete repositories[key];
  });
  console.log('🧹 Repository cache cleared');
}

/**
 * Refresh all existing repositories
 * Useful after Redis reconnection or failover
 */
export async function refreshRepositories(): Promise<void> {
  const schemaNames = Object.keys(repositories);

  if (schemaNames.length === 0) {
    return;
  }

  console.log(`⏳ Refreshing ${schemaNames.length} repositories...`);

  for (const schemaName of schemaNames) {
    try {
      const schema = (repositories[schemaName] as any).schema;
      const client = await redisManager.getRedisOmClient();
      repositories[schemaName] = client.fetchRepository(schema);
      await repositories[schemaName].createIndex();
      console.log(`✅ ${schemaName} repository refreshed`);
    } catch (error: any) {
      console.error(
        `❌ Failed to refresh ${schemaName} repository: ${error.message}`
      );
    }
  }

  console.log('✅ All repositories refreshed');
}

// Initialize repository refresh on client reconnection
redisManager.events.on('initialization-complete', async () => {
  await refreshRepositories();
});
