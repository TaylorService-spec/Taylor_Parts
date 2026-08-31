// NON-PO ACQUISITION — the client's pure layer, and every way it must refuse.
//
// The command owns what acquisition MEANS and re-checks all of it inside its transaction. What this
// file proves is what the CLIENT could get wrong on its own: sending a field the command would
// reject outright, minting an idempotency key that makes a retry look like a new intent, presenting
// a replay as a failure, or showing a stored token where a business word belongs.
//
// The one that costs most is the replay. Identity is derived from part+serial, so the same unit
// submitted twice returns `replayed` — a SUCCESS. Rendering it as an error invites a third attempt
// at something already done, on a command with no undo.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACQUIRE_FAILURE,
  ACQUIRE_SUBMIT,
  ACQUIRE_CONSEQUENCE,
  ACQUIRE_DISABLED_REASON,
  EMPTY_ACQUIRE_FORM,
  acquireConfirmationSummary,
  buildAcquireRequest,
  deriveAcquireAction,
  deriveIdempotencyKey,
  interpretAcquireResult,
  selectLocation,
  selectPart,
  selectReason,
  setProvenanceNote,
  setSerialNo,
  validateAcquireForm,
} from "../src/domain/serializedAssetAcquireForm.js";
import {
  ACQUIRE_REASON,
  ACQUIRE_REASON_LABEL,
  ACQUIRE_REASON_VALUES,
  acquireReasonLabel,
} from "../src/domain/serializedAssetAcquireVocabulary.js";
import { toSerialPartOptions, SERIAL_CONTROL_TYPE } from "../src/domain/serialTrackedPartOptions.js";

const complete = () => {
  let f = EMPTY_ACQUIRE_FORM;
  f = selectPart(f, "SKU-C713");
  f = setSerialNo(f, "SN-1001");
  f = selectLocation(f, "wh-main");
  f = selectReason(f, ACQUIRE_REASON.OPENING_BALANCE);
  return f;
};

// ── THE CLOSED REASON SET ─────────────────────────────────────────────────────────────────────

test('"we bought it" is not an acquisition reason, and that absence is the design', () => {
  // A purchased unit HAS a purchase order and belongs in Receiving. The moment acquisition could
  // express a purchase it becomes a way around procurement rather than an exception beside it.
  assert.deepEqual([...ACQUIRE_REASON_VALUES],
    ["OPENING_BALANCE", "LEGACY_MIGRATION", "EXISTING_COMPANY_ASSET"]);
  for (const forbidden of ["PURCHASE", "PURCHASED", "BOUGHT", "RECEIVED", "SUPPLIER"]) {
    assert.equal(ACQUIRE_REASON_VALUES.includes(forbidden), false, `${forbidden} must not be a reason`);
  }
});

test("a stored reason is never shown as its token, and an unknown one is not guessed", () => {
  for (const value of ACQUIRE_REASON_VALUES) {
    const label = acquireReasonLabel(value);
    assert.ok(label && label !== value, `${value} must have words of its own`);
    assert.doesNotMatch(label, /_/);
  }
  // Fail closed, exactly as the command does: no default that would be untrue.
  assert.equal(acquireReasonLabel("WE_BOUGHT_IT"), null);
  assert.equal(acquireReasonLabel(undefined), null);
});

test("an unrecognised reason fails validation rather than being coerced", () => {
  const form = { ...complete(), reason: "WE_BOUGHT_IT" };
  const { valid, problems } = validateAcquireForm(form);
  assert.equal(valid, false);
  assert.equal(problems.some((p) => p.field === "reason"), true);
});

// ── THE REQUEST ───────────────────────────────────────────────────────────────────────────────

test("the request carries ONLY the command's own keys", () => {
  // The command's validator refuses any field outside its allow-list, so an extra key here would
  // not be ignored — it would fail the whole request.
  const request = buildAcquireRequest(complete(), { attemptToken: "t1" });
  assert.deepEqual(Object.keys(request).sort(),
    ["idempotencyKey", "locationId", "partId", "reason", "serialNo"]);
});

test("an optional provenance note travels only when supplied", () => {
  const withNote = buildAcquireRequest(setProvenanceNote(complete(), "found in the van"), { attemptToken: "t1" });
  assert.equal(withNote.provenanceNote, "found in the van");
  const without = buildAcquireRequest(setProvenanceNote(complete(), "   "), { attemptToken: "t1" });
  assert.equal("provenanceNote" in without, false);
});

test("no request is built from an incomplete form, or without an attempt token", () => {
  assert.equal(buildAcquireRequest(EMPTY_ACQUIRE_FORM, { attemptToken: "t1" }), null);
  assert.equal(buildAcquireRequest(complete(), {}), null);
  // And not from a form whose reason is outside the closed set, even though every field is present.
  assert.equal(buildAcquireRequest({ ...complete(), reason: "WE_BOUGHT_IT" }, { attemptToken: "t1" }), null);
});

test("NO customer, supplier, PO, receipt or equipment field can reach the command", () => {
  // The fields this surface must never grow. Asserted on the built request rather than on the form,
  // because the request is what crosses the boundary.
  const request = buildAcquireRequest(complete(), { attemptToken: "t1" });
  for (const forbidden of [
    "accountId", "customerId", "supplierId", "purchaseOrderId", "receivingOrderId",
    "equipmentId", "ownership", "inventoryState", "acquisitionProvenance", "actorId",
  ]) {
    assert.equal(forbidden in request, false, `${forbidden} must never be sent`);
  }
});

// ── IDEMPOTENCY ───────────────────────────────────────────────────────────────────────────────

test("a retry of ONE attempt reuses the key; a corrected attempt does not", () => {
  const form = complete();
  const first = deriveIdempotencyKey(form, "t1");
  assert.equal(deriveIdempotencyKey(form, "t1"), first, "the same attempt must replay, not duplicate");

  // Each identifying choice changes the intent, so each must change the key.
  assert.notEqual(deriveIdempotencyKey(selectPart(form, "SKU-OTHER"), "t1"), first);
  assert.notEqual(deriveIdempotencyKey(setSerialNo(form, "SN-9999"), "t1"), first);
  assert.notEqual(deriveIdempotencyKey(selectLocation(form, "wh-other"), "t1"), first);
  // A new attempt is a new key even for identical choices.
  assert.notEqual(deriveIdempotencyKey(form, "t2"), first);
});

test("the key stays inside the character set the command accepts", () => {
  const key = deriveIdempotencyKey({
    partId: "SKU:WITH/PUNCT", serialNo: "SN 100:2", locationId: "wh main",
  }, "tok:en");
  assert.match(key, /^[A-Za-z0-9_-]+$/, "a colon was rejected once already on the grant path");
});

test("no key without every identifying choice", () => {
  assert.equal(deriveIdempotencyKey({ partId: "p", serialNo: "s" }, "t"), null);
  assert.equal(deriveIdempotencyKey(complete(), null), null);
});

// ── INTERPRETING THE RESULT ───────────────────────────────────────────────────────────────────

test("A REPLAY IS A SUCCESS, and says nothing was added twice", () => {
  const result = interpretAcquireResult({
    outcome: { outcome: "replayed", serializedAssetId: "sa_1" }, error: null,
  });
  assert.equal(result.status, ACQUIRE_SUBMIT.ACQUIRED);
  assert.equal(result.replayed, true);
  assert.match(result.message, /already on the books/i);
  assert.doesNotMatch(result.message, /error|failed|could not/i);
});

test("a first acquisition reports plainly", () => {
  const result = interpretAcquireResult({
    outcome: { outcome: "acquired", serializedAssetId: "sa_1" }, error: null,
  });
  assert.equal(result.status, ACQUIRE_SUBMIT.ACQUIRED);
  assert.equal(result.replayed, false);
  assert.equal(result.serializedAssetId, "sa_1");
});

test("A CONFLICT IS ITS OWN STATE — retrying cannot help and must not be implied", () => {
  const result = interpretAcquireResult({
    outcome: null, error: { code: "failed-precondition", details: ACQUIRE_FAILURE.ALREADY_EXISTS_CONFLICT },
  });
  assert.equal(result.status, ACQUIRE_SUBMIT.CONFLICT);
  assert.notEqual(result.status, ACQUIRE_SUBMIT.FAILED);
  // It points at the likely cause rather than leaving somebody to guess: the unit may have arrived
  // on a purchase order, and acquisition must never overwrite that.
  assert.match(result.message, /Receiving/);
});

test("a non-serial Part is explained as the wrong KIND, not as missing", () => {
  const result = interpretAcquireResult({
    outcome: null, error: { code: "failed-precondition", details: ACQUIRE_FAILURE.PART_NOT_SERIALIZED },
  });
  assert.match(result.message, /not serial-tracked/i);
  assert.doesNotMatch(result.message, /not found/i);
});

test("a rejected location says a customer's location cannot hold company stock", () => {
  const result = interpretAcquireResult({
    outcome: null, error: { code: "invalid-argument", details: ACQUIRE_FAILURE.LOCATION_INVALID },
  });
  assert.match(result.message, /customer/i);
});

test("a denial reuses the one sentence the disabled control uses", () => {
  const result = interpretAcquireResult({
    outcome: null, error: { code: "permission-denied", details: ACQUIRE_FAILURE.PERMISSION_DENIED },
  });
  assert.equal(result.message, ACQUIRE_DISABLED_REASON);
});

// ── WHAT MAY BE PRESSED ───────────────────────────────────────────────────────────────────────

test("the capability is the first gate, and it says so out loud", () => {
  const action = deriveAcquireAction({ canAcquire: false, form: complete(), submitStatus: ACQUIRE_SUBMIT.IDLE });
  assert.equal(action.enabled, false);
  assert.equal(action.reason, ACQUIRE_DISABLED_REASON);
});

test("each missing field disables with ITS OWN reason, not one combined sentence", () => {
  const reasons = new Set();
  for (const form of [
    EMPTY_ACQUIRE_FORM,
    selectPart(EMPTY_ACQUIRE_FORM, "SKU-1"),
    setSerialNo(selectPart(EMPTY_ACQUIRE_FORM, "SKU-1"), "SN-1"),
    selectLocation(setSerialNo(selectPart(EMPTY_ACQUIRE_FORM, "SKU-1"), "SN-1"), "wh-main"),
  ]) {
    const action = deriveAcquireAction({ canAcquire: true, form, submitStatus: ACQUIRE_SUBMIT.IDLE });
    assert.equal(action.enabled, false);
    reasons.add(action.reason);
  }
  assert.equal(reasons.size, 4, "four different gaps must produce four different sentences");
});

test("a complete form is pressable; an in-flight or completed one is not", () => {
  assert.equal(deriveAcquireAction({ canAcquire: true, form: complete(), submitStatus: ACQUIRE_SUBMIT.IDLE }).enabled, true);
  assert.equal(deriveAcquireAction({ canAcquire: true, form: complete(), submitStatus: ACQUIRE_SUBMIT.SUBMITTING }).enabled, false);
  assert.equal(deriveAcquireAction({ canAcquire: true, form: complete(), submitStatus: ACQUIRE_SUBMIT.ACQUIRED }).enabled, false);
});

// ── THE READ-BACK ─────────────────────────────────────────────────────────────────────────────

test("the confirmation reads back every governed input, in words", () => {
  const rows = acquireConfirmationSummary({
    form: setProvenanceNote(complete(), "found in the van"),
    part: { label: "C713-UNIT — Taylor C713" },
    location: { label: "Main warehouse" },
  });
  assert.deepEqual(rows.map((r) => r.key), ["part", "serial", "location", "reason", "note"]);
  assert.equal(rows.find((r) => r.key === "part").value, "C713-UNIT — Taylor C713");
  assert.equal(rows.find((r) => r.key === "location").value, "Main warehouse");
  // THE REASON IS WORDS, never the stored token.
  assert.equal(rows.find((r) => r.key === "reason").value, ACQUIRE_REASON_LABEL.OPENING_BALANCE);
  assert.doesNotMatch(rows.find((r) => r.key === "reason").value, /_/);
});

test("the note row is absent when no note was given", () => {
  const rows = acquireConfirmationSummary({
    form: complete(), part: { label: "P" }, location: { label: "L" },
  });
  assert.equal(rows.some((r) => r.key === "note"), false);
});

test("no confirmation until every governed input is present", () => {
  assert.equal(acquireConfirmationSummary({ form: EMPTY_ACQUIRE_FORM }), null);
  assert.equal(acquireConfirmationSummary({ form: { ...complete(), reason: "" } }), null);
});

test("the consequence names what is created and what is NOT", () => {
  assert.match(ACQUIRE_CONSEQUENCE, /without a purchase or\s+receiving record/);
  assert.match(ACQUIRE_CONSEQUENCE, /does not assign the unit to a customer/i);
});

// ── THE PART PICKER ───────────────────────────────────────────────────────────────────────────

test("the picker offers exactly the tracking mode the command accepts", () => {
  assert.equal(SERIAL_CONTROL_TYPE, "SERIALIZED");
});

test("a part is labelled by its number and name, never by its document key", () => {
  const options = toSerialPartOptions([
    { partId: "SKU-A", internalPartNumber: "C713-UNIT", name: "Taylor C713" },
    { partId: "SKU-B", name: "Only a name" },
    { partId: "SKU-C", internalPartNumber: "ONLY-NUMBER" },
  ]);
  assert.equal(options.length, 3);
  for (const o of options) assert.notEqual(o.label, o.value);
  assert.equal(options.find((o) => o.value === "SKU-A").label, "C713-UNIT — Taylor C713");
  assert.equal(options.find((o) => o.value === "SKU-B").label, "Only a name");
});

test("a part with neither number nor name is DROPPED rather than labelled with its key", () => {
  // Offering `SKU-D` as its own label would ask a person to recognise a database key, which is the
  // one thing this product never shows.
  const options = toSerialPartOptions([{ partId: "SKU-D" }, { partId: "SKU-E", name: "Real" }]);
  assert.deepEqual(options.map((o) => o.value), ["SKU-E"]);
});

test("options are ordered deterministically and never mutate the input", () => {
  const input = [
    { partId: "b", name: "Beta" },
    { partId: "a", name: "Alpha" },
  ];
  const snapshot = JSON.stringify(input);
  const options = toSerialPartOptions(input);
  assert.deepEqual(options.map((o) => o.label), ["Alpha", "Beta"]);
  assert.equal(JSON.stringify(input), snapshot);
});
