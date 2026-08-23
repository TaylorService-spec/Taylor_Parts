// WHOLE-UNIT ASSET DISPLAY — turning ids into something a person can read, without inventing facts.
//
// ============================ THE PROBLEM ============================
//
// The governed Available Equipment read returns exactly six fields, deliberately:
//
//   serialNo · partId · currentLocationId · inventoryState · currentEquipmentId · ownership
//
// Nothing in that is a manufacturer, a model, or a business line. Rendered raw, an available machine
// reads as `CW-WU-TAYLOR--C161 — S/N CW-C713-0005`, which is two identifiers and no product.
//
// ============================ TWO FIELD NAMES FOR THE SAME FACTS ============================
//
// By the time a row reaches this module it has passed through mapProjectionRowToAsset, which RENAMES
// `inventoryState` to `status` and `currentLocationId` to `location`, and re-derives
// `availableForAssignment` from both. So each field is read under BOTH names: the projected one
// first, the raw one as a fallback.
//
// That is not defensive padding -- reading only the raw names is a bug this module actually had, and
// it produced a list with no lifecycle state and no location while every unit test passed, because
// the tests fed it the raw shape the real surface never sends.
//
// ============================ WHERE THE WORDS COME FROM ============================
//
// The Part. A whole-unit Part carries a human `name`, a `category`, and -- the load-bearing one -- a
// CANONICAL `equipmentModelId` of the form `MANUFACTURER--MODEL`. That id is not a display string
// that happens to look structured; it IS the Equipment Compatibility registry's identity, minted by
// buildEquipmentModelId, and both halves are recoverable from it exactly.
//
// So manufacturer and model are DERIVED from identity rather than read from a second field that
// could disagree with it. `equipment_models` itself is deny-all to every client, so the registry
// record cannot be read here -- the id is the only part of it that reaches a browser, and it is
// enough.
//
// ============================ WHAT IS NOT DERIVED ============================
//
// The business line. "Icetro machines are Ventana's" is a business fact about how this company is
// organised, not something recoverable from a model number, so it is a declared mapping with an
// explicit UNKNOWN. A manufacturer nobody has classified renders as unclassified rather than being
// quietly filed under whichever line was listed first.
//
// PURE: no firebase, no persistence. Tested in wholeUnitAssetDisplay.test.mjs.

/** Registry identity is `MANUFACTURER--MODEL`. One separator, uppercase segments. */
const MODEL_ID_PATTERN = /^([A-Z0-9-]+)--([A-Z0-9-]+)$/;

export const LINE_OF_BUSINESS = Object.freeze({
  TAYLOR: "TAYLOR",
  VENTANA: "VENTANA",
  UNKNOWN: "UNKNOWN",
});

/**
 * Which operating company sells and services a manufacturer's equipment.
 *
 * A DECLARED business fact, not a derivation. Taylor's own line is Taylor; Icetro is distributed and
 * serviced by Ventana. Anything else is UNKNOWN, and UNKNOWN is a real answer -- defaulting an
 * unclassified manufacturer into either line would put a machine on the wrong company's books in
 * every report that splits by line.
 */
const LINE_BY_MANUFACTURER = Object.freeze({
  TAYLOR: LINE_OF_BUSINESS.TAYLOR,
  ICETRO: LINE_OF_BUSINESS.VENTANA,
});

/** How each line is named to a person. Ventana's label names the manufacturer too, because a user looking at an Icetro machine should not have to know the relationship to recognise it. */
export const LINE_LABEL = Object.freeze({
  [LINE_OF_BUSINESS.TAYLOR]: "Taylor",
  [LINE_OF_BUSINESS.VENTANA]: "Ventana / Icetro",
  [LINE_OF_BUSINESS.UNKNOWN]: "Unclassified line",
});

const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Title case for a manufacturer segment: TAYLOR -> Taylor. Model numbers are left exactly as minted. */
function manufacturerLabel(segment) {
  return segment.charAt(0) + segment.slice(1).toLowerCase();
}

/**
 * Split a canonical equipment model id into its two halves.
 *
 * Returns null for anything that is not canonical rather than guessing at a separator. A
 * non-canonical id is a defect elsewhere, and inventing a manufacturer from it would hide that.
 */
export function parseEquipmentModelId(equipmentModelId) {
  const match = MODEL_ID_PATTERN.exec(str(equipmentModelId) ?? "");
  if (!match) return null;
  const [, manufacturerId, modelNumber] = match;
  return {
    manufacturerId,
    modelNumber,
    manufacturer: manufacturerLabel(manufacturerId),
    lineOfBusiness: LINE_BY_MANUFACTURER[manufacturerId] ?? LINE_OF_BUSINESS.UNKNOWN,
  };
}

/**
 * Index whole-unit Parts by id, for joining onto assets.
 *
 * Only Parts that are genuinely whole-unit are indexed. A service part cannot describe a machine,
 * and letting one through would put a drive belt's name on a unit.
 */
export function indexWholeUnitParts(parts) {
  const out = new Map();
  for (const part of Array.isArray(parts) ? parts : []) {
    const partId = str(part?.partId) || str(part?.id) || str(part?.sku);
    if (!partId || part?.wholeUnit !== true) continue;
    out.set(partId, part);
  }
  return out;
}

/**
 * One available unit, described.
 *
 * Every display field degrades to a truthful fallback rather than to a blank or a guess: an asset
 * whose Part has not loaded still renders its serial and its raw part id, clearly marked
 * unclassified, instead of vanishing from a list somebody is using to decide what to install.
 */
export function composeWholeUnitAssetRow(asset, partsById) {
  const partId = str(asset?.partId);
  const part = partId ? partsById?.get?.(partId) ?? null : null;
  const model = parseEquipmentModelId(part?.equipmentModelId);

  return {
    serialNo: str(asset?.serialNo) ?? "",
    partId,
    // The PRIMARY LABEL is the product, never an id. Falls back through the Part's own name to the
    // derived "Taylor C161" and only then to the raw part id -- which is a visible admission that
    // the join failed, not a label anyone chose.
    title: str(part?.name)
      ?? (model ? `${model.manufacturer} ${model.modelNumber}` : null)
      ?? partId
      ?? "Unidentified unit",
    manufacturer: model?.manufacturer ?? null,
    modelNumber: model?.modelNumber ?? null,
    equipmentModelId: str(part?.equipmentModelId),
    lineOfBusiness: model?.lineOfBusiness ?? LINE_OF_BUSINESS.UNKNOWN,
    lineLabel: LINE_LABEL[model?.lineOfBusiness ?? LINE_OF_BUSINESS.UNKNOWN],
    category: str(part?.category),
    // Location prefers a resolved label from the governed location-display read; the raw id is the
    // documented fallback when neither authority recognises it. `location` is the projected name,
    // `currentLocationId` the raw one.
    location: str(asset?.locationLabel) ?? str(asset?.location) ?? str(asset?.currentLocationId) ?? null,
    locationResolved: Boolean(str(asset?.locationLabel)),
    lifecycleState: str(asset?.status) ?? str(asset?.inventoryState) ?? null,
    ownership: str(asset?.ownership) ?? null,
    // Availability: the projection ALREADY re-derived this from its own governed fields, so its
    // answer is preferred over deriving it a second time here. Where it is absent (a raw row), it is
    // derived from both halves -- AVAILABLE *and* belonging to nobody -- because either alone has
    // been wrong somewhere in this platform's history.
    available: asset?.availableForAssignment === true
      || (asset?.availableForAssignment === undefined
        && (asset?.status ?? asset?.inventoryState) === "AVAILABLE"
        && !str(asset?.currentEquipmentId)),
    installedEquipmentId: str(asset?.currentEquipmentId),
  };
}

/** Rows for a list, in a stable order: line, then product, then serial. */
export function composeWholeUnitAssetRows(assets, parts) {
  const partsById = indexWholeUnitParts(parts);
  return (Array.isArray(assets) ? assets : [])
    .map((a) => composeWholeUnitAssetRow(a, partsById))
    .sort((a, b) =>
      a.lineLabel.localeCompare(b.lineLabel)
      || a.title.localeCompare(b.title)
      || a.serialNo.localeCompare(b.serialNo));
}

/**
 * Counts per line, for the summary a person reads before scrolling.
 *
 * Only AVAILABLE units are counted. A total that quietly included an installed machine would be the
 * same category error as counting truck stock as warehouse stock.
 */
export function countAvailableByLine(rows) {
  const out = { [LINE_OF_BUSINESS.TAYLOR]: 0, [LINE_OF_BUSINESS.VENTANA]: 0, [LINE_OF_BUSINESS.UNKNOWN]: 0 };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.available) out[r.lineOfBusiness] = (out[r.lineOfBusiness] ?? 0) + 1;
  }
  return out;
}

/** Group rows by line for a sectioned list; empty lines are omitted rather than rendered as zero. */
export function groupRowsByLine(rows) {
  const groups = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!groups.has(r.lineOfBusiness)) groups.set(r.lineOfBusiness, []);
    groups.get(r.lineOfBusiness).push(r);
  }
  const order = [LINE_OF_BUSINESS.TAYLOR, LINE_OF_BUSINESS.VENTANA, LINE_OF_BUSINESS.UNKNOWN];
  return order
    .filter((line) => groups.has(line))
    .map((line) => ({ lineOfBusiness: line, label: LINE_LABEL[line], rows: groups.get(line) }));
}
