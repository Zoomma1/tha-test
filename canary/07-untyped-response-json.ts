export interface User {
  name: string;
}

export async function loadUser(res: Response): Promise<User> {
  const data = await res.json();
  const user: User = data;
  return user;
}
