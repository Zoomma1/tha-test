import type { Api } from "../api-client";
import { HttpError } from "../use-load";

export async function loadWishlist(api: Api) {
  const res = await api.api.wishlist.$get();
  // Le type de hc ne documente que 200 : un proxy peut aussi répondre 5xx.
  const status: number = res.status;
  if (status !== 200) throw new HttpError(status);
  return res.json();
}
