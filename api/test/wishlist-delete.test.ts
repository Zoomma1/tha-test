import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { get, partSchema, readJson } from "./helpers.js";

const wishlistItemSchema = z.object({
  id: z.number(),
  partId: z.number(),
  note: z.string(),
  part: partSchema,
});

const listSchema = z.array(wishlistItemSchema);
const errorSchema = z.object({ error: z.string().min(1) });

async function postWishlist(body: unknown): Promise<Response> {
  return app.request("/api/wishlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function deleteWishlist(id: number): Promise<Response> {
  return app.request(`/api/wishlist/${String(id)}`, { method: "DELETE" });
}

// Chaque test crée sa propre pièce (aucune ligne de liste d'achats ni d'inventaire) et la supprime ensuite.
const createdPartIds: number[] = [];

async function makePart(): Promise<{ id: number; kind: string; name: string }> {
  const part = await db.part.create({ data: { kind: "blade", name: `Pièce de test ${randomUUID()}` } });
  createdPartIds.push(part.id);
  return part;
}

// L'élément de liste est créé par la route publique POST, comme un appelant le ferait.
async function makeWishlistItem(): Promise<z.output<typeof wishlistItemSchema>> {
  const part = await makePart();
  return readJson(await postWishlist({ partId: part.id, note: "à supprimer" }), wishlistItemSchema);
}

async function listAll(): Promise<z.output<typeof listSchema>> {
  return readJson(await get("/api/wishlist"), listSchema);
}

async function rowsFor(partId: number): Promise<z.output<typeof listSchema>> {
  const body = await listAll();
  return body.filter((row) => row.partId === partId);
}

afterEach(async () => {
  const ids = createdPartIds.splice(0);
  await db.wishlistItem.deleteMany({ where: { partId: { in: ids } } });
  await db.part.deleteMany({ where: { id: { in: ids } } });
});

describe("DELETE /api/wishlist/:id: suppression (204)", () => {
  it("returns 204 with an empty body", async () => {
    const created = await makeWishlistItem();

    const res = await deleteWishlist(created.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("removes the item from GET /api/wishlist", async () => {
    const created = await makeWishlistItem();
    expect(await rowsFor(created.partId)).toHaveLength(1);

    expect((await deleteWishlist(created.id)).status).toBe(204);

    expect(await rowsFor(created.partId)).toEqual([]);
    expect((await listAll()).map((row) => row.id)).not.toContain(created.id);
  });

  it("removes only the targeted item and leaves the other rows in place", async () => {
    const kept = await makeWishlistItem();
    const removed = await makeWishlistItem();
    const before = (await listAll()).map((row) => row.id);

    expect((await deleteWishlist(removed.id)).status).toBe(204);

    const after = (await listAll()).map((row) => row.id);
    expect(after).toEqual(before.filter((id) => id !== removed.id));
    expect(after).toContain(kept.id);
  });

  it("keeps the seeded wishlist rows (Wizard Arrow) when another item is deleted", async () => {
    const seeded = (await listAll()).find((row) => row.part.name === "Wizard Arrow");
    const created = await makeWishlistItem();

    expect((await deleteWishlist(created.id)).status).toBe(204);

    expect(seeded).toBeDefined();
    expect((await listAll()).map((row) => row.id)).toContain(seeded?.id);
  });
});

describe("DELETE /api/wishlist/:id: élément inconnu (404)", () => {
  it("returns 404 with an error for an id that does not exist", async () => {
    const ids = (await listAll()).map((row) => row.id);
    const unknown = Math.max(0, ...ids) + 1;

    const res = await deleteWishlist(unknown);
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
  });

  it("returns 404 when the item was already deleted, and the list is unchanged", async () => {
    const created = await makeWishlistItem();
    expect((await deleteWishlist(created.id)).status).toBe(204);
    const before = (await listAll()).map((row) => row.id);

    const res = await deleteWishlist(created.id);
    expect(res.status).toBe(404);
    const body = await readJson(res, errorSchema);
    expect(body.error).toBeTruthy();
    expect((await listAll()).map((row) => row.id)).toEqual(before);
  });
});
