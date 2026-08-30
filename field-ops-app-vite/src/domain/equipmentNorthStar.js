// Equipment North Star P1v2.1 — the family's derivation layer.
//
// PURE: no Firebase, no network, no React, no clock, no input mutation. It composes governed facts
// other modules already own and derives no business fact of its own. Every value it returns is
// either a stored value turned into a word by an existing vocabulary, or a sentence stating why
// something is not there.
//
// ============================ WHAT THIS MODULE MAY NOT DO ============================
//
// EQ-G5 (design-locked, and already a recorded gap on the entity definition —
// `EQUIPMENT_BUSINESS_LINE_NOT_RECORDED` in metadata/definitions/equipment.js):
//
//   * It never derives an operating company for an INSTALLED unit. Not from the Account, not from
//     the location, not from the manufacturer. A customer may own machines from both Taylor and
//     Ventana — that is the ordinary case for a customer who buys from both operating companies —
//     so a derived value would be confidently wrong for exactly the customers it matters most for.
//     `installedOperatingCompany()` is the seam, and it answers UNKNOWN with the reason, always.
//
//   * The AVAILABLE pool is a different question with a different answer, and it is not this
//     module's. `wholeUnitAssetDisplay.js` classifies company stock through the governed
//     composition (Serialized Asset → whole-unit Part → canonical equipmentModelId → manufacturer →
//     the declared manufacturer-to-operating-line mapping). Nothing here duplicates or widens it.
//
// EQ-D2: `warrantyExpiresDate` is displayed exactly as recorded. There is deliberately no helper
// here that compares it to a date, counts days, or produces the words "in warranty" / "expired".
// A record page that judged warranty status would be asserting a coverage fact no authority in this
// system holds.
//
// EQ-D1 / EQ-D3 / EQ-D4: no repair economics, no opportunity linkage, no compatible-parts
// composition. Their absence is proved by test rather than merely intended.
import { equipmentStatusLabel } from "./equipmentStatus.js";
import { WORK_ORDER_STATUS_LABEL } from "./workOrderStatus.js";
import { WORK_ORDER_TYPE_LABEL } from "./workOrderType.js";
import { equipmentDisplayName, equipmentSummary } from "./equipment.js";
import { TIMELINE_SOURCE } from "./serializedAssetInstallation.js";

const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** A stored value's word, or null when the value is absent or outside its vocabulary. Never the
 * stored token itself: a raw enum reaching a reader is the defect this indirection prevents. */
function word(map, value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(map, value) ? map[value] : null;
}

// ────────────────────────────── 1c · the record's identity ──────────────────────────────

/**
 * The kicker above the title: `Equipment · {manufacturer} {model}`.
 *
 * Words only, and absent segments are dropped rather than filled. A unit whose manufacturer was
 * never recorded says "Equipment" and nothing more — which is true — instead of "Equipment ·
 * undefined". The document id is not a segment and cannot become one.
 */
export function equipmentRecordKicker(equipment) {
  const product = [str(equipment?.manufacturer), str(equipment?.model)].filter(Boolean).join(" ");
  return ["Equipment", product || null].filter(Boolean).join(" · ");
}

/**
 * Title and subtitle.
 *
 * `name` is the human reference this collection declares (metadata/definitions/equipment.js's
 * identity: nameField "name", and deliberately NO referenceField — serialNumber and assetTag are
 * both optional and neither is unique). A unit with no name says so; it never falls back to the
 * document id, which is what DECISIONS #106 forbids and what `RecordIdentity` refuses to accept as
 * a prop in the first place.
 *
 * The subtitle is the disambiguating summary the register already builds — manufacturer, model,
 * serial, asset tag — because duplicate names are legal on this collection.
 */
export function equipmentRecordIdentity(equipment) {
  const name = str(equipment?.name);
  const summary = equipmentSummary(equipment);
  return {
    title: name ?? equipmentDisplayName(equipment),
    titleIsAbsent: name === null,
    subtitle: summary || null,
  };
}

/** The facts the HEADER states. The record shell may not repeat any of these. */
export const EQUIPMENT_RECORD_HEADER_FACT_KEYS = Object.freeze(["status", "manufacturer", "model", "serialNumber"]);

/**
 * The header's fact line, in order.
 *
 * NO CUSTOMER AND NO LOCATION FACT, and the omission is the design's, not an oversight. Both live
 * in the "Customer & location" panel, which distinguishes a FAILED read from a genuinely-unknown
 * one and offers a Retry. A header fact has no slot for that, and stating a not-yet-known value
 * beside the title is how "we could not look" becomes "Unknown customer" said as a fact.
 *
 * NO OPERATING-COMPANY FACT (EQ-G5). See `installedOperatingCompany`.
 */
export function equipmentRecordFacts(equipment) {
  const facts = [];
  const status = equipmentStatusLabel(equipment?.status);
  if (status) facts.push({ key: "status", label: "Status", value: status, isStatus: true });

  const manufacturer = str(equipment?.manufacturer);
  if (manufacturer) facts.push({ key: "manufacturer", label: "Manufacturer", value: manufacturer });

  const model = str(equipment?.model);
  if (model) facts.push({ key: "model", label: "Model", value: model });

  const serial = str(equipment?.serialNumber);
  // Serial is CONTEXT, not identity: it is optional and not enforced unique, which is exactly why
  // it is a fact beside the title rather than the title itself.
  if (serial) facts.push({ key: "serialNumber", label: "Serial", value: serial });

  return facts;
}

/**
 * The record shell's definition, with the ONE fact the identity header owns removed.
 *
 * A record that states its status beside the title and again in a field grid has said one thing
 * twice and taught the reader to skim both — the rule family 7 enforces structurally with
 * `partRecordRailSubset`. This is the same rule, computed rather than hand-maintained, so the field
 * cannot reappear below the header by editing the page definition.
 *
 * IT REMOVES ONLY `status`, and the narrowness is the point. Manufacturer, model and serial number
 * are stated in BOTH places on purpose and the locked 1c frame draws them that way: in the header
 * they are scannable identity context, and in the grid they are the editable record — the grid is
 * the only place a pencil can live, and `updateEquipment` accepts all three. Status is different:
 * it is not on `EDITABLE_EQUIPMENT_FIELDS` (ACTIVE↔INACTIVE is the edit modal's guarded transition,
 * not a pencil), so removing it from the grid costs no affordance at all.
 *
 * A section left with no fields is dropped rather than rendered as an empty heading.
 */
export const EQUIPMENT_RECORD_HEADER_OWNED_FIELD = "status";

export function equipmentRecordShellDefinition(definition) {
  const sections = (definition?.sections ?? [])
    .map((section) => {
      const fieldIds = (section.fieldIds ?? []).filter((id) => id !== EQUIPMENT_RECORD_HEADER_OWNED_FIELD);
      return fieldIds.length === section.fieldIds?.length
        ? section
        : Object.freeze({ ...section, fieldIds: Object.freeze(fieldIds) });
    })
    .filter((section) => (section.fieldIds ?? []).length > 0);
  return Object.freeze({ ...definition, sections: Object.freeze(sections) });
}

// NO TONE MAP HERE, deliberately. `equipmentStatusTone` already lives in domain/equipment.js and is
// what every Equipment surface already renders through. A second map beside the words would agree
// today and drift the first time one of them was updated — which is the exact failure
// equipmentStatus.js was created to end, one field over.

// ────────────────────────────── EQ-G5 · the operating-company seam ──────────────────────────────

export const INSTALLED_OPERATING_COMPANY_UNKNOWN_REASON =
  "Which operating company owns an installed unit is not recorded on the Equipment record, and it "
  + "cannot be derived from the customer — a customer may own machines from both Taylor and Ventana.";

/**
 * The operating company of an INSTALLED unit.
 *
 * Always UNKNOWN, deliberately, and this function exists so that stays falsifiable: a later
 * governed ownership authority composes in here, and until one does, nothing else in the family
 * may answer this question. Callers render the absence, or render nothing — never a guess.
 */
export function installedOperatingCompany(equipment) {
  const recorded = str(equipment?.operatingCompanyId);
  // NOT a fallback to the account, the location, or the manufacturer. If a governed field ever
  // carries the fact, it is the fact; otherwise the answer is that we do not know.
  return recorded
    ? { known: true, value: recorded, reason: null }
    : { known: false, value: null, reason: INSTALLED_OPERATING_COMPANY_UNKNOWN_REASON };
}

// ────────────────────────────── 1c · the activity timeline ──────────────────────────────

// Keyed by the SOURCE TOKENS the composer actually emits (`TIMELINE_SOURCE`, lowercase), not by an
// uppercase guess at them. Importing the constant is what stops the two drifting.
export const TIMELINE_SOURCE_LABEL = Object.freeze({
  [TIMELINE_SOURCE.SERVICE]: "Service",
  [TIMELINE_SOURCE.INVENTORY]: "Inventory",
});

/**
 * One timeline row, as words.
 *
 * THE DEFECT THIS CLOSES. The timeline printed `e.type` and `e.status` raw, so a row read
 * `Service · WO-873 · REPAIR · IN_PROGRESS` while every other Work Order surface in EOS already
 * sourced those words from WORK_ORDER_TYPE_LABEL / WORK_ORDER_STATUS_LABEL. A stored token reaching
 * a reader is the same defect family 7 corrected twice; it is corrected here rather than redrawn.
 *
 * An unrecognised token is DROPPED rather than printed. The alternative — printing it because it is
 * the only thing we have — is precisely what was wrong.
 */
export function timelineEventWords(row) {
  const source = row?.source === TIMELINE_SOURCE.INVENTORY ? TIMELINE_SOURCE.INVENTORY : TIMELINE_SOURCE.SERVICE;
  const ref = row?.ref ?? {};
  const isService = source === TIMELINE_SOURCE.SERVICE;

  const type = isService ? word(WORK_ORDER_TYPE_LABEL, ref.type) : null;
  const status = isService ? word(WORK_ORDER_STATUS_LABEL, ref.status) : null;
  const detail = [type, status].filter(Boolean).join(" · ") || null;

  return {
    sourceLabel: TIMELINE_SOURCE_LABEL[source],
    // The reference a person says out loud. `woNumber` is the Work Order's governed reference; the
    // document id is only ever the link target, never the label.
    reference: isService ? str(ref.woNumber) : null,
    workOrderId: isService ? str(ref.workOrderId) : null,
    detail,
    // For a non-service row the kind IS the event, and it arrives already human from its own source.
    fallbackEvent: isService ? "Work order" : str(row?.kind) ?? "Event",
  };
}

// ────────────────────────────── 1b · the install confirmation ──────────────────────────────

/**
 * The read-back the locked design requires before a consequential, non-reversible write.
 *
 * Four labelled rows — UNIT (product identity), SERIAL, CUSTOMER, INSTALLATION LOCATION — because
 * installation cannot be undone: `accountId`/`locationId` are immutable after create, nothing
 * clears the serialized asset's link, and no recovery authority exists. Returns null until both
 * choices are made, so a confirmation cannot render half-populated and be confirmed anyway.
 *
 * It composes only what the caller already resolved. It performs no lookup and invents no name: an
 * account or location with no name renders its absence, never its id.
 */
export function installConfirmationSummary({ unit, account, location } = {}) {
  const accountName = str(account?.name);
  const locationName = str(location?.name);
  if (!account || !location) return null;

  return Object.freeze([
    Object.freeze({ key: "unit", label: "Unit", value: str(unit?.title) ?? "Unidentified unit" }),
    Object.freeze({ key: "serial", label: "Serial number", value: str(unit?.serialNo) ?? "Not recorded" }),
    Object.freeze({ key: "customer", label: "Customer", value: accountName ?? "Name unavailable" }),
    Object.freeze({ key: "location", label: "Installation location", value: locationName ?? "Name unavailable" }),
  ]);
}

// The design's consequence copy, plus the sentence the repository already said and does not give
// up: "This cannot be undone." The artifact's wording ("Reassignment is not yet a general workflow")
// is accurate about the ROADMAP and softer about the ACT, and the directive's own rule is "do not
// imply install is reversible". Equipment `accountId`/`locationId` are immutable after create,
// nothing clears the serialized asset's link, and no recovery authority exists — so the flat
// sentence is the true one and it stays.
export const INSTALL_CONFIRMATION_CONSEQUENCE =
  "This assigns the unit to the customer and takes it out of available stock. Reassignment is not "
  + "yet a general workflow, and this cannot be undone — confirm the handoff deliberately.";

// ────────────────────────────── 1b · the available row ──────────────────────────────

export const LOCATION_UNAVAILABLE_LABEL = "Location unavailable";

/**
 * One Available Equipment row, as the locked 1b table states it: Unit · Serial · Model · Condition ·
 * Location. Five fields, five cells — never a sentence.
 *
 * FIVE COLUMNS WHERE THE ARTIFACT DRAWS FOUR, and the extra one is not decoration. The artifact's
 * Model column reads "Taylor C161", which is the product AND the model because every sample row's
 * whole-unit Part joined cleanly. Real rows do not all join: an asset with no whole-unit Part behind
 * it has no canonical model at all, and its best available label is the composed `title` (the Part's
 * name, else the derived product, else the internal part number). Folding that into a column headed
 * "Model" would label an internal part number as a model number, which is the mislabelling this
 * family's rules exist to prevent. So the product is its own cell and the model number is its own
 * cell, and each says only what it is.
 *
 * LOCATION. `locationResolved === false` means the governed display resolver could not map the id,
 * and that is an ABSENCE. The raw `currentLocationId` is never substituted: showing the key teaches
 * people to memorise internal identifiers and gives them nothing they can search by (EQ-G2, and the
 * presentation rule the design keeps unchanged).
 *
 * MODEL. Manufacturer and model are derived from the canonical equipmentModelId by
 * wholeUnitAssetDisplay; a unit whose whole-unit Part did not join carries neither, and the cell
 * says so rather than borrowing the title.
 */
export function availableRowCells(row) {
  const location = row?.locationResolved === false ? null : str(row?.location);
  const model = [str(row?.manufacturer), str(row?.modelNumber)].filter(Boolean).join(" ") || null;
  return Object.freeze({
    // `title` already degrades truthfully (Part name → derived product → internal part number →
    // a visible admission the join failed). It is not re-derived here.
    unit: str(row?.title) ?? "Unidentified unit",
    serial: str(row?.serialNo) ?? "Not recorded",
    model,
    condition: str(row?.lifecycleState),
    location,
    locationAbsence: location === null ? LOCATION_UNAVAILABLE_LABEL : null,
  });
}
