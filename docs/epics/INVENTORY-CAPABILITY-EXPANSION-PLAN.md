# Inventory Capability Expansion Plan
### Release 2.0 — Capability Expansion Phase

**Status:** Planning only. No code, branches (beyond this documentation branch), Firestore, schema, or governance changes have been made as part of producing this document. This is the planning artifact requested before Sprint 2.1.1 implementation begins — implementation work starts only once this plan is reviewed.

Not numbered as an "Epic" (`docs/epics/EPIC-6-Technician-Execution-Workspace.md`'s numbering sequence, Epic 1–8, describes already-merged work under the pre-capability-model naming convention). This document instead traces directly to [`PlatformCapabilityModel.md`](../PlatformCapabilityModel.md)'s capability-maturity framing, per that document's own Release Planning guidance.

---

## 1. Capability Scope

Per [`PlatformCapabilityModel.md`](../PlatformCapabilityModel.md)'s Inventory Management entry, this capability is **not greenfield** — it currently sits at **Maturity Level 3 (Optimization)**: a real append-only ledger (`inventory_transactions`), forecasting/reorder-point analytics, and reporting surfaced through the Operations dashboard. Its stated **Target Maturity is Level 4 (Automation)** — automated reorder triggering feeding Procurement.

This plan's scope is **not** "build Inventory from scratch." It is:

- Close the gap between what already exists at the backend/reporting layer and what's actually usable as a first-class **Inventory domain workspace** ([`ProductBlueprint.md`](../ProductBlueprint.md)'s "Inventory" nav domain — stock, parts, consumption — currently has no dedicated UI of its own; Inventory data is only visible today through the read-only Operations dashboard).
- Establish that workspace as **the primary Inventory-domain experience** going forward — the place a user goes to work with Parts/stock — while continuing to reuse the existing analytics services exactly as built, and without ever creating a second, competing Parts data source.
- Advance toward Level 4 (automated reorder triggering) without yet claiming it, since automation depends on Procurement's own maturity (currently Level 2, no dedicated Purchasing UI either).
- Explicitly **not** build the Vehicle/Truck Stock entity or a general AI layer in this pass — both are named future-expansion points this plan must leave clean entry points for, not build.

**Out of scope for this plan (and for the MVP it recommends):** Warehouse-role UI, Vehicle/Truck Stock, automated PO draft-to-send, any new AI/scoring module. These are named in Sections 6–7 as dependencies/future work, not built here.

## 2. Business Entities Involved

Per [`BusinessEntityModel.md`](../BusinessEntityModel.md):

| Entity | Status | Role in this capability |
|---|---|---|
| **Part** | Core (V2), already real | The capability's central object — inventory item consumed/installed during service. Remains the **single authoritative Parts domain**: `data/partsCatalog` stays the sole metadata authority, `inventory_transactions` stays the sole stock-movement authority. This plan introduces no second Parts store, cache, or projection. |
| **Warehouse** | Core (V2), already real | Physical stock location Parts are held at; owned by the separate Warehouse Management capability, consumed read-only here. |
| **Supplier** / **Purchase Order** | Core (V2), already real | Downstream consumers of Inventory's reorder signals; owned by Procurement, not this capability. |
| **Vehicle** | **Future** entity, not built | Named explicitly in `BusinessEntityModel.md` as "same relationship shape as Warehouse (many-to-many with Parts)" — the entity Truck Stock functionality depends on. Not in scope; this plan must not build a substitute (the existing demo/in-memory "truck" concept in `Inventory.jsx` is explicitly called out as unrelated and out of scope). |
| **Work Order** | Core (V2), already real | Source of Part consumption events (`inventory_transactions`'s CONSUMED entries originate from Work Order execution capture). |

**No new entity is introduced by this plan. No schema change is proposed.**

## 3. Operational Workflows

Per `PlatformCapabilityModel.md`'s Key Workflows for Inventory Management, plus the gap this plan targets:

**Already real (backend-only or Operations-dashboard-only today):**
- View inventory health / forecast reorder needs (via Operations dashboard panels, admin/dispatcher-only).
- View consumption via execution capture (technician-driven, feeds the ledger).

**Net-new workflows this plan's MVP should deliver (the actual "expansion"):**
- Browse the Parts catalog as a first-class Inventory-domain screen — becoming the primary place to work with Parts, not a duplicate of the Operations dashboard's reporting view.
- View a single Part's detail: current computed stock position (derived from the ledger, never a mutable field), recent transaction history, reorder-point status.
- View low-stock / at-reorder-point Parts as an actionable list (not just a dashboard panel) — the concrete first step toward Level 4's "automated reorder triggering."

## 4. Firestore Collections and Relationships (High-Level Only)

No new collections. This plan **reuses exactly what already exists**, per `SYSTEM_AUTHORITIES.md`:

- `inventory_transactions` — append-only ledger (RESERVED/RELEASED/CONSUMED), the sole source of truth for stock movement. This capability's UI **reads** from it; it never gains a second writer.
- `data/partsCatalog` — Part metadata (no stock authority). Remains the one and only Parts metadata source this workspace reads from.
- `warehouses` / `stock_locations` — read-only from this capability's perspective; owned by Warehouse Management.
- `suppliers` / `purchase_orders` — read-only from this capability's perspective; owned by Procurement.

Relationship shape (descriptive, not schema): Part ←many:many→ Warehouse (existing); Part ←many:many→ Work Order via consumption (existing, ledger-derived); Part ←many:many→ Supplier via catalog (existing). No relationship to a Vehicle entity exists yet — that many:many is named in `BusinessEntityModel.md` as future, and this plan does not create it.

## 5. Major Implementation Phases

Each phase below includes **Exit Criteria** — the concrete, checkable condition that must be true before the next phase begins.

### Phase 1 — Inventory Domain Workspace (read-only)

A real `Inventory` nav-domain screen (Parts list, Part detail, stock-position and reorder-status views), reading the existing ledger/analytics services (`inventoryAnalyticsService.ts`/`domain/inventoryAnalyticsEngine.ts`) exactly as the Operations dashboard already does — no new backend logic, purely a new consumer of existing read paths. This is the phase that makes the workspace **the primary Inventory-domain experience**, superseding the Operations dashboard as *where a user goes* to look at Parts (Operations retains its own cross-domain reporting role per `CLAUDE_CONTEXT.md` Rule 8 — it is not being replaced, Inventory is simply no longer only visible through it).

**Exit Criteria (Phase 1 → Phase 2):**
- Parts list and Part detail screens are live under the Inventory nav domain, admin/dispatcher-accessible per existing role rules.
- Every value rendered traces to an existing read path (`inventoryAnalyticsService.ts`/`domain/inventoryAnalyticsEngine.ts`/`data/partsCatalog`) — zero new Firestore queries, zero new computed-math outside those services.
- No write path added or modified; `firestore.rules` unchanged.
- Zero console errors for admin/dispatcher; technician access behaves per existing role gating (no new exposure).

### Phase 2 — Actionable Low-Stock View

Surface the existing reorder-point analytics as a dedicated, filterable "needs reorder" list inside the new workspace — the concrete UI precursor to Level 4 automation, without yet building automation itself. This is a **capability enhancement within the existing Level 3 maturity** (see Section 8) — it makes Level 3's forecasting output actionable, it does not itself constitute Level 4.

**Exit Criteria (Phase 2 → Phase 3):**
- The low-stock/reorder-point list is live, filterable, and driven entirely by existing `inventoryAnalyticsEngine.ts` output — no new forecasting logic introduced.
- A user (admin/dispatcher) can identify, from within the Inventory workspace alone, which Parts need reordering today — without cross-referencing the Operations dashboard.
- Confirmed no duplication: the Operations dashboard's existing inventory panel and the new list render from the same underlying service, not two independently-maintained computations.

### Phase 3 — Inventory↔Procurement Hand-off Touchpoint

A read-only link from a low-stock Part to its existing draft-proposal data (`procurementBridge.ts`'s draft generation, already real) — connecting the two capabilities' existing outputs, not building new cross-capability write logic.

**Exit Criteria (Phase 3 complete):**
- A low-stock Part in the new workspace links to its existing draft-proposal data with zero new write paths between Inventory and Procurement.
- Confirmed the link is read-only in both directions — Inventory does not gain the ability to create or modify a Purchase Order, and Procurement's draft-generation logic (`procurementBridge.ts`) is unmodified.
- Capability-maturity note recorded (not a governance-doc edit): this phase advances Inventory *toward* Level 4 but does not itself claim it — true Level 4 requires Procurement's own workflow maturity to advance in parallel (see Section 6).

Explicitly **not** phased in here: automated reorder triggering itself (Level 4, depends on Procurement's own UI maturity advancing first — see Section 6), Warehouse-role UI, Vehicle/Truck Stock.

## 6. Dependencies on Other Capabilities

- **Warehouse Management** (Level 2) — this capability reads `warehouses`/`stock_locations` read-only; it does not depend on Warehouse Management advancing, but a future stock-by-location view here would.
- **Procurement** (Level 2, no dedicated UI yet) — Phase 3's hand-off is read-only against Procurement's existing draft-proposal output. Full Level 4 "automated reorder triggering feeding Procurement" (the stated target maturity) is **gated on Procurement having somewhere for that trigger to land** — i.e., Procurement's own UI/workflow maturity is a prerequisite for Inventory's own Level 4, not something this plan can complete unilaterally.
- **Technician Operations** — the ledger's CONSUMED entries originate from execution capture (Epic 6); this capability is a pure downstream reader of that, no coupling changes.
- **Reporting & Analytics** — must not be duplicated: any new Inventory-domain view composes the existing `inventoryAnalyticsEngine.ts` output (per `PlatformCapabilityModel.md`'s Rule 12 compositional-layer constraint), never reimplements forecasting math.

## 7. Risks and Architectural Considerations

- **No new write path, ever.** The single greatest risk is a well-intentioned "quick fix" UI adding a direct write to `inventory_transactions` or a mutable "current stock" field. `PROJECT_ARCHITECTURE.md`/`ADR-003` are unambiguous: the ledger is append-only, backend-only, Cloud-Function-written. Every phase above is read-only by design specifically to avoid this risk.
- **Single authoritative Parts domain, protected.** Introducing a dedicated Inventory workspace creates a temptation to cache, denormalize, or re-shape Part data for UI convenience. This plan requires every screen to read `data/partsCatalog` and the ledger directly (via the existing services) — no parallel Parts projection, no second "Parts for UI" store.
- **Don't let the Vehicle/Truck Stock gap get "solved" informally.** The existing in-memory "truck" concept in `Inventory.jsx` is explicitly disclaimed in `BusinessEntityModel.md` as unrelated; a future Truck Stock implementation must build the real Vehicle entity, not extend that demo code.
- **Capability enhancement vs. maturity-level claim discipline.** Per `PlatformCapabilityModel.md`'s Maturity Model, Phases 1–3 are **capability enhancements that operate within and build toward Level 4** — none of them, alone or together, should be recorded as a Level 3 → Level 4 transition in a future capability-model update. That transition requires genuine end-to-end automated reorder triggering, which explicitly depends on Procurement (Section 6).
- **Cross-capability coupling discipline.** The Procurement hand-off (Phase 3) must stay a read-only link, not a shared component or shared write path — per `PlatformOperatingModel.md`'s configuration-over-customization and single-write-path principles.

## 8. Recommended Sprint Breakdown

Following `PlatformCapabilityModel.md`'s Release Planning guidance (a release/sprint should be expressible as a capability-maturity statement, not just a features list). Each sprint's **Success Criteria** are measurable and checkable at sprint close; **Primary Personas Affected** names who the sprint's work is actually for.

### Sprint 2.1.1 — Inventory Domain Foundation

- **Capability statement:** Inventory Management remains Level 3, with its existing Optimization-level output now delivered through a dedicated domain workspace instead of only the Operations dashboard.
- **Scope:** Phase 1 — real Inventory nav-domain workspace, Parts list + detail, reading existing analytics services only.
- **Primary Personas Affected:** Admin (full workspace access), Dispatcher (full workspace access, read-scoped per existing role rules); Technician unaffected (no new technician-facing surface).
- **Success Criteria:**
  - Parts list and Part detail are reachable from the Inventory nav domain in production.
  - Every displayed value is traceable to an existing service (`inventoryAnalyticsService.ts`/`domain/inventoryAnalyticsEngine.ts`/`data/partsCatalog`) with zero new computation.
  - Zero new Firestore write paths; `firestore.rules` diff for this sprint is empty.
  - Live-verified: admin and dispatcher can each open the workspace, view the Parts list, and open a Part's detail with zero console errors; technician nav/access is unchanged from pre-sprint state.

### Sprint 2.1.2 — Inventory Actionability

- **Capability statement:** Inventory Management capability enhancement within Level 3 — Level 3's existing forecasting output becomes directly actionable inside the domain workspace, building toward (not yet claiming) Level 4.
- **Scope:** Phase 2 — actionable low-stock/reorder-point view.
- **Primary Personas Affected:** Admin, Dispatcher (same access pattern as Sprint 2.1.1 — this sprint adds a workflow, not a new persona).
- **Success Criteria:**
  - A filterable low-stock/reorder-point list is live inside the Inventory workspace.
  - The list and the Operations dashboard's existing inventory panel are confirmed to render from the same underlying analytics output (no parallel computation).
  - An admin/dispatcher can identify all Parts needing reorder without leaving the Inventory workspace.
  - No new Firestore read pattern beyond what `inventoryAnalyticsEngine.ts` already exposes.

### Sprint 2.1.3 — Inventory↔Procurement Hand-off

- **Capability statement:** Cross-capability touchpoint established; no maturity-level change recorded for either Inventory Management or Procurement individually.
- **Scope:** Phase 3 — read-only link to existing draft-proposal data.
- **Primary Personas Affected:** Admin, Dispatcher (both capabilities' primary users are the same two roles today — no new persona introduced).
- **Success Criteria:**
  - A low-stock Part in the workspace links to its existing `procurementBridge.ts` draft-proposal data.
  - Confirmed read-only in both directions: no write from Inventory into Procurement's data, no modification to `procurementBridge.ts`'s draft-generation logic.
  - Sprint close note explicitly records that this does not constitute a Level 4 claim for Inventory Management (see Section 7).

**Not yet scheduled, named for forward visibility only:** a future sprint for Warehouse-role UI (advances Warehouse Management, not Inventory), and a future sprint for the Vehicle/Truck Stock entity (requires a `BusinessEntityModel.md` entity being promoted from Future to Core first — a Product Review decision per `PlatformOperatingModel.md`, not an engineering one).

## 9. Confirmation: No Implementation, Schema, or Governance Changes

This document is the complete deliverable for this planning pass. Explicitly confirmed:

- **No implementation code** has been written — no component, service, or function file created or modified.
- **No Firestore changes** — no collection, document, or `firestore.rules` change made or proposed as executable.
- **No schema changes** — every collection and field referenced above already exists; none is added, renamed, or restructured.
- **No governance document modified** — `PlatformCapabilityModel.md`, `BusinessEntityModel.md`, `ProductBlueprint.md`, `PROJECT_ARCHITECTURE.md`, and all other governance artifacts remain exactly as merged; this plan only cites them.
- **No new entity introduced** — Part, Warehouse, Supplier, Purchase Order, Work Order are all pre-existing Core (V2) entities; Vehicle remains Future and unbuilt.
- **No new write path** — every phase and sprint above is read-only against existing services and collections.

---

**Traceability summary:** every phase and sprint above maps to Inventory Management's existing entry in `PlatformCapabilityModel.md` (Level 3, Target Level 4), reuses only entities and collections already declared Core in `BusinessEntityModel.md`, respects `ProductBlueprint.md`'s Inventory nav domain, and introduces no write path beyond what `PROJECT_ARCHITECTURE.md`/`ADR-003` already authorize. No governance document requires updating for this plan itself — a future capability-maturity change (Level 3 → Level 4) would be the trigger to update `PlatformCapabilityModel.md`, at that time, not now.
