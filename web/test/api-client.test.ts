import { describe, expect, it } from "vitest";
import { createApi } from "../src/lib/api-client";
import { fakeApi, parts } from "./helpers";

describe("api-client", () => {
  it("reaches /api/parts through the typed client, with the kind filter", async () => {
    const { api, requests } = fakeApi(() => Response.json(parts));
    const all = await api.api.parts.$get({ query: {} });
    await api.api.parts.$get({ query: { kind: "bit" } });
    expect(requests.map((r) => `${r.method} ${r.path}${r.search}`)).toEqual(["GET /api/parts", "GET /api/parts?kind=bit"]);
    expect(await all.json()).toHaveLength(4);
  });

  it("sends same-origin /api requests for the default base", async () => {
    const seen: string[] = [];
    const api = createApi("/", (input) => {
      seen.push(typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url);
      return Promise.resolve(Response.json(parts));
    });
    await api.api.parts.$get({ query: {} });
    expect(seen).toEqual(["/api/parts"]);
  });
});
