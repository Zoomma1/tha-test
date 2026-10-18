import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createDb, db } from "../src/db.js";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Le champ partId n'est pas encore unique dans le schéma : on passe donc par du SQL brut
// dont le résultat est validé par zod, sans typer la table OwnedPart avec le client généré.
const countSchema = z.array(z.object({ total: z.coerce.number() }));

// Chaque test crée sa propre pièce et supprime ses lignes d'inventaire : test.db est partagée.
const createdPartIds: number[] = [];

async function createPart(): Promise<number> {
  const part = await db.part.create({ data: { kind: "bit", name: `Pièce unique ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return part.id;
}

async function insertOwnedRow(partId: number, quantity: number): Promise<void> {
  await db.$executeRaw`INSERT INTO "OwnedPart" ("partId", "quantity") VALUES (${partId}, ${quantity})`;
}

async function countOwnedRows(partId: number): Promise<number> {
  const rows = countSchema.parse(
    await db.$queryRaw`SELECT COUNT(*) AS "total" FROM "OwnedPart" WHERE "partId" = ${partId}`,
  );
  return rows[0]?.total ?? 0;
}

afterEach(async () => {
  const ids = createdPartIds.splice(0);
  for (const partId of ids) {
    await db.$executeRaw`DELETE FROM "OwnedPart" WHERE "partId" = ${partId}`;
    await db.part.delete({ where: { id: partId } });
  }
});

describe("OwnedPart.partId is unique", () => {
  it("refuses a second inventory row for a part that already has one", async () => {
    const partId = await createPart();
    await insertOwnedRow(partId, 1);
    await expect(insertOwnedRow(partId, 2)).rejects.toThrow();
    expect(await countOwnedRows(partId)).toBe(1);
  });
});

describe("migration on an empty database", () => {
  const dir = mkdtempSync(join(tmpdir(), "tha-test-unique-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies the unique constraint when the database is recreated from zero", async () => {
    const url = `file:${join(dir, "unique.db")}`;
    execFileSync("npm", ["run", "db:reset"], {
      cwd: apiDir,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: url },
    });

    const client = createDb(url);
    try {
      const part = await client.part.findFirstOrThrow({ orderBy: { id: "asc" } });
      await client.$executeRaw`INSERT INTO "OwnedPart" ("partId", "quantity") VALUES (${part.id}, 1)`;
      await expect(
        client.$executeRaw`INSERT INTO "OwnedPart" ("partId", "quantity") VALUES (${part.id}, 1)`,
      ).rejects.toThrow();
    } finally {
      await client.$disconnect();
    }
  }, 60_000);
});
