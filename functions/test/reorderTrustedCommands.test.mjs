// Workstream 2B — the trusted reorder command core (Owner rulings R-13 / R-15 / R-16).
//
// OFFLINE. No emulator, no Firebase, no network — the pure builders are exercised directly, which is
// why the callable keeps nothing in it but I/O.
//
// The test list is the ruling's own list, plus the two things it singled out: a client-supplied
// company must be REFUSED rather than ignored, and the PO/ORDERED atomicity invariant that migrated
// out of Firestore Rules must be shown to be intact in its new home.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateReorderRequest,
  buildRecordReorderPurchaseOrder,
  commandFingerprint,
  ReorderCommandError,
  PO_RECORDABLE_STATUS,
} from "../lib/reorderRequest/reorderCommands.js";

const CTX = { actorUid: "uid-associate", nowMillis: 1_756_000_000_000 };
// R-17 added `warehouseInScope`, and made it required rather than defaulting -- a caller that
// forgets it fails to compile. These cases are about the OTHER refusals, so the warehouse is in
// scope here; the scope predicate itself, and the invariant binding it to the picker, are
// reorderWarehouseEligibility.test.mjs's subject.
const governed = (companyId) => ({ ...CTX, warehouseGoverned: true, warehouseCompanyId: companyId, warehouseInScope: true });

const VALID = {
  partId: "PRT-1001",
  warehouseId: "wh-main",
  recommendationStatus: "READY",
  requestedQty: 4,
  quantitySource: "RECOMMENDED",
};

const caught = (fn) => {
  try { fn(); } catch (e) { return e; }
  assert.fail("expected a throw");
};

// =========================== warehouse -> company derivation ===========================

test("a governed warehouse gives the request its company", () => {
  const built = buildCreateReorderRequest(VALID, governed("taylor"));
  assert.equal(built.warehouseId, "wh-main");
  assert.equal(built.operatingCompanyId, "taylor");
  const ventana = buildCreateReorderRequest({ ...VALID, warehouseId: "wh-north" }, governed("ventana"));
  assert.equal(ventana.operatingCompanyId, "ventana");
});

test("warehouse missing / not governed / no company are three DISTINCT refusals", () => {
  assert.equal(caught(() => buildCreateReorderRequest({ ...VALID, warehouseId: "" }, governed("taylor"))).code, "WAREHOUSE_REQUIRED");
  assert.equal(
    caught(() => buildCreateReorderRequest(VALID, { ...CTX, warehouseGoverned: false, warehouseCompanyId: "taylor", warehouseInScope: true })).code,
    "WAREHOUSE_NOT_GOVERNED",
  );
  // A governed warehouse with no company still refuses -- it does not fall back to anything.
  assert.equal(caught(() => buildCreateReorderRequest(VALID, governed(undefined))).code, "WAREHOUSE_NO_COMPANY");
  // An ungoverned company id on the warehouse is refused too: storage does not confer governance.
  assert.equal(caught(() => buildCreateReorderRequest(VALID, governed("acme"))).code, "WAREHOUSE_NO_COMPANY");
  assert.equal(caught(() => buildCreateReorderRequest(VALID, governed("TAYLOR"))).code, "WAREHOUSE_NO_COMPANY");
});

test("THE BOUNDARY: a client-supplied operatingCompanyId is REFUSED, not ignored", () => {
  // Ruling refinement. Ignoring it would let a caller believe it had set the company and be
  // silently wrong; the refusal is what makes the boundary visible from the API.
  const err = caught(() =>
    buildCreateReorderRequest({ ...VALID, operatingCompanyId: "ventana" }, governed("taylor")),
  );
  assert.ok(err instanceof ReorderCommandError);
  assert.equal(err.code, "COMPANY_NOT_CLIENT_SUPPLIABLE");

  // Refused even when it AGREES with the derived value -- agreement is luck, not authority.
  assert.equal(
    caught(() => buildCreateReorderRequest({ ...VALID, operatingCompanyId: "taylor" }, governed("taylor"))).code,
    "COMPANY_NOT_CLIENT_SUPPLIABLE",
  );
  // And refused ahead of other payload errors, so the boundary is what the caller sees.
  assert.equal(
    caught(() => buildCreateReorderRequest({ ...VALID, partId: "", operatingCompanyId: "taylor" }, governed("taylor"))).code,
    "COMPANY_NOT_CLIENT_SUPPLIABLE",
  );
});

test("the requester is the ACTOR and is not the owner", () => {
  const built = buildCreateReorderRequest(VALID, governed("taylor"));
  assert.equal(built.requestedBy, "uid-associate");
  // Company responsibility came from the warehouse, not from who asked.
  assert.equal(built.operatingCompanyId, "taylor");
  assert.notEqual(built.requestedBy, built.operatingCompanyId);
});

test("free text cannot influence warehouse or company", () => {
  // A note mentioning a warehouse is display prose. The census found exactly this trap in seeded
  // reviewNotes, and nothing in the command reads it.
  const built = buildCreateReorderRequest(
    { ...VALID, warehouseId: "wh-north", quantitySource: "reviewNotes say wh-main" },
    governed("ventana"),
  );
  assert.equal(built.warehouseId, "wh-north");
  assert.equal(built.operatingCompanyId, "ventana");
});

test("the state machine is preserved exactly, not redesigned", () => {
  assert.equal(buildCreateReorderRequest(VALID, governed("taylor")).status, "READY_FOR_PARTS_MANAGER");
  assert.equal(
    buildCreateReorderRequest({ ...VALID, recommendationStatus: "NEEDS_PLANNING", requestedQty: 3 }, governed("taylor")).status,
    "PENDING_REVIEW",
  );
  assert.equal(buildCreateReorderRequest(VALID, governed("taylor")).currentOwner, "INVENTORY");
  // NEEDS_PLANNING still requires a positive manual quantity.
  assert.equal(
    caught(() => buildCreateReorderRequest({ ...VALID, recommendationStatus: "NEEDS_PLANNING", requestedQty: 0 }, governed("taylor"))).code,
    "QUANTITY_INVALID",
  );
});

// =========================== record purchase order ===========================

const REQUEST = { status: PO_RECORDABLE_STATUS, partId: "PRT-1001", operatingCompanyId: "taylor" };
const PO_INPUT = {
  reorderRequestId: "req-1",
  supplierName: "Arctic Parts Supply",
  externalPoNumber: "po-9001",
  orderedQuantity: 4,
  orderedDate: "2026-08-30",
  // FIN-BLOCK-003A activation: a committed purchase order now carries its price. Added to the SHARED
  // fixture rather than to individual cases because every test below is about something else —
  // pairing, company inheritance, supplier identity, field validation — and each needs a valid
  // commitment to exercise it. The price requirement itself is proven in
  // acquisitionCostActivation.test.mjs, where it is the subject rather than a precondition.
  unitPriceMinor: 2500,
  currency: "USD",
};
const poCtx = { ...CTX, purchaseOrderExists: false };

test("R-16: the PO and the ORDERED transition are produced TOGETHER, never separately", () => {
  const { purchaseOrder, requestPatch } = buildRecordReorderPurchaseOrder(PO_INPUT, REQUEST, poCtx);
  // One builder, both halves. A caller cannot obtain one without the other, which is what makes the
  // migrated invariant hard to break by accident rather than merely documented.
  assert.equal(purchaseOrder.status, "ORDERED");
  assert.equal(requestPatch.status, "ORDERED");
  // Identity unchanged: PO id == request id, pinned on both sides.
  assert.equal(purchaseOrder.reorderRequestId, "req-1");
  assert.equal(requestPatch.purchaseOrderId, "req-1");
  assert.equal(purchaseOrder.createdAt, requestPatch.orderedAt);
  assert.equal(purchaseOrder.createdBy, requestPatch.orderedBy);
});

test("the PO INHERITS the request's company and takes no client input", () => {
  assert.equal(buildRecordReorderPurchaseOrder(PO_INPUT, REQUEST, poCtx).purchaseOrder.operatingCompanyId, "taylor");
  assert.equal(
    buildRecordReorderPurchaseOrder(PO_INPUT, { ...REQUEST, operatingCompanyId: "ventana" }, poCtx).purchaseOrder.operatingCompanyId,
    "ventana",
  );
  assert.equal(
    caught(() => buildRecordReorderPurchaseOrder({ ...PO_INPUT, operatingCompanyId: "ventana" }, REQUEST, poCtx)).code,
    "COMPANY_NOT_CLIENT_SUPPLIABLE",
  );
});

test("a request with no governed company cannot produce a PO", () => {
  assert.equal(caught(() => buildRecordReorderPurchaseOrder(PO_INPUT, { ...REQUEST, operatingCompanyId: undefined }, poCtx)).code, "REQUEST_NO_COMPANY");
  // A legacy row -- exactly the six that exist in sandbox today -- refuses rather than inventing one.
  assert.equal(caught(() => buildRecordReorderPurchaseOrder(PO_INPUT, { status: PO_RECORDABLE_STATUS, partId: "PRT-1001" }, poCtx)).code, "REQUEST_NO_COMPANY");
});

test("state and 1:1 identity are still enforced", () => {
  assert.equal(caught(() => buildRecordReorderPurchaseOrder(PO_INPUT, null, poCtx)).code, "REQUEST_NOT_FOUND");
  assert.equal(caught(() => buildRecordReorderPurchaseOrder(PO_INPUT, { ...REQUEST, status: "ORDERED" }, poCtx)).code, "REQUEST_STATE_INVALID");
  assert.equal(caught(() => buildRecordReorderPurchaseOrder(PO_INPUT, { ...REQUEST, status: "PENDING_REVIEW" }, poCtx)).code, "REQUEST_STATE_INVALID");
  // 1:1 -- a second PO for the same request is refused. Identity already makes it impossible; this
  // says so with a reason rather than failing on a document collision.
  assert.equal(
    caught(() => buildRecordReorderPurchaseOrder(PO_INPUT, REQUEST, { ...poCtx, purchaseOrderExists: true })).code,
    "PO_ALREADY_EXISTS",
  );
});

test("supplier stays free text and is required -- the identity decision is separate", () => {
  assert.equal(caught(() => buildRecordReorderPurchaseOrder({ ...PO_INPUT, supplierName: "  " }, REQUEST, poCtx)).code, "SUPPLIER_REQUIRED");
  // supplierName passes through verbatim. This command must not be the vehicle that quietly settles
  // the supplierId question (ruling: keep the seams separate).
  const built = buildRecordReorderPurchaseOrder(PO_INPUT, REQUEST, poCtx).purchaseOrder;
  assert.equal(built.supplierName, "Arctic Parts Supply");
  assert.ok(!("supplierId" in built));
});

test("PO field validation is unchanged from the retired Rules branch", () => {
  assert.equal(caught(() => buildRecordReorderPurchaseOrder({ ...PO_INPUT, orderedQuantity: 0 }, REQUEST, poCtx)).code, "PO_FIELD_INVALID");
  assert.equal(caught(() => buildRecordReorderPurchaseOrder({ ...PO_INPUT, externalPoNumber: "" }, REQUEST, poCtx)).code, "PO_FIELD_INVALID");
  assert.equal(caught(() => buildRecordReorderPurchaseOrder({ ...PO_INPUT, orderedDate: "" }, REQUEST, poCtx)).code, "PO_FIELD_INVALID");
  // expectedArrivalDate is optional but, when supplied, must be real.
  assert.equal(buildRecordReorderPurchaseOrder(PO_INPUT, REQUEST, poCtx).purchaseOrder.expectedArrivalDate, null);
  assert.equal(caught(() => buildRecordReorderPurchaseOrder({ ...PO_INPUT, expectedArrivalDate: " " }, REQUEST, poCtx)).code, "PO_FIELD_INVALID");
});

// =========================== idempotency fingerprint ===========================

test("the idempotency key is bound to WHAT IT SAID, so a changed payload cannot replay", () => {
  const a = commandFingerprint(["PRT-1001", "wh-main", "READY", 4, "RECOMMENDED", null]);
  const same = commandFingerprint(["PRT-1001", "wh-main", "READY", 4, "RECOMMENDED", null]);
  assert.equal(a, same, "an identical payload must fingerprint identically, so a true retry replays");

  // Each field that changes the record changes the fingerprint -- otherwise a materially different
  // retry would be silently accepted as the original, which the ruling forbids.
  for (const changed of [
    ["PRT-2001", "wh-main", "READY", 4, "RECOMMENDED", null],
    ["PRT-1001", "wh-north", "READY", 4, "RECOMMENDED", null],
    ["PRT-1001", "wh-main", "NEEDS_PLANNING", 4, "RECOMMENDED", null],
    ["PRT-1001", "wh-main", "READY", 5, "RECOMMENDED", null],
    ["PRT-1001", "wh-main", "READY", 4, "MANUAL_ZERO_HISTORY", null],
    ["PRT-1001", "wh-main", "READY", 4, "RECOMMENDED", "wo-1"],
  ]) {
    assert.notEqual(commandFingerprint(changed), a, `changing a governed field must change the fingerprint: ${changed.join()}`);
  }

  // A null field and an empty-string field must not collide into the same fingerprint.
  assert.notEqual(commandFingerprint(["a", null]), commandFingerprint(["a", ""]));
});

test("fields are SEPARATED, so a value cannot shift across a boundary and replay", () => {
  // Concatenation would make these identical, and a retry that moved a character from one field to
  // the next would then replay as though it were the original command.
  assert.notEqual(commandFingerprint(["ab", "c"]), commandFingerprint(["a", "bc"]));
  assert.notEqual(commandFingerprint(["wh", "main"]), commandFingerprint(["whmain", ""]));
});
