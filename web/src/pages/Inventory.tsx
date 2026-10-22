import { useState, type SyntheticEvent } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api-context";
import { Async } from "../lib/Async";
import { addOwnedPart, ApiError, deleteOwnedPart, loadOwnedParts, UnauthorizedError, updateOwnedPart } from "../lib/queries/owned-parts";
import { loadParts } from "../lib/queries/parts";
import { describeError, useLoad } from "../lib/use-load";

const KIND_LABELS = { blade: "Lame", ratchet: "Ratchet", bit: "Bit" };

export function Inventory() {
  const api = useApi();
  const [unauthorized, setUnauthorized] = useState(false);
  const { state, reload } = useLoad(
    () =>
      loadOwnedParts(api).catch((error: unknown) => {
        if (error instanceof UnauthorizedError) setUnauthorized(true);
        throw error;
      }),
    [],
  );
  const { state: partsState } = useLoad(() => loadParts(api), []);
  const [partId, setPartId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [pending, setPending] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const parts = partsState.status === "ready" ? partsState.data : [];
    const id = partId === "" ? parts[0]?.id : Number(partId);
    if (id === undefined) return;
    setAddError(null);
    setPending(true);
    addOwnedPart(api, id, Number(quantity)).then(
      () => {
        setPending(false);
        reload();
      },
      (error: unknown) => {
        setPending(false);
        if (error instanceof UnauthorizedError) setUnauthorized(true);
        setAddError(error instanceof ApiError ? error.message : describeError(error));
      },
    );
  };

  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const run = (action: Promise<void>) => {
    setAddError(null);
    action.then(
      () => {
        setDrafts({});
        reload();
      },
      (error: unknown) => {
        if (error instanceof UnauthorizedError) setUnauthorized(true);
        setAddError(error instanceof ApiError ? error.message : describeError(error));
      },
    );
  };

  if (unauthorized) {
    return (
      <section>
        <h1>Inventory</h1>
        <p>Please log in to see your inventory.</p>
        <Link to="/login">Log in</Link>
      </section>
    );
  }

  return (
    <section>
      <h1>Inventory</h1>
      <form onSubmit={submit}>
        <label>
          Part
          <select
            value={partId}
            onChange={(e) => {
              setPartId(e.target.value);
            }}
          >
            {partsState.status === "ready" &&
              partsState.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>{" "}
        <label>
          Quantity
          <input
            type="number"
            min={1}
            max={99}
            required
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value);
            }}
          />
        </label>{" "}
        <button type="submit" disabled={pending}>
          Add
        </button>
      </form>
      {addError !== null && <p role="alert">{addError}</p>}
      <Async state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <p>No part owned yet</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Quantity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.part.name}</td>
                    <td>{KIND_LABELS[r.part.kind]}</td>
                    <td>{r.quantity}</td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        aria-label={`Quantity of ${r.part.name}`}
                        value={drafts[r.id] ?? String(r.quantity)}
                        onChange={(e) => {
                          setDrafts({ ...drafts, [r.id]: e.target.value });
                        }}
                      />{" "}
                      <button
                        type="button"
                        onClick={() => {
                          run(updateOwnedPart(api, r.id, Number(drafts[r.id] ?? r.quantity)));
                        }}
                      >
                        Save {r.part.name}
                      </button>{" "}
                      <button
                        type="button"
                        onClick={() => {
                          run(deleteOwnedPart(api, r.id));
                        }}
                      >
                        Delete {r.part.name}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Async>
    </section>
  );
}
