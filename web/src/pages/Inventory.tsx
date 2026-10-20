import { useState, type SyntheticEvent } from "react";
import { useApi } from "../api-context";
import { Async } from "../lib/Async";
import { addOwnedPart, ApiError, loadOwnedParts } from "../lib/queries/owned-parts";
import { loadParts } from "../lib/queries/parts";
import { describeError, useLoad } from "../lib/use-load";

const KIND_LABELS = { blade: "Lame", ratchet: "Ratchet", bit: "Bit" };

export function Inventory() {
  const api = useApi();
  const { state, reload } = useLoad(() => loadOwnedParts(api), []);
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
        setAddError(error instanceof ApiError ? error.message : describeError(error));
      },
    );
  };

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
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.part.name}</td>
                    <td>{KIND_LABELS[r.part.kind]}</td>
                    <td>{r.quantity}</td>
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
