import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db.js";
import { partKindSchema } from "./parts.js";

const wishlistItemSchema = z.object({
  id: z.number(),
  partId: z.number(),
  note: z.string(),
  priority: z.number(),
  part: z.object({ id: z.number(), kind: partKindSchema, name: z.string() }),
});

const addWishlistSchema = z.object({
  partId: z.number().int(),
  note: z.string().default(""),
  priority: z.number().int().min(0).max(5).default(0),
});

const include = { part: { select: { id: true, kind: true, name: true } } };

export const wishlistRoutes = new Hono()
  .get("/", async (c) => {
    const rows = await db.wishlistItem.findMany({
      orderBy: [{ priority: "desc" }, { id: "asc" }],
      include,
    });
    return c.json(z.array(wishlistItemSchema).parse(rows), 200);
  })
  .post("/", async (c) => {
    const json: unknown = await c.req.json().catch(() => null);
    const parsed = addWishlistSchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const { partId, note, priority } = parsed.data;

    const part = await db.part.findUnique({ where: { id: partId } });
    if (!part) return c.json({ error: "part not found" }, 404);

    const existing = await db.wishlistItem.findFirst({ where: { partId } });
    if (existing) return c.json({ error: "already in wishlist" }, 409);

    const row = await db.wishlistItem.create({ data: { partId, note, priority }, include });
    return c.json(wishlistItemSchema.parse(row), 201);
  })
  .post("/from-build/:buildId", async (c) => {
    const buildId = Number(c.req.param("buildId"));
    if (!Number.isInteger(buildId)) return c.json({ error: "build not found" }, 404);
    const build = await db.build.findUnique({ where: { id: buildId } });
    if (!build) return c.json({ error: "build not found" }, 404);

    const buildParts = await db.buildPart.findMany({ where: { buildId } });
    const partIds = [...new Set(buildParts.map((row) => row.partId))];
    const owned = await db.ownedPart.findMany({ where: { partId: { in: partIds } } });
    const listed = await db.wishlistItem.findMany({ where: { partId: { in: partIds } } });
    const skip = new Set([...owned, ...listed].map((row) => row.partId));

    const added = [];
    for (const partId of partIds) {
      if (skip.has(partId)) continue;
      added.push(await db.wishlistItem.create({ data: { partId, note: "", priority: 0 }, include }));
    }
    return c.json(z.array(wishlistItemSchema).parse(added), 201);
  })
  .delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "wishlist item not found" }, 404);
    const existing = await db.wishlistItem.findUnique({ where: { id } });
    if (!existing) return c.json({ error: "wishlist item not found" }, 404);
    await db.wishlistItem.delete({ where: { id } });
    return c.body(null, 204);
  });
