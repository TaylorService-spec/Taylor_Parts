import { useState } from "react";
import { useAuth } from "./AuthContext";

// AUTH-PR-2 self-service recovery -- EMAIL INPUT ONLY. Username-input recovery
// and username login are DEFERRED (D-RESOLVER); this screen keeps the existing
// email/password sign-in unchanged and adds a "Forgot password?" flow that
// calls Firebase's client-side sendPasswordResetEmail (no Function, no
// resolver, not Blaze-dependent). See docs/assessments/
// auth-modernization-architecture.md §5.

// Neutral confirmation shown regardless of outcome -- must never reveal
// whether the address is registered (enumeration protection).
const RECOVERY_NEUTRAL_MESSAGE =
  "Check your email — if the account is eligible for password recovery, " +
  "we'll send instructions to the registered email address.";
// Client-side resend delay is UX protection only; Firebase server-side
// throttling remains the authoritative control.
const RESEND_COOLDOWN_SECONDS = 45;

// Minimal client-side FORMAT check only (not an existence check).
function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

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
  const [cooldown, setCooldown] = useState(0);

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

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    const id = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(id);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const sendReset = async (value) => {
    setRecoverSubmitting(true);
    try {
      await resetPassword(value);
    } catch {
      // Deliberately swallowed: the confirmation below is identical whether or
      // not the address exists, so a failure must not change what the user sees.
    } finally {
      setRecoverSubmitting(false);
      setRecoverSent(true);
      startCooldown();
    }
  };

  const handleRecover = (e) => {
    e.preventDefault();
    setRecoverError(null);
    const value = recoverEmail.trim();
    if (!looksLikeEmail(value)) {
      setRecoverError("Enter a valid email address.");
      return;
    }
    sendReset(value);
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
    return (
      <div className="fo-panel">
        <h2>Reset password</h2>
        {recoverSent ? (
          <>
            <p className="fo-muted">{RECOVERY_NEUTRAL_MESSAGE}</p>
            <button
              type="button"
              className="fo-link-btn"
              disabled={cooldown > 0 || recoverSubmitting}
              onClick={() => sendReset(recoverEmail.trim())}
            >
              {cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend email"}
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
