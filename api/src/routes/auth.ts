import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import { hashPassword } from "../auth/password.js";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "../auth/session.js";
import { db } from "../db.js";

const registerSchema = z.object({
  handle: z.string().regex(/^[a-z0-9_]{3,20}$/),
  password: z.string().min(8).max(72),
  displayName: z.string().min(1).max(40).optional(),
});

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
});
