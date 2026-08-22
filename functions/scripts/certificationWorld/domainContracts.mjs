// THE CANONICAL CONTRACTS THE WORLD MUST CONFORM TO — re-exported, never redefined.
//
// ============================ WHY THIS FILE IS A PASS-THROUGH ============================
//
// The Certification World once wrote `status: "DORMANT"` for five customers. DORMANT is not a
// customer status. The canonical enum is ACTIVE / INACTIVE / PROSPECT / ARCHIVED, and the portfolio
// summary refused to bucket those records -- correctly, since it never invents a status a record
// does not have -- so the Customers screen reported that its own categories did not add up. The UI
// was right; the fixture was wrong, and nothing compared the two.
//
// A fixture builder that declares its own copy of an enum will drift from the domain, and the drift
// is invisible precisely because both sides look internally consistent. So this module DEFINES
// NOTHING. It imports the canonical values and re-exports them, which means a change to the domain
// is a change to what the world is allowed to contain, automatically.
//
// ============================ WHERE CANONICAL LIVES ============================
//
// `field-ops-app-vite/src/domain/constants.js` is the domain layer for these enums, and it is
// dependency-free, so Node loads it directly. That is deliberate: the alternative -- a mirrored
// constant on the functions side plus a parity test -- adds a second thing to keep in step, and the
// only reason to accept that cost is when the client module cannot be loaded here. It can.
//
// ============================ QUERY-REQUIRED IS NOT THE SAME AS REQUIRED ============================
//
// Firestore's `orderBy` FILTERS: a document missing the ordered field is silently excluded from the
// result, with no error. So a field the schema treats as optional can still be mandatory for a
// record to be VISIBLE in a list that sorts by it. 101 of 103 customers were absent from the
// Customers list for exactly this reason while the header still counted all 103.
//
// QUERY_REQUIRED_FIELDS records that second, weaker-looking but harder requirement: not "the domain
// demands this value" but "a record without it cannot be seen on this surface". Optional schema
// does not imply optional query participation.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const clientDomain = (file) => pathToFileURL(path.resolve(REPO, "field-ops-app-vite/src/domain", file)).href;

const constants = await import(clientDomain("constants.js"));
const naming = await import(clientDomain("nameNormalization.js"));

/** Canonical customer statuses. Re-exported from the domain, not restated. */
export const ACCOUNT_STATUS_VALUES = constants.ACCOUNT_STATUS;
/** Canonical relationship classifications. Optional and multi-valued by design. */
export const ACCOUNT_RELATIONSHIP_VALUES = constants.ACCOUNT_RELATIONSHIP_TYPE;
/** Canonical line-of-business values. */
export const ACCOUNT_LINE_OF_BUSINESS_VALUES = constants.ACCOUNT_LINE_OF_BUSINESS;
/** The one definition of a searchable name, shared with every browser write path. */
export const { normalizeNameForSearch, SEARCH_NAME_FIELD } = naming;

/**
 * Enum-backed fixture fields, by collection.
 *
 * `multi: true` means the stored value is an ARRAY of enum members (relationshipTypes), so each
 * element is checked rather than the array itself. `optional: true` means absence is a legitimate
 * state and is not a finding -- which matters for relationshipTypes specifically, where the domain
 * says an unset Account renders no badge and must never default to "Customer".
 *
 * Only fields whose canonical allowed set is genuinely available are listed. Inventing an allowed
 * set here to make the table look complete would recreate the DORMANT problem with more ceremony.
 */
export const ENUM_FIELD_CONTRACTS = Object.freeze({
  accounts: Object.freeze([
    Object.freeze({ field: "status", allowed: Object.values(ACCOUNT_STATUS_VALUES), optional: false }),
    Object.freeze({ field: "relationshipTypes", allowed: Object.values(ACCOUNT_RELATIONSHIP_VALUES), optional: true, multi: true }),
    Object.freeze({ field: "lineOfBusiness", allowed: Object.values(ACCOUNT_LINE_OF_BUSINESS_VALUES), optional: true }),
  ]),
});

/**
 * Fields without which a record is INVISIBLE to a surface that lists it.
 *
 * Each entry names the surface and the reason, so a future reader can tell whether the requirement
 * still holds -- an entry whose surface no longer sorts by the field is stale, and a stale entry is
 * how a guard quietly becomes ceremony.
 */
export const QUERY_REQUIRED_FIELDS = Object.freeze({
  accounts: Object.freeze([
    Object.freeze({ field: "updatedAt", surface: "/customers list", why: "metadata definition account.js defaultSort is updatedAt DESC" }),
    Object.freeze({ field: "nameLower", surface: "/customers search", why: "prefix range + orderBy on the normalized name" }),
    Object.freeze({ field: "name", surface: "/customers search", why: "search results render the display name" }),
  ]),
  mobile_locations: Object.freeze([
    Object.freeze({ field: "updatedAt", surface: "truck list 'Last update' column", why: "updatedAt is exposed as a sortable column; sorting by it excludes records lacking it" }),
  ]),
});

/**
 * Collections whose records the application writes through Admin SDK helpers, and which therefore
 * carry write timestamps.
 *
 * Listed rather than applied blanket-wide: a collection whose domain genuinely has no concept of
 * being "updated" should not be given a timestamp to make a table symmetrical.
 */
export const TIMESTAMPED_COLLECTIONS = Object.freeze([
  "accounts", "locations", "contacts", "equipment_models", "mobile_locations", "employees",
]);

/**
 * Validate built world records against the canonical contracts.
 *
 * Pure and database-free, so it runs in a unit test and at seed time from the same code. Returns a
 * list of findings; an empty list is a pass. Findings carry the collection, id, field and the
 * offending value, because "validation failed" without the value is a message that sends someone
 * back to a 100-record fixture to find it by hand.
 */
export function validateWorldRecords(records) {
  const findings = [];

  for (const r of records) {
    const contracts = ENUM_FIELD_CONTRACTS[r.collection];
    if (contracts) {
      for (const c of contracts) {
        const value = r.data?.[c.field];
        if (value === undefined || value === null) {
          if (!c.optional) {
            findings.push({ kind: "MISSING_ENUM_VALUE", collection: r.collection, id: r.id, field: c.field, value: null });
          }
          continue;
        }
        const values = c.multi ? (Array.isArray(value) ? value : [value]) : [value];
        if (c.multi && !Array.isArray(value)) {
          findings.push({ kind: "EXPECTED_ARRAY", collection: r.collection, id: r.id, field: c.field, value });
          continue;
        }
        for (const v of values) {
          if (!c.allowed.includes(v)) {
            findings.push({ kind: "INVALID_ENUM_VALUE", collection: r.collection, id: r.id, field: c.field, value: v, allowed: c.allowed });
          }
        }
      }
    }

    // Query participation. `updatedAt`/`createdAt` are stamped by the SEEDER at write time rather
    // than by the builder, so they are checked against the written record, not the built one --
    // see certificationWorldQueryContract.test.mjs, which asserts the seeded shape.
    for (const q of QUERY_REQUIRED_FIELDS[r.collection] || []) {
      if (q.field === "updatedAt" || q.field === "createdAt") continue;
      const value = r.data?.[q.field];
      if (value === undefined || value === null) {
        findings.push({ kind: "QUERY_INVISIBLE", collection: r.collection, id: r.id, field: q.field, surface: q.surface, why: q.why });
      }
    }
  }

  return findings;
}

/** One-line rendering of a finding, for console output and assertion messages alike. */
export function describeFinding(f) {
  if (f.kind === "INVALID_ENUM_VALUE") {
    return `${f.collection}/${f.id}: ${f.field}=${JSON.stringify(f.value)} is not one of ${f.allowed.join("/")}`;
  }
  if (f.kind === "QUERY_INVISIBLE") {
    return `${f.collection}/${f.id}: missing ${f.field} -- invisible on ${f.surface} (${f.why})`;
  }
  return `${f.collection}/${f.id}: ${f.kind} on ${f.field} (${JSON.stringify(f.value)})`;
}
