// EOS Data Import -- the canonical EQUIPMENT import contract.
//
// PORTABILITY BOUNDARY: no firebase-admin, no Firestore, no collection names.
//
// ============================ EQUIPMENT IS NOT A PART ============================
//
// ADR-006 draws this line and import must not blur it. A Part is a catalog item -- a kind
// of thing, of which there may be four hundred in a warehouse. A piece of Equipment is ONE
// physical machine, at ONE customer, at ONE location. Importing an equipment file that is
// really a parts list would produce hundreds of "machines" nobody owns.
//
// ============================ WHY THE SERIAL NUMBER IS REQUIRED HERE ============================
//
// The Equipment domain does not require a serial number, and this contract does. That is a
// deliberate, narrow difference and it is about identity rather than about the domain.
//
// Import must be able to answer "have I seen this record before" -- inside one file, and
// against what is already in EOS. For a machine, the serial number is the only field that
// answers it. Two ice machines at one customer, same model, no serials: nothing can tell
// them apart, so a re-run creates two more and the register quietly doubles. The Owner's
// requirement for this entity is exactly that a duplicate serial fails closed, and a serial
// that may be absent cannot fail closed on anything.
//
// A machine genuinely without a serial is still creatable BY HAND, through the ordinary
// Equipment screen, where a person is looking at the register while they do it. Import is
// the bulk path, and the bulk path is where an untraceable duplicate does its damage.
//
// ============================ TWO FOREIGN KEYS, RESOLVED BY NAME ============================
//
// Equipment is meaningless without its customer and its location -- firestore.rules requires
// both on create, and requires the location to belong to the account. A spreadsheet carries
// NAMES, so import resolves names to ids and REFUSES a row whose customer or location it
// cannot find. It does not create the missing customer: an equipment file is evidence about
// machines, not about who the customer is, and inventing an account from a column would put
// a customer in EOS that nobody decided to add.

import { registerEntityContract, naturalIdentityKey, type NormalizedRow, type ImportContext } from "./entityContract.js";
import type { CanonicalFieldSpec, FieldFinding } from "./partImportContract.js";
import { normalizeText } from "./partImportContract.js";

export const EQUIPMENT_IMPORT_CONTRACT_VERSION = 1;

/** The reference names an Equipment row depends on. */
export const EQUIPMENT_REFERENCES = Object.freeze({ CUSTOMER: "customer", LOCATION: "location" });

export const EQUIPMENT_CANONICAL_FIELDS: readonly CanonicalFieldSpec[] = Object.freeze([
  Object.freeze({
    field: "serialNumber",
    label: "Serial Number",
    required: true,
    description: "The manufacturer's serial number. This is the machine's identity for import.",
    synonyms: ["serialnumber", "serial number", "serial", "serialno", "sn", "s/n", "machineserial"],
  }),
  Object.freeze({
    field: "customerName",
    label: "Customer Name",
    required: true,
    description: "The customer who owns this machine. Must already exist in EOS.",
    synonyms: ["customername", "customer name", "customer", "accountname", "account name", "account", "client"],
  }),
  Object.freeze({
    field: "locationName",
    label: "Location Name",
    required: true,
    description: "The customer location the machine sits at. Must already exist under that customer.",
    synonyms: ["locationname", "location name", "location", "site", "sitename", "site name", "branch", "store"],
  }),
  Object.freeze({
    field: "name",
    label: "Equipment Name",
    required: true,
    description: "What this machine is called in EOS -- how a technician will recognise it.",
    synonyms: ["name", "equipmentname", "equipment name", "description", "asset", "assetname", "unit", "unitname"],
  }),
  Object.freeze({
    field: "manufacturer",
    label: "Manufacturer",
    required: false,
    description: "Who made the machine.",
    synonyms: ["manufacturer", "make", "brand", "mfg", "mfr", "oem"],
  }),
  Object.freeze({
    field: "model",
    label: "Model",
    required: false,
    description: "The manufacturer's model designation.",
    synonyms: ["model", "modelnumber", "model number", "modelno", "type"],
  }),
  Object.freeze({
    field: "assetTag",
    label: "Asset Tag",
    required: false,
    description: "The customer's own tag or sticker number, when they use one.",
    synonyms: ["assettag", "asset tag", "tag", "tagnumber", "assetnumber", "asset number", "barcode"],
  }),
  Object.freeze({
    field: "installedDate",
    label: "Installed Date",
    required: false,
    description: "When the machine was installed, as YYYY-MM-DD.",
    synonyms: ["installeddate", "installed date", "installdate", "install date", "installed", "startdate", "inservice"],
  }),
  Object.freeze({
    field: "warrantyExpiresDate",
    label: "Warranty Expires",
    required: false,
    description: "When the warranty ends, as YYYY-MM-DD.",
    synonyms: ["warrantyexpiresdate", "warranty expires", "warrantyexpiry", "warranty end", "warrantyend", "warranty"],
  }),
  Object.freeze({
    field: "notes",
    label: "Notes",
    required: false,
    description: "Free text carried across as-is.",
    synonyms: ["notes", "note", "comments", "comment", "remarks"],
  }),
]);

export const EQUIPMENT_REQUIRED_FIELDS: readonly string[] = Object.freeze(
  EQUIPMENT_CANONICAL_FIELDS.filter((f) => f.required).map((f) => f.field),
);

const MAX_NAME_LENGTH = 200;
const MAX_TEXT_LENGTH = 2000;
const MAX_SERIAL_LENGTH = 100;

export interface CanonicalEquipmentDraft {
  readonly serialNumber: string;
  readonly customerName: string;
  readonly locationName: string;
  readonly name: string;
  /** Always ACTIVE. Reaching any other state is a lifecycle transition, not a create. */
  readonly status: "ACTIVE";
  readonly manufacturer?: string;
  readonly model?: string;
  readonly assetTag?: string;
  readonly installedDate?: string;
  readonly warrantyExpiresDate?: string;
  readonly notes?: string;
}

function err(field: string, code: string, message: string): FieldFinding {
  return Object.freeze({ severity: "ERROR" as const, field, code, message });
}
function warn(field: string, code: string, message: string): FieldFinding {
  return Object.freeze({ severity: "WARNING" as const, field, code, message });
}

/**
 * A calendar date, as YYYY-MM-DD and nothing else.
 *
 * NO LOCALE GUESSING. "03/04/2026" is the third of April in most of the world and the fourth
 * of March in the United States, and nothing in a CSV says which. A warranty that expires on
 * the wrong date is a real cost to somebody, so an ambiguous date is refused with an
 * instruction rather than resolved by assuming whoever exported the file shares our locale.
 */
function normalizeDate(field: string, value: unknown, findings: FieldFinding[]): string | undefined {
  const raw = normalizeText(value);
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) return raw;
    findings.push(err(field, "INVALID_DATE", `"${raw}" is not a real date.`));
    return undefined;
  }
  findings.push(
    err(field, "AMBIGUOUS_DATE", `"${raw}" is not a YYYY-MM-DD date. Reformat the column; a guessed date is worse than none.`),
  );
  return undefined;
}

export function normalizeEquipmentRow(values: Readonly<Record<string, unknown>>): {
  draft: CanonicalEquipmentDraft | null;
  findings: readonly FieldFinding[];
} {
  const findings: FieldFinding[] = [];

  const required = (field: string, label: string, max: number): string | undefined => {
    const v = normalizeText(values[field]);
    if (!v) {
      findings.push(err(field, "REQUIRED", `${label} is required.`));
      return undefined;
    }
    if (v.length > max) {
      findings.push(err(field, "TOO_LONG", `${label} exceeds ${max} characters.`));
      return undefined;
    }
    return v;
  };

  const serialNumber = required("serialNumber", "Serial Number", MAX_SERIAL_LENGTH);
  const customerName = required("customerName", "Customer Name", MAX_NAME_LENGTH);
  const locationName = required("locationName", "Location Name", MAX_NAME_LENGTH);
  const name = required("name", "Equipment Name", MAX_NAME_LENGTH);

  const optional = (field: string): string | undefined => {
    const v = normalizeText(values[field]);
    if (v === undefined) return undefined;
    if (v.length > MAX_TEXT_LENGTH) {
      findings.push(err(field, "TOO_LONG", `${field} exceeds ${MAX_TEXT_LENGTH} characters.`));
      return undefined;
    }
    return v;
  };

  const manufacturer = optional("manufacturer");
  const model = optional("model");
  const assetTag = optional("assetTag");
  const notes = optional("notes");
  const installedDate = normalizeDate("installedDate", values.installedDate, findings);
  const warrantyExpiresDate = normalizeDate("warrantyExpiresDate", values.warrantyExpiresDate, findings);

  if (installedDate && warrantyExpiresDate && warrantyExpiresDate < installedDate) {
    // A warning, not a refusal: the dates disagree, but which one is wrong is not knowable
    // from here, and blocking the machine's import over it would be the wrong trade.
    findings.push(
      warn("warrantyExpiresDate", "BEFORE_INSTALL", "The warranty expires before the machine was installed. Check both dates."),
    );
  }

  // A row that names a status is telling us something import will not honour, and saying so
  // is better than silently overriding it. Create is ACTIVE by rule (firestore.rules
  // equipmentCreateShapeValid); reaching RETIRED or INACTIVE is an audited transition.
  const claimedStatus = normalizeText(values.status);
  if (claimedStatus && claimedStatus.toUpperCase() !== "ACTIVE") {
    findings.push(
      warn(
        "status",
        "STATUS_IGNORED",
        `This row asks for status "${claimedStatus}". Equipment is always created ACTIVE; change it afterwards in Equipment.`,
      ),
    );
  }

  if (findings.some((f) => f.severity === "ERROR") || !serialNumber || !customerName || !locationName || !name) {
    return { draft: null, findings: Object.freeze(findings) };
  }

  return {
    draft: Object.freeze({
      serialNumber,
      customerName,
      locationName,
      name,
      status: "ACTIVE" as const,
      manufacturer,
      model,
      assetTag,
      installedDate,
      warrantyExpiresDate,
      notes,
    }),
    findings: Object.freeze(findings),
  };
}

/**
 * Foreign keys, checked against what the loader found.
 *
 * FAIL CLOSED, AND DO NOT CREATE. A row naming a customer EOS has never heard of is an
 * ERROR, not an invitation to add one. An equipment file is evidence about machines; the
 * customer list is a decision somebody makes. Importing the machine would also have to
 * invent an account nobody approved, and the location under it, and the relationship between
 * them -- three governed records conjured from one spreadsheet column.
 *
 * THE LOCATION KEY IS SCOPED TO THE CUSTOMER, deliberately. firestore.rules requires the
 * location to belong to the account, so a location that merely exists somewhere is not
 * enough: "Main Street" under a different customer is a different place.
 */
export function equipmentContextFindings(
  draft: Readonly<Record<string, unknown>>,
  context: ImportContext,
): readonly FieldFinding[] {
  const findings: FieldFinding[] = [];
  const customers = context.references?.[EQUIPMENT_REFERENCES.CUSTOMER];
  const locations = context.references?.[EQUIPMENT_REFERENCES.LOCATION];

  const customerName = String(draft.customerName ?? "");
  const locationName = String(draft.locationName ?? "");
  const customerKey = naturalIdentityKey(customerName);

  if (!customers || !customers.has(customerKey)) {
    findings.push(
      err(
        "customerName",
        "CUSTOMER_NOT_FOUND",
        `No customer named "${customerName}" exists in EOS. Import the customers first, or correct the name.`,
      ),
    );
    // The location key is scoped BY customer, so an unknown customer makes the location
    // question unanswerable rather than merely also-failing. Reporting both would tell the
    // operator to fix two things when there is one.
    return Object.freeze(findings);
  }

  if (!locations || !locations.has(scopedLocationKey(customerName, locationName))) {
    findings.push(
      err(
        "locationName",
        "LOCATION_NOT_FOUND",
        `"${customerName}" has no location named "${locationName}". Add the location first, or correct the name.`,
      ),
    );
  }

  return Object.freeze(findings);
}

/** A location's identity is its name UNDER ITS CUSTOMER, never its name alone. */
export function scopedLocationKey(customerName: string, locationName: string): string {
  return `${naturalIdentityKey(customerName)} ${naturalIdentityKey(locationName)}`;
}

export const EQUIPMENT_IMPORT_CONTRACT = registerEntityContract({
  entityType: "EQUIPMENT",
  label: "Equipment",
  canonicalFields: EQUIPMENT_CANONICAL_FIELDS,
  requiredFields: EQUIPMENT_REQUIRED_FIELDS,
  identityField: "serialNumber",
  identityLabel: "Serial Number",
  referenceFields: Object.freeze([
    Object.freeze({ reference: EQUIPMENT_REFERENCES.CUSTOMER, field: "customerName" }),
    Object.freeze({ reference: EQUIPMENT_REFERENCES.LOCATION, field: "locationName" }),
  ]),
  normalizeRow: (values) => normalizeEquipmentRow(values) as NormalizedRow,
  contextFindings: equipmentContextFindings,
  // ALL whitespace removed, like a part number and unlike a customer name: serials are
  // transcribed by hand from a plate on a machine, and "AB 12345" and "AB12345" are the same
  // machine written down twice.
  identityKey: (draft) => String(draft.serialNumber ?? "").trim().toUpperCase().replace(/\s+/g, ""),
});
