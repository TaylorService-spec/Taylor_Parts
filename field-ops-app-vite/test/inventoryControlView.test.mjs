// END-TO-END lifecycle verification for the Ventana ice-machine inventory-control view. Walks a
// serialized machine through the REAL authority states — RECEIVED → AVAILABLE → RESERVED → STAGED
// → LOADED → IN_TRANSIT → DELIVERED → INSTALLED — against a Sales Order advancing CONFIRMED →
// IN_FULFILLMENT → FULFILLED → CLOSED, and asserts inventory control EXITS only at the very end
// (installed AND sale closed), never before. Also proves each negative invariant at the surface and
// the coordinated C713×5 order rollup.
import test from "node:test";
import assert from "node:assert/strict";
import { buildMachineInventoryControlView, buildCoordinatedOrderView } from "../src/domain/inventoryControlView.js";
import { OWNERSHIP } from "../src/domain/inventoryControlLifecycle.js";

// A SERIAL-tracked Part authority (ice machine model) the identity validates against.
const PART = { partId: "P-ICE-C713", trackingMode: "SERIAL", internalPartNumber: "C713" };
const LOC = (type, locationId) => ({ type, locationId });

// Build a governed Serialized Asset identity at a given lifecycle state/location/link.
const asset = ({ state, location, currentEquipmentId = null }) => ({
  serialNo: "SN-C713-001",
  partId: PART.partId,
  currentLocation: location,
  state,
  currentEquipmentId,
});

// The lifecycle waypoints BEFORE the sale closes — control must stay CONTROLLED at every one.
const PRE_CLOSE_WAYPOINTS = [
  { state: "RECEIVED", location: LOC("WAREHOUSE", "WH-PHX"), flags: {} },
  { state: "AVAILABLE", location: LOC("WAREHOUSE", "WH-PHX"), flags: {} },
  { state: "RESERVED", location: LOC("WAREHOUSE", "WH-PHX"), flags: { allocated: true } },
  { state: "STAGED", location: LOC("WAREHOUSE", "WH-PHX"), flags: { allocated: true } },
  { state: "LOADED", location: LOC("MOBILE", "TRUCK-12"), flags: { allocated: true } },
  { state: "IN_TRANSIT", location: LOC("VIRTUAL", "TRANSIT"), flags: { allocated: true } },
  { state: "DELIVERED", location: LOC("CUSTOMER", "CUST-SITE-9"), flags: { allocated: true, delivered: true } },
];

test("E2E: control persists through every pre-close waypoint (sale still open)", () => {
  for (const wp of PRE_CLOSE_WAYPOINTS) {
    const view = buildMachineInventoryControlView({
      serializedAsset: asset({ state: wp.state, location: wp.location }),
      part: PART,
      salesOrderState: "IN_FULFILLMENT",
      explicitTitleHolder: OWNERSHIP.TAYLOR, // Taylor bought from Ventana; still Taylor pre-delivery
      flags: wp.flags,
    });
    assert.equal(view.inventoryControl, "CONTROLLED", `state ${wp.state} must remain CONTROLLED (sale open)`);
    assert.ok(view.unmetConditions.includes("SALE_OPEN"));
  }
});

test("E2E: allocation is a commitment, NOT an inventory exit", () => {
  const view = buildMachineInventoryControlView({
    serializedAsset: asset({ state: "RESERVED", location: LOC("WAREHOUSE", "WH-PHX") }),
    part: PART,
    salesOrderState: "IN_FULFILLMENT",
    flags: { allocated: true },
  });
  assert.equal(view.inventoryControl, "CONTROLLED");
  // A committed unit is present-and-UNAVAILABLE — never offered as free inventory (INV-2).
  assert.equal(view.presentableAsAvailable, false);
});

test("E2E: delivery alone is NOT an inventory exit (installed + sale still open)", () => {
  // Delivered and even installed, but the sale has not closed → still CONTROLLED (sale open).
  const view = buildMachineInventoryControlView({
    serializedAsset: asset({ state: "INSTALLED", location: LOC("CUSTOMER", "CUST-SITE-9"), currentEquipmentId: "EQ-1" }),
    part: PART,
    salesOrderState: "FULFILLED", // fulfilled but not yet CLOSED
    explicitTitleHolder: OWNERSHIP.CUSTOMER,
    flags: { allocated: true, delivered: true, invoiced: true },
  });
  assert.equal(view.inventoryControl, "CONTROLLED");
  assert.deepEqual([...view.unmetConditions], ["SALE_OPEN"]);
  assert.match(view.inventoryControlLabel, /installed, sale open/i);
});

test("E2E: sale closed (authoritative) but installation incomplete stays CONTROLLED", () => {
  const view = buildMachineInventoryControlView({
    serializedAsset: asset({ state: "DELIVERED", location: LOC("CUSTOMER", "CUST-SITE-9") }),
    part: PART,
    salesOrderState: "CLOSED",
    saleCloseAuthoritative: true, // D-5: an explicit authoritative close fact
    flags: { allocated: true, delivered: true, invoiced: true },
  });
  assert.equal(view.inventoryControl, "CONTROLLED");
  assert.deepEqual([...view.unmetConditions], ["INSTALLATION_INCOMPLETE"]);
  assert.match(view.inventoryControlLabel, /sale closed, not installed/i);
});

test("E2E: D-5 guard — bare SO CLOSED is NOT authoritative; installed machine does NOT exit yet", () => {
  const view = buildMachineInventoryControlView({
    serializedAsset: asset({ state: "INSTALLED", location: LOC("CUSTOMER", "CUST-SITE-9"), currentEquipmentId: "EQ-1" }),
    part: PART,
    salesOrderState: "CLOSED", // no explicit authoritative-close fact, D-5 unratified
    flags: { allocated: true, delivered: true, invoiced: true },
  });
  // Fail-closed: cannot confirm the sale closed per Taylor's (undefined) criteria ⇒ never a premature exit.
  assert.notEqual(view.inventoryControl, "EXITED");
  assert.equal(view.inventoryControl, "UNKNOWN");
});

test("E2E: control EXITS only when installed AND sale closed — the two-condition rule", () => {
  const view = buildMachineInventoryControlView({
    serializedAsset: asset({ state: "INSTALLED", location: LOC("CUSTOMER", "CUST-SITE-9"), currentEquipmentId: "EQ-1" }),
    part: PART,
    salesOrderState: "CLOSED",
    saleCloseAuthoritative: true,
    explicitTitleHolder: OWNERSHIP.CUSTOMER,
    custodyHolderLabel: "Customer site (CUST-SITE-9)",
    flags: { allocated: true, delivered: true, invoiced: true },
  });
  assert.equal(view.inventoryControl, "EXITED");
  assert.equal(view.unmetConditions.length, 0);
  // Ownership is its OWN axis — it was set explicitly, NOT inferred from the EXITED control state.
  assert.equal(view.ownershipTitle, OWNERSHIP.CUSTOMER);
  assert.equal(view.ownershipIsExplicit, true);
});

test("E2E: ownership is never inferred from control state (title unknown even when EXITED)", () => {
  const view = buildMachineInventoryControlView({
    serializedAsset: asset({ state: "INSTALLED", location: LOC("CUSTOMER", "CUST-SITE-9"), currentEquipmentId: "EQ-1" }),
    part: PART,
    salesOrderState: "CLOSED",
    saleCloseAuthoritative: true,
    // no explicitTitleHolder supplied
    flags: {},
  });
  assert.equal(view.inventoryControl, "EXITED");
  assert.equal(view.ownershipTitle, OWNERSHIP.UNKNOWN); // control ended ≠ we know who owns it
});

test("E2E: Ventana drop-ship with no Taylor receipt has NO inventory-control phase", () => {
  const view = buildMachineInventoryControlView({
    serializedAsset: asset({ state: "DELIVERED", location: LOC("CUSTOMER", "CUST-SITE-9") }),
    part: PART,
    salesOrderState: "CLOSED",
    flags: { dropShipNoReceipt: true },
  });
  assert.equal(view.inventoryControl, "NOT_STARTED");
});

test("E2E: coordinated C713×5 — order exits control only when all 5 installed AND order closed", () => {
  const unitAt = (state, currentEquipmentId = null) => ({
    serializedAsset: asset({ state, location: LOC("CUSTOMER", "CUST-SITE-9"), currentEquipmentId }),
    part: PART,
    explicitTitleHolder: OWNERSHIP.CUSTOMER,
    flags: { allocated: true, delivered: true },
  });

  // Sale closed, 4 installed / 1 delivered-not-installed → order still CONTROLLED, 4 exited.
  const fourOfFive = buildCoordinatedOrderView({
    orderRef: "SO-9001",
    salesOrderState: "CLOSED",
    saleCloseAuthoritative: true,
    unitInputs: [unitAt("INSTALLED", "EQ-1"), unitAt("INSTALLED", "EQ-2"), unitAt("INSTALLED", "EQ-3"), unitAt("INSTALLED", "EQ-4"), unitAt("DELIVERED")],
  });
  assert.equal(fourOfFive.inventoryControl, "CONTROLLED");
  assert.equal(fourOfFive.exitedUnits, 4);
  assert.equal(fourOfFive.controlledUnits, 1);
  assert.equal(fourOfFive.underControl, 5);
  assert.match(fourOfFive.summaryLabel, /4\/5 Taylor-controlled units exited/);

  // All 5 installed + sale closed → order EXITED.
  const complete = buildCoordinatedOrderView({
    orderRef: "SO-9001",
    salesOrderState: "CLOSED",
    saleCloseAuthoritative: true,
    unitInputs: [unitAt("INSTALLED", "EQ-1"), unitAt("INSTALLED", "EQ-2"), unitAt("INSTALLED", "EQ-3"), unitAt("INSTALLED", "EQ-4"), unitAt("INSTALLED", "EQ-5")],
  });
  assert.equal(complete.inventoryControl, "EXITED");
  assert.equal(complete.exitedUnits, 5);

  // All 5 installed but sale OPEN → order CONTROLLED, 0 exited (baseline §9 honesty).
  const saleOpen = buildCoordinatedOrderView({
    orderRef: "SO-9001",
    salesOrderState: "FULFILLED",
    unitInputs: [unitAt("INSTALLED", "EQ-1"), unitAt("INSTALLED", "EQ-2"), unitAt("INSTALLED", "EQ-3"), unitAt("INSTALLED", "EQ-4"), unitAt("INSTALLED", "EQ-5")],
  });
  assert.equal(saleOpen.inventoryControl, "CONTROLLED");
  assert.equal(saleOpen.exitedUnits, 0);

  // Mixed order: 2 Taylor-installed + sale closed, 1 Ventana drop-ship → order EXITED over the
  // units Taylor actually controlled; the drop-ship unit is surfaced, not counted as controlled.
  const dropShipUnit = {
    serializedAsset: asset({ state: "DELIVERED", location: LOC("CUSTOMER", "CUST-SITE-9") }),
    part: PART,
    flags: { dropShipNoReceipt: true },
  };
  const mixed = buildCoordinatedOrderView({
    orderRef: "SO-9002",
    salesOrderState: "CLOSED",
    saleCloseAuthoritative: true,
    unitInputs: [unitAt("INSTALLED", "EQ-1"), unitAt("INSTALLED", "EQ-2"), dropShipUnit],
  });
  assert.equal(mixed.inventoryControl, "EXITED");
  assert.equal(mixed.underControl, 2);
  assert.equal(mixed.notStartedUnits, 1);
  assert.match(mixed.summaryLabel, /1 never under Taylor control/);
});
