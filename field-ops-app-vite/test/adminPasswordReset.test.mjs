// AUTH-UI-2 -- behavior tests for the pure admin-password-reset UI state.
// Proves: truthful result mapping (no "delivered" claim, ever), neutral accepted
// copy that never confirms an account exists, sanitized error->result mapping on
// the coarse HttpsError code only, client-side eligibility gating (self-target +
// missing-employee-link only; server is the boundary), the idle->confirming->
// submitting->done action-state machine, the synchronous in-flight lock /
// double-submit protection, idempotency-key reuse across retries, and bounded
// reason validation.
//
// Run: node test/adminPasswordReset.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  RESET_MODES,
  DEFAULT_MODE,
  isModeSupportedHere,
  RESET_RESULT,
  isResetResult,
  RESULT_COPY,
  resultMessage,
  isSuccessResult,
  isRetryableResult,
  mapCallableOutcome,
  mapCallableError,
  normalizeCallableCode,
  ADMIN_CREDENTIAL_RESET_INITIATE_CAPABILITY,
  canInitiateAdminCredentialReset,
  ELIGIBILITY_REASON,
  deriveTargetEligibility,
  describeTargetUser,
  sanitizeReasonCode,
  REASON_MAX_LEN,
  newIdempotencyKey,
  isValidIdempotencyKey,
  ACTION_PHASE,
  initialActionState,
  beginConfirm,
  cancelConfirm,
  markSubmitting,
  settle,
  ariaForState,
  createAdminResetController,
} from "../src/domain/adminPasswordReset.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }
async function okAsync(name, fn) { await fn().then(() => { passed += 1; console.log("PASS -- " + name); }); }

// -- truthfulness: no result copy may claim delivery -------------------------
ok("no result message claims delivered/opened/consumed (D-DELIVERY-NATIVE)", () => {
  for (const [key, msg] of Object.entries(RESULT_COPY)) {
    assert.ok(!/deliver|delivered|opened|consumed|received the email/i.test(msg), `copy for ${key} must not claim delivery`);
  }
  // there is no "delivered"/"sent-confirmed" result state at all
  assert.ok(!Object.values(RESET_RESULT).some((v) => /deliver|confirmed/.test(v)));
});
ok("accepted copy is neutral -- does not confirm the account exists", () => {
  const msg = RESULT_COPY[RESET_RESULT.REQUEST_ACCEPTED];
  assert.match(msg, /if the account is eligible/i);
});

// -- modes -------------------------------------------------------------------
ok("only routine is supported in this UI gate (D-ROUTINE-REVOKE = NO)", () => {
  assert.deepStrictEqual([...RESET_MODES], ["routine", "suspectedCompromise"]);
  assert.strictEqual(DEFAULT_MODE, "routine");
  assert.strictEqual(isModeSupportedHere("routine"), true);
  assert.strictEqual(isModeSupportedHere("suspectedCompromise"), false);
});

// -- outcome mapping ---------------------------------------------------------
ok("accepted outcome -> REQUEST_ACCEPTED", () => {
  assert.strictEqual(mapCallableOutcome({ status: "accepted" }), RESET_RESULT.REQUEST_ACCEPTED);
});
ok("unknown outcome shape -> UNCERTAIN (never success)", () => {
  for (const o of [undefined, null, {}, { status: "queued" }, 42, "accepted"]) {
    assert.strictEqual(mapCallableOutcome(o), RESET_RESULT.UNCERTAIN);
  }
});

// -- error mapping (coarse code ONLY) ---------------------------------------
ok("error codes map to sanitized states on code alone", () => {
  const cases = {
    "unauthenticated": RESET_RESULT.DENIED,
    "permission-denied": RESET_RESULT.DENIED,
    "failed-precondition": RESET_RESULT.DENIED,
    "invalid-argument": RESET_RESULT.DENIED,
    "unavailable": RESET_RESULT.SERVICE_UNAVAILABLE,
    "aborted": RESET_RESULT.UNCERTAIN,
    "already-exists": RESET_RESULT.UNCERTAIN,
    "internal": RESET_RESULT.UNCERTAIN,
    "something-else": RESET_RESULT.UNCERTAIN,
    "": RESET_RESULT.UNCERTAIN,
  };
  for (const [code, expected] of Object.entries(cases)) {
    assert.strictEqual(mapCallableError({ code, message: "leak me: link https://x/oob?code=SECRET" }), expected, code);
  }
});
ok("error mapping ignores message/details entirely (no leak path)", () => {
  // even a permission error carrying a secret message maps only by code
  const r = mapCallableError({ code: "permission-denied", message: "target user@example.com not found; link=abc" });
  assert.strictEqual(r, RESET_RESULT.DENIED);
});

// -- Firebase "functions/"-namespaced code normalization --------------------
ok("normalizeCallableCode strips ONE leading functions/ namespace only", () => {
  assert.strictEqual(normalizeCallableCode("functions/permission-denied"), "permission-denied");
  assert.strictEqual(normalizeCallableCode("permission-denied"), "permission-denied"); // already bare
  assert.strictEqual(normalizeCallableCode("functions/"), ""); // namespace with no status
  assert.strictEqual(normalizeCallableCode("functions/functions/x"), "functions/x"); // only ONE prefix stripped
  assert.strictEqual(normalizeCallableCode("other/permission-denied"), "other/permission-denied"); // foreign ns untouched
  assert.strictEqual(normalizeCallableCode(undefined), ""); // non-string -> ""
  assert.strictEqual(normalizeCallableCode(42), "");
});
ok("mapCallableError classifies the SDK's functions/-prefixed codes (no fail-open drift)", () => {
  // The callable SDK surfaces FunctionsError.code prefixed; these must classify
  // exactly as their bare equivalents -- NOT fall through to UNCERTAIN.
  const cases = {
    "functions/unauthenticated": RESET_RESULT.DENIED,
    "functions/permission-denied": RESET_RESULT.DENIED,
    "functions/failed-precondition": RESET_RESULT.DENIED,
    "functions/invalid-argument": RESET_RESULT.DENIED,
    "functions/unavailable": RESET_RESULT.SERVICE_UNAVAILABLE,
    "functions/aborted": RESET_RESULT.UNCERTAIN,
    "functions/already-exists": RESET_RESULT.UNCERTAIN,
    "functions/internal": RESET_RESULT.UNCERTAIN,
    "functions/unknown-status": RESET_RESULT.UNCERTAIN, // unknown status still UNCERTAIN
    "functions/": RESET_RESULT.UNCERTAIN, // empty status -> UNCERTAIN
  };
  for (const [code, expected] of Object.entries(cases)) {
    assert.strictEqual(mapCallableError({ code, message: "leak https://x/oob?code=SECRET" }), expected, code);
  }
  // Regression: the bare (unprefixed) forms still classify identically.
  assert.strictEqual(mapCallableError({ code: "permission-denied" }), RESET_RESULT.DENIED);
  assert.strictEqual(mapCallableError({ code: "unavailable" }), RESET_RESULT.SERVICE_UNAVAILABLE);
});

// -- fail-closed capability gate (admin.credentialReset.initiate) -----------
ok("capability id is byte-identical to the backend Permission catalog id", () => {
  assert.strictEqual(ADMIN_CREDENTIAL_RESET_INITIATE_CAPABILITY, "admin.credentialReset.initiate");
});
ok("canInitiateAdminCredentialReset requires an EXPLICIT true from a real previewer", () => {
  // Denied: no previewer / non-function / wrong shape -- surface reached without the feed.
  assert.strictEqual(canInitiateAdminCredentialReset(undefined), false);
  assert.strictEqual(canInitiateAdminCredentialReset(null), false);
  assert.strictEqual(canInitiateAdminCredentialReset({}), false);
  assert.strictEqual(canInitiateAdminCredentialReset(true), false);
  // Denied: previewer says false/undefined (inactive OR ungranted -- today always).
  assert.strictEqual(canInitiateAdminCredentialReset(() => false), false);
  assert.strictEqual(canInitiateAdminCredentialReset(() => undefined), false);
  // Denied: a non-`true` truthy decision must NOT be honored (strict === true).
  assert.strictEqual(canInitiateAdminCredentialReset(() => "yes"), false);
  assert.strictEqual(canInitiateAdminCredentialReset(() => 1), false);
  // Granted: only an explicit true for THIS capability id.
  const spy = [];
  const grantAll = (cap) => { spy.push(cap); return true; };
  assert.strictEqual(canInitiateAdminCredentialReset(grantAll), true);
  assert.deepStrictEqual(spy, ["admin.credentialReset.initiate"], "gate queries exactly the reset capability id");
  // Granted ONLY for the reset id, not a different capability.
  const grantOther = (cap) => cap === "some.other.capability";
  assert.strictEqual(canInitiateAdminCredentialReset(grantOther), false);
});

// -- result helpers ----------------------------------------------------------
ok("success/retryable helpers", () => {
  assert.strictEqual(isSuccessResult(RESET_RESULT.REQUEST_ACCEPTED), true);
  assert.strictEqual(isSuccessResult(RESET_RESULT.UNCERTAIN), false);
  assert.strictEqual(isRetryableResult(RESET_RESULT.SERVICE_UNAVAILABLE), true);
  assert.strictEqual(isRetryableResult(RESET_RESULT.UNCERTAIN), true);
  assert.strictEqual(isRetryableResult(RESET_RESULT.REQUEST_ACCEPTED), false);
  assert.strictEqual(isRetryableResult(RESET_RESULT.DENIED), false);
  assert.strictEqual(isRetryableResult(RESET_RESULT.CONFIGURATION_UNAVAILABLE), false);
  assert.strictEqual(resultMessage("bogus"), RESULT_COPY[RESET_RESULT.UNCERTAIN]);
  assert.strictEqual(isResetResult(RESET_RESULT.DENIED), true);
  assert.strictEqual(isResetResult("nope"), false);
});

// -- eligibility (client gates ONLY self + missing link) --------------------
ok("self-target is ineligible client-side", () => {
  const r = deriveTargetEligibility({ uid: "u1", hasEmployeeLink: true }, "u1");
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.reason, ELIGIBILITY_REASON.SELF_TARGET);
});
ok("missing employee link is ineligible client-side", () => {
  const r = deriveTargetEligibility({ uid: "u2", hasEmployeeLink: false }, "admin");
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.reason, ELIGIBILITY_REASON.MISSING_EMPLOYEE_LINK);
});
ok("a linked other user is eligible client-side (server still decides)", () => {
  const r = deriveTargetEligibility({ uid: "u3", hasEmployeeLink: true }, "admin");
  assert.deepStrictEqual(r, { eligible: true, reason: null });
});
ok("missing/blank uid is ineligible", () => {
  assert.strictEqual(deriveTargetEligibility(null, "a").eligible, false);
  assert.strictEqual(deriveTargetEligibility({ uid: "" }, "a").eligible, false);
});
ok("describeTargetUser exposes only safe fields", () => {
  const d = describeTargetUser({ uid: "u9", displayName: "Jane", role: "technician", hasEmployeeLink: true, email: "secret@x.com", customClaims: { x: 1 } });
  assert.deepStrictEqual(d, { uid: "u9", displayName: "Jane", role: "technician", hasEmployeeLink: true });
  assert.ok(!("email" in d) && !("customClaims" in d));
});

// -- bounded reason ----------------------------------------------------------
ok("reason: empty is allowed; overlong/invalid rejected", () => {
  assert.deepStrictEqual(sanitizeReasonCode("  "), { ok: true, value: "" });
  assert.deepStrictEqual(sanitizeReasonCode(" locked out "), { ok: true, value: "locked out" });
  assert.strictEqual(sanitizeReasonCode("x".repeat(REASON_MAX_LEN + 1)).ok, false);
  assert.strictEqual(sanitizeReasonCode("bad<script>").ok, false);
});

// -- idempotency key ---------------------------------------------------------
ok("generated keys satisfy the backend contract and vary", () => {
  const a = newIdempotencyKey(1_700_000_000_000, () => 0.123456);
  const b = newIdempotencyKey(1_700_000_000_001, () => 0.987654);
  assert.ok(isValidIdempotencyKey(a));
  assert.ok(isValidIdempotencyKey(b));
  assert.notStrictEqual(a, b);
  assert.strictEqual(isValidIdempotencyKey("short"), false);
});

// -- action-state machine ----------------------------------------------------
ok("machine: idle -> confirming only for eligible + supported mode", () => {
  const s0 = initialActionState();
  assert.strictEqual(s0.phase, ACTION_PHASE.IDLE);
  assert.strictEqual(beginConfirm(s0, { eligible: false, mode: "routine" }).phase, ACTION_PHASE.IDLE);
  assert.strictEqual(beginConfirm(s0, { eligible: true, mode: "suspectedCompromise" }).phase, ACTION_PHASE.IDLE);
  const s1 = beginConfirm(s0, { eligible: true, mode: "routine" });
  assert.strictEqual(s1.phase, ACTION_PHASE.CONFIRMING);
});
ok("machine: cancel returns to idle; submit only from confirming", () => {
  const s1 = beginConfirm(initialActionState(), { eligible: true });
  assert.strictEqual(cancelConfirm(s1).phase, ACTION_PHASE.IDLE);
  const s2 = markSubmitting(s1);
  assert.strictEqual(s2.phase, ACTION_PHASE.SUBMITTING);
  // cannot submit from idle
  assert.strictEqual(markSubmitting(initialActionState()).phase, ACTION_PHASE.IDLE);
});
ok("machine: settle coerces unknown results to UNCERTAIN", () => {
  const done = settle({ phase: ACTION_PHASE.SUBMITTING }, "garbage");
  assert.strictEqual(done.phase, ACTION_PHASE.DONE);
  assert.strictEqual(done.result, RESET_RESULT.UNCERTAIN);
  const ok2 = settle({ phase: ACTION_PHASE.SUBMITTING }, RESET_RESULT.REQUEST_ACCEPTED);
  assert.strictEqual(ok2.result, RESET_RESULT.REQUEST_ACCEPTED);
});
ok("aria: busy while submitting; assertive only on denial", () => {
  assert.strictEqual(ariaForState({ phase: ACTION_PHASE.SUBMITTING })["aria-busy"], "true");
  assert.strictEqual(ariaForState({ phase: ACTION_PHASE.DONE, result: RESET_RESULT.DENIED }).role, "alert");
  assert.strictEqual(ariaForState({ phase: ACTION_PHASE.DONE, result: RESET_RESULT.REQUEST_ACCEPTED }).role, "status");
});

// -- controller: lock, mapping, idempotency reuse ---------------------------
await okAsync("controller maps accepted and reuses the key on retry", async () => {
  let calls = 0;
  const seenKeys = [];
  const callable = async ({ idempotencyKey }) => { calls += 1; seenKeys.push(idempotencyKey); return { status: "accepted" }; };
  const ctrl = createAdminResetController(callable, { now: () => 1_000_000, rand: () => 0.5 });
  const key = ctrl.beginIntent();
  const r1 = await ctrl.submit({ targetUid: "u3", mode: "routine" });
  assert.strictEqual(r1.result, RESET_RESULT.REQUEST_ACCEPTED);
  assert.strictEqual(r1.idempotencyKey, key);
  const r2 = await ctrl.submit({ targetUid: "u3", mode: "routine" }); // retry same intent
  assert.strictEqual(r2.idempotencyKey, key, "retry reuses the same key");
  assert.deepStrictEqual(seenKeys, [key, key]);
  assert.strictEqual(calls, 2);
});
await okAsync("controller synchronous lock blocks overlapping submit", async () => {
  let resolveCall;
  let calls = 0;
  const callable = () => { calls += 1; return new Promise((res) => { resolveCall = () => res({ status: "accepted" }); }); };
  const ctrl = createAdminResetController(callable);
  ctrl.beginIntent();
  const p1 = ctrl.submit({ targetUid: "u3" });
  assert.strictEqual(ctrl.isInFlight(), true);
  const skipped = await ctrl.submit({ targetUid: "u3" }); // overlapping
  assert.deepStrictEqual(skipped, { skipped: "in_flight" });
  resolveCall();
  const r1 = await p1;
  assert.strictEqual(r1.result, RESET_RESULT.REQUEST_ACCEPTED);
  assert.strictEqual(ctrl.isInFlight(), false);
  assert.strictEqual(calls, 1, "only one send occurred");
});
await okAsync("controller maps a thrown HttpsError by code, lock released", async () => {
  const callable = async () => { const e = new Error("boom link=SECRET"); e.code = "unavailable"; throw e; };
  const ctrl = createAdminResetController(callable);
  ctrl.beginIntent();
  const r = await ctrl.submit({ targetUid: "u3", mode: "routine" });
  assert.strictEqual(r.result, RESET_RESULT.SERVICE_UNAVAILABLE);
  assert.strictEqual(ctrl.isInFlight(), false);
});
await okAsync("controller denies an unsupported mode without calling backend", async () => {
  let calls = 0;
  const callable = async () => { calls += 1; return { status: "accepted" }; };
  const ctrl = createAdminResetController(callable);
  ctrl.beginIntent();
  const r = await ctrl.submit({ targetUid: "u3", mode: "suspectedCompromise" });
  assert.strictEqual(r.result, RESET_RESULT.DENIED);
  assert.strictEqual(calls, 0, "unsupported mode must not reach the backend");
});

console.log(`\n${passed} passed`);
