import { describe, expect, it } from "vitest";
import { z } from "zod";
import { get, partSchema, readJson } from "./helpers.js";

const listSchema = z.array(partSchema);
type Part = z.output<typeof partSchema>;

async function search(query: string): Promise<Part[]> {
  return readJson(await get(`/api/parts?${query}`), listSchema);
}

function names(parts: readonly Part[]): string[] {
  return parts.map((p) => p.name);
}

describe("GET /api/parts?search=", () => {
  it("finds a part by a part of its name", async () => {
    const body = await search("search=dran");
    expect(names(body)).toContain("Dran Sword");
    expect(body.every((p) => p.name.toLowerCase().includes("dran"))).toBe(true);
  });

  it("matches a substring, not only the start of the name", async () => {
    const body = await search("search=sword");
    expect(names(body)).toContain("Dran Sword");
    expect(body.every((p) => p.name.toLowerCase().includes("sword"))).toBe(true);
  });

  it.each(["DRAN", "DrAn"])("ignores the case of the value (search=%s)", async (value) => {
    const body = await search(`search=${value}`);
    expect(names(body)).toContain("Dran Sword");
    expect(body.every((p) => p.name.toLowerCase().includes("dran"))).toBe(true);
  });

  it("returns an empty list when nothing matches", async () => {
    const res = await get("/api/parts?search=zzzzzz");
    expect(res.status).toBe(200);
    expect(await readJson(res, listSchema)).toEqual([]);
  });

  it("treats an empty value as no filter, and a non-empty value as a filter", async () => {
    const all = await readJson(await get("/api/parts"), listSchema);
    expect(await search("search=")).toEqual(all);
    expect((await search("search=dran")).length).toBeLessThan(all.length);
  });

  it("applies both search and kind when combined", async () => {
    const body = await search("search=dran&kind=blade");
    expect(names(body)).toContain("Dran Sword");
    expect(body.every((p) => p.kind === "blade" && p.name.toLowerCase().includes("dran"))).toBe(true);
  });

  it("applies kind on top of search: no bit matches 'dran'", async () => {
    expect(await search("search=dran&kind=bit")).toEqual([]);
  });

  it("keeps the kind-then-id ordering on search results", async () => {
    const body = await search("search=i");
    expect(body.every((p) => p.name.toLowerCase().includes("i"))).toBe(true);
    const kinds = body.map((p) => p.kind);
    expect(kinds).toEqual([...kinds].sort());
    for (const kind of ["blade", "ratchet", "bit"] as const) {
      const ids = body.filter((p) => p.kind === kind).map((p) => p.id);
      expect(ids).toEqual([...ids].sort((x, y) => x - y));
    }
  });
});
