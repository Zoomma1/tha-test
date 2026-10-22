import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createDb, db } from "../src/db.js";
import { SEED_BUILD, SEED_OWNED, SEED_PARTS, SEED_USERS, SEED_WISHLIST } from "../src/seed-data.js";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaFile = join(apiDir, "prisma", "schema.prisma");
const migrationsDir = join(apiDir, "prisma", "migrations");

// Les sept migrations présentes avant ce changement : une base peuplée avec elles représente l'état « avant ».
const PREVIOUS_MIGRATIONS = [
  "20261017213843_init",
  "20261018000000_owned_part_unique_part",
  "20261018100000_part_weight_grams",
  "20261019000000_wishlist_priority",
  "20261020000000_build_notes",
  "20261021000000_auth_schema",
  "20261022000000_ownership_schema",
];
// La nouvelle migration doit être datée après celle-ci.
const LAST_PREVIOUS_MIGRATION = "20261022000000_ownership_schema";

// Le modèle Follow n'a pas encore de types dans le client généré : on passe par SQL brut, validé par zod.
const idSchema = z.array(z.object({ id: z.number() }));
const countRowSchema = z.object({ n: z.coerce.number() });
const relationSchema = z.object({ follower: z.string(), followee: z.string() });
const countsSchema = z.object({
  User: z.coerce.number(),
  Session: z.coerce.number(),
  Part: z.coerce.number(),
  OwnedPart: z.coerce.number(),
  Build: z.coerce.number(),
  BuildPart: z.coerce.number(),
  WishlistItem: z.coerce.number(),
});
type Counts = z.output<typeof countsSchema>;

const dir = mkdtempSync(join(tmpdir(), "tha-test-follow-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function firstRow<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("query returned no row");
  return row;
}

function reset(url: string): void {
  execFileSync("npm", ["run", "db:reset"], { cwd: apiDir, stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}

// La config du dépôt fixe le dossier des migrations : on applique donc un dossier donné avec une config temporaire.
function deploy(url: string, migrations: string, name: string): void {
  const configFile = join(dir, `${name}.prisma.config.mjs`);
  writeFileSync(
    configFile,
    `export default ${JSON.stringify({ schema: schemaFile, migrations: { path: migrations }, datasource: { url } })};\n`,
  );
  execFileSync("npx", ["prisma", "migrate", "deploy", "--config", configFile], {
    cwd: apiDir,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}

// Copie des migrations actuelles, sans celles qui n'existaient pas encore.
function previousMigrationsDir(): string {
  const target = join(dir, "previous-migrations");
  cpSync(migrationsDir, target, { recursive: true });
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory() && !PREVIOUS_MIGRATIONS.includes(entry.name)) {
      rmSync(join(target, entry.name), { recursive: true });
    }
  }
  return target;
}

// Le dossier de la nouvelle migration n'a pas de nom connu d'avance : c'est le seul daté après la dernière migration existante.
function newMigrationNames(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name > LAST_PREVIOUS_MIGRATION)
    .map((entry) => entry.name)
    .sort();
}

function newMigrationSql(): string {
  const [name] = newMigrationNames();
  if (name === undefined) throw new Error("no migration dated after ownership_schema");
  return readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
}

// Les clauses ON DELETE / ON UPDATE des clés étrangères et les commentaires ne sont pas des instructions.
function statementsOf(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .replace(/\bON (DELETE|UPDATE)\s+(CASCADE|RESTRICT|SET NULL|SET DEFAULT|NO ACTION)/gi, "");
}

function partIdOf(name: string): number {
  const index = SEED_PARTS.findIndex((part) => part.name === name);
  if (index < 0) throw new Error(`pièce de seed inconnue : ${name}`);
  return index + 1;
}

// État « avant » : mêmes lignes que le seed actuel, en SQL brut avec des ids explicites (base neuve : me = 1).
async function populate(url: string): Promise<void> {
  const client = createDb(url);
  try {
    for (const [index, user] of SEED_USERS.entries()) {
      await client.$executeRaw`INSERT INTO "User" ("id", "handle", "displayName", "passwordHash") VALUES (${index + 1}, ${user.handle}, ${user.displayName}, 'placeholder')`;
    }
    for (const [index, part] of SEED_PARTS.entries()) {
      await client.$executeRaw`INSERT INTO "Part" ("id", "kind", "name", "weightGrams") VALUES (${index + 1}, ${part.kind}, ${part.name}, ${part.weightGrams})`;
    }
    for (const owned of SEED_OWNED) {
      await client.$executeRaw`INSERT INTO "OwnedPart" ("ownerId", "partId", "quantity") VALUES (1, ${partIdOf(owned.partName)}, ${owned.quantity})`;
    }
    await client.$executeRaw`INSERT INTO "Build" ("id", "ownerId", "name") VALUES (1, 1, ${SEED_BUILD.name})`;
    for (const name of SEED_BUILD.partNames) {
      await client.$executeRaw`INSERT INTO "BuildPart" ("buildId", "partId") VALUES (1, ${partIdOf(name)})`;
    }
    for (const wishlist of SEED_WISHLIST) {
      await client.$executeRaw`INSERT INTO "WishlistItem" ("ownerId", "partId", "note") VALUES (1, ${partIdOf(wishlist.partName)}, ${wishlist.note})`;
    }
  } finally {
    await client.$disconnect();
  }
}

async function countRows(url: string): Promise<Counts> {
  const client = createDb(url);
  try {
    return firstRow(
      z.array(countsSchema).parse(
        await client.$queryRaw`SELECT (SELECT COUNT(*) FROM "User") AS "User", (SELECT COUNT(*) FROM "Session") AS "Session", (SELECT COUNT(*) FROM "Part") AS "Part", (SELECT COUNT(*) FROM "OwnedPart") AS "OwnedPart", (SELECT COUNT(*) FROM "Build") AS "Build", (SELECT COUNT(*) FROM "BuildPart") AS "BuildPart", (SELECT COUNT(*) FROM "WishlistItem") AS "WishlistItem"`,
      ),
    );
  } finally {
    await client.$disconnect();
  }
}

async function followTableExists(url: string): Promise<boolean> {
  const client = createDb(url);
  try {
    const rows = z
      .array(z.object({ name: z.string() }))
      .parse(await client.$queryRaw`SELECT "name" FROM sqlite_master WHERE type = 'table' AND name = 'Follow'`);
    return rows.length === 1;
  } finally {
    await client.$disconnect();
  }
}

async function readRelations(url: string): Promise<z.output<typeof relationSchema>[]> {
  const client = createDb(url);
  try {
    return z.array(relationSchema).parse(
      await client.$queryRaw`SELECT f."handle" AS "follower", t."handle" AS "followee" FROM "Follow" AS r JOIN "User" AS f ON f."id" = r."followerId" JOIN "User" AS t ON t."id" = r."followeeId" ORDER BY "follower", "followee"`,
    );
  } finally {
    await client.$disconnect();
  }
}

describe("migration on an empty database", () => {
  const url = `file:${join(dir, "empty.db")}`;

  beforeAll(() => {
    reset(url);
  }, 120_000);

  it("adds exactly one migration, dated after ownership_schema", () => {
    const names = newMigrationNames();
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^\d{14}_/);
  });

  it("creates the Follow table with its four columns", async () => {
    const client = createDb(url);
    try {
      const columns = z
        .array(z.object({ name: z.string() }))
        .parse(await client.$queryRaw`SELECT "name" FROM pragma_table_info('Follow') ORDER BY "cid"`);
      expect(columns.map((c) => c.name)).toEqual(["id", "followerId", "followeeId", "createdAt"]);
    } finally {
      await client.$disconnect();
    }
  });

  it("links followerId and followeeId to User", async () => {
    const client = createDb(url);
    try {
      const keys = z
        .array(z.object({ table: z.string(), from: z.string(), to: z.string() }))
        .parse(await client.$queryRaw`SELECT "table", "from", "to" FROM pragma_foreign_key_list('Follow') ORDER BY "from"`);
      expect(keys).toEqual([
        { table: "User", from: "followeeId", to: "id" },
        { table: "User", from: "followerId", to: "id" },
      ]);
    } finally {
      await client.$disconnect();
    }
  });

  it("contains no DROP, DELETE or UPDATE statement", () => {
    expect(statementsOf(newMigrationSql())).not.toMatch(/\b(DROP|DELETE|UPDATE)\b/i);
  });

  it("creates only the Follow table and its indexes, no existing table is redefined", () => {
    const sql = statementsOf(newMigrationSql());
    const createdTables = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]);
    const indexedTables = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "[^"]+" ON "([^"]+)"/g)].map((m) => m[1]);

    expect(createdTables).toEqual(["Follow"]);
    expect(indexedTables.filter((table) => table !== "Follow")).toEqual([]);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
  });
});

describe("migration on a populated database", () => {
  // La base est peuplée avec les migrations d'avant, puis la nouvelle migration s'applique dessus.
  const url = `file:${join(dir, "populated.db")}`;
  let before: Counts | undefined;

  beforeAll(async () => {
    deploy(url, previousMigrationsDir(), "previous");
    await populate(url);
    before = await countRows(url);
    if (before.User !== SEED_USERS.length || before.Part !== SEED_PARTS.length) {
      throw new Error("the populated database does not hold the seeded rows");
    }
    deploy(url, migrationsDir, "current");
  }, 180_000);

  it("creates the Follow table on the populated database", async () => {
    expect(await followTableExists(url)).toBe(true);
  });

  it("keeps the row count of every existing table", async () => {
    expect(await followTableExists(url)).toBe(true);
    expect(await countRows(url)).toEqual(before);
  });
});

describe("db:reset seeds the three demo follows", () => {
  const url = `file:${join(dir, "relations.db")}`;
  const demoRelations = [
    { follower: "alice", followee: "me" },
    { follower: "me", followee: "alice" },
    { follower: "me", followee: "bob" },
  ];

  it("holds exactly me→alice, me→bob and alice→me", async () => {
    reset(url);
    expect(await readRelations(url)).toEqual(demoRelations);
  }, 120_000);

  it("gives the same relations on two db:reset runs", async () => {
    reset(url);
    expect(await readRelations(url)).toEqual(demoRelations);
    reset(url);
    expect(await readRelations(url)).toEqual(demoRelations);
  }, 240_000);
});

// Les lignes de test ne portent que sur bob, carol et dave : jamais sur les relations de démonstration.
const createdFollowIds: number[] = [];

async function userIdOf(handle: string): Promise<number> {
  const rows = idSchema.parse(await db.$queryRaw`SELECT "id" FROM "User" WHERE "handle" = ${handle}`);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`demo user ${handle} is missing`);
  return id;
}

async function insertFollow(followerId: number, followeeId: number): Promise<number> {
  const rows = idSchema.parse(
    await db.$queryRaw`INSERT INTO "Follow" ("followerId", "followeeId") VALUES (${followerId}, ${followeeId}) RETURNING "id"`,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("insert returned no id");
  createdFollowIds.push(id);
  return id;
}

async function countPair(followerId: number, followeeId: number): Promise<number> {
  const row = firstRow(
    z.array(countRowSchema).parse(
      await db.$queryRaw`SELECT COUNT(*) AS "n" FROM "Follow" WHERE "followerId" = ${followerId} AND "followeeId" = ${followeeId}`,
    ),
  );
  return row.n;
}

afterEach(async () => {
  const ids = createdFollowIds.splice(0);
  for (const id of ids) {
    await db.$executeRaw`DELETE FROM "Follow" WHERE "id" = ${id}`;
  }
});

describe("Follow: le couple (followerId, followeeId) est unique", () => {
  it("accepts A follows B and B follows A", async () => {
    const bob = await userIdOf("bob");
    const carol = await userIdOf("carol");

    await insertFollow(bob, carol);
    await insertFollow(carol, bob);

    expect(await countPair(bob, carol)).toBe(1);
    expect(await countPair(carol, bob)).toBe(1);
  });

  it("accepts one follower following two different users", async () => {
    const bob = await userIdOf("bob");
    const carol = await userIdOf("carol");
    const dave = await userIdOf("dave");

    await insertFollow(dave, bob);
    await insertFollow(dave, carol);

    expect(await countPair(dave, bob)).toBe(1);
    expect(await countPair(dave, carol)).toBe(1);
  });

  it("refuses a second row for the same follower and the same followee", async () => {
    const carol = await userIdOf("carol");
    const dave = await userIdOf("dave");

    await insertFollow(carol, dave);
    await expect(insertFollow(carol, dave)).rejects.toThrow();

    expect(await countPair(carol, dave)).toBe(1);
  });

  it("refuses a follower that does not exist", async () => {
    const bob = await userIdOf("bob");
    // Les utilisateurs de démonstration ont des ids petits : 999999 n'existe pas.
    await expect(insertFollow(999_999, bob)).rejects.toThrow();

    expect(await countPair(999_999, bob)).toBe(0);
  });

  it("refuses a followee that does not exist", async () => {
    const bob = await userIdOf("bob");
    await expect(insertFollow(bob, 999_999)).rejects.toThrow();

    expect(await countPair(bob, 999_999)).toBe(0);
  });

  it("fills createdAt with the current date by default", async () => {
    const bob = await userIdOf("bob");
    const carol = await userIdOf("carol");
    const id = await insertFollow(carol, bob);

    const row = firstRow(
      z.array(countRowSchema).parse(await db.$queryRaw`SELECT ("createdAt" IS NOT NULL) AS "n" FROM "Follow" WHERE "id" = ${id}`),
    );
    expect(row.n).toBe(1);
  });
});
