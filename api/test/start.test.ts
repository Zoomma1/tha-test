import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { z } from "zod";
import { SEED_PARTS } from "../src/seed-data.js";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsSchema = z.object({ scripts: z.object({ start: z.string() }) });
const partsSchema = z.array(z.object({ name: z.string() }));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  await new Promise<void>((done) => server.close(() => { done(); }));
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function waitForParts(port: number): Promise<unknown> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${String(port)}/api/parts`);
      return await res.json();
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("server never answered");
}

it("`npm run build` then the start script's own command serves /api/parts", async () => {
  execFileSync("npm", ["run", "build"], { cwd: apiDir, stdio: "pipe" });
  const { scripts } = scriptsSchema.parse(JSON.parse(readFileSync(resolve(apiDir, "package.json"), "utf8")));
  const [bin, ...args] = scripts.start.split(" ");
  expect(bin).toBe("node");

  const port = await freePort();
  const child = spawn(process.execPath, args, { cwd: apiDir, stdio: "pipe", env: { ...process.env, PORT: String(port) } });
  try {
    const body = partsSchema.parse(await waitForParts(port));
    expect(body).toHaveLength(SEED_PARTS.length);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("exit", r));
    }
  }
}, 120_000);
