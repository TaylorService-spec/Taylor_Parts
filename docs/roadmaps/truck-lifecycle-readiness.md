# Truck Lifecycle Readiness — Activation Criteria (Owner-decided 2026-08-13)

Split out from round-4 site-work findings `truck-deactivate-permanently-fails-unknown-inventory` and `truck-delete-created-in-error-permanently-fails-unknown-references` (see `docs/orchestration/site-work/round4-candidates.json`, `round4-special-track-proposals.md`).

> **Framing correction (Owner):** This is NOT a greenfield "build the truck delete/deactivate framework" project. **That framework already exists** in the Truck Registry and is paid for. What remains is authoritative *persistence-source availability* plus wiring the already-built probes — tracked as **completion criteria on the existing inventory / mobile-location / serialized-asset custody persistence evolution**, not a new truck workstream. Checking the repo is exactly what surfaced this: otherwise we'd have scheduled rebuilding architecture we already own.

## What already exists (do NOT rebuild)
The Truck Registry (`functions/src/truckRegistry/`) already ships, built and tested:
- The **deactivate** command architecture is already built to accept a **real governed inventory-at-location probe** (`GovernedInventoryProbe` injection seam, `truckRegistryCommands.ts`). Deactivation is intentionally fail-closed only because the production default is still `UNKNOWN_INVENTORY`; the code explicitly states the governed serialized-asset/ledger-at-location source does not yet exist.
- The **entire 11-authority delete framework already exists**: a production `operationalReferenceProbe.ts` with the canonical 11-authority registry, aggregation logic (`aggregateReferenceStates`, fail-closed unless all CLEAR), a bounded transactional query helper, completeness protection, `buildReferenceCrosswalk()` per-authority tracking, crosswalk documentation, and dedicated tests. All 11 production authorities intentionally return `UNKNOWN` today.
- Fail-closed predicates throughout — correct and must NOT be weakened.

## What is actually missing (the ONLY remaining gap)
Not code in the truck registry — the **underlying truck/location-indexed DATA those probes need to query.** The source itself reconciles the schema and documents the gaps:
- `stock_locations` is **warehouse-keyed** (no MOBILE/truck-location index).
- Transfers are **warehouse→warehouse** (no truck-indexed transfer lines).
- `inventory_transactions` is **location-blind**.
- No persisted truck-indexed custody / reconciliation / receiving / cycle-count / RMA / scrap records.

Because that data isn't authoritative, all 11 authorities (and the inventory probe) intentionally return `UNKNOWN`. The machinery is ready and *waiting for authoritative data* — it is not waiting to be built.

## Option A — production-correctness gate (approved, in flight)
Narrowly gate the two destructive controls behind **their own** readiness flags (`TRUCK_DEACTIVATE_READY`, `TRUCK_DELETE_READY`), **disabled — not hidden** — with an explicit unavailable explanation naming the dependency. Do NOT broaden `TRUCK_MANAGEMENT_WRITE_READY`; do NOT weaken backend predicates; leave all other truck actions enabled. (PR: site-work r4 truck-gate.) Repo-merged ≠ live — production effect needs a Hosting deploy (Owner-gated).

## Remaining work = activation criteria on EXISTING persistence work (not new truck projects)

### B1 — Deactivation activation criterion
**Attach to the existing truck-as-location / mobile-inventory / serialized-asset custody persistence work** (Equipment Custody / Serialized Asset P0). When that work makes **inventory-at-a-truck's-MOBILE-location authoritative**, its completion criteria include: inject the real `GovernedInventoryProbe` into `deactivateTruckCallable` (replacing the `UNKNOWN_INVENTORY` default — a *wiring* step against the existing seam, not new truck code) and flip `TRUCK_DEACTIVATE_READY` per environment. Deactivation then becomes real — likely much earlier than deletion.

### B2 — Created-in-error deletion activation criteria
**Attach to each operational-reference source's existing persistence evolution.** As each of the 11 authorities' underlying data becomes authoritative (many arrive as side effects of the same custody/serialized-asset/ledger-at-location and receiving/reconciliation/cycle-count/RMA/scrap work), wire its **already-built** probe (replace that authority's `unverifiable()` with its real check per `buildReferenceCrosswalk()`). The aggregator stays fail-closed until all 11 are CLEAR-capable, so `TRUCK_DELETE_READY` flips only when a pristine truck can be proven CLEAR. No new framework — incremental wiring of existing seams as sources land.

#### B2 design stance — physical delete vs ENTERED_IN_ERROR (Owner)
Before treating B2's endpoint as physical deletion, adopt the enterprise-correct model: **immutable historical identity + an `ENTERED_IN_ERROR` / retired state** for any truck that has ever been referenced; reserve true physical deletion for the provably-pristine, never-used case (which is exactly what the 11-authority CLEAR gate already proves). The existing machinery already points at this philosophy.

## Status
- Option A: repo fix in flight (site-work r4 truck-gate); merged ≠ deployed.
- B1: NOT a standalone item — completion criterion on Equipment Custody / Serialized Asset P0 + mobile-inventory persistence (wire existing probe + flip flag when inventory-at-location is authoritative).
- B2: NOT a standalone item — completion criteria distributed across the 11 authorities' existing persistence evolution (wire each existing probe as its source lands); resolve `ENTERED_IN_ERROR`-vs-physical-delete as the endpoint stance.

_(Supersedes any "build the … source/framework" phrasing in `round4-special-track-proposals.md` Items 1–2: the framework exists; the work is persistence-source authority + probe wiring.)_
