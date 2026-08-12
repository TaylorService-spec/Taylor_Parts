// Trusted-read mirror tests for the two-condition inventory-control projection. Driven by the
// SAME canonical decision table as the client authority, so the two mirrors cannot drift.
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeInventoryControl,
  resolveOwnershipTitle,
  isPresentableAsAvailable,
  rollupOrderInventoryControl,
  OWNERSHIP,
  INVENTORY_CONTROL_STATES,
  EXIT_CONDITIONS,
} from "../lib/fulfillment/inventoryControlLifecycle.js";
// Single source of parity truth — shared with the client mirror's test.
import { CANONICAL_CASES } from "../../field-ops-app-vite/src/domain/inventoryControlLifecycle.cases.mjs";

test("canonical decision table (trusted-read mirror) matches the client authority", () => {
  for (const c of CANONICAL_CASES) {
    const r = computeInventoryControl(c.input);
    assert.equal(r.state, c.expect.state, c.name);
    assert.deepEqual([...r.unmetConditions].sort(), [...c.expect.unmet].sort(), `${c.name} (unmet)`);
    assert.ok(INVENTORY_CONTROL_STATES.includes(r.state));
  }
});

test("EXIT requires BOTH conditions; single events never exit", () => {
  assert.equal(computeInventoryControl({ controlBegan: true, installationComplete: true, saleClosed: false }).state, "CONTROLLED");
  assert.equal(computeInventoryControl({ controlBegan: true, installationComplete: false, saleClosed: true }).state, "CONTROLLED");
  assert.equal(
    computeInventoryControl({ controlBegan: true, installationComplete: false, saleClosed: false, context: { allocated: true, delivered: true, invoiced: true } }).state,
    "CONTROLLED"
  );
  assert.equal(computeInventoryControl({ controlBegan: true, installationComplete: true, saleClosed: true }).state, "EXITED");
});

test("ownership never inferred from control; availability never inferred from presence", () => {
  assert.equal(resolveOwnershipTitle({}), OWNERSHIP.UNKNOWN);
  assert.equal(resolveOwnershipTitle({ explicitTitleHolder: OWNERSHIP.CUSTOMER }), OWNERSHIP.CUSTOMER);
  assert.equal(isPresentableAsAvailable({ availableForAssignment: true, committedToSalesOrder: true }), false);
  assert.equal(isPresentableAsAvailable({ availableForAssignment: true, committedToSalesOrder: false }), true);
});

test("coordinated order rollup exits only when all controlled units installed and order closed", () => {
  const unit = (i, c) => computeInventoryControl({ controlBegan: true, installationComplete: i, saleClosed: c });
  const dropShip = () => computeInventoryControl({ controlBegan: false, installationComplete: false, saleClosed: false });
  assert.equal(rollupOrderInventoryControl(Array.from({ length: 5 }, () => unit(true, false))).state, "CONTROLLED");
  assert.equal(rollupOrderInventoryControl([unit(true, true), unit(true, true), unit(true, true), unit(true, true), unit(false, true)]).exitedUnits, 4);
  assert.equal(rollupOrderInventoryControl(Array.from({ length: 5 }, () => unit(true, true))).state, "EXITED");
  // NOT_STARTED (drop-ship) is outside the exit denominator.
  assert.equal(rollupOrderInventoryControl([dropShip(), dropShip()]).state, "NOT_STARTED");
  assert.equal(rollupOrderInventoryControl([unit(true, true), unit(true, true), dropShip()]).state, "EXITED");
});

test("null argument fails closed (parity with client)", () => {
  assert.equal(computeInventoryControl(null).state, "UNKNOWN");
  assert.equal(computeInventoryControl({ controlBegan: true, installationComplete: true, saleClosed: true, context: null }).state, "EXITED");
});

test("EXIT_CONDITIONS enum is the two-condition set", () => {
  assert.deepEqual(Object.keys(EXIT_CONDITIONS).sort(), ["INSTALLATION_INCOMPLETE", "SALE_OPEN"]);
});
