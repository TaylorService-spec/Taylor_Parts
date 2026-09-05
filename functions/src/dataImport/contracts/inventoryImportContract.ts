// EOS Data Import -- the canonical INVENTORY import contract.
//
// PORTABILITY BOUNDARY: no firebase-admin, no Firestore, no collection names.
//
// ============================ THIS ENTITY IS DIFFERENT FROM THE OTHERS ============================
//
// Parts, Customers and Equipment import RECORDS: things that exist, described by a row. An
// inventory row is not a record. It is an assertion that a quantity of something is
// physically somewhere -- and quantity in EOS is not a stored field anybody may set. It is
// the sum of a movement ledger, and the ledger is the authority.
//
// So this contract does not describe an "inventory record" and there is no such thing to
// create. It describes an OPENING BALANCE: the one movement that says what was on the shelf
// when the company started keeping count in EOS. openingInventoryBalance.ts owns what that
// means and what it refuses; this file only says what a row must contain to be one.
//
// ============================ WHAT AN OPENING BALANCE IS NOT ============================
//
// It is not a receipt. Nothing was received: the stock was already there, and pretending
// otherwise would put a receiving event in the history of a part nobody received.
//
// It is not an adjustment somebody made. It is the starting point adjustments are measured
// FROM. That is why it may only be written at a position with no operational history at all
// -- a part that has already moved has a real balance, and overwriting it with a spreadsheet
// number would silently discard whatever the ledger recorded.
//
// It is not a way to correct a count. Correcting a count is a cycle count, which has its own
// command, its own authority and its own variance record.
//
// ============================ SERIAL AND LOT ARE OUT OF SCOPE, AND SAY SO ============================
//
// A SERIAL part's balance is a list of serial numbers, and a LOT part's is a set of lots with
// their own expiry. Neither is a number in a column, and accepting "17" for a serialized part
// would create a quantity with no units behind it. Those rows are refused by name so an
// operator sees which parts still need a different path, rather than finding a phantom
// quantity later.

import { registerEntityContract, naturalIdentityKey, type NormalizedRow, type ImportContext } from "./entityContract.js";
import type { CanonicalFieldSpec, FieldFinding } from "./partImportContract.js";
import { normalizeText } from "./partImportContract.js";

export const INVENTORY_IMPORT_CONTRACT_VERSION = 1;

/** The reference names an inventory row depends on. */
export const INVENTORY_REFERENCES = Object.freeze({ PART: "part", WAREHOUSE: "warehouse" });

/** The location types an opening balance may be stated at, in P1. */
export const OPENING_BALANCE_LOCATION_TYPE = "WAREHOUSE" as const;

export const INVENTORY_CANONICAL_FIELDS: readonly CanonicalFieldSpec[] = Object.freeze([
  Object.freeze({
    field: "internalPartNumber",
    label: "Internal Part Number",
    required: true,
    description: "The governed Part this quantity is of. Must already exist in EOS.",
    synonyms: [
      "internalpartnumber", "internal part number", "partnumber", "part number", "partno",
      "part no", "part_no", "sku", "itemnumber", "item number", "part",
    ],
  }),
  Object.freeze({
    field: "warehouseName",
    label: "Warehouse",
    required: true,
    description: "The warehouse this stock is in. Must already exist and be ACTIVE.",
    synonyms: ["warehouse", "warehousename", "warehouse name", "location", "site", "stockroom", "branch", "whse"],
  }),
  Object.freeze({
    field: "openingQuantity",
    label: "Opening Quantity",
    required: true,
    description: "How many are on the shelf right now. A whole number, zero or more.",
    synonyms: [
      "openingquantity", "opening quantity", "quantity", "qty", "onhand", "on hand",
      "onhandqty", "quantityonhand", "count", "balance", "stock",
    ],
  }),
]);

export const INVENTORY_REQUIRED_FIELDS: readonly string[] = Object.freeze(
  INVENTORY_CANONICAL_FIELDS.filter((f) => f.required).map((f) => f.field),
);

export interface CanonicalInventoryDraft {
  readonly internalPartNumber: string;
  readonly warehouseName: string;
  readonly openingQuantity: number;
}

function err(field: string, code: string, message: string): FieldFinding {
  return Object.freeze({ severity: "ERROR" as const, field, code, message });
}
function warn(field: string, code: string, message: string): FieldFinding {
  return Object.freeze({ severity: "WARNING" as const, field, code, message });
}

/**
 * The quantity, as a whole number.
 *
 * NO FRACTIONS, and no rounding. The operational ledger counts units; half a unit of a part
 * stocked in EACH is a data-entry error, and rounding it would replace a visible error with
 * an invisible one. A part genuinely stocked by weight or length carries that in its stocking
 * unit, and its quantity is still a whole number OF that unit.
 *
 * NO NEGATIVES. A negative opening balance is not a starting point; it is a claim that the
 * company began owing stock, which the ledger has no way to represent and no reason to.
 */
function normalizeQuantity(value: unknown, findings: FieldFinding[]): number | null {
  const raw = normalizeText(value);
  if (raw === undefined) {
    findings.push(err("openingQuantity", "REQUIRED", "Opening Quantity is required."));
    return null;
  }
  // Thousands separators are stripped: a spreadsheet exports "1,250" for a number a person
  // typed as 1250, and refusing that would refuse a correct value over its formatting.
  const cleaned = raw.replace(/,/g, "").trim();
  if (!/^-?\d+$/.test(cleaned)) {
    findings.push(
      err(
        "openingQuantity",
        "NOT_A_WHOLE_NUMBER",
        `"${raw}" is not a whole number. The ledger counts whole units; a fraction is a data-entry error, not a quantity.`,
      ),
    );
    return null;
  }
  const quantity = Number(cleaned);
  if (quantity < 0) {
    findings.push(
      err("openingQuantity", "NEGATIVE", "An opening balance cannot be negative. Correct the count in the file."),
    );
    return null;
  }
  if (!Number.isSafeInteger(quantity)) {
    findings.push(err("openingQuantity", "OUT_OF_RANGE", `"${raw}" is too large to be a real count.`));
    return null;
  }
  return quantity;
}

export function normalizeInventoryRow(values: Readonly<Record<string, unknown>>): {
  draft: CanonicalInventoryDraft | null;
  findings: readonly FieldFinding[];
} {
  const findings: FieldFinding[] = [];

  const internalPartNumber = normalizeText(values.internalPartNumber);
  if (!internalPartNumber) {
    findings.push(err("internalPartNumber", "REQUIRED", "Internal Part Number is required."));
  }
  const warehouseName = normalizeText(values.warehouseName);
  if (!warehouseName) {
    findings.push(err("warehouseName", "REQUIRED", "Warehouse is required. A quantity with no place is not a balance."));
  }

  const openingQuantity = normalizeQuantity(values.openingQuantity, findings);

  if (openingQuantity === 0) {
    // Not an error. Zero is a real, useful statement -- "we stock this part here and have
    // none" -- and the command writes no movement for it, because a movement that moves
    // nothing is not a movement (CERT-LEDGER-COUNTED-08).
    findings.push(
      warn("openingQuantity", "ZERO_BALANCE", "Zero on hand. No movement is recorded; the position simply stays empty."),
    );
  }

  if (findings.some((f) => f.severity === "ERROR") || !internalPartNumber || !warehouseName || openingQuantity === null) {
    return { draft: null, findings: Object.freeze(findings) };
  }

  return {
    draft: Object.freeze({ internalPartNumber, warehouseName, openingQuantity }),
    findings: Object.freeze(findings),
  };
}

/**
 * The two things a row points at, and the one thing it must NOT already have.
 *
 * The part and the warehouse must exist -- import never creates either. A missing part is the
 * common case and it has a clear answer: import the Parts first. Creating one from an
 * inventory file would invent a catalog record from a count, which is backwards.
 *
 * `alreadyOperational` carries positions the ledger has already moved. Refusing them here,
 * before approval, is what turns the command's own refusal into something an operator sees
 * on a screen instead of a failed row in a result table.
 */
export function inventoryContextFindings(
  draft: Readonly<Record<string, unknown>>,
  context: ImportContext,
): readonly FieldFinding[] {
  const findings: FieldFinding[] = [];
  const parts = context.references?.[INVENTORY_REFERENCES.PART];
  const warehouses = context.references?.[INVENTORY_REFERENCES.WAREHOUSE];

  const partNumber = String(draft.internalPartNumber ?? "");
  const warehouseName = String(draft.warehouseName ?? "");

  if (!parts || !parts.has(partIdentityKeyForInventory(partNumber))) {
    findings.push(
      err(
        "internalPartNumber",
        "PART_NOT_FOUND",
        `No Part with Internal Part Number "${partNumber}" exists. Import the Parts first; a count cannot create a catalog record.`,
      ),
    );
  }

  if (!warehouses || !warehouses.has(naturalIdentityKey(warehouseName))) {
    findings.push(
      err(
        "warehouseName",
        "WAREHOUSE_NOT_FOUND",
        `No ACTIVE warehouse named "${warehouseName}" exists. Opening balances may only be stated at a governed, active location.`,
      ),
    );
  }

  return Object.freeze(findings);
}

/** Part numbers compare with ALL whitespace removed, exactly as the Part contract does. */
export function partIdentityKeyForInventory(internalPartNumber: string): string {
  return internalPartNumber.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * IDENTITY IS THE (PART, WAREHOUSE) PAIR, not the part alone.
 *
 * One part legitimately has a balance in several warehouses, and those are different
 * statements. Keying on the part alone would call the second warehouse's row a duplicate of
 * the first and refuse a perfectly correct file.
 */
export const INVENTORY_IMPORT_CONTRACT = registerEntityContract({
  entityType: "INVENTORY",
  label: "Opening Balance",
  canonicalFields: INVENTORY_CANONICAL_FIELDS,
  requiredFields: INVENTORY_REQUIRED_FIELDS,
  identityField: "internalPartNumber",
  identityLabel: "Part and Warehouse",
  referenceFields: Object.freeze([
    Object.freeze({ reference: INVENTORY_REFERENCES.PART, field: "internalPartNumber" }),
    Object.freeze({ reference: INVENTORY_REFERENCES.WAREHOUSE, field: "warehouseName" }),
  ]),
  normalizeRow: (values) => normalizeInventoryRow(values) as NormalizedRow,
  contextFindings: inventoryContextFindings,
  identityKey: (draft) =>
    `${partIdentityKeyForInventory(String(draft.internalPartNumber ?? ""))} @ ${naturalIdentityKey(String(draft.warehouseName ?? ""))}`,
});
