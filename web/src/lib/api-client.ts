import { hc } from "hono/client";
import type { AppType } from "@tha-test/api/app-type";

export type FetchImpl = typeof fetch;

// The only module allowed to touch fetch: tests inject a fake instead of stubbing a global.
export function createApi(baseUrl: string, fetchImpl?: FetchImpl) {
  return hc<AppType>(baseUrl, fetchImpl === undefined ? {} : { fetch: fetchImpl });
}

export type Api = ReturnType<typeof createApi>;

export const defaultApi: Api = createApi("/");
