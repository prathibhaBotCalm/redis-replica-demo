import { Repository, Schema } from 'redis-om';
import { initializeRedisOmClient, redisEventEmitter } from '../lib/redis';

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
      let redisOmClient = await initializeRedisOmClient();

      // Ensure redis-om client is open before using it
      if (!redisOmClient.isOpen()) {
        console.error('❌ Redis-OM client is not open. Retrying...');
        redisOmClient = await initializeRedisOmClient(); // Retry
      }

      const repository = redisOmClient.fetchRepository(schema);
      await repository.createIndex();

      repositories[schemaName] = repository;
      console.log(`${schemaName} repository and index initialized`);

      // Listen for client reinitialization and update repository
      redisEventEmitter.on('client-reinitialized', async (newClient) => {
        try {
          console.log(
            `Reinitializing ${schemaName} repository with new client`
          );
          repositories[schemaName] = newClient.fetchRepository(schema);
          await repositories[schemaName].createIndex();
          console.log(`${schemaName} repository reinitialized`);
        } catch (error) {
          console.error(
            `Failed to reinitialize ${schemaName} repository:`,
            error
          );
        }
      });
    } catch (error) {
      console.error(`Failed to initialize ${schemaName} repository:`, error);
      throw error;
    }
  }

  return repositories[schemaName];
}
