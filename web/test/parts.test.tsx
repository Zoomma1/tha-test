import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, partsHandler, renderApp } from "./helpers";

describe("Parts", () => {
  it("lists every part with its kind, after a loading state", async () => {
    const { api } = fakeApi(partsHandler());
    renderApp(api, "/");
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("Dran Sword");
    expect(items[0]).toHaveTextContent("Lame");
    expect(items[2]).toHaveTextContent("3-60");
    expect(items[2]).toHaveTextContent("Ratchet");
    expect(items[3]).toHaveTextContent("Bit");
  });

  it("asks the API for the chosen kind and shows only those parts", async () => {
    const { api, requests } = fakeApi(partsHandler());
    renderApp(api, "/");
    await screen.findAllByRole("listitem");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "blade");
    await screen.findByText("Dran Sword");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(requests.at(-1)?.search).toBe("?kind=blade");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "");
    expect(await screen.findAllByRole("listitem")).toHaveLength(4);
    expect(requests.at(-1)?.search).toBe("");
  });

  it("shows a generic error with the status on 500", async () => {
    const { api } = fakeApi(() => new Response("boom", { status: 500 }));
    renderApp(api, "/");
    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed with status 500");
  });

  it("shows an unreachable-server error when the request rejects", async () => {
    const { api } = fakeApi(() => Promise.reject(new Error("offline")));
    renderApp(api, "/");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });
});
