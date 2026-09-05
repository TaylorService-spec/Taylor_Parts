// EOS Data Import -- the canonical CUSTOMER import contract.
//
// PORTABILITY BOUNDARY, same as the Part contract: no firebase-admin, no Firestore
// collection name, no storage type. What a Customer IS does not depend on where it is kept.
//
// EOS calls this entity an Account internally and a Customer in the interface. Import
// follows the interface, because the person uploading the file is reading the screen.
//
// ============================ WHAT A SPREADSHEET MAY NOT ASSERT ============================
//
// paymentTerms and taxStatus are ABSENT and must stay absent. They are the two governed
// commercial fields: firestore.rules validates their values for everyone including admin,
// and setting either away from its baseline is an admin-only act specifically because it
// carries money and tax consequences. A tax status is a fact about a legal relationship,
// evidenced by an exemption certificate somebody holds -- not a column in an export from a
// system that may have been recording a guess for a decade.
//
// A customer imported here therefore lands at the SAME governed baseline a dispatcher's
// manual create would produce: no payment terms, no asserted tax status. Setting them stays
// the separate, admin-only act it already was.
//
// accountOwner is absent for a different reason: it names a PERSON in this system, and a
// spreadsheet's "Sales Rep" column is a name in another one. Resolving it would be a guess
// at an identity, and a wrong owner is worse than an absent one.

import { registerEntityContract, naturalIdentityKey, type NormalizedRow } from "./entityContract.js";
import type { CanonicalFieldSpec, FieldFinding } from "./partImportContract.js";
import { normalizeText } from "./partImportContract.js";

export const CUSTOMER_IMPORT_CONTRACT_VERSION = 1;

/** Mirrors domain/constants.js ACCOUNT_STATUS. */
export const CUSTOMER_STATUSES = ["ACTIVE", "INACTIVE", "PROSPECT"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CUSTOMER_CANONICAL_FIELDS: readonly CanonicalFieldSpec[] = Object.freeze([
  Object.freeze({
    field: "name",
    label: "Customer Name",
    required: true,
    description: "The customer's name as it should appear in EOS. This is the record's identity for import.",
    synonyms: [
      "name", "customername", "customer name", "customer", "accountname", "account name",
      "company", "companyname", "company name", "businessname", "business name", "client",
    ],
  }),
  Object.freeze({
    field: "customerNumber",
    label: "Customer Number",
    required: false,
    description: "The identifier the source system knows this customer by. Carried across, never invented.",
    synonyms: [
      "customernumber", "customer number", "customerno", "custno", "customerid", "customer id",
      "accountnumber", "account number", "acctno", "accountno",
    ],
  }),
  Object.freeze({
    field: "status",
    label: "Status",
    required: false,
    description: "ACTIVE, INACTIVE or PROSPECT. Defaults to ACTIVE.",
    enumValues: CUSTOMER_STATUSES,
    synonyms: ["status", "accountstatus", "account status", "customerstatus", "active", "state"],
  }),
  Object.freeze({
    field: "billingAddress",
    label: "Billing Address",
    required: false,
    description: "The billing address as a single line of text, exactly as the source system holds it.",
    synonyms: [
      "billingaddress", "billing address", "address", "billto", "bill to", "billingaddress1",
      "street", "streetaddress", "mailingaddress", "mailing address",
    ],
  }),
  Object.freeze({
    field: "notes",
    label: "Notes",
    required: false,
    description: "Free text carried across as-is.",
    synonyms: ["notes", "note", "comments", "comment", "remarks", "description"],
  }),
  Object.freeze({
    field: "erpId",
    label: "ERP ID",
    required: false,
    description: "External identifier reserved for integrations. Stored, not interpreted.",
    synonyms: ["erpid", "erp id", "erp", "externalid", "external id"],
  }),
  Object.freeze({
    field: "accountingId",
    label: "Accounting ID",
    required: false,
    description: "External identifier reserved for integrations. Stored, not interpreted.",
    synonyms: ["accountingid", "accounting id", "glid", "gl id", "quickbooksid", "qbid"],
  }),
  Object.freeze({
    field: "legacyId",
    label: "Legacy ID",
    required: false,
    description: "The identifier a retired system used. Kept so a historical trail stays followable.",
    synonyms: ["legacyid", "legacy id", "oldid", "old id", "previousid"],
  }),
]);

export const CUSTOMER_REQUIRED_FIELDS: readonly string[] = Object.freeze(
  CUSTOMER_CANONICAL_FIELDS.filter((f) => f.required).map((f) => f.field),
);

/** Longest name EOS stores. Beyond this the row is refused rather than truncated. */
const MAX_NAME_LENGTH = 200;
const MAX_TEXT_LENGTH = 2000;

export interface CanonicalCustomerDraft {
  readonly name: string;
  readonly status: CustomerStatus;
  readonly customerNumber?: string;
  readonly billingAddress?: string;
  readonly notes?: string;
  readonly erpId?: string;
  readonly accountingId?: string;
  readonly legacyId?: string;
}

function err(field: string, code: string, message: string): FieldFinding {
  return Object.freeze({ severity: "ERROR" as const, field, code, message });
}
function warn(field: string, code: string, message: string): FieldFinding {
  return Object.freeze({ severity: "WARNING" as const, field, code, message });
}

/**
 * One mapped row -> a canonical Customer draft.
 *
 * Never throws. Import must be able to report every problem in a file rather than stopping
 * at the first one, so a bad row becomes findings and a null draft.
 */
export function normalizeCustomerRow(values: Readonly<Record<string, unknown>>): {
  draft: CanonicalCustomerDraft | null;
  findings: readonly FieldFinding[];
} {
  const findings: FieldFinding[] = [];

  const name = normalizeText(values.name);
  if (!name) {
    findings.push(err("name", "REQUIRED", "Customer Name is required. Without it the row has no identity."));
  } else if (name.length > MAX_NAME_LENGTH) {
    // Refused, not truncated: a shortened name is a DIFFERENT customer, and it would then
    // fail to match the one already in EOS -- creating the duplicate import exists to avoid.
    findings.push(err("name", "TOO_LONG", `Customer Name exceeds ${MAX_NAME_LENGTH} characters. Shorten it in the file.`));
  }

  let status: CustomerStatus = "ACTIVE";
  const rawStatus = normalizeText(values.status);
  if (rawStatus) {
    const upper = rawStatus.toUpperCase();
    const alias = STATUS_ALIASES[upper] ?? upper;
    if ((CUSTOMER_STATUSES as readonly string[]).includes(alias)) {
      status = alias as CustomerStatus;
    } else {
      findings.push(
        err("status", "INVALID_ENUM", `"${rawStatus}" is not a customer status. Use ${CUSTOMER_STATUSES.join(", ")}.`),
      );
    }
  }

  const text = (field: string, value: unknown): string | undefined => {
    const v = normalizeText(value);
    if (v === undefined) return undefined;
    if (v.length > MAX_TEXT_LENGTH) {
      findings.push(err(field, "TOO_LONG", `${field} exceeds ${MAX_TEXT_LENGTH} characters.`));
      return undefined;
    }
    return v;
  };

  const customerNumber = text("customerNumber", values.customerNumber);
  const billingAddress = text("billingAddress", values.billingAddress);
  const notes = text("notes", values.notes);
  const erpId = text("erpId", values.erpId);
  const accountingId = text("accountingId", values.accountingId);
  const legacyId = text("legacyId", values.legacyId);

  if (!billingAddress) {
    // A warning, not an error: a customer without a billing address is a real customer, and
    // refusing the row would block an import over a field EOS does not require. Saying
    // nothing would let an invoicing gap arrive silently.
    findings.push(warn("billingAddress", "MISSING", "No billing address. The customer will import; invoicing will need one later."));
  }

  if (findings.some((f) => f.severity === "ERROR") || !name) {
    return { draft: null, findings: Object.freeze(findings) };
  }

  return {
    draft: Object.freeze({ name, status, customerNumber, billingAddress, notes, erpId, accountingId, legacyId }),
    findings: Object.freeze(findings),
  };
}

/** Spreadsheet vocabulary for a status. Deliberately small: a guess here misfiles a record. */
const STATUS_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  Y: "ACTIVE",
  YES: "ACTIVE",
  TRUE: "ACTIVE",
  N: "INACTIVE",
  NO: "INACTIVE",
  FALSE: "INACTIVE",
  DISABLED: "INACTIVE",
  ARCHIVED: "INACTIVE",
  LEAD: "PROSPECT",
  PROSPECTIVE: "PROSPECT",
});

/**
 * IDENTITY IS THE NAME, not the customer number, and that choice is worth stating.
 *
 * A customer number is the better identifier where both systems have one -- but only the
 * SOURCE system's rows carry it, and the customers already in EOS were created through the
 * interface with no customer number at all. Keying on it would compare a populated column
 * against an empty one and conclude, every time, that nothing matches: a clean import that
 * silently doubles the customer list.
 *
 * The name is the field both sides always have. It is a weaker key -- two genuinely
 * different customers can share a name -- and that failure mode is the safe one: import
 * refuses the row and a person decides, rather than creating a duplicate nobody notices.
 */
export const CUSTOMER_IMPORT_CONTRACT = registerEntityContract({
  entityType: "CUSTOMERS",
  label: "Customer",
  canonicalFields: CUSTOMER_CANONICAL_FIELDS,
  requiredFields: CUSTOMER_REQUIRED_FIELDS,
  identityField: "name",
  identityLabel: "Customer Name",
  normalizeRow: (values) => normalizeCustomerRow(values) as NormalizedRow,
  // Whitespace COLLAPSED, not removed -- unlike a part number. "Acme Soda" and "AcmeSoda"
  // are plausibly two different companies; "Acme  Soda" and "Acme Soda" are not.
  identityKey: (draft) => naturalIdentityKey(draft.name),
});
