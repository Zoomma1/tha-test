import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api-context";
import { Async } from "../lib/Async";
import { loadParts, type PartKind } from "../lib/queries/parts";
import { useLoad } from "../lib/use-load";

const KIND_LABELS: Record<PartKind, string> = {
  blade: "Lame",
  ratchet: "Ratchet",
  bit: "Bit",
};
const KINDS: readonly PartKind[] = ["blade", "ratchet", "bit"];

export function Parts() {
  const api = useApi();
  const [kind, setKind] = useState<PartKind | undefined>(undefined);
  const [search, setSearch] = useState("");
  const { state } = useLoad(() => loadParts(api, kind, search), [kind, search]);

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
      <label>
        Search
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
      </label>
      <Async state={state}>
        {(parts) =>
          parts.length === 0 ? (
            <p>No part found</p>
          ) : (
            <ul className="cards">
              {parts.map((p) => (
                <li key={p.id}>
                  <Link to={`/parts/${String(p.id)}`}>{p.name}</Link>{" "}
                  <span className="kind">{KIND_LABELS[p.kind]}</span>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </section>
  );
}
