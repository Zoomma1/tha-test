import { useState } from "react";
import { useParams } from "react-router-dom";
import { useApi } from "../api-context";
import { Async } from "../lib/Async";
import { loadPart, type PartKind } from "../lib/queries/parts";
import { addPartToWishlist } from "../lib/queries/wishlist";
import { describeError, useLoad } from "../lib/use-load";

const KIND_LABELS: Record<PartKind, string> = { blade: "Lame", ratchet: "Ratchet", bit: "Bit" };

export function PartDetail() {
  const api = useApi();
  const { id = "" } = useParams();
  const { state } = useLoad(() => loadPart(api, id), [id]);
  const [pending, setPending] = useState(false);
  const [wishlistError, setWishlistError] = useState<string | null>(null);

  const addToWishlist = (partId: number) => {
    setWishlistError(null);
    setPending(true);
    addPartToWishlist(api, partId).then(
      (message) => {
        setPending(false);
        setWishlistError(message);
      },
      (error: unknown) => {
        setPending(false);
        setWishlistError(describeError(error));
      },
    );
  };

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
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  addToWishlist(part.id);
                }}
              >
                Add to wishlist
              </button>
              {wishlistError !== null && <p role="alert">{wishlistError}</p>}
            </>
          )
        }
      </Async>
    </section>
  );
}
