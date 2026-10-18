import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createDb, db } from "../src/db.js";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Chaque test crée sa propre pièce (aucune ligne d'inventaire dans le seed) et la supprime ensuite.
const createdPartIds: number[] = [];

async function makePart(): Promise<{ id: number; name: string }> {
  const part = await db.part.create({ data: { kind: "blade", name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return part;
}

afterEach(async () => {
  const ids = createdPartIds.splice(0);
  await db.ownedPart.deleteMany({ where: { partId: { in: ids } } });
  await db.part.deleteMany({ where: { id: { in: ids } } });
});

describe("OwnedPart.partId est unique", () => {
  it("refuses a second inventory row for a part that already has one", async () => {
    const part = await makePart();
    await db.ownedPart.create({ data: { partId: part.id, quantity: 1 } });

    await expect(db.ownedPart.create({ data: { partId: part.id, quantity: 2 } })).rejects.toThrow();
    expect(await db.ownedPart.count({ where: { partId: part.id } })).toBe(1);
  });
});

describe("db:reset applies the unique constraint on an empty database", () => {
  const dir = mkdtempSync(join(tmpdir(), "tha-test-unique-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses two inventory rows for the same part after a fresh reset", async () => {
    const url = `file:${join(dir, "unique.db")}`;
    execFileSync("npm", ["run", "db:reset"], {
      cwd: apiDir,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: url },
    });

    const client = createDb(url);
    try {
      // Shark Edge n'a pas de ligne d'inventaire dans le seed : la base de test part d'un état connu.
      const part = await client.part.findUniqueOrThrow({ where: { name: "Shark Edge" } });
      await client.ownedPart.create({ data: { partId: part.id, quantity: 1 } });

      await expect(client.ownedPart.create({ data: { partId: part.id, quantity: 1 } })).rejects.toThrow();
    } finally {
      await client.$disconnect();
    }
  }, 60_000);
});
