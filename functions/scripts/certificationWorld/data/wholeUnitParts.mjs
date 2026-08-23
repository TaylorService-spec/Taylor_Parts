// WHOLE-UNIT PARTS — the machine itself, as something inventory can hold and fulfillment can sell.
//
// ============================ WHY A MACHINE IS A PART AT ALL ============================
//
// Every other Part in this world is a component a machine CONSUMES: a drive belt, a control board, a
// door gasket. A whole-unit Part is the opposite -- it is the machine, and it exists because the
// platform has no other way to say "we hold two uninstalled C713s in the main warehouse".
//
// Stock lives on Parts. Serialized identity (`serialized_assets`) is scoped to `(partId, serialNo)`.
// Acquisition, receiving and install all take a partId. Without a Part for the model, an unassigned
// machine has nothing to be a unit OF -- which is why this file precedes the ~30-unit cohort rather
// than accompanying it.
//
// ============================ ONE PART PER MODEL, NOT PER UNIT ============================
//
// The Owner's decision, and it is the same distinction the rest of the catalog already makes: a Part
// is a KIND of thing, a serialized asset is an INSTANCE of it. One Part per physical machine would
// put instance identity in two places at once -- in the Part id and in the serial -- and every count,
// reorder point and compatibility link would then be a count of one.
//
// So `CW-WU-TAYLOR--C713` names the model. The eleven C713s the company owns are eleven
// serialized_assets under it, each with its own serial.
//
// ============================ THE GUARDRAILS ARE THE PRODUCT'S, NOT MINE ============================
//
// Part Master refuses a whole-unit Part that is not SERIALIZED, refuses `equipmentModelId` on a Part
// that has not DECLARED `wholeUnit: true` (the flag is never inferred from the FK), refuses a
// non-canonical `equipmentModelId`, and refuses a SERVICE stocking class. This file satisfies those
// rules; certificationPartMasterContract.test.mjs proves it against the real validator rather than
// against this comment.
import { TAYLOR_MODELS, ICETRO_MODELS, modelIdOf } from "./equipmentMasters.mjs";

const byModel = (list, modelNumber) => {
  const m = list.find((x) => x.modelNumber === modelNumber);
  // A typo here would otherwise mint a Part pointing at a model that does not exist, and the FK is
  // only checked at command time -- not when this fixture is built.
  if (!m) throw new Error(`whole-unit catalog names a model that is not in the master list: ${modelNumber}`);
  return m;
};

// ============================ WHICH MODELS ============================
//
// Eight, covering the cohort the sandbox needs: four Taylor soft-serve lines and four Icetro,
// deliberately split across BOTH Icetro families. Ventana's business is ice machines, so a whole-unit
// catalog that carried only Icetro soft serve would leave that line with nothing to sell and make the
// Taylor/Ventana reporting split unmeasurable on the uninstalled pool.
//
// Not one per model in the master list. Forty-eight whole-unit Parts would be forty of them with no
// unit under them -- a catalog padded to look complete, which is the failure mode the Owner named.
const SELECTED = Object.freeze([
  // Taylor — the four the cohort is drawn from.
  { model: byModel(TAYLOR_MODELS, "C161"), cohort: 4 },
  { model: byModel(TAYLOR_MODELS, "C709"), cohort: 4 },
  { model: byModel(TAYLOR_MODELS, "C712"), cohort: 4 },
  { model: byModel(TAYLOR_MODELS, "C713"), cohort: 5 },
  // Icetro soft serve — the line Taylor distributes.
  { model: byModel(ICETRO_MODELS, "ISI-203SN"), cohort: 3 },
  { model: byModel(ICETRO_MODELS, "ISI-301TH"), cohort: 3 },
  // Icetro ice — Ventana's own line, and a different family entirely.
  { model: byModel(ICETRO_MODELS, "IM-0460-AH"), cohort: 4 },
  { model: byModel(ICETRO_MODELS, "IU-0070-OU"), cohort: 3 },
]);

// The catalog author, named as itself for the same reason the service catalog is: nobody sat down
// and typed this, and attributing it to an employee who did not would be a lie in an audit field.
const PART_RECORD_AUTHOR = "certification-world-builder";

/**
 * The whole-unit catalog.
 *
 * `partId` embeds the canonical model id so the two can never disagree by hand-editing, and reads as
 * what it is on any screen that shows a raw id.
 */
export const WHOLE_UNIT_PARTS = Object.freeze(
  SELECTED.map(({ model, cohort }) => {
    const equipmentModelId = modelIdOf(model);
    return Object.freeze({
      partId: `CW-WU-${equipmentModelId}`,
      equipmentModelId,
      name: `${model.manufacturer} ${model.modelNumber}`,
      description: `${model.manufacturer} ${model.modelNumber} — ${model.config}`,
      category: "Whole Unit Equipment",
      manufacturer: model.manufacturer,
      modelNumber: model.modelNumber,
      lineOfBusiness: model.lineOfBusiness,
      family: model.family,
      // How many units of this model the unassigned cohort holds. Declared here, next to the Part,
      // so the cohort cannot silently drift to a model that has no Part.
      cohortUnits: cohort,
    });
  }),
);

/** Total units the cohort will hold, by line of business. Derived, never restated. */
export function cohortUnitsByLine() {
  const out = {};
  for (const p of WHOLE_UNIT_PARTS) out[p.lineOfBusiness] = (out[p.lineOfBusiness] ?? 0) + p.cohortUnits;
  return out;
}

/**
 * The stored record.
 *
 * SERIALIZED and STOCKED, not because a whole-unit Part could not in principle be something else,
 * but because both are forced: Part Master refuses a whole-unit Part that is not SERIALIZED (or
 * SERIALIZED_LOT), and refuses one classed SERVICE. `partTrackingMode: "SERIAL"` is the LEDGER's
 * vocabulary for the same fact -- the catalog says SERIALIZED, the ledger says SERIAL, and they are
 * genuinely different fields with different value sets (see partsCatalog.mjs).
 */
export function wholeUnitPartRecordFor(part) {
  return {
    collection: "parts",
    id: part.partId,
    data: {
      partId: part.partId,
      sku: part.partId,
      internalPartNumber: part.partId,
      name: part.name,
      description: part.description,
      category: part.category,
      partTrackingMode: "SERIAL",
      unitOfMeasure: "EA",
      stockingUnit: "EACH",
      stockingClass: "STOCKED",
      controlType: "SERIALIZED",
      certLedgerTrackingMode: "SERIAL",
      status: "ACTIVE",

      // THE WHOLE-UNIT DECLARATION AND ITS FK.
      //
      // Both, and in this order of authority: `wholeUnit` is the classification and
      // `equipmentModelId` is only permitted BECAUSE of it. Setting the FK alone is refused, by
      // design -- the platform never infers "this is a machine" from the presence of a model link.
      wholeUnit: true,
      equipmentModelId: part.equipmentModelId,

      certFamily: part.family,
      certLineOfBusiness: part.lineOfBusiness,
      certManufacturer: part.manufacturer,
      certModelNumber: part.modelNumber,
      // A machine is not reordered off a shelf threshold; it is bought against a sale. A reorder
      // point here would feed a demand signal that means nothing for this class of Part.
      dataProvenance: "SYNTHETIC_CERTIFICATION_FACT",

      version: 1,
      createdBy: PART_RECORD_AUTHOR,
      updatedBy: PART_RECORD_AUTHOR,
    },
  };
}
