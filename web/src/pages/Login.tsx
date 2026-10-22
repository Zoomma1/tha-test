import { useState, type SyntheticEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../api-context";
import { login } from "../lib/queries/auth";

const MESSAGES = {
  invalid: "Invalid handle or password",
  "rate-limited": "Too many attempts, try again later",
  failed: "Login failed",
};

export function Login() {
  const api = useApi();
  const navigate = useNavigate();
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    void login(api, handle, password).then((result) => {
      setPending(false);
      if (result === "ok") void navigate("/");
      else setError(MESSAGES[result]);
    });
  };

  return (
    <section>
      <h1>Log in</h1>
      <form onSubmit={submit}>
        <label>
          Handle
          <input value={handle} onChange={(e) => {
              setHandle(e.target.value);
            }} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => {
              setPassword(e.target.value);
            }} />
        </label>
        <button type="submit" disabled={pending}>
          Log in
        </button>
        {error !== null && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
