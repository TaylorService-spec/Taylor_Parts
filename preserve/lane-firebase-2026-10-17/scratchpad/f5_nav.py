from ed import edit
edit("src/navigation/navConfig.js", [
("""      // Manufacturer administration workspace (catalog reference object Parts link to; read + fail-closed
      // write). No legacyKey: brand-new screen, explicit App.jsx branch; admin/dispatcher via the default.
      // NOTE: the `manufacturers` collection read is still Rules-closed (the governed read-authority
      // decision is DEFERRED to the Owner -- it interacts with the R-1 legacy-surface convergence gate),
      // so the workspace read fails closed to a denied state until resolved. Wave 6 (2026-08-15): hidden
      // from normal navigation for the SAME reason as Cycle Counts/Back Orders -- unlike Part Master, this
      // is not even a "still legitimate, just redundant" case: because the read is Rules-closed to EVERY
      // persona, no one can use this screen at all today (confirmed by repository audit). Route/component/
      // commands/Rules/tests unchanged; restore once the Manufacturer read-authority decision (see the
      // parts-ux-redesign-blueprint.md §14d architecture writeup) is made and built.""",
"""      // Manufacturer administration workspace (catalog reference object Parts link to). No legacyKey: an explicit
      // App.jsx branch; admin/dispatcher via the legacy default (production, unchanged).
      // EOS SOURCE (Manufacturers R-1 Option A, Owner-approved; Firebase exit F5, 2026-10-17): the door is the
      // existing `inventory.catalog` surface, earned by inventory.catalog.read -- the SAME capability its list
      // read requires (with inventory.manufacturer.read, held by the same nineteen Roles). Before this the row had
      // no surface, so the EOS source refused it to every principal, Administrator included. It stays navHidden:
      // the screen is reached from Catalog, not added to the rail."""),
("""  "inventory/parts": ["inventory.catalog"],
  "inventory/partMaster": ["inventory.catalogAdmin"],""",
"""  "inventory/parts": ["inventory.catalog"],
  // R-1 Option A: the door follows its read's capability (inventory.catalog.read).
  "inventory/manufacturers": ["inventory.catalog"],
  "inventory/partMaster": ["inventory.catalogAdmin"],"""),
("""  "inventory/manufacturers": "The manufacturers read is Rules-closed for every persona; inventory.manufacturer.read is registered but the screen cannot be used by anyone.",
""", ""),
("""  "inventory/manufacturers",
  "inventory/warehouses", // (CUTOVER) warehouse.management""",
"""  "inventory/manufacturers", // (CUTOVER) inventory.catalog -- R-1 Option A, 2026-10-17
  "inventory/warehouses", // (CUTOVER) warehouse.management"""),
("""// crossed over is not new. Recorded for Owner confirmation in the PR #2091 report.
export const NAV_LEGACY_PLACEHOLDER_CEILING = 62;
export const NAV_UNGOVERNED_PLACEHOLDER_CEILING = 39;
export const NAV_CUTOVER_PLACEHOLDER_CEILING = 23;""",
"""// crossed over is not new. Recorded for Owner confirmation in the PR #2091 report.
//
// ════════ 2026-10-17 -- A FOURTH ROW CHANGED KIND; NO ROW WAS ADDED (MANUFACTURERS R-1 OPTION A, FIREBASE EXIT F5) ════════
//
// `inventory/manufacturers` had no surface (the read was Firebase-only). Its list now reads eos_ops.manufacturers under
// inventory.catalog.read, so the destination earns the existing `inventory.catalog` surface. The SAME row becomes a CUTOVER
// row; the register stays 62 (production's legacy destination set is unchanged); ungoverned 39 -> 38; cutover 23 -> 24.
// Owner-approved as Manufacturers R-1 Option A (lane-b manufacturers-r1-read-authority-2026-10-16).
export const NAV_LEGACY_PLACEHOLDER_CEILING = 62;
export const NAV_UNGOVERNED_PLACEHOLDER_CEILING = 38;
export const NAV_CUTOVER_PLACEHOLDER_CEILING = 24;"""),
])
