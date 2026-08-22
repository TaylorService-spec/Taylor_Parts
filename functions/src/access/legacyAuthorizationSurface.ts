// R1-A — Legacy authorization surface corpus (Issue #226 readiness).
//
// The measured, per-collection inventory of every place `firestore.rules`
// still resolves an authorization decision through the LEGACY role field
// (`users/{uid}.role`, read by userData().role) rather than through the
// governed Permission/Role model.
//
// WHY THIS EXISTS. ADR-005 §2.7 criterion 1 requires that "no direct
// admin/dispatcher/technician authorization checks remain outside the
// compatibility boundary" before legacy-role retirement (Row 28 / #270).
// Proving that requires knowing what the surface IS -- per domain, so each
// domain cutover (Rows 23-26 / #265-#268) can state its own blast radius.
// docs/assessments/r1-authorization-convergence-readiness.md is the
// assessment; THIS module is the machine-checkable form of its baseline.
//
// WHAT IT IS NOT. This module is PURE DATA and has NO authority. It is not
// imported by any runtime path, grants nothing, denies nothing, and is never
// consulted when a real request is authorized. It does not introduce a third
// authorization authority (Owner constraint, 2026-08-06) -- the two that
// exist are the deployed Rules and the governed Permission engine; this only
// *describes* the first so the second can replace it provably.
//
// HOW IT IS ENFORCED. functions/test/legacyAuthorizationSurface.test.mjs
// re-parses the real firestore.rules and asserts the counts below still
// match. A new legacy-role call site therefore FAILS CI until it is either
// removed or deliberately recorded here -- the surface cannot silently grow
// while convergence is in progress. That drift gate is the point.
//
// SHARED EOS ACCESS CONTRACT. This module exists in both the Functions and
// frontend packages because there is no shared-module tooling in this repo. It is
// maintained as ONE canonical source and mechanically synchronized by
// scripts/syncAccessContracts.mjs -- never by hand-editing two copies.

/** The Issue #226 implementation-plan row that owns a domain's cutover. */
export type CutoverRow = "row23" | "row24" | "row25" | "row26" | "unassigned";

export interface LegacySurfaceEntry {
  /** Firestore collection whose match block contains the call sites. */
  readonly collection: string;
  /** Legacy helper call sites in that block, by helper name. */
  readonly sites: Readonly<Record<string, number>>;
  /** Which Issue #226 cutover row retires these sites. */
  readonly row: CutoverRow;
  /**
   * Governed permission IDs expected to carry these decisions after cutover.
   * EMPTY means no governed permission has been defined yet for this
   * collection -- an explicit, visible coverage gap, not an oversight.
   */
  readonly permissions: readonly string[];
}

/**
 * Measured at origin/main @ 61150b7 (2026-08-06) by parsing firestore.rules:
 * 47 enforced call sites across 22 collections.
 *
 * NOTE ON THE NUMBER. An earlier assessment reported 66. That figure was a
 * raw `grep -c` over the whole file, which counted the three helper
 * *definitions* and commentary references alongside real call sites. 47 is
 * the count of non-comment, non-definition call sites and is the number the
 * test below enforces. The correction is recorded rather than quietly
 * swapped -- see DECISIONS.
 */
const SURFACE_ENTRIES: LegacySurfaceEntry[] = [
    // ── Row 23 · Customer / Account ──────────────────────────────────────
    {
      collection: "accounts",
      sites: { isAdminOrDispatcher: 3, isAdmin: 2 },
      row: "row23",
      permissions: [
        "customer.record.read",
        "customer.record.create",
        "customer.record.update",
        "customer.governedField.write",
      ],
    },
    {
      collection: "locations",
      sites: { isAdminOrDispatcher: 2 },
      row: "row23",
      permissions: [],
    },
    {
      collection: "contacts",
      sites: { isAdminOrDispatcher: 2 },
      row: "row23",
      permissions: [],
    },

    // ── Row 24 · Inventory / Reorder / Purchasing ────────────────────────
    {
      collection: "reorder_requests",
      sites: { isAdminOrDispatcher: 10 },
      row: "row24",
      permissions: [
        "reorder.request.read.queue",
        "reorder.request.read.own",
        "reorder.request.create.manual",
        "reorder.request.create.system",
        "reorder.request.approve",
        "reorder.request.reject",
        "reorder.request.assign",
        "reorder.request.startPurchasing",
        "reorder.request.postPurchasingUpdate",
        "reorder.request.recordPurchaseOrder",
        "reorder.request.markReceived",
        "reorder.request.cancel",
      ],
    },
    {
      collection: "reorder_purchase_orders",
      sites: { isAdminOrDispatcher: 2 },
      row: "row24",
      permissions: [
        "reorder.purchaseOrder.read",
        "reorder.purchaseOrder.create",
        "reorder.purchaseOrder.void",
      ],
    },
    {
      collection: "reorder_purchase_order_voids",
      sites: { isAdminOrDispatcher: 2 },
      row: "row24",
      permissions: ["reorder.purchaseOrder.void"],
    },
    {
      collection: "inventory_actions",
      sites: { isAdminOrDispatcher: 2 },
      row: "row24",
      permissions: ["inventory.action.read", "inventory.action.create"],
    },
    {
      collection: "inventory_transactions",
      sites: { isAdminOrDispatcher: 1 },
      row: "row24",
      permissions: ["inventory.transaction.read"],
    },
    {
      collection: "parts",
      sites: { isAdminOrDispatcher: 1 },
      row: "row24",
      permissions: [],
    },
    {
      collection: "warehouses",
      sites: { isAdminOrDispatcher: 1 },
      row: "row24",
      permissions: [],
    },
    {
      collection: "stock_locations",
      sites: { isAdminOrDispatcher: 1 },
      row: "row24",
      permissions: [],
    },
    {
      collection: "transfer_orders",
      sites: { isAdminOrDispatcher: 1 },
      row: "row24",
      permissions: [],
    },
    {
      collection: "mobile_locations",
      sites: { isAdminOrDispatcher: 1 },
      row: "row24",
      permissions: [],
    },
    {
      collection: "trucks",
      sites: { isAdminOrDispatcher: 1 },
      row: "row24",
      permissions: [],
    },
    {
      collection: "suppliers",
      sites: { isAdminOrDispatcher: 1 },
      row: "row24",
      permissions: [],
    },
    {
      collection: "supplier_catalog",
      sites: { isAdminOrDispatcher: 1 },
      row: "row24",
      permissions: [],
    },
    {
      collection: "purchase_orders",
      sites: { isAdminOrDispatcher: 1 },
      row: "row24",
      permissions: [],
    },

    // ── Row 25 · Service / Work Orders ───────────────────────────────────
    {
      collection: "fieldops_wos",
      sites: { isAdminOrDispatcher: 1, isTechnician: 1 },
      row: "row25",
      permissions: ["workOrder.create", "workOrder.transition", "workOrder.cancel"],
    },
    {
      collection: "fieldops_jobs",
      sites: { isAdminOrDispatcher: 3 },
      row: "row25",
      permissions: [],
    },
    {
      collection: "fieldops_technicians",
      sites: { isAdminOrDispatcher: 3 },
      row: "row25",
      permissions: [],
    },
    {
      collection: "equipment",
      sites: { isAdminOrDispatcher: 3 },
      row: "row25",
      permissions: [],
    },

    // ── Unassigned · no cutover row currently owns these ─────────────────
    {
      collection: "employees",
      sites: { isAdminOrDispatcher: 1 },
      row: "unassigned",
      permissions: [],
    },
];

export const LEGACY_AUTHORIZATION_SURFACE: readonly LegacySurfaceEntry[] =
  Object.freeze(SURFACE_ENTRIES);

/** Helper names that constitute legacy (users/{uid}.role) authority. */
export const LEGACY_ROLE_HELPERS: readonly string[] = Object.freeze([
  "isAdminOrDispatcher",
  "isAdmin",
  "isTechnician",
]);

/** Total enforced legacy call sites across all collections. */
export function totalLegacySites(
  surface: readonly LegacySurfaceEntry[] = LEGACY_AUTHORIZATION_SURFACE,
): number {
  return surface.reduce(
    (sum, e) => sum + Object.values(e.sites).reduce((a, b) => a + b, 0),
    0,
  );
}

/** Entries owned by one Issue #226 cutover row. */
export function entriesForRow(
  row: CutoverRow,
  surface: readonly LegacySurfaceEntry[] = LEGACY_AUTHORIZATION_SURFACE,
): readonly LegacySurfaceEntry[] {
  return surface.filter((e) => e.row === row);
}

/**
 * Collections whose legacy sites have NO governed permission defined yet.
 * Each is a concrete precondition for its row's cutover: a domain cannot
 * move to the Permission engine while part of its surface has no permission
 * to move to. Reported, never silently tolerated.
 */
export function collectionsWithoutPermissionCoverage(
  surface: readonly LegacySurfaceEntry[] = LEGACY_AUTHORIZATION_SURFACE,
): readonly string[] {
  return surface.filter((e) => e.permissions.length === 0).map((e) => e.collection);
}
