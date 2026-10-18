import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createDb, db } from "../src/db.js";
import type { PartKind } from "../src/seed-data.js";
import { SEED_PARTS } from "../src/seed-data.js";
import { get, readJson } from "./helpers.js";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Plages de poids du seed par type de pièce, en grammes, bornes incluses.
const WEIGHT_RANGES: Record<PartKind, readonly [number, number]> = {
  blade: [30, 40],
  ratchet: [8, 14],
  bit: [2, 6],
};

const weightRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  kind: z.enum(["blade", "ratchet", "bit"]),
  weightGrams: z.number().nullable(),
});
const weightRowsSchema = z.array(weightRowSchema);
type WeightRow = z.output<typeof weightRowSchema>;

type Client = ReturnType<typeof createDb>;

// Lit la colonne en SQL brut : le champ n'est pas encore dans le client Prisma généré.
async function readWeights(client: Client): Promise<WeightRow[]> {
  const rows = await client.$queryRaw`SELECT "id", "name", "kind", "weightGrams" FROM "Part" ORDER BY "id" ASC`;
  return weightRowsSchema.parse(rows);
}

describe("Part.weightGrams migration", () => {
  const dir = mkdtempSync(join(tmpdir(), "tha-test-weight-migrate-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies on an existing empty database", async () => {
    const file = join(dir, "empty.db");
    writeFileSync(file, "");
    const url = `file:${file}`;
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: apiDir,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: url },
    });

    const client = createDb(url);
    try {
      // La base est vide après migration : la lecture de la colonne réussit et ne renvoie aucune ligne.
      expect(await readWeights(client)).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  }, 60_000);
});

describe("Part.weightGrams is nullable", () => {
  // Chaque test supprime la pièce qu'il crée : la base test.db est partagée.
  const createdPartIds: number[] = [];

  afterEach(async () => {
    const ids = createdPartIds.splice(0);
    await db.part.deleteMany({ where: { id: { in: ids } } });
  });

  it("stores NULL for a part created without a weight", async () => {
    const part = await db.part.create({ data: { kind: "bit", name: `Pièce sans poids ${randomUUID()}` } });
    createdPartIds.push(part.id);

    const row = (await readWeights(db)).find((entry) => entry.id === part.id);
    expect(row).toEqual(expect.objectContaining({ id: part.id, weightGrams: null }));
  });
});

describe("db:reset gives the seeded parts a weight", () => {
  const dir = mkdtempSync(join(tmpdir(), "tha-test-weight-reset-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function reset(url: string): void {
    execFileSync("npm", ["run", "db:reset"], {
      cwd: apiDir,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: url },
    });
  }

  async function weightsOf(url: string): Promise<WeightRow[]> {
    const client = createDb(url);
    try {
      return await readWeights(client);
    } finally {
      await client.$disconnect();
    }
  }

  it("gives each of the seeded parts a weight inside its kind's range", async () => {
    const url = `file:${join(dir, "ranges.db")}`;
    reset(url);
    const rows = await weightsOf(url);

    expect(rows.map((row) => row.name).sort()).toEqual(SEED_PARTS.map((part) => part.name).sort());
    for (const row of rows) {
      const [min, max] = WEIGHT_RANGES[row.kind];
      expect(row.weightGrams, row.name).not.toBeNull();
      expect(row.weightGrams, row.name).toBeGreaterThanOrEqual(min);
      expect(row.weightGrams, row.name).toBeLessThanOrEqual(max);
    }
  }, 60_000);

  it("gives the same weights on two resets", async () => {
    const url = `file:${join(dir, "determinism.db")}`;
    reset(url);
    const first = await weightsOf(url);
    reset(url);
    const second = await weightsOf(url);

    expect(first.map((row) => row.weightGrams)).not.toContain(null);
    expect(second).toEqual(first);
  }, 60_000);
});

describe("GET /api/parts keeps its shape", () => {
  // Strict : une clé en plus (weightGrams) fait échouer la lecture.
  const strictPartSchema = z
    .object({
      id: z.number(),
      kind: z.enum(["blade", "ratchet", "bit"]),
      name: z.string(),
    })
    .strict();

  it("does not expose weightGrams in the response", async () => {
    const res = await get("/api/parts");
    expect(res.status).toBe(200);
    const body = await readJson(res, z.array(strictPartSchema));
    expect(body.length).toBeGreaterThan(0);
  });
});
