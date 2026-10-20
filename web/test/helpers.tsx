import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { InferResponseType } from "hono/client";
import { ApiProvider } from "../src/api-context";
import { App } from "../src/App";
import { createApi, type Api, type FetchImpl } from "../src/lib/api-client";

export type Part = InferResponseType<Api["api"]["parts"]["$get"], 200>[number];

export const parts: Part[] = [
  { id: 1, kind: "blade", name: "Dran Sword", weightGrams: 30 },
  { id: 2, kind: "blade", name: "Hells Scythe", weightGrams: 33 },
  { id: 3, kind: "ratchet", name: "3-60", weightGrams: 8 },
  { id: 4, kind: "bit", name: "Flat", weightGrams: 2 },
];

export interface RecordedRequest {
  method: string;
  path: string;
  search: string;
}

export type Handler = (req: RecordedRequest) => Response | Promise<Response>;

export function fakeApi(handler: Handler): { api: Api; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchImpl = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const recorded: RecordedRequest = { method: req.method, path: url.pathname, search: url.search };
    requests.push(recorded);
    return handler(recorded);
  };
  return { api: createApi("http://localhost", fetchImpl), requests };
}

// Imite le filtre serveur pour que la page soit testée sur ce qu'elle demande réellement.
export function partsHandler(): Handler {
  return ({ path, search }) => {
    if (path !== "/api/parts") return new Response("not found", { status: 404 });
    const kind = new URLSearchParams(search).get("kind");
    return Response.json(kind === null ? parts : parts.filter((p) => p.kind === kind));
  };
}

export function renderApp(api: Api, route: string) {
  return render(
    <ApiProvider api={api}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </ApiProvider>,
  );
}
