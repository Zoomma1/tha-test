import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { DATABASE_URL: "file:./test.db" },
    environment: "node", fileParallelism: false, include: ["test/**/*.test.ts"] },
});
