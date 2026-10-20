import { useParams } from "react-router-dom";
import { useApi } from "../api-context";
import { Async } from "../lib/Async";
import { loadPart, type PartKind } from "../lib/queries/parts";
import { useLoad } from "../lib/use-load";

const KIND_LABELS: Record<PartKind, string> = { blade: "Lame", ratchet: "Ratchet", bit: "Bit" };

export function PartDetail() {
  const api = useApi();
  const { id = "" } = useParams();
  const { state } = useLoad(() => loadPart(api, id), [id]);

  return (
    <section>
      <h1 data-part-id={id}>Part detail</h1>
      <Async state={state}>
        {(part) =>
          part === null ? (
            <p>Part not found</p>
          ) : (
            <>
              <h2>{part.name}</h2>
              <p className="kind">{KIND_LABELS[part.kind]}</p>
              <p className="weight">{part.weightGrams === null ? "Weight unknown" : `${String(part.weightGrams)} g`}</p>
            </>
          )
        }
      </Async>
    </section>
  );
}
