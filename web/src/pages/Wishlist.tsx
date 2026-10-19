import { useApi } from "../api-context";
import { Async } from "../lib/Async";
import { loadWishlist } from "../lib/queries/wishlist";
import { useLoad } from "../lib/use-load";

export function Wishlist() {
  const api = useApi();
  const { state } = useLoad(() => loadWishlist(api), []);

  return (
    <section>
      <h1>Wishlist</h1>
      <Async state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <p>Nothing on the wishlist</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.id}>
                  <span>{r.part.name}</span> <span>{r.note}</span>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </section>
  );
}
