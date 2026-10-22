import { useState, type SyntheticEvent } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api-context";
import type { Api } from "../lib/api-client";
import { addBuildPart, BuildApiError, createBuild, loadBuildMissing, loadBuilds, UnauthorizedError } from "../lib/queries/builds";
import { loadParts } from "../lib/queries/parts";
import { addMissingToWishlist } from "../lib/queries/wishlist";
import { describeError, useLoad } from "../lib/use-load";

type PartOption = { id: number; name: string };

const LOGIN_MESSAGE = "Please log in to see your builds.";

function errorMessage(error: unknown): string {
  if (error instanceof UnauthorizedError) return LOGIN_MESSAGE;
  return error instanceof BuildApiError ? error.message : describeError(error);
}

function Alert({ message }: { message: string }) {
  if (message !== LOGIN_MESSAGE) return <p role="alert">{message}</p>;
  return (
    <p role="alert">
      {message} <Link to="/login">Log in</Link>
    </p>
  );
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
      {error !== null && <Alert message={error} />}
    </form>
  );
}

function BuildMissing({ api, buildId }: { api: Api; buildId: number }) {
  const { state } = useLoad(() => loadBuildMissing(api, buildId), [buildId]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const add = () => {
    setError(null);
    setConfirmed(false);
    setPending(true);
    addMissingToWishlist(api, buildId).then(
      (message) => {
        setPending(false);
        if (message === null) setConfirmed(true);
        else setError(message);
      },
      (e: unknown) => {
        setPending(false);
        setError(errorMessage(e));
      },
    );
  };

  if (state.status === "error") return <p role="alert">{state.message}</p>;
  if (state.status !== "ready") return null;

  return (
    <>
      {state.data.length > 0 && (
        <>
          <p>Missing:</p>
          <ul>
            {state.data.map((p) => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
          <button type="button" disabled={pending} onClick={add}>
            Add missing to wishlist
          </button>
        </>
      )}
      {confirmed && <p role="status">Missing parts added to the wishlist</p>}
      {error !== null && <Alert message={error} />}
    </>
  );
}

export function Builds() {
  const api = useApi();
  const [unauthorized, setUnauthorized] = useState(false);
  const { state, reload } = useLoad(
    () =>
      loadBuilds(api).then(
        (data) => {
          setUnauthorized(false);
          return data;
        },
        (e: unknown) => {
          setUnauthorized(e instanceof UnauthorizedError);
          throw e;
        },
      ),
    [],
  );
  const { state: partsState } = useLoad(() => loadParts(api), []);
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

  // Un seul indicateur et une seule erreur de chargement ; l'erreur des builds prime sur celle des pièces.
  let notice = null;
  if (state.status === "error") notice = <Alert message={unauthorized ? LOGIN_MESSAGE : state.message} />;
  else if (partsState.status === "error") notice = <Alert message={partsState.message} />;
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
      {createError !== null && <Alert message={createError} />}
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
                <BuildMissing api={api} buildId={b.id} />
                <BuildComposer api={api} buildId={b.id} parts={parts} onAdded={reload} />
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
