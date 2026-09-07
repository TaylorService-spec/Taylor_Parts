// THE GOVERNED READ REGISTRY -- the server's closed catalogue of what may be read, by whom, how.
//
// ════════════════════ THE INVARIANT THIS FILE EXISTS TO HOLD ════════════════════
//
//   Firebase authenticates. EOS authorizes.
//
// A client names a SOURCE ID -- an EOS concept like "accountContacts" -- and nothing else. It does
// not name a collection, a Firestore path, a where() clause, a sort field or a raw cursor. Every
// one of those is registry-owned, because each is a lever: a collection name is a choice of what to
// read, a where() clause is a query language over someone else's data, a sort field is an ordering
// oracle, and a raw cursor is a position in a result set the caller was never handed.
//
// This replaces a first draft of this registry that took `collection` and `[{field, op, value}]`
// from the caller. It was allowlisted and it validated, but it still handed the client two of those
// levers, and "allowlisted enough" is the argument that precedes every query-injection surface.
//
// ════════════════════ WHAT A SOURCE OWNS ════════════════════
//
//   capability   The EOS capability that must resolve ALLOW. Per-source, never one shared
//                "read the database" grant -- the Objects grid administers each object separately
//                and a single id would collapse it back into one switch.
//   source       The Firestore collection. Server-side only; never crosses the wire.
//   orderBy      Fixed. Ordering is also the pagination key, so a caller-chosen sort would let a
//                caller choose how the pages are cut.
//   filters      NAMED parameters with fixed fields and operators. A caller supplies a VALUE for a
//                declared name; it can never introduce a field, an operator or a clause.
//   projection   null means "the whole document, deliberately, pending a measured narrowing".
//                Stated rather than guessed: inventing a field list here would silently blank
//                fields on screens that read them, and a projection that quietly drops data is
//                worse than one that has not been written yet.
//   maxPageSize  Hard ceiling. A caller may ask for less, never more.
//
// ════════════════════ WHAT IS DELIBERATELY NOT HERE ════════════════════
//
// SELF- AND RECORD-SCOPED READS. "My assigned work orders" is not a filter a client supplies -- the
// server derives "me" from request.auth.uid. Those get dedicated trusted reads with their own scope
// resolution; forcing them through a generic registry is exactly the widening this migration must
// not do.
export type GovernedFilterOperator = "==" | "in" | "array-contains";

export interface GovernedFilterSpec {
  /** The stored field this named parameter filters on. Fixed by the registry. */
  readonly field: string;
  readonly op: GovernedFilterOperator;
  /** When true the read is refused unless the caller supplies this parameter. */
  readonly required?: boolean;
}

export interface GovernedReadSource {
  readonly capability: string;
  readonly source: string;
  readonly orderBy: readonly [string, "asc" | "desc"];
  /** Named parameters a caller may supply values for. The names are the entire vocabulary. */
  readonly filters: Readonly<Record<string, GovernedFilterSpec>>;
  /** Allowed output fields, or null for the whole document (see the header). */
  readonly projection: readonly string[] | null;
  readonly maxPageSize: number;
}

/**
 * THE CLOSED CATALOGUE. A sourceId absent from this object is unreadable through the governed list
 * path by anyone, at any scope, with any capability. There is no default branch.
 */
export const GOVERNED_READS: Readonly<Record<string, GovernedReadSource>> = Object.freeze({
  // The workforce directory. Ordered by the field the directory actually sorts on so pagination
  // and display agree; a page boundary that disagreed with the sort would drop or repeat people.
  employeeDirectory: Object.freeze({
    capability: "workforce.directory.read",
    source: "employees",
    orderBy: Object.freeze(["displayName", "asc"] as const),
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 200,
  }),

  accountDirectory: Object.freeze({
    capability: "customer.record.read",
    source: "accounts",
    orderBy: Object.freeze(["name", "asc"] as const),
    filters: Object.freeze({
      status: Object.freeze({ field: "status", op: "==" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  // accountId is REQUIRED on these three: they exist to answer "this account's contacts", and a
  // missing parameter must be a refusal rather than a silent read of every contact in the company.
  accountContacts: Object.freeze({
    capability: "crm.contact.read",
    source: "contacts",
    orderBy: Object.freeze(["lastName", "asc"] as const),
    filters: Object.freeze({
      accountId: Object.freeze({ field: "accountId", op: "==" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  accountLocations: Object.freeze({
    capability: "crm.location.read",
    source: "locations",
    orderBy: Object.freeze(["name", "asc"] as const),
    filters: Object.freeze({
      accountId: Object.freeze({ field: "accountId", op: "==" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  accountEquipment: Object.freeze({
    capability: "service.equipment.read",
    source: "equipment",
    orderBy: Object.freeze(["name", "asc"] as const),
    filters: Object.freeze({
      accountId: Object.freeze({ field: "accountId", op: "==" as const, required: true }),
      locationId: Object.freeze({ field: "locationId", op: "==" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),
});

export type GovernedSourceId = keyof typeof GOVERNED_READS;

/** Every capability the registry depends on -- exported so a test can assert catalog coverage. */
export const GOVERNED_READ_CAPABILITIES = Object.freeze(
  [...new Set(Object.values(GOVERNED_READS).map((s) => s.capability))],
);
