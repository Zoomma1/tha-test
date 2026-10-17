# Mutation checks

Each mutation was applied alone to one file in `src/`, the web suite was run, then the file was restored. Every mutation turns at least one test red.

| Target | Mutation | Test that fails |
|---|---|---|
| Parts | do not render the part name | `Parts lists every part with its kind, after a loading state`, `Parts asks the API for the chosen kind ...` |
| Parts | do not render the kind label | `Parts lists every part with its kind, after a loading state` |
| Parts | ignore the selected kind (never sent to the API) | `Parts asks the API for the chosen kind and shows only those parts` |
| Parts | no loading state | `Parts lists every part with its kind, after a loading state` |
| queries/parts | HTTP errors ignored | `Parts shows a generic error with the status on 500` |
| use-load | network failure not reported as "Could not reach the server" | `Parts shows an unreachable-server error when the request rejects` |
| api-client | ignore the injected `fetch` | every page test (falls back to the real network) |
| api-client | prefix every path with `/v2` | `api-client sends same-origin /api requests for the default base` |
| App | rename the `/parts/:id` route to `/part/:id` | `App routes passes the id of /parts/:id to the detail page` |
| App | point the Builds nav link to `/buildz` | `App routes the Builds link shows its page` |
