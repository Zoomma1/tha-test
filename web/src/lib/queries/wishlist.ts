import type { Api } from "../api-client";
import { HttpError } from "../use-load";

export async function loadWishlist(api: Api) {
  const res = await api.api.wishlist.$get();
  // Le type de hc ne documente que 200 : un proxy peut aussi répondre 5xx.
  const status: number = res.status;
  if (status !== 200) throw new HttpError(status);
  return res.json();
}

export async function removeWishlistItem(api: Api, id: number) {
  const res = await api.api.wishlist[":id"].$delete({ param: { id: String(id) } });
  const status: number = res.status;
  if (status !== 204 && status !== 200) throw new HttpError(status);
}

export async function addWishlistItem(api: Api, partId: number, note: string, priority: number) {
  const res = await api.api.wishlist.$post({ json: { partId, note, priority } });
  const status: number = res.status;
  if (status !== 200 && status !== 201) throw new HttpError(status);
}
