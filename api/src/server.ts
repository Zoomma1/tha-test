import { serve } from "@hono/node-server";
import { app } from "./app.js";

const DEFAULT_PORT = 3000;
const port = Number(process.env["PORT"] ?? DEFAULT_PORT);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${String(info.port)}`);
});
