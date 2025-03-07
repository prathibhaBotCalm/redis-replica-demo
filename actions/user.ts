'use server';

import { ensureMasterConnection } from '@/lib/redis';
import { userRepository } from '@/schema/user';

// Function to get all users
export async function getUsers() {
  try {
    await ensureMasterConnection();
    const repo = await userRepository;
    // Check if the repository is defined and initialized
    if (!repo) {
      throw new Error('User repository is not initialized.');
    }
    const users = await repo.search().returnAll();
    const usersPlain = JSON.parse(JSON.stringify(users));

    return {
      status: 200,
      msg: 'success',
      data: usersPlain,
    };
  } catch (error: any) {
    console.error('Error fetching users:', error);
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
    const id = Math.random().toString(36).substr(2, 9);
    await ensureMasterConnection();

    const repo = await userRepository;
    const user = await repo.save({ id, name, email, age });
    return {
      status: 200,
      msg: 'success',
      data: user,
    };
  } catch (error: any) {
    console.error('Error creating user:', error);
    return {
      status: 500,
      msg: error?.message || 'Internal Server Error',
      data: null,
    };
  }
}

export async function deleteUser(id: string) {
  try {
    const repo = await userRepository;
    await ensureMasterConnection();

    // Make sure you're passing the correct ID
    const user = await repo.fetch(id);
    if (!user) {
      throw new Error('User not found');
    }

    await repo.remove(id);
    return { status: 200, msg: 'User deleted successfully' };
  } catch (error: any) {
    console.error('Error deleting user:', error);
    return { status: 500, msg: error?.message || 'Internal Server Error' };
  }
}
