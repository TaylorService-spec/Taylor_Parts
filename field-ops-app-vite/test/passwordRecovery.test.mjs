// AUTH-PR-2 self-service recovery -- behavior tests for the pure recovery
// state extracted from Login.jsx. Proves email-only acceptance, identical
// neutral confirmation on success AND failure, no raw-error/email leakage,
// single reset invocation, absence of any username-login/resolver surface,
// and the cooldown gating math.
//
// Run: node test/passwordRecovery.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import * as recovery from "../src/domain/passwordRecovery.js";
import {
  RECOVERY_NEUTRAL_MESSAGE,
  RESEND_COOLDOWN_SECONDS,
  prepareRecoverySubmit,
  performRecovery,
  attemptRecovery,
  nextCooldownUntil,
  cooldownRemainingSeconds,
  canResend,
} from "../src/domain/passwordRecovery.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }

// -- email-only acceptance (no username input) ------------------------------
ok("prepare accepts a well-formed email (trimmed)", () => {
  const r = prepareRecoverySubmit("  Jane@Example.com ");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, "Jane@Example.com");
});
ok("prepare rejects username-shaped input -> email input only", () => {
  for (const u of ["jane.smith", "driver-admin", "bob", "jane_smith"]) {
    const r = prepareRecoverySubmit(u);
    assert.strictEqual(r.ok, false, `${u} must be rejected`);
    assert.ok(r.error && !/@/.test(r.error));
  }
});
ok("prepare rejects empty / whitespace / non-string", () => {
  assert.strictEqual(prepareRecoverySubmit("").ok, false);
  assert.strictEqual(prepareRecoverySubmit("   ").ok, false);
  assert.strictEqual(prepareRecoverySubmit(null).ok, false);
  assert.strictEqual(prepareRecoverySubmit(undefined).ok, false);
});

// -- identical neutral outcome; single invocation; no leakage ---------------
await okAsync("performRecovery success -> neutral message, sender called once", async () => {
  let calls = 0; let arg;
  const send = async (v) => { calls += 1; arg = v; };
  const res = await performRecovery(send, "jane@example.com");
  assert.strictEqual(calls, 1);
  assert.strictEqual(arg, "jane@example.com");
  assert.deepStrictEqual(res, { sent: true, message: RECOVERY_NEUTRAL_MESSAGE });
});
await okAsync("performRecovery sender rejection -> IDENTICAL neutral message, no throw", async () => {
  let calls = 0;
  const send = async () => { calls += 1; throw new Error("auth/user-not-found: raw firebase error"); };
  const res = await performRecovery(send, "missing@example.com");
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(res, { sent: true, message: RECOVERY_NEUTRAL_MESSAGE });
});
await okAsync("performRecovery result never echoes email or a raw provider error", async () => {
  const send = async () => { throw new Error("auth/invalid-email raw provider detail"); };
  const res = await performRecovery(send, "secret.person@example.com");
  const blob = JSON.stringify(res).toLowerCase();
  assert.ok(!blob.includes("secret.person"), "email must not appear");
  assert.ok(!blob.includes("firebase"), "provider name must not appear");
  assert.ok(!blob.includes("auth/"), "raw error code must not appear");
  assert.ok(!blob.includes("error"), "no error field must surface");
});
ok("neutral message carries no account/email value", () => {
  assert.ok(!RECOVERY_NEUTRAL_MESSAGE.includes("@"));
});

// -- absence of any username-login / resolver surface -----------------------
ok("recovery module exposes no username-login or resolver export", () => {
  for (const name of [
    "resolveUsername", "usernameToEmail", "signIn", "login",
    "authenticateWithUsername", "signInWithCustomToken",
  ]) {
    assert.strictEqual(name in recovery, false, `${name} must not be exported`);
  }
});

// -- cooldown gating math (survives mode toggles by using absolute time) -----
ok("cooldownRemainingSeconds ceils and floors at 0", () => {
  const until = 100000;
  assert.strictEqual(cooldownRemainingSeconds(until, 100000 - 4500), 5);
  assert.strictEqual(cooldownRemainingSeconds(until, 100000 + 10), 0);
  assert.strictEqual(cooldownRemainingSeconds(until, 100000), 0);
});
ok("nextCooldownUntil = now + resend window", () => {
  assert.strictEqual(nextCooldownUntil(1000), 1000 + RESEND_COOLDOWN_SECONDS * 1000);
});
ok("canResend blocked during cooldown and while submitting", () => {
  assert.strictEqual(canResend(5, false), false); // cooldown active
  assert.strictEqual(canResend(0, true), false);  // send in flight
  assert.strictEqual(canResend(0, false), true);  // allowed
});
ok("cooldown derived from absolute timestamp is not reset by re-deriving", () => {
  // Because remaining is computed from an absolute end-timestamp, re-reading it
  // at any later 'now' (e.g. after leaving and re-entering recovery) yields a
  // consistent, non-bypassable value -- toggling modes cannot shorten it.
  const until = nextCooldownUntil(50000);
  assert.ok(cooldownRemainingSeconds(until, 60000) > 0);
  assert.ok(cooldownRemainingSeconds(until, 60000) >= cooldownRemainingSeconds(until, 70000));
});

// -- attemptRecovery: single choke point closes the mode-toggle bypass --------
await okAsync("attemptRecovery reproduces bypass sequence: 2nd immediate send is BLOCKED", async () => {
  // sign-in -> recovery -> send -> sign-in -> recovery -> immediate submit.
  let calls = 0;
  const send = async () => { calls += 1; };
  const t0 = 1_000_000;
  // First send (no cooldown yet).
  const first = await attemptRecovery(send, "jane@example.com", { cooldownUntil: 0, nowMs: t0 });
  assert.strictEqual(first.blocked, false);
  assert.strictEqual(calls, 1);
  const cooldownUntil = first.cooldownUntil;
  // Reopen recovery and submit the (would-be fresh) form immediately -- still
  // within cooldown. The sender MUST NOT be invoked again.
  const second = await attemptRecovery(send, "jane@example.com", { cooldownUntil, nowMs: t0 + 1000 });
  assert.strictEqual(second.blocked, true);
  assert.strictEqual(calls, 1, "reset sender must not be invoked during cooldown");
});
await okAsync("attemptRecovery allows sending again after cooldown expiry", async () => {
  let calls = 0;
  const send = async () => { calls += 1; };
  const t0 = 1_000_000;
  const first = await attemptRecovery(send, "jane@example.com", { cooldownUntil: 0, nowMs: t0 });
  const cooldownUntil = first.cooldownUntil;
  const third = await attemptRecovery(send, "jane@example.com", { cooldownUntil, nowMs: cooldownUntil + 1 });
  assert.strictEqual(third.blocked, false);
  assert.strictEqual(calls, 2, "sending becomes available after expiry");
});
await okAsync("attemptRecovery is blocked while a send is in flight", async () => {
  let calls = 0;
  const send = async () => { calls += 1; };
  const r = await attemptRecovery(send, "jane@example.com", { cooldownUntil: 0, nowMs: 1, submitting: true });
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(calls, 0);
});

console.log(`\n${passed} passed`);
