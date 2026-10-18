import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db.js";
import { partKindSchema } from "./parts.js";

const wishlistItemSchema = z.object({
  id: z.number(),
  partId: z.number(),
  note: z.string(),
  part: z.object({ id: z.number(), kind: partKindSchema, name: z.string() }),
});

const addWishlistSchema = z.object({
  partId: z.number().int(),
  note: z.string().default(""),
});

const include = { part: { select: { id: true, kind: true, name: true } } };

export const wishlistRoutes = new Hono()
  .get("/", async (c) => {
    const rows = await db.wishlistItem.findMany({
      orderBy: { id: "asc" },
      include,
    });
    return c.json(z.array(wishlistItemSchema).parse(rows), 200);
  })
  .post("/", async (c) => {
    const json: unknown = await c.req.json().catch(() => null);
    const parsed = addWishlistSchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const { partId, note } = parsed.data;

    const part = await db.part.findUnique({ where: { id: partId } });
    if (!part) return c.json({ error: "part not found" }, 404);

    const existing = await db.wishlistItem.findFirst({ where: { partId } });
    if (existing) return c.json({ error: "already in wishlist" }, 409);

    const row = await db.wishlistItem.create({ data: { partId, note }, include });
    return c.json(wishlistItemSchema.parse(row), 201);
  });
