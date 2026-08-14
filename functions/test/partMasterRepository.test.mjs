// INV-1 Part Master repository -- serialization round-trip regression (site-work round-3 item H).
// Pure/offline node:test over the compiled functions lib (tsc build only) -- no emulator, no Firebase
// runtime. Proves partToFirestore()/partFromFirestore() persist and read back Part.wholeUnit and
// Part.equipmentModelId (Owner Decision -- Option A FK), matching how every other optional Part field
// is round-tripped. Regression coverage for: repository silently dropped both fields (validated +
// FK-checked at the command layer, but never written/read by the repository, so they reverted to
// undefined on the very next read).
// Prerequisite: npm run build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { partToFirestore, partFromFirestore } from "../lib/partMaster/partMasterRepository.js";
import { validatePart } from "../lib/partMaster/validation.js";
import { buildEquipmentModelId } from "../lib/equipmentCompatibility/domain/equipmentModel.js";

const MODEL_ID = buildEquipmentModelId("taylor", "C713");

const meta = {
  version: 1,
  createdAt: new Date(0),
  createdBy: "t",
  updatedAt: new Date(0),
  updatedBy: "t",
};

function toFirestoreDoc(part) {
  // Mirrors what stageCreate/stageUpdate hand to Firestore: partToFirestore()'s Date fields become
  // Timestamps before hitting the wire; simulate that here since this test never touches a real db.
  const doc = partToFirestore({ part, ...meta });
  return {
    ...doc,
    createdAt: Timestamp.fromDate(meta.createdAt),
    updatedAt: Timestamp.fromDate(meta.updatedAt),
  };
}

test("whole-unit Part: wholeUnit + equipmentModelId round-trip through persist + read (create)", () => {
  const validated = validatePart({
    partId: "SKU-C713-A",
    internalPartNumber: "C713-UNIT",
    name: "Taylor C713 unit",
    status: "DRAFT",
    stockingUnit: "EACH",
    controlType: "SERIALIZED",
    stockingClass: "STOCKED",
    wholeUnit: true,
    equipmentModelId: MODEL_ID,
  });
  assert.equal(validated.valid, true);

  const doc = toFirestoreDoc(validated.value);
  assert.equal(doc.wholeUnit, true, "wholeUnit must be written by partToFirestore");
  assert.equal(doc.equipmentModelId, MODEL_ID, "equipmentModelId must be written by partToFirestore");

  const read = partFromFirestore("SKU-C713-A", doc);
  assert.equal(read.part.wholeUnit, true, "wholeUnit must survive partFromFirestore");
  assert.equal(read.part.equipmentModelId, MODEL_ID, "equipmentModelId must survive partFromFirestore");
});

test("whole-unit Part: fields still round-trip on a simulated update (version bump)", () => {
  const validated = validatePart({
    partId: "SKU-C713-A",
    internalPartNumber: "C713-UNIT",
    name: "Taylor C713 unit (rev 2)",
    status: "ACTIVE",
    stockingUnit: "EACH",
    controlType: "SERIALIZED",
    stockingClass: "STOCKED",
    wholeUnit: true,
    equipmentModelId: MODEL_ID,
  });
  assert.equal(validated.valid, true);

  const doc = partToFirestore({ part: validated.value, ...meta, version: 2 });
  const readBack = partFromFirestore("SKU-C713-A", {
    ...doc,
    createdAt: Timestamp.fromDate(meta.createdAt),
    updatedAt: Timestamp.fromDate(meta.updatedAt),
  });
  assert.equal(readBack.part.wholeUnit, true);
  assert.equal(readBack.part.equipmentModelId, MODEL_ID);
  assert.equal(readBack.version, 2);
});

test("ordinary (non-whole-unit) Part: both fields stay absent from the stored doc and the read-back Part", () => {
  const validated = validatePart({
    partId: "PRT-1001",
    internalPartNumber: "PRT-1001",
    name: "Compressor",
    status: "ACTIVE",
    stockingUnit: "EACH",
    controlType: "STANDARD",
    stockingClass: "SERVICE",
  });
  assert.equal(validated.valid, true);

  const doc = toFirestoreDoc(validated.value);
  assert.equal("wholeUnit" in doc, false);
  assert.equal("equipmentModelId" in doc, false);

  const read = partFromFirestore("PRT-1001", doc);
  assert.equal("wholeUnit" in read.part, false);
  assert.equal("equipmentModelId" in read.part, false);
});
