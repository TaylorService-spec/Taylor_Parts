// EVERY CERTIFICATION EQUIPMENT MODEL MUST SURVIVE THE REAL REGISTRY READER.
//
// ============================ WHAT WAS WRONG FOR THE WHOLE PROGRAM ============================
//
// `equipment_models` is not a collection this world invented. It belongs to the Equipment
// Compatibility registry (equipmentCompatibility/repository.ts), and in that registry the DOCUMENT ID
// IS THE DOMAIN IDENTITY: `TAYLOR--C713`, derived by buildEquipmentModelId.
//
// The certification builder wrote `cw-model-taylor-c713` instead, with a record shape
// (`configuration`, `publicSource`, `fieldProvenance`, `lineOfBusiness`, and no `equipmentModelId`,
// `manufacturerId`, `displayName`, `sourceAuthority` or `version`) that the registry's own validator
// refuses on its first check -- `unknown_field`, before it even looks at the id.
//
// 48 documents and 278 equipment back-references were wrong, and NOTHING said so, because no
// consumer had ever read an equipment model through the registry. That is the fourth time in this
// program a fixture has been internally consistent and wrong, and the fourth time only a real
// adapter said so.
//
// ============================ SO THIS TEST USES THE READER ============================
//
// modelFromFirestore is the function the registry itself calls. It enforces things a field checklist
// would not have thought to: that the stored `equipmentModelId` EQUALS the document id, that the id
// is canonical in its own right rather than merely equal to a stored string, and the full D1
// validation behind it.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Timestamp } from "firebase-admin/firestore";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { modelFromFirestore, MalformedStoredRecordError } =
  await import(L("functions/lib/equipmentCompatibility/equipmentModelRepository.js"));
const { buildEquipmentModelId } =
  await import(L("functions/lib/equipmentCompatibility/domain/equipmentModel.js"));
const { ALL_MODELS, modelIdOf } =
  await import(L("functions/scripts/certificationWorld/data/equipmentMasters.mjs"));
const { buildWorld } = await import(L("functions/scripts/certificationWorld/build.mjs"));

const STAMP = Timestamp.fromDate(new Date("2026-08-01T00:00:00.000Z"));
/** The seeder stamps createdAt/updatedAt; the builder supplies everything else. */
const asStored = (record) => ({ createdAt: STAMP, updatedAt: STAMP, ...record.data });

const world = buildWorld();

test("every certification equipment model is readable by the real registry reader", () => {
  assert.ok(world.equipmentModels.length > 0, "the registry must not be empty");
  for (const record of world.equipmentModels) {
    const stored = modelFromFirestore(record.id, asStored(record));
    assert.equal(stored.model.equipmentModelId, record.id);
  }
});

test("THE FIXTURE'S ID DERIVATION IS THE PRODUCT'S", () => {
  // The certification builder is pure -- it runs with no compile step -- so it derives the canonical
  // id itself rather than importing the product's. That is a second copy of a rule, and the only
  // thing that makes it safe is this: for every model in the catalog, the two must agree. If the
  // product ever changes how identity is minted, this fails instead of the world silently seeding
  // documents the registry can no longer find.
  for (const m of ALL_MODELS) {
    assert.equal(modelIdOf(m), buildEquipmentModelId(m.manufacturer, m.modelNumber),
      `${m.manufacturer} ${m.modelNumber}: fixture and product disagree on the canonical id`);
  }
});

test("MUTATION: the OLD id scheme is refused by the same reader that just accepted 48", () => {
  // The exact defect, replayed. `cw-model-taylor-c713` is not a canonical model id, and a reader
  // that accepted it would make this whole file decorative.
  const record = world.equipmentModels[0];
  const legacyId = "cw-model-" + record.data.manufacturerName.toLowerCase() + "-" +
    String(record.data.modelNumber).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  assert.throws(() => modelFromFirestore(legacyId, { ...asStored(record), equipmentModelId: legacyId }),
    MalformedStoredRecordError);
});

test("MUTATION: a stored id that disagrees with the document id is refused", () => {
  // Identity in two places is identity in neither. This is the shape a hand-edit produces.
  const record = world.equipmentModels[0];
  assert.throws(() => modelFromFirestore(record.id, { ...asStored(record), equipmentModelId: "TAYLOR--SOMETHINGELSE" }),
    MalformedStoredRecordError);
});

test("MUTATION: dropping sourceAuthority is refused", () => {
  // sourceAuthority carries the public catalog citation -- the record's claim to be a real product
  // fact rather than an invention. The registry requires it, and this proves the requirement is live
  // rather than something the fixture happens to satisfy.
  const record = world.equipmentModels[0];
  const stored = asStored(record);
  delete stored.sourceAuthority;
  assert.throws(() => modelFromFirestore(record.id, stored), MalformedStoredRecordError);
});

test("EVERY equipment record points at a model that exists", () => {
  // The back-reference is the reason the id change mattered at all. 278 units carried
  // `cw-model-...`; if any still does, it names a document that is no longer there.
  const ids = new Set(world.equipmentModels.map((m) => m.id));
  const dangling = world.equipment.filter((e) => !ids.has(e.data.equipmentModelId));
  assert.deepEqual(dangling.map((e) => `${e.id}:${e.data.equipmentModelId}`), [],
    "equipment referencing a model id that no document carries");
});

test("MUTATION: a dangling back-reference is detectable", () => {
  const ids = new Set(world.equipmentModels.map((m) => m.id));
  assert.equal(ids.has("cw-model-taylor-c713"), false, "the legacy id must not resolve");
});
