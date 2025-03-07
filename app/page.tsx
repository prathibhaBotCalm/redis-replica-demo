'use client';
import { createUser, deleteUser, getUsers } from '@/actions/user';
import { Suspense, useEffect, useState } from 'react';

type User = {
  id?: string;
  name?: string;
  email?: string;
  age?: number;
};

export default function Home() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [newUser, setNewUser] = useState<User>({ name: '', email: '', age: 0 });
  const [loading, setLoading] = useState(false);

  const node_env = process.env.NODE_ENV;

  // Fetch users from the server
  const fetchUsers = async () => {
    setLoading(true);
    const data = await getUsers();
    setUsers(data.data);
    setLoading(false);
  };

  // Create a new user
  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.name || !newUser.email) {
      alert('Name and Email are required!');
      return;
    }
    await createUser(newUser.name, newUser.email, newUser.age);
    fetchUsers(); // Refresh users list after adding
    setNewUser({ name: '', email: '', age: 0 }); // Reset form
  };

  // Delete a user
  const handleDeleteUser = async (userId: string) => {
    const response = await deleteUser(userId); // Assuming deleteUser sends the correct request
    if (response.status === 200) {
      fetchUsers(); // Refresh users list after deletion
    } else {
      alert('Error deleting user');
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  return (
    <div className='max-w-4xl mx-auto p-6'>
      <h1 className='text-3xl font-bold mb-6 text-center'>
        Redis Demo - {node_env} env node
      </h1>

      <div className='bg-white p-6 rounded-lg shadow-lg mb-6'>
        <h2 className='text-xl font-semibold mb-4'>Add New User</h2>
        <form onSubmit={handleAddUser} className='space-y-4'>
          <input
            type='text'
            placeholder='Name'
            value={newUser.name}
            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
            className='w-full p-3 border border-gray-300 rounded-md'
            required
          />
          <input
            type='email'
            placeholder='Email'
            value={newUser.email}
            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            className='w-full p-3 border border-gray-300 rounded-md'
            required
          />
          <input
            type='number'
            placeholder='Age'
            value={newUser.age}
            onChange={(e) => setNewUser({ ...newUser, age: +e.target.value })}
            className='w-full p-3 border border-gray-300 rounded-md'
          />
          <button
            type='submit'
            className='w-full p-3 bg-blue-500 text-white rounded-md hover:bg-blue-600'
          >
            Add User
          </button>
        </form>
      </div>

      <Suspense fallback={<p>Loading users...</p>}>
        {loading ? (
          <p>Loading users...</p>
        ) : users && users.length > 0 ? (
          <ul className='list-disc pl-5 space-y-2'>
            {users.map((user) => (
              <li
                key={user.id}
                className='text-lg text-gray-700 flex justify-between items-center'
              >
                <span>{user.name}</span>
                <button
                  onClick={() => handleDeleteUser(user.id || '')}
                  className='bg-red-500 text-white p-2 rounded-md hover:bg-red-600'
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-red-500'>No users found. Check API response.</p>
        )}
      </Suspense>
    </div>
  );
}
