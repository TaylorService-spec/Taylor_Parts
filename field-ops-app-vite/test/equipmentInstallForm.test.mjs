// The decision layer behind an irreversible button.
//
// Equipment accountId and locationId are immutable after create, nothing clears the asset's link,
// and recovery does not exist yet. So the tests here are about the two ways this form could hurt
// somebody: letting them install at the WRONG customer, or letting them install TWICE.
import test from "node:test";
import assert from "node:assert/strict";
import {
  INSTALL_STEP, INSTALL_SUBMIT, INSTALL_FAILURE, INSTALL_DISABLED_REASON,
  EMPTY_INSTALL_FORM,
  locationsForAccount, validateInstallForm, deriveInstallStep,
  selectCustomer, selectUnit, selectLocation,
  deriveIdempotencyKey, buildInstallRequest, interpretInstallResult, deriveInstallAction,
} from "../src/domain/equipmentInstallForm.js";

const LOCATIONS = [
  { id: "loc-a1", accountId: "acct-a", name: "Airport" },
  { id: "loc-a2", accountId: "acct-a", name: "Downtown" },
  { id: "loc-b1", accountId: "acct-b", name: "Other customer's site" },
];
const complete = {
  ...EMPTY_INSTALL_FORM,
  serializedAssetId: "sa_1", serialNo: "CW-C161-0001", accountId: "acct-a", locationId: "loc-a1",
};

// ── THE WRONG CUSTOMER ────────────────────────────────────────────────────────────────────────

test("only the chosen customer's locations are offered", () => {
  assert.deepEqual(locationsForAccount(LOCATIONS, "acct-a").map((l) => l.id), ["loc-a1", "loc-a2"]);
  assert.deepEqual(locationsForAccount(LOCATIONS, "acct-b").map((l) => l.id), ["loc-b1"]);
  // No customer chosen means no locations, not all of them.
  assert.deepEqual(locationsForAccount(LOCATIONS, null), []);
});

test("CHANGING THE CUSTOMER CLEARS THE LOCATION", () => {
  // The defect this prevents: pick customer A, pick A's location, change to customer B. Without
  // clearing, the form looks complete and names a location belonging to somebody else -- exactly
  // the mismatch the backend exists to catch, reached after the user already committed to it.
  const switched = selectCustomer(complete, "acct-b");
  assert.equal(switched.accountId, "acct-b");
  assert.equal(switched.locationId, null);
});

test("a location belonging to a different customer is refused before the call", () => {
  const mismatched = { ...complete, locationId: "loc-b1" };
  const { valid, problems } = validateInstallForm(mismatched, { locations: LOCATIONS });
  assert.equal(valid, false);
  assert.ok(problems.some((p) => p.field === "location" && /different customer/.test(p.message)));
});

test("a location the form does not recognise is NOT assumed valid", () => {
  // Fail closed. The server would refuse it; saying so here means the user finds out before they
  // confirm rather than after.
  const { valid, problems } = validateInstallForm({ ...complete, locationId: "loc-unknown" }, { locations: LOCATIONS });
  assert.equal(valid, false);
  assert.ok(problems.some((p) => p.field === "location"));
});

test("every missing choice produces its OWN message", () => {
  // A disabled button with no explanation is the failure mode this surface exists to avoid.
  const { problems } = validateInstallForm(EMPTY_INSTALL_FORM, { locations: LOCATIONS });
  assert.deepEqual(problems.map((p) => p.field).sort(), ["customer", "location", "unit"]);
  for (const p of problems) assert.ok(p.message.length > 10, `${p.field} has no usable message`);
});

test("a complete, consistent form is valid", () => {
  assert.equal(validateInstallForm(complete, { locations: LOCATIONS }).valid, true);
});

test("the step is derived from what has been chosen, not tracked separately", () => {
  // Two sources of truth for "where am I" is how a wizard ends up on a step whose data was cleared.
  assert.equal(deriveInstallStep(EMPTY_INSTALL_FORM), INSTALL_STEP.UNIT);
  assert.equal(deriveInstallStep(selectUnit(EMPTY_INSTALL_FORM, { serializedAssetId: "sa_1" })), INSTALL_STEP.CUSTOMER);
  assert.equal(deriveInstallStep({ ...complete, locationId: null }), INSTALL_STEP.LOCATION);
  assert.equal(deriveInstallStep(complete), INSTALL_STEP.CONFIRM);
  // And it goes BACKWARDS when a choice is undone.
  assert.equal(deriveInstallStep(selectCustomer(complete, "acct-b")), INSTALL_STEP.LOCATION);
});

// ── TWICE ─────────────────────────────────────────────────────────────────────────────────────

test("the same attempt produces the SAME key -- a retry replays", () => {
  const a = deriveIdempotencyKey(complete, "tok-1");
  const b = deriveIdempotencyKey({ ...complete }, "tok-1");
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

test("a CORRECTED attempt produces a DIFFERENT key", () => {
  // The other half, and the one that is easy to get wrong. If the key ignored the customer, fixing a
  // mistake and resubmitting would REPLAY the first request and hand back the Equipment at the wrong
  // customer -- reported as success.
  const original = deriveIdempotencyKey(complete, "tok-1");
  assert.notEqual(deriveIdempotencyKey({ ...complete, accountId: "acct-b" }, "tok-1"), original);
  assert.notEqual(deriveIdempotencyKey({ ...complete, locationId: "loc-a2" }, "tok-1"), original);
  assert.notEqual(deriveIdempotencyKey({ ...complete, serializedAssetId: "sa_2" }, "tok-1"), original);
});

test("the key contains only characters the command accepts", () => {
  // A colon was rejected once already on the grant path. The fix belongs where the key is minted.
  const key = deriveIdempotencyKey({ ...complete, serializedAssetId: "sa:1/odd id" }, "tok:1");
  assert.match(key, /^[A-Za-z0-9_-]+$/);
});

test("an incomplete form mints no key at all", () => {
  assert.equal(deriveIdempotencyKey(EMPTY_INSTALL_FORM, "tok-1"), null);
  assert.equal(deriveIdempotencyKey(complete, null), null);
});

test("the request carries a name, because the command requires one", () => {
  const req = buildInstallRequest(complete, { attemptToken: "tok-1", name: "Taylor C161 (CW-C161-0001)" });
  assert.equal(req.serializedAssetId, "sa_1");
  assert.equal(req.accountId, "acct-a");
  assert.equal(req.locationId, "loc-a1");
  assert.equal(req.name, "Taylor C161 (CW-C161-0001)");
  assert.ok(req.idempotencyKey);
  // No unknown fields -- the command's allow-list rejects the whole request over one.
  assert.deepEqual(Object.keys(req).sort(),
    ["accountId", "idempotencyKey", "locationId", "name", "serializedAssetId"]);
});

test("no name supplied falls back to the serial, never to a blank", () => {
  assert.equal(buildInstallRequest(complete, { attemptToken: "t" }).name, "CW-C161-0001");
});

// ── READING THE ANSWER ────────────────────────────────────────────────────────────────────────

test("a replay is reported as success, naming the existing Equipment", () => {
  const r = interpretInstallResult({ outcome: { outcome: "replayed", equipmentId: "eq_1" } });
  assert.equal(r.status, INSTALL_SUBMIT.INSTALLED);
  assert.equal(r.equipmentId, "eq_1");
  assert.equal(r.replayed, true);
});

test("ALREADY_INSTALLED is a STATE, not a failure to retry", () => {
  // If this were flattened into a generic failure, the UI would keep offering a retry for a machine
  // that is already at a customer.
  const r = interpretInstallResult({ error: { code: "failed-precondition", details: INSTALL_FAILURE.ALREADY_INSTALLED } });
  assert.equal(r.status, INSTALL_SUBMIT.ALREADY_INSTALLED);
  assert.match(r.message, /already installed/i);
});

test("any other refusal keeps its code so the caller can say something specific", () => {
  const r = interpretInstallResult({ error: { code: "invalid-argument", details: INSTALL_FAILURE.LOCATION_NOT_OF_ACCOUNT, message: "…" } });
  assert.equal(r.status, INSTALL_SUBMIT.FAILED);
  assert.equal(r.code, INSTALL_FAILURE.LOCATION_NOT_OF_ACCOUNT);
});

// ── THE BUTTON ────────────────────────────────────────────────────────────────────────────────

const action = (over = {}) => deriveInstallAction({
  canInstall: true, form: complete, locations: LOCATIONS, submitStatus: INSTALL_SUBMIT.IDLE, unitAvailable: true, ...over,
});

test("an authorized, complete form enables the action", () => {
  assert.equal(action().enabled, true);
});

test("NO capability disables it, and says so honestly", () => {
  const a = action({ canInstall: false });
  assert.equal(a.enabled, false);
  assert.equal(a.reason, INSTALL_DISABLED_REASON);
});

test("each blocking condition has its OWN reason", () => {
  // Four different reasons a button may be dead. Collapsing them teaches the user nothing about
  // which one applies to them.
  const reasons = new Set([
    action({ canInstall: false }).reason,
    action({ submitStatus: INSTALL_SUBMIT.SUBMITTING }).reason,
    action({ submitStatus: INSTALL_SUBMIT.INSTALLED }).reason,
    action({ unitAvailable: false }).reason,
    action({ form: EMPTY_INSTALL_FORM }).reason,
  ]);
  assert.equal(reasons.size, 5, "two conditions share a message");
  for (const r of reasons) assert.ok(r && r.length > 5);
});

test("a unit that stopped being available cannot be installed", () => {
  // Somebody else installed it while this dialog was open. The list refreshes; the button must not
  // stay live over stale state.
  assert.equal(action({ unitAvailable: false }).enabled, false);
});

test("an in-flight submission blocks a second one", () => {
  // The idempotency key makes a duplicate harmless, but two in-flight requests still leave the user
  // watching two spinners with no idea which they are waiting for.
  assert.equal(action({ submitStatus: INSTALL_SUBMIT.SUBMITTING }).enabled, false);
  assert.equal(action({ submitStatus: INSTALL_SUBMIT.INSTALLED }).enabled, false);
});
