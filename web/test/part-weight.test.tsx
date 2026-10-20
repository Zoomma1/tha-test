import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, renderApp, type Handler } from "./helpers";

// Imite GET /api/parts/:id avec des pièces du seed (poids connus) et une pièce sans poids (null).
function weightHandler(): Handler {
  const detailParts = [
    { id: 1, kind: "blade", name: "Dran Sword", weightGrams: 30 },
    { id: 3, kind: "ratchet", name: "3-60", weightGrams: 8 },
    { id: 25, kind: "bit", name: "Unweighed Bit", weightGrams: null },
  ];
  return ({ path }) => {
    const match = /^\/api\/parts\/(\d+)$/.exec(path);
    if (match === null) return new Response("not found", { status: 404 });
    const part = detailParts.find((p) => String(p.id) === match[1]);
    if (part === undefined) return Response.json({ error: "part not found" }, { status: 404 });
    return Response.json(part);
  };
}

describe("PartDetail weight", () => {
  it("shows the weight in grams of a known seed part", async () => {
    const { api } = fakeApi(weightHandler());
    renderApp(api, "/parts/1");
    expect(await screen.findByText(/Dran Sword/)).toBeInTheDocument();
    expect(screen.getByText(/\b30\s*g\b/)).toBeInTheDocument();
    expect(screen.queryByText(/Weight unknown/)).not.toBeInTheDocument();
  });

  it("shows the weight of another seed part", async () => {
    const { api } = fakeApi(weightHandler());
    renderApp(api, "/parts/3");
    expect(await screen.findByText(/3-60/)).toBeInTheDocument();
    expect(screen.getByText(/\b8\s*g\b/)).toBeInTheDocument();
  });

  it("shows Weight unknown when the part has no weight", async () => {
    const { api } = fakeApi(weightHandler());
    renderApp(api, "/parts/25");
    expect(await screen.findByText(/Unweighed Bit/)).toBeInTheDocument();
    expect(screen.getByText(/Weight unknown/)).toBeInTheDocument();
  });
});
