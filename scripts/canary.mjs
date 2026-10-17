import { ESLint } from "eslint";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));

// One deliberately faulty file per way of dodging the type system, and the rule that must catch it.
export const EXPECTED = [
  { file: "canary/01-explicit-any.ts", rule: "@typescript-eslint/no-explicit-any" },
  { file: "canary/02-ts-ignore.ts", rule: "@typescript-eslint/ban-ts-comment" },
  { file: "canary/03-ts-expect-error.ts", rule: "@typescript-eslint/ban-ts-comment" },
  { file: "canary/04-eslint-disable.ts", rule: "@eslint-community/eslint-comments/no-use" },
  { file: "canary/05-as-unknown-as.ts", rule: "no-restricted-syntax", message: "as unknown as" },
  { file: "canary/06-zod-any.ts", rule: "no-restricted-syntax", message: "z.any()" },
  { file: "canary/07-untyped-response-json.ts", rule: "@typescript-eslint/no-unsafe-assignment" },
  { file: "canary/08-non-null-assertion.ts", rule: "@typescript-eslint/no-non-null-assertion" },
  { file: "canary/09-implicit-json-parse.ts", rule: "@typescript-eslint/no-unsafe-assignment" },
];

// Returns the canary files that were not caught; an empty list means every dodge is detected.
export async function runCanary({ root = defaultRoot, overrideConfig } = {}) {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: path.join(root, "eslint.config.mjs"),
    ...(overrideConfig && { overrideConfig }),
    ignore: false,
  });
  const present = EXPECTED.filter((e) => existsSync(path.join(root, e.file)));
  const results = present.length ? await eslint.lintFiles(present.map((e) => path.join(root, e.file))) : [];
  const byFile = new Map(results.map((r) => [path.relative(root, r.filePath), r.messages]));
  const failures = [];
  for (const e of EXPECTED) {
    if (!present.includes(e)) {
      failures.push({ file: e.file, rule: e.rule, reason: "file missing" });
      continue;
    }
    const messages = byFile.get(e.file) ?? [];
    const fatal = messages.find((m) => m.fatal);
    if (fatal) {
      failures.push({ file: e.file, rule: e.rule, reason: `fatal parse/type error: ${fatal.message}` });
      continue;
    }
    const caught = messages.some((m) => m.ruleId === e.rule && (e.message === undefined || m.message.includes(e.message)));
    if (!caught) failures.push({ file: e.file, rule: e.rule, reason: "not detected" });
  }
  return failures;
}

// realpath on both sides so a symlinked invocation still runs instead of exiting 0 silently.
const self = realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === self) {
  const failures = await runCanary();
  if (failures.length === 0) {
    console.log(`canary: all ${EXPECTED.length} evasions detected`);
  } else {
    for (const f of failures) console.error(`canary: ${f.file} ${f.reason} (expected ${f.rule})`);
    process.exit(1);
  }
}
