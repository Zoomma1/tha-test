import { useCallback, useEffect, useState } from "react";
import { useApi } from "../../api-context";
import type { Api } from "../api-client";

export type SessionUser = { id: number; handle: string; displayName: string };

// Tout statut autre que 200, comme toute erreur réseau, vaut « non connecté ».
export async function loadSession(api: Api): Promise<SessionUser | null> {
  try {
    const res = await api.api.auth.me.$get();
    const status: number = res.status;
    if (status !== 200) return null;
    const body = await res.json();
    if ("error" in body) return null;
    return { id: body.id, handle: body.handle, displayName: body.displayName };
  } catch {
    return null;
  }
}

// Les composants qui affichent la session sont prévenus d'une connexion réussie.
const sessionListeners = new Set<(user: SessionUser | null) => void>();

export async function logout(api: Api): Promise<void> {
  try {
    await api.api.auth.logout.$post();
  } catch {
    // Sans réponse du serveur, on repasse tout de même à « non connecté ».
  }
}

export function useSession(): { user: SessionUser | null; loading: boolean; logOut: () => void } {
  const api = useApi();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sessionListeners.add(setUser);
    return () => {
      sessionListeners.delete(setUser);
    };
  }, []);

  useEffect(() => {
    let current = true;
    void loadSession(api).then((u) => {
      if (current) {
        setUser(u);
        setLoading(false);
      }
    });
    return () => {
      current = false;
    };
  }, [api]);

  const logOut = useCallback(() => {
    void logout(api).then(() => {
      setUser(null);
    });
  }, [api]);

  return { user, loading, logOut };
}

export type LoginResult = "ok" | "invalid" | "rate-limited" | "failed";

export async function login(api: Api, handle: string, password: string): Promise<LoginResult> {
  try {
    const res = await api.api.auth.login.$post({ json: { handle, password } });
    const status: number = res.status;
    if (status === 200) {
      const user = await loadSession(api);
      sessionListeners.forEach((listener) => {
        listener(user);
      });
      return "ok";
    }
    if (status === 401) return "invalid";
    if (status === 429) return "rate-limited";
    return "failed";
  } catch {
    return "failed";
  }
}

export type RegisterResult = "ok" | "taken" | "failed";

export async function register(
  api: Api,
  input: { handle: string; password: string; displayName?: string },
): Promise<RegisterResult> {
  try {
    const res = await api.api.auth.register.$post({ json: input });
    const status: number = res.status;
    if (status === 201) {
      const user = await loadSession(api);
      sessionListeners.forEach((listener) => {
        listener(user);
      });
      return "ok";
    }
    if (status === 409) return "taken";
    return "failed";
  } catch {
    return "failed";
  }
}
