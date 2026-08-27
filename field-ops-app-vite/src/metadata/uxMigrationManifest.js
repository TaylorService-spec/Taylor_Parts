// THE UX MIGRATION MANIFEST — what is actually mounted, derived from source, never asserted.
//
// GOVERNANCE: docs/releases/ux-sandbox-release.md, Owner correction 2026-08-24.
//
// ============================ WHY THIS EXISTS ============================
//
// A release report claimed six object lists had shipped filters, sort and URL state. Two had. The
// other four had metadata definitions, gap registers and authority traces — real work, and none of
// it reachable by a person. The report was written from what had been BUILT rather than from what
// was MOUNTED, and nothing in the repository could tell the difference.
//
// So the difference is now computed. Each object below declares where its screen is, and
// `evaluateMigration` reads that file and reports what it finds. A checkbox cannot be ticked by
// hand: there are no booleans in this file to tick.
//
// ============================ STATUS IS DERIVED, NOT PROMOTED ============================
//
//   CONTRACT_ONLY        metadata exists; the screen does not mount it
//   MERGED_UI            the screen mounts it and tests are green
//   DEPLOYED_UNVERIFIED  the runtime is deployed; no authenticated smoke yet
//   LIVE_VERIFIED        a reachable authenticated session proved it
//
// The first two are decided by this module from source. The last two cannot be — deployment and
// authenticated proof are facts about an environment, so they are supplied by the caller and are
// never inferred from code. That asymmetry is the point: the previous report inferred "shipped"
// from "written", and this makes that inference impossible.

// ============================ TWO DATA SHAPES, TWO SETS OF EVIDENCE ============================
//
// This manifest was written when there was one kind of migrated list: a bounded, cursor-paged read
// on the metadata runtime. Lists P2 (docs/north-star/lists/) ratifies a SECOND shape as equally
// first-class — a COMPLETE governed read, which returns the caller's whole authorized scope in one
// call — and rules that each shape renders only the affordances its read genuinely supports:
//
//   "Three governed data shapes only — complete read (no controls; Opportunity), cursor-paged read
//    ('Load more' + governed aggregate total; Work Orders/metadata runtime) ..."
//
// Judging a complete-read collection by CURSOR_PAGED's evidence reports it CONTRACT_ONLY forever, and
// for the worst possible reason: it would be marked unmigrated precisely BECAUSE it correctly
// declines to render a filter builder, a sort control and URL criteria over a read that has no
// server-side query to attach them to. That is the manifest measuring the wrong screen again — the
// same mistake its own `equipment` entry records — one level up.
//
// So the shape is declared per object and chooses the evidence table. Anything that does not declare
// one is CURSOR_PAGED, so every entry that predates this is judged exactly as before.
export const COLLECTION_SHAPE = Object.freeze({
  CURSOR_PAGED: "CURSOR_PAGED",
  COMPLETE_READ: "COMPLETE_READ",
});

/** What a cursor-paged migrated list must mount, and the token in source that proves each one. */
export const MOUNT_EVIDENCE = Object.freeze({
  controls: "MetadataListControls",
  urlState: "useListCriteria",
  addFilter: "AddFilter",
  sort: "SortControl",
  activeCriteria: "ActiveCriteria",
  droppedCriteria: "DroppedCriteriaNotice",
  emptyState: "ListEmptyState",
});

/**
 * What a COMPLETE-READ migrated list must mount.
 *
 * Deliberately a SHORTER list, and each of the three required members is required for a reason the
 * cursor-paged table cannot express:
 *
 *   identity  — the collection wears the North Star page grammar rather than a workspace shell.
 *   states    — it routes its unsettled reads through the shared honest-state vocabulary. Without
 *               this a complete read has no way to distinguish denied from empty, which on a
 *               collection is the difference between "your role" and "your business".
 *   rowAnchor — the row reaches the record. A complete-read list with no route out is a report.
 *
 * `views` and `narrowing` are OPTIONAL: a collection with one meaningful slice and few enough rows to
 * scan needs neither, and demanding them would push a family into building affordances its domain
 * does not justify — which is how the shared grammar would start dictating product.
 */
export const COMPLETE_READ_MOUNT_EVIDENCE = Object.freeze({
  identity: "WorkspaceIdentity",
  states: "HonestState",
  rowAnchor: "ns-row__ref",
  views: "ns-collection__views",
  narrowing: "ns-toolbar",
});

/** Phone presentation. Each architecture proves it its own way; any one of the three counts. */
export const CARD_EVIDENCE = Object.freeze({
  sharedGrid: "MetadataListGrid",
  stackModifier: "fo-table--stack",
  // The North Star collection table recomposes to structured rows below the phone breakpoint in
  // index.css (`.ns-collection__table thead { display: none }` and the block that follows), rather
  // than through a class the shared grid supplies. Same property, different mechanism — and the
  // mechanism is what this file can see from source.
  northStarTable: "ns-collection__table",
});

/**
 * The objects this program migrates, and the ONE reachable screen each is judged by.
 *
 * `screen` is the file a person actually lands on. Judging by "some file imports the definition"
 * is what let four objects look migrated — a definition can be imported by a test, a sibling, or
 * nothing at all.
 */
export const UX_MIGRATION_OBJECTS = Object.freeze([
  Object.freeze({
    objectId: "workOrder",
    definition: "src/metadata/definitions/workOrder.js",
    screen: "src/modules/workOrders/WorkOrdersList.jsx",
    route: "/service",
    requiresDollars: false,
  }),
  Object.freeze({
    objectId: "salesOrder",
    definition: "src/metadata/definitions/salesOrder.js",
    screen: "src/modules/sales/SalesOrdersList.jsx",
    // WAS "/sales/sales-orders", which is not a route. The Sales Orders index is a subnav item of
    // the `customers` domain (navConfig.js: domain path "customers", item path "sales-orders"), and
    // Issue #288 removed the `salesCrm` top-level area this string was left over from. A stale route
    // in a manifest whose entire purpose is not being stale, caught by the Lists P2 reconciliation.
    route: "/customers/sales-orders",
    // BLOCKED, not missing: the Sales Order document stores no authoritative total.
    requiresDollars: false,
  }),
  Object.freeze({
    objectId: "equipment",
    definition: "src/metadata/definitions/equipment.js",
    // CustomerEquipment, NOT EquipmentRegister. The manifest pointed at the register, which is
    // the Account-scoped create flow and is deliberately not a business-wide list at all -- so it
    // was measuring the wrong screen and would have reported the object CONTRACT_ONLY forever.
    // The global installed register is the Customer Equipment tab.
    screen: "src/modules/equipment/CustomerEquipment.jsx",
    route: "/equipment",
    requiresDollars: false,
  }),
  Object.freeze({
    objectId: "part",
    definition: "src/metadata/definitions/part.js",
    screen: "src/modules/inventory/PartMasterList.jsx",
    route: "/inventory/part-master",
    requiresDollars: false,
  }),
  Object.freeze({
    objectId: "purchaseOrder",
    definition: "src/metadata/definitions/purchaseOrder.js",
    screen: "src/modules/purchasing/PurchaseOrders.jsx",
    route: "/purchasing",
    // PO LIST / MONEY SOURCE MISMATCH. The reachable list reads `reorder_purchase_orders`, whose
    // definition states it holds no price, amount or total of any kind. `totalCost` is written by
    // procurementService into `purchase_orders` — a DIFFERENT collection this screen never reads.
    // Mounting Dollars here would attach a real number to unrelated rows.
    requiresDollars: false,
  }),
  Object.freeze({
    objectId: "account",
    definition: "src/metadata/definitions/account.js",
    screen: "src/modules/accounts/AccountsList.jsx",
    route: "/customers",
    requiresDollars: false,
  }),
  Object.freeze({
    objectId: "opportunity",
    // DESCRIPTIVE, NOT CONSUMED — and that is worth saying plainly. OpportunityList.jsx does not
    // import this definition: it composes `domain/opportunityLifecycle.js` (the pipeline views and
    // counts) over the governed `listOpportunityContext` read. The definition is named here because
    // it is where the object's list-level contract is recorded — capabilityRequirement
    // "opportunity.read", the stage filter, the `listOpportunityContext` readCallable override — and
    // a reader looking for "what does EOS declare about the Opportunity index" should land on it.
    definition: "src/metadata/definitions/opportunity.js",
    screen: "src/modules/sales/OpportunityList.jsx",
    route: "/customers/opportunities",
    // The first COMPLETE_READ collection, and the reference implementation for the shape: the
    // governed read returns the caller's whole authorized scope in one call with its own `truncated`
    // flag, so there is no cursor to page and nothing to attach a server-side filter builder to.
    // Its search and stage narrowing run over rows already in hand, which is why it mounts neither
    // useListCriteria nor AddFilter — deliberately, and P2 2g endorses it.
    shape: COLLECTION_SHAPE.COMPLETE_READ,
    // No governed currency exists on expectedValue (G5). The page renders bare numbers.
    requiresDollars: false,
  }),
]);

/**
 * Judge one object from its screen's SOURCE.
 *
 * @param readFile (path) => string — supplied by the caller so this module stays pure and testable.
 *
 * A screen that cannot be read at all is `CONTRACT_ONLY` with `screenMissing`, never a pass: an
 * unreadable file is not evidence of anything.
 */
/** The evidence table and required subset for a shape. Unknown/absent shape → CURSOR_PAGED. */
function evidenceFor(shape) {
  if (shape === COLLECTION_SHAPE.COMPLETE_READ) {
    return {
      shape: COLLECTION_SHAPE.COMPLETE_READ,
      evidence: COMPLETE_READ_MOUNT_EVIDENCE,
      required: ["identity", "states", "rowAnchor"],
    };
  }
  return {
    shape: COLLECTION_SHAPE.CURSOR_PAGED,
    evidence: MOUNT_EVIDENCE,
    required: ["controls", "urlState", "addFilter", "sort", "activeCriteria"],
  };
}

export function evaluateMigration(entry, readFile) {
  const { shape, evidence, required } = evidenceFor(entry?.shape);

  const source = (() => {
    try { return readFile(entry.screen) ?? ""; } catch { return ""; }
  })();

  if (source === "") {
    return Object.freeze({
      objectId: entry.objectId,
      shape,
      status: "CONTRACT_ONLY",
      screenMissing: true,
      mounts: Object.freeze({}),
      cards: false,
    });
  }

  const mounts = {};
  for (const [name, token] of Object.entries(evidence)) {
    mounts[name] = source.includes(token);
  }
  const cards = Object.values(CARD_EVIDENCE).some((token) => source.includes(token));

  // MERGED_UI requires the whole REQUIRED set for this shape. A cursor-paged list with a filter
  // builder and no URL state loses the person's work the moment they open a record; a complete-read
  // list with no row anchor is a report rather than a collection. Neither is a migrated list, and
  // the manifest says so rather than rounding up.
  const status = required.every((k) => mounts[k]) ? "MERGED_UI" : "CONTRACT_ONLY";

  return Object.freeze({
    objectId: entry.objectId,
    shape,
    status,
    screenMissing: false,
    mounts: Object.freeze(mounts),
    cards,
  });
}

/** Judge every object. */
export function evaluateAllMigrations(readFile, objects = UX_MIGRATION_OBJECTS) {
  return Object.freeze(objects.map((entry) => evaluateMigration(entry, readFile)));
}

/**
 * Fold environment facts in, which SOURCE CANNOT KNOW.
 *
 * A deployed runtime and an authenticated smoke test are facts about an environment. They are
 * supplied, and they can only ever RAISE a status that source already earned — a list that does not
 * mount the runtime cannot become LIVE_VERIFIED by asserting it was verified.
 */
export function withEnvironmentEvidence(result, { deployed = false, liveVerified = false } = {}) {
  if (result.status !== "MERGED_UI") return result;
  if (liveVerified) return Object.freeze({ ...result, status: "LIVE_VERIFIED" });
  if (deployed) return Object.freeze({ ...result, status: "DEPLOYED_UNVERIFIED" });
  return result;
}
