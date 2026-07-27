// AUTH-PR-2 self-service recovery -- pure, testable recovery-state behavior,
// extracted from Login.jsx so it can be unit-tested without a React renderer
// (matches the codebase's "pure logic lives in domain/" pattern).
//
// SCOPE (docs/assessments/auth-modernization-architecture.md §5): EMAIL INPUT
// ONLY. There is deliberately NO username acceptance, NO username->email
// resolution, and NO login here -- those are DEFERRED (D-RESOLVER). This module
// only validates an email-format submit and runs a caller-injected reset
// sender, always yielding an identical neutral outcome.

// Neutral confirmation shown regardless of outcome -- must never reveal whether
// the address is registered (enumeration protection). Deliberately contains no
// interpolated email/account value.
export const RECOVERY_NEUTRAL_MESSAGE =
  "Check your email — if the account is eligible for password recovery, " +
  "we'll send instructions to the registered email address.";

// Client-side resend delay is UX protection only; Firebase server-side
// throttling remains the authoritative control.
export const RESEND_COOLDOWN_SECONDS = 45;

// Minimal client-side FORMAT check only -- NOT an existence check, and NOT a
// username check (username input is out of scope). A username-shaped string
// (no "@") fails here, which is how "email input only" is enforced.
export function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

// Validate + normalize a recovery submit. Returns { ok:true, value } for a
// well-formed email, else { ok:false, error } with a generic format message
// (never a raw provider error, never anything revealing existence).
export function prepareRecoverySubmit(rawInput) {
  const value = typeof rawInput === "string" ? rawInput.trim() : "";
  if (!looksLikeEmail(value)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  return { ok: true, value };
}

// Run the reset via the injected sender. ALWAYS resolves to the identical
// neutral outcome: on success AND on any sender rejection, the returned
// message is RECOVERY_NEUTRAL_MESSAGE and no error/email is echoed back. The
// sender is invoked exactly once. This is what guarantees success and Firebase
// failure are indistinguishable to the user, and that a raw error never
// surfaces.
export async function performRecovery(sendReset, value) {
  try {
    await sendReset(value);
  } catch {
    // Deliberately swallowed -- the neutral result below is identical whether
    // or not the address exists / the send succeeded.
  }
  return { sent: true, message: RECOVERY_NEUTRAL_MESSAGE };
}

// Cooldown is modeled as an absolute end-timestamp so it survives mode toggles
// and cannot be bypassed by leaving and re-entering the recovery view.
export function nextCooldownUntil(nowMs) {
  return nowMs + RESEND_COOLDOWN_SECONDS * 1000;
}

export function cooldownRemainingSeconds(cooldownUntilMs, nowMs) {
  return Math.max(0, Math.ceil((cooldownUntilMs - nowMs) / 1000));
}

// A resend is allowed only when no cooldown remains and no send is in flight.
export function canResend(cooldownRemaining, submitting) {
  return cooldownRemaining <= 0 && !submitting;
}
