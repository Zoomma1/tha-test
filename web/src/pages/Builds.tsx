import { useState, type SyntheticEvent } from "react";
import { useApi } from "../api-context";
import type { Api } from "../lib/api-client";
import { addBuildPart, BuildApiError, createBuild, loadBuilds, loadMissingByBuild } from "../lib/queries/builds";
import { addMissingToWishlist } from "../lib/queries/wishlist";
import { loadParts } from "../lib/queries/parts";
import { describeError, useLoad } from "../lib/use-load";

type PartOption = { id: number; name: string };

function errorMessage(error: unknown): string {
  return error instanceof BuildApiError ? error.message : describeError(error);
}

function BuildComposer({
  api,
  buildId,
  parts,
  onAdded,
}: {
  api: Api;
  buildId: number;
  parts: PartOption[];
  onAdded: () => void;
}) {
  const [partId, setPartId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const id = partId === "" ? parts[0]?.id : Number(partId);
    if (id === undefined) return;
    setError(null);
    setPending(true);
    addBuildPart(api, buildId, id).then(
      () => {
        setPending(false);
        onAdded();
      },
      (e: unknown) => {
        setPending(false);
        setError(errorMessage(e));
      },
    );
  };

  return (
    <form onSubmit={submit}>
      <label>
        Part
        <select
          value={partId}
          onChange={(e) => {
            setPartId(e.target.value);
          }}
        >
          {parts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>{" "}
      <button type="submit" disabled={pending}>
        Add
      </button>
      {error !== null && <p role="alert">{error}</p>}
    </form>
  );
}

function MissingParts({ api, buildId, missing }: { api: Api; buildId: number; missing: PartOption[] }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  if (missing.length === 0) return null;

  const add = () => {
    setError(null);
    setConfirmed(false);
    setPending(true);
    addMissingToWishlist(api, buildId).then(
      () => {
        setPending(false);
        setConfirmed(true);
      },
      (e: unknown) => {
        setPending(false);
        setError(errorMessage(e));
      },
    );
  };

  return (
    <div>
      <h3>Missing parts</h3>
      <ul>
        {missing.map((p) => (
          <li key={p.id}>{p.name}</li>
        ))}
      </ul>
      <button type="button" disabled={pending} onClick={add}>
        Add missing to wishlist
      </button>
      {confirmed && <p role="status">Missing parts added to the wishlist</p>}
      {error !== null && <p role="alert">{error}</p>}
    </div>
  );
}

export function Builds() {
  const api = useApi();
  const { state, reload } = useLoad(() => loadBuilds(api), []);
  const { state: partsState } = useLoad(() => loadParts(api), []);
  const { state: missingState } = useLoad(
    () => (state.status === "ready" ? loadMissingByBuild(api, state.data.map((b) => b.id)) : Promise.resolve(new Map<number, PartOption[]>())),
    [state],
  );
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setCreateError(null);
    setPending(true);
    createBuild(api, name).then(
      () => {
        setPending(false);
        setName("");
        reload();
      },
      (e: unknown) => {
        setPending(false);
        setCreateError(errorMessage(e));
      },
    );
  };

  const parts = partsState.status === "ready" ? partsState.data : [];
  const missingByBuild = missingState.status === "ready" ? missingState.data : new Map<number, PartOption[]>();

  // Un seul indicateur et une seule erreur de chargement ; l'erreur des builds prime sur celle des pièces.
  let notice = null;
  if (state.status === "error") notice = <p role="alert">{state.message}</p>;
  else if (partsState.status === "error") notice = <p role="alert">{partsState.message}</p>;
  else if (missingState.status === "error") notice = <p role="alert">{missingState.message}</p>;
  else if (state.status === "loading" || partsState.status === "loading") {
    notice = <p role="status">Loading...</p>;
  }

  return (
    <section>
      <h1>Builds</h1>
      <form onSubmit={submit}>
        <label>
          Name
          <input
            type="text"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>{" "}
        <button type="submit" disabled={pending}>
          Create
        </button>
      </form>
      {createError !== null && <p role="alert">{createError}</p>}
      {notice}
      {state.status === "ready" &&
        (state.data.length === 0 ? (
          <p>No build yet</p>
        ) : (
          <ul>
            {state.data.map((b) => (
              <li key={b.id}>
                <h2>{b.name}</h2>
                <ul>
                  {b.parts.length === 0 && <li>No part yet</li>}
                  {b.parts.map((p) => (
                    <li key={p.id}>{p.name}</li>
                  ))}
                </ul>
                <MissingParts api={api} buildId={b.id} missing={missingByBuild.get(b.id) ?? []} />
                <BuildComposer api={api} buildId={b.id} parts={parts} onAdded={reload} />
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
