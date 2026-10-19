import type { Api } from "../api-client";
import { HttpError } from "../use-load";

export async function loadOwnedParts(api: Api) {
  const res = await api.api["owned-parts"].$get();
  // Le type de hc ne documente que 200 : un proxy peut aussi répondre 5xx.
  const status: number = res.status;
  if (status !== 200) throw new HttpError(status);
  return res.json();
}

// Renvoie le message d'erreur de l'API (400, 404, 409), ou null quand l'ajout a réussi.
export async function addOwnedPart(api: Api, partId: number, quantity: number): Promise<string | null> {
  const res = await api.api["owned-parts"].$post({ json: { partId, quantity } });
  const status: number = res.status;
  if (status === 200 || status === 201) return null;
  if (status === 400 || status === 404 || status === 409) {
    const body: { error: string } = await res.json();
    return body.error;
  }
  throw new HttpError(status);
}
