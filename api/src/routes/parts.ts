import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db.js";

export const partKindSchema = z.enum(["blade", "ratchet", "bit"]);

const listPartsQuery = z.object({ kind: partKindSchema.optional(), search: z.string().optional() });

const partIdParam = z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int());

export const partsRoutes = new Hono()
  .get("/", zValidator("query", listPartsQuery), async (c) => {
    const { kind, search } = c.req.valid("query");
    const parts = await db.part.findMany({
      where: {
        ...(kind === undefined ? {} : { kind }),
        ...(search === undefined || search === "" ? {} : { name: { contains: search } }),
      },
      orderBy: [{ kind: "asc" }, { id: "asc" }],
    });
    // La colonne est un String : on revalide pour que le type exposé au front soit l'union, pas string.
    return c.json(parts.map((p) => ({ id: p.id, kind: partKindSchema.parse(p.kind), name: p.name })), 200);
  })
  .get("/:id", async (c) => {
    const parsed = partIdParam.safeParse(c.req.param("id"));
    if (!parsed.success) return c.json({ error: "invalid id" }, 400);
    const part = await db.part.findUnique({ where: { id: parsed.data } });
    if (part === null) return c.json({ error: "part not found" }, 404);
    return c.json({ id: part.id, kind: partKindSchema.parse(part.kind), name: part.name }, 200);
  });
