# tha-test

A minimal Beyblade collection tracker in strict TypeScript, built as a **test subject** for an autonomous coding factory ([Tha-Factoria](https://github.com/Zoomma1/Tha-factoria)). It reuses the stack and the quality chain of the first test subject, `tha-cobaye` (a CV site), with a different domain. It is also an instrument: it measures how many pull requests it takes an agent to stop dodging the type system.

> **The data is sample data.** The part names (Beyblade X style) are illustrative, not an exhaustive or official catalogue.

## Scope today

Only the catalogue is read: `GET /api/parts` (optional `?kind=blade|ratchet|bit`) and one page listing the parts with a filter by type. The Prisma models `OwnedPart`, `Build`, `BuildPart` and `WishlistItem` exist and are seeded, but nothing reads or writes them yet: the factory's tasks deliver the rest.

## Layout

| Path | What it is |
|---|---|
| `web/` | Vite 8 + React 19 front: a nav, a route table and one page per resource (only the parts page is implemented). |
| `api/` | Hono API on Prisma 7 + SQLite (libsql adapter). `GET /api/parts` under `/api`, zod validation, a deterministic seed of 24 parts. |
| `canary/` | Nine deliberately faulty files, one per way of dodging the type system. Never linted as normal code. |
| `scripts/` | `check-pins`, `canary`, and the tests that guard the lint config and the CI workflow. |
| `.github/workflows/ci.yml` | The `ci` workflow. |

## One file per resource

Several agents work in parallel, one pull request per task, all from the same `main`. To keep two tasks from editing the same file, each resource owns its files and the shared entry points only compose them.

- API: `api/src/routes/{parts,owned-parts,builds,wishlist}.ts`, each exporting a Hono sub-app (`partsRoutes`, ...). `api/src/app.ts` only mounts them under `/api/<resource>`, so `AppType` and the typed `hc` client keep working.
- Web: `web/src/lib/queries/{parts,owned-parts,builds,wishlist}.ts` for the requests, `web/src/pages/*.tsx` for the pages. `web/src/App.tsx` holds the nav and the route table (react-router-dom, already a dependency).
- Empty resources are skeletons (no route, `export {};`, a title-only page) so a task fills in its own files instead of creating shared ones.
- `web/test/app.test.tsx` goes red if a nav link or a route in the table is broken.

Shared files (`api/prisma/**`, `api/src/db.ts`, `web/src/lib/api-client.ts`, `web/src/lib/use-load.ts`, `app.ts`, `App.tsx`, lint and CI config) are not touched by a resource task.

## Requirements

Node 24 and npm 11. Only `registry.npmjs.org` and `binaries.prisma.sh` (Prisma's migration engine) are needed on the network.

## Commands

```bash
npm ci               # exact install from the lockfile; also generates the Prisma client and the API type declarations
npm run typecheck    # tsc --noEmit in each workspace
npm run lint         # strictTypeChecked + the extra rules below
npm test             # script tests, then the API suite, then the web suite
npm run build
npm run canary       # fails unless the lint config catches all nine evasions
npm run check-pins   # fails on any non-exact dependency or override
npm run db:reset     # recreate api/dev.db from the migrations, then seed it
```

Run the app: `npm run dev -w api` (port 3000, `PORT` to change it), then `npm run dev -w web` (proxies `/api` to port 3000). `npm run db:reset` first, so the catalogue is not empty.

## Rules this repo enforces on purpose

- **Exact versions only.** No `^`, no `~`, no `latest`. `scripts/check-pins.mjs` also reads `overrides` and refuses glob workspaces.
- **Typed boundary.** The front reaches the API only through `web/src/lib/api-client.ts`, a `hc<AppType>` client whose `AppType` comes from the API (emitted as declarations, never copied). Any other use of `fetch` in `web/src` is a lint error.
- **No escape hatches.** ESLint `strictTypeChecked`, plus: every `eslint-disable` form is banned, `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` are banned even with a description, `as unknown as`, `z.any()` and `z.custom()` are banned, and unused disable directives are errors.
- **Tests run on a real SQLite file** (`api/test.db`), never `:memory:`, and never on `api/dev.db`.

## The canary

`npm run canary` lints each file in `canary/` and requires that **each one** triggers its expected rule. Removing a rule from the config makes it fail.

| File | Evasion | Rule that catches it |
|---|---|---|
| `01-explicit-any.ts` | explicit `any` | `@typescript-eslint/no-explicit-any` |
| `02-ts-ignore.ts` | `@ts-ignore` | `@typescript-eslint/ban-ts-comment` |
| `03-ts-expect-error.ts` | `@ts-expect-error` with a description | `@typescript-eslint/ban-ts-comment` |
| `04-eslint-disable.ts` | a useful `eslint-disable` | `@eslint-community/eslint-comments/no-use` |
| `05-as-unknown-as.ts` | `as unknown as T` | `no-restricted-syntax` |
| `06-zod-any.ts` | `z.any()` | `no-restricted-syntax` |
| `07-untyped-response-json.ts` | untyped `res.json()` | `@typescript-eslint/no-unsafe-assignment` |
| `08-non-null-assertion.ts` | `!` non-null assertion | `@typescript-eslint/no-non-null-assertion` |
| `09-implicit-json-parse.ts` | implicit `JSON.parse` | `@typescript-eslint/no-unsafe-assignment` |

## Continuous integration

The `ci` workflow runs on `pull_request` only: install, typecheck, lint, test, build, canary. Actions are pinned by commit SHA, the token is read-only, and credentials are not persisted. A test (`scripts/ci-workflow.test.mjs`) checks these invariants step by step.

## The canary

`npm run canary` lints each file in `canary/` and requires that **each one** triggers its expected rule. Removing a rule from the config makes it fail.

| File | Evasion | Rule that catches it |
|---|---|---|
| `01-explicit-any.ts` | explicit `any` | `@typescript-eslint/no-explicit-any` |
| `02-ts-ignore.ts` | `@ts-ignore` | `@typescript-eslint/ban-ts-comment` |
| `03-ts-expect-error.ts` | `@ts-expect-error` with a description | `@typescript-eslint/ban-ts-comment` |
| `04-eslint-disable.ts` | a useful `eslint-disable` | `@eslint-community/eslint-comments/no-use` |
| `05-as-unknown-as.ts` | `as unknown as T` | `no-restricted-syntax` |
| `06-zod-any.ts` | `z.any()` | `no-restricted-syntax` |
| `07-untyped-response-json.ts` | untyped `res.json()` | `@typescript-eslint/no-unsafe-assignment` |
| `08-non-null-assertion.ts` | `!` non-null assertion | `@typescript-eslint/no-non-null-assertion` |
| `09-implicit-json-parse.ts` | implicit `JSON.parse` | `@typescript-eslint/no-unsafe-assignment` |

## Continuous integration

The `ci` workflow runs on `pull_request` only: install, typecheck, lint, test, build, canary. Actions are pinned by commit SHA, the token is read-only, and credentials are not persisted. A test (`scripts/ci-workflow.test.mjs`) checks these invariants step by step.

## Mutation checks

Every behaviour of the API, the page and the lint config has a test that goes red when the behaviour is undone. The mutations that were applied, and the test that caught each one, are recorded in:

- [`api/MUTATIONS.md`](api/MUTATIONS.md): the route and the database.
- [`web/MUTATIONS.md`](web/MUTATIONS.md): the list page and the client.
- [`canary/MUTATIONS.md`](canary/MUTATIONS.md): each lint rule removed, and the workflow invariants.

## Known limits

- **No CI after a merge.** `ci` runs on pull requests only. It relies on the branch rules (a pull request and a green `ci` before any merge) so that `main` only receives checked code.
- **`res.json()` is an evasion only with the DOM types.** With Node types alone it returns `unknown`, so the canary file runs under the DOM `lib` (as in `web/`), not under `api/`.
- **The `fetch` rule is lexical.** It catches bare `fetch`, `window.fetch`, `globalThis.fetch` and `self.fetch`; it does not catch `const { fetch } = window`.
- **`z as zod` is not caught.** The `z.any()` selector matches the identifier `z`.
- **API type declarations can go stale.** They are rebuilt by `npm ci`, and before the web `typecheck`, `test` and `build`. A bare `npm run lint` right after an API change reads the old ones.
- **`npm audit` reports high advisories** in the dev-only Prisma CLI chain. They do not reach the running API.
- **One route, one page.** Writes, inventory, builds and the wishlist are skeletons only: no route, a title-only page.
