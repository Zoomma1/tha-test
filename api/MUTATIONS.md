# Mutation checks

Each mutation was applied alone to `src/app.ts` or `src/routes/parts.ts` on a freshly reset database, the suite was run, then the file was restored. Every mutation turns at least one test red.

| Route | Mutation | Test that fails |
|---|---|---|
| GET /api/parts | remove the `kind` filter (`where: {}`) | `filters on kind=blade`, `kind=ratchet`, `kind=bit` |
| GET /api/parts | remove the `orderBy` (kind, then id) | `orders parts by kind, then by id` |
| GET /api/parts | rename the route to `/api/part` | `returns every seeded part` |
| composition | remove `.route("/api/parts", partsRoutes)` from `app.ts` | `returns every seeded part`, `filters on kind=*`, `orders parts by kind, then by id`, `npm run build then the start script's own command serves /api/parts` |
| GET /api/parts | accept any string as `kind` | `rejects an unknown kind with 400` |
| build/start | `start` points to `dist/src/server.js` | `npm run build then the start script's own command serves /api/parts` |
| test isolation | `pretest` without `DATABASE_URL=file:./test.db` (wipes `dev.db`, `test.db` never seeded) | `runs against the dedicated test.db`, `database file` tests and the route tests |
| build | `prebuild: prisma generate` removed, `src/generated` absent | `npm run build` fails with TS errors (manual check, not a vitest test) |
