// WHICH CORE OBJECTS HAVE A RECORD PAGE, AND WHETHER THE SCREEN REALLY MOUNTS IT.
//
// GOVERNANCE: Owner package "UX CORE RECORD PAGES", 2026-08-24.
//
// ════════════════════ THE SAME SHAPE AS THE LIST MANIFEST, FOR THE SAME REASON ════════════════════
//
// `uxMigrationManifest.js` exists because a release report claimed six object lists had shipped
// filters and sort when two had — it was written from what had been BUILT rather than what was
// MOUNTED, and nothing in the repository could tell the difference.
//
// Record pages can fail the same way twice over:
//
//   1. a screen declares a page definition and never renders it, so the metadata is decorative
//   2. a screen renders the shell AND keeps its own hand-written field grid, so the shared grammar
//      quietly forks and the next object inherits a fork rather than a shell
//
// Status is DERIVED by reading the real screen files. Nothing here can be ticked by hand, and the
// numbers are not duplicated anywhere for a stale copy to agree with.

/** Statuses, weakest first. Only evidence moves an object up this list. */
export const RECORD_PAGE_STATUS = Object.freeze({
  /** No page definition at all. */
  NONE: "NONE",
  /** A definition exists; the screen does not mount the shell. Decorative metadata. */
  CONTRACT_ONLY: "CONTRACT_ONLY",
  /** The screen mounts the shared shell against its declared definition. */
  MOUNTED: "MOUNTED",
  /** Named as deferred, on purpose, with a reason. Not a failure and not a pass. */
  DEFERRED: "DEFERRED",
});

/**
 * The core objects, and where each one's record page lives.
 *
 * `screen` is the file a reader would open. `definitionModule` is what must be imported by it.
 * `deferred` records a deliberate exclusion so "not migrated" and "not yet looked at" stay
 * different facts.
 */
export const RECORD_PAGE_OBJECTS = Object.freeze([
  {
    objectId: "account",
    screen: "src/modules/accounts/AccountDetail.jsx",
    definitionModule: "accountPage.js",
  },
  {
    objectId: "equipment",
    screen: "src/modules/equipment/EquipmentDetail.jsx",
    definitionModule: "equipmentPage.js",
  },
  {
    objectId: "salesOrder",
    screen: "src/modules/sales/SalesOrderDetail.jsx",
    definitionModule: "salesOrderPage.js",
  },
  {
    objectId: "workOrder",
    screen: "src/modules/workOrders/WorkOrderDetailPage.jsx",
    definitionModule: "workOrderPage.js",
  },
  {
    objectId: "part",
    screen: "src/modules/inventory/PartDetail.jsx",
    definitionModule: null,
    // DEFERRED, with the reason, because "we chose not to" and "we forgot" must not look alike.
    // PartDetail is 1,684 lines carrying inventory, procurement, demand, serialized and Part Master
    // responsibilities at once. Migrating it is a decomposition, not a re-layout, and it has its
    // own package.
    deferred: "PartDetail carries several subsystems at once; decomposition is its own package.",
  },
  {
    objectId: "purchaseOrder",
    screen: "src/modules/purchasing/PurchaseOrders.jsx",
    definitionModule: null,
    // Blocked upstream, not deferred by preference: `purchase_orders` holds zero documents and the
    // reachable screen reads `reorder_purchase_orders`, so which collection IS the Purchase Order
    // is an open contract question. A record page cannot be built for a record of record nobody
    // has named.
    deferred: "Source-of-record contract unresolved — see PURCHASE_ORDER_CANONICAL_COLLECTION_IS_EMPTY.",
  },
]);

/** The evidence a screen must show to count as MOUNTED. Both, not either. */
export const MOUNT_EVIDENCE = Object.freeze({
  shell: /<MetadataRecordPage/,
  definition: /^import \{[^}]*RecordPage[^}]*\} from ".*\/definitions\//m,
});

/**
 * Evaluate one object against its real screen file.
 *
 * `readFile` is injected so this is testable without a filesystem and so the test reads the SAME
 * files a reader would.
 */
export function evaluateRecordPage(entry, readFile) {
  if (entry.deferred) {
    return { objectId: entry.objectId, status: RECORD_PAGE_STATUS.DEFERRED, reason: entry.deferred, mounts: {} };
  }

  let source = null;
  try {
    source = readFile(entry.screen);
  } catch {
    // A file that cannot be read is not evidence of anything, and this is the direction that
    // matters: a missing screen must never round up.
    return { objectId: entry.objectId, status: RECORD_PAGE_STATUS.NONE, screenMissing: true, mounts: {} };
  }

  const mounts = {
    shell: MOUNT_EVIDENCE.shell.test(source),
    definition: MOUNT_EVIDENCE.definition.test(source),
  };

  if (!entry.definitionModule) return { objectId: entry.objectId, status: RECORD_PAGE_STATUS.NONE, mounts };
  const status = mounts.shell && mounts.definition
    ? RECORD_PAGE_STATUS.MOUNTED
    : RECORD_PAGE_STATUS.CONTRACT_ONLY;
  return { objectId: entry.objectId, status, mounts };
}

export function evaluateAllRecordPages(readFile) {
  return RECORD_PAGE_OBJECTS.map((entry) => evaluateRecordPage(entry, readFile));
}

/**
 * Hand-written field grids on a screen that has already been migrated.
 *
 * The second failure mode, and the quieter one: a migrated screen that keeps rendering its own
 * `.fo-detail-list` has forked the shared grammar, and every object after it inherits the fork.
 *
 * `.fo-detail-list` is NOT banned outright — five surfaces this package does not touch render
 * through it legitimately, and EquipmentDetail keeps ONE panel deliberately, because that panel
 * distinguishes a failed read from an unknown one and offers a Retry the generic grid has no slot
 * for. What is reported is the COUNT, so a migrated screen growing a second grid is visible.
 */
export function handWrittenGridCount(source) {
  return (source.match(/className="fo-detail-list"/g) ?? []).length;
}
