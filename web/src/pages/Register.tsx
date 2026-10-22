import { useState, type SyntheticEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../api-context";
import { register } from "../lib/queries/auth";

const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

const MESSAGES = {
  taken: "Handle already taken",
  failed: "Registration failed",
};

export function Register() {
  const api = useApi();
  const navigate = useNavigate();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!HANDLE_PATTERN.test(handle)) {
      setError("Handle must be 3 to 20 lowercase letters, digits or underscores");
      return;
    }
    if (password.length < 8 || password.length > 72) {
      setError("Password must be 8 to 72 characters");
      return;
    }
    setPending(true);
    setError(null);
    const input = displayName === "" ? { handle, password } : { handle, password, displayName };
    void register(api, input).then((result) => {
      setPending(false);
      if (result === "ok") void navigate("/");
      else setError(MESSAGES[result]);
    });
  };

  return (
    <section>
      <h1>Register</h1>
      <form onSubmit={submit}>
        <label>
          Handle
          <input value={handle} onChange={(e) => {
              setHandle(e.target.value);
            }} />
        </label>
        <label>
          Display name
          <input value={displayName} onChange={(e) => {
              setDisplayName(e.target.value);
            }} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => {
              setPassword(e.target.value);
            }} />
        </label>
        <button type="submit" disabled={pending}>
          Register
        </button>
        {error !== null && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
