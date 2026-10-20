import { useState } from "react";
import { useApi } from "../api-context";
import { Async } from "../lib/Async";
import { loadWishlist, removeWishlistItem } from "../lib/queries/wishlist";
import { describeError, useLoad } from "../lib/use-load";

export function Wishlist() {
  const api = useApi();
  const { state, reload } = useLoad(() => loadWishlist(api), []);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const remove = (id: number) => {
    setRemoveError(null);
    removeWishlistItem(api, id).then(reload, (error: unknown) => {
      setRemoveError(describeError(error));
    });
  };

  return (
    <section>
      <h1>Wishlist</h1>
      {removeError !== null && <p role="alert">{removeError}</p>}
      <Async state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <p>Nothing on the wishlist</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.id}>
                  <span>{r.part.name}</span> <span>{r.note}</span>{" "}
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
