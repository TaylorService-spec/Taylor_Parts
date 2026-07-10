# Platform Capability Model

Foundational governance document defining the platform in terms of **business capabilities** — what the business can do — independent of which screen implements it, which entity backs it, or which deployment mode it runs under. Where [`BusinessEntityModel.md`](BusinessEntityModel.md) answers "what data exists," and [`ProductBlueprint.md`](ProductBlueprint.md) answers "how is navigation organized," this document answers "what can the platform do, and how mature is each thing it does."

## 1. Purpose

Capabilities represent what the business can do — not a screen, not a component, not a Firestore collection. A capability like "Dispatch Management" can be assessed for maturity and planned for growth independent of whether it's implemented today as `Dispatch.jsx` and `DispatcherBoard.jsx`, or eventually as something else entirely. Screens and code are how a capability is currently realized; they are not the capability itself.

This document builds directly on:
- [`ProductVision.md`](ProductVision.md) — the long-term business-domain scope this capability list operationalizes.
- [`PlatformConstitution.md`](PlatformConstitution.md) — specifically the "Business Domains" and "Platform Capabilities" principles, which named this distinction (domain-organized, capability-based thinking) without yet enumerating it concretely. This document is that enumeration.
- [`BusinessEntityModel.md`](BusinessEntityModel.md) — each capability below is grounded in the entities that already exist or are planned there; this document doesn't introduce new entities, it organizes existing ones by business function.
- [`ProductBlueprint.md`](ProductBlueprint.md) — the business-domain navigation this document's capabilities are named consistently with, so a capability and a nav domain are recognizably the same concept viewed from two angles (business function vs. user-facing organization), not two competing taxonomies.

This document does not enumerate Platform Services (reusable, horizontal, no-single-capability-owns-them concerns — see `PROJECT_ARCHITECTURE.md`'s Enterprise Platform Classification Model, Section A) as their own hierarchy; Business Capabilities and Platform Services are complementary, not competing, and a capability below may consume a Platform Service without that service becoming a capability of its own. **Assignment** (putting a person on a workflow record) is one such Platform Service, formally governed by `PROJECT_ARCHITECTURE.md`'s "Person Assignment Platform Service Standard" — every capability that needs to assign a person (Inventory Management, Dispatch Management, Warehouse, Procurement, Sales, etc.) consumes that one standard rather than each defining its own.

## 2. Capability Hierarchy

Initial top-level capabilities:

1. Customer Management
2. Service Management
3. Dispatch Management
4. Technician Operations
5. Inventory Management
6. Warehouse Management
7. Procurement
8. Financial Operations *(Future)*
9. Sales & CRM *(Future)*
10. Reporting & Analytics
11. Administration
12. Integration Platform
13. AI Platform *(Future)*

## 3. Capability Definition Template

Every capability entry below follows this shape:

- **Purpose** — the business function this capability serves.
- **Business Objects** — which entities from `BusinessEntityModel.md` it's built on.
- **Primary Users** — which roles/personas rely on it.
- **Current Maturity** — a Level 1–5 rating (Section 5) reflecting what's actually built and verified today.
- **Target Maturity** — where this capability is headed, not a commitment to a date.
- **Key Workflows** — the concrete, real user journeys this capability supports.
- **Future Expansion** — named, not designed — what would grow this capability's maturity further.

### Customer Management
- **Purpose**: Manage the organizations and people the business serves.
- **Business Objects**: Account, Contact, Location.
- **Primary Users**: Admin, Dispatcher.
- **Current Maturity**: Level 2 (Operational Workflows) — real create/read/update for Account/Location, minimal inline Contact management, Global Search (Accounts provider).
- **Target Maturity**: Level 3 — territory/segmentation reporting, richer Contact workflows.
- **Key Workflows**: Create Customer, add Location, add Contact, search Customers, view Customer Detail.
- **Future Expansion**: Equipment/Asset tracking per Location, Service Contracts, Customer Timeline (all named in `BusinessEntityModel.md` as future entities).

### Service Management
- **Purpose**: Manage the lifecycle of field service work from request to completion.
- **Business Objects**: Work Order, Account, Location.
- **Primary Users**: Admin, Dispatcher, Technician (read-scoped).
- **Current Maturity**: Level 2 — real Work Order lifecycle (11-status state machine), creation wizard UI, detail route; live Cloud-Function-backed creation currently blocked on a standing Firebase Blaze-plan decision — see [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md).
- **Target Maturity**: Level 4 — automated scheduling/PM triggers once Service Contracts (future entity) exist.
- **Key Workflows**: Create Work Order, transition through lifecycle, view Work Order Detail, technician-assignment.
- **Future Expansion**: Service Contract → PM Schedule → Work Order chain (`BusinessEntityModel.md`'s Version 3+ future entities), Equipment-scoped service history.

### Dispatch Management
- **Purpose**: Match Work Orders to technicians and manage real-time dispatch operations.
- **Business Objects**: Work Order, Technician (via `fieldops_technicians`).
- **Primary Users**: Dispatcher.
- **Current Maturity**: Level 3 (Optimization) — Dispatcher Board with drag-and-drop dispatch, Technician Recommendation Engine (TRE-v1) scoring, Control Tower real-time intelligence panels.
- **Target Maturity**: Level 4 — automated dispatch suggestions acted on with minimal manual intervention.
- **Key Workflows**: View dispatch queue, drag-and-drop or click-to-dispatch, view recommendation breakdown, monitor at-risk/overloaded signals.
- **Future Expansion**: Territory-aware dispatch (depends on Location territory data), SLA-aware prioritization (depends on Service Contracts).

### Technician Operations
- **Purpose**: Support field technicians executing assigned work.
- **Business Objects**: Work Order, Employee/User (Technician).
- **Primary Users**: Technician.
- **Current Maturity**: Level 2 — Technician Dashboard, lifecycle actions (Accept/Travel/Arrive/WorkStart/Complete), execution capture (parts used, notes) — the execution-capture write path is Cloud-Function-based and currently non-functional pending deployment-mode resolution.
- **Target Maturity**: Level 3 — richer field workflows (photo capture, digital signature), offline support.
- **Key Workflows**: View assigned Work Orders, progress through lifecycle, record parts used/notes.
- **Future Expansion**: File Attachments (photos, manuals — named as a future capability in `BusinessEntityModel.md`), offline-first field mode.

### Inventory Management
- **Purpose**: Track parts stock and consumption.
- **Business Objects**: Part.
- **Primary Users**: Admin, Dispatcher (read); Technician (consumption, via execution capture).
- **Current Maturity**: Level 3 — append-only ledger (`inventory_transactions`), forecasting/reorder-point analytics, Operations dashboard reporting.
- **Target Maturity**: Level 4 — automated reorder triggering feeding Procurement.
- **Key Workflows**: View inventory health, view consumption via execution capture, forecast reorder needs.
- **Future Expansion**: Real-time low-stock alerting, automated Purchase Order draft-to-send.

### Warehouse Management
- **Purpose**: Track physical stock locations and movement between them.
- **Business Objects**: Warehouse, Part, Vehicle *(future)*.
- **Primary Users**: Admin, Dispatcher (read); future Warehouse staff role.
- **Current Maturity**: Level 2 — real Warehouse/stock-location backend and reconciliation reporting; no dedicated Warehouse-role UI yet (Inventory domain's "Warehouses"/"Truck Inventory" nav items are still placeholders).
- **Target Maturity**: Level 3 — real transfer-order workflows, cycle counts.
- **Key Workflows**: View warehouse reconciliation report, view stock by location.
- **Future Expansion**: Vehicle (mobile stock location) entity and UI, receiving/put-away workflows, cycle counts.

### Procurement
- **Purpose**: Manage supplier relationships and purchasing.
- **Business Objects**: Supplier, Purchase Order.
- **Primary Users**: Admin, Dispatcher.
- **Current Maturity**: Level 2 — real Supplier/Purchase Order backend, draft-proposal generation from reorder recommendations, Operations dashboard reporting; no dedicated Purchasing-domain UI yet (nav items are placeholders).
- **Target Maturity**: Level 3 — real Purchase Order creation/approval UI, supplier catalog management UI.
- **Key Workflows**: View purchase orders, view draft proposals.
- **Future Expansion**: Demand planning UI, supplier catalog editing, PO approval workflow.

### Financial Operations *(Future)*
- **Purpose**: Manage billing and financial transactions tied to service work.
- **Business Objects**: Invoice *(future)*.
- **Primary Users**: Admin, future Accounting role.
- **Current Maturity**: Level 1 (nav placeholder only — "Financials" top-level future stub).
- **Target Maturity**: Level 3 — real invoicing tied to completed Work Orders.
- **Key Workflows**: None yet.
- **Future Expansion**: Depends on Service Contract billing rules and ERP/accounting integration (see [`IntegrationArchitecture.md`](IntegrationArchitecture.md)).

### Sales & CRM *(Future)*
- **Purpose**: Manage prospective customer pipeline.
- **Business Objects**: Opportunity/Quote *(future)*.
- **Primary Users**: Future Sales role.
- **Current Maturity**: Level 1 (nav placeholder only — "Sales / CRM" top-level future stub).
- **Target Maturity**: Level 2 — basic pipeline tracking.
- **Key Workflows**: None yet.
- **Future Expansion**: Full pipeline/quote-to-Work-Order conversion flow.

### Reporting & Analytics
- **Purpose**: Provide operational and executive visibility across all other capabilities.
- **Business Objects**: Cross-cutting — composes outputs from every other capability's entities, never a new source of truth (Rule 12, `CLAUDE_CONTEXT.md`).
- **Primary Users**: Admin, Dispatcher, executive stakeholders.
- **Current Maturity**: Level 3 — Operations dashboard (inventory/warehouse/procurement reporting), execution analytics (technician stats, part usage), cross-domain composition layer (Epic 8).
- **Target Maturity**: Level 4 — automated anomaly/bottleneck alerting.
- **Key Workflows**: View Operations dashboard, view Performance Snapshot, view cross-domain bottleneck signals.
- **Future Expansion**: BI/warehouse export (see [`IntegrationArchitecture.md`](IntegrationArchitecture.md)), customer-facing reporting.

### Administration
- **Purpose**: Manage platform configuration, users, and internal personnel.
- **Business Objects**: Employee/User, future Company.
- **Primary Users**: Admin.
- **Current Maturity**: Level 2 — Employee (Technician) management re-homed under Administration; Users/Roles & Permissions/Company Settings/Integrations/Audit Logs are all still nav placeholders.
- **Target Maturity**: Level 3 — real Users/Roles & Permissions UI.
- **Key Workflows**: Manage field technicians (existing, narrower scope than full "Employee").
- **Future Expansion**: General Employee entity (distinct from the narrower Technician record — see `BusinessEntityModel.md`'s Employee/User/Technician split), Roles & Permissions UI, Company Settings once `Company` becomes active.

### Integration Platform
- **Purpose**: Move operational data to and from external systems.
- **Business Objects**: Cross-cutting.
- **Primary Users**: Admin, future integration-engineering role, external systems.
- **Current Maturity**: Level 1 — no integration/export layer exists yet; this capability is purely conceptual today. Its governing expectations (integrations consume exported data, never become the operational system of record) are formalized in [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md).
- **Target Maturity**: Level 3 — real export jobs and/or customer-hosted integration agents (per [`IntegrationArchitecture.md`](IntegrationArchitecture.md)).
- **Key Workflows**: None yet.
- **Future Expansion**: The concrete build-out of the architecture defined in [`IntegrationArchitecture.md`](IntegrationArchitecture.md) — Snowflake/ETL/BI/ERP/accounting exports, event bus, webhooks, retry strategy.

### AI Platform *(Future)*
- **Purpose**: Assistive and predictive intelligence layered across other capabilities.
- **Business Objects**: Cross-cutting.
- **Primary Users**: All roles, indirectly.
- **Current Maturity**: Level 2 — the Technician Recommendation Engine (TRE-v1) is a real, deterministic scoring implementation, the first concrete instance of this capability, though not framed as "AI Platform" when it was built.
- **Target Maturity**: Level 5 — genuinely adaptive/learned models, not just deterministic scoring.
- **Key Workflows**: Technician recommendation scoring (Dispatch Management's TRE-v1).
- **Future Expansion**: Predictive maintenance scheduling, demand forecasting beyond the current linear model, natural-language reporting interfaces.

## 4. Initial Capability Mapping

| Capability | Related Business Entities | Existing Repository Modules | Existing Documentation | Planned Future Documents |
|---|---|---|---|---|
| Customer Management | Account, Contact, Location | `modules/accounts/`, `domain/accounts.js`, `domain/locations.js`, `domain/contacts.js` | `BusinessEntityModel.md` | — |
| Service Management | Work Order, Account, Location | `modules/workOrders/`, `modules/controlTower/WorkOrderDetail.jsx`/`WorkOrderActions.jsx`, `functions/src/createWorkOrder.ts`/`transitionWorkOrder.ts` | `docs/architecture/ADR-002-work-order-engine.md`, [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md) | — |
| Dispatch Management | Work Order, Technician | `modules/dispatcherBoard/`, `modules/controlTower/`, `domain/technicianRecommendationEngine.ts` | `docs/architecture/ADR-004-technician-recommendation-engine.md` | — |
| Technician Operations | Work Order, Employee/User | `modules/technicianDashboard/` | — | — |
| Inventory Management | Part | `functions/src/inventoryService.ts`/`inventoryAnalyticsService.ts`, `domain/inventoryAnalyticsEngine.ts` | `docs/architecture/ADR-003-inventory-trigger-system.md` | — |
| Warehouse Management | Warehouse, Part, Vehicle *(future)* | `functions/src/warehouseService.ts`/`warehouseReconciliationService.ts`, `modules/operations/panels/WarehousePanel.jsx` | — | — |
| Procurement | Supplier, Purchase Order | `functions/src/procurementService.ts`/`supplierService.ts`, `modules/operations/panels/ProcurementPanel.jsx` | — | — |
| Financial Operations | Invoice *(future)* | — (nav placeholder only) | — | — |
| Sales & CRM | Opportunity/Quote *(future)* | — (nav placeholder only) | — | — |
| Reporting & Analytics | Cross-cutting | `analytics/executionAnalyticsService.ts`/`operationsIntelligenceService.ts`, `modules/operations/` | — | [`IntegrationArchitecture.md`](IntegrationArchitecture.md) (export/BI section) |
| Administration | Employee/User, Company *(future)* | `modules/technicians/` | — | — |
| Integration Platform | Cross-cutting | — (none yet) | [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md), [`IntegrationArchitecture.md`](IntegrationArchitecture.md) | — |
| AI Platform | Cross-cutting | `domain/technicianRecommendationEngine.ts` | `docs/architecture/ADR-004-technician-recommendation-engine.md` | — |

## 5. Maturity Model

| Level | Name | Description |
|---|---|---|
| 1 | Basic CRUD | Data can be created/read/updated/deleted; no real business workflow yet, or only a nav placeholder exists. |
| 2 | Operational Workflows | Real, multi-step business processes work end-to-end for at least the primary user role. |
| 3 | Optimization | The capability actively helps users make better decisions (recommendations, reconciliation reporting, forecasting) beyond basic data entry/retrieval. |
| 4 | Automation | Routine decisions or actions happen without manual initiation (auto-dispatch, auto-reorder, auto-scheduling). |
| 5 | Intelligence / AI | Adaptive, learned, or predictive behavior beyond deterministic rules/scoring. |

**Every capability progresses independently.** Service Management reaching Level 4 doesn't require Financial Operations to reach Level 2 first — there is no platform-wide "release version" that all capabilities must move in lockstep with. A capability's maturity is a property of that capability alone.

## 6. Release Planning

Future releases should be planned **by capability maturity target**, not by bundling unrelated features into a release purely because they land in the same time window. A release note should be expressible as "Dispatch Management moves from Level 3 to Level 4" — a capability-and-maturity statement — rather than only a list of unrelated shipped features. This doesn't replace sprint-level planning (`ROADMAP.md`'s existing sprint breakdown) — it's the layer above it that gives a sprint's work a stated purpose in capability terms.

## 7. AI Development Workflow

Capabilities are the layer that should guide how an AI session (or a human engineer) decides what to build and why, in this order:

```
Product Vision
     ↓
Platform Capability
     ↓
Business Entity
     ↓
Architecture
     ↓
Implementation Plan
     ↓
Claude Code
     ↓
Review
```

Concretely: a request should be traceable to a named capability and its target maturity (this document) before it's traced to which entities it touches (`BusinessEntityModel.md`), before architecture/implementation planning begins. A request that can't be located in this document's capability list is a signal to pause and ask which capability it serves — not necessarily a reason to refuse it, but a prompt to place it correctly rather than build it as an orphaned feature.

## 8. Status

This document is a **foundational governance artifact**, alongside `ProductVision.md`, `PlatformConstitution.md`, `ProductBlueprint.md`, and `BusinessEntityModel.md`. [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md), [`PlatformOperatingModel.md`](PlatformOperatingModel.md), and [`IntegrationArchitecture.md`](IntegrationArchitecture.md) are now also complete — all four planned governance companions named in `ROADMAP.md` are written.
