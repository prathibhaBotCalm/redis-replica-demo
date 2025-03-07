// user.repository.ts
import { initializeRepository } from '@/utils/repository.util';
import { Entity } from 'redis-om';

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

// Initialize the user repository
export const userRepository = initializeRepository<UserEntity>(
  'User',
  userSchema
);
