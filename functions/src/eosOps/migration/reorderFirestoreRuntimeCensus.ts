// THE REORDER FIRESTORE RUNTIME CENSUS -- the hard activation gate.
//
// Pure data plus derivations: no database, no Firebase, no I/O, no scanning. Its companion suite
// DERIVES the executable set from the repository and asserts the two correspond in BOTH directions,
// so this cannot go stale and cannot be satisfied by forgetting a file.
//
// ════════════════════ WHY THE TRANSITION GATE WAS NOT ENOUGH ════════════════════
//
// reorderFirestoreRetirementGate.ts proves a governed command EXISTS for every legacy transition.
// It does not prove that anything CALLS it. Those are different facts, and the gap between them is
// precisely where a cutover goes wrong: the commands were all present and correct while the client
// was still reviewing, starting purchasing, posting updates, receiving and cancelling straight into
// Firestore, and while `recordPurchaseOrder` still went through a Firebase callable.
//
// So this census asks the only question that decides activation: DOES ANY RUNTIME CODE STILL REACH
// FIRESTORE FOR A REORDER? The gate opens at zero, and at nothing else.
//
// ════════════════════ THE SAME NAME IS TWO DIFFERENT THINGS ════════════════════
//
// `reorder_requests` is a Firestore collection AND a PostgreSQL table. A schema qualifier -- a
// literal `eos_ops.` or the `${SCHEMA}.` the repositories interpolate -- means PostgreSQL. Only an
// UNQUALIFIED name is a Firestore collection, and the derivation counts accordingly. Without that
// discriminator every governed command this cutover added would count as a Firestore consumer,
// which would make the gate unsatisfiable by construction.
export const REORDER_FIRESTORE_OBJECTS = Object.freeze([
  /** reorder_requests -- the object this cutover moves. */
  "REORDER_REQUEST",
  /** reorder_purchase_orders -- a DIFFERENT object, with its own authority and its own cutover. */
  "PURCHASE_ORDER",
  /** reorder_purchase_order_voids -- likewise. */
  "PURCHASE_ORDER_VOID",
] as const);
export type ReorderFirestoreObject = (typeof REORDER_FIRESTORE_OBJECTS)[number];

export const RUNTIME_CLASSIFICATIONS = Object.freeze([
  /** Live code that READS the Firestore object to serve a user. BLOCKS activation. */
  "RUNTIME_READ",
  /** Live code that WRITES it, including through a Firebase callable authority. BLOCKS activation. */
  "RUNTIME_WRITE",
  /** Migration tooling, parity matrices, census modules. Evidence, never runtime authority. */
  "MIGRATION_EVIDENCE",
  /** firestore.rules itself -- the authority retired at the final deployment step. */
  "RULES_AUTHORITY",
  /** Names the collection in a shape, catalog or constant and reaches nothing. */
  "DEAD",
] as const);
export type RuntimeClassification = (typeof RUNTIME_CLASSIFICATIONS)[number];

/** The two that block. Nothing else does, and nothing else is allowed to. */
export const BLOCKING_RUNTIME_CLASSIFICATIONS: readonly RuntimeClassification[] =
  Object.freeze(["RUNTIME_READ", "RUNTIME_WRITE"]);

export interface RuntimeCensusEntry {
  readonly path: string;
  readonly object: ReorderFirestoreObject;
  readonly classification: RuntimeClassification;
  /** What this file does with the collection, in one line. */
  readonly consumer: string;
  /** Executable occurrences, comments excluded, schema-qualified names excluded. */
  readonly occurrences: number;
}

const e = (entry: RuntimeCensusEntry): RuntimeCensusEntry => Object.freeze(entry);

export const REORDER_FIRESTORE_RUNTIME_CENSUS: readonly RuntimeCensusEntry[] = Object.freeze([
  // ══════════ the Rules: the authority itself, retired at the final deployment step ══════════
  e({
    path: "firestore.rules", object: "REORDER_REQUEST", classification: "RULES_AUTHORITY",
    consumer: "the reorder_requests, reorder_purchase_orders and reorder_purchase_order_voids match "
      + "blocks -- where Firestore's Reorder authority actually lives, and the one thing that is "
      + "retired by a deployment rather than by a code change",
    occurrences: 27,
  }),

  // ══════════ REORDER_REQUEST: what still reaches Firestore at runtime ══════════
  e({
    path: "functions/src/reorderRequest/reorderCallables.ts", object: "REORDER_REQUEST", classification: "DEAD",
    consumer: "the Firebase callable Reorder authority (createReorderRequest, recordReorderPurchaseOrder). "
      + "BOTH now have zero callers -- the client calls the governed PostgreSQL commands -- but the "
      + "callables remain EXPORTED from index.ts and therefore still deployed. Unreachable, not absent.",
    occurrences: 2,
  }),
  e({
    path: "functions/src/ai/workOrderReadinessContext.ts", object: "REORDER_REQUEST", classification: "RUNTIME_READ",
    consumer: "reads reorder_requests to tell a Work Order whether its parts are on order",
    occurrences: 1,
  }),

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
    classification: "RUNTIME_READ",
    consumer: "the Procurement panel's purchase-order read. Its REORDER side now comes from the "
      + "governed PostgreSQL authority; only the purchase order -- a different object -- is still "
      + "Firestore's, which is why this counts here and not against the Reorder gate.",
    occurrences: 1,
  }),
  e({
    path: "functions/src/inventoryReceiving/receivingSourceResolver.ts", object: "PURCHASE_ORDER",
    classification: "RUNTIME_READ", consumer: "resolves a receipt's source purchase order", occurrences: 1,
  }),
  e({
    path: "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts", object: "PURCHASE_ORDER",
    classification: "RUNTIME_READ", consumer: "reads the purchase order a receipt is against", occurrences: 2,
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
  /** True only when NO runtime consumer of the Reorder Request object remains. */
  readonly ready: boolean;
  /** The runtime consumers still reaching Firestore for a Reorder Request. Empty exactly when ready. */
  readonly blockedBy: readonly string[];
  readonly runtimeConsumerCount: number;
  /**
   * Purchase-order and void runtime consumers. Reported, and deliberately NOT part of the gate:
   * they belong to a different object with its own authority. Stated so the number is never zero by
   * omission.
   */
  readonly purchaseOrderRuntimeConsumers: readonly string[];
}

/**
 * MAY THE REORDER REQUEST AUTHORITY BE ACTIVATED?
 *
 * Only when RUNTIME_FIRESTORE_CONSUMERS == ZERO for the Reorder Request object. Migration evidence
 * and the Rules authority are excluded -- evidence reaches nothing, and the Rules are retired at the
 * final deployment step by design. Nothing else is excluded, and DEAD is not an excuse: a DEAD entry
 * asserts the file reaches nothing, and the suite checks that claim.
 */
export function reorderRuntimeActivationReadiness(
  census: readonly RuntimeCensusEntry[] = REORDER_FIRESTORE_RUNTIME_CENSUS,
): RuntimeActivationReadiness {
  const blocking = census.filter((c) =>
    c.object === "REORDER_REQUEST" && BLOCKING_RUNTIME_CLASSIFICATIONS.includes(c.classification));
  const po = census.filter((c) =>
    c.object !== "REORDER_REQUEST" && BLOCKING_RUNTIME_CLASSIFICATIONS.includes(c.classification));
  return Object.freeze({
    ready: blocking.length === 0,
    blockedBy: Object.freeze(blocking.map((c) => c.path).sort()),
    runtimeConsumerCount: blocking.length,
    purchaseOrderRuntimeConsumers: Object.freeze(po.map((c) => c.path).sort()),
  });
}
