import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE_PREFIX = "file:";

// Relative file: URLs resolve against api/, not the caller's cwd, so every entry point hits the same file.
export function resolveDatabaseUrl(raw: string | undefined = process.env["DATABASE_URL"]): string {
  const url = raw ?? `${FILE_PREFIX}./dev.db`;
  if (!url.startsWith(FILE_PREFIX)) return url;
  const path = url.slice(FILE_PREFIX.length);
  return `${FILE_PREFIX}${isAbsolute(path) ? path : resolve(API_DIR, path)}`;
}

export function databaseFilePath(url: string = resolveDatabaseUrl()): string {
  if (!url.startsWith(FILE_PREFIX)) throw new Error(`not a file database: ${url}`);
  return url.slice(FILE_PREFIX.length);
}
