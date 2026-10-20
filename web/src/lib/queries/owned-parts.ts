import type { Api } from "../api-client";
import { HttpError } from "../use-load";

export async function loadOwnedParts(api: Api) {
  const res = await api.api["owned-parts"].$get();
  // Le type de hc ne documente que 200 : un proxy peut aussi répondre 5xx.
  const status: number = res.status;
  if (status !== 200) throw new HttpError(status);
  return res.json();
}

export class ApiError extends Error {}

// Lève ApiError avec le message de l'API (ex. 409 `quantity limit`), HttpError pour tout autre échec.
export async function addOwnedPart(api: Api, partId: number, quantity: number) {
  const res = await api.api["owned-parts"].$post({ json: { partId, quantity } });
  const status: number = res.status;
  if (status === 200 || status === 201) return;
  const body: unknown = await res.json().catch(() => null);
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
    throw new ApiError(body.error);
  }
  throw new HttpError(status);
}
