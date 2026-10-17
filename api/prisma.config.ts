import { defineConfig } from "prisma/config";
import { resolveDatabaseUrl } from "./src/database-url.js";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: resolveDatabaseUrl() },
});
