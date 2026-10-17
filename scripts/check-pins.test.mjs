import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-pins.mjs", import.meta.url));

function run(rootDeps, apiDeps = {}) {
  const root = mkdtempSync(join(tmpdir(), "pins-"));
  mkdirSync(join(root, "api"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["api"], devDependencies: rootDeps }));
  writeFileSync(join(root, "api", "package.json"), JSON.stringify({ dependencies: apiDeps }));
  const res = spawnSync("node", [script, root], { encoding: "utf8" });
  rmSync(root, { recursive: true });
  return res;
}

test("passes on exact versions", () => {
  assert.equal(run({ a: "1.2.3" }, { b: "4.5.6" }).status, 0);
});

test("fails on a caret added to a workspace dependency, naming package and range", () => {
  const res = run({ a: "1.2.3" }, { b: "^4.5.6" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /b/);
  assert.match(res.stderr, /\^4\.5\.6/);
});

for (const range of ["^1.0.0", "~1.0.0", "latest", "*", ">=1.0.0", "1.x", "next", "1.0"]) {
  test(`fails on non-exact range ${range}`, () => {
    assert.equal(run({ a: range }).status, 1);
  });
}

// Exact means exact: a prerelease pin is accepted here; banning prereleases is a choice of the pins, not of this script.
test("accepts an exact prerelease version", () => {
  assert.equal(run({ a: "1.0.0-beta.2" }).status, 0);
});

test("ignores peerDependencies", () => {
  const root = mkdtempSync(join(tmpdir(), "pins-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ peerDependencies: { a: "^1.0.0" } }));
  const res = spawnSync("node", [script, root], { encoding: "utf8" });
  rmSync(root, { recursive: true });
  assert.equal(res.status, 0);
});

function runRoot(rootPkg, extra = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "pins-"));
  writeFileSync(join(root, "package.json"), JSON.stringify(rootPkg));
  extra(root);
  const res = spawnSync("node", [script, root], { encoding: "utf8" });
  rmSync(root, { recursive: true });
  return res;
}

test("fails when run through a symlink to a script and the tree has a caret", () => {
  const root = mkdtempSync(join(tmpdir(), "pins-"));
  const link = join(root, "link.mjs");
  symlinkSync(script, link);
  writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies: { a: "^1.0.0" } }));
  const res = spawnSync("node", [link, root], { encoding: "utf8" });
  rmSync(root, { recursive: true });
  assert.equal(res.status, 1);
});

for (const entry of ["packages/*", "api?", "{api,web}", "a[bc]"]) {
  test(`fails on glob workspace entry ${entry}`, () => {
    const res = runRoot({ workspaces: [entry] });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /glob/);
  });
}

test("fails on object-form workspaces", () => {
  const res = runRoot({ workspaces: { packages: ["api"] } });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /object form/);
});

test("fails on a caret in flat overrides", () => {
  const res = runRoot({ overrides: { foo: "^1.0.0" } });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /overrides\.foo/);
});

test("fails on a caret in nested overrides, including the '.' key", () => {
  assert.equal(runRoot({ overrides: { foo: { bar: "~2.0.0" } } }).status, 1);
  assert.equal(runRoot({ overrides: { foo: { ".": "^1.0.0" } } }).status, 1);
});

test("passes on exact overrides, flat and nested", () => {
  assert.equal(runRoot({ overrides: { foo: "1.0.0", bar: { ".": "2.0.0", baz: "3.0.0" } } }).status, 0);
});
