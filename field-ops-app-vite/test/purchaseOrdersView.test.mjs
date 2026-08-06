// Purchasing > Purchase Orders (item C) -- deterministic OFFLINE tests for the
// pure Reorder Purchase Order view-model. Plain Node (house client-test
// convention: check()/passed counter). No Firebase, no credentials, no network:
// fixtures are hand-built reorder_requests + reorder_purchase_orders docs. This
// proves the pure composition, the receipt-candidate rule, the receipt-source
// descriptor, and the fail-closed BLOCKED ladder -- it deploys nothing and calls
// no Cloud Function.
import assert from "node:assert/strict";
import {
  buildPurchaseOrdersView,
  buildPurchaseOrderRow,
  buildReceiptSourceDescriptor,
  summarize,
  PURCHASE_ORDER_VIEW_STATUS,
  PURCHASE_ORDERS_STATUS,
} from "../src/domain/purchaseOrdersView.js";
import { REORDER_REQUEST_STATUS, PURCHASE_ORDER_STATUS } from "../src/domain/constants.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("purchaseOrdersView.test.mjs");

// ---- fixtures ---------------------------------------------------------------
const orderedRequest = (id, over = {}) => ({
  id,
  partId: `part-${id}`,
  status: REORDER_REQUEST_STATUS.ORDERED,
  purchaseOrderId: id,
  orderedBy: "uid-associate",
  orderedAt: 1000,
  ...over,
});
const poDoc = (id, over = {}) => ({
  reorderRequestId: id,
  partId: `part-${id}`,
  supplierName: "Acme Supply",
  externalPoNumber: `PO-${id}`,
  orderedQuantity: 5,
  orderedDate: "2026-08-01",
  expectedArrivalDate: "2026-08-10",
  status: PURCHASE_ORDER_STATUS.ORDERED,
  createdBy: "uid-associate",
  createdAt: 1000,
  ...over,
});

// ---- receipt-source descriptor ---------------------------------------------
check("buildReceiptSourceDescriptor: exact receiveInventoryStock source shape; purchaseOrderId == reorderRequestId", () => {
  assert.deepEqual(buildReceiptSourceDescriptor("r1"), {
    type: "REORDER_PURCHASE_ORDER",
    reorderRequestId: "r1",
    purchaseOrderId: "r1",
  });
});
check("buildReceiptSourceDescriptor: empty/non-string -> null (never a malformed source)", () => {
  assert.equal(buildReceiptSourceDescriptor(""), null);
  assert.equal(buildReceiptSourceDescriptor(undefined), null);
  assert.equal(buildReceiptSourceDescriptor(42), null);
});

// ---- single-row derivation --------------------------------------------------
check("row: ORDERED request + ORDERED PO -> OPEN, receipt candidate, carries descriptor + PO fields", () => {
  const row = buildPurchaseOrderRow(orderedRequest("r1"), poDoc("r1"));
  assert.equal(row.viewStatus, PURCHASE_ORDER_VIEW_STATUS.OPEN);
  assert.equal(row.isReceiptCandidate, true);
  assert.deepEqual(row.receiptSource, buildReceiptSourceDescriptor("r1"));
  assert.equal(row.supplierName, "Acme Supply");
  assert.equal(row.externalPoNumber, "PO-r1");
  assert.equal(row.orderedQuantity, 5);
  assert.equal(row.purchaseOrderId, "r1");
});
check("row: VOIDED request -> VOIDED, NOT a candidate, no descriptor", () => {
  const row = buildPurchaseOrderRow(orderedRequest("r1", { status: REORDER_REQUEST_STATUS.VOIDED }), poDoc("r1"));
  assert.equal(row.viewStatus, PURCHASE_ORDER_VIEW_STATUS.VOIDED);
  assert.equal(row.isReceiptCandidate, false);
  assert.equal(row.receiptSource, null);
});
check("row: RECEIVED request (legacy closeout) -> RECEIVED, NOT a candidate", () => {
  const row = buildPurchaseOrderRow(orderedRequest("r1", { status: REORDER_REQUEST_STATUS.RECEIVED }), poDoc("r1"));
  assert.equal(row.viewStatus, PURCHASE_ORDER_VIEW_STATUS.RECEIVED);
  assert.equal(row.isReceiptCandidate, false);
  assert.equal(row.receiptSource, null);
});
check("row: ORDERED request but missing/unreadable PO -> ORPHAN (surfaced, never dropped), not a candidate", () => {
  const row = buildPurchaseOrderRow(orderedRequest("r1"), null);
  assert.equal(row.viewStatus, PURCHASE_ORDER_VIEW_STATUS.ORPHAN);
  assert.equal(row.isReceiptCandidate, false);
  assert.equal(row.receiptSource, null);
  assert.equal(row.purchaseOrderId, null);
  // still shows request-level partId so the operator can chase the integrity gap
  assert.equal(row.partId, "part-r1");
});
check("row: ORDERED request + PO whose own status is NOT ORDERED -> ORPHAN, not a candidate", () => {
  const row = buildPurchaseOrderRow(orderedRequest("r1"), poDoc("r1", { status: "SOMETHING_ELSE" }));
  assert.equal(row.viewStatus, PURCHASE_ORDER_VIEW_STATUS.ORPHAN);
  assert.equal(row.isReceiptCandidate, false);
});
check("row: malformed request (no id) -> null (filtered out)", () => {
  assert.equal(buildPurchaseOrderRow({ status: "ORDERED" }, poDoc("r1")), null);
  assert.equal(buildPurchaseOrderRow(null, null), null);
});

// ---- full view + fail-closed ladder ----------------------------------------
check("view: LOADING request read -> LOADING, rows:[]", () => {
  const v = buildPurchaseOrdersView({ requestsRead: { data: [], loading: true, error: null } });
  assert.equal(v.status, PURCHASE_ORDERS_STATUS.LOADING);
  assert.deepEqual(v.rows, []);
});
check("view: permission-denied read -> BLOCKED_PERMISSION, rows:[] (never empty-success)", () => {
  const v = buildPurchaseOrdersView({ requestsRead: { data: [], loading: false, error: "permission-denied" } });
  assert.equal(v.status, PURCHASE_ORDERS_STATUS.BLOCKED_PERMISSION);
  assert.deepEqual(v.rows, []);
});
check("view: unavailable read -> BLOCKED_UNAVAILABLE", () => {
  const v = buildPurchaseOrdersView({ requestsRead: { data: [], loading: false, error: "unavailable" } });
  assert.equal(v.status, PURCHASE_ORDERS_STATUS.BLOCKED_UNAVAILABLE);
});
check("view: unknown error code still fails closed to BLOCKED_UNAVAILABLE", () => {
  const v = buildPurchaseOrdersView({ requestsRead: { data: [], loading: false, error: "unknown" } });
  assert.equal(v.status, PURCHASE_ORDERS_STATUS.BLOCKED_UNAVAILABLE);
});
check("view: READY empty -> rows:[], zeroed summary", () => {
  const v = buildPurchaseOrdersView({ requestsRead: { data: [], loading: false, error: null } });
  assert.equal(v.status, PURCHASE_ORDERS_STATUS.READY);
  assert.deepEqual(v.summary, { total: 0, open: 0, received: 0, voided: 0, orphan: 0, receiptCandidates: 0 });
});
check("view: composes rows, joins PO by id, sorts most-recent-first, counts candidates", () => {
  const requestsRead = {
    data: [orderedRequest("r1", { orderedAt: 1000 }), orderedRequest("r2", { orderedAt: 3000 }), orderedRequest("r3", { orderedAt: 2000, status: REORDER_REQUEST_STATUS.VOIDED })],
    loading: false,
    error: null,
  };
  const purchaseOrdersById = { r1: poDoc("r1"), r2: poDoc("r2"), r3: poDoc("r3") };
  const v = buildPurchaseOrdersView({ requestsRead, purchaseOrdersRead: { purchaseOrdersById, loading: false, error: null } });
  assert.equal(v.status, PURCHASE_ORDERS_STATUS.READY);
  assert.deepEqual(v.rows.map((r) => r.reorderRequestId), ["r2", "r3", "r1"]); // orderedAt desc
  assert.equal(v.summary.total, 3);
  assert.equal(v.summary.open, 2); // r1 + r2
  assert.equal(v.summary.voided, 1); // r3
  assert.equal(v.summary.receiptCandidates, 2);
  // only OPEN rows carry a descriptor
  const r2 = v.rows.find((r) => r.reorderRequestId === "r2");
  assert.deepEqual(r2.receiptSource, buildReceiptSourceDescriptor("r2"));
  const r3 = v.rows.find((r) => r.reorderRequestId === "r3");
  assert.equal(r3.receiptSource, null);
});
check("view: after a SUCCESSFUL PO read, an ORDERED request whose PO doc is genuinely absent -> ORPHAN, not dropped", () => {
  const requestsRead = { data: [orderedRequest("r1"), orderedRequest("r2")], loading: false, error: null };
  const purchaseOrdersById = { r1: poDoc("r1") }; // r2's PO genuinely missing (read succeeded)
  const v = buildPurchaseOrdersView({ requestsRead, purchaseOrdersRead: { purchaseOrdersById, loading: false, error: null } });
  assert.equal(v.rows.length, 2);
  assert.equal(v.summary.orphan, 1);
  assert.equal(v.summary.open, 1);
  assert.equal(v.summary.receiptCandidates, 1);
});

// ---- PO-read failure is PRESERVED and fails the surface closed (Codex correction) ----
check("view: PO read permission-denied -> BLOCKED_PERMISSION (never spurious ORPHAN)", () => {
  const requestsRead = { data: [orderedRequest("r1")], loading: false, error: null };
  const v = buildPurchaseOrdersView({ requestsRead, purchaseOrdersRead: { purchaseOrdersById: {}, loading: false, error: "permission-denied" } });
  assert.equal(v.status, PURCHASE_ORDERS_STATUS.BLOCKED_PERMISSION);
  assert.deepEqual(v.rows, []);
});
check("view: PO read unavailable -> BLOCKED_UNAVAILABLE", () => {
  const requestsRead = { data: [orderedRequest("r1")], loading: false, error: null };
  const v = buildPurchaseOrdersView({ requestsRead, purchaseOrdersRead: { purchaseOrdersById: {}, loading: false, error: "unavailable" } });
  assert.equal(v.status, PURCHASE_ORDERS_STATUS.BLOCKED_UNAVAILABLE);
});
check("view: PO read still loading -> LOADING (rows never flash as ORPHAN mid-fetch)", () => {
  const requestsRead = { data: [orderedRequest("r1")], loading: false, error: null };
  const v = buildPurchaseOrdersView({ requestsRead, purchaseOrdersRead: { purchaseOrdersById: {}, loading: true, error: null } });
  assert.equal(v.status, PURCHASE_ORDERS_STATUS.LOADING);
});
check("view: a permission error on EITHER read wins over unavailable on the other", () => {
  const requestsRead = { data: [], loading: false, error: "unavailable" };
  const v = buildPurchaseOrdersView({ requestsRead, purchaseOrdersRead: { purchaseOrdersById: {}, loading: false, error: "permission-denied" } });
  assert.equal(v.status, PURCHASE_ORDERS_STATUS.BLOCKED_PERMISSION);
});
check("view: malformed inputs fail closed (non-object requestsRead -> treated as empty, never throws)", () => {
  // A null read has no error and loading is falsy -> resolves to READY-empty. The
  // contract is only that it NEVER throws and returns a known status with rows:[].
  const v = buildPurchaseOrdersView({ requestsRead: null, purchaseOrdersById: null });
  assert.ok(Object.values(PURCHASE_ORDERS_STATUS).includes(v.status));
  assert.deepEqual(v.rows, []);
});

// ---- summarize --------------------------------------------------------------
check("summarize: non-array -> zeroed", () => {
  assert.deepEqual(summarize(undefined), { total: 0, open: 0, received: 0, voided: 0, orphan: 0, receiptCandidates: 0 });
});

console.log(`\n${passed} passed, 0 failed`);
