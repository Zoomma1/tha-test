import { basename } from "node:path";
import { expect, it } from "vitest";
import { databaseFilePath, resolveDatabaseUrl } from "../src/database-url.js";

it("runs against the dedicated test.db, never the dev database", () => {
  const file = databaseFilePath(resolveDatabaseUrl());
  expect(basename(file)).toBe("test.db");
  expect(file).not.toContain("dev.db");
});
