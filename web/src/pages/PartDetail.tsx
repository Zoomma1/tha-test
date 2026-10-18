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
      <Async state={state}>
        {(part) =>
          part === null ? (
            <p>Part not found</p>
          ) : (
            <>
              <h1>{part.name}</h1>
              <p className="kind">{KIND_LABELS[part.kind]}</p>
            </>
          )
        }
      </Async>
    </section>
  );
}
