import { useCallback, useEffect, useState } from "react";

// Volontairement générique : seul le statut HTTP est affiché.
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`Request failed with status ${String(status)}`);
  }
}

export type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export function describeError(error: unknown): string {
  return error instanceof HttpError ? error.message : "Could not reach the server";
}

export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[] = []): { state: LoadState<T>; reload: () => void } {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const [round, setRound] = useState(0);
  const reload = useCallback(() => {
    setRound((r) => r + 1);
  }, []);

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    load().then(
      (data) => {
        if (current) setState({ status: "ready", data });
      },
      (error: unknown) => {
        if (current) setState({ status: "error", message: describeError(error) });
      },
    );
    return () => {
      current = false;
    };
    // `load` est recréé à chaque rendu : seuls le montage, reload et deps déclenchent un refetch.
  }, [round, ...deps]);

  return { state, reload };
}
