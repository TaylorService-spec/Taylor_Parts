// WHOLE-UNIT PARTS — the machine as something inventory can hold.
//
// ============================ WHAT THIS IS PROVING ============================
//
// A whole-unit Part is the only way the platform can say "we hold two uninstalled C713s". Stock
// lives on Parts; serialized identity is scoped to `(partId, serialNo)`; acquisition, receiving and
// install all take a partId. Without one, an unassigned machine has nothing to be a unit OF.
//
// Part Master guards the classification with four rules, and every one of them is a rule somebody
// would otherwise have broken by hand:
//
//   `wholeUnit` is DECLARED, never inferred from the presence of `equipmentModelId`
//   `equipmentModelId` is rejected outright on a Part that has not declared it
//   a whole-unit Part must be SERIALIZED (or SERIALIZED_LOT)
//   a whole-unit Part is never a SERVICE stocking class
//
// So this runs the product's own validator and the product's own resolver. The mutations below
// exist because a test that only asserts the happy path proves the fixture agrees with itself.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Timestamp } from "firebase-admin/firestore";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { partFromFirestore } = await import(L("functions/lib/partMaster/partMasterRepository.js"));
const { validatePart } = await import(L("functions/lib/partMaster/validation.js"));
const { resolveEligibleWholeUnitParts } =
  await import(L("functions/lib/fulfillment/equipmentModelResolution.js"));
const { WHOLE_UNIT_PARTS, wholeUnitPartRecordFor, cohortUnitsByLine } =
  await import(L("functions/scripts/certificationWorld/data/wholeUnitParts.mjs"));
const { buildWorld } = await import(L("functions/scripts/certificationWorld/build.mjs"));

const STAMP = Timestamp.fromDate(new Date("2026-08-01T00:00:00.000Z"));
const asStored = (record) => ({ createdAt: STAMP, updatedAt: STAMP, ...record.data });
/** The shape validatePart accepts — the catalog's own view of a Part, without the stored envelope. */
const asInput = (record) => {
  const {
    version, createdBy, updatedBy, sku, certLedgerTrackingMode, partTrackingMode,
    certFamily, certLineOfBusiness, certManufacturer, certModelNumber, dataProvenance, ...input
  } = record.data;
  return input;
};

const world = buildWorld();
const asResolverParts = () => world.parts.map((r) => ({
  partId: r.id, status: r.data.status, wholeUnit: r.data.wholeUnit, equipmentModelId: r.data.equipmentModelId,
}));

test("the catalog is one Part per MODEL, and small on purpose", () => {
  // The Owner's decision. One Part per physical machine would put instance identity in two places at
  // once -- the Part id and the serial -- and every count would be a count of one. Forty-eight (one
  // per registry model) would be forty Parts with no unit under them.
  assert.ok(WHOLE_UNIT_PARTS.length >= 6 && WHOLE_UNIT_PARTS.length <= 10,
    `expected 6-10 whole-unit Parts, got ${WHOLE_UNIT_PARTS.length}`);
  assert.equal(new Set(WHOLE_UNIT_PARTS.map((p) => p.equipmentModelId)).size, WHOLE_UNIT_PARTS.length,
    "two Parts naming the same model would make the resolver ambiguous");
});

test("every whole-unit Part passes the REAL Part Master validator", () => {
  for (const p of WHOLE_UNIT_PARTS) {
    const result = validatePart(asInput(wholeUnitPartRecordFor(p)));
    assert.ok(result.valid, `${p.partId}: ${JSON.stringify(result.errors)}`);
    assert.equal(result.value.wholeUnit, true);
    assert.equal(result.value.equipmentModelId, p.equipmentModelId);
  }
});

test("every whole-unit Part is readable by the real stored-record reader", () => {
  for (const p of WHOLE_UNIT_PARTS) {
    const record = wholeUnitPartRecordFor(p);
    const stored = partFromFirestore(record.id, asStored(record));
    assert.equal(stored.part.wholeUnit, true);
    assert.equal(stored.part.controlType, "SERIALIZED");
  }
});

test("MUTATION: the FK alone is refused -- whole-unit is never inferred", () => {
  // The guardrail the Owner named directly. If this passed, any Part could acquire a machine's
  // semantics by gaining a model link, and the classification would mean nothing.
  const input = asInput(wholeUnitPartRecordFor(WHOLE_UNIT_PARTS[0]));
  const result = validatePart({ ...input, wholeUnit: false });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "equipmentModelId" && e.code === "INVALID_COMBINATION"),
    `expected equipmentModelId INVALID_COMBINATION, got ${JSON.stringify(result.errors)}`);
});

test("MUTATION: a whole-unit Part that is not SERIALIZED is refused", () => {
  // A quantity-tracked machine cannot carry a serial, and every downstream authority --
  // acquisition, install, custody -- is keyed on one.
  const input = asInput(wholeUnitPartRecordFor(WHOLE_UNIT_PARTS[0]));
  const result = validatePart({ ...input, controlType: "STANDARD" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "wholeUnit"), JSON.stringify(result.errors));
});

test("MUTATION: a NON-CANONICAL equipmentModelId is refused", () => {
  // This is the rule that forced the registry correction in the first place. The old certification
  // id scheme could not have been written onto a Part at all.
  const input = asInput(wholeUnitPartRecordFor(WHOLE_UNIT_PARTS[0]));
  const result = validatePart({ ...input, equipmentModelId: "cw-model-taylor-c713" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "equipmentModelId" && e.code === "INVALID_FORMAT"),
    JSON.stringify(result.errors));
});

test("the REAL fulfillment resolver finds each Part from its model", () => {
  // resolveEligibleWholeUnitParts is what an order for "a C713" actually calls. A Part the resolver
  // cannot reach is a Part nothing can sell.
  const parts = asResolverParts();
  for (const p of WHOLE_UNIT_PARTS) {
    assert.deepEqual(resolveEligibleWholeUnitParts(p.equipmentModelId, parts), [p.partId]);
  }
});

test("a model with NO whole-unit Part resolves to nothing, rather than to something close", () => {
  // 48 models, 8 whole-unit Parts. The other 40 are models the installed base runs and the company
  // does not stock as new machines, and the honest answer for those is an empty list.
  const parts = asResolverParts();
  const stocked = new Set(WHOLE_UNIT_PARTS.map((p) => p.equipmentModelId));
  const unstocked = world.equipmentModels.map((m) => m.id).filter((id) => !stocked.has(id));
  assert.ok(unstocked.length > 0, "the check is vacuous if every model is stocked");
  for (const id of unstocked) assert.deepEqual(resolveEligibleWholeUnitParts(id, parts), []);
});

test("the cohort the catalog declares is the cohort that was authorized", () => {
  // 17 Taylor and 13 Ventana/Icetro. Declared beside the Part rather than in the cohort builder, so
  // the cohort cannot drift onto a model that has no Part to hold it.
  assert.deepEqual(cohortUnitsByLine(), { TAYLOR: 17, VENTANA: 13 });
});

test("BOTH Icetro families are represented", () => {
  // Ventana's business is ice machines. A whole-unit catalog carrying only Icetro soft serve would
  // leave that line nothing to sell and make the Taylor/Ventana split unmeasurable on the pool.
  const ventana = WHOLE_UNIT_PARTS.filter((p) => p.lineOfBusiness === "VENTANA");
  const families = new Set(ventana.map((p) => p.family));
  assert.ok(families.has("SOFT_SERVE"), "Icetro soft serve missing");
  assert.ok([...families].some((f) => f.startsWith("ICE_")), `no Icetro ice family: ${[...families]}`);
});

test("whole-unit Parts do not disturb the service catalog's inventory conditions", () => {
  // The six inventory conditions are keyed on the SERVICE catalog's index. Prepending eight Parts
  // would shift every condition by eight and silently rewrite all six scenarios.
  const serviceIds = world.parts.filter((r) => !r.data.wholeUnit).map((r) => r.id);
  assert.deepEqual(serviceIds, serviceIds.filter((id) => id.startsWith("CW-P-")),
    "the service catalog must be exactly the CW-P- parts");
  assert.equal(world.parts.slice(0, serviceIds.length).every((r) => !r.data.wholeUnit), true,
    "whole-unit Parts must be APPENDED, never interleaved");
});
