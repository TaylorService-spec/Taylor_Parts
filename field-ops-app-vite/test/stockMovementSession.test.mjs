// STOCK MOVEMENT SESSION — the pure multi-scan domain for BIN-P6 (Decision #170).
// Run: node --test test/stockMovementSession.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  deriveMoveRoute, MOVE_ROUTE, MOVE_ENDPOINT,
  buildMovementLines, LINE_STATE, canConfirm, freezeBatch,
  toRelocationRequest, toTransferRequest,
  classifyMovementError, FAILURE, isRetryable,
  resultFromResponse, resultFromError, LINE_RESULT, summarizeBatch, retryableLines,
} from "../src/domain/stockMovementSession.js";
import { createQueue, addScan, undoLastScan, removeEntry } from "../src/domain/scanObservationQueue.js";
import * as receivingQueue from "../src/domain/receivingScanQueue.js";
import { runBounded } from "../src/domain/boundedRun.js";

const WH = (id) => ({ type: MOVE_ENDPOINT.WAREHOUSE, locationId: id, custodyWarehouseId: id, label: id });
const BIN = (id, parent) => ({ type: MOVE_ENDPOINT.BIN, locationId: id, custodyWarehouseId: parent, label: id });
const TRUCK = (id) => ({ type: MOVE_ENDPOINT.MOBILE, locationId: id, custodyWarehouseId: null, label: id });
const tracking = new Map([["P-NONE", "NONE"], ["P-SER", "SERIAL"], ["P-LOT", "LOT"], ["P-DUAL", "UNKNOWN"]]);

// ================================ routing ================================
test("same custody parent is a relocation", () => {
  assert.equal(deriveMoveRoute(WH("wh1"), BIN("binA", "wh1")).route, MOVE_ROUTE.RELOCATION);
  assert.equal(deriveMoveRoute(BIN("binA", "wh1"), BIN("binB", "wh1")).route, MOVE_ROUTE.RELOCATION);
  assert.equal(deriveMoveRoute(BIN("binA", "wh1"), WH("wh1")).route, MOVE_ROUTE.RELOCATION);
});

test("a different parent, or any truck, is a transfer", () => {
  assert.equal(deriveMoveRoute(BIN("binA", "wh1"), WH("wh2")).route, MOVE_ROUTE.TRANSFER);
  assert.equal(deriveMoveRoute(BIN("binA", "wh1"), BIN("binC", "wh2")).route, MOVE_ROUTE.TRANSFER);
  assert.equal(deriveMoveRoute(BIN("binA", "wh1"), TRUCK("t7")).route, MOVE_ROUTE.TRANSFER);
  assert.equal(deriveMoveRoute(TRUCK("t7"), BIN("binA", "wh1")).route, MOVE_ROUTE.TRANSFER);
});

test("an unresolved custody parent is not guessed", () => {
  assert.deepEqual(deriveMoveRoute(BIN("binA", null), WH("wh1")), { route: MOVE_ROUTE.INVALID, reason: "custody_unresolved" });
  assert.equal(deriveMoveRoute(WH("wh1"), WH("wh1")).reason, "same_location");
  assert.equal(deriveMoveRoute(null, WH("wh1")).reason, "endpoint_missing");
});

// ================================ observations -> lines ================================
test("repeated NONE scans aggregate into ONE line, intentionally", () => {
  let q = createQueue();
  q = addScan(q, { partId: "P-NONE" });
  q = addScan(q, { partId: "P-NONE" });
  q = addScan(q, { partId: "P-NONE", quantity: 5 });
  const lines = buildMovementLines(q.observations, tracking);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 7);
  assert.equal(lines[0].state, LINE_STATE.READY);
});

test("rapid distinct scans all register as distinct lines", () => {
  let q = createQueue();
  for (const s of ["A", "B", "C"]) q = addScan(q, { partId: "P-SER", serialNo: s });
  const lines = buildMovementLines(q.observations, tracking);
  assert.deepEqual(lines.map((l) => l.serialNo), ["A", "B", "C"]);
  assert.ok(lines.every((l) => l.state === LINE_STATE.READY && l.quantity === 1));
});

test("a repeated serial is a duplicate and blocks, never silently merged", () => {
  let q = createQueue();
  q = addScan(q, { partId: "P-SER", serialNo: "SN-1" });
  q = addScan(q, { partId: "P-SER", serialNo: "SN-1" });
  const lines = buildMovementLines(q.observations, tracking);
  assert.deepEqual(lines.map((l) => l.state), [LINE_STATE.READY, LINE_STATE.DUPLICATE_SERIAL]);
  assert.equal(canConfirm(lines, { route: MOVE_ROUTE.RELOCATION }), false);
});

test("a serialized part without a serial, or a plain part with one, is explicit", () => {
  let q = createQueue();
  q = addScan(q, { partId: "P-SER" });
  q = addScan(q, { partId: "P-NONE", serialNo: "X" });
  q = addScan(q, { partId: "P-GHOST" });
  const lines = buildMovementLines(q.observations, tracking);
  assert.deepEqual(lines.map((l) => l.state), [LINE_STATE.SERIAL_REQUIRED, LINE_STATE.SERIAL_NOT_ALLOWED, LINE_STATE.PART_UNKNOWN]);
});

test("undo and remove correct observations without corrupting a total", () => {
  let q = createQueue();
  q = addScan(q, { partId: "P-NONE" });
  q = addScan(q, { partId: "P-NONE" });
  q = addScan(q, { partId: "P-NONE" });
  q = undoLastScan(q);
  q = removeEntry(q, q.observations[0].entryId);
  assert.equal(buildMovementLines(q.observations, tracking)[0].quantity, 1);
});

test("nothing confirms on an empty session or an invalid route", () => {
  assert.equal(canConfirm([], { route: MOVE_ROUTE.RELOCATION }), false);
  const lines = buildMovementLines(addScan(createQueue(), { partId: "P-NONE" }).observations, tracking);
  assert.equal(canConfirm(lines, { route: MOVE_ROUTE.INVALID }), false);
  assert.equal(canConfirm(lines, { route: MOVE_ROUTE.RELOCATION }), true);
});

test("lot-tracked and unmapped parts are refused before sending, never shown as ready", () => {
  let q = createQueue();
  q = addScan(q, { partId: "P-LOT" });
  q = addScan(q, { partId: "P-DUAL" });
  const lines = buildMovementLines(q.observations, tracking);
  assert.deepEqual(lines.map((l) => l.state), [LINE_STATE.UNSUPPORTED_TRACKING, LINE_STATE.UNSUPPORTED_TRACKING]);
  assert.equal(canConfirm(lines, { route: MOVE_ROUTE.RELOCATION }), false);
});

// ================================ one queue ================================
test("Receiving and movement use the SAME queue -- Receiving re-exports it unchanged", () => {
  assert.equal(receivingQueue.addScan, addScan);
  assert.equal(receivingQueue.createQueue, createQueue);
  const src = readFileSync(new URL("../src/domain/stockMovementSession.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /observations:\s*Object\.freeze\(\[/, "no second queue implementation");
});

// ================================ frozen batches and keys ================================
function batchOf(lines, batchNo = 1, route = MOVE_ROUTE.RELOCATION) {
  return freezeBatch({ sessionId: "sess1", batchNo, lines, source: WH("wh1"), destination: BIN("binA", "wh1"), route: { route } });
}

test("every line gets its own key, so no line can replay another's", () => {
  let q = createQueue();
  q = addScan(q, { partId: "P-NONE" });
  q = addScan(q, { partId: "P-SER", serialNo: "A" });
  q = addScan(q, { partId: "P-SER", serialNo: "B" });
  const keys = batchOf(buildMovementLines(q.observations, tracking)).lines.map((l) => l.idempotencyKey);
  assert.equal(new Set(keys).size, keys.length);
});

test("a later batch of the SAME part gets a NEW key -- it can never replay the earlier move", () => {
  const first = batchOf(buildMovementLines(addScan(createQueue(), { partId: "P-NONE", quantity: 4 }).observations, tracking), 1);
  const second = batchOf(buildMovementLines(addScan(createQueue(), { partId: "P-NONE", quantity: 3 }).observations, tracking), 2);
  assert.notEqual(first.lines[0].idempotencyKey, second.lines[0].idempotencyKey);
  assert.equal(first.lines[0].quantity, 4);
  assert.equal(second.lines[0].quantity, 3);
});

test("a frozen batch cannot be edited behind its keys", () => {
  const b = batchOf(buildMovementLines(addScan(createQueue(), { partId: "P-NONE" }).observations, tracking));
  assert.ok(Object.isFrozen(b) && Object.isFrozen(b.lines) && Object.isFrozen(b.lines[0]));
});

test("requests carry the operator's endpoints and the line's own key; the server decides the rest", () => {
  let q = createQueue();
  q = addScan(q, { partId: "P-NONE", quantity: 2 });
  q = addScan(q, { partId: "P-SER", serialNo: "A" });
  const b = batchOf(buildMovementLines(q.observations, tracking));
  assert.deepEqual(toRelocationRequest(b, b.lines[0], { recordPlacement: true }), {
    partId: "P-NONE", source: { type: "WAREHOUSE", locationId: "wh1" }, destination: { type: "BIN", locationId: "binA" },
    quantity: 2, idempotencyKey: b.lines[0].idempotencyKey, recordPlacement: true,
  });
  assert.deepEqual(toTransferRequest(b, b.lines[1]).serialNumbers, ["A"]);
  assert.equal("custodyWarehouseId" in toRelocationRequest(b, b.lines[0]).source, false, "no client-derived custody on the wire");
});

// ================================ failure vocabulary ================================
const httpsErr = (code, details) => Object.assign(new Error("x"), { code: `functions/${code}`, details });

test("every governed refusal keeps its own name", () => {
  assert.equal(classifyMovementError(httpsErr("failed-precondition", { code: "INSUFFICIENT_STOCK" })), FAILURE.INSUFFICIENT_STOCK);
  assert.equal(classifyMovementError(httpsErr("failed-precondition", { code: "CROSS_WAREHOUSE" })), FAILURE.CROSS_WAREHOUSE);
  assert.equal(classifyMovementError(httpsErr("failed-precondition", { code: "RETIRED_BIN" })), FAILURE.RETIRED_BIN);
  assert.equal(classifyMovementError(httpsErr("already-exists", { code: "IDEMPOTENCY_CONFLICT" })), FAILURE.IDEMPOTENCY_CONFLICT);
  assert.equal(classifyMovementError(httpsErr("failed-precondition", { code: "SAME_CUSTODY_PARENT" })), FAILURE.WRONG_ROUTE);
  assert.equal(classifyMovementError(httpsErr("permission-denied", { code: "DENIED" })), FAILURE.DENIED);
  assert.equal(classifyMovementError(httpsErr("unauthenticated")), FAILURE.UNAUTHENTICATED);
});

test("only a technical failure is retryable; a business refusal never loops", () => {
  assert.equal(isRetryable(classifyMovementError(httpsErr("unavailable", { code: "RETRYABLE_TECHNICAL_FAILURE" }))), true);
  assert.equal(isRetryable(classifyMovementError(new Error("network down"))), true);
  assert.equal(isRetryable(classifyMovementError(httpsErr("deadline-exceeded"))), true);
  assert.equal(isRetryable(FAILURE.INSUFFICIENT_STOCK), false);
  assert.equal(isRetryable(FAILURE.IDEMPOTENCY_CONFLICT), false);
});

// ================================ per-line truth ================================
test("partial success is reported per line; no aggregate success hides a failure", () => {
  let q = createQueue();
  for (const s of ["A", "B", "C"]) q = addScan(q, { partId: "P-SER", serialNo: s });
  const b = batchOf(buildMovementLines(q.observations, tracking));
  const results = {
    [b.lines[0].lineId]: resultFromResponse(b.lines[0], { outcome: "relocated" }),
    [b.lines[1].lineId]: resultFromError(b.lines[1], httpsErr("failed-precondition", { code: "SERIAL_NOT_AT_SOURCE" })),
    [b.lines[2].lineId]: resultFromError(b.lines[2], httpsErr("unavailable", { code: "RETRYABLE_TECHNICAL_FAILURE" })),
  };
  const s = summarizeBatch(b, results);
  assert.deepEqual({ applied: s.applied, failed: s.failed, retryable: s.retryable, complete: s.complete }, { applied: 1, failed: 2, retryable: 1, complete: false });
  assert.equal("success" in s, false, "there is no success flag to read instead of the counts");
  assert.deepEqual(retryableLines(b, results).map((l) => l.serialNo), ["C"], "only the technical failure is resent");
});

test("a replayed line is success, not a second movement", () => {
  const b = batchOf(buildMovementLines(addScan(createQueue(), { partId: "P-NONE" }).observations, tracking));
  const r = resultFromResponse(b.lines[0], { outcome: "replayed" });
  assert.equal(r.status, LINE_RESULT.REPLAYED);
  assert.equal(summarizeBatch(b, { [b.lines[0].lineId]: r }).complete, true);
});

test("a retry reuses the line's frozen key, so an applied line replays instead of moving twice", async () => {
  const seen = [];
  const b = batchOf(buildMovementLines(addScan(createQueue(), { partId: "P-NONE" }).observations, tracking));
  const send = async (req) => { seen.push(req.idempotencyKey); return { outcome: seen.length > 1 ? "replayed" : "relocated" }; };
  await send(toRelocationRequest(b, b.lines[0]));
  await send(toRelocationRequest(b, b.lines[0]));
  assert.equal(seen[0], seen[1]);
});

// ================================ bounded runner ================================
test("the shared bounded runner keeps order and never exceeds its bound", async () => {
  let live = 0, peak = 0;
  const out = await runBounded([5, 1, 3, 2], async (n) => {
    live += 1; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, n));
    live -= 1;
    return n * 10;
  }, 2);
  assert.deepEqual(out, [50, 10, 30, 20]);
  assert.ok(peak <= 2);
});
