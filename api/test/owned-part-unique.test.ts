import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, db } from "../src/db.js";
import { SEED_OWNED } from "../src/seed-data.js";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Un part propre à chaque test : ni le nombre de lignes global ni les pièces du seed ne sont touchés.
async function withProbePart(run: (partId: number) => Promise<void>): Promise<void> {
  const part = await db.part.create({ data: { kind: "bit", name: `probe-${randomUUID()}` } });
  try {
    await run(part.id);
  } finally {
    await db.ownedPart.deleteMany({ where: { partId: part.id } });
    await db.part.delete({ where: { id: part.id } });
  }
}

describe("OwnedPart.partId is unique (AC-1)", () => {
  it("refuses a second inventory line for a part that already has one", async () => {
    await withProbePart(async (partId) => {
      await db.ownedPart.create({ data: { partId, quantity: 1 } });

      await expect(db.ownedPart.create({ data: { partId, quantity: 2 } })).rejects.toThrow();

      const lines = await db.ownedPart.findMany({ where: { partId } });
      expect(lines).toHaveLength(1);
      expect(lines[0]?.quantity).toBe(1);
    });
  });

  it.each(SEED_OWNED)("refuses a second line for the seeded $partName", async ({ partName }) => {
    const part = await db.part.findUniqueOrThrow({ where: { name: partName } });
    const before = await db.ownedPart.count({ where: { partId: part.id } });

    // Si l'insertion passe (contrainte absente), la ligne est retirée pour ne pas polluer test.db.
    const insertedId = await db.ownedPart.create({ data: { partId: part.id, quantity: 1 } }).then(
      (row) => row.id,
      () => undefined,
    );
    if (insertedId !== undefined) await db.ownedPart.delete({ where: { id: insertedId } });

    expect(insertedId).toBeUndefined();
    expect(await db.ownedPart.count({ where: { partId: part.id } })).toBe(before);
  });
});

describe("migrations on an empty database (AC-2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tha-test-unique-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("enforces one inventory line per part on a freshly reset database", async () => {
    const url = `file:${join(dir, "fresh.db")}`;
    execFileSync("npm", ["run", "db:reset"], {
      cwd: apiDir,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: url },
    });

    const client = createDb(url);
    try {
      const part = await client.part.findUniqueOrThrow({ where: { name: "Dran Sword" } });
      await expect(client.ownedPart.create({ data: { partId: part.id, quantity: 1 } })).rejects.toThrow();
    } finally {
      await client.$disconnect();
    }
  }, 60_000);
});
