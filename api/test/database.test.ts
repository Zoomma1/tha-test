import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, db } from "../src/db.js";
import { databaseFilePath, resolveDatabaseUrl } from "../src/database-url.js";
import { SEED_BUILD, SEED_OWNED, SEED_PARTS, SEED_WISHLIST } from "../src/seed-data.js";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function dumpTables(url: string): Promise<string> {
  const client = createDb(url);
  try {
    const tables = {
      part: await client.part.findMany({ orderBy: { id: "asc" } }),
      ownedPart: await client.ownedPart.findMany({ orderBy: { id: "asc" } }),
      build: await client.build.findMany({ orderBy: { id: "asc" } }),
      buildPart: await client.buildPart.findMany({ orderBy: { id: "asc" } }),
      wishlistItem: await client.wishlistItem.findMany({ orderBy: { id: "asc" } }),
    };
    return JSON.stringify(tables);
  } finally {
    await client.$disconnect();
  }
}

function reset(url: string): void {
  execFileSync("npm", ["run", "db:reset"], { cwd: apiDir, stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}

describe("database file (AC-5)", () => {
  it("is a non-empty file on disk, not an in-memory database", () => {
    const url = resolveDatabaseUrl();
    expect(url).not.toContain(":memory:");
    const file = databaseFilePath(url);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(0);
  });

  it("holds exactly the seeded rows", async () => {
    expect(await db.part.count()).toBe(SEED_PARTS.length);
    expect(await db.ownedPart.count()).toBe(SEED_OWNED.length);
    expect(await db.build.count()).toBe(1);
    expect(await db.buildPart.count()).toBe(SEED_BUILD.partNames.length);
    expect(await db.wishlistItem.count()).toBe(SEED_WISHLIST.length);
  });
});

describe("db:reset determinism (AC-6)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tha-test-reset-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("produces identical rows on two runs, even over a dirty database", async () => {
    const url = `file:${join(dir, "reset.db")}`;
    reset(url);
    const first = await dumpTables(url);

    const dirty = createDb(url);
    await dirty.part.create({ data: { kind: "bit", name: "stray" } });
    await dirty.$disconnect();

    reset(url);
    const second = await dumpTables(url);

    expect(second).toBe(first);
    expect(second).toContain(SEED_PARTS[0]?.name);
    expect(second).not.toContain("stray");
  }, 60_000);
});
