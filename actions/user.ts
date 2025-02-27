// actions/user.ts

import { initializeUserRepository } from '@/schema/user';

let cachedUserRepository: Awaited<
  ReturnType<typeof initializeUserRepository>
> | null = null;

// Initialize the user repository once and cache it
async function getUserRepository() {
  if (!cachedUserRepository) {
    cachedUserRepository = await initializeUserRepository();
  }
  return cachedUserRepository;
}

// Function to get all users
export async function getUsers() {
  try {
    const userRepository = await getUserRepository();
    const users = await userRepository.search().returnAll();
    return {
      status: 200,
      msg: 'success',
      data: users,
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
    const userRepository = await getUserRepository();
    const user = await userRepository.save({ name, email, age });
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
