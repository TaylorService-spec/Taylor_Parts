// Enterprise Inventory -- EI-P1c-3. Deterministic pure unit tests for the SERIAL
// transfer-LINE membership contract (src/domain/transferLine.js). Proves: collision-safe
// doc key; line shape (only {transferOrderId, serialNo, state}); canonical-key + stored-id
// guards; composeLineTransferRef returns the parent transferRef unchanged; add/remove
// pre-dispatch legality (REQUESTED, no OUT, no other active membership); and the full
// planned-vs-actual reconciliation matrix. SERIAL only; no quantities/custody/stock math.
//
// Run: node test/transferLine.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  TRANSFER_LINE_STATES,
  TRANSFER_LINE_RECON_STATES,
  transferLineDocKey,
  validateTransferLine,
  composeLineTransferRef,
  validateAddLine,
  validateRemoveLine,
  reconcileTransferLines,
} from "../src/domain/transferLine.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

const ORIGIN = { type: "WAREHOUSE", locationId: "WH-1" };
const DEST = { type: "MOBILE", locationId: "TRUCK-7" };
const PART = { partId: "PART-1", trackingMode: "SERIAL" };
const ref = (over = {}) => ({ transferOrderId: "TO-1", partId: "PART-1", origin: ORIGIN, destination: DEST, status: "REQUESTED", ...over });
const line = (over = {}) => ({ transferOrderId: "TO-1", serialNo: "SN-9", state: "PLANNED", ...over });
const KEY = transferLineDocKey("TO-1", "SN-9");

const outEv = (serialNo, over = {}) => ({
  type: "TRANSFER_OUT", partId: "PART-1", location: ORIGIN, counterpartyLocation: DEST, quantity: 1, serialNo,
  sourceObject: { type: "TRANSFER_ORDER", id: "TO-1" }, idempotencyKey: "o-" + serialNo, actor: { kind: "USER", id: "u" }, occurredAt: 1730000000000, ...over,
});
const inEv = (serialNo, over = {}) => ({
  type: "TRANSFER_IN", partId: "PART-1", location: DEST, counterpartyLocation: ORIGIN, quantity: 1, serialNo,
  sourceObject: { type: "TRANSFER_ORDER", id: "TO-1" }, idempotencyKey: "i-" + serialNo, actor: { kind: "USER", id: "u" }, occurredAt: 1730000001000, ...over,
});

// --- enums ---
ok("stored + derived state enums", () => {
  assert.deepEqual(TRANSFER_LINE_STATES, ["PLANNED", "CANCELLED"]);
  assert.deepEqual(TRANSFER_LINE_RECON_STATES, ["PLANNED", "IN_TRANSIT", "RECEIVED", "MISSING", "UNEXPECTED"]);
});

// --- collision-safe doc key ---
ok("transferLineDocKey is deterministic and collision-safe (delimiter cannot collide)", () => {
  assert.equal(transferLineDocKey("TO-1", "SN-9"), transferLineDocKey("TO-1", "SN-9"));
  // Raw `a__b`+`c` vs `a`+`b__c` would collide under naive concatenation; these must differ.
  assert.notEqual(transferLineDocKey("a__b", "c"), transferLineDocKey("a", "b__c"));
  assert.notEqual(transferLineDocKey("a-b", "c"), transferLineDocKey("a", "b-c"));
  // No raw "/", "." or reserved "__" leaks into the key.
  const k = transferLineDocKey("a/b.c", "d__e");
  assert.equal(/[/.]/.test(k), false);
  assert.equal(k.includes("__"), false);
  assert.equal(transferLineDocKey("", "x"), null);
  assert.equal(transferLineDocKey("x", ""), null);
});

// --- validateTransferLine ---
ok("validateTransferLine: valid line -> only {transferOrderId, serialNo, state}", () => {
  const r = validateTransferLine(KEY, line(), ref(), PART);
  assert.deepEqual(r, { valid: true, value: { transferOrderId: "TO-1", serialNo: "SN-9", state: "PLANNED" }, reason: null });
});

ok("validateTransferLine: doc id must be the canonical composite key", () => {
  assert.equal(validateTransferLine("WRONG-KEY", line(), ref(), PART).reason, "doc_key_mismatch");
  assert.equal(validateTransferLine("", line(), ref(), PART).reason, "doc_id_invalid");
});

ok("validateTransferLine: authority + shape guards", () => {
  assert.equal(validateTransferLine(KEY, line({ id: "OTHER" }), ref(), PART).reason, "stored_id_conflict");
  assert.equal(validateTransferLine(KEY, line({ partId: "PART-1" }), ref(), PART).reason, "unknown_field"); // no partId on a line
  assert.equal(validateTransferLine(KEY, line({ origin: ORIGIN }), ref(), PART).reason, "unknown_field");   // no endpoints on a line
  assert.equal(validateTransferLine(KEY, line({ state: "IN_TRANSIT" }), ref(), PART).reason, "state_invalid");
  assert.equal(validateTransferLine(transferLineDocKey("TO-1", "SN-9"), line({ transferOrderId: "OTHER" }), ref(), PART).reason, "transfer_order_mismatch");
  assert.equal(validateTransferLine(KEY, null, ref(), PART).reason, "not_object");
  assert.equal(validateTransferLine(KEY, line(), ref(), { partId: "PART-1", trackingMode: "LOT" }).reason, "unsupported_tracking_mode");
  assert.equal(validateTransferLine(KEY, line(), ref(), { partId: "OTHER", trackingMode: "SERIAL" }).reason, "part_mismatch");
  assert.equal(validateTransferLine(KEY, line(), ref({ status: "NOPE" }), PART).reason, "transfer_ref_status_invalid");
});

// --- composeLineTransferRef ---
ok("composeLineTransferRef: returns the parent transferRef unchanged", () => {
  const r = composeLineTransferRef(line(), ref());
  assert.equal(r.valid, true);
  assert.deepEqual(r.value, { transferOrderId: "TO-1", partId: "PART-1", origin: ORIGIN, destination: DEST, status: "REQUESTED" });
  assert.equal(composeLineTransferRef({ transferOrderId: "OTHER", serialNo: "S" }, ref()).reason, "transfer_order_mismatch");
  assert.equal(composeLineTransferRef({}, ref()).reason, "line_invalid");
});

// --- validateAddLine ---
ok("validateAddLine: legal only REQUESTED + no OUT + no other active membership", () => {
  assert.deepEqual(validateAddLine(line(), ref(), {}).value, { transferOrderId: "TO-1", serialNo: "SN-9", state: "PLANNED" });
  assert.equal(validateAddLine(line(), ref({ status: "IN_TRANSIT" }), {}).reason, "status_forbids_add");
  assert.equal(validateAddLine(line(), ref({ status: "COMPLETED" }), {}).reason, "status_forbids_add");
  assert.equal(validateAddLine(line(), ref(), { serialHasOutEvent: true }).reason, "already_dispatched");
  assert.equal(validateAddLine(line(), ref(), { activeMemberships: [{ transferOrderId: "TO-2" }] }).reason, "duplicate_active_membership");
  assert.equal(validateAddLine(line(), ref(), { activeMemberships: ["TO-1"] }).reason, "already_member");
  assert.equal(validateAddLine(line(), ref(), { activeMemberships: [{}] }).reason, "active_memberships_invalid");
  assert.equal(validateAddLine(line({ state: "CANCELLED" }), ref(), {}).reason, "state_invalid");
});

// --- validateRemoveLine ---
ok("validateRemoveLine: legal only REQUESTED + no OUT -> CANCELLED", () => {
  assert.deepEqual(validateRemoveLine(line(), ref(), {}).value, { transferOrderId: "TO-1", serialNo: "SN-9", state: "CANCELLED" });
  assert.equal(validateRemoveLine(line(), ref({ status: "IN_TRANSIT" }), {}).reason, "status_forbids_remove");
  assert.equal(validateRemoveLine(line(), ref(), { serialHasOutEvent: true }).reason, "already_dispatched");
});

// --- reconcileTransferLines: matrix ---
ok("reconcile: REQUESTED + planned/no events -> PLANNED", () => {
  const r = reconcileTransferLines({ transferRef: ref({ status: "REQUESTED" }), lines: [line({ serialNo: "SN-1" }), line({ serialNo: "SN-2" })], events: [], part: PART });
  assert.equal(r.valid, true);
  assert.deepEqual(r.states, [{ serialNo: "SN-1", reconState: "PLANNED" }, { serialNo: "SN-2", reconState: "PLANNED" }]);
});

ok("reconcile: IN_TRANSIT + OUT-only -> IN_TRANSIT; planned/no OUT -> MISSING", () => {
  const r = reconcileTransferLines({
    transferRef: ref({ status: "IN_TRANSIT" }),
    lines: [line({ serialNo: "SN-1" }), line({ serialNo: "SN-2" })],
    events: [outEv("SN-1")],
    part: PART,
  });
  assert.deepEqual(r.states, [{ serialNo: "SN-1", reconState: "IN_TRANSIT" }, { serialNo: "SN-2", reconState: "MISSING" }]);
});

ok("reconcile: COMPLETED + OUT+IN -> RECEIVED; planned/no OUT -> MISSING", () => {
  const r = reconcileTransferLines({
    transferRef: ref({ status: "COMPLETED" }),
    lines: [line({ serialNo: "SN-1" }), line({ serialNo: "SN-2" })],
    events: [outEv("SN-1"), inEv("SN-1")],
    part: PART,
  });
  assert.deepEqual(r.states, [{ serialNo: "SN-1", reconState: "RECEIVED" }, { serialNo: "SN-2", reconState: "MISSING" }]);
});

ok("reconcile: event for a serial with no planned line -> UNEXPECTED", () => {
  const r = reconcileTransferLines({
    transferRef: ref({ status: "IN_TRANSIT" }),
    lines: [line({ serialNo: "SN-1" })],
    events: [outEv("SN-1"), outEv("SN-2")],
    part: PART,
  });
  assert.deepEqual(r.states, [{ serialNo: "SN-1", reconState: "IN_TRANSIT" }, { serialNo: "SN-2", reconState: "UNEXPECTED" }]);
});

ok("reconcile: events for a CANCELLED line fail closed", () => {
  const r = reconcileTransferLines({
    transferRef: ref({ status: "IN_TRANSIT" }),
    lines: [line({ serialNo: "SN-1", state: "CANCELLED" })],
    events: [outEv("SN-1")],
    part: PART,
  });
  assert.equal(r.reason, "events_for_cancelled_line");
});

ok("reconcile: movement forbidden under REQUESTED / CANCELLED order", () => {
  assert.equal(reconcileTransferLines({ transferRef: ref({ status: "REQUESTED" }), lines: [line({ serialNo: "SN-1" })], events: [outEv("SN-1")], part: PART }).reason, "status_forbids_movement");
  assert.equal(reconcileTransferLines({ transferRef: ref({ status: "CANCELLED" }), lines: [line({ serialNo: "SN-1" })], events: [outEv("SN-1")], part: PART }).reason, "status_forbids_movement");
});

ok("reconcile: structural event failures fail closed", () => {
  const base = { transferRef: ref({ status: "IN_TRANSIT" }), lines: [line({ serialNo: "SN-1" })], part: PART };
  assert.equal(reconcileTransferLines({ ...base, events: [outEv("SN-1"), outEv("SN-1", { idempotencyKey: "o2" })] }).reason, "duplicate_out");
  assert.equal(reconcileTransferLines({ transferRef: ref({ status: "COMPLETED" }), lines: [line({ serialNo: "SN-1" })], part: PART, events: [outEv("SN-1"), inEv("SN-1"), inEv("SN-1", { idempotencyKey: "i2" })] }).reason, "duplicate_in");
  assert.equal(reconcileTransferLines({ ...base, events: [inEv("SN-1")] }).reason, "in_without_out");
  assert.equal(reconcileTransferLines({ ...base, events: [outEv("SN-1", { quantity: 2 })] }).reason, "event_quantity_invalid");
  assert.equal(reconcileTransferLines({ ...base, events: [outEv("SN-1", { sourceObject: { type: "TRANSFER_ORDER", id: "OTHER" } })] }).reason, "transfer_order_mismatch");
  assert.equal(reconcileTransferLines({ ...base, events: [outEv("SN-1", { location: DEST, counterpartyLocation: ORIGIN })] }).reason, "endpoint_mismatch");
  assert.equal(reconcileTransferLines({ transferRef: ref({ status: "COMPLETED" }), lines: [line({ serialNo: "SN-1" })], part: PART, events: [outEv("SN-1", { occurredAt: 1730000002000 }), inEv("SN-1", { occurredAt: 1730000001000 })] }).reason, "out_of_order");
});

ok("reconcile: bad plan / input fail closed", () => {
  assert.equal(reconcileTransferLines({ transferRef: ref({ status: "IN_TRANSIT" }), lines: [line({ serialNo: "SN-1" }), line({ serialNo: "SN-1" })], events: [], part: PART }).reason, "duplicate_line");
  assert.equal(reconcileTransferLines({ transferRef: ref(), lines: [{ transferOrderId: "TO-1", serialNo: "", state: "PLANNED" }], events: [], part: PART }).reason, "line_invalid");
  assert.equal(reconcileTransferLines({ transferRef: ref(), lines: "nope", events: [], part: PART }).reason, "input_invalid");
  assert.equal(reconcileTransferLines({ transferRef: ref(), lines: [], events: [], part: { partId: "PART-1", trackingMode: "NONE" } }).reason, "unsupported_tracking_mode");
});

ok("reconcile: does not mutate inputs", () => {
  const t = ref({ status: "IN_TRANSIT" }), l = [line({ serialNo: "SN-1" })], e = [outEv("SN-1")], p = { ...PART };
  const st = structuredClone(t), sl = structuredClone(l), se = structuredClone(e), sp = structuredClone(p);
  reconcileTransferLines({ transferRef: t, lines: l, events: e, part: p });
  assert.deepEqual(t, st);
  assert.deepEqual(l, sl);
  assert.deepEqual(e, se);
  assert.deepEqual(p, sp);
});

console.log(`\n${passed} passed`);
