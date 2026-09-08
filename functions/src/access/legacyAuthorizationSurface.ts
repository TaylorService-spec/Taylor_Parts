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
 *
 * ============================ 47 -> 44 (Workstream 2B, 2026-08-31) ============================
 *
 * A SHRINK, which is the direction this corpus exists to evidence. Retiring the three
 * client-direct reorder authoring paths (DECISIONS #146) removed three legacy call sites:
 *
 *   reorder_requests          10 -> 8   the create rule, and the Record-PO update branch
 *   reorder_purchase_orders    2 -> 1   the create rule
 *
 * Those writes did not lose their authorization -- it MOVED, from a legacy users/{uid}.role
 * helper in Rules to a capability check inside the trusted callables. That is exactly the
 * convergence this gate was built to track, so the number moves in the same change that moved
 * the authority, and nothing was waived to make a lane green.
 *
 * ============================ 44 -> 0 (Rules contraction, 2026-09-08) ============================
 *
 * The same move, for every remaining domain at once. `firestore.rules` went from 1,876 lines and
 * 88 role-dependent clauses across 56 collections to three grants and no business authority. No
 * authorization was lost: each collection's decisions moved to the governed capabilities its
 * entry below used to name as the expected destination.
 */
// ════════════════════ THE SURFACE IS ZERO ════════════════════
//
// 47 -> 44 -> 0. Every legacy-role call site in `firestore.rules` is gone: the file no longer
// resolves ANY authorization decision through `users/{uid}.role`, because it no longer resolves
// business authorization at all. What it grants is a signed-in principal's own session document
// and the PARTS_MANAGER assignment-candidate picker; everything else is denied, and access
// reaches the client through governed callables that resolve a capability server-side.
//
// THIS IS THE OUTCOME THE CORPUS EXISTED TO EVIDENCE. ADR-005 §2.7 criterion 1 required that no
// direct admin/dispatcher/technician authorization checks remain outside the compatibility
// boundary before legacy-role retirement; the drift gate was built so the surface could not
// silently GROW while convergence was in progress. It caught this change too -- the array below
// went empty in the same commit that emptied the Rules, which is exactly the discipline the gate
// was for, applied in the shrinking direction.
//
// WHAT IS NOT CLAIMED. Zero here is a statement about `firestore.rules` and nothing else. The
// legacy field still EXISTS and is still carried to the browser by the session projection for
// nav gating and display. The separate proof that nothing DECIDES anything with it server-side
// is functions/test/legacyRoleIsNotAuthority.test.mjs, which asserts zero authorization
// consumers and pins the single transport site to a stricter contract than an exception.
//
// The array stays rather than being deleted, and so does the gate: a re-introduced legacy call
// site must fail CI, and an empty corpus with a live parser is what makes that true. The rows
// (Issue #226 #265-#268) are answered, not abandoned -- each domain's authority moved to the
// capabilities its entry used to name as its expected destination.
const SURFACE_ENTRIES: LegacySurfaceEntry[] = [
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
