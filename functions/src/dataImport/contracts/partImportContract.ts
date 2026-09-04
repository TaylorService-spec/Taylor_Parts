// EOS Data Import -- the canonical PART import contract.
//
// PORTABILITY BOUNDARY (Owner data-plane ruling). This module is deliberately PURE:
// no firebase-admin import, no Firestore collection name, no DocumentReference, no
// Timestamp, no project id. It maps ordinary JavaScript values to the Part DOMAIN
// shape, and a data-plane adapter is what turns that into storage. A customer-hosted
// deployment replaces the adapter, never this file.
//
// DERIVED FROM THE DOMAIN, NOT FROM STORAGE. Every field, enum and invariant below is
// taken from functions/src/partMaster/types.ts (the Part domain type) and its
// validator -- not from a Firestore document dump. Where the domain owns a rule, this
// contract defers to it rather than restating it: the canonical layer decides what a
// SOURCE FILE is allowed to say, and validatePart remains the authority on what a
// legitimate Part is. Two validators that both "know" the Part rules would drift.
//
// WHAT THIS FILE OWNS
//   * which canonical fields a source file may address, and which are required;
//   * how a spreadsheet's loose text becomes a typed domain value (normalization);
//   * the deterministic, human-readable reasons a row cannot become a Part.
//
// WHAT IT DOES NOT OWN
//   * whether the resulting Part is valid (validatePart);
//   * whether it may be written (the trusted createPart command's authorization);
//   * where it is stored (the data-plane adapter).

import {
  CONTROL_TYPES,
  PART_STATUSES,
  STOCKING_CLASSES,
  OEM_STATUSES,
  type ControlType,
  type PartStatus,
  type StockingClass,
  type OemStatus,
} from "../../partMaster/types.js";
import { isUnitCode } from "../../partMaster/units.js";

export const PART_IMPORT_CONTRACT_VERSION = 1;

/** Severity taxonomy shared by every entity contract. */
export type FindingSeverity = "ERROR" | "WARNING";

export interface FieldFinding {
  readonly severity: FindingSeverity;
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

/**
 * A canonical field a source column may be mapped to.
 *
 * `required` is about the SOURCE FILE, not about the stored Part: a field the domain
 * defaults (status) is optional here even though the Part always ends up with one.
 */
export interface CanonicalFieldSpec {
  readonly field: string;
  readonly label: string;
  readonly required: boolean;
  readonly description: string;
  /** Values a mapping UI can offer directly, when the field is a closed set. */
  readonly enumValues?: readonly string[];
  /** Lower-cased source header fragments that strongly imply this field. */
  readonly synonyms: readonly string[];
}

// The canonical Part import fields. Deliberately a SUBSET of the Part domain type:
// P1 imports the identity and classification a source system actually carries.
// Fields the domain owns but a spreadsheet has no business asserting -- notably the
// equipment-model FK and the whole-unit guardrail, whose invariants are enforced at
// the command layer against the equipment_models catalog -- are NOT importable here.
// Adding them later is additive; inventing them now would let a CSV assert a governed
// relationship it cannot substantiate.
export const PART_CANONICAL_FIELDS: readonly CanonicalFieldSpec[] = Object.freeze([
  Object.freeze({
    field: "internalPartNumber",
    label: "Internal Part Number",
    required: true,
    description: "The governed internal identifier. This is the Part's identity for import.",
    synonyms: ["internalpartnumber", "internal part number", "partnumber", "part number", "partno", "part no", "part_no", "sku", "itemnumber", "item number", "itemno", "item_number", "internalpn", "pn"],
  }),
  Object.freeze({
    field: "name",
    label: "Name",
    required: true,
    description: "Short human-readable name.",
    synonyms: ["name", "partname", "part name", "itemname", "item name", "shortdescription", "short description", "title"],
  }),
  Object.freeze({
    field: "description",
    label: "Description",
    required: false,
    description: "Longer description.",
    synonyms: ["description", "desc", "longdescription", "long description", "details"],
  }),
  Object.freeze({
    field: "category",
    label: "Category",
    required: false,
    description: "Free-text grouping carried from the source system.",
    synonyms: ["category", "class", "group", "producttype", "product type", "type"],
  }),
  Object.freeze({
    field: "status",
    label: "Status",
    required: false,
    description: "Lifecycle status. Defaults to DRAFT when the source does not say.",
    enumValues: PART_STATUSES,
    synonyms: ["status", "partstatus", "part status", "state", "lifecycle"],
  }),
  Object.freeze({
    field: "stockingUnit",
    label: "Stocking Unit",
    required: true,
    description: "Governed unit code the part is stocked in.",
    synonyms: ["stockingunit", "stocking unit", "unit", "uom", "u/m", "unitofmeasure", "unit of measure", "baseunit"],
  }),
  Object.freeze({
    field: "controlType",
    label: "Control Type",
    required: true,
    description: "How units are controlled: STANDARD, SERIALIZED, LOT or SERIALIZED_LOT.",
    enumValues: CONTROL_TYPES,
    synonyms: ["controltype", "control type", "tracking", "trackingtype", "tracking type", "serialized", "control"],
  }),
  Object.freeze({
    field: "stockingClass",
    label: "Stocking Class",
    required: true,
    description: "STOCKED, NON_STOCK, SERVICE or KIT.",
    enumValues: STOCKING_CLASSES,
    synonyms: ["stockingclass", "stocking class", "stockclass", "stock class", "itemclass", "item class"],
  }),
  Object.freeze({
    field: "manufacturerPartNumber",
    label: "Manufacturer Part Number",
    required: false,
    description: "Primary manufacturer part number, as displayed by the source.",
    synonyms: ["manufacturerpartnumber", "manufacturer part number", "mpn", "mfgpn", "mfg pn", "mfrpartnumber", "vendorpartnumber"],
  }),
  Object.freeze({
    field: "oemStatus",
    label: "OEM Status",
    required: false,
    description: "OEM, AFTERMARKET or UNKNOWN.",
    enumValues: OEM_STATUSES,
    synonyms: ["oemstatus", "oem status", "oem", "aftermarket"],
  }),
  Object.freeze({
    field: "expiryTracked",
    label: "Expiry Tracked",
    required: false,
    description: "Boolean flag. Defaults to false.",
    synonyms: ["expirytracked", "expiry tracked", "expiry", "hasexpiry", "shelflife", "shelf life"],
  }),
  Object.freeze({
    field: "consumable",
    label: "Consumable",
    required: false,
    description: "Boolean flag. Defaults to false.",
    synonyms: ["consumable", "isconsumable"],
  }),
  Object.freeze({
    field: "returnableCore",
    label: "Returnable Core",
    required: false,
    description: "Boolean flag. Defaults to false.",
    synonyms: ["returnablecore", "returnable core", "core", "corereturn", "core return"],
  }),
]);

export const PART_REQUIRED_FIELDS: readonly string[] = Object.freeze(
  PART_CANONICAL_FIELDS.filter((f) => f.required).map((f) => f.field),
);

export function partCanonicalField(field: string): CanonicalFieldSpec | null {
  return PART_CANONICAL_FIELDS.find((f) => f.field === field) ?? null;
}

// ---------------------------------------------------------------------------
// Normalization -- spreadsheet text to typed domain values.
// ---------------------------------------------------------------------------

/** Trim and collapse internal whitespace. A cell of only whitespace is absent. */
export function normalizeText(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).replace(/\s+/g, " ").trim();
  return s === "" ? undefined : s;
}

const TRUE_TOKENS = new Set(["true", "t", "yes", "y", "1"]);
const FALSE_TOKENS = new Set(["false", "f", "no", "n", "0", ""]);

export function normalizeBoolean(raw: unknown): { ok: true; value: boolean } | { ok: false; reason: string } {
  if (raw === null || raw === undefined) return { ok: true, value: false };
  if (typeof raw === "boolean") return { ok: true, value: raw };
  const s = String(raw).trim().toLowerCase();
  if (TRUE_TOKENS.has(s)) return { ok: true, value: true };
  if (FALSE_TOKENS.has(s)) return { ok: true, value: false };
  return { ok: false, reason: `expected a yes/no value, got "${String(raw)}"` };
}

/**
 * Enum normalization is case- and separator-insensitive on the SOURCE side only:
 * "serialized lot", "Serialized-Lot" and "SERIALIZED_LOT" are the same intent. It
 * never invents a member -- an unrecognized value is an error, not a default.
 */
export function normalizeEnum<T extends string>(raw: unknown, allowed: readonly T[]): { ok: true; value: T } | { ok: false; reason: string } {
  const s = normalizeText(raw);
  if (s === undefined) return { ok: false, reason: "value is empty" };
  const key = s.toUpperCase().replace(/[\s-]+/g, "_");
  const hit = allowed.find((a) => a === key);
  if (hit) return { ok: true, value: hit };
  return { ok: false, reason: `"${s}" is not one of: ${allowed.join(", ")}` };
}

/**
 * Source-side unit aliases -> governed unit codes.
 *
 * The domain's codes are EACH, BOX, CASE and so on; every real export writes "EA".
 * Bridging that is exactly what an import contract is for, and doing it here keeps the
 * governed unit vocabulary (units.ts) untouched -- this maps INTO it, never extends it.
 *
 * Deliberately a short allowlist of unambiguous abbreviations. Anything not listed
 * stays an error: guessing at a unit silently changes what a quantity means.
 */
export const UNIT_SOURCE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  EA: "EACH",
  EACH: "EACH",
  PC: "EACH",
  PCS: "EACH",
  PIECE: "EACH",
  UNIT: "EACH",
  KT: "KIT",
  KIT: "KIT",
  BTL: "BOTTLE",
  BOTTLE: "BOTTLE",
  TB: "TUBE",
  TUBE: "TUBE",
  BX: "BOX",
  BOX: "BOX",
  CS: "CASE",
  CASE: "CASE",
  RL: "ROLL",
  ROLL: "ROLL",
  FT: "FOOT",
  FOOT: "FOOT",
  FEET: "FOOT",
  GAL: "GALLON",
  GALLON: "GALLON",
  OZ: "OUNCE",
  OUNCE: "OUNCE",
  LB: "POUND",
  LBS: "POUND",
  POUND: "POUND",
});

/** Resolve a source unit string to a governed unit code, or null when unrecognised. */
export function resolveStockingUnit(raw: unknown): string | null {
  const s = normalizeText(raw);
  if (s === undefined) return null;
  const key = s.toUpperCase().replace(/[\s.]+/g, "");
  const mapped = UNIT_SOURCE_ALIASES[key];
  if (mapped !== undefined) return mapped;
  return isUnitCode(key) ? key : null;
}

export interface CanonicalPartDraft {
  readonly internalPartNumber: string;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly status: PartStatus;
  readonly stockingUnit: string;
  readonly controlType: ControlType;
  readonly stockingClass: StockingClass;
  readonly manufacturerPartNumber?: string;
  readonly oemStatus?: OemStatus;
  readonly flags: { readonly expiryTracked: boolean; readonly consumable: boolean; readonly returnableCore: boolean };
}

export interface NormalizedPartRow {
  readonly draft: CanonicalPartDraft | null;
  readonly findings: readonly FieldFinding[];
}

function err(field: string, code: string, message: string): FieldFinding {
  return Object.freeze({ severity: "ERROR" as const, field, code, message });
}
function warn(field: string, code: string, message: string): FieldFinding {
  return Object.freeze({ severity: "WARNING" as const, field, code, message });
}

/**
 * Turn one mapped source row into a canonical Part draft.
 *
 * `values` is keyed by CANONICAL field name -- mapping has already happened. This
 * function therefore knows nothing about source column names, which is what lets the
 * same contract serve a CSV, an XLSX, or any future source.
 *
 * Never throws: a bad row yields findings and a null draft. Import must be able to
 * report every problem in a file, not stop at the first one.
 */
export function normalizePartRow(values: Readonly<Record<string, unknown>>): NormalizedPartRow {
  const findings: FieldFinding[] = [];

  const internalPartNumber = normalizeText(values.internalPartNumber);
  if (internalPartNumber === undefined) {
    findings.push(err("internalPartNumber", "REQUIRED_MISSING", "Internal Part Number is required and identifies the Part."));
  }

  const name = normalizeText(values.name);
  if (name === undefined) {
    findings.push(err("name", "REQUIRED_MISSING", "Name is required."));
  }

  const stockingUnitRaw = normalizeText(values.stockingUnit);
  let stockingUnit: string | undefined;
  if (stockingUnitRaw === undefined) {
    findings.push(err("stockingUnit", "REQUIRED_MISSING", "Stocking Unit is required."));
  } else {
    const resolved = resolveStockingUnit(stockingUnitRaw);
    if (resolved === null) {
      findings.push(
        err("stockingUnit", "UNIT_UNKNOWN", `"${stockingUnitRaw}" is not a governed unit code or a recognised abbreviation.`),
      );
    } else {
      stockingUnit = resolved;
    }
  }

  let controlType: ControlType | undefined;
  if (normalizeText(values.controlType) === undefined) {
    findings.push(err("controlType", "REQUIRED_MISSING", "Control Type is required."));
  } else {
    const r = normalizeEnum(values.controlType, CONTROL_TYPES);
    if (r.ok) controlType = r.value;
    else findings.push(err("controlType", "ENUM_INVALID", `Control Type ${r.reason}.`));
  }

  let stockingClass: StockingClass | undefined;
  if (normalizeText(values.stockingClass) === undefined) {
    findings.push(err("stockingClass", "REQUIRED_MISSING", "Stocking Class is required."));
  } else {
    const r = normalizeEnum(values.stockingClass, STOCKING_CLASSES);
    if (r.ok) stockingClass = r.value;
    else findings.push(err("stockingClass", "ENUM_INVALID", `Stocking Class ${r.reason}.`));
  }

  // Status defaults to DRAFT. An imported Part is not assumed live: a source system's
  // idea of "active" is not EOS's, and DRAFT is the honest landing state.
  let status: PartStatus = "DRAFT";
  if (normalizeText(values.status) !== undefined) {
    const r = normalizeEnum(values.status, PART_STATUSES);
    if (r.ok) status = r.value;
    else findings.push(err("status", "ENUM_INVALID", `Status ${r.reason}.`));
  }

  let oemStatus: OemStatus | undefined;
  if (normalizeText(values.oemStatus) !== undefined) {
    const r = normalizeEnum(values.oemStatus, OEM_STATUSES);
    if (r.ok) oemStatus = r.value;
    else findings.push(err("oemStatus", "ENUM_INVALID", `OEM Status ${r.reason}.`));
  }

  const flags = { expiryTracked: false, consumable: false, returnableCore: false };
  for (const flag of ["expiryTracked", "consumable", "returnableCore"] as const) {
    if (values[flag] === undefined || values[flag] === null || String(values[flag]).trim() === "") continue;
    const r = normalizeBoolean(values[flag]);
    if (r.ok) flags[flag] = r.value;
    else findings.push(err(flag, "BOOLEAN_INVALID", `${flag}: ${r.reason}.`));
  }

  const description = normalizeText(values.description);
  const category = normalizeText(values.category);
  const manufacturerPartNumber = normalizeText(values.manufacturerPartNumber);

  // A SERIALIZED control type with no manufacturer part number is importable but worth
  // flagging: serialized stock is usually identified against a manufacturer's numbering.
  if ((controlType === "SERIALIZED" || controlType === "SERIALIZED_LOT") && manufacturerPartNumber === undefined) {
    findings.push(
      warn("manufacturerPartNumber", "SERIALIZED_WITHOUT_MPN", "Serialized parts usually carry a manufacturer part number. Imported without one."),
    );
  }

  const hasError = findings.some((f) => f.severity === "ERROR");
  if (hasError || !internalPartNumber || !name || !stockingUnit || !controlType || !stockingClass) {
    return Object.freeze({ draft: null, findings: Object.freeze(findings) });
  }

  return Object.freeze({
    draft: Object.freeze({
      internalPartNumber,
      name,
      description,
      category,
      status,
      stockingUnit,
      controlType,
      stockingClass,
      manufacturerPartNumber,
      oemStatus,
      flags: Object.freeze(flags),
    }),
    findings: Object.freeze(findings),
  });
}
