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
//   "!="        Exists AND differs. Firestore's `!=` also EXCLUDES documents missing the field
//               entirely, which is why the one caller that needs it -- "employees with a linked
//               user account" -- is expressible at all. Added for that query and no other.
//
//               IT CONSTRAINS THE SORT, and a source using it must say so. Firestore requires the
//               first orderBy to be the inequality's own field, so a source declaring a `!=` filter
//               MUST order by that same field or every call fails failed-precondition. That is not
//               a style rule; it is checked by `governedReadRegistry.test.mjs`.
export type GovernedFilterOperator = "==" | "!=" | "in" | "array-contains" | "prefix";

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

/**
 * A sort a caller may ASK FOR BY NAME.
 *
 * THE CLIENT SENDS A TOKEN, THE SERVER CHOOSES THE FIELD. `sortKey: "nameAsc"` is resolved here
 * against this allowlist; the string never reaches Firestore. That distinction is the whole point:
 * accepting `sortField` from a caller and passing it to orderBy() would let the browser order by any
 * field it can name -- which is both an unindexed query nobody proved, and an oracle (ordering by a
 * field reveals its values' relative order, and Firestore's orderBy additionally EXCLUDES documents
 * missing that field, so a caller could probe which records carry which fields).
 */
export interface GovernedSortSpec {
  readonly field: string;
  readonly direction: "asc" | "desc";
}

/**
 * A RECORD SCOPE: which records a caller may read, once the capability has settled WHETHER.
 *
 * ════════════════════ WHY THIS IS SEPARATE FROM THE CAPABILITY ════════════════════
 *
 * `firestore.rules` admitted warehouses and transfer orders by TWO predicates, not one:
 *
 *   match /warehouses/{warehouseId}
 *     allow read: if isAdminOrDispatcher() || isAssignedToWarehouse(warehouseId);
 *   match /transfer_orders/{transferOrderId}
 *     allow read: if isAdminOrDispatcher()
 *       || isAssignedToWarehouse(resource.data.fromWarehouseId)
 *       || isAssignedToWarehouse(resource.data.toWarehouseId);
 *
 * A source with no scope would have to pick one of those. Picking the global branch hands every
 * warehouse manager the whole network; picking the assigned branch strips an operations manager
 * down to a single site. Both are authorization drift, in opposite directions.
 *
 * So the source keeps its GLOBAL capability -- `warehouse.record.read` means the same thing for the
 * operations manager and the controller who hold it globally -- and a SECOND, separate capability
 * grants the assigned-site population. Two ids, because one id cannot answer "which population is
 * this holder entitled to" without guessing, and both guesses are wrong in a way that matters.
 *
 * THE ORDER IS LOAD-BEARING: the global capability is resolved FIRST. Inferring "this reader is
 * scoped" from the mere PRESENCE of an assignment would narrow anyone holding both -- an Operations
 * Manager who is also an operational warehouse manager -- which is the accidental narrowing the
 * resolution order exists to prevent.
 *
 * A holder of ONLY the scoped capability, with no assignment, reads NOTHING. That is what the
 * retired rule did: `isAssignedToWarehouse` simply never matched. Not everything, and not an error.
 *
 * Capability decides WHETHER. Server-derived assignment decides WHICH records. The browser decides
 * neither -- there is no request field that carries a scope.
 *
 * `fields` is a DISJUNCTION. Firestore has no OR across fields, so more than one field means one
 * query per field, unioned and de-duplicated by authoritative document id -- which is why a
 * transfer order between two assigned warehouses is returned once rather than twice.
 */
export interface GovernedScopeSpec {
  /** The only assignment kind that exists today. Named rather than implied so a second one has to be added deliberately. */
  readonly assignment: "WAREHOUSE";
  /**
   * The capability that grants the SCOPED population. Distinct from the source's own `capability`,
   * which grants the global one and is always tried first.
   */
  readonly capability: string;
  /** Fields matched against the assignment, OR-ed. DOCUMENT_ID_FIELD means the record IS the warehouse. */
  readonly fields: readonly string[];
}

export interface GovernedReadSource {
  readonly capability: string;
  readonly source: string;
  /**
   * The sort used when the caller names none. Kept as a plain tuple so every existing source is
   * unchanged; sources offering a CHOICE additionally declare `allowedSorts`.
   */
  readonly orderBy: readonly [string, "asc" | "desc"];
  /**
   * Sorts this source will honour, by token. Absent means "this source has one ordering" -- which is
   * true of every source serving a fixed-shape read, and is not a limitation to be filled in later.
   *
   * Only sorts the UI ALREADY offers belong here. Registering a field merely because it exists would
   * add an ordering nobody has an index for and nobody asked for.
   */
  readonly allowedSorts?: Readonly<Record<string, GovernedSortSpec>>;
  /** The token used when the caller names none. Must exist in `allowedSorts` when both are present. */
  readonly defaultSort?: string;
  /** Named parameters a caller may supply values for. The names are the entire vocabulary. */
  readonly filters: Readonly<Record<string, GovernedFilterSpec>>;
  /** Allowed output fields, or null for the whole document (see the header). */
  readonly projection: readonly string[] | null;
  readonly maxPageSize: number;
  /**
   * A SECOND, narrower way into this source, for a caller who holds the scoped capability rather
   * than the global one. Absent means the capability alone settles the population -- true of every
   * source whose retired rule had a single read predicate.
   */
  readonly scope?: GovernedScopeSpec;
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
  // Employee records by id -- the keyed lookup the truck registry uses to resolve driver names.
  // Shares workforce.directory.read with employeeDirectory rather than getting its own capability:
  // the code it replaces calls it "the same unfiltered admin/dispatcher directory read
  // useEmployeeDirectory already relies on (no new permission)", and that is exactly right.
  // ASSIGNABLE EMPLOYEES -- the assignment picker's read (buildAssignableEmployeesQuery).
  //
  // TWO SOURCES, not one with an optional `userId` filter, because the two shapes cannot share an
  // ordering. The linked variant carries a `!=` inequality, and Firestore demands the first orderBy
  // be that same field; the unlinked variant must NOT order by `userId`, because orderBy silently
  // excludes documents missing the field -- which is exactly the population "unlinked" means to
  // include. One source with an optional filter would therefore be correct for one caller and
  // silently wrong for the other.
  //
  // `employmentStatus` is required in both. It is required in the query being replaced, and an
  // optional version would answer "every employee, including terminated ones" the moment a caller
  // omitted it.
  assignableEmployeesLinked: Object.freeze({
    capability: "workforce.directory.read",
    source: "employees",
    // userId FIRST, forced by its own `!=` filter. This also matches the implicit ordering the
    // client query already received from Firestore, so no caller sees a different order.
    orderBy: Object.freeze(["userId", "asc"] as const),
    filters: Object.freeze({
      employmentStatus: Object.freeze({ field: "employmentStatus", op: "==" as const, required: true }),
      operationalRole: Object.freeze({ field: "operationalRoles", op: "array-contains" as const }),
      hasLinkedUser: Object.freeze({ field: "userId", op: "!=" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  assignableEmployeesAll: Object.freeze({
    capability: "workforce.directory.read",
    source: "employees",
    orderBy: Object.freeze(["displayName", "asc"] as const),
    filters: Object.freeze({
      employmentStatus: Object.freeze({ field: "employmentStatus", op: "==" as const, required: true }),
      operationalRole: Object.freeze({ field: "operationalRoles", op: "array-contains" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  employeesByIds: Object.freeze({
    capability: "workforce.directory.read",
    source: "employees",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({
      ids: Object.freeze({ field: DOCUMENT_ID_FIELD, op: "in" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 30,
  }),

  // ══════════════════════ THE METADATA LIST SOURCES ══════════════════════
  //
  // One per entity the metadata list runtime reads. These replace firestoreListSource.js's
  // client-direct queries; the runtime keeps deciding presentation, and the SERVER decides which
  // collection, which orderings and which filters exist at all.
  //
  // EVERY SORT AND FILTER BELOW WAS MEASURED FROM THE EXISTING DEFINITIONS -- the `sortable: true`
  // fields, the `filterable` fields with their declared operators, and each ListViewDefinition's
  // own defaultSort. Nothing was added because it looked useful and nothing was dropped to make the
  // migration tidier: a sort registered here that the UI never offered is an unindexed query nobody
  // proved, and a sort omitted is a control that silently stops working.
  //
  // Each carries the document-id tiebreak implicitly (the read service appends it), which is what
  // the definitions' own `tiebreaker: "__name__"` already asked for and what keeps the cursor total.
  //
  // NOT REGISTERED, DELIBERATELY:
  //   fieldops_wos      the work-order family. Its authority includes assigned-technician self
  //                     scope, so a global source would widen or narrow it. BLOCKED.
  //   stock_locations   the surface was retired and the collection is deny-all to clients by
  //                     decision. Registering a read would reopen it.
  metadataAccounts: Object.freeze({
    capability: "customer.record.read",
    source: "accounts",
    orderBy: Object.freeze(["updatedAt", "desc"] as const),
    allowedSorts: Object.freeze({
      nameAsc: Object.freeze({ field: "name", direction: "asc" as const }),
      nameDesc: Object.freeze({ field: "name", direction: "desc" as const }),
      nameLowerAsc: Object.freeze({ field: "nameLower", direction: "asc" as const }),
      nameLowerDesc: Object.freeze({ field: "nameLower", direction: "desc" as const }),
      statusAsc: Object.freeze({ field: "status", direction: "asc" as const }),
      statusDesc: Object.freeze({ field: "status", direction: "desc" as const }),
      createdAtAsc: Object.freeze({ field: "createdAt", direction: "asc" as const }),
      createdAtDesc: Object.freeze({ field: "createdAt", direction: "desc" as const }),
      updatedAtAsc: Object.freeze({ field: "updatedAt", direction: "asc" as const }),
      updatedAtDesc: Object.freeze({ field: "updatedAt", direction: "desc" as const }),
    }),
    defaultSort: "updatedAtDesc",
    filters: Object.freeze({
      status: Object.freeze({ field: "status", op: "==" as const }),
      statusIn: Object.freeze({ field: "status", op: "in" as const }),
      relationshipTypes: Object.freeze({ field: "relationshipTypes", op: "array-contains" as const }),
      lineOfBusiness: Object.freeze({ field: "lineOfBusiness", op: "array-contains" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  metadataContacts: Object.freeze({
    capability: "crm.contact.read",
    source: "contacts",
    orderBy: Object.freeze(["name", "asc"] as const),
    allowedSorts: Object.freeze({
      nameAsc: Object.freeze({ field: "name", direction: "asc" as const }),
      nameDesc: Object.freeze({ field: "name", direction: "desc" as const }),
    }),
    defaultSort: "nameAsc",
    filters: Object.freeze({
      accountId: Object.freeze({ field: "accountId", op: "==" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  metadataEmployees: Object.freeze({
    capability: "workforce.directory.read",
    source: "employees",
    orderBy: Object.freeze(["displayName", "asc"] as const),
    allowedSorts: Object.freeze({
      displayNameAsc: Object.freeze({ field: "displayName", direction: "asc" as const }),
      displayNameDesc: Object.freeze({ field: "displayName", direction: "desc" as const }),
      employmentStatusAsc: Object.freeze({ field: "employmentStatus", direction: "asc" as const }),
      employmentStatusDesc: Object.freeze({ field: "employmentStatus", direction: "desc" as const }),
      createdAtAsc: Object.freeze({ field: "createdAt", direction: "asc" as const }),
      createdAtDesc: Object.freeze({ field: "createdAt", direction: "desc" as const }),
      updatedAtAsc: Object.freeze({ field: "updatedAt", direction: "asc" as const }),
      updatedAtDesc: Object.freeze({ field: "updatedAt", direction: "desc" as const }),
    }),
    defaultSort: "displayNameAsc",
    filters: Object.freeze({
      employmentStatus: Object.freeze({ field: "employmentStatus", op: "==" as const }),
      employmentStatusIn: Object.freeze({ field: "employmentStatus", op: "in" as const }),
      operationalRoles: Object.freeze({ field: "operationalRoles", op: "array-contains" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  metadataEquipment: Object.freeze({
    capability: "service.equipment.read",
    source: "equipment",
    orderBy: Object.freeze(["name", "asc"] as const),
    allowedSorts: Object.freeze({
      nameAsc: Object.freeze({ field: "name", direction: "asc" as const }),
      nameDesc: Object.freeze({ field: "name", direction: "desc" as const }),
      statusAsc: Object.freeze({ field: "status", direction: "asc" as const }),
      statusDesc: Object.freeze({ field: "status", direction: "desc" as const }),
      createdAtAsc: Object.freeze({ field: "createdAt", direction: "asc" as const }),
      createdAtDesc: Object.freeze({ field: "createdAt", direction: "desc" as const }),
      updatedAtAsc: Object.freeze({ field: "updatedAt", direction: "asc" as const }),
      updatedAtDesc: Object.freeze({ field: "updatedAt", direction: "desc" as const }),
    }),
    defaultSort: "nameAsc",
    filters: Object.freeze({
      status: Object.freeze({ field: "status", op: "==" as const }),
      statusIn: Object.freeze({ field: "status", op: "in" as const }),
      accountId: Object.freeze({ field: "accountId", op: "==" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  metadataLocations: Object.freeze({
    capability: "crm.location.read",
    source: "locations",
    orderBy: Object.freeze(["name", "asc"] as const),
    allowedSorts: Object.freeze({
      nameAsc: Object.freeze({ field: "name", direction: "asc" as const }),
      nameDesc: Object.freeze({ field: "name", direction: "desc" as const }),
      createdAtAsc: Object.freeze({ field: "createdAt", direction: "asc" as const }),
      createdAtDesc: Object.freeze({ field: "createdAt", direction: "desc" as const }),
      updatedAtAsc: Object.freeze({ field: "updatedAt", direction: "asc" as const }),
      updatedAtDesc: Object.freeze({ field: "updatedAt", direction: "desc" as const }),
    }),
    defaultSort: "nameAsc",
    filters: Object.freeze({
      accountId: Object.freeze({ field: "accountId", op: "==" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  metadataParts: Object.freeze({
    capability: "inventory.catalog.read",
    source: "parts",
    orderBy: Object.freeze(["internalPartNumber", "asc"] as const),
    allowedSorts: Object.freeze({
      internalPartNumberAsc: Object.freeze({ field: "internalPartNumber", direction: "asc" as const }),
      internalPartNumberDesc: Object.freeze({ field: "internalPartNumber", direction: "desc" as const }),
      nameAsc: Object.freeze({ field: "name", direction: "asc" as const }),
      nameDesc: Object.freeze({ field: "name", direction: "desc" as const }),
      statusAsc: Object.freeze({ field: "status", direction: "asc" as const }),
      statusDesc: Object.freeze({ field: "status", direction: "desc" as const }),
      stockingClassAsc: Object.freeze({ field: "stockingClass", direction: "asc" as const }),
      stockingClassDesc: Object.freeze({ field: "stockingClass", direction: "desc" as const }),
      createdAtAsc: Object.freeze({ field: "createdAt", direction: "asc" as const }),
      createdAtDesc: Object.freeze({ field: "createdAt", direction: "desc" as const }),
      updatedAtAsc: Object.freeze({ field: "updatedAt", direction: "asc" as const }),
      updatedAtDesc: Object.freeze({ field: "updatedAt", direction: "desc" as const }),
    }),
    defaultSort: "internalPartNumberAsc",
    filters: Object.freeze({
      status: Object.freeze({ field: "status", op: "==" as const }),
      statusIn: Object.freeze({ field: "status", op: "in" as const }),
      stockingClass: Object.freeze({ field: "stockingClass", op: "==" as const }),
      stockingClassIn: Object.freeze({ field: "stockingClass", op: "in" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  metadataReorderRequests: Object.freeze({
    capability: "reorder.request.read.queue",
    source: "reorder_requests",
    orderBy: Object.freeze(["createdAt", "desc"] as const),
    allowedSorts: Object.freeze({
      reorderRequestNumberAsc: Object.freeze({ field: "reorderRequestNumber", direction: "asc" as const }),
      reorderRequestNumberDesc: Object.freeze({ field: "reorderRequestNumber", direction: "desc" as const }),
      createdAtAsc: Object.freeze({ field: "createdAt", direction: "asc" as const }),
      createdAtDesc: Object.freeze({ field: "createdAt", direction: "desc" as const }),
      lastPurchasingUpdateAtAsc: Object.freeze({ field: "lastPurchasingUpdateAt", direction: "asc" as const }),
      lastPurchasingUpdateAtDesc: Object.freeze({ field: "lastPurchasingUpdateAt", direction: "desc" as const }),
      orderedAtAsc: Object.freeze({ field: "orderedAt", direction: "asc" as const }),
      orderedAtDesc: Object.freeze({ field: "orderedAt", direction: "desc" as const }),
    }),
    defaultSort: "createdAtDesc",
    filters: Object.freeze({
      statusIn: Object.freeze({ field: "status", op: "in" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  metadataPurchaseOrders: Object.freeze({
    capability: "reorder.purchaseOrder.read",
    source: "reorder_purchase_orders",
    orderBy: Object.freeze(["createdAt", "desc"] as const),
    allowedSorts: Object.freeze({
      supplierNameAsc: Object.freeze({ field: "supplierName", direction: "asc" as const }),
      supplierNameDesc: Object.freeze({ field: "supplierName", direction: "desc" as const }),
      externalPoNumberAsc: Object.freeze({ field: "externalPoNumber", direction: "asc" as const }),
      externalPoNumberDesc: Object.freeze({ field: "externalPoNumber", direction: "desc" as const }),
      orderedDateAsc: Object.freeze({ field: "orderedDate", direction: "asc" as const }),
      orderedDateDesc: Object.freeze({ field: "orderedDate", direction: "desc" as const }),
      createdAtAsc: Object.freeze({ field: "createdAt", direction: "asc" as const }),
      createdAtDesc: Object.freeze({ field: "createdAt", direction: "desc" as const }),
    }),
    defaultSort: "createdAtDesc",
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 200,
  }),

  // ════════════════════ A DORMANT COLLECTION, MIGRATED AS DORMANT ════════════════════
  //
  // The Epic-5 `purchase_orders` collection. Its only writer is a demo seed script -- no deployed
  // callable writes it -- and the live purchase orders are `reorder_purchase_orders` above. The
  // Operations overview's `openProcurementCount` still reads THIS one, so it is registered as it
  // is rather than quietly repointed: changing which collection a metric counts is a correctness
  // change with an owner, not a side effect of moving a read off Firestore. Recorded as product
  // debt in the closure ledger.
  // ════════════════════ THE COMPLETE-POPULATION SOURCES ════════════════════
  //
  // Four sources that differ from their metadata siblings in ONE respect: they are ordered by
  // DOCUMENT ID. That is not a stylistic preference. Firestore's orderBy SILENTLY EXCLUDES any
  // document missing the ordered field, so paging a whole collection by createdAt / occurredAt /
  // unitPrice hands the caller a population that is short by exactly the documents that lack it --
  // and these four feed netting: available stock, reconciliation position, inventory consumption,
  // the operational overview. A total computed over a quietly short population is not partial, it
  // is wrong under a complete name. Every document has an id.
  //
  // They reuse their resource's EXISTING capability rather than minting anything: the authority
  // question is identical, and only the ordering differs.
  purchaseOrderDirectory: Object.freeze({
    capability: "reorder.purchaseOrder.read",
    source: "reorder_purchase_orders",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 500,
  }),

  transferOrderDirectory: Object.freeze({
    capability: "warehouse.transferOrder.read",
    source: "transfer_orders",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 500,
    // Either endpoint, matching the retired rule's two isAssignedToWarehouse branches.
    scope: Object.freeze({
      assignment: "WAREHOUSE" as const,
      capability: "warehouse.transferOrder.read.assigned",
      fields: Object.freeze(["fromWarehouseId", "toWarehouseId"]),
    }),
  }),

  inventoryTransactionLedger: Object.freeze({
    capability: "inventory.transaction.read",
    source: "inventory_transactions",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 500,
  }),

  supplierDirectory: Object.freeze({
    capability: "supplier.record.read",
    source: "suppliers",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 500,
  }),

  supplierCatalogDirectory: Object.freeze({
    capability: "supplier.catalog.read",
    source: "supplier_catalog",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 500,
  }),

  legacyPurchaseOrders: Object.freeze({
    capability: "supplier.purchaseOrder.read",
    source: "purchase_orders",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 500,
  }),

  metadataPurchaseOrderVoids: Object.freeze({
    capability: "reorder.purchaseOrder.read",
    source: "reorder_purchase_order_voids",
    orderBy: Object.freeze(["createdAt", "desc"] as const),
    allowedSorts: Object.freeze({
      createdAtAsc: Object.freeze({ field: "createdAt", direction: "asc" as const }),
      createdAtDesc: Object.freeze({ field: "createdAt", direction: "desc" as const }),
    }),
    defaultSort: "createdAtDesc",
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 200,
  }),

  metadataInventoryActions: Object.freeze({
    capability: "inventory.action.read",
    source: "inventory_actions",
    orderBy: Object.freeze(["createdAt", "desc"] as const),
    allowedSorts: Object.freeze({
      createdAtAsc: Object.freeze({ field: "createdAt", direction: "asc" as const }),
      createdAtDesc: Object.freeze({ field: "createdAt", direction: "desc" as const }),
    }),
    defaultSort: "createdAtDesc",
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 200,
  }),

  metadataInventoryTransactions: Object.freeze({
    capability: "inventory.transaction.read",
    source: "inventory_transactions",
    orderBy: Object.freeze(["occurredAt", "desc"] as const),
    allowedSorts: Object.freeze({
      occurredAtAsc: Object.freeze({ field: "occurredAt", direction: "asc" as const }),
      occurredAtDesc: Object.freeze({ field: "occurredAt", direction: "desc" as const }),
    }),
    defaultSort: "occurredAtDesc",
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 200,
  }),

  // Scoped identically to transferOrderDirectory: the same collection read by a different surface
  // is the same authorization question, and a scope declared on one source but not its sibling is
  // exactly how a narrowing gets bypassed by picking the other one.
  metadataTransferOrders: Object.freeze({
    capability: "warehouse.transferOrder.read",
    source: "transfer_orders",
    orderBy: Object.freeze(["createdAt", "desc"] as const),
    allowedSorts: Object.freeze({
      transferOrderNumberAsc: Object.freeze({ field: "transferOrderNumber", direction: "asc" as const }),
      transferOrderNumberDesc: Object.freeze({ field: "transferOrderNumber", direction: "desc" as const }),
      statusAsc: Object.freeze({ field: "status", direction: "asc" as const }),
      statusDesc: Object.freeze({ field: "status", direction: "desc" as const }),
      createdAtAsc: Object.freeze({ field: "createdAt", direction: "asc" as const }),
      createdAtDesc: Object.freeze({ field: "createdAt", direction: "desc" as const }),
      updatedAtAsc: Object.freeze({ field: "updatedAt", direction: "asc" as const }),
      updatedAtDesc: Object.freeze({ field: "updatedAt", direction: "desc" as const }),
    }),
    defaultSort: "createdAtDesc",
    filters: Object.freeze({
      status: Object.freeze({ field: "status", op: "==" as const }),
      statusIn: Object.freeze({ field: "status", op: "in" as const }),
    }),
    projection: null,
    maxPageSize: 200,
    scope: Object.freeze({
      assignment: "WAREHOUSE" as const,
      capability: "warehouse.transferOrder.read.assigned",
      fields: Object.freeze(["fromWarehouseId", "toWarehouseId"]),
    }),
  }),

  metadataTrucks: Object.freeze({
    capability: "inventory.truckRegistry.read",
    source: "trucks",
    orderBy: Object.freeze(["displayLabel", "asc"] as const),
    allowedSorts: Object.freeze({
      displayLabelAsc: Object.freeze({ field: "displayLabel", direction: "asc" as const }),
      displayLabelDesc: Object.freeze({ field: "displayLabel", direction: "desc" as const }),
      statusAsc: Object.freeze({ field: "status", direction: "asc" as const }),
      statusDesc: Object.freeze({ field: "status", direction: "desc" as const }),
      createdAtAsc: Object.freeze({ field: "createdAt", direction: "asc" as const }),
      createdAtDesc: Object.freeze({ field: "createdAt", direction: "desc" as const }),
      updatedAtAsc: Object.freeze({ field: "updatedAt", direction: "asc" as const }),
      updatedAtDesc: Object.freeze({ field: "updatedAt", direction: "desc" as const }),
    }),
    defaultSort: "displayLabelAsc",
    filters: Object.freeze({
      homeWarehouseId: Object.freeze({ field: "homeWarehouseId", op: "==" as const }),
      status: Object.freeze({ field: "status", op: "==" as const }),
      statusIn: Object.freeze({ field: "status", op: "in" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  metadataMobileLocations: Object.freeze({
    capability: "inventory.truckRegistry.read",
    source: "mobile_locations",
    orderBy: Object.freeze(["displayLabel", "asc"] as const),
    allowedSorts: Object.freeze({
      displayLabelAsc: Object.freeze({ field: "displayLabel", direction: "asc" as const }),
      displayLabelDesc: Object.freeze({ field: "displayLabel", direction: "desc" as const }),
      createdAtAsc: Object.freeze({ field: "createdAt", direction: "asc" as const }),
      createdAtDesc: Object.freeze({ field: "createdAt", direction: "desc" as const }),
      updatedAtAsc: Object.freeze({ field: "updatedAt", direction: "asc" as const }),
      updatedAtDesc: Object.freeze({ field: "updatedAt", direction: "desc" as const }),
    }),
    defaultSort: "displayLabelAsc",
    filters: Object.freeze({
      active: Object.freeze({ field: "active", op: "==" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  // Scoped identically to warehouseDirectory below -- see that entry.
  metadataWarehouses: Object.freeze({
    capability: "warehouse.record.read",
    source: "warehouses",
    orderBy: Object.freeze(["name", "asc"] as const),
    allowedSorts: Object.freeze({
      nameAsc: Object.freeze({ field: "name", direction: "asc" as const }),
      nameDesc: Object.freeze({ field: "name", direction: "desc" as const }),
      statusAsc: Object.freeze({ field: "status", direction: "asc" as const }),
      statusDesc: Object.freeze({ field: "status", direction: "desc" as const }),
    }),
    defaultSort: "nameAsc",
    filters: Object.freeze({
      status: Object.freeze({ field: "status", op: "==" as const }),
      statusIn: Object.freeze({ field: "status", op: "in" as const }),
    }),
    projection: null,
    maxPageSize: 200,
    scope: Object.freeze({
      assignment: "WAREHOUSE" as const,
      capability: "warehouse.record.read.assigned",
      fields: Object.freeze([DOCUMENT_ID_FIELD]),
    }),
  }),

  metadataSuppliers: Object.freeze({
    capability: "supplier.record.read",
    source: "suppliers",
    orderBy: Object.freeze(["name", "asc"] as const),
    allowedSorts: Object.freeze({
      nameAsc: Object.freeze({ field: "name", direction: "asc" as const }),
      nameDesc: Object.freeze({ field: "name", direction: "desc" as const }),
      statusAsc: Object.freeze({ field: "status", direction: "asc" as const }),
      statusDesc: Object.freeze({ field: "status", direction: "desc" as const }),
      vendorNumberAsc: Object.freeze({ field: "vendorNumber", direction: "asc" as const }),
      vendorNumberDesc: Object.freeze({ field: "vendorNumber", direction: "desc" as const }),
      createdAtAsc: Object.freeze({ field: "createdAt", direction: "asc" as const }),
      createdAtDesc: Object.freeze({ field: "createdAt", direction: "desc" as const }),
      updatedAtAsc: Object.freeze({ field: "updatedAt", direction: "asc" as const }),
      updatedAtDesc: Object.freeze({ field: "updatedAt", direction: "desc" as const }),
    }),
    defaultSort: "nameAsc",
    filters: Object.freeze({
      status: Object.freeze({ field: "status", op: "==" as const }),
      statusIn: Object.freeze({ field: "status", op: "in" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  // No list view declares this entity today (`supplierCatalogItem` has an entity definition and no
  // INDEX or RELATED list). Registered anyway, from the FIELD-LEVEL declarations the definition
  // already carries -- the entity says how it is read, and leaving it CLIENT_DIRECT would keep a
  // deny-all collection reachable by a client-direct query for a surface that does not exist yet.
  // The sorts and filters here are exactly what the definition declares: nothing invented for a
  // future screen, nothing dropped.
  metadataSupplierCatalog: Object.freeze({
    capability: "supplier.catalog.read",
    source: "supplier_catalog",
    orderBy: Object.freeze(["unitPrice", "asc"] as const),
    allowedSorts: Object.freeze({
      unitPriceAsc: Object.freeze({ field: "unitPrice", direction: "asc" as const }),
      unitPriceDesc: Object.freeze({ field: "unitPrice", direction: "desc" as const }),
    }),
    defaultSort: "unitPriceAsc",
    filters: Object.freeze({
      supplierId: Object.freeze({ field: "supplierId", op: "==" as const }),
      partId: Object.freeze({ field: "partId", op: "==" as const }),
      available: Object.freeze({ field: "available", op: "==" as const }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  // TECHNICIAN PROFILES. The unscoped directory read, behind the capability ruled 2026-09-07.
  //
  // The SELF read is deliberately NOT a source here. "The technician mapped to the caller" is not a
  // filter a client supplies -- it is a scope the server derives from request.auth.uid -- and
  // expressing it as a governed filter would put a technician id back in the browser's hands, which
  // is the one thing the whole scoped seam exists to prevent. It lives in the scoped work-order
  // service instead, beside the assignment scope that resolves the same identity.
  technicianDirectory: Object.freeze({
    capability: "service.technician.read",
    source: "fieldops_technicians",
    orderBy: Object.freeze(["name", "asc"] as const),
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 200,
  }),

  // ── PARTS ─────────────────────────────────────────────────────────────────────────────────
  // All three reuse the EXISTING inventory.catalog.read -- already in the catalog, already granted,
  // and already exactly "may this person read the parts catalogue". Three sources rather than one
  // with optional filters because two of them are DEFINED by their filter: "serial-tracked parts"
  // and "whole-unit parts" are the questions, and an optional filter would silently answer "every
  // part" the moment a caller omitted it. partMaster is the deliberate unfiltered read.
  partsBySerialControl: Object.freeze({
    capability: "inventory.catalog.read",
    source: "parts",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({
      controlType: Object.freeze({ field: "controlType", op: "==" as const, required: true }),
    }),
    projection: null,
    // 500 because that is the cap the picker this replaces already used, and the cap is a
    // deliberate guard against an unexpectedly large catalogue rather than an expected size. A
    // lower ceiling here would REJECT the caller's existing page size outright -- pageSize above
    // maxPageSize is an input error, not a silent clamp -- so a mismatch would not quietly truncate
    // the picker, it would break it.
    maxPageSize: 500,
  }),

  partsWholeUnit: Object.freeze({
    capability: "inventory.catalog.read",
    source: "parts",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({
      wholeUnit: Object.freeze({ field: "wholeUnit", op: "==" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  partMaster: Object.freeze({
    capability: "inventory.catalog.read",
    source: "parts",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 200,
  }),

  // Inventory actions for ONE part. partId is required: this answers "what happened to this part",
  // and unfiltered it would be the whole activity ledger.
  inventoryActionsForPart: Object.freeze({
    capability: "inventory.action.read",
    source: "inventory_actions",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({
      partId: Object.freeze({ field: "partId", op: "==" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  // ── THE TRUCK REGISTRY ────────────────────────────────────────────────────────────────────
  // Two collections, one capability, because they are one object: a truck IS its mobile location,
  // the registry reads them together, and Rules gated them identically. Both are unfiltered
  // full-collection reads today, so neither declares a filter -- adding one nobody uses would be
  // designing rather than migrating.
  truckRegistry: Object.freeze({
    capability: "inventory.truckRegistry.read",
    source: "trucks",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 200,
  }),

  // The warehouse pick-list. Reuses the EXISTING warehouse.record.read -- already in the catalog,
  // already granted to the shared admin+dispatcher base -- rather than adding a truck-flavoured
  // one. The question "may this person see the warehouses" does not change because a truck form is
  // what is asking.
  warehouseDirectory: Object.freeze({
    capability: "warehouse.record.read",
    source: "warehouses",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({}),
    projection: null,
    maxPageSize: 200,
    // The record IS the warehouse, so the assignment is matched against the document id -- the
    // retired rule's isAssignedToWarehouse(warehouseId), where warehouseId was the path segment.
    scope: Object.freeze({
      assignment: "WAREHOUSE" as const,
      capability: "warehouse.record.read.assigned",
      fields: Object.freeze([DOCUMENT_ID_FIELD]),
    }),
  }),

  mobileLocations: Object.freeze({
    capability: "inventory.truckRegistry.read",
    source: "mobile_locations",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
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

  // The SAME question asked of several accounts at once -- the candidate-set read behind the
  // duplicate-customer check, which issued one `where("accountId", "in", ids)`. A separate source
  // rather than a second optional filter on `accountLocations`, because that entry's `accountId` is
  // `required: true` and an entry whose filters are all optional silently answers "all locations"
  // the moment a caller forgets a parameter. Same capability, same collection, same rows: only the
  // shape of the predicate differs, and `in` is bounded to 30 by the service.
  accountsLocations: Object.freeze({
    capability: "crm.location.read",
    source: "locations",
    orderBy: Object.freeze(["name", "asc"] as const),
    filters: Object.freeze({
      accountIds: Object.freeze({ field: "accountId", op: "in" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 200,
  }),

  // EQUIPMENT. Four client shapes existed and each gets its own source rather than being folded
  // into one entry with optional filters. "Equipment for this account" and "equipment at this
  // location" are different questions, and an entry whose filters are all optional is an entry that
  // silently answers "all equipment" the moment a caller forgets a parameter.
  // Customer locations by id -- the keyed lookup the installed-equipment register uses to resolve
  // location names. Same capability as accountLocations: the authorization question ("may this
  // person read customer locations") does not change because the predicate is an id set.
  locationsByIds: Object.freeze({
    capability: "crm.location.read",
    source: "locations",
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    filters: Object.freeze({
      ids: Object.freeze({ field: DOCUMENT_ID_FIELD, op: "in" as const, required: true }),
    }),
    projection: null,
    maxPageSize: 30,
  }),

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

  // ── REORDER REQUESTS ARE NOT A GOVERNED LIST SOURCE ───────────────────────────────────────
  //
  // They were: `reorderRequestsQueue` and `reorderRequestsHistory` lived here, and a comment
  // beside them claimed that assignedToUserId / reviewedBy / assignedBy "never were an
  // access-control boundary". MEASURED AGAINST THE RETIRED RULE, THAT WAS WRONG, and it is deleted
  // rather than softened. The rule read:
  //
  //   allow read: if isAdminOrDispatcher()
  //     || (isActiveOperationalRole("PARTS_MANAGER") && status == "READY_FOR_PARTS_MANAGER")
  //     || (isActiveOperationalRole("PARTS_MANAGER") && status in ["ASSIGNED_TO_PARTS_ASSOCIATE", "PURCHASING_IN_PROGRESS"])
  //     || (isActiveOperationalRole("PARTS_MANAGER") && (reviewedBy == uid || assignedBy == uid))
  //     || (isActiveOperationalRole("PARTS_ASSOCIATE") && assignedToUserId == uid);
  //
  // Those fields WERE the scope for a Parts Manager and a Parts Associate. A single source with a
  // single capability could only have carried one of the three populations, and carrying the
  // global one would have handed a Parts Manager the entire queue.
  //
  // So the read lives in a dedicated seam that resolves which population this principal gets --
  // global, then manager-scoped, then own-assignment, broadest first so holding a narrow
  // capability never shrinks a broader authority. See reorderRequest/scopedReorderReadService.ts.
  // Nothing is registered here, because a registered source is a reachable one.

  // Reorder Purchase Orders are keyed BY the reorder request id -- the document id is the request
  // id, not a separate PO id -- so one keyed-lookup source serves both the batched resolver and the
  // single-PO read on a request. No second entry for "one PO": same capability, same ordering,
  // same predicate with one value.
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

  // The VOID record for a purchase order, also keyed by the reorder request id. Its own source
  // rather than a filter on the one above, because it is a different collection -- and it shares
  // the purchase-order capability because voiding is part of that object's story, not a new
  // authority. reorder.purchaseOrder.void governs performing a void; reading whether one happened
  // is reading the purchase order.
  purchaseOrderVoidsByIds: Object.freeze({
    capability: "reorder.purchaseOrder.read",
    source: "reorder_purchase_order_voids",
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
