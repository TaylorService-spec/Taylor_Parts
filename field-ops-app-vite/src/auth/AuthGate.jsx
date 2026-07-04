import { useAuth } from "./AuthContext";
import Login from "./Login";

// The single place that decides whether the app can mount at all:
// auth resolved -> signed in -> role assigned. Everything past this
// gate (App.jsx and below) can assume all three are true and never
// needs to re-check loading/user/role-existence itself. Which NAV tabs
// a given role can see (ROLE_NAV_ACCESS) is a separate, UI-presentation
// concern handled inside App.jsx -- this gate only decides "may this
// account use the app at all," not "which parts of it."
export function AuthGate({ children }) {
  const auth = useAuth();

  if (auth.isLoading) {
    return <div className="fo-panel">Loading...</div>;
  }

  if (!auth.user) {
    return <Login />;
  }

  if (auth.role === null) {
    return <div className="fo-panel">No role assigned yet</div>;
  }

  return children;
}
