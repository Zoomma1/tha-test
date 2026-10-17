import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED, runCanary } from "./canary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const AS_UNKNOWN = "TSAsExpression > TSAsExpression[typeAnnotation.type='TSUnknownKeyword']";
const ZOD = "CallExpression[callee.object.name='z'][callee.property.name=/^(any|custom)$/]";
const only = (selector) => [{ files: ["canary/**"], rules: { "no-restricted-syntax": ["error", { selector, message: selector === ZOD ? "z.any()" : "as unknown as" }] } }];
const off = (rule) => [{ files: ["canary/**"], rules: { [rule]: "off" } }];

test("canary passes on the real config", async () => {
  assert.deepEqual(await runCanary(), []);
});

// [rule or label, config mutation, files that must fail]
const MUTATIONS = [
  ["@typescript-eslint/no-explicit-any", off("@typescript-eslint/no-explicit-any"), ["01-explicit-any"]],
  ["@typescript-eslint/ban-ts-comment", off("@typescript-eslint/ban-ts-comment"), ["02-ts-ignore", "03-ts-expect-error"]],
  ["@eslint-community/eslint-comments/no-use", off("@eslint-community/eslint-comments/no-use"), ["04-eslint-disable"]],
  ["no-restricted-syntax (as unknown as selector)", only(ZOD), ["05-as-unknown-as"]],
  ["no-restricted-syntax (z.any selector)", only(AS_UNKNOWN), ["06-zod-any"]],
  ["@typescript-eslint/no-unsafe-assignment", off("@typescript-eslint/no-unsafe-assignment"), ["07-untyped-response-json", "09-implicit-json-parse"]],
  ["@typescript-eslint/no-non-null-assertion", off("@typescript-eslint/no-non-null-assertion"), ["08-non-null-assertion"]],
];

for (const [label, overrideConfig, files] of MUTATIONS) {
  test(`canary fails without ${label}`, async () => {
    const failed = (await runCanary({ overrideConfig })).map((f) => path.basename(f.file, ".ts"));
    assert.deepEqual(failed.sort(), files);
  });
}

test("every expected rule is covered by a mutation", () => {
  const covered = new Set(MUTATIONS.flatMap(([, , files]) => files));
  for (const e of EXPECTED) assert.ok(covered.has(path.basename(e.file, ".ts")), e.file);
});

test("a missing canary file fails the canary", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "canary-"));
  try {
    cpSync(path.join(root, "canary"), path.join(tmp, "canary"), { recursive: true });
    for (const f of ["eslint.config.mjs", "tsconfig.base.json", "package.json"]) copyFileSync(path.join(root, f), path.join(tmp, f));
    symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"));
    rmSync(path.join(tmp, "canary/03-ts-expect-error.ts"));
    assert.ok(readdirSync(path.join(tmp, "canary")).length > 0);
    assert.deepEqual(await runCanary({ root: tmp }), [
      { file: "canary/03-ts-expect-error.ts", rule: "@typescript-eslint/ban-ts-comment", reason: "file missing" },
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("running the script through a symlink still fails on a missing canary file", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "canary-link-"));
  try {
    const repo = path.join(tmp, "repo");
    mkdirSync(path.join(repo, "scripts"), { recursive: true });
    cpSync(path.join(root, "canary"), path.join(repo, "canary"), { recursive: true });
    for (const f of ["eslint.config.mjs", "tsconfig.base.json", "package.json", "scripts/canary.mjs"]) copyFileSync(path.join(root, f), path.join(repo, f));
    symlinkSync(path.join(root, "node_modules"), path.join(repo, "node_modules"));
    rmSync(path.join(repo, "canary/08-non-null-assertion.ts"));
    const link = path.join(tmp, "link.mjs");
    symlinkSync(path.join(repo, "scripts/canary.mjs"), link);
    const r = spawnSync(process.execPath, [link], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /08-non-null-assertion\.ts/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function tmpRepo(prefix) {
  const tmp = mkdtempSync(path.join(tmpdir(), prefix));
  cpSync(path.join(root, "canary"), path.join(tmp, "canary"), { recursive: true });
  for (const f of ["eslint.config.mjs", "tsconfig.base.json", "package.json"]) copyFileSync(path.join(root, f), path.join(tmp, f));
  symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"));
  return tmp;
}

test("a canary file that does not compile is reported as fatal with its message", () => {
  const tmp = tmpRepo("canary-fatal-");
  try {
    writeFileSync(path.join(tmp, "canary/01-explicit-any.ts"), "export const x: = ;\n");
    // The script resolves its root from its own location, so run the copy.
    mkdirSync(path.join(tmp, "scripts"));
    copyFileSync(path.join(root, "scripts/canary.mjs"), path.join(tmp, "scripts/canary.mjs"));
    const copy = spawnSync(process.execPath, [path.join(tmp, "scripts/canary.mjs")], { encoding: "utf8" });
    assert.equal(copy.status, 1);
    assert.match(copy.stderr, /01-explicit-any\.ts fatal parse\/type error: .+/);
    assert.doesNotMatch(copy.stderr, /01-explicit-any\.ts not detected/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function lintStatus(configEdit, withStray) {
  const tmp = tmpRepo("canary-stray-");
  try {
    const cfg = path.join(tmp, "eslint.config.mjs");
    writeFileSync(cfg, configEdit(readFileSync(cfg, "utf8")));
    writeFileSync(path.join(tmp, "ok.mjs"), "export const ok = 1;\n");
    if (withStray) writeFileSync(path.join(tmp, "canary/stray.ts"), "export const x: any = 1;\n");
    return spawnSync(process.execPath, [path.join(root, "node_modules/eslint/bin/eslint.js"), "."], { cwd: tmp, encoding: "utf8" }).status;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test("npm run lint ignores the fixtures but still lints a stray file in canary/", () => {
  const same = (s) => s;
  assert.equal(lintStatus(same, false), 0);
  assert.notEqual(lintStatus(same, true), 0);
});

test("mutation: a blanket canary/** ignore would hide a stray file", () => {
  const blanket = (s) => s.replace("canary/[0-9][0-9]-*.ts", "canary/**");
  assert.equal(lintStatus(blanket, true), 0);
});
