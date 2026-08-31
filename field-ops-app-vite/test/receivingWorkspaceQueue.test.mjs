// Receiving North Star P1 frame 1a — the Awaiting-receipt queue view-model
// (domain/receivingWorkspaceQueue.js) and the workspace's source contracts.
//
// The queue is the union of the two EXISTING governed candidate reads with an explicit Journey
// column (RCV-D1). These tests pin the truth rules the design brief names:
//   - a failed read NEVER fabricates rows or downgrades to "empty"
//   - EMPTY is a claim only both-READY may make; DENIED / UNAVAILABLE / FAILED stay distinct
//   - one readable source renders as an explicitly INCOMPLETE queue, never a silently complete one
//   - no document id is ever promoted to an order reference (RCV-G5; RR numbering is unwired)
//   - no receipt progress is fabricated for rows the list read carries none for (RCV-G6)
// and the frame's no-new-authority contract: the module is pure, and the workspace component
// introduces no receipt mutation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  buildReceivingWorkspaceQueue,
  buildReorderQueueRow,
  buildSupplierQueueRow,
  describeSourceBlock,
  JOURNEY_WORDS,
  QUEUE_SOURCE_STATE,
  QUEUE_STATE,
  RECEIVING_JOURNEY,
} from "../src/domain/receivingWorkspaceQueue.js";
import { PURCHASE_ORDERS_STATUS } from "../src/domain/purchaseOrdersView.js";
import { RECEIVING_OUTCOME } from "../src/domain/receivingTransport.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(HERE, "..", p), "utf8");

// ── fixtures ────────────────────────────────────────────────────────────────────────────

const readyReorderView = (rows = []) => ({ status: PURCHASE_ORDERS_STATUS.READY, rows });
const readySupplierList = (purchaseOrders = []) => ({ status: RECEIVING_OUTCOME.READY, purchaseOrders });

const candidate = (over = {}) => ({
  isReceiptCandidate: true,
  reorderRequestId: "reorder-doc-8Zk2",
  partId: "X49463-3",
  externalPoNumber: "TP-88112",
  supplierName: "Taylor Distribution",
  orderedQuantity: 12,
  ...over,
});

const supplierPo = (over = {}) => ({
  purchaseOrderId: "fs-auto-id-9pQ7xW",
  supplierId: "sup-1",
  storedStatus: "SENT",
  lineCount: 6,
  ...over,
});

// ── the union, when both sources read ───────────────────────────────────────────────────

test("both sources READY → one queue, supplier sessions first, each row naming its journey", () => {
  const q = buildReceivingWorkspaceQueue({
    reorderView: readyReorderView([candidate()]),
    supplierList: readySupplierList([supplierPo()]),
    supplierNamesById: { "sup-1": "Taylor Distribution" },
  });
  assert.equal(q.state, QUEUE_STATE.READY);
  assert.equal(q.rows.length, 2);
  assert.equal(q.rows[0].journey, RECEIVING_JOURNEY.SUPPLIER);
  assert.equal(q.rows[0].journeyWords, JOURNEY_WORDS.SUPPLIER);
  assert.equal(q.rows[1].journey, RECEIVING_JOURNEY.REORDER);
  assert.equal(q.rows[1].journeyWords, JOURNEY_WORDS.REORDER);
  assert.equal(q.notices.length, 0);
});

test("both READY with zero rows is the ONLY way to reach EMPTY", () => {
  const q = buildReceivingWorkspaceQueue({ reorderView: readyReorderView(), supplierList: readySupplierList() });
  assert.equal(q.state, QUEUE_STATE.EMPTY);
});

test("non-candidate reorder rows (RECEIVED / VOIDED / ORPHAN) are never reclassified into the queue", () => {
  const q = buildReceivingWorkspaceQueue({
    reorderView: readyReorderView([candidate({ isReceiptCandidate: false })]),
    supplierList: readySupplierList(),
  });
  assert.equal(q.state, QUEUE_STATE.EMPTY);
  assert.equal(q.rows.length, 0);
});

// ── truth ladder: loading / empty / denied / unavailable / failed stay distinct ─────────

test("either source still loading → LOADING, no rows shown early", () => {
  const q = buildReceivingWorkspaceQueue({
    reorderView: { status: PURCHASE_ORDERS_STATUS.LOADING, rows: [] },
    supplierList: readySupplierList([supplierPo()]),
  });
  assert.equal(q.state, QUEUE_STATE.LOADING);
  assert.equal(q.rows.length, 0);
});

test("MUTATION PROOF: a failed read never becomes an empty queue", () => {
  // If someone 'simplifies' the ladder so a failure falls through to EMPTY, this fails.
  const q = buildReceivingWorkspaceQueue({
    reorderView: { status: PURCHASE_ORDERS_STATUS.BLOCKED_UNAVAILABLE, rows: [] },
    supplierList: { status: RECEIVING_OUTCOME.UNAVAILABLE, purchaseOrders: [] },
  });
  assert.notEqual(q.state, QUEUE_STATE.EMPTY);
  assert.equal(q.rows.length, 0);
  assert.equal(q.notices.length, 2);
});

test("both DENIED → DENIED; both transport-unavailable → UNAVAILABLE; mixed → FAILED with each source's own sentence", () => {
  const denied = buildReceivingWorkspaceQueue({
    reorderView: { status: PURCHASE_ORDERS_STATUS.BLOCKED_PERMISSION, rows: [] },
    supplierList: { status: RECEIVING_OUTCOME.DENIED, purchaseOrders: [] },
  });
  assert.equal(denied.state, QUEUE_STATE.DENIED);

  const unavailable = buildReceivingWorkspaceQueue({
    // The reorder read has no transport-off state; only the supplier callable does — so
    // whole-queue UNAVAILABLE requires both, and this mixed case must be FAILED instead.
    reorderView: { status: PURCHASE_ORDERS_STATUS.BLOCKED_UNAVAILABLE, rows: [] },
    supplierList: { status: RECEIVING_OUTCOME.UNAVAILABLE, purchaseOrders: [] },
  });
  assert.equal(unavailable.state, QUEUE_STATE.FAILED);
  const sentences = unavailable.notices.map((n) => n.message).join(" ");
  assert.match(sentences, /not switched on/);
  assert.match(sentences, /could not be loaded/);
  assert.doesNotMatch(sentences, /not authorized/);
});

test("one source readable → READY_PARTIAL: the rows show AND the unread source is disclosed", () => {
  const q = buildReceivingWorkspaceQueue({
    reorderView: readyReorderView([candidate()]),
    supplierList: { status: RECEIVING_OUTCOME.UNAVAILABLE, purchaseOrders: [] },
  });
  assert.equal(q.state, QUEUE_STATE.READY_PARTIAL);
  assert.equal(q.rows.length, 1);
  assert.equal(q.notices.length, 1);
  assert.equal(q.notices[0].journey, RECEIVING_JOURNEY.SUPPLIER);
  assert.match(q.notices[0].message, /cannot be read/);
});

test("READY_PARTIAL with zero readable rows still never claims empty", () => {
  const q = buildReceivingWorkspaceQueue({
    reorderView: readyReorderView([]),
    supplierList: { status: RECEIVING_OUTCOME.DENIED, purchaseOrders: [] },
  });
  assert.equal(q.state, QUEUE_STATE.READY_PARTIAL);
  assert.notEqual(q.state, QUEUE_STATE.EMPTY);
});

test("the three block sentences make three different claims", () => {
  const d = describeSourceBlock(RECEIVING_JOURNEY.SUPPLIER, QUEUE_SOURCE_STATE.DENIED);
  const u = describeSourceBlock(RECEIVING_JOURNEY.SUPPLIER, QUEUE_SOURCE_STATE.UNAVAILABLE);
  const f = describeSourceBlock(RECEIVING_JOURNEY.SUPPLIER, QUEUE_SOURCE_STATE.FAILED);
  assert.equal(new Set([d, u, f]).size, 3);
  assert.match(d, /not authorized/);
  assert.match(u, /not an empty list/);
});

// ── identity truth: no document id ever becomes a reference ─────────────────────────────

test("MUTATION PROOF: the canonical PO document id is never promoted to an order reference (RCV-G5)", () => {
  const row = buildSupplierQueueRow(supplierPo(), {});
  assert.equal(row.orderReference, null);
  // The id travels ONLY as the opaque navigation argument.
  assert.equal(row.open.purchaseOrderId, "fs-auto-id-9pQ7xW");
  for (const [k, v] of Object.entries(row)) {
    if (k === "open") continue;
    assert.notEqual(v, "fs-auto-id-9pQ7xW", `row.${k} must not carry the document id`);
  }
});

test("a reorder row renders its governed external PO number and NEVER the reorderRequestId", () => {
  const withNumber = buildReorderQueueRow(candidate());
  assert.equal(withNumber.orderReference, "TP-88112");

  const withoutNumber = buildReorderQueueRow(candidate({ externalPoNumber: null }));
  assert.equal(withoutNumber.orderReference, null, "absence is stated, not substituted");
  assert.equal(withoutNumber.open.reorderRequestId, "reorder-doc-8Zk2");
  for (const [k, v] of Object.entries(withoutNumber)) {
    if (k === "open") continue;
    assert.notEqual(v, "reorder-doc-8Zk2", `row.${k} must not carry the document id`);
  }
});

test("MUTATION PROOF: no RR-number is synthesized while the RR lane is unwired (RCV-G4)", () => {
  // The allocator exists but nothing calls it, so no reorder document carries a number — a queue
  // that prints one would be claiming numbering is live. Any RR-shaped string in a built row fails.
  const row = buildReorderQueueRow(candidate({ externalPoNumber: null }));
  const flat = JSON.stringify(row);
  assert.doesNotMatch(flat, /RR-\d{4}-\d{6}/);
});

test("supplier names resolve through the provided map and degrade to a stated absence — never the supplierId", () => {
  const resolved = buildSupplierQueueRow(supplierPo(), { "sup-1": "Taylor Distribution" });
  assert.equal(resolved.supplierName, "Taylor Distribution");
  const unresolved = buildSupplierQueueRow(supplierPo(), {});
  assert.equal(unresolved.supplierName, null);
  assert.notEqual(unresolved.supplierName, "sup-1");
});

test("canonical stored statuses map to words; an unknown stored value passes through verbatim", () => {
  assert.equal(buildSupplierQueueRow(supplierPo({ storedStatus: "SENT" }), {}).statusWords, "Sent to supplier");
  assert.equal(buildSupplierQueueRow(supplierPo({ storedStatus: "APPROVED" }), {}).statusWords, "Approved");
  assert.equal(buildSupplierQueueRow(supplierPo({ storedStatus: "SOMETHING_NEW" }), {}).statusWords, "SOMETHING_NEW");
});

// ── no fabricated progress (RCV-G6) ─────────────────────────────────────────────────────

test("rows carry NO receipt-progress claim — the list read does not expose one", () => {
  const rows = [buildSupplierQueueRow(supplierPo(), {}), buildReorderQueueRow(candidate())];
  for (const row of rows) {
    const flat = JSON.stringify(row);
    assert.doesNotMatch(flat, /progress|Not started|Partially received/i);
  }
});

// ── frame contracts: purity, and no new mutation path in the workspace ──────────────────

test("the queue view-model is pure — no service, firebase, or hook import", () => {
  const src = read("src/domain/receivingWorkspaceQueue.js");
  assert.doesNotMatch(src, /from "\.\.\/services\//);
  assert.doesNotMatch(src, /from "firebase/);
  assert.doesNotMatch(src, /from "react"/);
});

test("MUTATION PROOF: the Receiving workspace introduces no receipt mutation", () => {
  // Frame 1a is reads + navigation. The two journey components own the governed submits; the
  // workspace itself must import none of them. (The acquire dialog is composed, not reimplemented.)
  const src = read("src/modules/inventory/Receiving.jsx");
  assert.doesNotMatch(src, /submitReceiveInventoryStock|submitCanonicalReceive|submitReceive|acquireSerializedAsset/);
});

test("MUTATION PROOF: no scan/type-an-order-number entry returns without a governed identifier contract (RCV-G7)", () => {
  // No governed scan-identifier or business-number authority exists for canonical purchase orders
  // (RCV-G5). The workspace records the gap and offers no field claiming otherwise; reinstating one
  // without first removing the recorded gap fails here.
  const src = read("src/modules/inventory/Receiving.jsx");
  assert.match(src, /AUTHORITY GAP — DO NOT INVENT \(RCV-G7\)/);
  assert.doesNotMatch(src, /type its number/i);
  assert.doesNotMatch(src, /placeholder="Scan/i);
});

test("the workspace states the RCV-G1 receipt-history slot honestly and renders no receiving_orders read", () => {
  const src = read("src/modules/inventory/Receiving.jsx");
  assert.match(src, /Not connected yet/);
  // No direct Firestore read appears in the workspace — its reads are the existing hooks and the
  // governed callable client, so a list against the deny-all collection cannot be built here.
  assert.doesNotMatch(src, /firebase\/firestore|getDocs|onSnapshot/);
});
