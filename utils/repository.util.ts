// import { getRedisOmClient, redisClient } from '@/lib/redis';
// import { Entity, Repository, Schema } from 'redis-om';

// // Map to store initialized repositories by schema name
// const repositoryCache: Map<string, Repository<any>> = new Map();

// /**
//  * Initialize a repository for a given schema and create its indexes.
//  * @param schemaName - The name of the schema (e.g., 'User').
//  * @param schemaDefinition - The schema definition.
//  * @returns The initialized repository.
//  */
// export async function initializeRepository<T extends Entity>(
//   schemaName: string,
//   schemaDefinition: Record<string, any>
// ): Promise<Repository<T>> {
//   // Check if we already have this repository cached
//   if (repositoryCache.has(schemaName)) {
//     const cachedRepo = repositoryCache.get(schemaName) as Repository<T>;

//     // Verify the cached repository is still working
//     try {
//       // A simple operation to check if the repository is still valid
//       await cachedRepo.search().returnAll();
//       console.log(`Using cached repository for schema: ${schemaName}`);
//       return cachedRepo;
//     } catch (err) {
//       console.log(
//         `Cached repository for ${schemaName} is stale, creating new one`
//       );
//       repositoryCache.delete(schemaName);
//       // Continue to create a new repository
//     }
//   }

//   // Get a fresh Redis-OM client
//   const redisOmClient = await getRedisOmClient();
//   console.log(`Using fresh Redis-OM client for schema: ${schemaName}`);

//   // Define the schema
//   const schema = new Schema(schemaName, schemaDefinition);
//   console.log(`Schema created for: ${schemaName}`);

//   // Create the repository
//   const repository = redisOmClient.fetchRepository(schema as Schema<T>);
//   console.log(`Repository created for: ${schemaName}`);

//   // Handle index creation with improved error handling
//   try {
//     await createIndexSafely(repository, schemaName, schemaDefinition);

//     // Cache the repository for future use
//     repositoryCache.set(schemaName, repository);

//     return repository;
//   } catch (err) {
//     console.error(
//       `Critical error creating index for schema: ${schemaName}`,
//       err
//     );
//     throw err;
//   }
// }

// /**
//  * Create index safely with improved error handling
//  * @param repository - The repository to create indexes for.
//  * @param schemaName - The name of the schema being used.
//  * @param schemaDefinition - The schema definition.
//  */
// async function createIndexSafely<T extends Entity>(
//   repository: Repository<T>,
//   schemaName: string,
//   schemaDefinition: Record<string, any>
// ): Promise<void> {
//   const indexName = `${schemaName}Idx`;

//   try {
//     // First attempt: try to create the index directly
//     console.log(`Attempting to create index for schema: ${schemaName}`);
//     await repository.createIndex();
//     console.log(
//       `Repository index created successfully for schema: ${schemaName}`
//     );
//     return;
//   } catch (err: any) {
//     console.log(
//       `Initial index creation failed for schema: ${schemaName}:`,
//       err.message
//     );

//     // Check if the error indicates the index already exists
//     if (
//       err.message &&
//       (err.message.includes('Index already exists') ||
//         err.message.includes('already exists'))
//     ) {
//       console.log(
//         `Index already exists for schema: ${schemaName}, using existing index`
//       );
//       return; // Use the existing index
//     }

//     // Check if the error is about missing field arguments
//     if (err.message && err.message.includes('Fields arguments are missing')) {
//       console.log(
//         `Schema for ${schemaName} doesn't have any indexed fields. Adding default indexing.`
//       );

//       // Make sure at least one field is indexed
//       const modifiedSchemaDefinition = { ...schemaDefinition };
//       if (
//         !Object.values(modifiedSchemaDefinition).some((field) => field.indexed)
//       ) {
//         // Add at least one indexed field - preferably the id field
//         if (modifiedSchemaDefinition.id) {
//           modifiedSchemaDefinition.id = {
//             ...modifiedSchemaDefinition.id,
//             indexed: true,
//           };
//         } else {
//           // If no id field exists, index the first string field
//           const firstField = Object.keys(modifiedSchemaDefinition)[0];
//           if (firstField) {
//             modifiedSchemaDefinition[firstField] = {
//               ...modifiedSchemaDefinition[firstField],
//               indexed: true,
//             };
//           }
//         }

//         // Create a new repository with the modified schema
//         const redisOmClient = await getRedisOmClient();
//         const newSchema = new Schema(schemaName, modifiedSchemaDefinition);
//         const newRepository = redisOmClient.fetchRepository(newSchema);

//         // Try creating the index with the modified schema
//         try {
//           await newRepository.createIndex();
//           console.log(
//             `Repository index created successfully for schema: ${schemaName} with modified schema`
//           );

//           // Replace the repository in the cache
//           repositoryCache.set(schemaName, newRepository);

//           // Copy over the modified repository to the original reference
//           Object.assign(repository, newRepository);

//           return;
//         } catch (modifyErr: any) {
//           console.log(
//             `Failed to create index with modified schema: ${modifyErr.message}`
//           );
//           // Continue to try dropping and recreating the index
//         }
//       }
//     }

//     // Try to drop and recreate the index
//     try {
//       console.log(
//         `Attempting to drop existing index for schema: ${schemaName}`
//       );

//       // Use direct Redis command to drop the index
//       try {
//         await redisClient.call('FT.DROPINDEX', indexName);
//         console.log(`Successfully dropped index for schema: ${schemaName}`);
//       } catch (dropErr: any) {
//         // If the error is that the index doesn't exist, that's fine
//         if (
//           dropErr.message &&
//           !dropErr.message.includes('Unknown Index name')
//         ) {
//           throw dropErr;
//         }
//         console.log(`Index ${indexName} doesn't exist, no need to drop`);
//       }

//       // Try creating the index again
//       console.log(
//         `Attempting to create index for schema: ${schemaName} (second attempt)`
//       );
//       await repository.createIndex();
//       console.log(
//         `Repository index created successfully for schema: ${schemaName} (second attempt)`
//       );
//       return;
//     } catch (recreateErr: any) {
//       console.log(
//         `Error during index drop/recreation for schema: ${schemaName}:`,
//         recreateErr.message
//       );

//       // Final attempt: try to create index using direct FT.CREATE command
//       try {
//         console.log(`Final attempt to create index for schema: ${schemaName}`);

//         const prefix = `${schemaName}:`;

//         // Build field specifications
//         const fieldSpecs: string[] = [];
//         for (const [fieldName, fieldDef] of Object.entries(schemaDefinition)) {
//           if (fieldDef.type === 'string') {
//             fieldSpecs.push(`${fieldName} TEXT`);
//           } else if (fieldDef.type === 'number') {
//             fieldSpecs.push(`${fieldName} NUMERIC`);
//           }
//         }

//         // If no fields were added, add at least one
//         if (fieldSpecs.length === 0) {
//           fieldSpecs.push('id TEXT');
//         }

//         // Create the index
//         try {
//           const args = [
//             'FT.CREATE',
//             indexName,
//             'ON',
//             'HASH',
//             'PREFIX',
//             '1',
//             prefix,
//             'SCHEMA',
//             ...fieldSpecs.flatMap((spec) => spec.split(' ')),
//           ];

//           await redisClient.call(args[0], ...args.slice(1));
//           console.log(`Created index using direct command: ${indexName}`);
//           return;
//         } catch (ftErr: any) {
//           // If index already exists, that's okay
//           if (ftErr.message && ftErr.message.includes('Index already exists')) {
//             console.log(`Index ${indexName} already exists`);
//             return;
//           }
//           throw ftErr;
//         }
//       } catch (finalErr: any) {
//         console.error(
//           `All attempts to create index for schema: ${schemaName} failed:`,
//           finalErr.message
//         );

//         // Even if we fail, let's not block the application from starting
//         console.log(`Continuing without index for ${schemaName}`);
//         return;
//       }
//     }
//   }
// }

// // Export public APIs
// export { redisClient };


import { getRedisOmClient, redisClient } from '@/lib/redis';
import { Entity, Repository, Schema } from 'redis-om';
import * as baseLogger from '@/lib/logger';

const logger = baseLogger.createContextLogger('Repository');

// Map to store initialized repositories by schema name
const repositoryCache: Map<
  string,
  { repository: Repository<any>; timestamp: number }
> = new Map();

// Max age for cached repositories (5 seconds)
const CACHE_MAX_AGE_MS = 5000;

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
  // Check if we already have this repository cached and it's fresh enough
  const now = Date.now();
  if (repositoryCache.has(schemaName)) {
    const cached = repositoryCache.get(schemaName)!;

    // Only use cache if it's fresh (within the last 5 seconds)
    if (now - cached.timestamp < CACHE_MAX_AGE_MS) {
      try {
        // A simple operation to check if the repository is still valid
        await cached.repository.search().count();
        logger.info(
          `Using cached repository for schema: ${schemaName} (age: ${
            now - cached.timestamp
          }ms)`
        );
        return cached.repository as Repository<T>;
      } catch (err:any) {
        logger.warn(
          `Cached repository for ${schemaName} is stale, creating new one: ${err.message}`
        );
      }
    } else {
      logger.info(
        `Cached repository for ${schemaName} expired, creating new one`
      );
    }

    // Remove the stale repository from cache
    repositoryCache.delete(schemaName);
  }

  try {
    // Get a fresh Redis-OM client
    const redisOmClient = await getRedisOmClient();
    logger.info(`Using fresh Redis-OM client for schema: ${schemaName}`);

    // Define the schema
    const schema = new Schema(schemaName, schemaDefinition);
    logger.info(`Schema created for: ${schemaName}`);

    // Create the repository
    const repository = redisOmClient.fetchRepository(schema as Schema<T>);
    logger.info(`Repository created for: ${schemaName}`);

    // Handle index creation with improved error handling
    await createIndexSafely(repository, schemaName, schemaDefinition);

    // Test the repository with a simple operation - we'll catch and handle any errors
    try {
      await repository.search().count();
      logger.info(`Successfully tested repository: ${schemaName}`);
    } catch (testErr: any) {
      logger.error(
        `Repository test failed for ${schemaName}: ${testErr.message}`
      );

      // If the test failed because of an index issue, force recreate the index
      if (testErr.message && testErr.message.includes('no such index')) {
        logger.info(`Attempting to force recreate index for ${schemaName}`);
        await forceCreateIndex(repository, schemaName, schemaDefinition);
      } else {
        throw testErr;
      }
    }

    // Cache the repository for future use (with a timestamp)
    repositoryCache.set(schemaName, { repository, timestamp: now });

    return repository;
  } catch (err: any) {
    logger.error(
      `Failed to initialize repository for ${schemaName}: ${err.message}`
    );
    throw new Error(`Repository initialization failed: ${err.message}`);
  }
}

/**
 * Force create an index for a repository by bypassing Redis-OM and using direct Redis commands
 */
async function forceCreateIndex<T extends Entity>(
  repository: Repository<T>,
  schemaName: string,
  schemaDefinition: Record<string, any>
): Promise<void> {
  try {
    // First try to drop any existing index
    const indexName = `${schemaName}Idx`;
    try {
      logger.info(`Attempting to forcefully drop index: ${indexName}`);
      await redisClient.call('FT.DROPINDEX', indexName);
    } catch (dropErr: any) {
      // Ignore errors if the index doesn't exist
      if (!dropErr.message.includes('Unknown index name')) {
        logger.warn(`Error dropping index ${indexName}: ${dropErr.message}`);
      }
    }

    // Build field specifications for direct Redis command
    const prefix = `${schemaName}:`;
    const fieldSpecs: string[] = [];

    // Add fields based on schema definition
    for (const [fieldName, fieldDef] of Object.entries(schemaDefinition)) {
      if (fieldDef.type === 'string') {
        fieldSpecs.push(`${fieldName} TEXT SORTABLE`);
      } else if (fieldDef.type === 'number') {
        fieldSpecs.push(`${fieldName} NUMERIC SORTABLE`);
      } else if (fieldDef.type === 'boolean') {
        fieldSpecs.push(`${fieldName} TAG`);
      } else if (fieldDef.type === 'date') {
        fieldSpecs.push(`${fieldName} NUMERIC SORTABLE`);
      }
    }

    // If no fields were added, add at least the id field
    if (fieldSpecs.length === 0) {
      fieldSpecs.push('id TEXT SORTABLE');
    }

    // Create the index directly with Redis command
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

    logger.info(
      `Creating index with command: FT.CREATE ${indexName} ON HASH PREFIX 1 ${prefix} SCHEMA ${fieldSpecs.join(
        ' '
      )}`
    );
    await redisClient.call(args[0], ...args.slice(1));
    logger.info(`Successfully created index: ${indexName}`);

    // Test the index after creation
    const testResult = await redisClient.call('FT.INFO', indexName);
    logger.info(`Index verification successful for ${indexName}`);
  } catch (err: any) {
    logger.error(
      `Error forcefully creating index ${schemaName}Idx: ${err.message}`
    );
    throw new Error(`Failed to create index: ${err.message}`);
  }
}

/**
 * Create index safely with improved error handling
 */
async function createIndexSafely<T extends Entity>(
  repository: Repository<T>,
  schemaName: string,
  schemaDefinition: Record<string, any>
): Promise<void> {
  const indexName = `${schemaName}Idx`;

  try {
    // Check if index already exists before trying to create it
    let indexExists = false;
    try {
      await redisClient.call('FT.INFO', indexName);
      indexExists = true;
      logger.info(`Index ${indexName} already exists`);
    } catch (infoErr: any) {
      if (infoErr.message && infoErr.message.includes('Unknown index name')) {
        logger.info(`Index ${indexName} doesn't exist yet, will create it`);
      } else {
        logger.warn(`Unexpected error checking index: ${infoErr.message}`);
      }
    }

    // If index already exists, no need to create it
    if (indexExists) {
      return;
    }

    // First attempt: try to create the index directly
    logger.info(`Attempting to create index for schema: ${schemaName}`);
    await repository.createIndex();
    logger.info(
      `Repository index created successfully for schema: ${schemaName}`
    );
    return;
  } catch (err: any) {
    logger.warn(
      `Initial index creation failed for schema: ${schemaName}: ${err.message}`
    );

    // Check if the error indicates the index already exists
    if (
      err.message &&
      (err.message.includes('Index already exists') ||
        err.message.includes('already exists'))
    ) {
      logger.info(
        `Index already exists for schema: ${schemaName}, using existing index`
      );
      return; // Use the existing index
    }

    // If any other error, try the force method
    logger.info(`Falling back to force index creation for ${schemaName}`);
    await forceCreateIndex(repository, schemaName, schemaDefinition);
  }
}

// Expose a method to clear all repositories (useful for manual reconnect)
export async function clearRepositoryCache(): Promise<void> {
  logger.info('Clearing repository cache');
  repositoryCache.clear();
}

// Export public APIs
export { redisClient };