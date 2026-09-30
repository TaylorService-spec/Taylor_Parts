// The technician's labor, field-context and readiness clients are on the governed EOS Work Order route
// (POST /operations/work-orders) -- the Firebase callables getWorkOrderLabor / recordWorkOrderLabor /
// getWorkOrderFieldContext / getWorkOrderReadinessContext are retired from the browser, with NO fallback.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchWorkOrderLabor, recordWorkOrderLabor } from "../src/services/workOrderLaborCallableClient.js";
import { interpretLaborResult, LABOR_SUBMIT } from "../src/domain/technicianLaborEntry.js";
import { WORK_ORDER_READ_OPERATIONS, WORK_ORDER_COMMAND_OPERATIONS } from "../src/services/workOrderApiClient.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const FIREBASE = /from\s+"[^"]*firebase[^"]*"|import\("firebase|httpsCallable/;

test("no Firebase import or callable name in any of the three clients", () => {
  for (const rel of ["../src/services/workOrderLaborCallableClient.js", "../src/hooks/useWorkOrderFieldContext.js",
    "../src/services/workOrderReadinessContextClient.js"]) {
    const src = read(rel);
    assert.doesNotMatch(src, FIREBASE, rel);
    assert.doesNotMatch(src, /"getWorkOrderLabor"|"getWorkOrderFieldContext"|"getWorkOrderReadinessContext"/, rel);
    assert.match(src, /workOrderApiClient\.js/, `${rel} goes through the governed route`);
  }
  assert.match(read("../src/hooks/useWorkOrderFieldContext.js"), /"readWorkOrderFieldContext", \{ workOrderId \}/,
    "the field context request carries workOrderId only");
});

test("the operation names are the server's reserved ones", () => {
  for (const op of ["readWorkOrderLabor", "readWorkOrderFieldContext", "readWorkOrderReadiness"]) assert.ok(WORK_ORDER_READ_OPERATIONS.includes(op));
  assert.ok(WORK_ORDER_COMMAND_OPERATIONS.includes("recordWorkOrderLabor"));
});

test("labor read: the result passes through; a refusal is a returned value with the server's reason", async () => {
  const seen = [];
  const ok = await fetchWorkOrderLabor({ workOrderId: "wo-1" }, { call: async (op, input) => {
    seen.push([op, input]);
    return { ok: true, result: { status: "ready", canRecord: true, totals: { totalMinutes: 90 } } };
  } });
  assert.deepEqual(seen, [["readWorkOrderLabor", { workOrderId: "wo-1" }]]);
  assert.deepEqual([ok.outcome.canRecord, ok.error], [true, null]);
  const denied = await fetchWorkOrderLabor({ workOrderId: "wo-1" }, { call: async () =>
    ({ ok: false, code: "FORBIDDEN", reason: "NOT_ASSIGNED", message: "this Work Order may not be read by this caller", status: 403 }) });
  assert.deepEqual(denied, { outcome: null, error: { code: "permission-denied", details: "NOT_ASSIGNED", message: "this Work Order may not be read by this caller" } });
});

test("labor record: RECORDED / REPLAYED become the words every consumer reads; refusals keep their codes", async () => {
  const request = { workOrderId: "wo-1", laborType: "ONSITE", entryKind: "DURATION", durationMinutes: 90, workDate: "2026-09-30", idempotencyKey: "k" };
  let sent;
  const recorded = await recordWorkOrderLabor(request, { call: async (op, input) => {
    sent = [op, input];
    return { ok: true, result: { outcome: "RECORDED", laborEntryId: "wol_1", durationMinutes: 90 } };
  } });
  assert.deepEqual(sent, ["recordWorkOrderLabor", request], "the payload is sent as built -- no technician or employee id is added");
  assert.equal(interpretLaborResult(recorded).status, LABOR_SUBMIT.SAVED);
  const replayed = await recordWorkOrderLabor(request, { call: async () => ({ ok: true, result: { outcome: "REPLAYED", laborEntryId: "wol_1" } }) });
  assert.equal(interpretLaborResult(replayed).message, "Already recorded.");
  const overlap = await recordWorkOrderLabor(request, { call: async () =>
    ({ ok: false, code: "PRECONDITION_FAILED", reason: "OVERLAPPING_ENTRY", message: "overlaps", status: 412 }) });
  assert.deepEqual([overlap.error.code, overlap.error.details], ["failed-precondition", "OVERLAPPING_ENTRY"]);
  assert.equal(interpretLaborResult(overlap).message, "That time overlaps labor you already recorded.");
  const notAssigned = interpretLaborResult(await recordWorkOrderLabor(request, { call: async () =>
    ({ ok: false, code: "FORBIDDEN", reason: "NOT_ASSIGNED", message: "x", status: 403 }) }));
  assert.equal(notAssigned.message, "This work order is not assigned to you.");
  const inactive = await recordWorkOrderLabor(request, { call: async () =>
    ({ ok: false, code: "NOT_ACTIVATED", reason: "NOT_ACTIVATED", message: "not activated", status: 503 }) });
  assert.equal(inactive.error.code, "unavailable", "not activated is a wait, never a refusal");
  assert.match(interpretLaborResult(inactive).message, /not activated/);
});

test("the Work Order detail page and Field Mode say the inventory boundary out loud", () => {
  assert.match(read("../src/modules/workOrders/WorkOrderDetailPage.jsx"), /Inventory readiness is not activated yet/);
  assert.match(read("../src/modules/mobile/FieldMode.jsx"), /Inventory readiness is not activated yet/);
});
