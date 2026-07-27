import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import {
  RECOVERY_NEUTRAL_MESSAGE,
  prepareRecoverySubmit,
  performRecovery,
  nextCooldownUntil,
  cooldownRemainingSeconds,
  canResend,
} from "../domain/passwordRecovery";

// AUTH-PR-2 self-service recovery -- EMAIL INPUT ONLY. Username-input recovery
// and username login are DEFERRED (D-RESOLVER); this screen keeps the existing
// email/password sign-in unchanged and adds a "Forgot password?" flow that
// calls Firebase's client-side reset (no Function, no resolver). Pure recovery
// behavior lives in ../domain/passwordRecovery.js and is unit-tested there.

export default function Login() {
  const { login, resetPassword } = useAuth();
  const [mode, setMode] = useState("signin"); // "signin" | "recover"

  // sign-in state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // recovery state
  const [recoverEmail, setRecoverEmail] = useState("");
  const [recoverError, setRecoverError] = useState(null);
  const [recoverSent, setRecoverSent] = useState(false);
  const [recoverSubmitting, setRecoverSubmitting] = useState(false);
  // Cooldown as an absolute end-timestamp so it survives switching to sign-in
  // and back (state is not reset by mode toggles) and cannot be bypassed by
  // toggling modes. `now` ticks only while a cooldown is active.
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return undefined;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= cooldownUntil) clearInterval(id); // self-stop at expiry
    }, 250);
    return () => clearInterval(id); // one timer per cooldown; cleaned on unmount
  }, [cooldownUntil]);

  const cooldownRemaining = cooldownRemainingSeconds(cooldownUntil, now);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      setError("Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  };

  const runReset = async (value) => {
    setRecoverSubmitting(true);
    const result = await performRecovery(resetPassword, value);
    setRecoverSubmitting(false);
    setRecoverSent(result.sent);
    setCooldownUntil(nextCooldownUntil(Date.now()));
  };

  const handleRecover = (e) => {
    e.preventDefault();
    setRecoverError(null);
    const prep = prepareRecoverySubmit(recoverEmail);
    if (!prep.ok) {
      setRecoverError(prep.error);
      return;
    }
    runReset(prep.value);
  };

  const goToRecover = () => {
    setError(null);
    setRecoverError(null);
    setRecoverSent(false);
    setRecoverEmail(email);
    setMode("recover");
  };

  const backToSignIn = () => {
    setRecoverError(null);
    setRecoverSent(false);
    setMode("signin");
  };

  if (mode === "recover") {
    const resendAllowed = canResend(cooldownRemaining, recoverSubmitting);
    return (
      <div className="fo-panel">
        <h2>Reset password</h2>
        {recoverSent ? (
          <>
            <p className="fo-muted">{RECOVERY_NEUTRAL_MESSAGE}</p>
            <button
              type="button"
              className="fo-link-btn"
              disabled={!resendAllowed}
              onClick={() => runReset(recoverEmail.trim())}
            >
              {cooldownRemaining > 0 ? `Resend available in ${cooldownRemaining}s` : "Resend email"}
            </button>
            <br />
            <button type="button" className="fo-link-btn" onClick={backToSignIn}>
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <form className="fo-form" onSubmit={handleRecover}>
              <input
                type="email"
                placeholder="Email"
                value={recoverEmail}
                onChange={(e) => setRecoverEmail(e.target.value)}
                autoComplete="username"
                required
              />
              <button type="submit" disabled={recoverSubmitting}>
                {recoverSubmitting ? "Sending…" : "Send reset instructions"}
              </button>
            </form>
            {recoverError && <p className="fo-muted">{recoverError}</p>}
            <button type="button" className="fo-link-btn" onClick={backToSignIn}>
              Back to sign in
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="fo-panel">
      <h2>Field Ops Login</h2>
      <form className="fo-form" onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign In"}
        </button>
      </form>
      {error && <p className="fo-muted">{error}</p>}
      <button type="button" className="fo-link-btn" onClick={goToRecover}>
        Forgot password?
      </button>
    </div>
  );
}
