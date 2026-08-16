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
export const GOVERNED_SURFACE_CAPABILITY_IDS = Object.freeze([
  ...TRANSFER_SURFACE_CAPABILITIES,
  ...CYCLE_COUNT_SURFACE_CAPABILITIES,
  ...CATALOG_SURFACE_CAPABILITIES,
]);
