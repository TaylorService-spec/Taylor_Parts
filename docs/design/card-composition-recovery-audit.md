---
artifact_type: audit
workstream: card-composition-recovery
title: Site-wide Card & Composition Recovery — repository-wide audit (read-only, pre-remediation)
status: AUDIT — read-only. No code changed, nothing deployed. Remediation waves are proposals pending authorization.
date: 2026-08-14
base_commit: 2ff91918
authority:
  - docs/design/eos-design-system-architecture.md (PROPOSAL)
  - PR #645 (architecture doc), PR #646 (Wave 0 primitives)
  - shared/ui/{WorkspaceShell,ContextBand,ActionRail,StatusPill}.jsx
---

# Card & Composition Recovery — Audit

## 0. Headline (read first — corrects the premise)

- **Nothing was migrated-then-reverted.** Git history shows **zero** revert/removal of any `WorkspaceShell`/`ContextBand`/`ActionRail`/`StatusPill` usage, and **zero** deletion of any Truck component. Every non-adopting surface is **never-migrated**, not regressed. So there is **no "visual reversion"** and **no deleted functionality to restore** — the recovery is entirely *forward migration*.
- **The stall was largely by design.** `docs/design/eos-design-system-architecture.md` is a **PROPOSAL** that (§10) ratified **only Wave 0** — build the 4 primitives + one reference migration each, *"no page-family rewrites"* — and **explicitly gated Waves 1–4 on UX live-persona evidence** (§8). Current adoption (primitives + 3 reference surfaces) **matches what was authorized.** Proceeding with the site-wide remediation now is a decision to **advance past that UX gate** — an Owner call, flagged here, not assumed.
- **Adoption today = 3 of ~45 routed surfaces**: `SalesWorkspace` (`/customers/opportunities`), `CoordinatedVisitsWorkspace` (`/service/coordinated-visits`), `CoordinatedMissionView` (`/service/coordinated-mission`). `ActionRail` is used by `SalesWorkspace` only. ~40 surfaces root at `<div className="fo-panel">`; `fo-panel` appears in ~40 files, `fo-badge` in ~27.

## 1. Intended standard (from the architecture doc)

- **Composition layer missing between tokens and pages:** `AppShell` stops at chrome and hands each page a bare `<main>`, so `.fo-panel` (a *card* class) became the de-facto page root in ~35 screens. `WorkspaceShell` is the intended page-root replacement (declares *regions* — identity/action, context, attention, work-area, supporting — **not six literal cards**). `.fo-panel` is demoted to a low-level surface.
- **7 workspace types** each surface should declare (§4): A Personal Home · B Operating Workspace · C Management/Oversight · D Collection/Queue · E Entity Detail · F Guided Task · G Field/Current-Work.
- **Card standard (§5):** a Card = a *meaningful, self-contained, bounded **peer object*** (a work order in a list, a truck in a fleet grid) — **never** the page/section wrapper. Named anti-pattern: *"a page-root `.fo-panel` holding a vertical stack of `.fo-panel` sections."*
- **Status standard (§5):** semantic tone (`positive/attention/unknown/muted/neutral/info/critical`, `shared/ui/tone.js`) → per-domain state→tone map → the single `StatusPill`. ~9 legacy badge families must converge onto it without flattening domain meaning.
- **What #645/#646 shipped:** #645 = the doc only (201 lines, no code). #646 = the 4 primitives + `tone.js` + CSS + 7 tests, **additive only, no page migrated.** Reference adoptions since: #649/#653 (SalesWorkspace), #674/#676 (Coordinated Visits/Mission).

## 2. Complete surface matrix

Legend: **WS**=WorkspaceShell · **CB**=ContextBand · **AR**=ActionRail · **SP**=StatusPill · root = current page-root wrapper.

| Route | Component | Root | WS | CB | AR | SP | Legacy / card notes |
|---|---|---|---|---|---|---|---|
| `/dashboard` (admin/disp) | `DashboardIndex` (App.jsx:129) | `fo-panel` | · | · | · | · | `fo-landing-grid/card` inline |
| `/dashboard` (tech) | `TechnicianDashboard.jsx` | `fo-panel` | · | · | · | · | fo-panel×5; fo-card (WO peer, OK); fo-badge×2 |
| `/dashboard/operations` | `Operations.jsx` | `fo-panel` | · | · | · | · | fo-panel×3 |
| `/customers` | `AccountsList.jsx` | `fo-panel` + WorkspaceHeader | · | · | · | · | fo-badge×4 |
| **`/customers/opportunities`** | **`SalesWorkspace.jsx`** | **WorkspaceShell** | ✓ | ✓ | ✓ | ✓ | **0 legacy — reference surface** |
| `/customers/:accountId` | `AccountDetail.jsx` | `fo-panel` | · | · | · | · | fo-panel×4; fo-badge×7 (inline tags, OK) |
| `/equipment` | `EquipmentWorkspace.jsx` | `fo-panel` | · | · | · | · | WorkspaceHeader |
| `/equipment/:id` | `EquipmentDetail.jsx` | `fo-panel` | · | · | · | · | fo-panel×8 (stacked sections = anti-pattern); fo-badge×2 |
| `/service` | `WorkOrdersList.jsx` | `fo-panel` | · | · | · | · | |
| `/service/job-assignments` | `Jobs.jsx` | `fo-panel` | · | · | · | · | fo-badge×2 |
| `/service/dispatch` | `Dispatch.jsx` | `fo-panel` | · | · | · | · | fo-card--dispatch (job peer, OK) |
| **`/service/coordinated-visits`** | **`CoordinatedVisitsWorkspace.jsx`** | **WorkspaceShell** | ✓ | ✓ | · | ✓ | **0 legacy — reference surface** |
| **`/service/coordinated-mission`** | **`CoordinatedMissionView.jsx`** | **WorkspaceShell** | ✓ | ✓ | · | ✓ | **0 legacy — reference surface** |
| `/service/technician-workspace` | `FieldMode.jsx` | `fo-field` (own shell) | · | · | · | · | Type-G field shell (candidate exemption) |
| `/service/dispatcher-board` | `DispatcherBoard.jsx` | `fo-panel` | · | · | · | · | |
| `/service/scheduling` | `SchedulingWorkspace.jsx` | `fo-panel fo-sched` | · | · | · | · | |
| `/service/work-orders/new` | `WorkOrderWizard.jsx` | `fo-panel fo-wizard` | · | · | · | · | Type-F stepper (candidate exemption) |
| `/service/work-orders/:id` | `WorkOrderDetailPage.jsx` | `fo-panel` | · | · | · | · | fo-panel×3 |
| `/service-operations` | `ControlTower.jsx` | `fo-panel` | · | · | · | · | `fo-stat-grid/stat` inline KPI |
| `/inventory` | `PartsList.jsx` | `fo-panel` + WorkspaceHeader | · | · | · | · | fo-badge; legacy `Inventory.jsx` dead/unrouted |
| `/inventory/part-master` | `PartMasterList.jsx` | bare `<div>` + inline | · | · | · | · | no shell at all |
| `/inventory/manufacturers` | `Manufacturers.jsx` | bare `<div>` + inline | · | · | · | · | inline STATUS_TONE dup risk |
| `/inventory/warehouses` | `Warehouses.jsx` | `fo-panel` + WorkspaceHeader | · | · | · | · | fo-panel×3 |
| **`/inventory/truck-inventory`** | **`TruckInventory.jsx`** | **`fo-panel`** | · | · | · | · | **Wave-1 priority; fo-panel×6; fo-badge×many; fo-card (truck peer, OK)** |
| `/inventory/transfers` | `Transfers.jsx` | `fo-panel` + WorkspaceHeader | · | · | · | · | fo-panel×3 |
| `/inventory/receiving` | `Receiving.jsx` | `fo-panel` | · | · | · | · | |
| `/inventory/:partId` | `PartDetail.jsx` | `fo-panel` | · | · | · | · | fo-card×5 stacked (borderline section-wrapper); fo-badge×5 |
| `/inventory-role/manager` | `PartsManagerHome.jsx` | `fo-panel` | · | · | · | · | fo-card overlay (anti-pattern) |
| `/inventory-role/warehouse` | `WarehouseManagerHome.jsx` | `fo-panel` + WorkspaceHeader | · | · | · | · | fo-card overlay (anti-pattern) |
| `/inventory-role/mine` | `PartsAssociateHome.jsx` | `fo-panel` | · | · | · | · | fo-card×8 (reorder peer, OK); fo-badge×5 |
| `/purchasing` | `PurchaseOrders.jsx` | `fo-panel` + WorkspaceHeader | · | · | · | · | fo-panel×3 |
| `/purchasing/suppliers` | `Suppliers.jsx` | `fo-panel` + WorkspaceHeader | · | · | · | · | fo-panel×3 |
| `/purchasing/receipts` | `Receipts.jsx` | `fo-panel` + WorkspaceHeader | · | · | · | · | fo-panel×3 |
| `/reporting/builder` | `ReportBuilder.jsx` | `fo-main` > `fo-panel` | · | · | · | · | double-wrapper |
| `/reporting/saved` | `SavedReports.jsx` | `fo-main` > `fo-panel` | · | · | · | · | double-wrapper |
| `/administration` (index) | `Technicians.jsx` | `fo-panel` | · | · | · | · | fo-badge×2 |
| `/administration/overview` | `AdministrationOverview.jsx` | `fo-panel` | · | · | · | · | (version/deploy info, #969) |
| `/administration/users` | `AdminUsers.jsx` | `fo-panel` | · | · | · | · | |
| `/administration/roles-permissions` | `AdminRolesPermissions.jsx` | `fo-panel` | · | · | · | · | |
| `/administration/integrations` | `IntegrationsFaq.jsx` | `integration-faq-page` | · | · | · | · | bespoke CSS outlier |
| `PlaceholderPage` routes | notifications, warranty, cycle-counts, back-orders, quotes, demand-planning, reporting/*, admin/{vehicles,regions,company-settings}, financials | `fo-panel` | · | · | · | · | generic stubs — migrate the placeholder once |
| Redirects | `/customers/{contacts,locations,equipment,service-history}`, `/service/control-tower`, `/inventory-role/*` (admin), catch-all | `Navigate` | — | — | — | — | no composition |

App chrome: `AppShell.jsx` (`fo-shell`) wraps every route — pre-existing chrome, distinct from `WorkspaceShell` (per-page content), not in scope.

## 3. Deleted-vs-never-migrated (confirmed)

- **Deleted / migrated-then-reverted: NONE.** `git log --diff-filter=D --all` shows no primitive file and no `*ruck*` file ever deleted; `git log -S"<primitive>"` shows every add still present; no revert commit touches the design system. The only pre-#646 deletions (`AppRouter.jsx`, `AppShell.jsx` old, `domains/*`, `SideNav.jsx`, `navConfig.js`) predate the primitives and never used them.
- **Never-migrated: everything except the 3 reference surfaces.** Includes the surfaces #646's own commit message named as phantom-`.fo-workspace` candidates (`EquipmentDetail`, `EquipmentRegister`, `Parts*Home`, `WorkspaceHeader`) — #646 only added the missing CSS for the literal `fo-workspace` class, it did **not** convert them to the component.
- **Truck "regression-shaped" change is a fail-closed correction, not a deletion.** `#942` (`8c870a3c`) gated deactivate/delete behind dedicated `TRUCK_DEACTIVATE_READY`/`TRUCK_DELETE_READY` flags **because their backend predicates provably cannot succeed** (`deactivateTruck` resolves inventory presence `UNKNOWN`; `deleteTruckCreatedInError`'s 11 reference authorities are `unverifiable()` stubs). Nothing to restore — the prior state was a control that always failed server-side.

## 4. Historical restoration points (= intended-implementation commits)

Since nothing was deleted, "restoration" means *reuse the reference implementations as the migration template*:

| Intended pattern | Reference commit / PR | Reference file |
|---|---|---|
| Primitives (WS/CB/AR/SP + tone) | `daa08e2a` / **#646** | `shared/ui/*` |
| WS + CB + AR + SP full adoption | `c576a06d`/`90a1c432` / **#649,#653** | `modules/sales/SalesWorkspace.jsx` |
| WS + CB + SP (read workspace) | `6b44e783`/`cd0fbe4d` / **#674,#676** | `modules/service/CoordinatedVisitsWorkspace.jsx`, `modules/mobile/CoordinatedMissionView.jsx` |
| StatusPill domain map | #674 | `domain/coordinatedVisit.js` (`visitReadinessTone`/`workOrderStatusTone`) |

## 5. Truck Inventory — first-priority remediation spec

Current: `TruckInventory.jsx` root `<div className="fo-panel">`; fleet items = `<button className="fo-card">` in an inline `minmax(280px,1fr)` grid (peer-object intent, but a generic wrapper, not a dedicated component). **Remediation (composition only — preserve all governed behavior):**
- Replace the page-root `fo-panel` with **`WorkspaceShell`** (regions: identity/actions, context, attention, work-area = fleet grid, supporting = filters/scan).
- **`ContextBand`** for truck identity + operational context (selected truck: number/label/status/home-warehouse/driver).
- **`ActionRail`** for Add Truck (primary), Manage Truck, Scan (secondary), preserving each control's existing gate.
- Extract a real **`TruckFleetCard`** peer-object component (keep it a peer card in the fleet grid — do **not** flatten the fleet into a table if the card conveys independent boundaries per the §5 test).
- Map legacy `fo-badge` truck statuses to **`StatusPill`** via a `truckStatusTone(status)` domain map (mirror `coordinatedVisit.js`).
- **PRESERVE UNTOUCHED** (audit §5, do not redesign/duplicate): the 9 governed callables (`createTruckCallable`, assign/reassign/unassign driver, changeStatus, changeHomeWarehouse, deactivate, reactivate, deleteTruckCreatedInError); the two client gates (`canManage` + `TRUCK_MANAGEMENT_WRITE_READY`, plus `TRUCK_DEACTIVATE_READY`/`TRUCK_DELETE_READY`); server-derived `actorUid`; `expectedVersion` CAS; `idempotencyKey`; `accessVersion` stale-completion discard; fail-closed backend predicates. No generic "update" callable is to be introduced.
- Recover nothing (nothing was removed); `displayLabel`/`vehicleNumber` edit + CSV import remain out of scope (never approved).
- Fix the stale comment `App.jsx:155` ("useTruckManagement invokes NO callable today" — false since `#12bed458` activated write-readiness).

## 6. Wave plan (proposals — Waves 1–4 gated on the UX decision in §0)

- **Wave 1 — Trucks & inventory operational workspaces:** `TruckInventory` (first), then `Warehouses`, `Transfers`, `Receiving`, `PartsList`, `PartMasterList`, `Manufacturers` (the two bare-div surfaces), `Parts*Home`.
- **Wave 2 — Work Orders / Dispatch / Scheduling / Technician:** `WorkOrdersList`, `WorkOrderDetailPage`, `Dispatch`, `DispatcherBoard`, `SchedulingWorkspace`, `Jobs`, `TechnicianDashboard`, `WorkOrderWizard` (Type-F — likely exemption), `FieldMode` (Type-G — likely exemption).
- **Wave 3 — Entity pages:** `AccountsList`/`AccountDetail`, `EquipmentWorkspace`/`EquipmentDetail`/`EquipmentRegister`, `PartDetail`, `Suppliers`, `PurchaseOrders`, `Receipts`.
- **Wave 4 — Administration / Reporting / Control Tower / outliers:** Administration/*, Reporting/* (+ `ReportBuilder`/`SavedReports` double-wrapper), `ControlTower`, `Operations`, `IntegrationsFaq`, `PlaceholderPage` (migrate once), `DashboardIndex`.

## 7. Automated conformance checks (designed; land WITH Wave 1)

Source-scanning `node --test` gates modeled on the existing `legacy-authorization-surface-gate.yml` corpus pattern (re-parse source, diff vs a recorded corpus, fail on un-recorded change). Route→component map extracted from `App.jsx`/`navConfig.js`.
1. **No routed page with `fo-panel` as root** — `test/routedPageRootNotPanel.test.mjs`: each routed component's outermost returned element must not be `fo-panel`.
2. **No new legacy badge families** — `test/legacyBadgeSurfaceGate.test.mjs` + `src/design/legacyBadgeSurface.json` corpus (seed from today's ~27 `fo-badge` files + the 8 sibling families); fail on any new family or increased usage (burn-down only).
3. **No new inline action-row / tone-object / card-grid where primitives exist** — `test/inlineLayoutConstructionGate.test.mjs` (allowlisted; the card-grid sub-check advisory until the corpus stabilizes, to respect the §5 legitimate-peer-card case).
4. **No WorkspaceShell bypass without documented exemption** — `test/workspaceShellAdoptionGate.test.mjs` + `src/design/workspaceShellExemptions.json` (each entry: file basename + reason referencing the doc's page-type §4 / wave §8, e.g. `FieldMode` Type-G, `WorkOrderWizard` Type-F). Optional companion workflow scoped to `field-ops-app-vite/src/**/*.jsx`.

## 8. Proposed first implementation PR scope

**PR 1 (Wave 1 lead): Truck Inventory composition migration + the 4 conformance gates seeded.**
- `TruckInventory.jsx` → WorkspaceShell/ContextBand/ActionRail/StatusPill + extracted `TruckFleetCard`; `truckStatusTone` domain map; stale-comment fix.
- Land the 4 conformance tests + their corpus/exemption files, seeded to today's inventory (so they pass green while Waves 2–4 burn down), with `TruckInventory` **removed** from the `fo-panel`-root corpus as the first burn-down entry.
- **Zero change** to truck callables, gates, readiness, fail-closed predicates, or authorization — composition-only.
- Scope excludes all other surfaces (they stay corpus-recorded until their wave). No deploy.

**Gate before PR 1:** the §0 UX-evidence decision — proceed with site-wide remediation now (past the architecture doc's Wave-1-gated-on-UX condition), or route Wave 1 through UX validation first.
