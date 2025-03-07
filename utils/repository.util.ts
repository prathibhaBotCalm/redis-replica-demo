import { connectRedisOmClient, redisClient, redisOmClient } from '@/lib/redis';
import { Entity, Repository, Schema } from 'redis-om';

// Map to store initialized repositories by schema name
const repositoryCache: Map<string, Repository<any>> = new Map();

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
  // Check if we already have this repository cached
  if (repositoryCache.has(schemaName)) {
    console.log(`Using cached repository for schema: ${schemaName}`);
    return repositoryCache.get(schemaName) as Repository<T>;
  }

  // Ensure Redis-OM client is connected
  await connectRedisOmClient();

  // Define the schema
  const schema = new Schema(schemaName, schemaDefinition);
  console.log(`Schema created for: ${schemaName}`);

  // Create the repository
  const repository = redisOmClient.fetchRepository(schema as Schema<T>);
  console.log(`Repository created for: ${schemaName}`);

  // Handle index creation with improved error handling
  try {
    await createIndexSafely(repository, schemaName, schemaDefinition);

    // Cache the repository for future use
    repositoryCache.set(schemaName, repository);

    return repository;
  } catch (err) {
    console.error(
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
 */
async function createIndexSafely<T extends Entity>(
  repository: Repository<T>,
  schemaName: string,
  schemaDefinition: Record<string, any>
): Promise<void> {
  const indexName = `${schemaName}Idx`;

  try {
    // First attempt: try to create the index directly
    console.log(`Attempting to create index for schema: ${schemaName}`);
    await repository.createIndex();
    console.log(
      `Repository index created successfully for schema: ${schemaName}`
    );
    return;
  } catch (err: any) {
    console.log(`Initial index creation failed for schema: ${schemaName}:`);

    // Check if the error is about missing field arguments
    if (err.message && err.message.includes('Fields arguments are missing')) {
      console.log(
        `Schema for ${schemaName} doesn't have any indexed fields. Adding default indexing.`
      );

      // Get the schema and modify it to include at least one indexed field
      // const schema = repository.schema;

      // Make sure at least one field is indexed (for example, 'id')
      const modifiedSchemaDefinition = { ...schemaDefinition };
      if (
        !Object.values(modifiedSchemaDefinition).some((field) => field.indexed)
      ) {
        // Add at least one indexed field
        if (modifiedSchemaDefinition.id) {
          if (modifiedSchemaDefinition.id) {
            modifiedSchemaDefinition.id = {
              ...modifiedSchemaDefinition.id,
              indexed: true,
            };
          } else {
            // If no id field exists, index the first string field
            const firstField = Object.keys(modifiedSchemaDefinition)[0];
            if (firstField) {
              modifiedSchemaDefinition[firstField] = {
                ...modifiedSchemaDefinition[firstField],
                indexed: true,
              };
            }
          }

          // Create a new repository with the modified schema
          const newSchema = new Schema(schemaName, modifiedSchemaDefinition);
          const newRepository = redisOmClient.fetchRepository(newSchema);

          // Replace the repository in the function scope
          Object.assign(repository, newRepository);

          // Try creating the index with the modified schema
          try {
            await repository.createIndex();
            console.log(
              `Repository index created successfully for schema: ${schemaName} with modified schema`
            );
            return;
          } catch (modifyErr: any) {
            console.log(
              `Failed to create index with modified schema: ${modifyErr.message}`
            );
          }
        }
      }

      // Check if the error indicates the index already exists
      if (
        err.message &&
        (err.message.includes('Index already exists') ||
          err.message.includes('already exists'))
      ) {
        console.log(
          `Index already exists for schema: ${schemaName}, using existing index`
        );
        return; // Use the existing index
      }

      // If the error is not related to an existing index, try to drop and recreate
      try {
        console.log(
          `Attempting to drop existing index for schema: ${schemaName}`
        );

        // Use direct Redis command to drop the index
        try {
          await redisClient.call('FT.DROPINDEX', indexName);
        } catch (dropErr: any) {
          // If the error is that the index doesn't exist, that's fine
          if (!dropErr.message.includes('Unknown Index name')) {
            throw dropErr;
          }
          console.log(`Index ${indexName} doesn't exist, no need to drop`);
        }

        console.log(`Successfully dropped index for schema: ${schemaName}`);

        // Try creating the index again
        console.log(
          `Attempting to create index for schema: ${schemaName} (second attempt)`
        );
        await repository.createIndex();
        console.log(
          `Repository index created successfully for schema: ${schemaName} (second attempt)`
        );
        return;
      } catch (dropErr: any) {
        console.log(
          `Error during index drop/recreation for schema: ${schemaName}:`,
          dropErr.message
        );

        // One more attempt: try to create index without dropping
        // Sometimes the index doesn't exist but the error message is misleading
        try {
          console.log(
            `Final attempt to create index for schema: ${schemaName}`
          );

          // Try using direct FT.CREATE command for more control
          const prefix = `${schemaName}:`;

          // Build field specifications
          let fieldSpecs: string[] = [];
          for (const [fieldName, fieldDef] of Object.entries(
            schemaDefinition
          )) {
            if (fieldDef.type === 'string') {
              fieldSpecs.push(`${fieldName} TEXT`);
            } else if (fieldDef.type === 'number') {
              fieldSpecs.push(`${fieldName} NUMERIC`);
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
            console.log(`Created index using direct command: ${indexName}`);
          } catch (ftErr: any) {
            // If index already exists, that's okay
            if (
              ftErr.message &&
              ftErr.message.includes('Index already exists')
            ) {
              console.log(`Index ${indexName} already exists`);
            } else {
              throw ftErr;
            }
          }

          console.log(
            `Repository index created successfully for schema: ${schemaName} (final attempt)`
          );
          return;
        } catch (finalErr: any) {
          console.error(
            `All attempts to create index for schema: ${schemaName} failed:`,
            finalErr.message
          );

          // Even if we fail, let's not block the application from starting
          console.log(`Continuing without index for ${schemaName}`);
        }
      }
    }
  }
}
// Export public APIs
export { redisClient };
