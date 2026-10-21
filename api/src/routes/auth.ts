import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { loginLimiter } from "../auth/login-limiter.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { createSession, deleteSession, findSessionUser, SESSION_COOKIE, sessionCookieOptions } from "../auth/session.js";
import { db } from "../db.js";

const registerSchema = z.object({
  handle: z.string().regex(/^[a-z0-9_]{3,20}$/),
  password: z.string().min(8).max(72),
  displayName: z.string().min(1).max(40).optional(),
});

const loginSchema = z.object({
  handle: z.string().min(1),
  password: z.string().min(1),
});

// Hash factice calculé une fois : égalise le temps de réponse pour un handle inconnu.
const dummyHash = hashPassword("dummy-password-for-timing");

export const authRoutes = new Hono().post("/register", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  const { handle, password, displayName } = parsed.data;

  if (await db.user.findUnique({ where: { handle } })) return c.json({ error: "handle taken" }, 409);

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await db.user.create({ data: { handle, displayName: displayName ?? handle, passwordHash } });
  } catch {
    // Course entre deux inscriptions du même handle : l'unicité en base tranche.
    return c.json({ error: "handle taken" }, 409);
  }

  const { token } = await createSession(db, user.id);
  setCookie(c, SESSION_COOKIE, token, sessionCookieOptions(process.env["NODE_ENV"] === "production"));
  return c.json({ id: user.id, handle: user.handle, displayName: user.displayName }, 201);
}).post("/login", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  const { handle, password } = parsed.data;

  const check = loginLimiter.check(handle);
  if (!check.allowed) {
    c.header("Retry-After", String(check.retryAfterSeconds));
    return c.json({ error: "too many attempts" }, 429);
  }

  const user = await db.user.findUnique({ where: { handle } });
  const valid = await verifyPassword(password, user ? user.passwordHash : await dummyHash);
  if (!user || !valid) {
    loginLimiter.recordFailure(handle);
    return c.json({ error: "invalid credentials" }, 401);
  }

  loginLimiter.reset(handle);
  const { token } = await createSession(db, user.id);
  setCookie(c, SESSION_COOKIE, token, sessionCookieOptions(process.env["NODE_ENV"] === "production"));
  return c.json({ id: user.id, handle: user.handle, displayName: user.displayName }, 200);
}).get("/me", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  const user = token ? await findSessionUser(db, token) : null;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json(user, 200);
}).post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSession(db, token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.body(null, 204);
});
