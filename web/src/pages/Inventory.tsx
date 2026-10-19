import { useState, type FormEvent } from "react";
import { useApi } from "../api-context";
import { Async } from "../lib/Async";
import { addOwnedPart, loadOwnedParts } from "../lib/queries/owned-parts";
import { loadParts } from "../lib/queries/parts";
import { describeError, useLoad } from "../lib/use-load";

const KIND_LABELS = { blade: "Lame", ratchet: "Ratchet", bit: "Bit" };

export function Inventory() {
  const api = useApi();
  const { state, reload } = useLoad(() => loadOwnedParts(api), []);
  const { state: partsState } = useLoad(() => loadParts(api), []);
  const [partId, setPartId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const id = partId === "" && partsState.status === "ready" ? partsState.data[0]?.id : Number(partId);
    if (id === undefined) return;
    setSending(true);
    setError(null);
    try {
      const message = await addOwnedPart(api, id, Number(quantity));
      if (message === null) reload();
      else setError(message);
    } catch (e: unknown) {
      setError(describeError(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <section>
      <h1>Inventory</h1>
      <form onSubmit={(e) => void submit(e)}>
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
        </label>
        <label>
          Quantity
          <input
            type="number"
            min={1}
            max={99}
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value);
            }}
          />
        </label>
        <button type="submit" disabled={sending}>
          Add
        </button>
        {error !== null && <p role="alert">{error}</p>}
      </form>
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
