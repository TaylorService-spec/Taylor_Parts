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

/** What a migrated list must mount, and the token in source that proves each one. */
export const MOUNT_EVIDENCE = Object.freeze({
  controls: "MetadataListControls",
  urlState: "useListCriteria",
  addFilter: "AddFilter",
  sort: "SortControl",
  activeCriteria: "ActiveCriteria",
  droppedCriteria: "DroppedCriteriaNotice",
  emptyState: "ListEmptyState",
});

/** Phone-card presentation. The shared grid carries it; a plain table does not. */
export const CARD_EVIDENCE = Object.freeze({
  sharedGrid: "MetadataListGrid",
  stackModifier: "fo-table--stack",
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
    route: "/sales/sales-orders",
    // BLOCKED, not missing: the Sales Order document stores no authoritative total.
    requiresDollars: false,
  }),
  Object.freeze({
    objectId: "equipment",
    definition: "src/metadata/definitions/equipment.js",
    screen: "src/modules/equipment/EquipmentRegister.jsx",
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
]);

/**
 * Judge one object from its screen's SOURCE.
 *
 * @param readFile (path) => string — supplied by the caller so this module stays pure and testable.
 *
 * A screen that cannot be read at all is `CONTRACT_ONLY` with `screenMissing`, never a pass: an
 * unreadable file is not evidence of anything.
 */
export function evaluateMigration(entry, readFile) {
  const source = (() => {
    try { return readFile(entry.screen) ?? ""; } catch { return ""; }
  })();

  if (source === "") {
    return Object.freeze({
      objectId: entry.objectId,
      status: "CONTRACT_ONLY",
      screenMissing: true,
      mounts: Object.freeze({}),
      cards: false,
    });
  }

  const mounts = {};
  for (const [name, token] of Object.entries(MOUNT_EVIDENCE)) {
    mounts[name] = source.includes(token);
  }
  const cards = source.includes(CARD_EVIDENCE.sharedGrid) || source.includes(CARD_EVIDENCE.stackModifier);

  // MERGED_UI requires the whole set. A list with a filter builder and no URL state loses the
  // person's work the moment they open a record, which is not a migrated list — it is a partly
  // migrated one, and the manifest says so rather than rounding up.
  const required = ["controls", "urlState", "addFilter", "sort", "activeCriteria"];
  const status = required.every((k) => mounts[k]) ? "MERGED_UI" : "CONTRACT_ONLY";

  return Object.freeze({
    objectId: entry.objectId,
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
