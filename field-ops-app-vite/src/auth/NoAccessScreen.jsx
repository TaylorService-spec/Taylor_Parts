import { useState } from "react";
import { useAuth } from "./AuthContext";
import { Button } from "../shared/ui/primitives";

// THE GOVERNED "NO ACCESS" SCREEN, with the one way out of it.
//
// Extracted from App.jsx with its wording unchanged. The only addition is Sign Out: a principal who holds no application
// area has no shell and so no rail, and without this control the browser session could not be handed to anyone else.
//
// SIGN OUT IS NOT RE-IMPLEMENTED HERE. It is AuthContext.logout -- the same function the rail's Sign Out calls: the EOS
// refresh session is revoked server-side (POST /auth/logout), the in-memory and stored session are cleared, and the context
// settles signed out so App renders the sign-in page. It reads nothing from the capability feed or the experience context,
// so it works for a deny-all principal and while those are empty or unloaded.
export default function NoAccessScreen({ email, eosSource }) {
  const { logout } = useAuth() ?? {};
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout?.();
    } catch (err) {
      // The shared logout clears the client session before anything that can fail; a refusal must not strand the screen.
      console.error("NoAccessScreen: sign-out reported an error.", err?.code ?? err?.message ?? err);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <main className="fo-panel" aria-labelledby="fo-no-access-title">
      <h2 id="fo-no-access-title">No access</h2>
      {eosSource ? (
        <>
          <p className="fo-muted">
            You're signed in as <strong>{email}</strong>. Your access was read from the
            governed source and it grants no areas of the application.
          </p>
          <p className="fo-muted">
            Access here comes from the Security Roles assigned to your EOS principal, and from your
            work eligibility and operational scope — not from a role on your sign-in account. Ask
            an administrator to review your role assignments in Administration, giving them the
            email above. Once they are changed, choose <strong>Check again</strong>.
          </p>
        </>
      ) : (
        <>
          <p className="fo-muted">
            You're signed in as <strong>{email}</strong>, but your account isn't
            assigned a role with access yet.
          </p>
          <p className="fo-muted">
            Ask an administrator to grant your account a role — giving them the email above
            helps them find it. Once access is granted, choose <strong>Check again</strong>.
          </p>
        </>
      )}
      <Button type="button" variant="primary" onClick={() => window.location.reload()}>
        Check again
      </Button>{" "}
      <Button type="button" variant="secondary" onClick={signOut} disabled={signingOut}>
        Sign Out
      </Button>
    </main>
  );
}
