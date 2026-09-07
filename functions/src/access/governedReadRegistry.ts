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
// The filter SHAPES a source may declare. Each is a query shape, never an authorization concept:
// adding one lets a registered source answer a question it already answered before this migration,
// and lets none of them answer a question about data the capability did not already cover.
//
//   "=="              equality on a stored field
//   "in"              membership, 1..30 values -- the batched keyed lookup shape
//   "array-contains"  membership within a stored array
//   "prefix"          starts-with. The caller supplies ONE string; the server builds the
//                     >= term / <= term +  range itself. Declared as its own shape rather
//                     than exposing >= and <= because two open-ended range operators in a caller's
//                     hands is a query language, and this is a typeahead.
export type GovernedFilterOperator = "==" | "in" | "array-contains" | "prefix";

/**
 * The sentinel for "filter on the document id rather than a stored field".
 *
 * Firestore addresses this as FieldPath.documentId(), which is not a field name and cannot be
 * passed as one. The registry names it explicitly so a source can declare a keyed lookup without
 * the caller ever learning that the id is addressed differently from any other field.
 */
export const DOCUMENT_ID_FIELD = "__documentId__";

export interface GovernedFilterSpec {
  /** The stored field this named parameter filters on, or DOCUMENT_ID_FIELD. Fixed by the registry. */
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

  // THE ACCOUNT READS. Four client shapes existed against `accounts` before this migration and all
  // four are preserved exactly -- one capability, four question shapes, no widening:
  //   accountDirectory  ordered list / picker
  //   accountsByIds     the batched keyed lookup useAccountNames did with documentId() in [chunk]
  //   accountSearch     the typeahead's prefix range
  // (the single-record read is readGovernedRecord, which uses accountDirectory's own entry).
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

  accountsByIds: Object.freeze({
    capability: "customer.record.read",
    source: "accounts",
    // Ordered by id: this source answers "resolve these ids to names", and the caller keys the
    // result by id rather than reading it in order. Ordering by name here would add a sort the
    // previous documentId()-in query never paid for.
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({
      ids: Object.freeze({ field: DOCUMENT_ID_FIELD, op: "in" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 30,
  }),

  accountSearch: Object.freeze({
    capability: "customer.record.read",
    source: "accounts",
    orderBy: Object.freeze(["name", "asc"] as const),
    filters: Object.freeze({
      namePrefix: Object.freeze({ field: "name", op: "prefix" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 50,
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

  // EQUIPMENT. Four client shapes existed and each gets its own source rather than being folded
  // into one entry with optional filters. "Equipment for this account" and "equipment at this
  // location" are different questions, and an entry whose filters are all optional is an entry that
  // silently answers "all equipment" the moment a caller forgets a parameter.
  accountEquipment: Object.freeze({
    capability: "service.equipment.read",
    source: "equipment",
    orderBy: Object.freeze(["name", "asc"] as const),
    filters: Object.freeze({
      accountId: Object.freeze({ field: "accountId", op: "==" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  locationEquipment: Object.freeze({
    capability: "service.equipment.read",
    source: "equipment",
    orderBy: Object.freeze(["name", "asc"] as const),
    filters: Object.freeze({
      locationId: Object.freeze({ field: "locationId", op: "==" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  equipmentByIds: Object.freeze({
    capability: "service.equipment.read",
    source: "equipment",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({
      ids: Object.freeze({ field: DOCUMENT_ID_FIELD, op: "in" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 30,
  }),

  // ── REORDER REQUESTS ──────────────────────────────────────────────────────────────────────
  //
  // TWO SOURCES BECAUSE THERE ARE TWO ORDERINGS, and ordering is visible. The queue hooks issue
  // Firestore queries with NO orderBy, which returns document-id order; History explicitly orders
  // by createdAt desc. Folding both into one source would silently re-sort every queue on screen.
  //
  // The filters are all OPTIONAL here, unlike accountContacts where the account id is required.
  // That is not an oversight: for contacts the filter IS the question, and a missing one would
  // silently answer "every contact in the company". For the reorder queue, "every open request" is
  // the intended, authorized answer -- it is what the Parts queue shows -- so an unfiltered read is
  // a legitimate query rather than an accidental disclosure.
  //
  // assignedToUserId / reviewedBy / assignedBy are DISPLAY FILTERS, not scope boundaries, exactly
  // as they are today: firestore.rules gated this collection at role level (admin/dispatcher) and
  // these where() clauses never were an access-control boundary -- the hook's own comment says so.
  // The capability is likewise role-level, so this migration preserves the authority precisely. If
  // these should ever become real self-scope, that is the server-derived-"me" work, not a filter.
  reorderRequestsQueue: Object.freeze({
    capability: "reorder.request.read.queue",
    source: "reorder_requests",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({
      status: Object.freeze({ field: "status", op: "==" as const }),
      statuses: Object.freeze({ field: "status", op: "in" as const }),
      assignedToUserId: Object.freeze({ field: "assignedToUserId", op: "==" as const }),
      partId: Object.freeze({ field: "partId", op: "==" as const }),
      reviewedBy: Object.freeze({ field: "reviewedBy", op: "==" as const }),
      assignedBy: Object.freeze({ field: "assignedBy", op: "==" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  reorderRequestsHistory: Object.freeze({
    capability: "reorder.request.read.queue",
    source: "reorder_requests",
    orderBy: Object.freeze(["createdAt", "desc"] as const),
    filters: Object.freeze({
      statuses: Object.freeze({ field: "status", op: "in" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 100,
  }),

  purchaseOrdersByIds: Object.freeze({
    capability: "reorder.purchaseOrder.read",
    source: "reorder_purchase_orders",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({
      ids: Object.freeze({ field: DOCUMENT_ID_FIELD, op: "in" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 30,
  }),

  // The installed-base register: every equipment record, id-ordered and cursor-paged. Ordered by
  // DOCUMENT ID because that is what the page it replaces ordered by, and the reason is in that
  // page's own header -- ordering by createdAt silently EXCLUDES records missing that field, which
  // is a register quietly losing rows rather than reporting fewer.
  equipmentRegister: Object.freeze({
    capability: "service.equipment.read",
    source: "equipment",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 200,
  }),
});

export type GovernedSourceId = keyof typeof GOVERNED_READS;

/** Every capability the registry depends on -- exported so a test can assert catalog coverage. */
export const GOVERNED_READ_CAPABILITIES = Object.freeze(
  [...new Set(Object.values(GOVERNED_READS).map((s) => s.capability))],
);
