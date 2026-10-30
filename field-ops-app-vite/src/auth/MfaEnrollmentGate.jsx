import { useAuth } from "./AuthContext";
import AccountSecurity from "../modules/account/AccountSecurity.jsx";
import { Button } from "../shared/ui/primitives";

// THE FORCED AUTHENTICATOR SETUP -- what a session that OWES a second factor sees instead of the app.
//
// The server lets such a session (account marked "two-step required", no authenticator yet) call /auth/* and nothing else
// (eosLoginService.checkSession: MFA_ENROLLMENT_REQUIRED). Every other read fails, so without this gate the person met a
// generic "could not be loaded / Retry" panel with no way forward. This is CLIENT ONLY: the server gate is unchanged and this
// widens nothing. It renders the same AccountSecurity screen the person would otherwise reach at /account/security, plus Sign out.
//
// Done = the person has confirmed a code AND clicked "I have saved them" on the recovery codes. The server has by then marked
// this session verified, so a reload restores it from the cookie with the flag clear and the app loads as normal. Nothing is pasted.

export default function MfaEnrollmentGate() {
  const { logout } = useAuth() ?? {};
  return (
    <main>
      <div className="ns-page">
        <h2>Set up two-step verification</h2>
        <p>Your administrator requires two-step verification on this account. Set it up below to continue.</p>
        <div><Button type="button" variant="secondary" onClick={() => logout?.()}>Sign out</Button></div>
      </div>
      <AccountSecurity onEnrolled={() => window.location.reload()} />
    </main>
  );
}
