import { useState, type SyntheticEvent } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api-context";
import { Async } from "../lib/Async";
import { loadParts } from "../lib/queries/parts";
import { UnauthorizedError } from "../lib/queries/owned-parts";
import { addWishlistItem, loadWishlist, removeWishlistItem } from "../lib/queries/wishlist";
import { describeError, useLoad } from "../lib/use-load";

const PRIORITIES = [0, 1, 2, 3, 4, 5];

export function Wishlist() {
  const api = useApi();
  const [unauthorized, setUnauthorized] = useState(false);
  const { state, reload } = useLoad(
    () =>
      loadWishlist(api).catch((error: unknown) => {
        if (error instanceof UnauthorizedError) setUnauthorized(true);
        throw error;
      }),
    [],
  );
  const { state: partsState } = useLoad(() => loadParts(api), []);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [partId, setPartId] = useState("");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState("0");
  const [pending, setPending] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Une pièce déjà sur la liste n'est plus proposée à l'ajout.
  const listed = state.status === "ready" ? new Set(state.data.map((r) => r.partId)) : new Set<number>();
  const addable = partsState.status === "ready" ? partsState.data.filter((p) => !listed.has(p.id)) : [];

  const remove = (id: number) => {
    setRemoveError(null);
    removeWishlistItem(api, id).then(reload, (error: unknown) => {
      if (error instanceof UnauthorizedError) setUnauthorized(true);
      setRemoveError(describeError(error));
    });
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const id = partId === "" ? addable[0]?.id : Number(partId);
    if (id === undefined) return;
    setAddError(null);
    setPending(true);
    addWishlistItem(api, id, note, Number(priority)).then(
      () => {
        setPending(false);
        setNote("");
        reload();
      },
      (error: unknown) => {
        setPending(false);
        if (error instanceof UnauthorizedError) setUnauthorized(true);
        setAddError(describeError(error));
      },
    );
  };

  if (unauthorized) {
    return (
      <section>
        <h1>Wishlist</h1>
        <p>Please log in to see your wishlist.</p>
        <Link to="/login">Log in</Link>
      </section>
    );
  }

  return (
    <section>
      <h1>Wishlist</h1>
      <form onSubmit={submit}>
        <label>
          Part
          <select
            value={partId}
            onChange={(e) => {
              setPartId(e.target.value);
            }}
          >
            {addable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Note
          <input
            type="text"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </label>{" "}
        <label>
          Priority
          <select
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value);
            }}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>{" "}
        <button type="submit" disabled={pending}>
          Add
        </button>
      </form>
      {addError !== null && <p role="alert">{addError}</p>}
      {removeError !== null && <p role="alert">{removeError}</p>}
      <Async state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <p>Nothing on the wishlist</p>
          ) : (
            <ul>
              {[...rows]
                .sort((a, b) => b.priority - a.priority)
                .map((r) => (
                  <li key={r.id}>
                    <span>{r.part.name}</span> <span>{r.note}</span> <span>Priority {r.priority}</span>{" "}
                    <button
                      type="button"
                      onClick={() => {
                        remove(r.id);
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
            </ul>
          )
        }
      </Async>
    </section>
  );
}
