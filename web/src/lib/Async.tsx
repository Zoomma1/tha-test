import type { ReactNode } from "react";
import type { LoadState } from "./use-load";

export function Async<T>({ state, children }: { state: LoadState<T>; children: (data: T) => ReactNode }) {
  if (state.status === "loading") return <p role="status">Loading...</p>;
  if (state.status === "error") return <p role="alert">{state.message}</p>;
  return <>{children(state.data)}</>;
}
