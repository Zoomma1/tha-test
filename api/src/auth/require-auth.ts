import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { db } from "../db.js";
import { SESSION_COOKIE, findSessionUser } from "./session.js";

export type AuthEnv = { Variables: { user: { id: number; handle: string; displayName: string } } };

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const user = token ? await findSessionUser(db, token) : null;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
});
