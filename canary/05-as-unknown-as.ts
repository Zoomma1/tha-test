export interface User {
  name: string;
}

const raw: string = "{}";
export const user = raw as unknown as User;
