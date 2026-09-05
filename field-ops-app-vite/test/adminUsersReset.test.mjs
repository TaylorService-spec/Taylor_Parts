// AUTH-UI-3 -- integration tests for the admin-password-reset surface, exercised
// through a MOCK seam client (firebase stays out of the tests, matching
// reportExecutionSeam's pattern). Proves: sanitized list composition + client
// eligibility, the full list->select->confirm->submit->result flow, truthful
// result mapping (no "delivered" claim), the honest unavailable state when the
// backend is absent, and -- via a source text assertion -- that AdminUsers.jsx
// wires the seam + pure view-model (thin JSX), preserves the setUserStatus
// preview (regression), and never references a reset link/token/oobCode.
//
// Run: node test/adminUsersReset.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  RESET_ACTION_LABEL,
  RESET_UNAVAILABLE_COPY,
  buildResetUserRows,
  loadEligibleUsers,
  maybeLoadEligibleUsers,
  canSubmitReset,
  resetStatusView,
} from "../src/domain/adminUsersResetView.js";
import {
  RESET_RESULT,
  RESULT_COPY,
  ACTION_PHASE,
  createAdminResetController,
  initialActionState,
  beginConfirm,
  markSubmitting,
  settle,
} from "../src/domain/adminPasswordReset.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }
async function okAsync(name, fn) { await fn().then(() => { passed += 1; console.log("PASS -- " + name); }); }

const USERS = [
  { uid: "admin1", displayName: "Ada Admin", role: "admin", hasEmployeeLink: true },
  { uid: "tech1", displayName: "Tim Tech", role: "technician", hasEmployeeLink: true },
  { uid: "nolink", displayName: "No Link", role: "technician", hasEmployeeLink: false },
];

// -- list composition + eligibility -----------------------------------------
ok("buildResetUserRows marks self-target and missing-link ineligible", () => {
  const rows = buildResetUserRows(USERS, "admin1");
  const byUid = Object.fromEntries(rows.map((r) => [r.uid, r]));
  assert.strictEqual(byUid.admin1.eligible, false); // self
  assert.strictEqual(byUid.tech1.eligible, true);
  assert.strictEqual(byUid.nolink.eligible, false); // missing link
  // safe fields only
  assert.ok(!("email" in byUid.tech1));
  assert.ok(byUid.nolink.ineligibleReasonCopy);
});

await okAsync("loadEligibleUsers maps a successful seam result to rows", async () => {
  const listFn = async () => ({ ok: true, users: USERS });
  const res = await loadEligibleUsers(listFn, "admin1");
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.rows.length, 3);
});
await okAsync("loadEligibleUsers surfaces the sanitized unavailable result", async () => {
  const listFn = async () => ({ ok: false, result: RESET_RESULT.CONFIGURATION_UNAVAILABLE });
  const res = await loadEligibleUsers(listFn, "admin1");
  assert.deepStrictEqual(res, { ok: false, result: RESET_RESULT.CONFIGURATION_UNAVAILABLE });
});
await okAsync("loadEligibleUsers treats a thrown seam as unavailable, never fatal", async () => {
  const listFn = async () => { throw new Error("network boom"); };
  const res = await loadEligibleUsers(listFn, "admin1");
  assert.deepStrictEqual(res, { ok: false, result: RESET_RESULT.SERVICE_UNAVAILABLE });
});

// -- fail-closed gate: ZERO list callable attempts while hidden/inactive -----
await okAsync("maybeLoadEligibleUsers makes ZERO seam calls when the capability is absent (incl. a throwing previewer)", async () => {
  const throwing = () => { throw new Error("previewer boom"); };
  for (const hasCapability of [undefined, null, {}, () => false, () => undefined, () => "yes", throwing]) {
    let calls = 0;
    const listFn = async () => { calls += 1; return { ok: true, users: USERS }; };
    // A throwing previewer must fail closed here too: gated, no crash, zero calls.
    const res = await maybeLoadEligibleUsers({ hasCapability, listFn, actorUid: "admin1" });
    assert.strictEqual(calls, 0, "listResetEligibleUsers must NOT be invoked while gated");
    assert.deepStrictEqual(res, { gated: true, ok: false, rows: [] });
  }
});
await okAsync("maybeLoadEligibleUsers loads via the seam ONLY when the capability holds (authorized)", async () => {
  let calls = 0;
  const listFn = async () => { calls += 1; return { ok: true, users: USERS }; };
  const res = await maybeLoadEligibleUsers({ hasCapability: () => true, listFn, actorUid: "admin1" });
  assert.strictEqual(calls, 1, "authorized session performs exactly one list read");
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.gated, undefined);
  assert.strictEqual(res.rows.length, 3);
});
await okAsync("maybeLoadEligibleUsers surfaces a sanitized unavailable result when authorized but backend absent", async () => {
  let calls = 0;
  const listFn = async () => { calls += 1; return { ok: false, result: RESET_RESULT.SERVICE_UNAVAILABLE }; };
  const res = await maybeLoadEligibleUsers({ hasCapability: () => true, listFn, actorUid: "admin1" });
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(res, { ok: false, result: RESET_RESULT.SERVICE_UNAVAILABLE });
});

// -- full flow via mock seam + controller -----------------------------------
await okAsync("flow: list -> select eligible -> submit accepted -> neutral success", async () => {
  const calls = [];
  const client = {
    listResetEligibleUsers: async () => ({ ok: true, users: USERS }),
    rawInitiateAdminPasswordReset: async (p) => { calls.push(p); return { status: "accepted" }; },
  };
  const { rows } = await loadEligibleUsers(client.listResetEligibleUsers, "admin1");
  const target = rows.find((r) => r.uid === "tech1");
  let state = beginConfirm(initialActionState(), { eligible: target.eligible });
  assert.strictEqual(state.phase, ACTION_PHASE.CONFIRMING);

  const ctrl = createAdminResetController((p) => client.rawInitiateAdminPasswordReset(p));
  const key = ctrl.beginIntent();
  state = markSubmitting(state);
  const outcome = await ctrl.submit({ targetUid: target.uid, mode: "routine" });
  state = settle(state, outcome.result);

  assert.strictEqual(outcome.result, RESET_RESULT.REQUEST_ACCEPTED);
  assert.strictEqual(state.phase, ACTION_PHASE.DONE);
  // ONLY the contract fields reach the backend; NO actorUid, NO reason.
  assert.deepStrictEqual(calls, [{ targetUid: "tech1", mode: "routine", idempotencyKey: key }]);
  const view = resetStatusView(state);
  assert.strictEqual(view.tone, "success");
  assert.ok(!/deliver|link|token/i.test(view.message));
});

await okAsync("flow: backend permission-denied -> DENIED, assertive status", async () => {
  const client = {
    rawInitiateAdminPasswordReset: async () => { const e = new Error("nope"); e.code = "permission-denied"; throw e; },
  };
  const ctrl = createAdminResetController((p) => client.rawInitiateAdminPasswordReset(p));
  ctrl.beginIntent();
  const outcome = await ctrl.submit({ targetUid: "tech1", mode: "routine" });
  const state = settle({ phase: ACTION_PHASE.SUBMITTING }, outcome.result);
  assert.strictEqual(outcome.result, RESET_RESULT.DENIED);
  const view = resetStatusView(state);
  assert.strictEqual(view.tone, "error");
  assert.strictEqual(view.aria.role, "alert");
});

await okAsync("flow: backend unavailable -> SERVICE_UNAVAILABLE, warning tone", async () => {
  const client = {
    rawInitiateAdminPasswordReset: async () => { const e = new Error("x"); e.code = "unavailable"; throw e; },
  };
  const ctrl = createAdminResetController((p) => client.rawInitiateAdminPasswordReset(p));
  ctrl.beginIntent();
  const outcome = await ctrl.submit({ targetUid: "tech1", mode: "routine" });
  const view = resetStatusView(settle({ phase: ACTION_PHASE.SUBMITTING }, outcome.result));
  assert.strictEqual(outcome.result, RESET_RESULT.SERVICE_UNAVAILABLE);
  assert.strictEqual(view.tone, "warning");
});

// -- canSubmit gating --------------------------------------------------------
ok("canSubmitReset requires eligible row and not in-flight", () => {
  const eligible = { uid: "t", eligible: true };
  const ineligible = { uid: "s", eligible: false };
  const confirming = { phase: ACTION_PHASE.CONFIRMING };
  assert.strictEqual(canSubmitReset(eligible, confirming, false), true);
  assert.strictEqual(canSubmitReset(eligible, confirming, true), false); // in flight
  assert.strictEqual(canSubmitReset(ineligible, confirming, false), false);
  assert.strictEqual(canSubmitReset(null, confirming, false), false);
});

// -- source-text wiring + regression (UserAccessActions.jsx) -----------------
//
// THE SURFACE MOVED, THE CONTRACT DID NOT. The ADMINISTRATION USERS CONSOLIDATION took the reset
// out of the page-level AdminUsers screen and put it on the User Detail record page, in
// UserAccessActions.jsx, where the target is the record rather than a row picked from a list. Every
// assertion below is the same assertion, re-pointed -- plus one that got STRONGER, marked below.
const accessActionsSrc = fs.readFileSync(
  fileURLToPath(new URL("../src/modules/administration/UserAccessActions.jsx", import.meta.url)),
  "utf8",
);
ok("UserAccessActions.jsx wires the seam + pure view-model (thin JSX)", () => {
  assert.match(accessActionsSrc, /adminPasswordResetClient/);
  assert.match(accessActionsSrc, /adminUsersResetView/);
  assert.match(accessActionsSrc, /createAdminResetController/);
  assert.match(accessActionsSrc, /RESET_ACTION_LABEL/);
  assert.ok(RESET_ACTION_LABEL.length > 0 && RESET_UNAVAILABLE_COPY.length > 0);
});
ok("UserAccessActions.jsx keeps enable/disable on the SAME setUserStatus command", () => {
  // The labels are per-account now ("Enable Account") rather than the old page-level "Enable user",
  // because the action has a subject. What must not change is which command performs it.
  assert.match(accessActionsSrc, /Enable Account/);
  assert.match(accessActionsSrc, /Disable Account/);
  assert.match(accessActionsSrc, /setUserStatus/);
});
ok("UserAccessActions.jsx REQUESTS delivery and never promises it", () => {
  // Owner ruling, PR #1806. "They will receive an email" is a claim about a provider this surface
  // has no signal from -- the callable returns a neutral `accepted`. The merged RESULT_COPY was
  // already careful ("has been requested"); the surface copy now matches it.
  assert.ok(
    !/will receive an email|they will receive|an email will be sent/i.test(accessActionsSrc),
    "the surface must not promise delivery",
  );
  assert.match(accessActionsSrc, /does not confirm delivery|Delivery is not\s+confirmed here/);
  // And the shared copy it defers to is unchanged and still conditional.
  assert.match(RESULT_COPY[RESET_RESULT.REQUEST_ACCEPTED], /If the account is eligible/);
  assert.match(RESULT_COPY[RESET_RESULT.REQUEST_ACCEPTED], /has been requested/);
});

ok("UserAccessActions.jsx never references a reset link/token/oobCode or session revocation", () => {
  // No credential-bearing surface leaks into the client. revokeRefreshTokens is checked as before;
  // the file NAMES revokeUserSessions only to say it invokes nothing of the sort, so the guard is
  // on the API call, not on the word.
  assert.ok(!/generatePasswordResetLink|oobCode|actionCode|revokeRefreshTokens/.test(accessActionsSrc));
  assert.ok(!/email (was|is) delivered|successfully delivered|has been delivered/i.test(accessActionsSrc));
});

// -- fail-closed capability gating wiring (UserAccessActions.jsx) ------------
ok("UserAccessActions.jsx accepts hasCapability and derives canReset from the gate", () => {
  assert.match(accessActionsSrc, /canInitiateAdminCredentialReset/);
  assert.match(accessActionsSrc, /hasCapability/);
  assert.match(accessActionsSrc, /const\s+canReset\s*=\s*canInitiateAdminCredentialReset\(hasCapability\)/);
});
ok("UserAccessActions.jsx gates the ENTIRE reset surface on canReset", () => {
  assert.match(accessActionsSrc, /\{canReset && \(/);
  const gateIdx = accessActionsSrc.indexOf("{canReset && (");
  const labelIdx = accessActionsSrc.indexOf("{RESET_ACTION_LABEL}");
  assert.ok(gateIdx > -1 && labelIdx > gateIdx, "the reset action must render inside the canReset gate");
});
ok("the zero-list-read guarantee got STRONGER: there is no list read left to gate", () => {
  // The old assertion was that the eligible-user list read early-returned when the capability was
  // absent. On a record page the target IS the record, so that read does not happen AT ALL -- for
  // any caller, capability or not. An absent call cannot leak, which is a stronger property than a
  // guarded one, and this is the assertion that would fail if somebody reintroduced the list.
  assert.ok(!/listResetEligibleUsers|maybeLoadEligibleUsers|loadEligibleUsers/.test(accessActionsSrc));
});

// -- dispatcher threads the fail-closed previewer (App.jsx) -------------------
const appSrc = fs.readFileSync(
  fileURLToPath(new URL("../src/App.jsx", import.meta.url)),
  "utf8",
);
ok("App.jsx threads hasCapability into the record page that hosts the reset (not nav-only gating)", () => {
  // The previewer now goes to UserDetail, which mounts UserAccessActions. The Users DIRECTORY takes
  // no capability prop, and should not: it renders no governed action.
  assert.match(appSrc, /<UserDetail hasCapability=\{operationalContext\?\.hasCapability\}/);
});

console.log(`\n${passed} passed`);
