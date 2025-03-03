import { getUsers } from "@/actions/user";

export default async function Home() {
  const users = await getUsers();
  console.log("🚀 ~ Home ~ users:", users)
  const node_env = process.env.NODE_ENV
  return (
    <div>
      <h1 className="text-3xl">Redis Demo - {node_env} env</h1>
      <ul>
        {users.data && users.data.map((user) => (
          <li key={user.name}>{user.name}</li>
        ))}
      </ul>
    </div>
  );
}
