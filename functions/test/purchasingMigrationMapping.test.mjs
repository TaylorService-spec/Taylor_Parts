// The PURE proofs for the legacy purchasing -> eos_ops mapping contract.
//
// No database, no Firebase, no clock. What is proved here is that the mapper REFUSES the shapes that
// would launder purchasing governance out of the record, and that every refusal is typed and
// attributable rather than a silent drop.
import test from "node:test";
import assert from "node:assert/strict";
import {
  mapLegacyReorderRequest,
  mapLegacyPurchaseOrder,
  mapLegacyPurchaseOrderVoid,
  mapLegacyReceivingOrder,
  mapLegacyTransferOrder,
  reconcileTransferOrderMigration,
  PURCHASING_REFUSAL_CODES,
} from "../lib/eosOps/migration/purchasingMigrationMapping.js";

// OPAQUE keys. Nothing in this contract may depend on which operating companies a deployment has.
const CO_A = "oc-alpha";
const CO_B = "oc-beta";
// A canonical Part.partId, per partMaster/validation.ts's parsePartId.
const PART = "PRT-000123";

const shapeOnlyPartId = (v) => {
  if (typeof v !== "string" || v.trim() === "") throw new Error("part id refused");
  return v;
};
const opts = { partIdAuthority: shapeOnlyPartId };

const refusalCode = (result) => {
  assert.equal(result.ok, false, `expected a refusal, got ${JSON.stringify(result)}`);
  assert.ok(PURCHASING_REFUSAL_CODES.includes(result.code), `unstable refusal code ${result.code}`);
  return result.code;
};

// ============================ canonical fixtures ============================

const reorderRequestDoc = (over = {}) => ({
  operatingCompanyId: CO_A,
  partId: PART,
  warehouseId: "wh-1",
  status: "PURCHASING_IN_PROGRESS",
  requestedQty: 4,
  recommendedQty: 6,
  requestedBy: "u-1",
  ...over,
});

const purchaseOrderDoc = (id, over = {}) => ({
  reorderRequestId: id,
  operatingCompanyId: CO_A,
  partId: PART,
  supplierName: "Acme Supply",
  externalPoNumber: "PO-9911",
  orderedQuantity: 4,
  orderedDate: "2026-03-04",
  createdBy: "u-1",
  ...over,
});

const voidDoc = (id, over = {}) => ({
  reorderRequestId: id,
  reorderPurchaseOrderId: id,
  operatingCompanyId: CO_A,
  partId: PART,
  reason: "supplier cancelled the order",
  voidedBy: "u-2",
  ...over,
});

const receivingDoc = (over = {}) => ({
  operatingCompanyId: CO_A,
  source: { type: "REORDER_PURCHASE_ORDER", purchaseOrderId: "rr-1", reorderRequestId: "rr-1" },
  receivingLocation: { type: "WAREHOUSE", locationId: "wh-1" },
  status: "PUTAWAY_COMPLETE",
  idempotencyKey: "idem-1",
  createdBy: "u-3",
  lines: [{ lineId: "L1", partId: PART, trackingMode: "NONE", expectedQuantity: 4, receivedQuantity: 4 }],
  ...over,
});

const transferDoc = (over = {}) => ({
  sourceOperatingCompanyId: CO_A,
  destinationOperatingCompanyId: CO_A,
  partId: PART,
  trackingMode: "NONE",
  quantity: 2,
  origin: { type: "WAREHOUSE", locationId: "wh-1" },
  destination: { type: "WAREHOUSE", locationId: "wh-2" },
  status: "REQUESTED",
  idempotencyKey: "idem-t1",
  createdBy: "u-4",
  ...over,
});

// ============================ the company is never inferred ============================

test("a reorder request with no operating company is REFUSED, not defaulted", () => {
  const missing = mapLegacyReorderRequest("rr-1", reorderRequestDoc({ operatingCompanyId: undefined }), opts);
  assert.equal(refusalCode(missing), "MISSING_OPERATING_COMPANY");

  const malformed = mapLegacyReorderRequest("rr-1", reorderRequestDoc({ operatingCompanyId: "Taylor Inc." }), opts);
  assert.equal(refusalCode(malformed), "INVALID_OPERATING_COMPANY");
});

test("a governed reorder request maps, carrying its company unchanged", () => {
  const result = mapLegacyReorderRequest("rr-1", reorderRequestDoc(), opts);
  assert.equal(result.ok, true);
  assert.equal(result.row.operatingCompanyKey, CO_A);
  assert.equal(result.row.id, "rr-1");
  assert.equal(result.row.status, "PURCHASING_IN_PROGRESS");
});

test("an unknown reorder request status fails closed", () => {
  const result = mapLegacyReorderRequest("rr-1", reorderRequestDoc({ status: "PARTIALLY_RECEIVED" }), opts);
  assert.equal(refusalCode(result), "UNKNOWN_STATUS");
});

// ============================ PO id == request id ============================

test("the purchase order's three statements of identity must all agree", () => {
  const ok = mapLegacyPurchaseOrder("rr-1", purchaseOrderDoc("rr-1"), { ...opts, requestBackLink: "rr-1" });
  assert.equal(ok.ok, true);
  assert.equal(ok.row.id, "rr-1");

  // stored reorderRequestId disagrees with the document id
  const drifted = mapLegacyPurchaseOrder("rr-1", purchaseOrderDoc("rr-OTHER"), opts);
  assert.equal(refusalCode(drifted), "PO_IDENTITY_MISMATCH");

  // the REQUEST's back-link names a different purchase order
  const backLink = mapLegacyPurchaseOrder("rr-1", purchaseOrderDoc("rr-1"), { ...opts, requestBackLink: "rr-2" });
  assert.equal(refusalCode(backLink), "PO_IDENTITY_MISMATCH");

  // no reorderRequestId at all -- the target column cannot be filled from nothing
  const absent = mapLegacyPurchaseOrder("rr-1", purchaseOrderDoc("rr-1", { reorderRequestId: undefined }), opts);
  assert.equal(refusalCode(absent), "PO_IDENTITY_MISMATCH");
});

test("an absent back-link is not checked -- an import may map a PO without its request loaded", () => {
  const result = mapLegacyPurchaseOrder("rr-1", purchaseOrderDoc("rr-1"), opts);
  assert.equal(result.ok, true);
});

// ============================ the price authority ============================

test("a purchase order that claims the price authority but carries no price is REFUSED", () => {
  const result = mapLegacyPurchaseOrder("rr-1", purchaseOrderDoc("rr-1", { priceAuthorityVersion: 2 }), opts);
  assert.equal(refusalCode(result), "PO_PRICE_MISSING");
});

test("a pre-authority purchase order with no stamp and no price still maps", () => {
  const result = mapLegacyPurchaseOrder("rr-1", purchaseOrderDoc("rr-1"), opts);
  assert.equal(result.ok, true);
  assert.equal(result.row.unitPriceMinor, null);
  assert.equal(result.row.currency, null);
  assert.equal(result.row.priceAuthorityVersion, null);
});

test("explicit zero is a committed price and is NOT the same as absent", () => {
  const result = mapLegacyPurchaseOrder(
    "rr-1",
    purchaseOrderDoc("rr-1", { unitPriceMinor: 0, currency: "USD", priceAuthorityVersion: 2 }),
    opts,
  );
  assert.equal(result.ok, true);
  assert.equal(result.row.unitPriceMinor, 0);
  assert.equal(result.row.currency, "USD");
});

test("an amount without a currency, and a float amount, are both refused", () => {
  assert.equal(
    refusalCode(mapLegacyPurchaseOrder("rr-1", purchaseOrderDoc("rr-1", { unitPriceMinor: 1250 }), opts)),
    "INVALID_PRICE",
  );
  assert.equal(
    refusalCode(mapLegacyPurchaseOrder("rr-1", purchaseOrderDoc("rr-1", { unitPriceMinor: 12.5, currency: "USD" }), opts)),
    "INVALID_PRICE",
  );
});

test("a date that is not an ISO calendar day is refused, never coerced", () => {
  for (const bad of ["03/04/2026", "2026-02-31", "March 4 2026", "2026-03-04T00:00:00Z"]) {
    assert.equal(
      refusalCode(mapLegacyPurchaseOrder("rr-1", purchaseOrderDoc("rr-1", { orderedDate: bad }), opts)),
      "INVALID_DATE",
      `expected ${bad} to be refused`,
    );
  }
});

// ============================ the void record ============================

test("a void record's document id, reorderRequestId and reorderPurchaseOrderId must all name one record", () => {
  const ok = mapLegacyPurchaseOrderVoid("rr-1", voidDoc("rr-1"), opts);
  assert.equal(ok.ok, true);
  assert.equal(ok.row.purchaseOrderId, "rr-1");

  const drifted = mapLegacyPurchaseOrderVoid("rr-1", voidDoc("rr-1", { reorderPurchaseOrderId: "rr-2" }), opts);
  assert.equal(refusalCode(drifted), "PO_IDENTITY_MISMATCH");
});

test("a void with no stated reason records nothing and is refused", () => {
  const blank = mapLegacyPurchaseOrderVoid("rr-1", voidDoc("rr-1", { reason: "   " }), opts);
  assert.equal(refusalCode(blank), "MISSING_REQUIRED_TEXT");
});

// ============================ receiving ============================

test("the legacy receipt's identity equation holds in both directions", () => {
  const ok = mapLegacyReceivingOrder("rcv-1", receivingDoc(), opts);
  assert.equal(ok.ok, true);
  assert.equal(ok.row.reorderRequestId, "rr-1");

  const mismatched = mapLegacyReceivingOrder("rcv-1", receivingDoc({
    source: { type: "REORDER_PURCHASE_ORDER", purchaseOrderId: "rr-1", reorderRequestId: "rr-2" },
  }), opts);
  assert.equal(refusalCode(mismatched), "RECEIVING_SOURCE_IDENTITY_MISMATCH");

  const canonicalWithRequest = mapLegacyReceivingOrder("rcv-1", receivingDoc({
    source: { type: "PURCHASE_ORDER", purchaseOrderId: "po-9", reorderRequestId: "po-9" },
  }), opts);
  assert.equal(refusalCode(canonicalWithRequest), "RECEIVING_SOURCE_IDENTITY_MISMATCH");
});

test("a canonical receipt carries no reorder request -- absence is the true statement", () => {
  const result = mapLegacyReceivingOrder("rcv-1", receivingDoc({
    source: { type: "PURCHASE_ORDER", purchaseOrderId: "po-9" },
  }), opts);
  assert.equal(result.ok, true);
  assert.equal(result.row.reorderRequestId, null);
});

test("the receiving source kind is stated, never sniffed", () => {
  const result = mapLegacyReceivingOrder("rcv-1", receivingDoc({
    source: { type: "SUPPLIER_SHIPMENT", purchaseOrderId: "po-9" },
  }), opts);
  assert.equal(refusalCode(result), "UNKNOWN_RECEIVING_SOURCE");
});

test("a NONE line carrying serials, and a SERIAL line whose count disagrees, are both refused", () => {
  const noneWithSerials = mapLegacyReceivingOrder("rcv-1", receivingDoc({
    lines: [{ lineId: "L1", partId: PART, trackingMode: "NONE", expectedQuantity: 1, receivedQuantity: 1, serialNumbers: ["S1"] }],
  }), opts);
  assert.equal(refusalCode(noneWithSerials), "INVALID_SERIAL_SET");

  const serialCountOff = mapLegacyReceivingOrder("rcv-1", receivingDoc({
    lines: [{ lineId: "L1", partId: PART, trackingMode: "SERIAL", expectedQuantity: 2, receivedQuantity: 2, serialNumbers: ["S1"] }],
  }), opts);
  assert.equal(refusalCode(serialCountOff), "INVALID_SERIAL_SET");
});

test("the same line twice in one receipt is ambiguous and is refused", () => {
  const result = mapLegacyReceivingOrder("rcv-1", receivingDoc({
    lines: [
      { lineId: "L1", partId: PART, trackingMode: "NONE", expectedQuantity: 2, receivedQuantity: 2 },
      { lineId: "L1", partId: PART, trackingMode: "NONE", expectedQuantity: 2, receivedQuantity: 1 },
    ],
  }), opts);
  assert.equal(refusalCode(result), "INVALID_RECEIPT_LINES");
});

// ============================ the transfer order's directional pair ============================

test("a half-pair is REFUSED, never completed from the other half", () => {
  const noDestination = mapLegacyTransferOrder("trf-1", transferDoc({ destinationOperatingCompanyId: undefined }), opts);
  assert.equal(refusalCode(noDestination), "MISSING_PARTICIPATING_COMPANY");

  const noSource = mapLegacyTransferOrder("trf-1", transferDoc({ sourceOperatingCompanyId: undefined }), opts);
  assert.equal(refusalCode(noSource), "MISSING_PARTICIPATING_COMPANY");
});

test("a scalar owner on a transfer order is a contradiction and is refused", () => {
  const result = mapLegacyTransferOrder("trf-1", transferDoc({ operatingCompanyId: CO_A }), opts);
  assert.equal(refusalCode(result), "MISSING_PARTICIPATING_COMPANY");
});

test("equal keys are a pair stated twice, not a scalar to collapse", () => {
  const result = mapLegacyTransferOrder("trf-1", transferDoc(), opts);
  assert.equal(result.ok, true);
  assert.equal(result.row.sourceOperatingCompanyKey, CO_A);
  assert.equal(result.row.destinationOperatingCompanyKey, CO_A);
});

test("a cross-company transfer carries both keys, in direction order", () => {
  const result = mapLegacyTransferOrder("trf-1", transferDoc({ destinationOperatingCompanyId: CO_B }), opts);
  assert.equal(result.ok, true);
  assert.equal(result.row.sourceOperatingCompanyKey, CO_A);
  assert.equal(result.row.destinationOperatingCompanyKey, CO_B);
});

// ============================ retiring the legacy warehouse scalars ============================

test("agreeing legacy scalars are reconciled, reported, and then dropped", () => {
  const result = mapLegacyTransferOrder("trf-1", transferDoc({ fromWarehouseId: "wh-1", toWarehouseId: "wh-2" }), opts);
  assert.equal(result.ok, true);
  assert.equal(result.row.legacyWarehouseScalarsDropped, true);
  // The target row has no column for them -- the typed endpoints are the only representation left.
  assert.equal("fromWarehouseId" in result.row, false);
  assert.equal("toWarehouseId" in result.row, false);
  assert.equal(result.row.originLocationId, "wh-1");
  assert.equal(result.row.destinationLocationId, "wh-2");
});

test("a disagreement between the legacy scalars and the typed endpoints is REFUSED, not discarded", () => {
  const result = mapLegacyTransferOrder("trf-1", transferDoc({ fromWarehouseId: "wh-1", toWarehouseId: "wh-999" }), opts);
  assert.equal(refusalCode(result), "LEGACY_ENDPOINT_DISAGREEMENT");
});

test("half a legacy pair proves nothing and is refused", () => {
  const result = mapLegacyTransferOrder("trf-1", transferDoc({ fromWarehouseId: "wh-1" }), opts);
  assert.equal(refusalCode(result), "LEGACY_ENDPOINT_DISAGREEMENT");
});

test("legacy scalars on a non-WAREHOUSE transfer are refused rather than reconciled", () => {
  const result = mapLegacyTransferOrder("trf-1", transferDoc({
    destination: { type: "MOBILE", locationId: "truck-7" },
    fromWarehouseId: "wh-1",
    toWarehouseId: "truck-7",
  }), opts);
  assert.equal(refusalCode(result), "LEGACY_ENDPOINT_DISAGREEMENT");
});

test("a MOBILE endpoint with no legacy scalars maps cleanly -- the typed refs are total", () => {
  const result = mapLegacyTransferOrder("trf-1", transferDoc({
    destination: { type: "MOBILE", locationId: "truck-7" },
  }), opts);
  assert.equal(result.ok, true);
  assert.equal(result.row.destinationLocationType, "MOBILE");
  assert.equal(result.row.legacyWarehouseScalarsDropped, false);
});

test("a non-physical endpoint type is refused, never mapped to a closest physical place", () => {
  for (const type of ["VENDOR", "CUSTOMER", "VIRTUAL"]) {
    const result = mapLegacyTransferOrder("trf-1", transferDoc({ destination: { type, locationId: "x" } }), opts);
    assert.equal(refusalCode(result), "INVALID_LOCATION", `expected ${type} to be refused`);
  }
});

test("a transfer between one place and itself moves nothing and is refused", () => {
  const result = mapLegacyTransferOrder("trf-1", transferDoc({
    destination: { type: "WAREHOUSE", locationId: "wh-1" },
  }), opts);
  assert.equal(refusalCode(result), "TRANSFER_ENDPOINTS_IDENTICAL");
});

// ============================ the part-id contract is the DEFAULT ============================

test("with no injected authority, a non-canonical part id is refused", () => {
  const result = mapLegacyTransferOrder("trf-1", transferDoc({ partId: "3/4 inch elbow" }));
  assert.equal(refusalCode(result), "INVALID_PART_ID");
});

test("with no injected authority, a canonical Part.partId is accepted unchanged", () => {
  const result = mapLegacyTransferOrder("trf-1", transferDoc());
  assert.equal(result.ok, true);
  assert.equal(result.row.partId, PART);
});

// ============================ reconciliation ============================

test("every source record lands in exactly one bucket", () => {
  const results = [
    mapLegacyTransferOrder("t1", transferDoc(), opts),
    mapLegacyTransferOrder("t2", transferDoc({ destinationOperatingCompanyId: CO_B }), opts),
    mapLegacyTransferOrder("t3", transferDoc({ fromWarehouseId: "wh-1", toWarehouseId: "wh-2" }), opts),
    mapLegacyTransferOrder("t4", transferDoc({ fromWarehouseId: "wh-1", toWarehouseId: "wh-999" }), opts),
    mapLegacyTransferOrder("t5", transferDoc({ sourceOperatingCompanyId: undefined }), opts),
  ];
  const recon = reconcileTransferOrderMigration(results);
  assert.equal(recon.total, 5);
  assert.equal(recon.mapped + recon.refused, recon.total);
  assert.equal(recon.mapped, 3);
  assert.equal(recon.refused, 2);
  assert.equal(recon.crossCompany, 1);
  assert.equal(recon.sameCompany, 2);
  assert.equal(recon.legacyScalarsReconciledAndDropped, 1);
  assert.deepEqual(recon.refusalsByCode, {
    LEGACY_ENDPOINT_DISAGREEMENT: 1,
    MISSING_PARTICIPATING_COMPANY: 1,
  });
});

test("the refusal taxonomy has no duplicate codes", () => {
  assert.equal(new Set(PURCHASING_REFUSAL_CODES).size, PURCHASING_REFUSAL_CODES.length);
});

// ============================ the restated command constants stay pinned ============================

test("the repository's PO_RECORDABLE_STATUS equals the command core's, and the vocabularies match", async () => {
  // purchasingRepository.ts may not import the Firebase-adjacent command core, so it restates two
  // constants. Restating is only safe while something proves the copies equal -- otherwise the
  // Postgres authority would drift from the command that writes it and nothing would say so.
  const repo = await import("../lib/eosOps/purchasingRepository.js");
  const commands = await import("../lib/reorderRequest/reorderCommands.js");
  assert.equal(repo.PO_RECORDABLE_STATUS, commands.PO_RECORDABLE_STATUS);

  const mapping = await import("../lib/eosOps/migration/purchasingMigrationMapping.js");
  // The mapper's target vocabulary and the repository's must be the same set, in the same order:
  // they describe one enum in one schema.
  assert.deepEqual([...mapping.OPS_REORDER_REQUEST_STATUSES], [...repo.REORDER_REQUEST_STATUSES]);
  assert.deepEqual([...mapping.OPS_RECEIVING_ORDER_STATUSES], [...repo.RECEIVING_ORDER_STATUSES]);
  assert.deepEqual([...mapping.OPS_RECEIVING_SOURCE_KINDS], [...repo.RECEIVING_SOURCE_KINDS]);
  assert.deepEqual([...mapping.OPS_TRANSFER_ORDER_STATUSES], [...repo.TRANSFER_ORDER_STATUSES]);
});
