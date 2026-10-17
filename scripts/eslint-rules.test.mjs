import { test } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// Fixture files are virtual, so type information is off; the rules under test are all syntactic or comment-based.
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: `${root}eslint.config.mjs`,
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

async function rules(code, file = "web/src/feature.ts") {
  const [res] = await eslint.lintText(code, { filePath: `${root}${file}` });
  assert.ok(res);
  return res.messages.map((m) => m.ruleId);
}

const CLIENT = "web/src/lib/api-client.ts";

test("clean code has no findings", async () => {
  assert.deepEqual(await rules("export const x: number = 1;\n"), []);
});

const blocked = (ids) => ids.includes("no-restricted-syntax") || ids.includes("no-restricted-globals");

const WEB_FETCH = [
  ["bare call", "export const r = fetch('/static/a.json');\n"],
  ["/api literal", "export const r = fetch('/api/items');\n"],
  ["/api template", "const id = 1;\nexport const r = fetch(`/api/items/${id}`);\n"],
  ["variable URL", "const u = '/api/x';\nexport const r = fetch(u);\n"],
  ["window.fetch", "export const r = window.fetch('/x');\n"],
  ["globalThis.fetch", "export const r = globalThis.fetch('/x');\n"],
  ["self.fetch reference", "export const f = self.fetch;\n"],
  ["window['fetch']", "export const r = window['fetch']('/x');\n"],
  ["fetch(new URL)", "export const r = fetch(new URL('/x', 'http://a'));\n"],
  ["fetch reference", "export const f = fetch;\n"],
];

for (const [name, code] of WEB_FETCH) {
  test(`web/src rejects fetch: ${name}`, async () => {
    assert.ok(blocked(await rules(code)));
  });
  test(`api-client module allows fetch: ${name}`, async () => {
    assert.ok(!blocked(await rules(code, CLIENT)));
  });
}

test("fetch rule does not apply outside web/src", async () => {
  assert.ok(!blocked(await rules("export const r = fetch('https://x.test');\n", "api/src/x.ts")));
  assert.ok(!blocked(await rules("export const r = fetch('/static/a');\n", "scripts/x.ts")));
});

for (const url of ["/api", "/api/x", "/api?x=1"]) {
  test(`fetch('${url}') is rejected outside web/src too`, async () => {
    assert.ok(blocked(await rules(`export const r = fetch('${url}');\n`, "api/src/x.ts")));
    assert.ok(blocked(await rules(`const id = 1;\nexport const r = fetch(\`${url}\${id}\`);\n`, "api/src/x.ts")));
  });
}

for (const url of ["/apiary", "/api-docs"]) {
  test(`fetch('${url}') is not an /api call`, async () => {
    assert.ok(!blocked(await rules(`export const r = fetch('${url}');\n`, "api/src/x.ts")));
    assert.ok(!blocked(await rules(`const id = 1;\nexport const r = fetch(\`${url}\${id}\`);\n`, "api/src/x.ts")));
  });
}

test("`as unknown as` is rejected", async () => {
  assert.ok((await rules("export const x = 'a' as unknown as number;\n")).includes("no-restricted-syntax"));
});

test("`as unknown as` is rejected even in the client module", async () => {
  assert.ok((await rules("export const x = 'a' as unknown as number;\n", CLIENT)).includes("no-restricted-syntax"));
});

for (const call of ["z.any()", "z.custom()"]) {
  test(`${call} is rejected`, async () => {
    const code = `declare const z: { any(): unknown; custom(): unknown };\nexport const s = ${call};\n`;
    assert.ok((await rules(code)).includes("no-restricted-syntax"));
  });
}

test("eslint-disable directive is rejected by no-use", async () => {
  const code = "// eslint-disable-next-line no-console\nexport const x: number = 1;\n";
  assert.ok((await rules(code)).includes("@eslint-community/eslint-comments/no-use"));
});

test("unused disable directive is reported (reportUnusedDisableDirectives)", async () => {
  const code = "// eslint-disable-next-line no-console\nexport const x: number = 1;\n";
  const [res] = await eslint.lintText(code, { filePath: `${root}web/src/feature.ts` });
  assert.ok(res?.messages.some((m) => m.ruleId === null && /Unused eslint-disable/.test(m.message)));
});

for (const d of ["@ts-expect-error", "@ts-ignore", "@ts-nocheck", "@ts-check"]) {
  test(`${d} with a description is rejected`, async () => {
    const code = `// ${d} because reasons\nexport const x: number = 1;\n`;
    assert.ok((await rules(code)).includes("@typescript-eslint/ban-ts-comment"));
  });
}

const TSX_FILES = ["web/src/components/Foo.tsx", "web/src/pages/Admin.tsx"];
const TSX_FETCH = [
  ["bare call", "export const r = fetch('/static/a.json');\n"],
  ["/api literal", "export const r = fetch('/api/x');\n"],
  ["window.fetch", "export const r = window.fetch('/x');\n"],
];

for (const file of TSX_FILES) {
  for (const [name, code] of TSX_FETCH) {
    test(`${file} rejects fetch: ${name}`, async () => {
      assert.ok(blocked(await rules(code, file)));
    });
  }
}

test("only api-client.ts is exempt, not api-client.tsx", async () => {
  assert.ok(blocked(await rules("export const r = fetch('/x');\n", "web/src/lib/api-client.tsx")));
});

test("only the generated Prisma client is ignored, not the rest of api/src", async () => {
  assert.equal(await eslint.isPathIgnored(`${root}api/src/generated/client.ts`), true);
  assert.equal(await eslint.isPathIgnored(`${root}api/src/app.ts`), false);
});
