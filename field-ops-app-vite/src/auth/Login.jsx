import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import AuthShell, { AuthError } from "./AuthShell";
import {
  RECOVERY_NEUTRAL_MESSAGE,
  prepareRecoverySubmit,
  createRecoveryController,
  cooldownRemainingSeconds,
  canResend,
} from "../domain/passwordRecovery";

// AUTH-PR-2 self-service recovery -- EMAIL INPUT ONLY. Username-input recovery
// and username login are DEFERRED (D-RESOLVER); this screen keeps the existing
// email/password sign-in unchanged and adds a "Forgot password?" flow that
// calls Firebase's client-side reset (no Function, no resolver). Pure recovery
// behavior lives in ../domain/passwordRecovery.js and is unit-tested there.
//
// SURFACE REBUILD. The authentication LOGIC below is unchanged -- same login
// call, same recovery controller, same synchronous in-flight lock, same
// absolute-timestamp cooldown that survives mode toggles. What changed is the
// composition (see AuthShell.jsx) and three correctness gaps the old markup
// carried:
//   1. Inputs were placeholder-only. A placeholder is not a label: it vanishes
//      on focus and gives assistive technology nothing stable. Every field now
//      has a real <label>.
//   2. A failed sign-in rendered as `.fo-muted` text with no alert role, so it
//      was never announced. It is now role="alert".
//   3. Password had no reveal control, which pushes people toward weaker
//      passwords they can type without error on a phone in the field.

function EyeIcon({ off }) {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M1.5 9S4.5 3.75 9 3.75 16.5 9 16.5 9s-3 5.25-7.5 5.25S1.5 9 1.5 9Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="9" r="2.25" stroke="currentColor" strokeWidth="1.4" />
      {off ? <path d="M3 15 15 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /> : null}
    </svg>
  );
}

// BACK-BUTTON SUPPORT. Login renders OUTSIDE BrowserRouter (App.jsx returns it
// before the router mounts), so there is no route to push and react-router is
// unavailable here. Recovery was therefore pure component state: entering it
// created no history entry, so Back skipped the whole app instead of returning
// to sign in. Moving the router above the auth gate would touch the entire
// authenticated shell for one screen, so this uses the History API directly.
//
// The URL is the source of truth, which also makes the reset view linkable and
// survive a refresh.
const RECOVER_PARAM = "reset";

function readModeFromLocation() {
  if (typeof window === "undefined") return "signin";
  return new URLSearchParams(window.location.search).has(RECOVER_PARAM) ? "recover" : "signin";
}

function locationWithMode(mode) {
  const url = new URL(window.location.href);
  if (mode === "recover") url.searchParams.set(RECOVER_PARAM, "1");
  else url.searchParams.delete(RECOVER_PARAM);
  return url.toString();
}

export default function Login() {
  const { login, resetPassword } = useAuth();
  const [mode, setMode] = useState(readModeFromLocation); // "signin" | "recover"

  // sign-in state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  const emailId = useId();
  const passwordId = useId();
  const recoverEmailId = useId();

  // ONE recovery controller instance for this component. It owns the
  // synchronous in-flight lock + cooldown that both reset paths share, so
  // overlapping attempts cannot start a second send/timer even before React
  // state updates. recoverSubmitting below is for rendering only.
  const controllerRef = useRef(null);
  if (controllerRef.current === null) {
    controllerRef.current = createRecoveryController(resetPassword);
  }

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return undefined;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= cooldownUntil) clearInterval(id); // self-stop at expiry
    }, 250);
    return () => clearInterval(id); // one timer per cooldown; cleaned on unmount
  }, [cooldownUntil]);

  // Keep the view in step with the history entry the browser is showing, so
  // Back and Forward both work. Reading the cooldown here (rather than trusting
  // the state at push time) means arriving back in recovery mid-cooldown lands
  // on the confirmation view, never a fresh form that would look resendable.
  useEffect(() => {
    const onPopState = () => {
      const next = readModeFromLocation();
      setMode(next);
      if (next === "recover") {
        setRecoverError(null);
        setRecoverSent(cooldownRemainingSeconds(cooldownUntil, Date.now()) > 0);
      } else {
        setRecoverError(null);
        setRecoverSent(false);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [cooldownUntil]);

  const cooldownRemaining = cooldownRemainingSeconds(cooldownUntil, now);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      setError("We could not sign you in with that email and password. Check both and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Single reset path for BOTH the initial form and the Resend button. The
  // controller's synchronous in-flight lock authoritatively guarantees exactly
  // one send at a time and one timer; it also enforces the cooldown, so the
  // mode-toggle bypass cannot send a second reset. The isInFlight() short-
  // circuit just avoids flipping render state for an ignored overlapping click.
  const runReset = async (value) => {
    const controller = controllerRef.current;
    if (controller.isInFlight()) return;
    setRecoverSubmitting(true);
    setRecoverError(null);
    const outcome = await controller.send(value);
    setRecoverSubmitting(false);
    if (outcome.cooldownUntil) {
      setCooldownUntil(outcome.cooldownUntil);
      setNow(Date.now());
    }
    if (outcome.ok) setRecoverSent(true);
    else if (outcome.error) setRecoverError(outcome.error);
  };

  const handleRecover = (e) => {
    e.preventDefault();
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
    setRecoverEmail(email);
    // If a cooldown is still active, reopen straight into the confirmation/
    // cooldown view -- NOT the fresh form -- so the cooldown cannot be bypassed
    // by leaving and re-entering recovery.
    setRecoverSent(cooldownRemainingSeconds(cooldownUntil, Date.now()) > 0);
    // Push, so Back returns to sign in rather than leaving the app.
    window.history.pushState({ eosAuthMode: "recover" }, "", locationWithMode("recover"));
    setMode("recover");
  };

  const backToSignIn = () => {
    // If we pushed the recovery entry ourselves, walk back so the stack stays
    // honest and Forward still works. If the user LANDED here directly (a
    // shared ?reset link or a refresh), there is no in-app entry behind us and
    // history.back() would leave the app -- replace instead.
    if (window.history.state?.eosAuthMode === "recover") {
      window.history.back(); // popstate handler resets the view
      return;
    }
    window.history.replaceState({}, "", locationWithMode("signin"));
    setRecoverError(null);
    setRecoverSent(false);
    setMode("signin");
  };

  if (mode === "recover") {
    const resendAllowed = canResend(cooldownRemaining, recoverSubmitting);
    return (
      <AuthShell
        title="Reset your password"
        intro={
          recoverSent
            ? null
            : "Enter the email you sign in with and we will send reset instructions."
        }
        footerNote="Still stuck? Ask your administrator."
      >
        {recoverSent ? (
          <>
            <p className="eos-auth__notice">{RECOVERY_NEUTRAL_MESSAGE}</p>
            <button
              type="button"
              className="eos-auth__secondary"
              disabled={!resendAllowed}
              onClick={() => runReset(recoverEmail.trim())}
            >
              {cooldownRemaining > 0 ? `Resend available in ${cooldownRemaining}s` : "Resend email"}
            </button>
            <br />
            <button type="button" className="eos-auth__secondary" onClick={backToSignIn}>
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <form className="eos-auth__form" onSubmit={handleRecover}>
              <div className="eos-auth__field">
                <label className="eos-auth__label" htmlFor={recoverEmailId}>
                  Work email
                </label>
                <input
                  id={recoverEmailId}
                  className="eos-auth__input"
                  type="email"
                  value={recoverEmail}
                  onChange={(e) => setRecoverEmail(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <button type="submit" className="eos-auth__submit" disabled={recoverSubmitting}>
                {recoverSubmitting ? "Sending…" : "Send reset instructions"}
              </button>
            </form>
            <AuthError>{recoverError}</AuthError>
            <button type="button" className="eos-auth__secondary" onClick={backToSignIn}>
              Back to sign in
            </button>
          </>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Welcome back" intro="Sign in to continue.">
      <form className="eos-auth__form" onSubmit={handleSubmit}>
        <div className="eos-auth__field">
          <label className="eos-auth__label" htmlFor={emailId}>
            Work email
          </label>
          <input
            id={emailId}
            className="eos-auth__input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div className="eos-auth__field">
          <label className="eos-auth__label" htmlFor={passwordId}>
            Password
          </label>
          <div className="eos-auth__input-wrap">
            <input
              id={passwordId}
              className="eos-auth__input eos-auth__input--with-affordance"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="eos-auth__reveal"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              <EyeIcon off={showPassword} />
            </button>
          </div>
        </div>

        <button type="submit" className="eos-auth__submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <AuthError>{error}</AuthError>

      <button type="button" className="eos-auth__secondary" onClick={goToRecover}>
        Forgot password?
      </button>
    </AuthShell>
  );
}
