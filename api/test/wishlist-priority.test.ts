import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "../src/app.js";
import { createDb, db } from "../src/db.js";
import { SEED_WISHLIST } from "../src/seed-data.js";
import { get, partSchema, readJson } from "./helpers.js";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESET_TIMEOUT = 120_000;

const wishlistItemSchema = z.object({
  id: z.number(),
  partId: z.number(),
  note: z.string(),
  priority: z.number().int().min(0).max(5),
  part: partSchema,
});

const listSchema = z.array(wishlistItemSchema);
const errorSchema = z.object({ error: z.string().min(1) });

// Le champ n'existe pas encore dans le client Prisma généré : on lit en SQL brut et on valide avec zod.
const columnSchema = z.object({ name: z.string(), notnull: z.number(), dflt_value: z.string().nullable() });
const seedPrioritySchema = z.array(z.object({ name: z.string(), priority: z.number().int() }));

async function postWishlist(body: unknown): Promise<Response> {
  return app.request("/api/wishlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Chaque test crée sa propre pièce (aucune ligne de liste d'achats ni d'inventaire) et la supprime ensuite.
const createdPartIds: number[] = [];

async function makePart(): Promise<{ id: number; kind: string; name: string }> {
  const part = await db.part.create({ data: { kind: "blade", name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return part;
}

async function listAll(): Promise<z.output<typeof listSchema>> {
  return readJson(await get("/api/wishlist"), listSchema);
}

async function rowsFor(partId: number): Promise<z.output<typeof listSchema>> {
  const body = await listAll();
  return body.filter((row) => row.partId === partId);
}

function byPriorityThenId(a: z.output<typeof wishlistItemSchema>, b: z.output<typeof wishlistItemSchema>): number {
  return b.priority - a.priority || a.id - b.id;
}

afterEach(async () => {
  const ids = createdPartIds.splice(0);
  await db.wishlistItem.deleteMany({ where: { partId: { in: ids } } });
  await db.part.deleteMany({ where: { id: { in: ids } } });
});

describe("migration: WishlistItem.priority", () => {
  const dir = mkdtempSync(join(tmpdir(), "tha-test-priority-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies on an empty database and adds a NOT NULL priority column defaulting to 0", async () => {
    const url = `file:${join(dir, "migrate.db")}`;
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: apiDir,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: url },
    });

    const client = createDb(url);
    try {
      const columns = z.array(columnSchema).parse(
        await client.$queryRaw`SELECT name, "notnull", dflt_value FROM pragma_table_info('WishlistItem')`,
      );
      expect(columns.find((c) => c.name === "priority")).toMatchObject({ notnull: 1, dflt_value: "0" });
    } finally {
      await client.$disconnect();
    }
  }, RESET_TIMEOUT);
});

describe("db:reset: priorités des éléments du seed", () => {
  const dir = mkdtempSync(join(tmpdir(), "tha-test-priority-reset-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives every seeded wishlist item priority 0 after a fresh reset", async () => {
    const url = `file:${join(dir, "seeded.db")}`;
    execFileSync("npm", ["run", "db:reset"], {
      cwd: apiDir,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: url },
    });

    const client = createDb(url);
    try {
      const rows = seedPrioritySchema.parse(
        await client.$queryRaw`SELECT p.name AS name, w.priority AS priority FROM WishlistItem AS w JOIN Part AS p ON p.id = w.partId`,
      );
      expect(rows).toHaveLength(SEED_WISHLIST.length);
      for (const seed of SEED_WISHLIST) {
        expect(rows.find((r) => r.name === seed.partName)).toEqual({ name: seed.partName, priority: 0 });
      }
    } finally {
      await client.$disconnect();
    }
  }, RESET_TIMEOUT);
});

describe("POST /api/wishlist: priorité valide (201)", () => {
  it.each([0, 3, 5])("accepts priority %i with 201 and returns it", async (priority) => {
    const part = await makePart();
    const res = await postWishlist({ partId: part.id, note: "", priority });
    expect(res.status).toBe(201);
    const body = await readJson(res, wishlistItemSchema);
    expect(body.priority).toBe(priority);
    expect(await rowsFor(part.id)).toEqual([body]);
  });

  it("defaults the priority to 0 when none is given", async () => {
    const part = await makePart();
    const res = await postWishlist({ partId: part.id });
    expect(res.status).toBe(201);
    const body = await readJson(res, wishlistItemSchema);
    expect(body.priority).toBe(0);
    expect(await rowsFor(part.id)).toEqual([body]);
  });
});

describe("POST /api/wishlist: priorité hors de 0 à 5 (400)", () => {
  it.each([-1, 6, 2.5])("refuses priority %s with 400, an error, and creates no item", async (priority) => {
    const part = await makePart();
    const res = await postWishlist({ partId: part.id, note: "", priority });
    expect(res.status).toBe(400);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect(await rowsFor(part.id)).toEqual([]);
  });
});

describe("GET /api/wishlist: ordre par priorité décroissante puis id", () => {
  it("gives every seeded row priority 0", async () => {
    const body = await listAll();
    for (const seed of SEED_WISHLIST) {
      const row = body.find((r) => r.part.name === seed.partName);
      expect(row?.priority).toBe(0);
    }
  });

  it("lists a higher priority before a lower one, whatever the insertion order", async () => {
    const low = await makePart();
    const high = await makePart();
    const middle = await makePart();
    await postWishlist({ partId: low.id, priority: 1 });
    await postWishlist({ partId: high.id, priority: 4 });
    await postWishlist({ partId: middle.id, priority: 2 });

    const mine = (await listAll()).filter((row) => [low.id, high.id, middle.id].includes(row.partId));
    expect(mine.map((row) => row.partId)).toEqual([high.id, middle.id, low.id]);
  });

  it("breaks a priority tie by id, ascending", async () => {
    const first = await makePart();
    const second = await makePart();
    const top = await makePart();
    await postWishlist({ partId: first.id, priority: 4 });
    await postWishlist({ partId: second.id, priority: 4 });
    await postWishlist({ partId: top.id, priority: 5 });

    const mine = (await listAll()).filter((row) => [first.id, second.id, top.id].includes(row.partId));
    expect(mine.map((row) => row.partId)).toEqual([top.id, first.id, second.id]);
  });

  it("orders the whole list by priority descending, then id ascending", async () => {
    const a = await makePart();
    const b = await makePart();
    await postWishlist({ partId: a.id, priority: 2 });
    await postWishlist({ partId: b.id, priority: 5 });

    const body = await listAll();
    expect(body).toEqual([...body].sort(byPriorityThenId));
  });
});
