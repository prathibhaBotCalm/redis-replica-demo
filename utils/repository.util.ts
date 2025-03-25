import * as baseLogger from '@/lib/logger';
import {
  ensureMasterConnection,
  redisClient,
  redisOmClient,
} from '@/lib/redis';
import { Entity, Repository, Schema } from 'redis-om';

const logger = baseLogger.createContextLogger('RepositoryUtil');

// Constants for configuration
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_CACHE_TTL_MS = 300000; // 5 minutes cache validity
const DEFAULT_BACKOFF_BASE_MS = 500;
const DEFAULT_BACKOFF_MAX_MS = 5000;

// Repository cache with additional metadata
interface CachedRepository<T extends Entity> {
  repository: Repository<T>;
  timestamp: number; // When this repository was cached
  lastUsed: number; // Last time this repository was used
  validationCount: number; // Number of times validation was performed
}

// Map to store initialized repositories by schema name
const repositoryCache = new Map<string, CachedRepository<any>>();

// Track index creation status to avoid redundant operations
const indexCreationStatus = new Map<string, Promise<void>>();

/**
 * Initialize a repository for a given schema and create its indexes.
 *
 * @param schemaName - The name of the schema (e.g., 'User').
 * @param schemaDefinition - The schema definition.
 * @param options - Additional options for repository initialization
 * @returns The initialized repository.
 */
export async function initializeRepository<T extends Entity>(
  schemaName: string,
  schemaDefinition: Record<string, any>,
  options: {
    forceRefresh?: boolean;
    cacheTtlMs?: number;
    maxRetries?: number;
  } = {}
): Promise<Repository<T>> {
  const {
    forceRefresh = false,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
  } = options;

  const now = Date.now();
  logger.debug(`Initializing repository for schema: ${schemaName}`);

  // Check if we already have this repository cached and it's not forced to refresh
  if (!forceRefresh && repositoryCache.has(schemaName)) {
    const cachedRepo = repositoryCache.get(schemaName)!;

    // Check if the cache is still valid based on TTL
    if (now - cachedRepo.timestamp < cacheTtlMs) {
      try {
        // Verify the repository connection is still valid with a simple operation
        await cachedRepo.repository.search().return.count();

        // Update usage metadata
        cachedRepo.lastUsed = now;
        cachedRepo.validationCount++;
        repositoryCache.set(schemaName, cachedRepo);

        logger.debug(
          `Using cached repository for schema: ${schemaName} (validated ${cachedRepo.validationCount} times)`
        );
        return cachedRepo.repository as Repository<T>;
      } catch (err) {
        logger.warn(
          `Cached repository for ${schemaName} is invalid despite being within TTL, recreating:`,
          err
        );
        // Continue with creating a new repository
      }
    } else {
      logger.debug(
        `Cached repository for ${schemaName} expired (age: ${
          (now - cachedRepo.timestamp) / 1000
        }s), refreshing`
      );
    }
  } else if (forceRefresh) {
    logger.debug(`Forced refresh requested for repository: ${schemaName}`);
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

  // Create the repository - Verify redisOmClient exists first
  if (!redisOmClient) {
    throw new Error('Redis OM client is not initialized');
  }

  const repository = redisOmClient.fetchRepository(schema as Schema<T>);
  logger.debug(`Repository created for: ${schemaName}`);

  // Handle index creation
  try {
    // Create or use existing index creation promise to prevent parallel attempts
    let indexPromise = indexCreationStatus.get(schemaName);

    if (!indexPromise) {
      indexPromise = createIndexSafely(
        repository as Repository<T>,
        schemaName,
        schemaDefinition,
        maxRetries
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

    // Cache the repository with metadata for future use
    repositoryCache.set(schemaName, {
      repository: repository as Repository<T>,
      timestamp: now,
      lastUsed: now,
      validationCount: 0,
    });

    // If cache is getting too large, perform cache cleanup
    if (repositoryCache.size > 50) {
      // Arbitrary limit, adjust as needed
      cleanupRepositoryCache();
    }

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
 *
 * @param repository - The repository to create indexes for.
 * @param schemaName - The name of the schema being used.
 * @param schemaDefinition - The schema definition used to create the repository.
 * @param maxRetries - Maximum number of retry attempts
 */
async function createIndexSafely<T extends Entity>(
  repository: Repository<T>,
  schemaName: string,
  schemaDefinition: Record<string, any>,
  maxRetries: number
): Promise<void> {
  const indexName = `${schemaName}Idx`;
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

      // Handle specific Redis error types
      if (isConnectionError(err)) {
        logger.error(
          `Redis connection error during index creation: ${err.message}`
        );
        // For connection errors, we might want to retry with ensureMasterConnection first
        try {
          await ensureMasterConnection();
        } catch (masterErr) {
          logger.error(
            `Failed to reconnect to Redis master: ${
              masterErr instanceof Error ? masterErr.message : String(masterErr)
            }`
          );
        }
      } else {
        logger.warn(`Index creation failed for schema: ${schemaName}:`, err);
      }

      if (retries >= maxRetries) {
        // Try alternative approaches when regular creation fails
        return await attemptFallbackIndexCreation(
          repository,
          schemaName,
          indexName,
          normalizedSchemaDefinition
        );
      }

      // Wait before retrying (exponential backoff)
      const delay = Math.min(
        Math.pow(2, retries) * DEFAULT_BACKOFF_BASE_MS,
        DEFAULT_BACKOFF_MAX_MS
      );
      logger.debug(
        `Retrying index creation in ${delay}ms for schema: ${schemaName}`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Determine if an error is a connection-related error
 *
 * @param err - The error to check
 * @returns True if this is a connection error
 */
function isConnectionError(err: any): boolean {
  if (!err || !err.message) return false;

  const msg = err.message.toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('connection closed') ||
    msg.includes('readonly') ||
    msg.includes('connection needs to be open')
  );
}

/**
 * Attempts different fallback approaches to create an index when the standard approach fails
 */
async function attemptFallbackIndexCreation<T extends Entity>(
  repository: Repository<T>,
  schemaName: string,
  indexName: string,
  normalizedSchemaDefinition: Record<string, any>
): Promise<void> {
  // Try dropping and recreating index as first fallback
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

    // Fall back to direct FT.CREATE command as second fallback
    try {
      logger.debug(`Attempting direct FT.CREATE for schema: ${schemaName}`);
      await createIndexDirectly(schemaName, normalizedSchemaDefinition);
      logger.info(`Created index directly for schema: ${schemaName}`);
      return;
    } catch (directErr: any) {
      logger.error(
        `Direct index creation failed for schema: ${schemaName}:`,
        directErr
      );

      // All approaches failed, throw the error
      throw directErr;
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
  if (!redisClient) {
    throw new Error('Redis client is not initialized');
  }

  try {
    await redisClient.call('FT.DROPINDEX', indexName);
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
  if (!redisClient) {
    throw new Error('Redis client is not initialized');
  }

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

    await redisClient.call(args[0], ...args.slice(1));
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
 * Clean up old or infrequently used repositories from the cache
 */
function cleanupRepositoryCache(): void {
  const now = Date.now();

  // Sort repositories by last used time
  const entries = Array.from(repositoryCache.entries()).sort(
    (a, b) => a[1].lastUsed - b[1].lastUsed
  );

  // Remove the oldest 1/3 of cached repositories
  const removeCount = Math.floor(entries.length / 3);

  if (removeCount > 0) {
    let removed = 0;

    for (const [key, value] of entries) {
      if (removed >= removeCount) break;

      // Only remove if not used in the last 10 minutes
      if (now - value.lastUsed > 600000) {
        repositoryCache.delete(key);
        removed++;
        logger.debug(
          `Cleaned up unused repository from cache: ${key} (last used ${
            (now - value.lastUsed) / 1000
          }s ago)`
        );
      }
    }

    logger.info(
      `Repository cache cleanup: removed ${removed} of ${entries.length} cached repositories`
    );
  }
}

/**
 * Clear the repository cache (useful for testing or after major schema changes)
 */
export function clearRepositoryCache(): void {
  const count = repositoryCache.size;
  repositoryCache.clear();
  logger.info(`Repository cache cleared (${count} repositories removed)`);
}

/**
 * Get a repository with specified options or defaults
 *
 * @param schemaName - The schema name to get a repository for
 * @param schemaDefinition - The schema definition
 * @param forceRefresh - Whether to force a refresh of the repository
 * @returns The repository instance
 */
export async function getRepository<T extends Entity>(
  schemaName: string,
  schemaDefinition: Record<string, any>,
  forceRefresh = false
): Promise<Repository<T>> {
  return initializeRepository<T>(schemaName, schemaDefinition, {
    forceRefresh,
  });
}

/**
 * Invalidate a specific repository in the cache
 *
 * @param schemaName - The schema name to invalidate
 */
export function invalidateRepository(schemaName: string): void {
  if (repositoryCache.has(schemaName)) {
    repositoryCache.delete(schemaName);
    logger.info(`Repository cache invalidated for: ${schemaName}`);
  }
}

/**
 * Check repository health by verifying connection to Redis and repository validity
 */
export async function checkRepositoryHealth(): Promise<{
  healthy: boolean;
  repositories: Array<{
    name: string;
    age: number;
    usageCount: number;
  }>;
  error?: string;
}> {
  try {
    // Verify Redis connection
    if (!redisClient) {
      return {
        healthy: false,
        repositories: [],
        error: 'Redis client is not initialized',
      };
    }

    await redisClient.ping();

    // Check repositories
    const now = Date.now();
    const repositories = Array.from(repositoryCache.entries()).map(
      ([name, data]) => ({
        name,
        age: now - data.timestamp,
        usageCount: data.validationCount,
      })
    );

    return {
      healthy: true,
      repositories,
    };
  } catch (err) {
    return {
      healthy: false,
      repositories: Array.from(repositoryCache.entries()).map(
        ([name, data]) => ({
          name,
          age: Date.now() - data.timestamp,
          usageCount: data.validationCount,
        })
      ),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Export public APIs
export { redisClient };
