import { getUsers } from "@/actions/user";

export default async function Home() {
  const users = await getUsers();
  console.log(users);
  return <div>{users?.map((user) => <li>user?.name</li>)}</div>;
}
