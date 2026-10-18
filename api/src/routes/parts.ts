import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db.js";

export const partKindSchema = z.enum(["blade", "ratchet", "bit"]);

const listPartsQuery = z.object({ kind: partKindSchema.optional() });

const partIdParam = z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int());

export const partsRoutes = new Hono()
  .get("/", zValidator("query", listPartsQuery), async (c) => {
    const { kind } = c.req.valid("query");
    const parts = await db.part.findMany({
      where: kind === undefined ? {} : { kind },
      orderBy: [{ kind: "asc" }, { id: "asc" }],
    });
    // La colonne est un String : on revalide pour que le type exposé au front soit l'union, pas string.
    return c.json(parts.map((p) => ({ ...p, kind: partKindSchema.parse(p.kind) })), 200);
  })
  .get("/:id", async (c) => {
    const parsed = partIdParam.safeParse(c.req.param("id"));
    if (!parsed.success) return c.json({ error: "invalid id" }, 400);
    const part = await db.part.findUnique({ where: { id: parsed.data } });
    if (part === null) return c.json({ error: "part not found" }, 404);
    return c.json({ ...part, kind: partKindSchema.parse(part.kind) }, 200);
  });
