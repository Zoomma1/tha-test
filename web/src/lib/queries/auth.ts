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
