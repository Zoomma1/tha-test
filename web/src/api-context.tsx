import { createContext, useContext, type ReactNode } from "react";
import { defaultApi, type Api } from "./lib/api-client";

const ApiContext = createContext<Api>(defaultApi);

export function ApiProvider({ api, children }: { api: Api; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): Api {
  return useContext(ApiContext);
}
