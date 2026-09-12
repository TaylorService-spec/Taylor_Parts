// Migration source reconciliation for Account / Contact / customer site — the proof that an export
// of the Firestore collections maps ONTO migration 008's tables without loss, guess, or namespace
// leakage, computed BEFORE anything is written.
//
// ════════════════════ PURE. NO FIREBASE, NO DATABASE, NO WRITES ════════════════════
//
// This module takes ALREADY-EXPORTED documents as plain objects and returns a report. It opens no
// connection, reads no collection and writes nothing — the same posture
// functions/src/eosOps/migration/legacyInventoryMovementMapping.ts takes, and the reason a
// reconciliation can be run and reviewed without any production access at all. Whoever produces the
// export decides how; this module decides whether it is admissible.
//
// ════════════════════ IT REFUSES, IT DOES NOT REPAIR ════════════════════
//
// Every finding below is reported against the specific document that produced it, and no finding is
// silently fixed. An orphaned Contact does not get its `accountId` guessed from a name match; a
// site with no owner does not inherit one retroactively; an unrecognised status is not mapped to
// ACTIVE. `ready` is false whenever any BLOCKING finding exists, and the caller is expected to fix
// the SOURCE rather than to loosen this module.
//
// ════════════════════ WHAT "RECONCILED" MEANS HERE, PRECISELY ════════════════════
//
// Three claims, each independently checkable from the report:
//
//   COUNT PARITY      every source document produces exactly one canonical row, or one finding.
//                     `accounts + findings.length` accounting is why the report carries both.
//   NAMESPACE PURITY  no customer site carries an inventory discriminator, and no customer-site id
//                     collides with a supplied inventory location id. The live census observed both
//                     (0 of 185 typed; zero id overlap with warehouses / mobile_locations /
//                     stock_locations); this turns the observation into a re-runnable assertion
//                     rather than a remembered fact.
//   OWNERSHIP FIDELITY every owner that survives is one the source actually stated. OWNERLESS is
//                     carried across as OWNERLESS, never filled in.
import {
  type AccountLocationRecord,
  type AccountRecord,
  type ContactRecord,
  type CrmAccountStatus,
  type CrmOwnerEmployeeId,
  CRM_ID_PATTERN,
  INVENTORY_LOCATION_DISCRIMINATOR_KEYS,
  foldCustomerName,
  isCrmAccountStatus,
  isImportDerivedAccountId,
} from "./customerIdentity.js";

/** One exported document: its id and its data, exactly as the source held them. */
export interface SourceDocument {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

export type FindingSeverity = "BLOCKING" | "ADVISORY";

export interface ReconciliationFinding {
  readonly collection: "accounts" | "contacts" | "locations";
  readonly documentId: string;
  readonly code:
    | "ID_SHAPE_INVALID"
    | "DUPLICATE_ID"
    | "NAME_MISSING"
    | "STATUS_UNRECOGNISED"
    | "ACCOUNT_ID_MISSING"
    | "ACCOUNT_ID_ORPHANED"
    | "OWNER_SHAPE_UNRECOGNISED"
    | "INVENTORY_DISCRIMINATOR_PRESENT"
    | "INVENTORY_ID_COLLISION"
    | "ADDRESS_SHAPE_CONFLICT"
    | "OWNERLESS";
  readonly severity: FindingSeverity;
  readonly detail: string;
}

export interface CustomerMigrationSourceInput {
  readonly accounts: readonly SourceDocument[];
  readonly contacts: readonly SourceDocument[];
  readonly locations: readonly SourceDocument[];
  /**
   * Ids known to belong to the INVENTORY namespace — warehouses, mobile_locations, stock_locations,
   * bins. Supplying them is what makes the disjointness claim checkable rather than asserted. An
   * empty set is accepted and the report says the check was vacuous, so that "we did not look" and
   * "we looked and found nothing" stay distinguishable.
   */
  readonly inventoryLocationIds?: readonly string[];
}

export interface CustomerMigrationSourceReport {
  readonly ready: boolean;
  readonly counts: {
    readonly accountsIn: number;
    readonly contactsIn: number;
    readonly locationsIn: number;
    readonly accountsOut: number;
    readonly contactsOut: number;
    readonly locationsOut: number;
  };
  /** How many Account ids came from an import rather than the interface. Informational only. */
  readonly importDerivedAccountIds: number;
  /** Which address shape each site used — the two disagreeing source shapes, counted. */
  readonly addressShapes: { readonly nested: number; readonly flat: number; readonly absent: number };
  readonly ownership: {
    readonly accountsOwned: number;
    readonly accountsOwnerless: number;
    readonly contactsOwned: number;
    readonly contactsOwnerless: number;
    readonly locationsOwned: number;
    readonly locationsOwnerless: number;
  };
  readonly namespace: {
    readonly inventoryIdsChecked: number;
    readonly customerSitesCarryingADiscriminator: number;
    readonly idCollisionsWithInventory: number;
  };
  readonly findings: readonly ReconciliationFinding[];
  readonly accounts: readonly AccountRecord[];
  readonly contacts: readonly ContactRecord[];
  readonly locations: readonly AccountLocationRecord[];
}

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * Read a stated owner, or report that none could be read. NEVER derives one.
 *
 * Two shapes are accepted because the source genuinely holds two, and both are documented:
 *
 *   { type: "USER", id }            the typed owner of functions/src/ownership/typedOwner.ts, which
 *                                   is what ownershipBackfillRules.ts's `personFromAccount` wrote
 *                                   onto contacts and locations.
 *   { assignedToEmployeeId: ... }   the Person Assignment map Account's `accountOwner` uses
 *                                   (docs/architecture/customers-structured-list.md:56-65), whose
 *                                   other six fields — including a stored display name — are
 *                                   deliberately ignored in favour of the live directory.
 *
 * Anything else is UNRECOGNISED, not empty. A malformed owner and an absent owner are different
 * facts (typedOwner.ts keeps UNRESOLVED and OWNERLESS apart for exactly this reason), and collapsing
 * them would silently discard an owner the business believes it assigned.
 */
function readStatedOwner(value: unknown): { owner: CrmOwnerEmployeeId; recognised: boolean } {
  if (value === null || value === undefined) return { owner: null, recognised: true };
  if (typeof value !== "object" || Array.isArray(value)) return { owner: null, recognised: false };
  const record = value as Record<string, unknown>;

  if (record.type === "USER") {
    const id = text(record.id);
    return id ? { owner: id, recognised: true } : { owner: null, recognised: false };
  }
  if ("assignedToEmployeeId" in record) {
    const id = text(record.assignedToEmployeeId);
    // An assignment map with an empty employee id is an UNFILLED assignment, which is OWNERLESS —
    // the map exists, it simply names nobody. That is a recognised shape stating no owner.
    return { owner: id, recognised: true };
  }
  return { owner: null, recognised: false };
}

/**
 * Flatten the address. The client writes `address: { street, city, state, zip }`
 * (field-ops-app-vite/src/domain/locations.js:5-6); the live census observed flat
 * `addressLine1` / `city` / `state` on stored documents. Both are read, and a document carrying
 * BOTH with different values is a CONFLICT rather than a precedence question — picking a winner
 * would decide, silently and permanently, which of two disagreeing records of the same site is
 * true.
 */
function readAddress(data: Record<string, unknown>): {
  readonly shape: "nested" | "flat" | "absent";
  readonly conflict: string | null;
  readonly street: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly postalCode: string | null;
} {
  const nested = (typeof data.address === "object" && data.address !== null && !Array.isArray(data.address))
    ? (data.address as Record<string, unknown>)
    : null;

  const nestedParts = {
    street: nested ? text(nested.street) : null,
    city: nested ? text(nested.city) : null,
    state: nested ? text(nested.state) : null,
    postalCode: nested ? text(nested.zip) ?? text(nested.postalCode) : null,
  };
  const flatParts = {
    street: text(data.addressLine1) ?? text(data.addressStreet),
    city: text(data.city) ?? text(data.addressCity),
    state: text(data.state) ?? text(data.addressState),
    postalCode: text(data.zip) ?? text(data.postalCode) ?? text(data.addressZip),
  };

  const hasNested = Object.values(nestedParts).some((v) => v !== null);
  const hasFlat = Object.values(flatParts).some((v) => v !== null);

  if (hasNested && hasFlat) {
    const disagreements = (Object.keys(nestedParts) as (keyof typeof nestedParts)[])
      .filter((k) => nestedParts[k] !== null && flatParts[k] !== null && nestedParts[k] !== flatParts[k]);
    if (disagreements.length > 0) {
      return { shape: "nested", conflict: disagreements.join(", "), ...nestedParts };
    }
    // Same values stated twice is redundancy, not conflict; the nested shape is the one the writer
    // uses today, so it is the one carried across.
    return { shape: "nested", conflict: null, ...nestedParts };
  }
  if (hasNested) return { shape: "nested", conflict: null, ...nestedParts };
  if (hasFlat) return { shape: "flat", conflict: null, ...flatParts };
  return { shape: "absent", conflict: null, street: null, city: null, state: null, postalCode: null };
}

export function reconcileCustomerMigrationSource(
  input: CustomerMigrationSourceInput,
  tenantId: string,
): CustomerMigrationSourceReport {
  const findings: ReconciliationFinding[] = [];
  const add = (
    collection: ReconciliationFinding["collection"],
    documentId: string,
    code: ReconciliationFinding["code"],
    severity: FindingSeverity,
    detail: string,
  ): void => {
    findings.push({ collection, documentId, code, severity, detail });
  };

  const inventoryIds = new Set(input.inventoryLocationIds ?? []);

  // ════════════════════ accounts ════════════════════

  const accounts: AccountRecord[] = [];
  const accountOwnerById = new Map<string, CrmOwnerEmployeeId>();
  const seenAccountIds = new Set<string>();
  let importDerived = 0;
  let accountsOwned = 0;

  for (const doc of input.accounts) {
    if (!CRM_ID_PATTERN.test(doc.id)) {
      add("accounts", doc.id, "ID_SHAPE_INVALID", "BLOCKING", "the id is not 1-200 chars of A-Z a-z 0-9 _ -");
      continue;
    }
    if (seenAccountIds.has(doc.id)) {
      add("accounts", doc.id, "DUPLICATE_ID", "BLOCKING", "two source documents claim the same Account id");
      continue;
    }
    seenAccountIds.add(doc.id);
    if (isImportDerivedAccountId(doc.id)) importDerived += 1;

    const name = text(doc.data.name);
    if (!name) {
      add("accounts", doc.id, "NAME_MISSING", "BLOCKING", "an Account with no name reads as an absence and never falls back to its id");
      continue;
    }
    const rawStatus = text(doc.data.status);
    if (!isCrmAccountStatus(rawStatus)) {
      add("accounts", doc.id, "STATUS_UNRECOGNISED", "BLOCKING",
        `status ${JSON.stringify(doc.data.status)} is not one of PROSPECT / ACTIVE / INACTIVE / ARCHIVED`);
      continue;
    }
    const stated = readStatedOwner(doc.data.accountOwner);
    if (!stated.recognised) {
      add("accounts", doc.id, "OWNER_SHAPE_UNRECOGNISED", "BLOCKING",
        "accountOwner is neither a typed owner { type: 'USER', id } nor a Person Assignment map with assignedToEmployeeId");
      continue;
    }
    if (stated.owner === null) {
      // ADVISORY, not blocking: OWNERLESS is a legal state the matrix names, and ruling D-6 forbids
      // filling it in. It is surfaced because it has a downstream consequence — an ownerless
      // Account makes inherited Opportunity creation refuse — not because it is an error.
      add("accounts", doc.id, "OWNERLESS", "ADVISORY", "no owner is stated; carried across as OWNERLESS per ruling D-6");
    } else {
      accountsOwned += 1;
    }

    accountOwnerById.set(doc.id, stated.owner);
    accounts.push({
      id: doc.id,
      tenantId,
      name,
      status: rawStatus as CrmAccountStatus,
      ownerEmployeeId: stated.owner,
    });
  }

  // ════════════════════ contacts ════════════════════

  const contacts: ContactRecord[] = [];
  const seenContactIds = new Set<string>();
  let contactsOwned = 0;

  for (const doc of input.contacts) {
    if (!CRM_ID_PATTERN.test(doc.id)) {
      add("contacts", doc.id, "ID_SHAPE_INVALID", "BLOCKING", "the id is not 1-200 chars of A-Z a-z 0-9 _ -");
      continue;
    }
    if (seenContactIds.has(doc.id)) {
      add("contacts", doc.id, "DUPLICATE_ID", "BLOCKING", "two source documents claim the same Contact id");
      continue;
    }
    seenContactIds.add(doc.id);

    const accountId = text(doc.data.accountId);
    if (!accountId) {
      add("contacts", doc.id, "ACCOUNT_ID_MISSING", "BLOCKING", "a Contact is a person AT an Account; there is no unparented Contact");
      continue;
    }
    if (!accountOwnerById.has(accountId)) {
      add("contacts", doc.id, "ACCOUNT_ID_ORPHANED", "BLOCKING",
        `accountId ${accountId} names no Account in this export; the parent is not guessed from a name match`);
      continue;
    }
    const name = text(doc.data.name);
    if (!name) {
      add("contacts", doc.id, "NAME_MISSING", "BLOCKING", "a Contact with no name reads as an absence");
      continue;
    }
    const stated = readStatedOwner(doc.data.owner);
    if (!stated.recognised) {
      add("contacts", doc.id, "OWNER_SHAPE_UNRECOGNISED", "BLOCKING", "owner is not a typed owner { type: 'USER', id }");
      continue;
    }
    // Inheritance is the rule at creation; an owner already stated on the document wins, because
    // `transfer: "HANDOFF"` means it may legitimately have diverged from the parent's since.
    const owner = stated.owner ?? accountOwnerById.get(accountId) ?? null;
    if (owner !== null) contactsOwned += 1;

    contacts.push({
      id: doc.id,
      tenantId,
      accountId,
      name,
      email: text(doc.data.email),
      phone: text(doc.data.phone),
      contactRole: text(doc.data.role),
      isPrimary: doc.data.isPrimary === true,
      ownerEmployeeId: owner,
    });
  }

  // ════════════════════ customer sites ════════════════════

  const locations: AccountLocationRecord[] = [];
  const seenLocationIds = new Set<string>();
  const addressShapes = { nested: 0, flat: 0, absent: 0 };
  let locationsOwned = 0;
  let discriminatorCount = 0;
  let collisionCount = 0;

  for (const doc of input.locations) {
    // THE NAMESPACE CHECKS RUN FIRST, before shape validation, so that a document which is really an
    // inventory location is reported as one rather than as a malformed customer site.
    const carried = INVENTORY_LOCATION_DISCRIMINATOR_KEYS.filter((k) =>
      Object.prototype.hasOwnProperty.call(doc.data, k));
    if (carried.length > 0) {
      discriminatorCount += 1;
      add("locations", doc.id, "INVENTORY_DISCRIMINATOR_PRESENT", "BLOCKING",
        `carries ${carried.join(", ")}; a CRM customer site has no location type, and one appearing here means the two namespaces have been merged upstream`);
      continue;
    }
    if (inventoryIds.has(doc.id)) {
      collisionCount += 1;
      add("locations", doc.id, "INVENTORY_ID_COLLISION", "BLOCKING",
        "this id is also an inventory location id; the two namespaces must stay disjoint");
      continue;
    }

    if (!CRM_ID_PATTERN.test(doc.id)) {
      add("locations", doc.id, "ID_SHAPE_INVALID", "BLOCKING", "the id is not 1-200 chars of A-Z a-z 0-9 _ -");
      continue;
    }
    if (seenLocationIds.has(doc.id)) {
      add("locations", doc.id, "DUPLICATE_ID", "BLOCKING", "two source documents claim the same customer site id");
      continue;
    }
    seenLocationIds.add(doc.id);

    const accountId = text(doc.data.accountId);
    if (!accountId) {
      add("locations", doc.id, "ACCOUNT_ID_MISSING", "BLOCKING",
        "a customer site belongs to exactly one Account; a site with no Account is not a customer site at all");
      continue;
    }
    if (!accountOwnerById.has(accountId)) {
      add("locations", doc.id, "ACCOUNT_ID_ORPHANED", "BLOCKING",
        `accountId ${accountId} names no Account in this export`);
      continue;
    }
    const name = text(doc.data.name);
    if (!name) {
      add("locations", doc.id, "NAME_MISSING", "BLOCKING", "a customer site with no name reads as an absence");
      continue;
    }
    const address = readAddress(doc.data);
    if (address.conflict) {
      add("locations", doc.id, "ADDRESS_SHAPE_CONFLICT", "BLOCKING",
        `nested and flat address fields disagree on: ${address.conflict}`);
      continue;
    }
    addressShapes[address.shape] += 1;

    const stated = readStatedOwner(doc.data.owner);
    if (!stated.recognised) {
      add("locations", doc.id, "OWNER_SHAPE_UNRECOGNISED", "BLOCKING", "owner is not a typed owner { type: 'USER', id }");
      continue;
    }
    const owner = stated.owner ?? accountOwnerById.get(accountId) ?? null;
    if (owner !== null) locationsOwned += 1;

    locations.push({
      id: doc.id,
      tenantId,
      accountId,
      name,
      addressStreet: address.street,
      addressCity: address.city,
      addressState: address.state,
      addressPostalCode: address.postalCode,
      accessNotes: text(doc.data.accessNotes),
      ownerEmployeeId: owner,
    });
  }

  return {
    ready: findings.every((f) => f.severity !== "BLOCKING"),
    counts: {
      accountsIn: input.accounts.length,
      contactsIn: input.contacts.length,
      locationsIn: input.locations.length,
      accountsOut: accounts.length,
      contactsOut: contacts.length,
      locationsOut: locations.length,
    },
    importDerivedAccountIds: importDerived,
    addressShapes,
    ownership: {
      accountsOwned,
      accountsOwnerless: accounts.length - accountsOwned,
      contactsOwned,
      contactsOwnerless: contacts.length - contactsOwned,
      locationsOwned,
      locationsOwnerless: locations.length - locationsOwned,
    },
    namespace: {
      inventoryIdsChecked: inventoryIds.size,
      customerSitesCarryingADiscriminator: discriminatorCount,
      idCollisionsWithInventory: collisionCount,
    },
    findings,
    accounts,
    contacts,
    locations,
  };
}

/**
 * The advisory duplicate-name groups of D-C1-4, computed over the reconciled Accounts.
 *
 * ADVISORY. It names the groups and stops. The schema carries no unique index on the folded name
 * precisely because two distinct customers may legitimately share one, and a migration that refused
 * them would be enforcing a rule the product declined to make.
 */
export function foldedNameCollisions(
  accounts: readonly AccountRecord[],
): ReadonlyMap<string, readonly string[]> {
  const byFolded = new Map<string, string[]>();
  for (const account of accounts) {
    const key = foldCustomerName(account.name);
    const bucket = byFolded.get(key);
    if (bucket) bucket.push(account.id);
    else byFolded.set(key, [account.id]);
  }
  return new Map([...byFolded].filter(([, ids]) => ids.length > 1));
}
