# Truck Lifecycle Readiness — B1 / B2 (Owner-decided 2026-08-13)

Roadmap items split out from round-4 site-work findings `truck-deactivate-permanently-fails-unknown-inventory` and `truck-delete-created-in-error-permanently-fails-unknown-references` (see `docs/orchestration/site-work/round4-candidates.json` and `round4-special-track-proposals.md`).

## Context / decision
Two truck destructive lifecycle operations are wired to governed fail-closed predicates that **cannot resolve under any current production condition** (no inventory-at-location persistence; all 11 operational-reference authorities are `unverifiable()`), yet were shipped enabled in production. The Owner's decision:

- **Option A (done as a production-correctness fix, repo-only):** narrowly gate the two destructive controls behind their **own** readiness flags (`TRUCK_DEACTIVATE_READY`, `TRUCK_DELETE_READY`), **disabled — not hidden** — with an explicit unavailable explanation naming the dependency. `TRUCK_MANAGEMENT_WRITE_READY` is NOT broadened/repurposed. Backend fail-closed predicates are NOT weakened. All other truck-management actions stay enabled. (PR: site-work r4 truck-gate.) NOTE: repo-merged ≠ live — taking effect in production requires a Hosting deploy (Owner-gated).
- **Option B is split into B1 and B2** below (deactivation becomes usable much earlier than deletion, so they must not be one project).

Principle affirmed: **never fake capability, never weaken safety to make a button work, progressively enable controls as authoritative data becomes available.**

## B1 — Truck deactivation readiness
Implement the authoritative **inventory-at-location / custody predicate** so EOS can conclusively prove `ABSENT` for a truck's MOBILE location, and inject it as the real `GovernedInventoryProbe` into `deactivateTruckCallable` (replacing the `UNKNOWN_INVENTORY` default in `functions/src/truckRegistry/truckRegistryCommands.ts`). When it can prove ABSENT/PRESENT, flip `TRUCK_DEACTIVATE_READY=true` (per environment) so the control activates.
- **Dependency / home:** tie to the existing **Equipment Custody / Serialized Asset P0** and mobile-inventory work — that's where the truck-held inventory persistence (serialized-asset-on-truck / stock-at-MOBILE-location) most naturally lands. B1 rides on that persistence rather than being built in isolation.
- **Done when:** a genuinely-empty truck can be deactivated and a truck with inventory is correctly blocked with a real (not UNKNOWN) reason.

## B2 — Created-in-error deletion readiness
Implement/expose authoritative truck-reference checks across the **11 operational authorities** (`functions/src/truckRegistry/operationalReferenceProbe.ts`: serializedAssets, partsStock, transferOrders, transferLines, ledgerEvents, custodyAssignmentHistory, receiving, reconciliation, cycleCount, rma, scrap) so the aggregate can prove `CLEAR`. Activate each authority's real check only as its own governed persistence ships (the file's own design intent via `buildReferenceCrosswalk()`); the aggregator fails closed unless ALL 11 are CLEAR, so `TRUCK_DELETE_READY` stays `false` until the full aggregate can plausibly reach CLEAR for a pristine truck.
- **Larger and later than B1** (11 authorities, several currently unscoped).

### B2 design stance — reconsider physical deletion (Owner)
Before building B2 as "physical delete," evaluate whether **true deletion should exist at all** for a truck that has ever been referenced. Enterprise-correct model: **immutable historical identity + an `ENTERED_IN_ERROR` / retired state**, with physical deletion reserved ONLY for a provably-pristine truck (no inventory, no assignments, no work history, no audit dependencies, no references). The current 11-authority `CLEAR` gate already points toward this philosophy. B2's scoping should decide: (a) `ENTERED_IN_ERROR` retirement as the primary path for referenced trucks, and (b) hard-delete only for the pristine-never-used case.

## Status
- Option A: repo fix in flight (site-work r4 truck-gate); merged ≠ deployed.
- B1: roadmap, tied to Equipment Custody / Serialized Asset P0 + mobile-inventory.
- B2: roadmap, long-horizon; resolve the `ENTERED_IN_ERROR`-vs-physical-delete design question first.
