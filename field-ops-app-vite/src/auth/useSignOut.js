import { useState } from "react";
import { useAuth } from "./AuthContext";

/**
 * Sign Out with a busy state. AuthContext.logout waits for the server to revoke the session (up to the 15 s request bound), so the
 * button must show it is working and ignore a second click. Never throws: the shared logout already ends the local session.
 */
export function useSignOut() {
  const { logout } = useAuth() ?? {};
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout?.();
    } catch {
      // the local session is already gone; a refusal must not strand the screen
    } finally {
      setSigningOut(false);
    }
  };
  return { signingOut, signOut };
}
