import type { Api } from "../api-client";
import { HttpError } from "../use-load";
import { UnauthorizedError } from "./owned-parts";

export async function loadWishlist(api: Api) {
  const res = await api.api.wishlist.$get();
  // Le type de hc ne documente que 200 : un proxy peut aussi répondre 5xx.
  const status: number = res.status;
  if (status === 401) throw new UnauthorizedError();
  if (status !== 200) throw new HttpError(status);
  return res.json();
}

export async function removeWishlistItem(api: Api, id: number) {
  const res = await api.api.wishlist[":id"].$delete({ param: { id: String(id) } });
  const status: number = res.status;
  if (status === 401) throw new UnauthorizedError();
  if (status !== 204 && status !== 200) throw new HttpError(status);
}

export async function addWishlistItem(api: Api, partId: number, note: string, priority: number) {
  const res = await api.api.wishlist.$post({ json: { partId, note, priority } });
  const status: number = res.status;
  if (status === 401) throw new UnauthorizedError();
  if (status !== 200 && status !== 201) throw new HttpError(status);
}

// Renvoie le message d'erreur de l'API (corps JSON { error }) ou null si l'ajout a réussi.
export async function addPartToWishlist(api: Api, partId: number): Promise<string | null> {
  const res = await api.api.wishlist.$post({ json: { partId, note: "", priority: 0 } });
  const status: number = res.status;
  if (status === 200 || status === 201) return null;
  const body: unknown = await res.json().catch(() => null);
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  throw new HttpError(status);
}

// Renvoie le message d'erreur de l'API (corps JSON { error }) ou null si les pièces manquantes ont été ajoutées.
export async function addMissingToWishlist(api: Api, buildId: number): Promise<string | null> {
  const res = await api.api.wishlist["from-build"][":buildId"].$post({ param: { buildId: String(buildId) } });
  const status: number = res.status;
  if (status === 200 || status === 201) return null;
  const body: unknown = await res.json().catch(() => null);
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  throw new HttpError(status);
}
