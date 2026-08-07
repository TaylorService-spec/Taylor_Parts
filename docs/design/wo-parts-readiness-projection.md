# WO Parts Planning — Phase 1: Unified Parts Readiness Projection

Status: **Implemented (repo-only, read-model only).** Owner-ratified Phase 1. No new write seam, no Rules
widening, no capability grant, no deployment, no physical-inventory model, no Equipment-Compatibility
activation, no REQUIRED implementation, no AI dependency. This is the projection that answers
**"Is this job ready to execute?"** by composing existing canonical authorities.

Deliverables map (Owner §M): (1) canonical-source map, (2) projection contract, (3) readiness vocabulary,
(4) UNKNOWN/unavailable behavior, (5) duplicate-authority review, (7) responsive behavior, (8) modular
degradation, (9) sandbox implications. Rendered Gate-3 proposal (6) and derive-not-invent tests (10) ship
alongside (the Artifact and `test/workOrderPartsReadiness.test.mjs`).

---

## 1. Canonical-source map actually used

The projection **reads nothing itself** — it is a pure transform over data the caller resolves from these
canonical authorities. One owner per fact; nothing re-modelled.

| State | Canonical authority (unchanged) | How it reaches the projection |
|---|---|---|
| PLANNED | `WorkOrder.inventorySnapshot[].qtyPlanned` | `plannedParts[].qtyPlanned` |
| USED | `WorkOrder.inventorySnapshot[].qtyUsed` (execution capture) | `plannedParts[].qtyUsed` |
| RESERVED | `inventory_transactions` RESERVED by `workOrderId` (`inventoryService`) | `plannedParts[].reservedForJob` |
| WAREHOUSE_AVAILABLE | `stock_locations` − reserved (`operationsQueries`) — **interim baseline** | `plannedParts[].warehouse{status,available,interim}` |
| ON_TRUCK | MOBILE-location stock — **not persisted yet** | `plannedParts[].truck{status,onTruck}` (UNAVAILABLE today) |
| PROCUREMENT | linked `reorder_requests` state | `plannedParts[].procurement{status,reference}` |
| REQUIRED | equipment/job context — **deferred** | always `NOT_DERIVED` (not accepted as input) |
| RETURNED | operational-movement RETURNED — **deferred** | always `NOT_DERIVED` |

The **join** (WO → its planned parts → each part's reservation/warehouse/procurement) is the caller's job
(a future hook composing the existing reads). Phase 1 delivers the pure derivation + its contract; the
hook wiring lands when a surface consumes it (Phases 4–5).

## 2. Projection contract

`buildWorkOrderPartsReadiness({ workOrder, plannedParts, capabilities }) → view`

- **Input** `plannedParts[]` (only `qtyPlanned > 0` rows count): `{ partId, name?, qtyPlanned, qtyUsed?,
  reservedForJob?, warehouse{status,available?,interim?}, truck{status,onTruck?}, procurement{status,reference?} }`.
  Each dimension `status ∈ KNOWN | UNKNOWN | UNAVAILABLE`.
- **Input** `capabilities`: `{ warehouse=true, truckInventory=false, purchasing=true }` — tenant module
  enablement (for honest degradation).
- **Output** `view`: `{ workOrderId, plannedCount, jobReadiness, counts{READY,ATTENTION,UNKNOWN}, rows[], degraded[] }`.
  Each `row`: `{ partId, name, qtyPlanned, qtyUsed, readiness, reason, knownShortfall, dimensions }`.
- **Keying:** on the branded **`partId`** (falls back to the snapshot SKU only if no partId), never the
  non-authoritative `partsCatalog` SKU.

**Derivation rule (per part), KNOWN sources only:**
`knownAvailableToJob = reservedForJob + (warehouse KNOWN ? available : 0) + (truck KNOWN ? onTruck : 0)`;
`knownShortfall = max(0, qtyPlanned − knownAvailableToJob)`.
1. `knownShortfall == 0` → **READY** (reason RESERVED / ON_TRUCK / WAREHOUSE_AVAILABLE).
2. else active procurement (PENDING/ORDERED) → **ATTENTION** (PROCUREMENT_PENDING).
3. else a needed source is not KNOWN (today: truck) → **UNKNOWN** (TRUCK_UNAVAILABLE / WAREHOUSE_UNAVAILABLE).
4. else confirmed short → **ATTENTION** (SHORT, or SHORT_PROCUREMENT_UNAVAILABLE if purchasing off).

Job rollup = worst-actionable-first (ATTENTION > UNKNOWN > UNAVAILABLE > READY); empty plan → **NO_PLAN**
(distinct from READY).

## 3. Readiness / state vocabulary (shared platform language)

Defined once in `domain/readinessLanguage.js` and intended for reuse across Scheduling, Control Tower, Work
Orders, Technician Current Job, Inventory, and Purchasing — so readiness means the same thing everywhere.

- **READY** (tone `positive`) — demonstrably available from a known authority.
- **ATTENTION** (tone `attention`) — a known, actionable gap (short / procurement pending / awaiting decision).
- **UNKNOWN** (tone `unknown`) — genuinely cannot be determined because a required source is unavailable.
- **UNAVAILABLE** (tone `muted`) — the capability that would answer isn't enabled (honest modular degradation).

`tone` is a semantic token, **not** a color — Gate-3 owns the palette. This is a vocabulary + a pure
`rollUpReadiness` helper, **not** a persisted readiness model.

## 4. Explicit UNKNOWN / unavailable behavior (the honesty contract)

- A part not covered by a KNOWN source, with truck stock unavailable, is **UNKNOWN — "Truck quantity
  unavailable"**, never a fabricated "short" or a silent zero.
- A missing/garbage dimension normalizes to **UNKNOWN**, never to zero-available (which would falsely read
  as short or covered).
- REQUIRED and RETURNED are **NOT_DERIVED** in v1 and are surfaced as such where useful — never invented.
- WAREHOUSE_AVAILABLE is flagged **interim** (static baseline; physical on-hand deferred) so the experience
  can mark it as a provisional figure.
- The product visibly distinguishes **AVAILABLE / NOT AVAILABLE / UNKNOWN** (Owner §A.5): READY vs a
  confirmed ATTENTION-short vs UNKNOWN.

## 5. Duplicate-authority review

The projection introduces **no** new authority and re-models **nothing**:
- No parallel reservation store — RESERVED comes from `inventory_transactions` as-is.
- No mutable balance cache — availability is passed in as a derived figure; the projection stores nothing.
- No second ledger, no parallel Part/SKU table (keys on `partId`), no parallel truck-stock model, no parallel
  procurement path (procurement status reflects `reorder_requests`), no re-modelled equipment compatibility.
- The only *new* code is a pure derivation + a shared vocabulary. The single future write (the PLANNED
  producer) is deliberately **not** built here — Phase 1 exists to prove where it belongs before it is built.

## 6. Rendered Gate-3 proposal

Delivered as a separate rendered artifact (readiness-first, not an ERP grid) for the Work Order / planning
view, the Weekly Scheduling readiness chip, and the Technician Current Job — in Verenward-anchored identity
+ warm-ground composition. The exact primitives are to be finalized in the Gate-3 design system; the
artifact proposes the *composition and operating rhythm* (business context → current state → attention →
readiness → next best action), not a literal final skin.

## 7. Responsive behavior (phone / tablet / laptop)

One projection, three presentations (Owner §G — never a separate mobile authority):
- **Laptop/desktop (dispatch):** the job readiness panel sits inside the Work Order alongside technician /
  schedule / execution context; readiness sections (Ready / Attention / Unknown) with counts; a supporting
  high-density table is available but does not define the screen.
- **Tablet:** same composition, single-column readiness sections, comfortable touch targets.
- **Phone (field):** a compact **Current Job → parts readiness** stack: the job-level pill first, then the
  parts grouped by readiness with the one relevant action each; no seven-column grid, no desktop admin
  screen compressed down.

## 8. Modular-degradation behavior (honest when a capability is absent)

`capabilities` drives honest degradation (Owner §L):
- **Purchasing off:** a short part reads **"Procurement capability unavailable"** (reason
  SHORT_PROCUREMENT_UNAVAILABLE) — never a broken "create reorder" button or a fabricated procurement state.
- **Truck inventory off (today):** ON_TRUCK is **UNAVAILABLE**; readiness that depends on it is **UNKNOWN**,
  labelled honestly ("Truck quantity unavailable").
- **Warehouse read absent:** availability is **UNKNOWN**, not zero.
- `view.degraded[]` lists disabled capabilities so a surface can show one honest banner rather than many
  broken affordances. A customer adopting Service-only, Service+Inventory, Inventory+Purchasing, etc. gets a
  coherent, non-broken experience.

## 9. Sandbox scenario implications

The projection consumes only existing collections, so the interconnected service-week seed (designed in the
assessment) exercises it directly: a Tuesday WO plans 3 parts → one warehouse-covered (READY) → one with a
linked reorder (ATTENTION, procurement pending) → one truck-only (UNKNOWN today). The same seed drives the
Scheduling readiness chip and the Technician Current Job. Building the seed is repo work; **deploying it to
the live sandbox remains a separate protected step.** No new collections are needed to demonstrate the full
readiness experience — only representative `inventorySnapshot`, `inventory_transactions` (RESERVED),
`stock_locations`, and `reorder_requests` rows.

## 10. Tests (derive, not invent)

`test/workOrderPartsReadiness.test.mjs` (12) asserts READY/ATTENTION/UNKNOWN derivation, the negative
(a missing warehouse datum is UNKNOWN, not fabricated-available), honest degradation (purchasing off), the
future truck-known paths, NOT_DERIVED for REQUIRED/RETURNED, worst-first rollup, and NO_PLAN vs READY.
