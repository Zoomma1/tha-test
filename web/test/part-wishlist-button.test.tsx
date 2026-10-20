import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createApi, type FetchImpl } from "../src/lib/api-client";
import { renderApp } from "./helpers";

// Shark Edge n'est ni possédée ni sur la liste d'achats du seed : chaque test part d'une liste vide pour cette pièce.
const sharkEdge = { id: 5, kind: "blade", name: "Shark Edge", weightGrams: 31 } as const;

const addLabel = "Add to wishlist";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAddBody(value: unknown): value is { partId: number } {
  return isObject(value) && typeof value.partId === "number";
}

interface Faults {
  // Retient la réponse à POST /api/wishlist tant qu'il n'est pas résolu.
  addGate?: Promise<void>;
}

// Imite GET /api/parts/:id et POST /api/wishlist avec un état propre à chaque test.
// Un POST réussi ajoute la pièce à la liste (201) ; un second POST pour la même pièce répond 409 avec un message JSON.
function serverWith(faults: Faults = {}) {
  const listed = new Set<number>();
  const posts: { partId: number }[] = [];

  const handle = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === `/api/parts/${String(sharkEdge.id)}`) {
      return Response.json(sharkEdge);
    }

    if (req.method === "POST" && url.pathname === "/api/wishlist") {
      const body: unknown = JSON.parse(await req.text());
      if (!isAddBody(body)) return Response.json({ error: "invalid body" }, { status: 400 });
      posts.push({ partId: body.partId });
      if (faults.addGate !== undefined) await faults.addGate;
      if (listed.has(body.partId)) {
        return Response.json({ error: "already on the wishlist" }, { status: 409 });
      }
      listed.add(body.partId);
      return Response.json({ id: listed.size, partId: body.partId, note: "", priority: 0 }, { status: 201 });
    }

    return new Response("not found", { status: 404 });
  };

  const fetchImpl: FetchImpl = (input, init) => handle(new Request(input, init));
  return { api: createApi("http://localhost", fetchImpl), posts };
}

describe("PartDetail wishlist button", () => {
  it("shows an Add to wishlist button on the part page", async () => {
    const { api } = serverWith();
    renderApp(api, `/parts/${String(sharkEdge.id)}`);

    expect(await screen.findByRole("button", { name: addLabel })).toBeEnabled();
  });

  it("a click adds the part to the wishlist: POST /api/wishlist with the part id", async () => {
    const { api, posts } = serverWith();
    renderApp(api, `/parts/${String(sharkEdge.id)}`);

    await userEvent.click(await screen.findByRole("button", { name: addLabel }));

    await waitFor(() => {
      expect(posts).toEqual([{ partId: sharkEdge.id }]);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a second click shows the already on the wishlist error", async () => {
    const { api, posts } = serverWith();
    renderApp(api, `/parts/${String(sharkEdge.id)}`);
    const button = await screen.findByRole("button", { name: addLabel });

    await userEvent.click(button);
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    await waitFor(() => {
      expect(button).toBeEnabled();
    });

    await userEvent.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent("already on the wishlist");
    expect(posts).toHaveLength(2);
  });

  it("the button is disabled while the request is being sent", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    const { api, posts } = serverWith({ addGate: gate });
    renderApp(api, `/parts/${String(sharkEdge.id)}`);
    const button = await screen.findByRole("button", { name: addLabel });

    await userEvent.click(button);

    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(button).toBeDisabled();

    release();

    await waitFor(() => {
      expect(button).toBeEnabled();
    });
  });
});
