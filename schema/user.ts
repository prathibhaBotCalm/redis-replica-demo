// // user.repository.ts
// import { initializeRepository } from '@/utils/repository.util';
// import { Entity } from 'redis-om';

// // Define the User entity interface
// interface UserEntity extends Entity {
//   id: string;
//   name: string;
//   email?: string;
//   age?: number;
// }

// // Define the schema with explicit indexing
// const userSchema = {
//   id: { type: 'string', indexed: true },
//   name: { type: 'string', indexed: true },
//   email: { type: 'string', indexed: true },
//   age: { type: 'number', indexed: true },
// };

// // Initialize the user repository
// export const userRepository = initializeRepository<UserEntity>(
//   'User',
//   userSchema
// );

import * as baseLogger from '@/lib/logger';
import { initializeRepository } from '@/utils/repository.util';
import { Entity } from 'redis-om';

const logger = baseLogger.createContextLogger('UserRepository');

// Define the User entity interface
interface UserEntity extends Entity {
  id: string;
  name: string;
  email?: string;
  age?: number;
}

// Define the schema with explicit indexing
const userSchema = {
  id: { type: 'string', indexed: true },
  name: { type: 'string', indexed: true },
  email: { type: 'string', indexed: true },
  age: { type: 'number', indexed: true },
};

/**
 * Get a fresh user repository instance
 */
export async function getUserRepository() {
  try {
    logger.info('Getting user repository...');
    return await initializeRepository<UserEntity>('User', userSchema);
  } catch (err: any) {
    logger.error(`Error getting user repository: ${err.message}`);
    throw err;
  }
}

// For backward compatibility
export const userRepository = getUserRepository();
