// Tests for the Equipment-surface inventory-control adapter. Proves the honest rendering: a
// serial-linked installed Equipment reads UNKNOWN (with reason) while the sale-close signal is
// unavailable, flips to real states once that signal is supplied, and keeps axes separate.
import test from "node:test";
import assert from "node:assert/strict";
import { buildEquipmentInventoryControlView } from "../src/domain/equipmentInventoryControlAdapter.js";
import { OWNERSHIP } from "../src/domain/inventoryControlLifecycle.js";

const linked = { serializedAssetId: "SA-1", status: "ACTIVE" };

test("serial-linked installed equipment, no sale signal ⇒ honest UNKNOWN with reason", () => {
  const v = buildEquipmentInventoryControlView(linked);
  assert.equal(v.linkedToSerializedAsset, true);
  assert.equal(v.inventoryControl, "UNKNOWN");
  assert.match(v.reason, /sale-close status not available/i);
  assert.equal(v.saleCloseSignalAvailable, false);
  // availability axis: an installed/committed unit is never presentable as free inventory.
  assert.equal(v.presentableAsAvailable, false);
});

test("supplying the sale-close signal resolves the control state (installed + closed ⇒ EXITED)", () => {
  const v = buildEquipmentInventoryControlView(linked, { saleClosed: true, explicitTitleHolder: OWNERSHIP.CUSTOMER });
  assert.equal(v.inventoryControl, "EXITED");
  assert.equal(v.reason, null);
  assert.equal(v.ownershipTitle, OWNERSHIP.CUSTOMER); // separate axis, supplied explicitly
});

test("installed + sale explicitly open ⇒ CONTROLLED (sale open)", () => {
  const v = buildEquipmentInventoryControlView(linked, { saleClosed: false });
  assert.equal(v.inventoryControl, "CONTROLLED");
  assert.deepEqual([...v.unmetConditions], ["SALE_OPEN"]);
});

test("unlinked/legacy equipment ⇒ UNKNOWN, ownership not inferred", () => {
  const v = buildEquipmentInventoryControlView({ status: "ACTIVE" });
  assert.equal(v.linkedToSerializedAsset, false);
  assert.equal(v.inventoryControl, "UNKNOWN");
  assert.equal(v.ownershipTitle, "UNKNOWN"); // never inferred from control
});

test("malformed input fails closed (no throw)", () => {
  assert.equal(buildEquipmentInventoryControlView(null).inventoryControl, "UNKNOWN");
  assert.equal(buildEquipmentInventoryControlView(undefined).inventoryControl, "UNKNOWN");
});
