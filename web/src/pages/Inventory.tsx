import { useApi } from "../api-context";
import { Async } from "../lib/Async";
import { loadOwnedParts } from "../lib/queries/owned-parts";
import { useLoad } from "../lib/use-load";

const KIND_LABELS = { blade: "Lame", ratchet: "Ratchet", bit: "Bit" };

export function Inventory() {
  const api = useApi();
  const { state } = useLoad(() => loadOwnedParts(api), []);

  return (
    <section>
      <h1>Inventory</h1>
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
