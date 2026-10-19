import { useApi } from "../api-context";
import { Async } from "../lib/Async";
import { loadBuilds } from "../lib/queries/builds";
import { useLoad } from "../lib/use-load";

export function Builds() {
  const api = useApi();
  const { state } = useLoad(() => loadBuilds(api), []);

  return (
    <section>
      <h1>Builds</h1>
      <Async state={state}>
        {(builds) =>
          builds.length === 0 ? (
            <p>No build yet</p>
          ) : (
            <ul>
              {builds.map((b) => (
                <li key={b.id}>
                  <h2>{b.name}</h2>
                  <ul>
                    {b.parts.map((p) => (
                      <li key={p.id}>{p.part.name}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </section>
  );
}
