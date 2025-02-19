// pages/api/user.ts

import { createUser, getUsers } from '@/actions/user';

export async function GET(req:Request){
  const resp = await getUsers();

  return new Response(JSON.stringify(resp), {
    status: resp.status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}



// POST request handler for creating a user
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, age } = body;

    const resp = await createUser(name, email, age);

    return new Response(JSON.stringify(resp), {
      status: resp.status,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error: any) {
    console.error('Error handling POST request:', error);
    return new Response(
      JSON.stringify({
        status: 500,
        msg: error.message || 'Internal Server Error',
        data: null,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
}
