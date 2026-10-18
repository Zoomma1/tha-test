import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, parts, renderApp, type Handler } from "./helpers";

// Imite GET /api/parts/:id : la pièce si elle existe, sinon 404 avec une erreur JSON.
function detailHandler(): Handler {
  return ({ path }) => {
    const match = /^\/api\/parts\/(\d+)$/.exec(path);
    if (match === null) return new Response("not found", { status: 404 });
    const part = parts.find((p) => String(p.id) === match[1]);
    if (part === undefined) return Response.json({ error: "part not found" }, { status: 404 });
    return Response.json(part);
  };
}

describe("PartDetail", () => {
  it("shows Loading, then the name and the kind of the part", async () => {
    const { api } = fakeApi(detailHandler());
    renderApp(api, "/parts/1");
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
    expect(await screen.findByText(/Dran Sword/)).toBeInTheDocument();
    expect(screen.getByText(/\bLame\b/)).toBeInTheDocument();
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });

  it("shows the kind of a ratchet part", async () => {
    const { api } = fakeApi(detailHandler());
    renderApp(api, "/parts/3");
    expect(await screen.findByText(/3-60/)).toBeInTheDocument();
    expect(screen.getByText(/\bRatchet\b/)).toBeInTheDocument();
  });

  it("requests the part by id through the typed client", async () => {
    const { api, requests } = fakeApi(detailHandler());
    renderApp(api, "/parts/1");
    await screen.findByText(/Dran Sword/);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "GET", path: "/api/parts/1" });
  });

  it("shows Part not found when the API answers 404", async () => {
    const { api } = fakeApi(detailHandler());
    renderApp(api, "/parts/999");
    expect(await screen.findByText(/Part not found/)).toBeInTheDocument();
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });

  it("shows the generic error with the status on 500", async () => {
    const { api } = fakeApi(() => new Response("boom", { status: 500 }));
    renderApp(api, "/parts/1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed with status 500");
  });

  it("shows an unreachable-server error when the request rejects", async () => {
    const { api } = fakeApi(() => Promise.reject(new Error("offline")));
    renderApp(api, "/parts/1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });
});
