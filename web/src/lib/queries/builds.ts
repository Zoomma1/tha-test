import type { Api } from "../api-client";
import { HttpError } from "../use-load";

export async function loadBuilds(api: Api) {
  const res = await api.api.builds.$get();
  // Le type de hc ne documente que 200 : un proxy peut aussi répondre 5xx.
  const status: number = res.status;
  if (status !== 200) throw new HttpError(status);
  return res.json();
}

export class BuildApiError extends Error {}

// Lève BuildApiError avec le message de l'API (ex. 409 `slot taken`), HttpError pour tout autre échec.
export async function failWith(res: Response): Promise<never> {
  const body: unknown = await res.json().catch(() => null);
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
    throw new BuildApiError(body.error);
  }
  throw new HttpError(res.status);
}

export async function createBuild(api: Api, name: string) {
  const res = await api.api.builds.$post({ json: { name } });
  const status: number = res.status;
  if (status === 200 || status === 201) return;
  return failWith(res);
}

export async function addBuildPart(api: Api, buildId: number, partId: number) {
  const res = await api.api.builds[":id"].parts.$post(
    { param: { id: String(buildId) } },
    { init: { body: JSON.stringify({ partId }), headers: { "content-type": "application/json" } } },
  );
  const status: number = res.status;
  if (status === 200 || status === 201) return;
  return failWith(res);
}

export async function loadBuildMissing(api: Api, buildId: number) {
  const res = await api.api.builds[":id"].missing.$get({ param: { id: String(buildId) } });
  if (res.status !== 200) return failWith(res);
  return res.json();
}

// Les pièces manquantes de chaque build, indexées par id de build.
export async function loadMissingByBuild(api: Api, buildIds: number[]) {
  const lists = await Promise.all(buildIds.map((id) => loadBuildMissing(api, id)));
  return new Map(buildIds.map((id, i) => [id, lists[i] ?? []]));
}
