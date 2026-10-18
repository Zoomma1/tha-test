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

export const wishlistRoutes = new Hono().get("/", async (c) => {
  const rows = await db.wishlistItem.findMany({
    orderBy: { id: "asc" },
    include: { part: { select: { id: true, kind: true, name: true } } },
  });
  return c.json(z.array(wishlistItemSchema).parse(rows), 200);
});
