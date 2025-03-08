import * as baseLogger from '@/lib/logger';
import {
  ensureMasterConnection,
  redisClient,
  redisOmClient,
} from '@/lib/redis';
import { Entity, Repository, Schema } from 'redis-om';

const logger = baseLogger.createContextLogger('RepositoryUtil');

// Map to store initialized repositories by schema name
const repositoryCache: Map<string, Repository<any>> = new Map();

// Track index creation status to avoid redundant operations
const indexCreationStatus: Map<string, Promise<void>> = new Map();

/**
 * Initialize a repository for a given schema and create its indexes.
 * @param schemaName - The name of the schema (e.g., 'User').
 * @param schemaDefinition - The schema definition.
 * @returns The initialized repository.
 */
export async function initializeRepository<T extends Entity>(
  schemaName: string,
  schemaDefinition: Record<string, any>
): Promise<Repository<T>> {
  logger.debug(`Initializing repository for schema: ${schemaName}`);

  // Check if we already have this repository cached
  if (repositoryCache.has(schemaName)) {
    const cachedRepo = repositoryCache.get(schemaName) as Repository<T>;

    try {
      // Verify the repository connection is still valid with a simple operation
      await cachedRepo.search().return.count();
      logger.debug(`Using cached repository for schema: ${schemaName}`);
      return cachedRepo;
    } catch (err) {
      logger.warn(
        `Cached repository for ${schemaName} is invalid, recreating:`,
        err
      );
      // Continue with creating a new repository
    }
  }

  // Ensure Redis-OM client is connected and pointing to the current master
  try {
    await ensureMasterConnection();
  } catch (err) {
    logger.error(`Failed to ensure master connection:`, err);
    throw new Error(
      `Cannot initialize repository due to Redis connection issue: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // Define the schema
  const schema = new Schema(schemaName, schemaDefinition);
  logger.debug(`Schema created for: ${schemaName}`);

  // Create the repository
  const repository = redisOmClient?.fetchRepository(schema as Schema<T>);
  logger.debug(`Repository created for: ${schemaName}`);

  // Handle index creation
  try {
    // Create or use existing index creation promise to prevent parallel attempts
    let indexPromise = indexCreationStatus.get(schemaName);

    if (!indexPromise) {
      indexPromise = createIndexSafely(
        repository as Repository<T>,
        schemaName,
        schemaDefinition
      );
      indexCreationStatus.set(schemaName, indexPromise);

      // Clean up the promise from the map after completion or failure
      indexPromise
        .then(() => {
          indexCreationStatus.delete(schemaName);
        })
        .catch(() => {
          indexCreationStatus.delete(schemaName);
        });
    }

    await indexPromise;

    // Cache the repository for future use
    repositoryCache.set(schemaName, repository as Repository<T>);

    return repository as Repository<T>;
  } catch (err) {
    logger.error(
      `Critical error creating index for schema: ${schemaName}`,
      err
    );
    throw err;
  }
}

/**
 * Create index safely with improved error handling
 * @param repository - The repository to create indexes for.
 * @param schemaName - The name of the schema being used.
 * @param schemaDefinition - The schema definition used to create the repository.
 */
async function createIndexSafely<T extends Entity>(
  repository: Repository<T>,
  schemaName: string,
  schemaDefinition: Record<string, any>
): Promise<void> {
  const indexName = `${schemaName}Idx`;
  const maxRetries = 3;
  let retries = 0;

  const normalizedSchemaDefinition = { ...schemaDefinition };

  // Ensure we have at least one indexed field
  ensureIndexedFields(normalizedSchemaDefinition);

  while (retries < maxRetries) {
    try {
      logger.debug(
        `Attempting to create index for schema: ${schemaName} (attempt ${
          retries + 1
        }/${maxRetries})`
      );
      await repository.createIndex();
      logger.info(
        `Repository index created successfully for schema: ${schemaName}`
      );
      return;
    } catch (err: any) {
      retries++;

      // Check if index already exists - this is not an error
      if (err.message && err.message.includes('Index already exists')) {
        logger.info(
          `Index for schema ${schemaName} already exists, using existing index`
        );
        return;
      }

      logger.warn(`Index creation failed for schema: ${schemaName}:`, err);

      if (retries >= maxRetries) {
        // Try dropping and recreating index as last resort
        try {
          logger.debug(
            `Attempting to drop and recreate index for schema: ${schemaName}`
          );
          await dropIndex(indexName);
          await repository.createIndex();
          logger.info(
            `Repository index recreated successfully for schema: ${schemaName}`
          );
          return;
        } catch (dropErr: any) {
          logger.error(
            `Failed to drop and recreate index for schema: ${schemaName}:`,
            dropErr
          );

          // Fall back to direct FT.CREATE command
          try {
            await createIndexDirectly(schemaName, normalizedSchemaDefinition);
            return;
          } catch (directErr: any) {
            logger.error(
              `Direct index creation failed for schema: ${schemaName}:`,
              directErr
            );
            throw directErr;
          }
        }
      }

      // Wait before retrying (exponential backoff)
      const delay = Math.min(Math.pow(2, retries) * 500, 5000);
      logger.debug(
        `Retrying index creation in ${delay}ms for schema: ${schemaName}`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Ensure at least one field is indexed in the schema definition
 */
function ensureIndexedFields(schemaDefinition: Record<string, any>): void {
  // Check if any field is already marked for indexing
  const hasIndexedField = Object.values(schemaDefinition).some(
    (field: any) => field.indexed === true
  );

  if (!hasIndexedField) {
    // Index the ID field if it exists
    if (schemaDefinition.id) {
      schemaDefinition.id = {
        ...schemaDefinition.id,
        indexed: true,
      };
    } else {
      // Find the first field and make it indexed
      const firstFieldName = Object.keys(schemaDefinition)[0];
      if (firstFieldName) {
        schemaDefinition[firstFieldName] = {
          ...schemaDefinition[firstFieldName],
          indexed: true,
        };
      }
    }
  }
}

/**
 * Drop an index using direct Redis commands
 */
async function dropIndex(indexName: string): Promise<void> {
  try {
    await redisClient?.call('FT.DROPINDEX', indexName);
    logger.debug(`Successfully dropped index: ${indexName}`);
  } catch (err: any) {
    // If the index doesn't exist, that's fine
    if (err.message && err.message.includes('Unknown Index name')) {
      logger.debug(`Index ${indexName} doesn't exist, no need to drop`);
      return;
    }
    throw err;
  }
}

/**
 * Create an index using direct Redis commands
 */
async function createIndexDirectly(
  schemaName: string,
  schemaDefinition: Record<string, any>
): Promise<void> {
  const indexName = `${schemaName}Idx`;
  const prefix = `${schemaName}:`;

  logger.debug(`Creating index directly for schema: ${schemaName}`);

  // Build field specifications
  const fieldSpecs: string[] = [];

  for (const [fieldName, fieldDef] of Object.entries(schemaDefinition)) {
    if (fieldDef.type === 'string' || fieldDef.type === 'text') {
      fieldSpecs.push(`${fieldName} TEXT`);
    } else if (fieldDef.type === 'number') {
      fieldSpecs.push(`${fieldName} NUMERIC`);
    } else if (fieldDef.type === 'boolean') {
      fieldSpecs.push(`${fieldName} TAG`);
    }
  }

  // If no fields were added, add at least one
  if (fieldSpecs.length === 0) {
    fieldSpecs.push('id TEXT');
  }

  // Create the index
  try {
    const args = [
      'FT.CREATE',
      indexName,
      'ON',
      'HASH',
      'PREFIX',
      '1',
      prefix,
      'SCHEMA',
      ...fieldSpecs.flatMap((spec) => spec.split(' ')),
    ];

    await redisClient?.call(args[0], ...args.slice(1));
    logger.info(`Created index using direct command: ${indexName}`);
  } catch (err: any) {
    // If index already exists, that's okay
    if (err.message && err.message.includes('Index already exists')) {
      logger.info(`Index ${indexName} already exists through direct creation`);
      return;
    }
    throw err;
  }
}

/**
 * Clear the repository cache (useful for testing or after major schema changes)
 */
export function clearRepositoryCache(): void {
  repositoryCache.clear();
  logger.info('Repository cache cleared');
}

/**
 * Check repository health by verifying connection to Redis
 */
export async function checkRepositoryHealth(): Promise<{
  healthy: boolean;
  repositories: string[];
  error?: string;
}> {
  try {
    // Verify Redis connection
    await redisClient?.ping();

    // Check repositories
    const repositories = Array.from(repositoryCache.keys());

    return {
      healthy: true,
      repositories,
    };
  } catch (err) {
    return {
      healthy: false,
      repositories: Array.from(repositoryCache.keys()),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Export public APIs
export { redisClient };
