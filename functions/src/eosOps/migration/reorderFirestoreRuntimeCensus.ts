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
// ════════════════════ AND WRONG A SECOND TIME: CONSTANTS, AND A CALLABLE THAT IS A WRITER BY SOURCE ════════════════════
//
// The census then read `field-ops-app-vite/src/domain/constants.js` as DEAD -- "the collection-name
// constant" -- and never asked who IMPORTED the constant. Every client hook that read
// `reorder_purchase_orders` / `reorder_purchase_order_voids` did so through PURCHASE_ORDERS_COLLECTION
// and REORDER_PURCHASE_ORDER_VOIDS_COLLECTION, so none of them was counted. The derivation now follows the
// constants too: a client module that imports one of them from domain/constants.js and USES it is an
// occurrence at its own path, exactly as if it had spelled the name.
//
// It also never saw the receiving callable. `receiveInventoryStock` is a Reorder WRITER for one source
// type (REORDER_PURCHASE_ORDER: it moves the Firestore Reorder Request to RECEIVED) and not for the other
// (the canonical PURCHASE_ORDER). Its client transport names it only through a CALLABLE_NAMES table in
// another module, so a name match missed it. The derivation now finds receiving transports through that
// indirection and counts one as a Reorder callable consumer exactly when it can put a
// REORDER_PURCHASE_ORDER source on the wire.
//
// And it called the legacy receive write "FROZEN". That was true of the repository's code and false of
// the Functions DEPLOYED in nonprod, which pre-date the freeze. A census entry states what runs, not what
// is written down: see the receiving entries below.
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
  /**
   * A Firestore source WRITER that is gated by the cutover freeze
   * (`reorderSourceFreeze.assertReorderSourceWritable`).
   *
   * STILL BLOCKS ACTIVATION, and that is the point of giving it its own name rather than moving it
   * out of the blocking set. The freeze is a constant that is FALSE today: the writer is present,
   * deployed and answering, and it stops writing only when the freeze is turned on. Classifying it
   * as "handled" would let the gate open while the code that mutates the source is still live.
   *
   * What it does buy is truthfulness about WHY a consumer is still here: this one has its refusal
   * built and waiting, and a plain FIRESTORE_RUNTIME_WRITE does not.
   */
  "FIRESTORE_SOURCE_WRITER_FROZEN",
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
  "FIRESTORE_RUNTIME_READ", "FIRESTORE_RUNTIME_WRITE", "FIRESTORE_SOURCE_WRITER_FROZEN",
  "CALLABLE_CLIENT_WRAPPER",
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
  /** The census key is (path, object). A file touching two objects has two entries. */
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
  e({ path: "firestore.rules", object: "REORDER_REQUEST", classification: "RULES_AUTHORITY",
    consumer: "the reorder_requests match block -- where Firestore's Reorder authority lives", occurrences: 10 }),
  e({ path: "firestore.rules", object: "PURCHASE_ORDER", classification: "RULES_AUTHORITY",
    consumer: "the reorder_purchase_orders match block", occurrences: 9 }),
  e({ path: "firestore.rules", object: "PURCHASE_ORDER_VOID", classification: "RULES_AUTHORITY",
    consumer: "the reorder_purchase_order_voids match block", occurrences: 8 }),

  // ══════════ WHERE THE FREEZE AND THE PURCHASE-ORDER MIGRATION ARE ══════════
  //
  // `reorderRequest/reorderSourceFreeze.ts` (the cutover write gate) and
  // `eosOps/migration/reorderPurchaseOrderMigration{,Copy}.ts` (the Purchase Order / void DRY RUN,
  // COPY ONCE and VERIFY) appear in NO entry here, for the same reason the PostgreSQL receipt does:
  // neither names an UNQUALIFIED Firestore collection in executable code. The freeze names them only
  // in prose, and the migration layer addresses `${SCHEMA}.`-qualified PostgreSQL tables.
  //
  // This census MEASURES; it is not a place to advertise that something exists. Listing them would
  // make the derivation and the census disagree, and the gate reads the census's length as a count
  // of blockers. What the freeze DOES change here is the classification of the writers it gates --
  // see FIRESTORE_SOURCE_WRITER_FROZEN below, which still blocks activation.

  // ══════════ WHERE THE REPLACEMENT IS, AND WHY IT IS NOT LISTED ══════════
  //
  // `functions/src/eosOps/receiveReorderStockCommand.ts` is the governed PostgreSQL receipt that
  // answers the defect below. It appears in NO entry here, and that absence is the measurement: this
  // census counts files naming an UNQUALIFIED Firestore collection, and every table the receipt
  // touches is written `${SCHEMA}.`-qualified. A file that reaches only PostgreSQL is not a consumer
  // of anything this census measures.
  //
  // That the replacement EXISTS is proved elsewhere, by the thing that asks that question:
  // reorderFirestoreRetirementGate.ts's TRANSITION_COVERAGE, where ORDERED -> RECEIVED now names
  // `receiveReorderStock`. Listing it here as well would make this census a mixed record of what
  // still reaches Firestore and what replaced it, and the gate reads its length as a count of
  // blockers.

  // ══════════ THE DEFECT THIS MODEL EXISTS TO CATCH -- and what closed it ══════════
  //
  // The legacy ORDERED -> RECEIVED write is still in the repository and still DEPLOYED. What changed is
  // that no EOS client path reaches its Reorder branch any more: a Reorder Purchase Order is received
  // through the governed PostgreSQL receipt (field-ops-app-vite/src/services/reorderReceivingClient.js ->
  // receiveReorderStock), and the one client transport that still names receiveInventoryStock
  // (receivingCallableClient.js) can only send the canonical PURCHASE_ORDER source. The companion suite
  // DERIVES both facts from the client source; it does not take them from this comment.
  //
  // So these are DEPLOYED legacy authority with no repository callers -- externally invokable Firebase
  // code that blocks the Firebase RETIREMENT, which is retirement-only work, and not the activation.
  e({
    path: "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts", object: "REORDER_REQUEST",
    classification: "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
    consumer: "THE LEGACY ORDERED -> RECEIVED WRITE. On a REORDER_PURCHASE_ORDER-sourced receipt it "
      + "updates the Firestore Reorder Request with { status: RECEIVED, receivedAt, receivedBy }. The "
      + "repository's copy refuses that branch through reorderSourceFreeze, but the copy DEPLOYED in nonprod "
      + "pre-dates the freeze and would still write it. No repository client sends it that source any more "
      + "(the Reorder receipt goes to the PostgreSQL receiveReorderStock); the canonical PURCHASE_ORDER "
      + "receipt shares this command and is its own authority. Deployed and externally invokable until its "
      + "export is removed and that removal deployed.",
    occurrences: 1,
  }),
  e({
    path: "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts", object: "PURCHASE_ORDER",
    classification: "DEAD",
    consumer: "declares the reorder_purchase_orders collection name and never uses it: the legacy branch "
      + "never writes the Reorder Purchase Order (it is immutable), and its source is read by "
      + "receivingSourceResolver.ts",
    occurrences: 1,
  }),
  e({
    path: "functions/src/inventoryReceiving/receivingSourceResolver.ts", object: "PURCHASE_ORDER",
    classification: "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
    consumer: "resolves a REORDER_PURCHASE_ORDER receipt's source purchase order from Firestore -- the "
      + "legacy branch of the deployed receiveInventoryStock, which no repository client reaches any more. "
      + "A purchase order recorded in PostgreSQL is invisible here, which is why the Reorder receipt left.",
    occurrences: 1,
  }),

  // ══════════ the Firebase callable authority: DEPLOYED, not dead ══════════
  e({
    path: "functions/src/reorderRequest/reorderCallables.ts", object: "REORDER_REQUEST",
    classification: "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
    consumer: "createReorderRequest and recordReorderPurchaseOrder write the Reorder Request. No "
      + "repository caller remains, and the REPOSITORY export was removed from index.ts (Controller PARTS / "
      + "PURCHASING / RECEIVING RULINGS, 2026-10-01) -- but the Functions DEPLOYED in nonprod still carry them, "
      + "externally invokable, until a Firebase deploy carries the removal (none is authorized). Both persist "
      + "functions are GATED by reorderSourceFreeze, the half of the freeze Rules cannot provide.",
    occurrences: 1,
  }),
  e({
    path: "functions/src/reorderRequest/reorderCallables.ts", object: "PURCHASE_ORDER",
    classification: "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
    consumer: "recordReorderPurchaseOrder creates the purchase order document", occurrences: 1,
  }),

  // ══════════ the client purchase-order and void reads: GONE ══════════
  //
  // operationsQueries.ts (Procurement panel, shadow-parity diagnostic), usePurchaseOrdersByIds.js,
  // useReorderPurchaseOrders.js and useReorderPurchaseOrderVoids.js read the governed
  // readReorderPurchaseOrders now. They appear in no entry because they name no Reorder collection, by
  // literal OR by imported constant -- which the derivation now checks.

  // ══════════ THE SYNTHETIC FIXTURE DECLARATION ══════════
  //
  // It NAMES the three Reorder collections, in executable code, so the derivation finds it and it
  // must be classified. It is MIGRATION_EVIDENCE, not a consumer: it reads nothing, writes nothing
  // and reaches no authority. It states which documents in those collections are repository-authored
  // SBX-SCN-001 scenario fixtures rather than business records -- the distinction the governed
  // migration mapper correctly refuses to blur, and which the retirement tool acts on.
  //
  // Classifying it as a consumer would make the activation gate count a declaration as a blocker;
  // leaving it out would make the census and the repository disagree.
  e({ path: "functions/src/sandboxFixtures/reorderScenarioFixtures.ts", object: "REORDER_REQUEST",
    classification: "MIGRATION_EVIDENCE",
    consumer: "declares the 5 synthetic ro-sbx Reorder Request fixtures and how to recognise one",
    occurrences: 8 }),
  e({ path: "functions/src/sandboxFixtures/reorderScenarioFixtures.ts", object: "PURCHASE_ORDER",
    classification: "MIGRATION_EVIDENCE",
    consumer: "declares the 3 synthetic ro-sbx purchase order fixtures", occurrences: 5 }),
  e({ path: "functions/src/sandboxFixtures/reorderScenarioFixtures.ts", object: "PURCHASE_ORDER_VOID",
    classification: "MIGRATION_EVIDENCE",
    consumer: "names the void collection in the retirement scope; the scenario declares no void fixture",
    occurrences: 2 }),

  // ══════════ MIGRATION EVIDENCE ══════════
  e({ path: "functions/src/eosOps/migration/reorderFieldParityMatrix.ts", object: "REORDER_REQUEST",
    classification: "MIGRATION_EVIDENCE", consumer: "the parity matrix names the source collection", occurrences: 1 }),
  e({ path: "functions/src/eosOps/migration/reorderObjectMigrationCopy.ts", object: "REORDER_REQUEST",
    classification: "MIGRATION_EVIDENCE", consumer: "the COPY executor names the source collection", occurrences: 1 }),
  // The EOS_REORDER_SNAPSHOT format read by the Render-shell cutover CLI (scripts/reorderCutover.js). It names the three
  // legacy collections as the keys of an exported FILE; it loads no Firebase module and reads no Firestore.
  e({ path: "functions/src/eosOps/migration/reorderSnapshot.ts", object: "REORDER_REQUEST",
    classification: "MIGRATION_EVIDENCE", consumer: "the snapshot format names the source collection it carries", occurrences: 5 }),
  e({ path: "functions/src/eosOps/migration/reorderSnapshot.ts", object: "PURCHASE_ORDER",
    classification: "MIGRATION_EVIDENCE", consumer: "the snapshot format names the source collection it carries", occurrences: 2 }),
  e({ path: "functions/src/eosOps/migration/reorderSnapshot.ts", object: "PURCHASE_ORDER_VOID",
    classification: "MIGRATION_EVIDENCE", consumer: "the snapshot format names the source collection it carries", occurrences: 2 }),
  // DQ-032: the COPY exclusion names the three legacy collections of the snapshot FILE it filters (and the reference
  // fields between them); it loads no Firebase module and reads no Firestore.
  e({ path: "functions/src/eosOps/migration/reorderMigrationExclusion.ts", object: "REORDER_REQUEST",
    classification: "MIGRATION_EVIDENCE", consumer: "the DQ-032 exclusion names the snapshot collection it filters", occurrences: 6 }),
  e({ path: "functions/src/eosOps/migration/reorderMigrationExclusion.ts", object: "PURCHASE_ORDER",
    classification: "MIGRATION_EVIDENCE", consumer: "the DQ-032 exclusion names the snapshot collection it filters", occurrences: 5 }),
  e({ path: "functions/src/eosOps/migration/reorderMigrationExclusion.ts", object: "PURCHASE_ORDER_VOID",
    classification: "MIGRATION_EVIDENCE", consumer: "the DQ-032 exclusion names the snapshot collection it filters", occurrences: 1 }),
  // Option B (2026-09-30): the pinned Sample Company fixture registry names the PostgreSQL target table it classifies.
  e({ path: "functions/src/eosOps/migration/reorderKnownFixtures.ts", object: "REORDER_REQUEST",
    classification: "MIGRATION_EVIDENCE", consumer: "the known-fixture registry names the target table it classifies", occurrences: 1 }),
  e({ path: "functions/src/eosOps/migration/assignedToUserIdCensus.ts", object: "REORDER_REQUEST",
    classification: "MIGRATION_EVIDENCE", consumer: "the assignee census names the collection", occurrences: 1 }),
  e({ path: "functions/src/eosOps/migration/purchasingMigrationMapping.ts", object: "REORDER_REQUEST",
    classification: "MIGRATION_EVIDENCE", consumer: "the mapping contract names the target column", occurrences: 1 }),
  e({ path: "functions/src/supplierMaster/reorderPurchaseOrderSupplierMigration.ts", object: "PURCHASE_ORDER",
    classification: "MIGRATION_EVIDENCE", consumer: "the supplier back-fill's source census", occurrences: 1 }),
  e({ path: "functions/src/supplierMaster/reorderPurchaseOrderSupplierMigrationExecute.ts", object: "PURCHASE_ORDER",
    classification: "MIGRATION_EVIDENCE", consumer: "the supplier back-fill executor", occurrences: 1 }),

  // ══════════ names them, reaches nothing ══════════
  // The DECLARATION of the collection-name constants. Declaring reaches nothing; every module that
  // imports and USES one is counted at its own path by the constant-following derivation, so this entry
  // can no longer hide a consumer the way it once hid four.
  e({ path: "field-ops-app-vite/src/domain/constants.js", object: "REORDER_REQUEST", classification: "DEAD",
    consumer: "declares REORDER_REQUESTS_COLLECTION; its users are counted where they use it", occurrences: 1 }),
  e({ path: "field-ops-app-vite/src/domain/constants.js", object: "PURCHASE_ORDER", classification: "DEAD",
    consumer: "declares PURCHASE_ORDERS_COLLECTION; its users are counted where they use it", occurrences: 1 }),
  e({ path: "field-ops-app-vite/src/domain/constants.js", object: "PURCHASE_ORDER_VOID", classification: "DEAD",
    consumer: "declares REORDER_PURCHASE_ORDER_VOIDS_COLLECTION; its users are counted where they use it", occurrences: 1 }),
  // The metadata entity bindings. Each declares `collection:` through the constant (now counted), and
  // each is DEAD for a checked reason: no screen runs their index lists through the metadata list runtime
  // (the companion suite asserts nothing outside metadata/definitions imports them), and nothing reads
  // Firestore through the entity registry's collection field.
  e({ path: "field-ops-app-vite/src/metadata/definitions/reorderRequest.js", object: "REORDER_REQUEST",
    classification: "DEAD", consumer: "the Reorder Request metadata binding", occurrences: 3 }),
  e({ path: "field-ops-app-vite/src/metadata/definitions/reorderRequest.js", object: "PURCHASE_ORDER",
    classification: "DEAD", consumer: "its related-object binding", occurrences: 2 }),
  e({ path: "field-ops-app-vite/src/metadata/definitions/reorderRequest.js", object: "PURCHASE_ORDER_VOID",
    classification: "DEAD", consumer: "its related-object binding", occurrences: 1 }),
  e({ path: "field-ops-app-vite/src/metadata/definitions/purchaseOrder.js", object: "PURCHASE_ORDER",
    classification: "DEAD", consumer: "the purchase order metadata binding", occurrences: 4 }),
  e({ path: "field-ops-app-vite/src/metadata/definitions/purchaseOrder.js", object: "REORDER_REQUEST",
    classification: "DEAD", consumer: "its related-object binding", occurrences: 1 }),
  e({ path: "field-ops-app-vite/src/metadata/definitions/purchaseOrder.js", object: "PURCHASE_ORDER_VOID",
    classification: "DEAD", consumer: "its related-object binding", occurrences: 1 }),
  e({ path: "field-ops-app-vite/src/metadata/definitions/purchaseOrderVoid.js", object: "REORDER_REQUEST",
    classification: "DEAD", consumer: "the void metadata binding's related object", occurrences: 2 }),
  e({ path: "field-ops-app-vite/src/metadata/definitions/purchaseOrderVoid.js", object: "PURCHASE_ORDER_VOID",
    classification: "DEAD", consumer: "the void metadata binding", occurrences: 1 }),
  e({ path: "field-ops-app-vite/src/domain/reporting/reportCatalog.js", object: "REORDER_REQUEST",
    classification: "DEAD", consumer: "names the collection in the client report catalog", occurrences: 1 }),
  e({ path: "field-ops-app-vite/src/domain/reporting/reportCatalog.js", object: "PURCHASE_ORDER",
    classification: "DEAD", consumer: "names the collection in the client report catalog", occurrences: 1 }),
  e({ path: "functions/src/reporting/reportCatalog.ts", object: "REORDER_REQUEST",
    classification: "DEAD", consumer: "names the collection in the trusted report catalog", occurrences: 1 }),
  e({ path: "functions/src/reporting/reportCatalog.ts", object: "PURCHASE_ORDER",
    classification: "DEAD", consumer: "names the collection in the trusted report catalog", occurrences: 1 }),
  e({ path: "field-ops-app-vite/src/access/legacyAuthorizationSurface.ts", object: "REORDER_REQUEST",
    classification: "DEAD", consumer: "the legacy authorization surface census, client side", occurrences: 1 }),
  e({ path: "field-ops-app-vite/src/access/legacyAuthorizationSurface.ts", object: "PURCHASE_ORDER",
    classification: "DEAD", consumer: "the same census", occurrences: 1 }),
  e({ path: "field-ops-app-vite/src/access/legacyAuthorizationSurface.ts", object: "PURCHASE_ORDER_VOID",
    classification: "DEAD", consumer: "the same census", occurrences: 1 }),
  e({ path: "functions/src/access/legacyAuthorizationSurface.ts", object: "REORDER_REQUEST",
    classification: "DEAD", consumer: "the legacy authorization surface census, server side", occurrences: 1 }),
  e({ path: "functions/src/access/legacyAuthorizationSurface.ts", object: "PURCHASE_ORDER",
    classification: "DEAD", consumer: "the same census", occurrences: 1 }),
  e({ path: "functions/src/access/legacyAuthorizationSurface.ts", object: "PURCHASE_ORDER_VOID",
    classification: "DEAD", consumer: "the same census", occurrences: 1 }),
  e({ path: "functions/src/ownership/ownershipDerivation.ts", object: "REORDER_REQUEST",
    classification: "DEAD", consumer: "names the collection in the ownership family map", occurrences: 1 }),
  e({ path: "functions/src/ownership/ownershipDerivation.ts", object: "PURCHASE_ORDER",
    classification: "DEAD", consumer: "names the collection in the ownership family map", occurrences: 1 }),
  e({ path: "functions/src/ownership/ownershipMatrix.ts", object: "REORDER_REQUEST",
    classification: "DEAD", consumer: "names the collection in the ownership matrix", occurrences: 1 }),
  e({ path: "functions/src/ownership/ownershipMatrix.ts", object: "PURCHASE_ORDER",
    classification: "DEAD", consumer: "names the collection in the ownership matrix", occurrences: 1 }),
]);

export interface RuntimeActivationReadiness {
  /**
   * True only when NO runtime consumer of ANY Reorder object remains, of any kind -- the Reorder Request,
   * the Reorder Purchase Order and its void record alike (Owner ruling: the Reorder domain's runtime census
   * gate is ZERO at activation).
   */
  readonly ready: boolean;
  readonly blockedBy: readonly string[];
  readonly runtimeConsumerCount: number;
  /** True only when the Firebase Reorder authority is also gone -- a LATER step than activation. */
  readonly firebaseRetired: boolean;
  readonly firebaseRetirementBlockedBy: readonly string[];
  /**
   * Purchase-order and void runtime consumers, reported on their own as well.
   *
   * THEY ARE PART OF THE GATE NOW. They were once reported and excluded, on the ground that the purchase
   * order was "a different object with its own authority". At this activation it is not: the governed
   * PostgreSQL commands record and void the Reorder Purchase Order, and PostgreSQL serves its reads
   * (readReorderPurchaseOrders), so a client still reading the Firestore copy is reading a frozen snapshot
   * of an object PostgreSQL owns. Excluding them would let the gate read zero over live stale reads.
   */
  readonly purchaseOrderRuntimeConsumers: readonly string[];
}

/**
 * MAY THE REORDER AUTHORITY BE ACTIVATED, AND IS FIREBASE RETIRED?
 *
 * Two questions, answered separately because they are answered at different steps. Activation needs
 * zero runtime consumers -- Firestore reads, Firestore writes, and callable client wrappers alike.
 * Retirement additionally needs the deployed callable exports gone.
 */
export function reorderRuntimeActivationReadiness(
  census: readonly RuntimeCensusEntry[] = REORDER_LEGACY_RUNTIME_CENSUS,
): RuntimeActivationReadiness {
  // EVERY Reorder object. Keyed (path, object), so a file blocking on two objects counts twice.
  const blocking = census.filter((c) => ACTIVATION_BLOCKING.includes(c.classification));
  const retirementBlocking = census.filter((c) => RETIREMENT_BLOCKING.includes(c.classification));
  const po = blocking.filter((c) => c.object !== "REORDER_REQUEST");
  const paths = (rows: readonly RuntimeCensusEntry[]) => Object.freeze([...new Set(rows.map((c) => c.path))].sort());
  return Object.freeze({
    ready: blocking.length === 0,
    blockedBy: paths(blocking),
    runtimeConsumerCount: blocking.length,
    firebaseRetired: retirementBlocking.length === 0,
    firebaseRetirementBlockedBy: paths(retirementBlocking),
    purchaseOrderRuntimeConsumers: paths(po),
  });
}
