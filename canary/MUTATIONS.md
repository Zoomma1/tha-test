# Canary and CI mutations

Canary mutations are applied in memory (`overrideConfig`) by `scripts/canary.test.mjs`; `eslint.config.mjs` is never edited.

| Rule removed | Canary file(s) that fail |
| --- | --- |
| `@typescript-eslint/no-explicit-any` | `01-explicit-any.ts` |
| `@typescript-eslint/ban-ts-comment` | `02-ts-ignore.ts`, `03-ts-expect-error.ts` |
| `@eslint-community/eslint-comments/no-use` | `04-eslint-disable.ts` |
| `no-restricted-syntax`, `as unknown as` selector | `05-as-unknown-as.ts` |
| `no-restricted-syntax`, `z.any()` selector | `06-zod-any.ts` |
| `@typescript-eslint/no-unsafe-assignment` | `07-untyped-response-json.ts`, `09-implicit-json-parse.ts` |
| `@typescript-eslint/no-non-null-assertion` | `08-non-null-assertion.ts` |
| canary file deleted | that file is reported "file missing" |
| old entry guard (`argv[1] === import.meta.url`, no realpath) | symlink test: script exits 0 silently instead of 1 |

| fatal parse error reported as plain "not detected" | `scripts/canary.test.mjs` "does not compile is reported as fatal" |
| ignore `canary/**` instead of `canary/[0-9][0-9]-*.ts` | `scripts/canary.test.mjs` "mutation: a blanket canary/** ignore would hide a stray file" (asserts the stray goes unseen) and "still lints a stray file" |

Workflow mutations (`scripts/ci-workflow.test.mjs`), each turns the listed check red:

| Mutation | Check that fails |
| --- | --- |
| rename workflow / job, add a second job | named ci / single job named ci |
| add `push` or `workflow_dispatch` trigger | pull_request only |
| `pull_request_target` | no pull_request_target, pull_request only |
| `contents: write`, extra permission, no permissions | permissions are contents: read |
| other runner, no timeout, no concurrency cancel | ubuntu-latest, timeout, cancel obsolete runs |
| name-first step with `run: curl ... \| sh`, 7th command, reversed order, drop canary | exactly the six commands in order |
| name-first step with `uses: actions/foo@v1` | every uses is pinned |
| `${{ }}` in a multi-line `run: \|` or in a step `env:` | no `${{` in any run, only `${{` in concurrency.group |
| `push:`, `schedule:`, `workflow_dispatch:`, `pull_request_target:` under `on:` | pull_request only |
| `branches:`/`types:` under `pull_request:`, blank lines | none (tolerance test) |
| drop `persist-credentials: false` on checkout (or set true) | checkout does not persist credentials |
| action by tag, short SHA, missing tag comment | pinned by 40-hex SHA, reviewed SHAs |
| `${{ }}` or secret in a `run:` | no github context or secrets in run |
| wrong Node version, no npm cache | node 24 with npm cache |
| swap lint/test order, drop canary | six commands in order |
