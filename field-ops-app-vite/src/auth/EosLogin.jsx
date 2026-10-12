import { useId, useState } from "react";
import { useAuth } from "./AuthContext";
import AuthShell, { AuthError } from "./AuthShell";
import { eosLoginClient, eosLoginMessage } from "./eosLoginClient.js";

// THE EOS SIGN-IN SCREEN -- the human front door's UI (docs/architecture/eos-native-identity.md, 3(e)). Rendered by
// App.jsx in place of Login.jsx only when the build enables EOS login. Same shell, same field and error markup.
//
// Four steps, one component:
//   signin   sign-in name + password
//   mfa      the six-digit code from an authenticator app, or a recovery code
//   ticket   a one-time SETUP code (first password) or RESET code from an administrator, + a new password
//   done     the ticket was used; sign in with the new password
//
// There is no "email me a reset link": EOS has no outbound email (Owner decision D-5). Recovery is a reset code an
// administrator issues in Administration > Users, handed over out of band.

export default function EosLogin() {
  const { eosSignedIn } = useAuth();
  const [step, setStep] = useState("signin");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [ticket, setTicket] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const ids = { identifier: useId(), password: useId(), code: useId(), ticket: useId(), newPassword: useId(), confirm: useId() };

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(eosLoginMessage(err?.code, err?.detail));
    } finally {
      setBusy(false);
    }
  };

  const submitSignIn = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await eosLoginClient.login(identifier.trim(), password);
      setPassword("");
      if (r.status === "MFA_REQUIRED") {
        setChallenge(r.challenge);
        setCode("");
        setUseRecovery(false);
        setStep("mfa");
        return;
      }
      eosSignedIn();
    });
  };

  const submitMfa = (e) => {
    e.preventDefault();
    run(async () => {
      try {
        await eosLoginClient.completeMfa(challenge, useRecovery ? { recoveryCode: code.trim() } : { code: code.replace(/\s/g, "") });
      } catch (err) {
        // An expired or exhausted challenge cannot be retried: back to the password step.
        if (err?.code === "MFA_CHALLENGE_INVALID" || err?.code === "LOGIN_REFUSED") {
          setChallenge(null);
          setStep("signin");
        }
        throw err;
      }
      setChallenge(null);
      eosSignedIn();
    });
  };

  const submitTicket = (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("The two passwords do not match.");
      return;
    }
    run(async () => {
      const t = ticket.trim();
      const r = t.startsWith("eospr_")
        ? await eosLoginClient.completeReset(t, newPassword)
        : await eosLoginClient.completeEnrollment(t, newPassword);
      setTicket("");
      setNewPassword("");
      setConfirmPassword("");
      setIdentifier(r.loginIdentifier ?? "");
      setStep("done");
    });
  };

  const back = () => {
    setError(null);
    setChallenge(null);
    setStep("signin");
  };

  if (step === "mfa") {
    return (
      <AuthShell title="Two-step verification" intro={useRecovery ? "Enter one of your recovery codes." : "Enter the six-digit code from your authenticator app."}>
        <form className="eos-auth__form" onSubmit={submitMfa}>
          <div className="eos-auth__field">
            <label className="eos-auth__label" htmlFor={ids.code}>{useRecovery ? "Recovery code" : "Verification code"}</label>
            <input
              id={ids.code}
              className="eos-auth__input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode={useRecovery ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoFocus
              required
            />
          </div>
          <button type="submit" className="eos-auth__submit" disabled={busy}>{busy ? "Checking…" : "Verify"}</button>
        </form>
        <AuthError>{error}</AuthError>
        <button type="button" className="eos-auth__secondary" onClick={() => { setUseRecovery((v) => !v); setCode(""); setError(null); }}>
          {useRecovery ? "Use your authenticator app instead" : "Use a recovery code instead"}
        </button>
        <br />
        <button type="button" className="eos-auth__secondary" onClick={back}>Back to sign in</button>
      </AuthShell>
    );
  }

  if (step === "ticket") {
    return (
      <AuthShell
        title="Set your password"
        intro="Enter the setup or reset code your administrator gave you, then choose a password of at least 12 characters."
        footerNote="No code? Ask your administrator for one."
      >
        <form className="eos-auth__form" onSubmit={submitTicket}>
          <div className="eos-auth__field">
            <label className="eos-auth__label" htmlFor={ids.ticket}>Setup or reset code</label>
            <input id={ids.ticket} className="eos-auth__input" value={ticket} onChange={(e) => setTicket(e.target.value)} autoComplete="off" spellCheck={false} required />
          </div>
          <div className="eos-auth__field">
            <label className="eos-auth__label" htmlFor={ids.newPassword}>New password</label>
            <input id={ids.newPassword} className="eos-auth__input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={12} required />
          </div>
          <div className="eos-auth__field">
            <label className="eos-auth__label" htmlFor={ids.confirm}>Confirm new password</label>
            <input id={ids.confirm} className="eos-auth__input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={12} required />
          </div>
          <button type="submit" className="eos-auth__submit" disabled={busy}>{busy ? "Saving…" : "Set password"}</button>
        </form>
        <AuthError>{error}</AuthError>
        <button type="button" className="eos-auth__secondary" onClick={back}>Back to sign in</button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={step === "done" ? "Password set" : "Welcome back"}
      intro={step === "done" ? "Sign in with your new password." : "Sign in to continue."}
    >
      <form className="eos-auth__form" onSubmit={submitSignIn}>
        <div className="eos-auth__field">
          <label className="eos-auth__label" htmlFor={ids.identifier}>Sign-in name</label>
          <input id={ids.identifier} className="eos-auth__input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
        </div>
        <div className="eos-auth__field">
          <label className="eos-auth__label" htmlFor={ids.password}>Password</label>
          <input id={ids.password} className="eos-auth__input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        <button type="submit" className="eos-auth__submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <AuthError>{error}</AuthError>
      <button type="button" className="eos-auth__secondary" onClick={() => { setError(null); setStep("ticket"); }}>
        Have a setup or reset code?
      </button>
    </AuthShell>
  );
}
