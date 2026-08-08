// Part Master ↔ equipment-model FK (Owner Decision — Option A). Pure unit tests (node:test; no emulator).
// Prerequisite: npm run build. Proves the whole-unit guardrail (equipmentModelId valid ONLY on a whole-unit,
// serialized, non-SERVICE Part — never inferred from the FK), the canonical-id format gate, and the injectable
// command-layer referential-existence check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePart } from "../lib/partMaster/validation.js";
import { assertEquipmentModelExists } from "../lib/partMaster/partMasterCommands.js";
import { buildEquipmentModelId, isCanonicalEquipmentModelId } from "../lib/equipmentCompatibility/domain/equipmentModel.js";

const MODEL_ID = buildEquipmentModelId("taylor", "C713");
assert.equal(isCanonicalEquipmentModelId(MODEL_ID), true); // sanity: our fixture id is canonical

const base = {
  partId: "SKU-C713-A",
  internalPartNumber: "C713-UNIT",
  name: "Taylor C713 unit",
  status: "DRAFT",
  stockingUnit: "EACH",
  controlType: "SERIALIZED",
  stockingClass: "STOCKED",
};

const errCodes = (r) => (r.valid ? [] : r.errors.map((e) => `${e.path}:${e.code}`));

test("whole-unit serialized Part with a canonical equipmentModelId is valid and stores both fields", () => {
  const r = validatePart({ ...base, wholeUnit: true, equipmentModelId: MODEL_ID });
  assert.equal(r.valid, true, JSON.stringify(errCodes(r)));
  assert.equal(r.value.wholeUnit, true);
  assert.equal(r.value.equipmentModelId, MODEL_ID);
});

test("equipmentModelId WITHOUT wholeUnit=true is rejected (never infer whole-unit from the FK)", () => {
  const r = validatePart({ ...base, equipmentModelId: MODEL_ID }); // wholeUnit omitted ⇒ false
  assert.equal(r.valid, false);
  assert.ok(errCodes(r).includes("equipmentModelId:INVALID_COMBINATION"));
});

test("wholeUnit=true requires a serialized control type", () => {
  const r = validatePart({ ...base, controlType: "STANDARD", wholeUnit: true });
  assert.equal(r.valid, false);
  assert.ok(errCodes(r).includes("wholeUnit:INVALID_COMBINATION"));
});

test("a SERVICE part cannot be a whole-unit Part", () => {
  // SERVICE also forces STANDARD control (existing rule); assert the whole-unit/SERVICE conflict is reported.
  const r = validatePart({ ...base, stockingClass: "SERVICE", wholeUnit: true });
  assert.equal(r.valid, false);
  assert.ok(errCodes(r).includes("wholeUnit:INVALID_COMBINATION"));
});

test("a non-canonical equipmentModelId is rejected on format", () => {
  const r = validatePart({ ...base, wholeUnit: true, equipmentModelId: "not a canonical id!!" });
  assert.equal(r.valid, false);
  assert.ok(errCodes(r).includes("equipmentModelId:INVALID_FORMAT"));
});

test("wholeUnit must be a boolean", () => {
  const r = validatePart({ ...base, wholeUnit: "yes" });
  assert.equal(r.valid, false);
  assert.ok(errCodes(r).includes("wholeUnit:INVALID_FORMAT"));
});

test("an ordinary service part omits both fields (optional; equipment_compatibility carries its model link)", () => {
  const r = validatePart({ partId: "PRT-1001", internalPartNumber: "PRT-1001", name: "Compressor", status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "SERVICE" });
  assert.equal(r.valid, true, JSON.stringify(errCodes(r)));
  assert.equal("wholeUnit" in r.value, false);
  assert.equal("equipmentModelId" in r.value, false);
});

test("ONE model → MANY whole-unit Parts (no uniqueness): two distinct SKUs share an equipmentModelId", () => {
  const a = validatePart({ ...base, partId: "SKU-C713-A", wholeUnit: true, equipmentModelId: MODEL_ID });
  const b = validatePart({ ...base, partId: "SKU-C713-B", internalPartNumber: "C713-UNIT-B", wholeUnit: true, equipmentModelId: MODEL_ID });
  assert.equal(a.valid, true);
  assert.equal(b.valid, true);
});

test("assertEquipmentModelExists: undefined FK is a no-op (never reads)", async () => {
  let called = false;
  await assertEquipmentModelExists(undefined, async () => { called = true; return false; });
  assert.equal(called, false);
});

test("assertEquipmentModelExists: existing id resolves", async () => {
  await assertEquipmentModelExists(MODEL_ID, async () => true); // does not throw
});

test("assertEquipmentModelExists: unknown id rejects (no arbitrary model ids)", async () => {
  await assert.rejects(() => assertEquipmentModelExists(MODEL_ID, async () => false), /does not reference a known equipment_models/);
});
