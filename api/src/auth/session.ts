import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "../generated/client.js";

export const SESSION_COOKIE = "session";
export const SESSION_TTL_SECONDS = 604800;

export interface SessionUser {
  id: number;
  handle: string;
  displayName: string;
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "Lax" as const, path: "/", maxAge: SESSION_TTL_SECONDS, secure };
}

export async function createSession(
  db: PrismaClient,
  userId: number,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  await db.session.create({ data: { userId, tokenHash: hashSessionToken(token), expiresAt } });
  return { token, expiresAt };
}

export async function findSessionUser(
  db: PrismaClient,
  token: string,
  now: Date = new Date(),
): Promise<SessionUser | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() <= now.getTime()) return null;
  const { id, handle, displayName } = session.user;
  return { id, handle, displayName };
}

export async function deleteSession(db: PrismaClient, token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}
