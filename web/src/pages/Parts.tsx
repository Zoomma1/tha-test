import { useState } from "react";
import { useApi } from "../api-context";
import { Async } from "../lib/Async";
import { loadParts, type PartKind } from "../lib/queries/parts";
import { useLoad } from "../lib/use-load";

const KIND_LABELS: Record<PartKind, string> = { blade: "Lame", ratchet: "Ratchet", bit: "Bit" };
const KINDS: readonly PartKind[] = ["blade", "ratchet", "bit"];

export function Parts() {
  const api = useApi();
  const [kind, setKind] = useState<PartKind | undefined>(undefined);
  const { state } = useLoad(() => loadParts(api, kind), [kind]);

  return (
    <section>
      <h1>Pièces</h1>
      <label>
        Type
        <select
          value={kind ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            setKind(KINDS.find((k) => k === value));
          }}
        >
          <option value="">Tous</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <Async state={state}>
        {(parts) => (
          <ul className="cards">
            {parts.map((p) => (
              <li key={p.id}>
                {p.name} <span className="kind">{KIND_LABELS[p.kind]}</span>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </section>
  );
}
