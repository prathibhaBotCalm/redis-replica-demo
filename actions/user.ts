'use server';

import { ensureMasterConnection } from '@/lib/redis';
import { getUserRepository } from '@/schema/user';
import * as baseLogger from '@/lib/logger';

const logger = baseLogger.createContextLogger('UserActions');

// Function to get all users
export async function getUsers() {
  try {
    // Ensure we're connected to the current master
    await ensureMasterConnection();

    // Get a fresh repository instance
    const repo = await getUserRepository();

    // Fetch all users
    const users = await repo.search().returnAll();
    const usersPlain = JSON.parse(JSON.stringify(users));

    return {
      status: 200,
      msg: 'success',
      data: usersPlain,
    };
  } catch (error: any) {
    logger.error('Error fetching users:', error);

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
    // Generate a random ID
    const id = Math.random().toString(36).substr(2, 9);

    // Ensure we're connected to the current master
    await ensureMasterConnection();

    // Get a fresh repository instance
    const repo = await getUserRepository();

    // Save the user
    const user = await repo.save({ id, name, email, age });

    logger.info(`Created new user: ${id}, name: ${name}`);

    return {
      status: 200,
      msg: 'success',
      data: user,
    };
  } catch (error: any) {
    logger.error('Error creating user:', error);

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
    // Ensure we're connected to the current master
    await ensureMasterConnection();

    // Get a fresh repository instance
    const repo = await getUserRepository();

    // Fetch the user to ensure it exists
    const user = await repo.fetch(id);
    if (!user) {
      logger.warn(`Attempted to delete non-existent user: ${id}`);
      throw new Error('User not found');
    }

    // Remove the user
    await repo.remove(id);

    logger.info(`Deleted user: ${id}`);

    return {
      status: 200,
      msg: 'User deleted successfully',
    };
  } catch (error: any) {
    logger.error('Error deleting user:', error);

    // Special handling for "not found" errors to return a more appropriate status
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
