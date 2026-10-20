import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createDb, db } from "../src/db.js";
import { SEED_PARTS, type PartKind } from "../src/seed-data.js";
import { get, partSchema, readJson } from "./helpers.js";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESET_TIMEOUT = 120_000;

// Le champ n'existe pas encore dans le client Prisma généré : on lit en SQL brut et on valide avec zod.
const columnSchema = z.object({ name: z.string(), notnull: z.number() });
const weightRowSchema = z.object({ kind: z.string(), name: z.string(), weightGrams: z.number().int().nullable() });
const weightRowsSchema = z.array(weightRowSchema);

const RANGES: Record<PartKind, { min: number; max: number }> = {
  blade: { min: 30, max: 40 },
  ratchet: { min: 8, max: 14 },
  bit: { min: 2, max: 6 },
};

async function readWeights(client: ReturnType<typeof createDb>): Promise<z.output<typeof weightRowsSchema>> {
  const rows = await client.$queryRaw`SELECT kind, name, weightGrams FROM Part ORDER BY id`;
  return weightRowsSchema.parse(rows);
}

function runDbReset(url: string): void {
  execFileSync("npm", ["run", "db:reset"], {
    cwd: apiDir,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}

async function resetAndRead(url: string): Promise<z.output<typeof weightRowsSchema>> {
  runDbReset(url);
  const client = createDb(url);
  try {
    return await readWeights(client);
  } finally {
    await client.$disconnect();
  }
}

describe("migration: Part.weightGrams", () => {
  const dir = mkdtempSync(join(tmpdir(), "tha-test-weight-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies on an empty database and adds a nullable weightGrams column", async () => {
    const url = `file:${join(dir, "migrate.db")}`;
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: apiDir,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: url },
    });

    const client = createDb(url);
    try {
      const columns = z.array(columnSchema).parse(
        await client.$queryRaw`SELECT name, "notnull" FROM pragma_table_info('Part')`,
      );
      expect(columns.find((c) => c.name === "weightGrams")).toMatchObject({ notnull: 0 });
    } finally {
      await client.$disconnect();
    }
  }, RESET_TIMEOUT);
});

describe("db:reset weights", () => {
  const dir = mkdtempSync(join(tmpdir(), "tha-test-weight-reset-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives the same weightGrams to every part on two consecutive resets", async () => {
    const url = `file:${join(dir, "deterministic.db")}`;
    const first = await resetAndRead(url);
    const second = await resetAndRead(url);

    expect(first).toHaveLength(SEED_PARTS.length);
    expect(first.every((row) => row.weightGrams !== null)).toBe(true);
    expect(second).toEqual(first);
  }, RESET_TIMEOUT);
});

describe("seeded part weights", () => {
  it.each(SEED_PARTS)("gives $name a weight within the range of its kind", async (seed) => {
    const row = (await readWeights(db)).find((r) => r.name === seed.name);
    const range = RANGES[seed.kind];

    expect(row?.weightGrams).toBeGreaterThanOrEqual(range.min);
    expect(row?.weightGrams).toBeLessThanOrEqual(range.max);
  });
});

describe("GET /api/parts after the weight column", () => {
  it("returns weightGrams (integer or null) on every part, next to id, kind and name", async () => {
    const res = await get("/api/parts");
    expect(res.status).toBe(200);
    const body = await readJson(res, z.array(partSchema.extend({ weightGrams: z.number().int().nullable() })));
    expect(body.length).toBeGreaterThan(0);
  });
});
