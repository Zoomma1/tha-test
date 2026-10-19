import type { Api } from "../api-client";
import { HttpError } from "../use-load";

export type PartKind = "blade" | "ratchet" | "bit";

export async function loadParts(api: Api, kind?: PartKind, search?: string) {
  const query = {
    ...(kind === undefined ? {} : { kind }),
    ...(search === undefined || search === "" ? {} : { search }),
  };
  const res = await api.api.parts.$get({ query });
  // Le type de hc ne documente que 200 et l'erreur de validation : un proxy peut aussi répondre 5xx.
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
}

// Renvoie null quand la pièce n'existe pas (404), pour que la page l'affiche sans passer par l'erreur générique.
export async function loadPart(api: Api, id: string) {
  const res = await api.api.parts[":id"].$get({ param: { id } });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
}
