// Governed surface -> minimum capability set (Owner decision 2026-08-16, closing #1065).
//
// THE RULE: governed capability authority is the FINAL access authority for governed surfaces. A
// principal holding a legitimate governed Role whose capability resolves ALLOW must be able to REACH
// the surface that capability is for. Compatibility roles remain only as a backward-compatibility
// input; they never override a positive governed decision.
//
// The problem this fixes: navigation and route access were gated solely on compatibility roles
// (ROLE_NAV_ACCESS legacyKey). A principal holding only a governed business Role -- e.g.
// inventoryTransferOperator, whose inventory.transfer.* capabilities resolve ALLOW -- saw an empty
// product and was redirected away from Transfers. Authority with nowhere to exercise it.
//
// SCOPE DISCIPLINE, deliberately narrow:
//   * Each entry is the minimum set that makes THAT surface meaningful -- not "any inventory
//     capability". Holding a cycle-count capability does not open Transfers, and vice versa.
//   * This governs ROUTE VISIBILITY ONLY. It says a principal may open the page; it says nothing
//     about which ACTIONS on it are allowed. Action authorization stays where it already lives --
//     per-action capability checks in the components and, authoritatively, in the trusted commands.
//     That separation is what keeps Cycle Count segregation of duties intact: a counter and a
//     reconciler both REACH the same page and are still allowed different actions on it.
//   * Fail-closed: an unknown/loading/errored effective-access state yields no capability, so these
//     entries can only ever ADD access on a positive decision, never on an absent one.

// Any transfer authority makes the Transfers surface meaningful -- a principal who may create,
// dispatch, receive or cancel a transfer needs to see transfers to do it. A principal with no
// transfer authority at all is not admitted by this entry.
export const TRANSFER_SURFACE_CAPABILITIES = Object.freeze([
  "inventory.transfer.create",
  "inventory.transfer.dispatch",
  "inventory.transfer.receive",
  "inventory.transfer.cancel",
]);

// Both halves of the counter/reconciler split reach this surface; which ACTIONS each may take is
// decided per action, not here. Admitting only counters would make reconciliation unreachable, and
// admitting only reconcilers would make counting unreachable -- the split is about authority to act,
// never about who may look at the count.
export const CYCLE_COUNT_SURFACE_CAPABILITIES = Object.freeze([
  "inventory.cycleCount.create",
  "inventory.cycleCount.submit",
  "inventory.cycleCount.reconcile",
  "inventory.cycleCount.cancel",
]);

// The catalog operating surface. Deliberately the WRITE/administration ids: this entry exists so an
// inventoryCatalogAdministrator can reach the surface its authority is for. inventory.catalog.read is
// excluded on purpose -- a read-only manufacturer projection is not a reason to open the catalog
// administration surface, and including it would quietly widen this entry into a general inventory gate.
export const CATALOG_SURFACE_CAPABILITIES = Object.freeze([
  "inventory.catalog.manage",
  "inventory.catalog.activate",
]);

// Every id above, as ONE flat list, so the effective-access feed can resolve them in a single request
// against a single accessVersion (the same consistency property the report request already relies on).
// RECEIVING. The one capability on this list that is ACTIVE and already granted -- every other
// governed surface capability here is registered active:false and denies for everyone today.
//
// It is added so the shell can resolve a DECISION on it, which is what lets the shared Scan
// workspace be visible to a governed Parts/Warehouse persona WITHOUT adding a business role to the
// legacy ROLE_NAV_ACCESS map. That map understands only the three legacy roles and cannot express
// those personas at all (docs/governance/parts-scanner-access-decision.md §3); capabilityAccess on
// the nav item is the mechanism that already exists for exactly this, and it needs the id to be in
// the request set or the decision comes back absent and the item stays hidden.
//
// NO NEW CAPABILITY. inventory.stock.receive is the capability that already governs receiving.
export const RECEIVING_SURFACE_CAPABILITIES = Object.freeze(["inventory.stock.receive"]);

/**
 * PUT-AWAY AND RETURNS — the two stations the sets above did not already name.
 *
 * `inventory.location.bin.read` is here and `inventory.location.bin.manage` deliberately is NOT:
 * stowing stock all day must not confer the authority to create and retire racking. The ids are the
 * ones access/scanWorkflows.js already derives put-away and return intake from; nothing new is
 * minted, and both are registered active:false today.
 */
export const PLACEMENT_SURFACE_CAPABILITIES = Object.freeze([
  "inventory.placement.record",
  "inventory.location.bin.read",
]);

export const RETURNS_SURFACE_CAPABILITIES = Object.freeze(["inventory.returns.intake"]);

/**
 * DATA IMPORT — Administration -> Data Import.
 *
 * ============================ THE DEFECT THIS CLOSES ============================
 *
 * An authenticated sandbox Administrator opening /administration/data-import was told "Your
 * account doesn't have access to this area" — while holding both capabilities, in an
 * environment that activates both.
 *
 * Nothing was wrong with the grant, the activation, or either check. The nav item declares
 * `capabilityAccess: ["admin.dataImport.stage"]`, AdminDataImport checks stage and execute, and
 * both are correct. But `hasCapability` answers from `feed.decisions[id]`, and the feed only
 * decides the ids it is ASKED for. These two were absent from the request set, so the trusted
 * backend was never asked — and an unrequested capability resolves `false` in
 * buildHasCapability(), correctly and permanently, for every principal including one who
 * genuinely holds it.
 *
 * This is the SAME failure DASHBOARD_MODULE_CAPABILITY_IDS above was written to fix, on a new
 * surface. The note there says it outright: an id that is never requested is indistinguishable
 * from a denied one. Asking is what makes a real decision possible.
 *
 * ============================ WHY BOTH IDS, NOT JUST STAGE ============================
 *
 * Route visibility needs only `stage` — and requesting only `stage` would reproduce the bug one
 * layer in. The page would open and the Approve control would read as unavailable to everyone,
 * because the screen asks `hasCapability("admin.dataImport.execute")` and would get `false`
 * from an unasked question rather than from a decision.
 *
 * Both in ONE request also keeps them on ONE accessVersion. Split across two calls, a principal
 * whose access changed between them could be shown a page they may open and an Approve button
 * decided against a version that no longer applies.
 *
 * The split this preserves is real and is the point:
 *   stage=true, execute=false  -> the page opens, preview works, Approve stays protected
 *   stage=true, execute=true   -> the full experience
 *   stage=false                -> the route is not reachable
 *
 * NO NEW CAPABILITY, NO GRANT, NO ACTIVATION. Both ids are already registered (active:false),
 * already held by Administrator through the derived catalogue grant, and already activated in
 * platform-sandbox and nowhere else. Asking for a decision is not receiving a positive one: in
 * production, where nothing is activated, both still resolve false — from the server, on the
 * evidence, rather than from an absent answer.
 */
export const DATA_IMPORT_SURFACE_CAPABILITIES = Object.freeze([
  "admin.dataImport.stage",
  "admin.dataImport.execute",
]);

/**
 * THE WAREHOUSE HANDHELD GATE — the union, and nothing beyond it.
 *
 * The shell offers whichever workflows a person actually holds, so the NAV ITEM should appear for
 * anybody holding any one of them. A union rather than a new "warehouse user" capability, because a
 * single coarse id is exactly the thing this platform's station model exists to avoid: receiving is
 * named accountability, and a person does not get it by working in a warehouse.
 *
 * Visibility is convenience. Every action behind it is still decided per action, on the server.
 */
export const WAREHOUSE_HANDHELD_CAPABILITIES = Object.freeze([
  ...RECEIVING_SURFACE_CAPABILITIES,
  ...TRANSFER_SURFACE_CAPABILITIES,
  ...CYCLE_COUNT_SURFACE_CAPABILITIES,
  ...PLACEMENT_SURFACE_CAPABILITIES,
  ...RETURNS_SURFACE_CAPABILITIES,
  // DATA IMPORT IS DELIBERATELY ABSENT, and this is a surface boundary rather than a list.
  //
  // navConfig.js uses THIS SET as Warehouse Workspace's capabilityAccess, so an id added here
  // becomes a way to reach the handheld. Data Import authority is administration authority: it
  // says somebody may load a spreadsheet, and it must never imply standing at a receiving dock.
  //
  // It was briefly here by accident. The request set below and this gate both end in
  // ...RETURNS_SURFACE_CAPABILITIES, an edit aimed at the second landed in the first, and the
  // tests missed it because they asserted PRESENCE where it belonged and never ABSENCE where it
  // did not. dataImportSurfaceAccess.test.jsx now asserts both, through the real nav predicate.
]);

/**
 * MY DASHBOARD MODULE COMPOSITION — the capabilities `dashboardComposition.js` gates modules on.
 *
 * These are NOT route-visibility ids and are deliberately kept out of the list above. They exist for
 * one reason: `hasCapability` answers from `feed.decisions[id]`, and the feed only decides the ids
 * it is ASKED for. An id that is never requested comes back `undefined` — which is `false` — for
 * every principal, forever, including one who genuinely holds the capability.
 *
 * That is what had happened. My Dashboard gated six modules on six real, registered capabilities
 * that were absent from the request set, so `myOpportunities`, `myBooked`, `ordersRequiringAction`,
 * `firmBilled`, `firmCollected`, `firmBooked` and `governedStockPosition` could not resolve for
 * anyone — and `accountPortfolio` survived only because admin and dispatcher reach it through the
 * legacy operations-viewer path instead. The composition tests passed throughout: they call the
 * predicates with a `hasCapability` of their own, so they never observe the request set.
 *
 * NO NEW CAPABILITY IS MINTED HERE and nothing is granted. Every id below is already registered in
 * the server permission catalog; asking for a decision is not the same as receiving a positive one,
 * and a principal without the capability still gets `false` — from the server, on the evidence,
 * rather than from an absent answer.
 */
export const DASHBOARD_MODULE_CAPABILITY_IDS = Object.freeze([
  "customer.record.read",
  "finance.read",
  "opportunity.read",
  "salesOrder.read",
  "fulfillment.coordinatedVisit.read",
  "inventory.balance.read",
  // FIN-004 REACH. `finance.read` is the fact-FAMILY gate and confers no reach on its own
  // (permissionCatalog.ts, id finance.read): a principal also needs at least one
  // `finance.visibility.*` scope, or `listFinancialFacts` refuses them outright. Gating the money
  // modules on `finance.read` alone composed a Billed/Collected tile for principals the server
  // would always deny, and the screen reported a permanent "could not be read" where the honest
  // answer is that this person has no financial reach at all.
  "finance.visibility.self",
  "finance.visibility.team",
  "finance.visibility.businessUnit",
  "finance.visibility.company",
  "finance.visibility.consolidated",
]);

export const GOVERNED_SURFACE_CAPABILITY_IDS = Object.freeze([
  ...TRANSFER_SURFACE_CAPABILITIES,
  ...CYCLE_COUNT_SURFACE_CAPABILITIES,
  ...CATALOG_SURFACE_CAPABILITIES,
  ...RECEIVING_SURFACE_CAPABILITIES,
  // Requested in the SAME single call as the rest, so the handheld resolves against one
  // accessVersion rather than racing a second request against a different one.
  ...PLACEMENT_SURFACE_CAPABILITIES,
  ...RETURNS_SURFACE_CAPABILITIES,
  // Both Data Import ids, in the SAME single call and against the SAME accessVersion as
  // everything else here -- see DATA_IMPORT_SURFACE_CAPABILITIES for why route visibility alone
  // is not enough.
  ...DATA_IMPORT_SURFACE_CAPABILITIES,
]);
