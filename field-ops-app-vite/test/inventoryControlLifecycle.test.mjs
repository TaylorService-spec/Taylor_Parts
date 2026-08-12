// Tests for the client-side two-condition inventory-control authority. Drives the CANONICAL
// decision table plus the ownership/availability guards and the coordinated C713×5 rollup.
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeInventoryControl,
  describeInventoryControl,
  resolveOwnershipTitle,
  resolveVentanaChainTitle,
  resolveCancelOrDamageDisposition,
  DISPOSITION,
  isPresentableAsAvailable,
  rollupOrderInventoryControl,
  OWNERSHIP,
  INVENTORY_CONTROL_STATES,
  EXIT_CONDITIONS,
} from "../src/domain/inventoryControlLifecycle.js";
import { CANONICAL_CASES } from "../src/domain/inventoryControlLifecycle.cases.mjs";

test("canonical decision table (client mirror)", () => {
  for (const c of CANONICAL_CASES) {
    const r = computeInventoryControl(c.input);
    assert.equal(r.state, c.expect.state, c.name);
    assert.deepEqual([...r.unmetConditions].sort(), [...c.expect.unmet].sort(), `${c.name} (unmet)`);
    assert.ok(INVENTORY_CONTROL_STATES.includes(r.state));
    assert.ok(Object.isFrozen(r));
  }
});

test("allocation, delivery, and invoicing together never end control", () => {
  const r = computeInventoryControl({
    controlBegan: true,
    installationComplete: false,
    saleClosed: false,
    context: { allocated: true, delivered: true, invoiced: true },
  });
  assert.equal(r.state, "CONTROLLED");
  // context is echoed for display but proven non-authoritative over the exit decision.
  assert.equal(r.context.allocated, true);
  assert.equal(r.context.delivered, true);
  assert.equal(r.context.invoiced, true);
});

test("EXIT requires BOTH conditions — neither alone suffices", () => {
  assert.equal(computeInventoryControl({ controlBegan: true, installationComplete: true, saleClosed: false }).state, "CONTROLLED");
  assert.equal(computeInventoryControl({ controlBegan: true, installationComplete: false, saleClosed: true }).state, "CONTROLLED");
  assert.equal(computeInventoryControl({ controlBegan: true, installationComplete: true, saleClosed: true }).state, "EXITED");
});

test("legible partial-state copy is distinct for each unmet condition", () => {
  const installedSaleOpen = computeInventoryControl({ controlBegan: true, installationComplete: true, saleClosed: false });
  const closedNotInstalled = computeInventoryControl({ controlBegan: true, installationComplete: false, saleClosed: true });
  assert.match(describeInventoryControl(installedSaleOpen), /installed, sale open/i);
  assert.match(describeInventoryControl(closedNotInstalled), /sale closed, not installed/i);
  assert.match(describeInventoryControl(computeInventoryControl({ controlBegan: true, installationComplete: true, saleClosed: true })), /ended/i);
});

test("ownership/title is NEVER inferred from inventory-control state (INV-4)", () => {
  // An EXITED machine does not imply the customer owns it; a CONTROLLED one does not imply Taylor.
  assert.equal(resolveOwnershipTitle({}), OWNERSHIP.UNKNOWN);
  assert.equal(resolveOwnershipTitle({ explicitTitleHolder: undefined }), OWNERSHIP.UNKNOWN);
  assert.equal(resolveOwnershipTitle({ explicitTitleHolder: "SOMETHING_ELSE" }), OWNERSHIP.UNKNOWN);
  assert.equal(resolveOwnershipTitle({ explicitTitleHolder: OWNERSHIP.CUSTOMER }), OWNERSHIP.CUSTOMER);
  assert.equal(resolveOwnershipTitle({ explicitTitleHolder: OWNERSHIP.VENTANA }), OWNERSHIP.VENTANA);
});

test("committed equipment is NOT presentable as freely-available inventory (INV-2)", () => {
  assert.equal(isPresentableAsAvailable({ availableForAssignment: true, committedToSalesOrder: true }), false);
  assert.equal(isPresentableAsAvailable({ availableForAssignment: true, committedToSalesOrder: false }), true);
  assert.equal(isPresentableAsAvailable({ availableForAssignment: false }), false); // fail closed
  assert.equal(isPresentableAsAvailable({}), false);
});

test("coordinated C713×5 rollup — order exits ONLY when all units installed AND order closed", () => {
  // Sale is per-order (shared saleClosed); installation is per-unit.
  const unit = (installed, closed) => computeInventoryControl({ controlBegan: true, installationComplete: installed, saleClosed: closed });

  // Sale open, all 5 installed ⇒ every unit CONTROLLED (sale open); order CONTROLLED.
  const allInstalledSaleOpen = rollupOrderInventoryControl(Array.from({ length: 5 }, () => unit(true, false)));
  assert.equal(allInstalledSaleOpen.state, "CONTROLLED");
  assert.equal(allInstalledSaleOpen.exitedUnits, 0);

  // Sale closed, 4 installed / 1 not ⇒ 0 units exited (each needs its own install), order CONTROLLED.
  const fourOfFive = rollupOrderInventoryControl([unit(true, true), unit(true, true), unit(true, true), unit(true, true), unit(false, true)]);
  assert.equal(fourOfFive.state, "CONTROLLED");
  assert.equal(fourOfFive.exitedUnits, 4);
  assert.equal(fourOfFive.controlledUnits, 1);

  // Sale closed, all 5 installed ⇒ order EXITED.
  const complete = rollupOrderInventoryControl(Array.from({ length: 5 }, () => unit(true, true)));
  assert.equal(complete.state, "EXITED");
  assert.equal(complete.exitedUnits, 5);

  // Any unknown unit ⇒ order UNKNOWN (fail closed).
  const withUnknown = rollupOrderInventoryControl([unit(true, true), computeInventoryControl({ controlBegan: true, installationComplete: null, saleClosed: true })]);
  assert.equal(withUnknown.state, "UNKNOWN");
});

test("rollup — NOT_STARTED (drop-ship) units are OUTSIDE the exit denominator", () => {
  const dropShip = () => computeInventoryControl({ controlBegan: false, installationComplete: false, saleClosed: false });
  const exited = () => computeInventoryControl({ controlBegan: true, installationComplete: true, saleClosed: true });

  // All drop-ship ⇒ order NOT_STARTED (never Taylor's), NOT a controlled order.
  const allDrop = rollupOrderInventoryControl([dropShip(), dropShip(), dropShip()]);
  assert.equal(allDrop.state, "NOT_STARTED");
  assert.equal(allDrop.controlledUnits, 0);
  assert.equal(allDrop.notStartedUnits, 3);
  assert.equal(allDrop.underControl, 0);

  // 3 Taylor-controlled units exited + 2 drop-ship ⇒ order EXITED (the 2 were never Taylor's;
  // a partially-drop-shipped order is NOT stranded forever).
  const mixed = rollupOrderInventoryControl([exited(), exited(), exited(), dropShip(), dropShip()]);
  assert.equal(mixed.state, "EXITED");
  assert.equal(mixed.underControl, 3);
  assert.equal(mixed.exitedUnits, 3);
  assert.equal(mixed.notStartedUnits, 2);
});

test("null argument and null context fail closed (never throw) — mirror-safe", () => {
  assert.equal(computeInventoryControl(null).state, "UNKNOWN");
  assert.equal(computeInventoryControl(undefined).state, "UNKNOWN");
  assert.equal(computeInventoryControl({ controlBegan: true, installationComplete: true, saleClosed: true, context: null }).state, "EXITED");
});

test("D-1/D-2 Ventana-chain title — Ventana→Taylor(on purchase)→Customer(on delivery/acceptance)", () => {
  assert.equal(resolveVentanaChainTitle({ purchasedFromVentana: false }), OWNERSHIP.VENTANA);
  assert.equal(resolveVentanaChainTitle({ purchasedFromVentana: true }), OWNERSHIP.TAYLOR); // D-1
  assert.equal(resolveVentanaChainTitle({ purchasedFromVentana: true, deliveredAndAccepted: true }), OWNERSHIP.CUSTOMER); // D-2
  // Title never depends on installation-complete or sale-close, only purchase + delivery/acceptance.
  assert.equal(resolveVentanaChainTitle({}), OWNERSHIP.UNKNOWN); // fail closed
});

test("D-7 cancel/damage disposition — HOLD/disposition-required, never auto-return-to-available", () => {
  const cancelled = resolveCancelOrDamageDisposition({ saleCancelled: true });
  assert.equal(cancelled.disposition, DISPOSITION.DISPOSITION_REQUIRED);
  assert.equal(cancelled.autoReturnToAvailable, false);
  assert.equal(cancelled.reasonRequired, true);
  const damaged = resolveCancelOrDamageDisposition({ damaged: true });
  assert.equal(damaged.disposition, DISPOSITION.DISPOSITION_REQUIRED);
  assert.equal(damaged.autoReturnToAvailable, false);
  const clean = resolveCancelOrDamageDisposition({});
  assert.equal(clean.disposition, DISPOSITION.NONE);
  assert.equal(clean.autoReturnToAvailable, false); // never auto-available even in the clean case
});

test("exported constants are stable and frozen", () => {
  assert.ok(Object.isFrozen(INVENTORY_CONTROL_STATES));
  assert.deepEqual(Object.keys(EXIT_CONDITIONS).sort(), ["INSTALLATION_INCOMPLETE", "SALE_OPEN"]);
});
