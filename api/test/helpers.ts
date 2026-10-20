import { z } from "zod";
import { app } from "../src/app.js";

export const partSchema = z.object({
  id: z.number(),
  kind: z.enum(["blade", "ratchet", "bit"]),
  name: z.string(),
});

export async function get(path: string): Promise<Response> {
  return app.request(path);
}

export async function readJson<T extends z.ZodType>(res: Response, schema: T): Promise<z.output<T>> {
  return schema.parse(await res.json());
}

export const DEMO_PASSWORD = "demo-password-1";

const cookies = new Map<string, string>();

// Connexion de démonstration : renvoie la valeur du cookie de session (`session=...`), gardée par handle pour ne pas rejouer scrypt à chaque requête.
export async function login(handle = "me"): Promise<string> {
  const cached = cookies.get(handle);
  if (cached !== undefined) return cached;
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle, password: DEMO_PASSWORD }),
  });
  const pair = res.headers.get("set-cookie")?.split(";")[0];
  if (res.status !== 200 || pair === undefined || pair === "") throw new Error(`login failed for ${handle}: HTTP ${String(res.status)}`);
  cookies.set(handle, pair);
  return pair;
}

export async function authed(path: string, init: RequestInit = {}, as = "me"): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", await login(as));
  return app.request(path, { ...init, headers });
}
