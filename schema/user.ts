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

import { initializeRepository } from '@/utils/repository.util';
import { Entity } from 'redis-om';
import * as baseLogger from '@/lib/logger';

const logger = baseLogger.createContextLogger('UserSchema');

// Define the User entity interface
export interface UserEntity extends Entity {
  id: string;
  name: string;
  email?: string;
  age?: number;
}

// Define the schema with explicit indexing
export const userSchema = {
  id: { type: 'string', indexed: true },
  name: { type: 'string', indexed: true },
  email: { type: 'string', indexed: true },
  age: { type: 'number', indexed: true },
};

/**
 * Get the user repository instance
 * This approach ensures we get a fresh repository connected to the current master
 */
export async function getUserRepository() {
  try {
    return await initializeRepository<UserEntity>('User', userSchema);
  } catch (error) {
    logger.error('Failed to initialize user repository:', error);
    throw new Error(
      `User repository initialization failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}