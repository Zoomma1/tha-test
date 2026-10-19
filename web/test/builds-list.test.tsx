import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, renderApp, type Handler } from "./helpers";

// Forme supposée de GET /api/builds : chaque build porte ses pièces, chacune nommée sous `part`.
// Le build du seed (nom et pièces) est reproduit ici ; les pièces viennent du catalogue de helpers.ts.
interface BuildPart {
  id: number;
  part: { id: number; kind: "blade" | "ratchet" | "bit"; name: string };
}

interface Build {
  id: number;
  name: string;
  parts: BuildPart[];
}

const seedBuild: Build = {
  id: 1,
  name: "Starter build",
  parts: [
    { id: 1, part: { id: 1, kind: "blade", name: "Dran Sword" } },
    { id: 2, part: { id: 3, kind: "ratchet", name: "3-60" } },
    { id: 3, part: { id: 4, kind: "bit", name: "Flat" } },
  ],
};

// Imite GET /api/builds : la liste donnée, ou une erreur 500 si on le demande.
function buildsHandler(builds: Build[] = [seedBuild]): Handler {
  return ({ path }) => {
    if (path !== "/api/builds") return new Response("not found", { status: 404 });
    return Response.json(builds);
  };
}

describe("Builds", () => {
  it("shows Loading while the builds are requested", async () => {
    const { api } = fakeApi(buildsHandler());
    renderApp(api, "/builds");
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByText("Starter build")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("lists the seed build with the names of its parts", async () => {
    const { api } = fakeApi(buildsHandler());
    renderApp(api, "/builds");
    expect(await screen.findByText("Starter build")).toBeInTheDocument();
    for (const name of ["Dran Sword", "3-60", "Flat"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("requests the builds from the API", async () => {
    const { api, requests } = fakeApi(buildsHandler());
    renderApp(api, "/builds");
    await screen.findByText("Starter build");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "GET", path: "/api/builds" });
  });

  it("shows No build yet when there is no build", async () => {
    const { api } = fakeApi(buildsHandler([]));
    renderApp(api, "/builds");
    expect(await screen.findByText("No build yet")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows an error with the status on 500", async () => {
    const { api } = fakeApi(() => new Response("boom", { status: 500 }));
    renderApp(api, "/builds");
    expect(await screen.findByRole("alert")).toHaveTextContent("500");
  });

  it("shows an error when the server cannot be reached", async () => {
    const { api } = fakeApi(() => Promise.reject(new Error("offline")));
    renderApp(api, "/builds");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
