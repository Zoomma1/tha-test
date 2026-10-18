import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SEED_PARTS } from "../src/seed-data.js";
import { get, partSchema, readJson } from "./helpers.js";

const listSchema = z.array(partSchema);
const KIND_ORDER = ["blade", "ratchet", "bit"] as const;

async function listNames(query: string): Promise<string[]> {
  const body = await readJson(await get(`/api/parts?${query}`), listSchema);
  return body.map((p) => p.name).sort();
}

function seedNamesMatching(term: string): string[] {
  return SEED_PARTS.filter((p) => p.name.toLowerCase().includes(term.toLowerCase()))
    .map((p) => p.name)
    .sort();
}

describe("GET /api/parts?search=", () => {
  it("returns Dran Sword for search=dran", async () => {
    const res = await get("/api/parts?search=dran");
    expect(res.status).toBe(200);
    const body = await readJson(res, listSchema);
    expect(body.map((p) => p.name)).toContain("Dran Sword");
    expect(body.every((p) => p.name.toLowerCase().includes("dran"))).toBe(true);
    expect(body.map((p) => p.name).sort()).toEqual(seedNamesMatching("dran"));
  });

  it("matches case-insensitively", async () => {
    const lower = await listNames("search=dran");
    expect(lower).toEqual(seedNamesMatching("dran"));
    expect(await listNames("search=DRAN")).toEqual(lower);
    expect(await listNames("search=dRaN")).toEqual(lower);
  });

  it("matches a substring anywhere in the name, not only a prefix", async () => {
    expect(await listNames("search=needle")).toEqual(["High Needle", "Needle"]);
  });

  it("returns an empty list when nothing matches", async () => {
    const res = await get("/api/parts?search=zzzz-aucune-piece");
    expect(res.status).toBe(200);
    expect(await readJson(res, listSchema)).toEqual([]);
  });

  it("applies search and kind together", async () => {
    const res = await get("/api/parts?search=needle&kind=bit");
    expect(res.status).toBe(200);
    const body = await readJson(res, listSchema);
    expect(body.every((p) => p.kind === "bit")).toBe(true);
    expect(body.map((p) => p.name).sort()).toEqual(["High Needle", "Needle"]);
  });

  it("applies kind as a second filter: a match in another kind is excluded", async () => {
    expect(await listNames("search=needle&kind=blade")).toEqual([]);
  });

  it("treats an empty search value as no search", async () => {
    const withoutParam = await readJson(await get("/api/parts"), listSchema);
    const withEmptyParam = await readJson(await get("/api/parts?search="), listSchema);
    expect(withEmptyParam).toEqual(withoutParam);
  });

  it("keeps the kind-then-id order when a search matches several kinds", async () => {
    const body = await readJson(await get("/api/parts?search=e"), listSchema);
    expect(body.map((p) => p.name).sort()).toEqual(seedNamesMatching("e"));
    expect(new Set(body.map((p) => p.kind)).size).toBeGreaterThan(1);

    const kindRanks = body.map((p) => KIND_ORDER.indexOf(p.kind));
    expect(kindRanks).toEqual([...kindRanks].sort((x, y) => x - y));
    for (const kind of KIND_ORDER) {
      const ids = body.filter((p) => p.kind === kind).map((p) => p.id);
      expect(ids).toEqual([...ids].sort((x, y) => x - y));
    }
  });
});
