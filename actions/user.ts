// actions/user.ts
'use server';

import * as baseLogger from '@/lib/logger';
import { UserEntity, initUserRepository } from '@/schema/user';
import { isConnectionError } from '@/utils/helpers.util';
import {
  getRepository,
  invalidateRepository,
} from '@/utils/repo-cache-manager.util';
import { Repository } from 'redis-om';

const logger = baseLogger.createContextLogger('UserActions');

// Function to get all users
export async function getUsers() {
  try {
    // Get the user repository (from cache or initialize a new one)
    const repo = await getRepository<Repository<UserEntity>>(
      'userRepository',
      initUserRepository
    );

    // Use the repository
    const users = await repo.search().returnAll();
    const usersPlain = JSON.parse(JSON.stringify(users));

    return {
      status: 200,
      msg: 'success',
      data: usersPlain,
    };
  } catch (error: any) {
    logger.error('Error fetching users:', error);

    // If there's a connection error, invalidate the repository
    if (isConnectionError(error)) {
      invalidateRepository('userRepository');
    }

    return {
      status: 500,
      msg: error?.message || 'Internal Server Error',
      data: null,
    };
  }
}

// Function to create a new user
export async function createUser(name: string, email?: string, age?: number) {
  try {
    // For write operations, we might want to always ensure a fresh repository
    const repo = await getRepository<Repository<UserEntity>>(
      'userRepository',
      initUserRepository,
      true // Force refresh for write operations
    );

    // Generate a random ID
    const id = Math.random().toString(36).substr(2, 9);

    // Save the user
    const user = await repo.save({ id, name, email, age });

    // Invalidate cache after write operation to ensure fresh data on next read
    invalidateRepository('userRepository');

    logger.info(`Created new user: ${id}, name: ${name}`);

    return {
      status: 200,
      msg: 'success',
      data: user,
    };
  } catch (error: any) {
    logger.error('Error creating user:', error);

    if (isConnectionError(error)) {
      invalidateRepository('userRepository');
    }

    return {
      status: 500,
      msg: error?.message || 'Internal Server Error',
      data: null,
    };
  }
}

// Function to delete a user
export async function deleteUser(id: string) {
  try {
    // Get repository, forcing refresh for write operation
    const repo = await getRepository<Repository<UserEntity>>(
      'userRepository',
      initUserRepository,
      true
    );

    // Fetch the user to ensure it exists
    const user = await repo.fetch(id);
    if (!user) {
      logger.warn(`Attempted to delete non-existent user: ${id}`);
      throw new Error('User not found');
    }

    // Remove the user
    await repo.remove(id);

    // Invalidate cache after write operation
    invalidateRepository('userRepository');

    logger.info(`Deleted user: ${id}`);

    return {
      status: 200,
      msg: 'User deleted successfully',
    };
  } catch (error: any) {
    logger.error('Error deleting user:', error);

    if (isConnectionError(error)) {
      invalidateRepository('userRepository');
    }

    // Special handling for "not found" errors
    if (error.message === 'User not found') {
      return {
        status: 404,
        msg: 'User not found',
      };
    }

    return {
      status: 500,
      msg: error?.message || 'Internal Server Error',
    };
  }
}
