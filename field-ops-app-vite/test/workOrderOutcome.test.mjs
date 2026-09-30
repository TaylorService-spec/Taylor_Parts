// THE ONE WORK ORDER OUTCOME CLASSIFIER (domain/workOrderOutcome.js) and the message helpers that render it.
//
// Owner ruling (Work Order cutover completion pass, 2026-09-30): UNAUTHORIZED, NOT_YET_ACTIVATED,
// INTEGRITY/INVALID_STATE and UNAVAILABLE are four different facts and are never presented as one generic error;
// the named boundaries (the Work Order authority, the Commercial fulfillment hold, Equipment install, a
// not-yet-served operation) and the inventory boundaries on successful results are said as themselves.
//
// Run: node --test test/workOrderOutcome.test.mjs   (also `npm test`)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyWorkOrderOutcome, workOrderOutcomeMessage, inventoryBoundaryCode, inventoryBoundaryMessage,
  WORK_ORDER_OUTCOME as O, WORK_ORDER_BOUNDARY as B, SERIALIZED_INSTALL_NOT_ACTIVATED,
} from "../src/domain/workOrderOutcome.js";
import { workOrderFailureCategory } from "../src/services/workOrderApiClient.js";
import { workflowActionErrorMessage } from "../src/domain/workflowActionError.js";
import { loadErrorMessage } from "../src/domain/loadErrorMessage.js";
import { schedulingRefusalMessage } from "../src/domain/schedulingRefusal.js";

/** A failure exactly as workOrderApiClient produces it from an HTTP status and the server's body code. */
const failure = (status, serverCode) => ({ ok: false, code: workOrderFailureCategory(status, serverCode), reason: serverCode, status });

test("THE FOUR CLASSES, from the governed transport's real (status, code) pairs", () => {
  const table = [
    [403, "CAPABILITY_MISSING", O.UNAUTHORIZED, null],
    [403, "NOT_ASSIGNED", O.UNAUTHORIZED, null],
    [401, "UNAUTHENTICATED", O.UNAUTHORIZED, null],
    [503, "NOT_ACTIVATED", O.NOT_YET_ACTIVATED, B.WORK_ORDER_AUTHORITY],
    [503, "SALES_ORDER_FULFILLMENT_AUTHORITY_UNAVAILABLE", O.NOT_YET_ACTIVATED, B.COMMERCIAL_FULFILLMENT_HOLD],
    [503, "NOT_YET_IMPLEMENTED", O.NOT_YET_ACTIVATED, B.OPERATION_NOT_YET_AVAILABLE],
    [409, "STALE_WORK_ORDER_STATE", O.INTEGRITY, null],
    [412, "WORK_ORDER_TERMINAL", O.INTEGRITY, null],
    [404, "WORK_ORDER_NOT_FOUND", O.INTEGRITY, null],
    [400, "INPUT_FIELD_NOT_ACCEPTED", O.INTEGRITY, null],
    [503, "SOME_DEPENDENCY_DOWN", O.UNAVAILABLE, null],
    [500, "INTERNAL", O.FAILED, null],
  ];
  for (const [status, code, kind, boundary] of table) {
    const o = classifyWorkOrderOutcome(failure(status, code));
    assert.equal(o.kind, kind, `${status} ${code}`);
    assert.equal(o.boundary, boundary, `${status} ${code} boundary`);
    assert.equal(o.reason, code);
  }
  for (const code of ["UNREACHABLE", "NOT_CONFIGURED"]) assert.equal(classifyWorkOrderOutcome({ code }).kind, O.UNAVAILABLE);
  assert.equal(classifyWorkOrderOutcome({ code: "NOT_SIGNED_IN" }).kind, O.UNAUTHORIZED);
});

test("the Commercial fulfillment hold is NOT an outage, although the server answers it with 503", () => {
  const f = failure(503, "SALES_ORDER_FULFILLMENT_AUTHORITY_UNAVAILABLE");
  assert.equal(f.code, "UNAVAILABLE", "the transport category alone would call it an outage");
  assert.equal(classifyWorkOrderOutcome(f).kind, O.NOT_YET_ACTIVATED);
  const m = workflowActionErrorMessage(f);
  assert.match(m, /on hold/i);
  assert.match(m, /Sales Order/);
  assert.match(m, /Commercial fulfillment is not activated/i);
  assert.doesNotMatch(m, /temporarily unavailable|try again/i);
  assert.match(m, /Nothing was changed\.$/);
});

test("Equipment install: its own boundary, 'Equipment install is not activated yet'", () => {
  for (const shape of [{ ...SERIALIZED_INSTALL_NOT_ACTIVATED }, { code: "failed-precondition", reason: "SERIALIZED_INSTALL_NOT_ACTIVATED" }]) {
    const o = classifyWorkOrderOutcome(shape);
    assert.deepEqual([o.kind, o.boundary], [O.NOT_YET_ACTIVATED, B.SERIALIZED_INSTALL]);
    assert.match(workOrderOutcomeMessage(o), /^Equipment install is not activated yet\./);
  }
});

test("Firebase-shaped codes classify through the same table (namespaced or bare)", () => {
  assert.equal(classifyWorkOrderOutcome({ code: "functions/permission-denied" }).kind, O.UNAUTHORIZED);
  assert.equal(classifyWorkOrderOutcome({ code: "failed-precondition" }).kind, O.INTEGRITY);
  assert.equal(classifyWorkOrderOutcome({ code: "firestore/unavailable" }).kind, O.UNAVAILABLE);
  assert.equal(classifyWorkOrderOutcome({ code: "internal" }).kind, O.FAILED);
  assert.equal(classifyWorkOrderOutcome(null).kind, O.FAILED);
  assert.equal(classifyWorkOrderOutcome(new Error("boom")).kind, O.FAILED);
});

test("NO TWO CLASSES SHARE A SENTENCE -- in either mode", () => {
  const samples = [failure(403, "CAPABILITY_MISSING"), failure(503, "NOT_ACTIVATED"), failure(409, "STALE_WORK_ORDER_STATE"),
    failure(503, "DOWN"), failure(500, "INTERNAL")];
  for (const mode of ["action", "load"]) {
    const messages = samples.map((f) => workOrderOutcomeMessage(classifyWorkOrderOutcome(f), { mode, entity: "work orders" }));
    assert.equal(new Set(messages).size, samples.length, `${mode}: ${messages.join(" | ")}`);
  }
  const boundaries = [B.WORK_ORDER_AUTHORITY, B.COMMERCIAL_FULFILLMENT_HOLD, B.SERIALIZED_INSTALL, B.OPERATION_NOT_YET_AVAILABLE]
    .map((boundary) => workOrderOutcomeMessage({ kind: O.NOT_YET_ACTIVATED, boundary }));
  assert.equal(new Set(boundaries).size, 4, "each named boundary has its own copy");
});

test("the message helpers all render the classifier: action, load, scheduling", () => {
  assert.match(workflowActionErrorMessage(failure(403, "CAPABILITY_MISSING")), /not allowed/i);
  assert.match(workflowActionErrorMessage(failure(412, "WORK_ORDER_TERMINAL")), /isn't valid/i);
  assert.match(workflowActionErrorMessage(failure(503, "DOWN")), /temporarily unavailable/i);
  assert.match(workflowActionErrorMessage(failure(503, "NOT_ACTIVATED")), /NOT_YET_ACTIVATED/);
  assert.match(workflowActionErrorMessage(failure(503, "NOT_YET_IMPLEMENTED")), /not available on EOS yet/i);
  assert.match(loadErrorMessage(failure(503, "NOT_ACTIVATED"), { entity: "work orders" }), /No work orders are shown/);
  assert.match(loadErrorMessage(failure(403, "CAPABILITY_MISSING"), { entity: "work orders" }), /permission to view these work orders/);
  assert.match(loadErrorMessage(failure(409, "STALE"), { entity: "work orders" }), /Couldn't load work orders: .*Refresh/);
  assert.match(loadErrorMessage(failure(503, "DOWN")), /reach the server/);
  // Scheduling: a code the board does not name is classified, not folded into "could not be completed".
  assert.match(schedulingRefusalMessage("NOT_YET_IMPLEMENTED", "UNAVAILABLE"), /not available on EOS yet/i);
  assert.match(schedulingRefusalMessage("SALES_ORDER_FULFILLMENT_AUTHORITY_UNAVAILABLE", "UNAVAILABLE"), /on hold/i);
  assert.match(schedulingRefusalMessage("SOMETHING_DOWN", "UNAVAILABLE"), /temporarily unavailable/i);
  assert.match(schedulingRefusalMessage(null, "internal"), /could not be completed/, "the unknown fallback is unchanged");
  assert.match(schedulingRefusalMessage("DOUBLE_BOOKED", "CONFLICT"), /already on an active work order/, "named codes still win");
});

test("INVENTORY BOUNDARIES on successful results: each said, the long server string reduced to its code, unknowns not guessed", () => {
  const server = {
    RESERVE_NOT_APPLIED: "RESERVE_NOT_APPLIED: Firebase reserves the planned parts on DISPATCHED; the PostgreSQL Inventory commitment authority is not activated, so this dispatch reserves nothing",
    CONSUME_NOT_APPLIED: "CONSUME_NOT_APPLIED: Firebase consumes qtyUsed ?? qtyPlanned on COMPLETED; ...",
    RELEASE_NOT_APPLIED: "RELEASE_NOT_APPLIED: Firebase releases outstanding reservations on CANCELLED; ...",
    NO_STOCK_MOVEMENT: "NO_STOCK_MOVEMENT",
  };
  for (const [code, value] of Object.entries(server)) {
    assert.equal(inventoryBoundaryCode(value), code);
    const m = inventoryBoundaryMessage(value);
    assert.match(m, /not activated on EOS yet\.$/, code);
    assert.doesNotMatch(m, /Firebase|qtyUsed|_NOT_APPLIED/, "never the server's internal wording");
  }
  assert.match(inventoryBoundaryMessage("CONSUME_NOT_APPLIED"), /^Completed\. No stock was consumed/);
  assert.match(inventoryBoundaryMessage("RESERVE_NOT_APPLIED"), /^Dispatched\. No parts were reserved/);
  assert.match(inventoryBoundaryMessage("INVENTORY_READINESS"), /not checked against live stock/);
  for (const v of [null, undefined, "", "SOMETHING_ELSE: x", 42]) assert.equal(inventoryBoundaryMessage(v), null);
});

test("the module is dependency-free (node-importable, no Firebase, no React)", () => {
  const src = readFileSync(new URL("../src/domain/workOrderOutcome.js", import.meta.url), "utf8");
  assert.equal(/^import /m.test(src), false);
});
