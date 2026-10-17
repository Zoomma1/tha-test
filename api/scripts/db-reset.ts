import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../src/db.js";
import { databaseFilePath, resolveDatabaseUrl } from "../src/database-url.js";
import { seed } from "../src/seed.js";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = resolveDatabaseUrl();
const file = databaseFilePath(url);

// Starting from no file at all is what makes two resets produce identical rows.
for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(`${file}${suffix}`, { force: true });

execFileSync("npx", ["prisma", "migrate", "deploy"], {
  cwd: apiDir,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});

const db = createDb(url);
try {
  await seed(db);
} finally {
  await db.$disconnect();
}
