// eos_crm domain vocabulary — the canonical Account / Contact / customer-site identities, the
// PERSON ownership shape they share, and the namespace rule that keeps a CRM customer site from
// ever being read as an inventory location.
//
// ════════════════════ WHY THIS FILE EXISTS SEPARATELY ════════════════════
//
// Same reason functions/src/eosOps/operatingCompanyCustody.ts exists: these are shared facts with
// rules attached, and a rule that lives inside one feature's repository is a rule the next
// feature's repository will quietly restate differently. The CRM/inventory location boundary in
// particular has, until now, been stated only in prose in three unrelated files
// (inventoryLocation/locationDisplayReadService.ts:11-15, ownership/ownershipMatrix.ts:139,
// docs/architecture/customer-domain-foundation.md section 4). Prose does not refuse anything.
//
// NO FIREBASE, NO SQL, NO I/O. This module is pure vocabulary and validation.

/**
 * The Account lifecycle — docs/architecture/customer-domain-foundation.md section 9 (D-C1-5),
 * mirrored by `eos_crm.crm_account_status`.
 *
 * ARCHIVED is terminal and SOFT. There is no deletion in this domain: the doc is explicit that
 * "`ARCHIVED` is soft-delete only" and that Contacts and Locations are never hard-deleted, and
 * `eos_policy.objects` already records `supportsDelete: false` for all three.
 */
export const CRM_ACCOUNT_STATUSES = ["PROSPECT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const;
export type CrmAccountStatus = (typeof CRM_ACCOUNT_STATUSES)[number];

export const isCrmAccountStatus = (value: unknown): value is CrmAccountStatus =>
  typeof value === "string" && (CRM_ACCOUNT_STATUSES as readonly string[]).includes(value);

export class CrmIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmIdentityError";
  }
}

export class CrmOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmOwnershipError";
  }
}

export class CrmLocationNamespaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmLocationNamespaceError";
  }
}

// ════════════════════ identity ════════════════════

/**
 * The id shape the existing trusted writer already enforces
 * (functions/src/account/accountImportCommand.ts:138). Repeated rather than imported because that
 * module is a Firebase callable command; this one must stay free of any Firebase import so it can
 * be used from the Postgres side.
 */
export const CRM_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * The prefix of an IMPORT-DERIVED Account id — `IMP-<SLUG>-<DIGEST>`, minted by
 * functions/src/dataImport/firestoreDataImportAdapters.ts:227-228.
 *
 * IT IS THE ACCOUNT PREFIX. The same three characters are ALSO used for import JOB ids
 * (functions/src/dataImport/dataImportCallables.ts:234, `IMP-<stamp>-<rand>`), which is a genuine
 * collision of meaning in the source data and the reason this is named for what it identifies
 * rather than for the prefix itself.
 *
 * Recognising one is USEFUL — it tells a reconciliation report which ids came from an import rather
 * than from the interface — but it is NEVER an authority: nothing in this schema treats an
 * import-derived Account differently, and the id is carried verbatim either way.
 */
export const IMPORT_DERIVED_ACCOUNT_ID_PREFIX = "IMP-";

export const isImportDerivedAccountId = (id: unknown): boolean =>
  typeof id === "string" && id.startsWith(IMPORT_DERIVED_ACCOUNT_ID_PREFIX);

/**
 * Accept an id as-is, or refuse it. There is deliberately no "normalize" path: re-minting an id at
 * the schema boundary would orphan every pointer that already names it (`equipment.accountId`,
 * `fieldops_wos.customerId`, `locations.accountId`, `contacts.accountId`) and would make the
 * migration unreconcilable against its own source.
 */
export function requireCrmId(value: unknown, what: string): string {
  if (typeof value !== "string" || !CRM_ID_PATTERN.test(value)) {
    throw new CrmIdentityError(
      `${what} must be 1-200 characters of A-Z a-z 0-9 _ - ; ids are carried verbatim from the source and never re-minted`,
    );
  }
  return value;
}

/**
 * The folded search name — `lower(btrim(name))` in SQL, and byte-for-byte the behaviour of
 * functions/src/account/accountImportCommand.ts:85-90's `normalizeAccountSearchName` and its client
 * mirror field-ops-app-vite/src/domain/nameNormalization.js.
 *
 * TRIM AND LOWERCASE, AND NOTHING ELSE. Collapsing internal whitespace, stripping punctuation, or
 * folding accents would each make this fold disagree with the two implementations already deployed,
 * and the disagreement would surface as a duplicate-detection miss rather than as an error.
 */
export function foldCustomerName(name: string): string {
  return name.trim().toLowerCase();
}

export function requireCustomerName(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CrmIdentityError(
      `${what} requires a name; a record with no name reads as an absence and never falls back to its id`,
    );
  }
  return value;
}

// ════════════════════ ownership ════════════════════

/**
 * The PERSON owner of a CRM record — an Employee id, or `null` for OWNERLESS.
 *
 * `null` IS AN ANSWER. functions/src/ownership/ownershipMatrix.ts:118-141 classifies all three
 * families as `ownerClass: "PERSON"` / `ownerType: USER`, and the Account's `unresolvedPolicy` is
 * "remains OWNERLESS until an owner is explicitly assigned". An ownerless Account makes inherited
 * Opportunity creation REFUSE, by design — collapsing OWNERLESS into some substitute would delete
 * that refusal.
 */
export type CrmOwnerEmployeeId = string | null;

/**
 * Ruling D-6, enforced rather than documented: an Account owner is EXPLICIT OR ABSENT.
 *
 * The matrix records that D-6 "forbids inferring an Account owner from creator, territory,
 * coverage, activity, sales history, or auth uid". This function therefore takes exactly one
 * argument — the stated owner — and has no access to an actor, a session, or a parent. There is no
 * overload that could fall back to the caller, because the fallback is the thing that is forbidden.
 */
export function requireExplicitAccountOwner(value: unknown): CrmOwnerEmployeeId {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new CrmOwnershipError(
      "an Account owner is an explicit Employee id or is absent (OWNERLESS); ruling D-6 forbids inferring one from creator, territory, coverage, activity, sales history or auth uid",
    );
  }
  return value;
}

/**
 * Contact and Location ownership at creation — `inheritanceSource: "parent Account owner at
 * creation"` (ownershipMatrix.ts:127-141).
 *
 * INHERITANCE, NOT SUBSTITUTION. An ownerless parent yields an ownerless child, which is the
 * matrix's `OWNERLESS_UNTIL_UPSTREAM` policy and exactly what
 * functions/src/ownership/ownershipBackfillRules.ts:69-83's `personFromAccount` already does for
 * the Firestore side ("the three control accounts R-7 keeps ownerless propagate as unresolved,
 * never a substitute").
 *
 * It applies AT CREATION ONLY. `transfer: "HANDOFF"` means a Contact's or site's owner may later
 * diverge from its Account's, so this is never re-applied as a repair.
 */
export function inheritOwnerFromAccount(accountOwnerEmployeeId: CrmOwnerEmployeeId): CrmOwnerEmployeeId {
  return accountOwnerEmployeeId;
}

// ════════════════════ the two `location` namespaces ════════════════════

/**
 * The field names that would turn a CRM customer site into something claiming to be an inventory
 * location.
 *
 * The live census of the source collection found ZERO of its documents carrying either, and
 * `eos_crm.account_locations` has no column for them. This list is what stops one arriving through
 * a write path: a caller that supplies a `type` or a `locationType` for a customer site has either
 * confused the two namespaces or is trying to merge them, and both are refusals rather than fields
 * to drop quietly.
 */
export const INVENTORY_LOCATION_DISCRIMINATOR_KEYS = Object.freeze(["type", "locationType"] as const);

/**
 * The inventory location vocabulary, named here ONLY so this module can refuse it.
 *
 * It is deliberately a copy of `eos_ops.ops_location_type`'s labels rather than an import from
 * functions/src/eosOps/operatingCompanyCustody.ts: importing it would create the first dependency
 * edge between the CRM domain and the operational one, and the point of this module is that no such
 * edge exists. A test pins the two lists together instead.
 */
export const INVENTORY_LOCATION_TYPE_LABELS = Object.freeze(["WAREHOUSE", "BIN", "MOBILE"] as const);

/**
 * Refuse a customer-site payload that carries an inventory discriminator.
 *
 * WHY THIS IS A REFUSAL AND NOT A FILTER. `equipment.locationId` (290 of 290 in the live census)
 * resolves into the CRM namespace, while `eos_ops`'s `location_id` resolves into the inventory one,
 * and the two share a field spelling with NO type discriminator to tell them apart. The only moment
 * the confusion is visible is the moment somebody supplies a type for a customer site. Dropping the
 * key silently would write the row anyway and lose the only evidence that the caller meant an
 * inventory location.
 */
export function assertNoInventoryLocationDiscriminator(
  payload: Record<string, unknown>,
  what = "a CRM customer site",
): void {
  for (const key of INVENTORY_LOCATION_DISCRIMINATOR_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new CrmLocationNamespaceError(
        `${what} has no '${key}': a customer site is identified by its Account, never by an inventory location type. ` +
        "eos_crm.account_locations and the eos_ops (location_type, location_id) pair are disjoint namespaces — " +
        "see migration 1758758400000's header.",
      );
    }
  }
}

/**
 * One row of `eos_crm.account_locations`.
 *
 * THERE IS NO `locationId` FIELD, HERE OR IN THE SCHEMA. A customer site's key is its `id`. The
 * name `locationId` belongs to the inventory pair and is left there, so that no future reader can
 * union the two on the strength of a shared spelling.
 */
export interface AccountLocationRecord {
  readonly id: string;
  readonly tenantId: string;
  /** NOT NULL by schema. This is the namespace boundary: an inventory location has no Account. */
  readonly accountId: string;
  readonly name: string;
  readonly addressStreet: string | null;
  readonly addressCity: string | null;
  readonly addressState: string | null;
  readonly addressPostalCode: string | null;
  readonly accessNotes: string | null;
  readonly ownerEmployeeId: CrmOwnerEmployeeId;
}

/** One row of `eos_crm.accounts`. */
export interface AccountRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly status: CrmAccountStatus;
  readonly ownerEmployeeId: CrmOwnerEmployeeId;
}

/** One row of `eos_crm.contacts`. A person at an Account — never a principal of this system. */
export interface ContactRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly accountId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly contactRole: string | null;
  readonly isPrimary: boolean;
  readonly ownerEmployeeId: CrmOwnerEmployeeId;
}
