import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "../src/db.js";
import { authed, get, partSchema, readJson } from "./helpers.js";

const wishlistItemSchema = z.object({
  id: z.number(),
  partId: z.number(),
  note: z.string(),
  part: partSchema,
});

const listSchema = z.array(wishlistItemSchema);
const errorSchema = z.object({ error: z.string().min(1) });

async function postWishlist(body: unknown): Promise<Response> {
  return authed("/api/wishlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function listParts(): Promise<z.output<z.ZodArray<typeof partSchema>>> {
  return readJson(await get("/api/parts"), z.array(partSchema));
}

async function idOf(name: string): Promise<number> {
  const part = (await listParts()).find((p) => p.name === name);
  if (part === undefined) throw new Error(`seeded part "${name}" not found`);
  return part.id;
}

// Chaque test crée sa propre pièce (aucune ligne de liste d'achats ni d'inventaire) et la supprime ensuite.
const createdPartIds: number[] = [];

async function makePart(): Promise<{ id: number; kind: string; name: string }> {
  const part = await db.part.create({ data: { kind: "blade", name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return part;
}

async function rowsFor(partId: number): Promise<z.output<typeof listSchema>> {
  const body = await readJson(await authed("/api/wishlist"), listSchema);
  return body.filter((row) => row.partId === partId);
}

afterEach(async () => {
  const ids = createdPartIds.splice(0);
  await db.wishlistItem.deleteMany({ where: { partId: { in: ids } } });
  await db.part.deleteMany({ where: { id: { in: ids } } });
});

describe("POST /api/wishlist: création (201)", () => {
  it("creates the item with 201 and returns the full item, as GET does", async () => {
    const part = await makePart();
    const res = await postWishlist({ partId: part.id, note: "Pour le combo" });
    expect(res.status).toBe(201);
    const body = await readJson(res, wishlistItemSchema);
    expect(body).toMatchObject({
      partId: part.id,
      note: "Pour le combo",
      part: { id: part.id, kind: "blade", name: part.name },
    });
    expect(await rowsFor(part.id)).toEqual([body]);
  });

  it("uses an empty note when none is given", async () => {
    const part = await makePart();
    const res = await postWishlist({ partId: part.id });
    expect(res.status).toBe(201);
    const body = await readJson(res, wishlistItemSchema);
    expect(body.note).toBe("");
    expect(await rowsFor(part.id)).toEqual([body]);
  });
});

describe("POST /api/wishlist: pièce inconnue (404)", () => {
  it("returns 404 with an error, and creates no item", async () => {
    const ids = (await listParts()).map((p) => p.id);
    const unknown = Math.max(0, ...ids) + 1;

    const res = await postWishlist({ partId: unknown, note: "" });
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect(await rowsFor(unknown)).toEqual([]);
  });
});

describe("POST /api/wishlist: pièce déjà dans la liste (409)", () => {
  it("refuses a second add of the same part with 409 and keeps one item", async () => {
    const part = await makePart();
    expect((await postWishlist({ partId: part.id })).status).toBe(201);

    const res = await postWishlist({ partId: part.id, note: "doublon" });
    expect(res.status).toBe(409);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect(await rowsFor(part.id)).toHaveLength(1);
  });

  it("refuses a part already seeded in the wishlist (Wizard Arrow) with 409", async () => {
    const partId = await idOf("Wizard Arrow");
    const before = await rowsFor(partId);
    expect(before).toHaveLength(1);

    const res = await postWishlist({ partId, note: "doublon" });
    expect(res.status).toBe(409);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect(await rowsFor(partId)).toEqual(before);
  });
});
