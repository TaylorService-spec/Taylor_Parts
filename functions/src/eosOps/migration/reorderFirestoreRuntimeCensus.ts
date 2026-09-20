// THE REORDER LEGACY-RUNTIME CENSUS -- the hard activation gate.
//
// Pure data plus derivations: no database, no Firebase, no I/O, no scanning. Its companion suite
// DERIVES the executable set from the repository and asserts the two correspond in BOTH directions.
//
// ════════════════════ WHY THIS CENSUS EXISTS, AND WHY IT WAS WRONG ONCE ════════════════════
//
// reorderFirestoreRetirementGate.ts proves a governed command EXISTS for every legacy transition.
// It does not prove anything CALLS one. Those are different facts.
//
// The first version of THIS census then made a narrower version of the same mistake. It asked
// "does any file still name a Firestore Reorder collection?" and concluded the Firebase callable
// authority was dead because no file named `submitCreateReorderRequest`. It never asked whether a
// file reached a callable THROUGH A WRAPPER -- and one did: `fetchReorderWarehouseOptions` in a
// transport module, called by a hook and a dashboard, reaching `listReorderWarehouseOptions`.
//
// A census that only matches names measures the names, not the reachability. So the derivation now
// follows IMPORTS: a client module that imports a wrapper which reaches a Reorder callable is a
// callable consumer, however many hops away it sits.
//
// ════════════════════ THE SAME NAME IS TWO DIFFERENT THINGS ════════════════════
//
// `reorder_requests` is a Firestore collection AND a PostgreSQL table. A schema qualifier -- a
// literal `eos_ops.` or the `${SCHEMA}.` the repositories interpolate -- means PostgreSQL. Only an
// UNQUALIFIED name is a Firestore collection. Without that discriminator every governed command
// this cutover added would count as a legacy consumer and the gate could never open.
export const REORDER_LEGACY_OBJECTS = Object.freeze([
  /** reorder_requests -- the object this cutover moves. */
  "REORDER_REQUEST",
  /** reorder_purchase_orders -- a DIFFERENT object, with its own authority and its own cutover. */
  "PURCHASE_ORDER",
  /** reorder_purchase_order_voids -- likewise. */
  "PURCHASE_ORDER_VOID",
] as const);
export type ReorderLegacyObject = (typeof REORDER_LEGACY_OBJECTS)[number];

export const RUNTIME_CLASSIFICATIONS = Object.freeze([
  /** Live code that READS the Firestore object to serve a user. BLOCKS activation. */
  "FIRESTORE_RUNTIME_READ",
  /** Live code that WRITES it directly. BLOCKS activation. */
  "FIRESTORE_RUNTIME_WRITE",
  /** A client module that reaches a Reorder Firebase callable, directly or through a wrapper. BLOCKS. */
  "CALLABLE_CLIENT_WRAPPER",
  /**
   * A Firebase callable EXPORTED from the Functions entry point, and therefore deployed and
   * externally invokable. BLOCKS the Firebase retirement, though not the PostgreSQL activation.
   */
  "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
  /** Reaches the governed PostgreSQL authority. The target state; blocks nothing. */
  "RENDER_RUNTIME",
  /** Migration tooling, parity matrices, census modules. Evidence, never runtime authority. */
  "MIGRATION_EVIDENCE",
  /** firestore.rules itself -- the authority retired at the final deployment step. */
  "RULES_AUTHORITY",
  /** Names the collection in a shape, catalog or constant and reaches nothing. */
  "DEAD",
] as const);
export type RuntimeClassification = (typeof RUNTIME_CLASSIFICATIONS)[number];

/** The three that block PostgreSQL activation. */
export const ACTIVATION_BLOCKING: readonly RuntimeClassification[] = Object.freeze([
  "FIRESTORE_RUNTIME_READ", "FIRESTORE_RUNTIME_WRITE", "CALLABLE_CLIENT_WRAPPER",
]);

/**
 * What additionally blocks the FIREBASE RETIREMENT, which is a later and separate step.
 *
 * A callable with no repository callers is NOT dead. It is exported from the Functions entry point,
 * so it is deployed and externally invokable by anything holding a token -- a second write
 * authority that this repository simply cannot see the callers of. It becomes RETIRED only when its
 * export is removed and that removal is deployed.
 */
export const RETIREMENT_BLOCKING: readonly RuntimeClassification[] = Object.freeze([
  ...ACTIVATION_BLOCKING, "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
]);

export interface RuntimeCensusEntry {
  readonly path: string;
  readonly object: ReorderLegacyObject;
  readonly classification: RuntimeClassification;
  /** What this file does, in one line. */
  readonly consumer: string;
  /** Executable occurrences, comments excluded, schema-qualified names excluded. */
  readonly occurrences: number;
}

const e = (entry: RuntimeCensusEntry): RuntimeCensusEntry => Object.freeze(entry);

export const REORDER_LEGACY_RUNTIME_CENSUS: readonly RuntimeCensusEntry[] = Object.freeze([
  // ══════════ the Rules: the authority itself, retired at the final deployment step ══════════
  e({
    path: "firestore.rules", object: "REORDER_REQUEST", classification: "RULES_AUTHORITY",
    consumer: "the reorder_requests, reorder_purchase_orders and reorder_purchase_order_voids match "
      + "blocks -- where Firestore's Reorder authority actually lives, retired by a deployment",
    occurrences: 27,
  }),

  // ══════════ the Firebase callable authority: DEPLOYED, not dead ══════════
  e({
    path: "functions/src/reorderRequest/reorderCallables.ts", object: "REORDER_REQUEST",
    classification: "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
    consumer: "createReorderRequest, recordReorderPurchaseOrder and listReorderWarehouseOptions. No "
      + "repository caller remains -- the client calls the governed PostgreSQL commands -- but all "
      + "three are still exported from index.ts, so they are deployed and externally invokable. "
      + "Legacy business authority until the export is removed AND that removal is deployed.",
    occurrences: 2,
  }),

  // ══════════ REORDER_REQUEST: what still reaches Firestore at runtime ══════════
  //
  // Nothing. The Work Order readiness projection was the last one, and Owner Ruling A retired its
  // procurement source rather than bridging it: that runtime is Firebase Functions, it has no
  // PostgreSQL access, and it reports PROCUREMENT_SOURCE_UNAVAILABLE instead of the false NONE a
  // vanished source would otherwise produce.

  // ══════════ REORDER_REQUEST: names it, reaches nothing ══════════
  e({
    path: "field-ops-app-vite/src/domain/constants.js", object: "REORDER_REQUEST", classification: "DEAD",
    consumer: "the collection-name constants. Naming a collection is not reaching it.", occurrences: 3,
  }),
  e({
    path: "field-ops-app-vite/src/metadata/definitions/reorderRequest.js", object: "REORDER_REQUEST", classification: "DEAD",
    consumer: "the Reorder Request metadata definition's collection binding", occurrences: 5,
  }),
  e({
    path: "field-ops-app-vite/src/domain/reporting/reportCatalog.js", object: "REORDER_REQUEST", classification: "DEAD",
    consumer: "names the collection in the client report catalog", occurrences: 2,
  }),
  e({
    path: "functions/src/reporting/reportCatalog.ts", object: "REORDER_REQUEST", classification: "DEAD",
    consumer: "names the collection in the trusted report catalog", occurrences: 2,
  }),
  e({
    path: "field-ops-app-vite/src/access/legacyAuthorizationSurface.ts", object: "REORDER_REQUEST", classification: "DEAD",
    consumer: "the legacy authorization surface census names the collection as evidence", occurrences: 3,
  }),
  e({
    path: "functions/src/access/legacyAuthorizationSurface.ts", object: "REORDER_REQUEST", classification: "DEAD",
    consumer: "the same census, server side", occurrences: 3,
  }),
  e({
    path: "functions/src/ownership/ownershipDerivation.ts", object: "REORDER_REQUEST", classification: "DEAD",
    consumer: "names the collection in the ownership family map", occurrences: 2,
  }),
  e({
    path: "functions/src/ownership/ownershipMatrix.ts", object: "REORDER_REQUEST", classification: "DEAD",
    consumer: "names the collection in the ownership matrix", occurrences: 2,
  }),

  // ══════════ MIGRATION EVIDENCE ══════════
  e({
    path: "functions/src/eosOps/migration/reorderFieldParityMatrix.ts", object: "REORDER_REQUEST",
    classification: "MIGRATION_EVIDENCE", consumer: "the parity matrix names the source collection", occurrences: 1,
  }),
  e({
    path: "functions/src/eosOps/migration/reorderObjectMigrationCopy.ts", object: "REORDER_REQUEST",
    classification: "MIGRATION_EVIDENCE", consumer: "the COPY executor names the source collection", occurrences: 1,
  }),
  e({
    path: "functions/src/eosOps/migration/assignedToUserIdCensus.ts", object: "REORDER_REQUEST",
    classification: "MIGRATION_EVIDENCE", consumer: "the assignee census names the collection", occurrences: 1,
  }),
  e({
    path: "functions/src/eosOps/migration/purchasingMigrationMapping.ts", object: "REORDER_REQUEST",
    classification: "MIGRATION_EVIDENCE", consumer: "the mapping contract names the target column", occurrences: 1,
  }),

  // ══════════ PURCHASE_ORDER / VOID: a DIFFERENT object, and NOT this cutover ══════════
  //
  // Listed because the derivation finds them and because a Firestore Reorder retirement eventually
  // needs them, but they do not gate THIS activation: the Reorder Request object can become
  // PostgreSQL-authoritative while the purchase order is still Firestore's, exactly as the
  // assignment authority shipped before the object did.
  e({
    path: "field-ops-app-vite/src/services/operationsQueries.ts", object: "PURCHASE_ORDER",
    classification: "FIRESTORE_RUNTIME_READ",
    consumer: "the Procurement panel's purchase-order read. Its REORDER side now comes from the "
      + "governed PostgreSQL authority; only the purchase order is still Firestore's.",
    occurrences: 1,
  }),
  e({
    path: "functions/src/inventoryReceiving/receivingSourceResolver.ts", object: "PURCHASE_ORDER",
    classification: "FIRESTORE_RUNTIME_READ", consumer: "resolves a receipt's source purchase order", occurrences: 1,
  }),
  e({
    path: "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts", object: "PURCHASE_ORDER",
    classification: "FIRESTORE_RUNTIME_READ", consumer: "reads the purchase order a receipt is against", occurrences: 2,
  }),
  e({
    path: "functions/src/supplierMaster/reorderPurchaseOrderSupplierMigration.ts", object: "PURCHASE_ORDER",
    classification: "MIGRATION_EVIDENCE", consumer: "the supplier back-fill's source census", occurrences: 1,
  }),
  e({
    path: "functions/src/supplierMaster/reorderPurchaseOrderSupplierMigrationExecute.ts", object: "PURCHASE_ORDER",
    classification: "MIGRATION_EVIDENCE", consumer: "the supplier back-fill executor", occurrences: 1,
  }),
  e({
    path: "field-ops-app-vite/src/metadata/definitions/purchaseOrder.js", object: "PURCHASE_ORDER",
    classification: "DEAD", consumer: "the purchase order metadata definition's collection binding", occurrences: 5,
  }),
  e({
    path: "field-ops-app-vite/src/metadata/definitions/purchaseOrderVoid.js", object: "PURCHASE_ORDER_VOID",
    classification: "DEAD", consumer: "the void metadata definition's collection binding", occurrences: 2,
  }),
]);

export interface RuntimeActivationReadiness {
  /** True only when NO runtime consumer of the Reorder Request object remains, of any kind. */
  readonly ready: boolean;
  readonly blockedBy: readonly string[];
  readonly runtimeConsumerCount: number;
  /** True only when the Firebase Reorder authority is also gone -- a LATER step than activation. */
  readonly firebaseRetired: boolean;
  readonly firebaseRetirementBlockedBy: readonly string[];
  /**
   * Purchase-order and void runtime consumers. Reported, and deliberately NOT part of the gate:
   * a different object with its own authority. Stated so the number is never zero by omission.
   */
  readonly purchaseOrderRuntimeConsumers: readonly string[];
}

/**
 * MAY THE REORDER REQUEST AUTHORITY BE ACTIVATED, AND IS FIREBASE RETIRED?
 *
 * Two questions, answered separately because they are answered at different steps. Activation needs
 * zero runtime consumers -- Firestore reads, Firestore writes, and callable client wrappers alike.
 * Retirement additionally needs the deployed callable exports gone.
 */
export function reorderRuntimeActivationReadiness(
  census: readonly RuntimeCensusEntry[] = REORDER_LEGACY_RUNTIME_CENSUS,
): RuntimeActivationReadiness {
  const reorder = census.filter((c) => c.object === "REORDER_REQUEST");
  const blocking = reorder.filter((c) => ACTIVATION_BLOCKING.includes(c.classification));
  const retirementBlocking = reorder.filter((c) => RETIREMENT_BLOCKING.includes(c.classification));
  const po = census.filter((c) =>
    c.object !== "REORDER_REQUEST" && ACTIVATION_BLOCKING.includes(c.classification));
  return Object.freeze({
    ready: blocking.length === 0,
    blockedBy: Object.freeze(blocking.map((c) => c.path).sort()),
    runtimeConsumerCount: blocking.length,
    firebaseRetired: retirementBlocking.length === 0,
    firebaseRetirementBlockedBy: Object.freeze(retirementBlocking.map((c) => c.path).sort()),
    purchaseOrderRuntimeConsumers: Object.freeze(po.map((c) => c.path).sort()),
  });
}
