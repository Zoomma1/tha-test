import { z } from "zod";
import { app } from "../src/app.js";

export const partSchema = z.object({
  id: z.number(),
  kind: z.enum(["blade", "ratchet", "bit"]),
  name: z.string(),
});

export async function get(path: string): Promise<Response> {
  return app.request(path);
}

export async function readJson<T extends z.ZodType>(res: Response, schema: T): Promise<z.output<T>> {
  return schema.parse(await res.json());
}
