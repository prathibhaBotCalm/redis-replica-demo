import repositoryManager from '@/utils/initializeRepository';
import { Schema } from 'redis-om';

// Define the User schema
const userSchema = new Schema('users', {
  id: { type: 'string', sortable: true },
  name: { type: 'text', sortable: true },
  email: { type: 'text', sortable: false },
  age: { type: 'number', sortable: true },
});

export async function initializeUserRepository() {
  return repositoryManager.initializeRepository(userSchema);
}
