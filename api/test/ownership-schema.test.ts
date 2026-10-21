import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createDb, db } from "../src/db.js";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaFile = join(apiDir, "prisma", "schema.prisma");
const migrationsDir = join(apiDir, "prisma", "migrations");

// Migrations présentes avant ce changement : une base peuplée avec elles représente l'état « avant ».
const PREVIOUS_MIGRATIONS = [
  "20261017213843_init",
  "20261018000000_owned_part_unique_part",
  "20261018100000_part_weight_grams",
  "20261019000000_wishlist_priority",
  "20261020000000_build_notes",
  "20261021000000_auth_schema",
];

// Les modèles OwnedPart, Build et WishlistItem n'ont pas encore de champ ownerId dans le client généré : on passe par SQL brut, validé par zod.
const idSchema = z.array(z.object({ id: z.number() }));
const ownerSchema = z.array(z.object({ ownerId: z.number() }));
const ownedRowSchema = z.array(
  z.object({ id: z.number(), ownerId: z.number(), partId: z.number(), quantity: z.number() }),
);

const dir = mkdtempSync(join(tmpdir(), "tha-test-ownership-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

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

async function meIdOf(client: ReturnType<typeof createDb>): Promise<number> {
  const rows = idSchema.parse(await client.$queryRaw`SELECT "id" FROM "User" WHERE "handle" = 'me'`);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("demo user me is missing");
  return id;
}

describe("migration on an empty database", () => {
  const url = `file:${join(dir, "empty.db")}`;
  let meId = 0;

  beforeAll(async () => {
    reset(url);
    const client = createDb(url);
    try {
      meId = await meIdOf(client);
    } finally {
      await client.$disconnect();
    }
  }, 120_000);

  it("gives every seeded owned part to me", async () => {
    const client = createDb(url);
    try {
      const owners = ownerSchema.parse(await client.$queryRaw`SELECT "ownerId" FROM "OwnedPart"`).map((r) => r.ownerId);
      expect(owners.length).toBeGreaterThan(0);
      expect(owners.filter((id) => id !== meId)).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  });

  it("gives every seeded build to me", async () => {
    const client = createDb(url);
    try {
      const owners = ownerSchema.parse(await client.$queryRaw`SELECT "ownerId" FROM "Build"`).map((r) => r.ownerId);
      expect(owners.length).toBeGreaterThan(0);
      expect(owners.filter((id) => id !== meId)).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  });

  it("gives every seeded wishlist item to me", async () => {
    const client = createDb(url);
    try {
      const owners = ownerSchema.parse(await client.$queryRaw`SELECT "ownerId" FROM "WishlistItem"`).map((r) => r.ownerId);
      expect(owners.length).toBeGreaterThan(0);
      expect(owners.filter((id) => id !== meId)).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  });

  it("defaults ownerId to me when a build is inserted without one", async () => {
    const name = `Sans propriétaire ${randomUUID()}`;
    const client = createDb(url);
    try {
      await client.$executeRaw`INSERT INTO "Build" ("name") VALUES (${name})`;
      const owners = ownerSchema.parse(await client.$queryRaw`SELECT "ownerId" FROM "Build" WHERE "name" = ${name}`);
      expect(owners).toEqual([{ ownerId: meId }]);
    } finally {
      await client.$disconnect();
    }
  });
});

describe("migration on a populated database", () => {
  // La base est peuplée avec les migrations d'avant, puis la nouvelle migration s'applique dessus.
  const url = `file:${join(dir, "populated.db")}`;

  beforeAll(async () => {
    deploy(url, previousMigrationsDir(), "previous");

    const before = createDb(url);
    try {
      // Ids explicites : la base est neuve, donc me = 1 et la pièce = 1 sans avoir à les relire.
      await before.$executeRaw`INSERT INTO "User" ("id", "handle", "displayName", "passwordHash") VALUES (1, 'me', 'Moi', 'placeholder')`;
      await before.$executeRaw`INSERT INTO "Part" ("id", "kind", "name") VALUES (1, 'blade', 'Shark Edge')`;
      await before.$executeRaw`INSERT INTO "OwnedPart" ("partId", "quantity") VALUES (1, 2)`;
      await before.$executeRaw`INSERT INTO "Build" ("name") VALUES ('Build de test')`;
      await before.$executeRaw`INSERT INTO "WishlistItem" ("partId", "note") VALUES (1, 'à acheter')`;
    } finally {
      await before.$disconnect();
    }

    deploy(url, migrationsDir, "current");
  }, 180_000);

  it("keeps the existing owned part and gives it to me (ownerId 1)", async () => {
    const client = createDb(url);
    try {
      expect(ownerSchema.parse(await client.$queryRaw`SELECT "ownerId" FROM "OwnedPart"`)).toEqual([{ ownerId: 1 }]);
    } finally {
      await client.$disconnect();
    }
  });

  it("keeps the existing build and gives it to me (ownerId 1)", async () => {
    const client = createDb(url);
    try {
      expect(ownerSchema.parse(await client.$queryRaw`SELECT "ownerId" FROM "Build"`)).toEqual([{ ownerId: 1 }]);
    } finally {
      await client.$disconnect();
    }
  });

  it("keeps the existing wishlist item and gives it to me (ownerId 1)", async () => {
    const client = createDb(url);
    try {
      expect(ownerSchema.parse(await client.$queryRaw`SELECT "ownerId" FROM "WishlistItem"`)).toEqual([{ ownerId: 1 }]);
    } finally {
      await client.$disconnect();
    }
  });
});

// Chaque test crée sa propre pièce (aucune ligne d'inventaire dans le seed) et la supprime ensuite.
const createdPartIds: number[] = [];

async function makePart(): Promise<{ id: number; name: string }> {
  const part = await db.part.create({ data: { kind: "blade", name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return part;
}

async function userIdOf(handle: string): Promise<number> {
  const rows = idSchema.parse(await db.$queryRaw`SELECT "id" FROM "User" WHERE "handle" = ${handle}`);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`demo user ${handle} is missing`);
  return id;
}

async function insertOwned(partId: number, ownerId: number, quantity: number): Promise<z.output<typeof ownedRowSchema>> {
  return ownedRowSchema.parse(
    await db.$queryRaw`INSERT INTO "OwnedPart" ("partId", "quantity", "ownerId") VALUES (${partId}, ${quantity}, ${ownerId}) RETURNING "id", "ownerId", "partId", "quantity"`,
  );
}

async function rowsForPart(partId: number): Promise<z.output<typeof ownedRowSchema>> {
  return ownedRowSchema.parse(
    await db.$queryRaw`SELECT "id", "ownerId", "partId", "quantity" FROM "OwnedPart" WHERE "partId" = ${partId}`,
  );
}

afterEach(async () => {
  const ids = createdPartIds.splice(0);
  await db.ownedPart.deleteMany({ where: { partId: { in: ids } } });
  await db.part.deleteMany({ where: { id: { in: ids } } });
});

describe("OwnedPart: le couple (ownerId, partId) est unique", () => {
  it("accepts the same part for two different owners", async () => {
    const part = await makePart();
    const me = await userIdOf("me");
    const alice = await userIdOf("alice");

    await insertOwned(part.id, me, 1);
    await insertOwned(part.id, alice, 2);

    const rows = await rowsForPart(part.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.ownerId)).toEqual(expect.arrayContaining([me, alice]));
  });

  it.each(["me", "alice"])("refuses a second row for the same part and the same owner (%s)", async (handle) => {
    const part = await makePart();
    const owner = await userIdOf(handle);

    await insertOwned(part.id, owner, 1);
    await expect(insertOwned(part.id, owner, 2)).rejects.toThrow();

    expect(await rowsForPart(part.id)).toHaveLength(1);
  });

  it("refuses an owner that does not exist", async () => {
    const part = await makePart();
    // Les utilisateurs de démonstration ont des ids petits : 999999 n'existe pas.
    await expect(insertOwned(part.id, 999_999, 1)).rejects.toThrow();

    expect(await rowsForPart(part.id)).toEqual([]);
  });
});
