import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { createDb, db } from "../src/db.js";
import { DEMO_PASSWORD } from "./helpers.js";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Les modèles User et Session n'ont pas encore de types dans le client généré : on passe par SQL brut, validé par zod.
const demoUsers = [
  { handle: "me", displayName: "Moi" },
  { handle: "alice", displayName: "Alice" },
  { handle: "bob", displayName: "Bob" },
  { handle: "carol", displayName: "Carol" },
  { handle: "dave", displayName: "Dave" },
] as const;

const SCRYPT_FORMAT = /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/;

const userRowSchema = z.object({ handle: z.string(), displayName: z.string(), passwordHash: z.string() });
const userIdSchema = z.array(z.object({ id: z.number() }));
const tableNameSchema = z.array(z.object({ name: z.string() }));
const bioSchema = z.array(z.object({ bio: z.string().nullable() }));
const foreignKeySchema = z.array(z.object({ table: z.string(), from: z.string(), to: z.string() }));

function reset(url: string): void {
  execFileSync("npm", ["run", "db:reset"], { cwd: apiDir, stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}

async function readUsers(url: string): Promise<z.infer<typeof userRowSchema>[]> {
  const client = createDb(url);
  try {
    return userRowSchema.array().parse(await client.$queryRaw`SELECT "handle", "displayName", "passwordHash" FROM "User" ORDER BY "id"`);
  } finally {
    await client.$disconnect();
  }
}

const dir = mkdtempSync(join(tmpdir(), "tha-test-auth-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("migration on an empty database", () => {
  it("creates the User and Session tables", async () => {
    const url = `file:${join(dir, "migrate.db")}`;
    reset(url);

    const client = createDb(url);
    try {
      const tables = tableNameSchema.parse(
        await client.$queryRaw`SELECT "name" FROM sqlite_master WHERE type = 'table' AND name IN ('User', 'Session') ORDER BY "name"`,
      );
      expect(tables.map((t) => t.name)).toEqual(["Session", "User"]);
    } finally {
      await client.$disconnect();
    }
  }, 60_000);
});

describe("db:reset seeds the five demo users", () => {
  const firstUrl = `file:${join(dir, "seed-a.db")}`;
  const secondUrl = `file:${join(dir, "seed-b.db")}`;
  let first: z.infer<typeof userRowSchema>[] = [];
  let second: z.infer<typeof userRowSchema>[] = [];

  beforeAll(async () => {
    reset(firstUrl);
    first = await readUsers(firstUrl);
    reset(secondUrl);
    second = await readUsers(secondUrl);
  }, 120_000);

  it("holds exactly the five expected handles, with their display names, in seed order", () => {
    expect(first.map((u) => ({ handle: u.handle, displayName: u.displayName }))).toEqual(demoUsers);
  });

  it("gives me the id 1", async () => {
    const client = createDb(firstUrl);
    try {
      const rows = userIdSchema.parse(await client.$queryRaw`SELECT "id" FROM "User" WHERE "handle" = 'me'`);
      expect(rows).toEqual([{ id: 1 }]);
    } finally {
      await client.$disconnect();
    }
  });

  it("gives the same handles and display names on a second reset", () => {
    expect(second.map((u) => ({ handle: u.handle, displayName: u.displayName }))).toEqual(
      first.map((u) => ({ handle: u.handle, displayName: u.displayName })),
    );
  });

  it("stores a different hash on each reset, because the salt is random", () => {
    expect(second).toHaveLength(first.length);
    first.forEach((u, i) => {
      expect(second[i]?.passwordHash).not.toBe(u.passwordHash);
    });
  });

  it("stores hashes in the scrypt$16384$8$1$<salt>$<hash> format", () => {
    for (const u of first) expect(u.passwordHash).toMatch(SCRYPT_FORMAT);
  });

  it("accepts the demo password against every seeded hash", async () => {
    for (const u of first) {
      expect(await verifyPassword(DEMO_PASSWORD, u.passwordHash)).toBe(true);
    }
  });
});

describe("hashPassword and verifyPassword", () => {
  it("returns a hash in the documented format", async () => {
    expect(await hashPassword(DEMO_PASSWORD)).toMatch(SCRYPT_FORMAT);
  });

  it("returns two different hashes for the same password", async () => {
    const a = await hashPassword(DEMO_PASSWORD);
    const b = await hashPassword(DEMO_PASSWORD);
    expect(a).not.toBe(b);
  });

  it("verifies the right password", async () => {
    const stored = await hashPassword(DEMO_PASSWORD);
    expect(await verifyPassword(DEMO_PASSWORD, stored)).toBe(true);
  });

  it("refuses a wrong password", async () => {
    const stored = await hashPassword(DEMO_PASSWORD);
    expect(await verifyPassword("not-the-password", stored)).toBe(false);
  });

  it.each([
    ["an empty string", ""],
    ["a plain word", "demo-password-1"],
    ["a truncated scrypt string", "scrypt$16384$8$1$onlysalt"],
    ["a bcrypt-looking string", "$2b$10$abcdefghijklmnopqrstuv"],
    ["a scrypt string with a non-numeric cost", "scrypt$abc$8$1$AAAAAAAAAAAAAAAAAAAAAA$BBBB"],
  ])("returns false, without throwing, for %s", async (_label, stored) => {
    await expect(verifyPassword(DEMO_PASSWORD, stored)).resolves.toBe(false);
  });
});

describe("User and Session tables", () => {
  // Chaque test crée ses propres lignes avec un préfixe unique et les supprime ensuite.
  const prefix = `auth-test-${randomUUID()}`;

  async function makeUser(suffix: string, bio?: string): Promise<string> {
    const handle = `${prefix}-${suffix}`;
    const passwordHash = await hashPassword("test-password");
    if (bio === undefined) {
      await db.$executeRaw`INSERT INTO "User" ("handle", "displayName", "passwordHash") VALUES (${handle}, ${"Test"}, ${passwordHash})`;
    } else {
      await db.$executeRaw`INSERT INTO "User" ("handle", "displayName", "passwordHash", "bio") VALUES (${handle}, ${"Test"}, ${passwordHash}, ${bio})`;
    }
    return handle;
  }

  afterEach(async () => {
    await db.$executeRaw`DELETE FROM "Session" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "handle" LIKE ${`${prefix}%`})`;
    await db.$executeRaw`DELETE FROM "User" WHERE "handle" LIKE ${`${prefix}%`}`;
  });

  it("refuses two users with the same handle", async () => {
    const handle = await makeUser("unique");
    const passwordHash = await hashPassword("test-password");
    await expect(
      db.$executeRaw`INSERT INTO "User" ("handle", "displayName", "passwordHash") VALUES (${handle}, ${"Autre"}, ${passwordHash})`,
    ).rejects.toThrow();
  });

  it("stores bio as optional: null when omitted, the value when given", async () => {
    const withoutBio = await makeUser("no-bio");
    const withBio = await makeUser("with-bio", "Joueur de Beyblade X");

    const noBio = bioSchema.parse(await db.$queryRaw`SELECT "bio" FROM "User" WHERE "handle" = ${withoutBio}`);
    const yesBio = bioSchema.parse(await db.$queryRaw`SELECT "bio" FROM "User" WHERE "handle" = ${withBio}`);
    expect(noBio).toEqual([{ bio: null }]);
    expect(yesBio).toEqual([{ bio: "Joueur de Beyblade X" }]);
  });

  it("refuses two sessions with the same token hash", async () => {
    const handle = await makeUser("session");
    const userId = userIdSchema.parse(await db.$queryRaw`SELECT "id" FROM "User" WHERE "handle" = ${handle}`)[0]?.id;
    expect(userId).toBeDefined();

    const tokenHash = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 604_800_000);
    await db.$executeRaw`INSERT INTO "Session" ("userId", "tokenHash", "expiresAt") VALUES (${userId}, ${tokenHash}, ${expiresAt})`;

    await expect(
      db.$executeRaw`INSERT INTO "Session" ("userId", "tokenHash", "expiresAt") VALUES (${userId}, ${tokenHash}, ${expiresAt})`,
    ).rejects.toThrow();
  });

  it("links Session.userId to User.id", async () => {
    const foreignKeys = foreignKeySchema.parse(await db.$queryRaw`SELECT "table", "from", "to" FROM pragma_foreign_key_list('Session')`);
    expect(foreignKeys).toContainEqual({ table: "User", from: "userId", to: "id" });
  });
});
