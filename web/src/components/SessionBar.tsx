import { Link } from "react-router-dom";
import { useSession } from "../lib/queries/auth";

export function SessionBar() {
  const { user, loading, logOut } = useSession();
  if (loading) return null;
  if (user !== null) {
    return (
      <span>
        Signed in as {user.displayName}{" "}
        <button type="button" onClick={logOut}>
          Log out
        </button>
      </span>
    );
  }
  return (
    <span>
      <Link to="/login">Log in</Link> <Link to="/register">Register</Link>
    </span>
  );
}
