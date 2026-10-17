import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db.js";

export const partKindSchema = z.enum(["blade", "ratchet", "bit"]);

const listPartsQuery = z.object({ kind: partKindSchema.optional() });

export const partsRoutes = new Hono().get("/", zValidator("query", listPartsQuery), async (c) => {
  const { kind } = c.req.valid("query");
  const parts = await db.part.findMany({
    where: kind === undefined ? {} : { kind },
    orderBy: [{ kind: "asc" }, { id: "asc" }],
  });
  // La colonne est un String : on revalide pour que le type exposé au front soit l'union, pas string.
  return c.json(parts.map((p) => ({ ...p, kind: partKindSchema.parse(p.kind) })), 200);
});
