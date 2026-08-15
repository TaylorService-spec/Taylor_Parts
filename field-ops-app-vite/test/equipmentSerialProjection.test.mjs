import { test } from "node:test";
import assert from "node:assert/strict";
import { projectEquipmentSerial, EQUIPMENT_SERIAL_SOURCE } from "../src/domain/equipmentSerialProjection.js";

test("a linked equipment with a backing registry record projects the verified registry serial", () => {
  const view = projectEquipmentSerial({
    equipment: { serializedAssetId: "sa-1", serialNumber: "stale-legacy-text" },
    registryAsset: { serialNo: "SN-REAL-001" },
  });
  assert.equal(view.source, EQUIPMENT_SERIAL_SOURCE.REGISTRY);
  assert.equal(view.verified, true);
  assert.equal(view.displaySerial, "SN-REAL-001");
  assert.equal(view.serializedAssetId, "sa-1");
});

test("an unlinked (legacy) equipment preserves its free-text serial, disclosed as unverified", () => {
  const view = projectEquipmentSerial({ equipment: { serialNumber: "hand-typed-123" } });
  assert.equal(view.source, EQUIPMENT_SERIAL_SOURCE.LEGACY);
  assert.equal(view.verified, false);
  assert.equal(view.displaySerial, "hand-typed-123");
  assert.equal(view.serializedAssetId, null);
});

test("no serial at all projects none, never a fabricated placeholder", () => {
  const view = projectEquipmentSerial({ equipment: {} });
  assert.equal(view.source, EQUIPMENT_SERIAL_SOURCE.NONE);
  assert.equal(view.displaySerial, null);
});

test("a claimed link with no backing registry record fails closed to legacy, never a false-verified registry serial", () => {
  const view = projectEquipmentSerial({
    equipment: { serializedAssetId: "sa-orphaned", serialNumber: "fallback-text" },
    registryAsset: null,
  });
  assert.equal(view.source, EQUIPMENT_SERIAL_SOURCE.LEGACY);
  assert.equal(view.verified, false);
  assert.equal(view.displaySerial, "fallback-text");
});

test("a claimed link with a malformed registry record (empty serialNo) also fails closed to legacy", () => {
  const view = projectEquipmentSerial({
    equipment: { serializedAssetId: "sa-2", serialNumber: "fallback-text-2" },
    registryAsset: { serialNo: "" },
  });
  assert.equal(view.source, EQUIPMENT_SERIAL_SOURCE.LEGACY);
  assert.equal(view.displaySerial, "fallback-text-2");
});

test("malformed equipment input (non-string serialNumber) is treated as absent, not thrown", () => {
  const view = projectEquipmentSerial({ equipment: { serialNumber: 12345 } });
  assert.equal(view.source, EQUIPMENT_SERIAL_SOURCE.NONE);
});
