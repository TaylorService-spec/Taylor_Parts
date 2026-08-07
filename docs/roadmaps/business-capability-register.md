# Business Capability Roadmap / Coverage Register

**Status: durable roadmap artifact — the memory of what EOS will likely need, before it is designed.**

This register exists so identified business capabilities are **not lost** as the platform develops, and are
**not implemented prematurely**. It is the durable home for known-future needs between the moment a need is
recognized and the moment repository governance says it is time to design or build it.

### What this is NOT

- Not an implementation backlog, and not authorization to build.
- Not permission to create Firestore collections, widen `firestore.rules`, or deploy anything.
- Not permission to open a GitHub issue per capability (see the **GitHub Issue Rule** below).
- Not a speculative architecture exercise. Capabilities are recorded to **preserve seams**, not to
  pre-build abstractions.

For code-level deferrals (schema shortcuts, deferred fields), see
[`docs/FUTURE_ARCHITECTURE_BACKLOG.md`](../FUTURE_ARCHITECTURE_BACKLOG.md). This register is for **business
capabilities**, a level above that.

---

## Maturity model

| Status | Meaning |
|--------|---------|
| `IDENTIFIED` | The business need is known and recorded. |
| `ASSESSMENT_READY` | Dependencies/evidence are mature enough for a formal assessment. |
| `ASSESSED` | Authority and process boundaries are understood. |
| `PLANNED` | An approved architecture / specification / implementation sequence exists. |
| `IN_PROGRESS` | Being built. |
| `DELIVERED` | Shipped and governed. |

Advancing a row's status is a governance act (Owner + review), not a documentation edit. This register
records the *current* status; it does not confer the next one.

## Fields captured per capability

**Capability · Business problem · Primary domains · Known canonical authorities · Key business questions ·
Dependencies · Roadmap trigger · Current maturity · Related issue/ADR/spec.** The **Roadmap trigger** is the
most important field: it names the roadmap event that *requires* Product/Design to revisit the capability.

---

## Roadmap Review Rule (ongoing hygiene)

At **every Product/Design cycle transition**, briefly review this register against the work about to begin:

1. Does the next cycle **trigger** any `IDENTIFIED` capability?
2. If **no** → continue.
3. If **yes** → determine whether it has become `ASSESSMENT_READY`. Do **not** auto-implement it.

This is lightweight hygiene, not an approval ceremony.

## Cross-Domain Design Rule

Whenever a new feature is designed, check this register for **adjacent** known-future requirements. The
purpose is **not** to build them early — it is to avoid architecture that unnecessarily forecloses them.
**Preserve seams; do not speculative-generalize.**

## GitHub Issue Rule

Do **not** open one issue per row merely because it appears here. Create implementation/tracking issues when a
capability reaches the appropriate governance stage per repository convention. Reference existing issues
rather than duplicating them. **This register is the durable memory before that point.**

---

## Register

Ordered by seed number; order does not imply priority or sequence.

### 1. Service Contracts / Preventive Maintenance
- **Business problem:** Govern recurring service obligations, not only reactive Work Orders.
- **Primary domains:** Service, Equipment, Billing, Sales.
- **Known canonical authorities:** `accounts` (Customer), `equipment`/`equipment_models` (installed base,
  ADR-006/010), Work Order lifecycle, Parts (`parts`, ADR-008). Contract/PM authority = **greenfield**.
- **Key business questions:** Which Equipment is covered? What service/PM is included and when is it due?
  What labor/parts are included? What response commitments exist? When does it renew? Is it profitable?
- **Dependencies:** Customer/Account, Equipment installed base, Work Orders, labor attribution, Parts usage,
  billing.
- **Roadmap trigger:** Before recurring/contract Service implementation, or when the Service roadmap begins
  preventive-maintenance scheduling.
- **Current maturity:** `IDENTIFIED`.
- **Related:** a `warranty` Service nav item exists (label only); no contract authority yet.

### 2. Warranty / Service Entitlement
- **Business problem:** Determine who is financially responsible for a given service.
- **Primary domains:** Service, Billing, Parts, Equipment, Purchasing (manufacturer claims).
- **Known canonical authorities:** Work Order lifecycle, `equipment`, `parts`, `manufacturers`; entitlement/
  responsibility authority = **greenfield**.
- **Key business questions:** Is responsibility the Customer, Taylor Parts, the Manufacturer, a Warranty, a
  Service Agreement, or an approved goodwill/exception? How does that flow to WO, Parts, labor, billing, and
  manufacturer claims?
- **Dependencies:** Work Order, Parts, Technician labor, Billing, job economics; overlaps #1.
- **Roadmap trigger:** Before Service billing / Work Order financial completion is designed.
- **Current maturity:** `IDENTIFIED`.

### 3. Installed Base / Customer Equipment Lifecycle
- **Business problem:** Maintain the longitudinal operational history of Equipment at Customer sites.
- **Primary domains:** Equipment, Sales, Service, Inventory.
- **Known canonical authorities:** `equipment`/`equipment_models` (**the** serialized asset authority,
  ADR-006/010) — **do NOT create a second Equipment authority.** `accounts`, `locations`.
- **Key business questions:** Connect sale → serialized unit → installation → ownership → Customer → Location
  → configuration → service history → Parts replaced → warranty → temporary replacements → movement →
  retirement/replacement.
- **Dependencies:** Sales Order → fulfillment/installation, Work Orders, Temporary Equipment Placement (#12).
- **Roadmap trigger:** As Sales Order → Equipment fulfillment/installation is designed.
- **Current maturity:** `IDENTIFIED`.
- **Related:** ADR-006/010; the Equipment workspace + timeline already exist as the read foundation.

### 4. Returns / RMA / Credits / Reverse Commerce
- **Business problem:** EOS needs a governed **reverse** path as well as forward fulfillment.
- **Primary domains:** Inventory, Purchasing, Sales, Billing, Equipment.
- **Known canonical authorities:** `parts`, `inventory_transactions`, `warehouses`/`stock_locations`,
  `part_supplier_items`; reverse/credit authority = **greenfield**.
- **Key business questions:** Wrong Part, damaged shipment, Customer return, defective Equipment, manufacturer
  return, credit/rebill, replacement — how is each governed without corrupting forward-inventory state?
- **Dependencies:** Sales Order / fulfillment authority.
- **Roadmap trigger:** After Sales Order / fulfillment authority is established, and before commercial
  fulfillment is considered complete.
- **Current maturity:** `IDENTIFIED`.

### 5. Purchasing Economics + Vendor Performance
- **Business problem:** Procurement should provide more than reorder execution.
- **Primary domains:** Purchasing, Inventory, Service (job cost).
- **Known canonical authorities:** `reorder_requests`, purchase orders, `part_supplier_items`, Supplier
  Master (governed `suppliers`), `warehouses`/receiving. Cost/performance analytics = **greenfield**.
- **Key business questions:** Vendor, lead time, quoted vs actual cost, price history, backorders,
  substitutions, receiving discrepancy, fulfillment reliability — feeding readiness, purchasing decisions,
  inventory planning, job cost, vendor management.
- **Dependencies:** Purchasing/PO/Receiving maturity; Supplier Master.
- **Roadmap trigger:** When Purchasing/PO/Receiving moves beyond operational fulfillment into cost and
  performance management.
- **Current maturity:** `IDENTIFIED`.
- **Related:** Supplier Master program; Receiving capability chain.

### 6. Accounts Receivable / Collections
- **Business problem:** Billing is not the end of the commercial process.
- **Primary domains:** Billing/Finance, Sales.
- **Known canonical authorities:** none yet — Invoice/AR authority is **greenfield** (financials nav is a
  `future` placeholder).
- **Key business questions:** Invoice → Sent → Due → Payment/Partial → Overdue → Collections → Paid/Settled.
  Must express the distinction between **operationally complete**, **invoiced**, and **financially complete**.
- **Dependencies:** Sales Order → Billing architecture.
- **Roadmap trigger:** When Sales Order → Billing architecture reaches invoice/payment design.
- **Current maturity:** `IDENTIFIED`.

### 7. Sales Credit / Commissions
- **Business problem:** A salesperson needs governed credit for completed business.
- **Primary domains:** Sales, Finance.
- **Known canonical authorities:** `Opportunity.ownerEmployeeId` (canonical Employee ref) is the **owner**,
  which is **not** necessarily the commission recipient. Commission authority = **greenfield**.
- **Key business questions:** Sales credit, split credit, National Accounts vs Retail attribution, commission
  eligibility, payment trigger, adjustments, cancellations, returns, clawbacks, paid-in-full dependency.
  **Do NOT assume Opportunity owner = commission recipient.**
- **Dependencies:** Opportunity, Sales Order, payment/financial-completion authorities (#6).
- **Roadmap trigger:** After Opportunity + Sales Order + payment/financial-completion authorities are
  sufficiently defined.
- **Current maturity:** `IDENTIFIED`.
- **Related:** Opportunity workspace (Cycle 2) — [`docs/design/sales-opportunity-workspace-cycle2.md`](../design/sales-opportunity-workspace-cycle2.md).

### 8. Technician Skills / Certifications / Work Eligibility
- **Business problem:** Dispatch should assign work based on more than availability.
- **Primary domains:** Dispatch/Scheduling, Service, HR/Employee.
- **Known canonical authorities:** Employee directory, operational roles. **Preserve the ADR-012 distinction
  between operational eligibility and security authority** — skills/certs are operational eligibility, NOT
  security roles.
- **Key business questions:** Job type, Equipment/model, required skill, certification, Technician
  capability, geography, schedule, Truck, Parts readiness → governed assignment recommendation/eligibility.
- **Dependencies:** Dispatch/Scheduling convergence; labor evidence (#13).
- **Roadmap trigger:** During Dispatch/Scheduling convergence, when governed assignment recommendation/
  eligibility is designed.
- **Current maturity:** `IDENTIFIED`.
- **Related:** ADR-012; Scheduling workspace.

### 9. Capacity + Customer Promise
- **Business problem:** "We have the Equipment/Part" ≠ "We can deliver/install/service it Tuesday at 10."
- **Primary domains:** Scheduling/Dispatch, Sales, Inventory, Equipment.
- **Known canonical authorities:** Scheduling, Work Order lifecycle, readiness projection, Truck/`trucks`,
  Warehouse. Promise authority = **greenfield**. **Do NOT build a generalized promise engine now.**
- **Key business questions:** A credible operational promise may depend on Equipment, Parts, Warehouse prep,
  Technician skill/capacity, Truck, geography/travel, existing commitments, and schedule.
- **Dependencies:** Sales Order fulfillment + Scheduling/Dispatch readiness evidence.
- **Roadmap trigger:** After Sales Order fulfillment + Scheduling/Dispatch readiness can provide sufficient
  evidence.
- **Current maturity:** `IDENTIFIED`.
- **Related:** WO parts readiness projection; see also Watch Item #14.

### 10. Exception Ownership / Operational Accountability
- **Business problem:** Detecting ATTENTION is insufficient if nobody owns resolution.
- **Primary domains:** Cross-domain (Service, Inventory, Sales, Finance, Equipment).
- **Known canonical authorities:** the existing per-domain ATTENTION derivations (readiness, reorder queues,
  etc.). A cross-domain exception-ownership authority = **greenfield**. **Do NOT create another generic task
  engine until existing workflow authorities have been assessed.**
- **Key business questions:** What requires attention? Who owns resolving it? By when? What is the next
  action? Has someone acknowledged it? When should it escalate? When is it resolved? (e.g. Parts shortage,
  overdue Loaner, failed Warehouse prep, unscheduled delivery, overdue payment, unresolved labor time,
  unknown Equipment custody.)
- **Dependencies:** existing workflow authorities assessed first; UX/Operations exception-surface work.
- **Roadmap trigger:** When UX/Operations begins consolidating management-by-exception surfaces and repeated
  cross-domain exception ownership becomes evident.
- **Current maturity:** `IDENTIFIED`.

### 11. Operational Commitment — **WATCH ITEM (not yet a capability)**
- **Business problem:** Taylor Parts has promised WHAT, to WHOM, by WHEN — and EOS understands the
  operational dependencies to satisfy it. May connect Sales Order, Equipment allocation, Parts readiness,
  Warehouse prep, Scheduling, Technician capacity, delivery/install.
- **Status: WATCH ITEM — DO NOT DESIGN OR IMPLEMENT.** There is not yet sufficient evidence that a separate
  authority is required. This item exists **specifically to prevent over-engineering.**
- **Roadmap trigger:** During Sales Order + fulfillment design, explicitly ask: *"Can existing authorities
  represent the Customer commitment cleanly?"* If **yes**, do not create another abstraction. If **no**,
  return for assessment.
- **Current maturity:** `IDENTIFIED` (watch item).

---

## Already-supplied cross-domain requirements

These were supplied earlier and have durable detail; summarized here and cross-referenced so the register is
complete. Do not duplicate their full detail — treat the linked artifacts as authoritative.

### 12. Temporary Equipment Placement / Custody Relationship (`SERVICE_LOANER`, `SALES_EVALUATION`)
- **Business problem:** Govern temporary company-owned Equipment placed at a Customer/prospect — a service
  loaner (replacement while a unit is out for service) or a sales evaluation (try-before-buy).
- **Primary domains:** Equipment, Service, Sales, Inventory, Dispatch.
- **Known canonical authorities:** `equipment` remains **the** serialized asset authority. The BUSINESS
  RELATIONSHIP + full tracking are ratified, but the **persistence shape is UNRESOLVED — representation to be
  determined by formal Assessment** (do NOT yet ratify a new canonical "Temporary Placement" collection).
  Options to assess: (a) a dedicated governed placement relationship, (b) existing Equipment custody/location
  authority + a commitment/return relationship, (c) another minimal representation supported by existing
  architecture. Whatever the shape, it owns ONLY the temporary relationship/custody context and must NOT
  duplicate Warehouse / Dispatch / Work Order / Technician / Inventory-movement state.
- **Key business questions:** For every eligible unit — where it is, who has custody, who owns it, why
  deployed, which Customer/location, related Opportunity/WO/Sales Order, condition/readiness, expected
  return, future commitments, whether actually available. **Unknown custody/location/commitment ⇒
  AVAILABILITY = UNKNOWN (never AVAILABLE).**
- **Execution:** rides the existing chain — Temporary Equipment Request → allocate → Warehouse prep → Work
  Order → Scheduling/Dispatch → Technician + Truck → load verification → delivery/install → placement active;
  return/pickup reuses the same Service/Dispatch process. No parallel fulfillment workflow.
- **Dependencies:** F2 + realistic Equipment/Inventory sandbox evidence; installed base (#3).
- **Roadmap trigger:** Formally assess after F2 + mature sandbox. `SERVICE_LOANER` = early consumer;
  `SALES_EVALUATION` later consumes the same capability from an Opportunity.
- **Current maturity:** `IDENTIFIED`.
- **Related:** ADR-006/010 (Equipment); Opportunity Cycle 2 preserves the SALES_EVALUATION request seam
  (solution lines reference product/model/part, never a serialized asset).

### 13. Technician Labor + Cost Accounting
- **Business problem:** Complete accounting of paid Technician time and its cost.
- **Primary domains:** Service, HR/Payroll boundary, Finance, Dispatch, Sales.
- **Known canonical authorities:** canonical Work Order lifecycle events (Travel/Arrive/Work Start/Complete)
  are the evidence source — **do NOT mint competing labor timestamps.** Employee directory. A governed
  effective-dated **labor-cost-rate authority** = greenfield; compensation must NOT live on Work Orders.
- **Key business questions:** Keep distinct — PAID time ≠ JOB-attributable time ≠ TRAVEL ≠ ONSITE; LABOR
  HOURS ≠ LABOR COST ≠ BILLABLE LABOR ≠ LABOR REVENUE; timekeeping ≠ WO execution ≠ customer billing.
  Non-job time must not disappear; residual surfaces as **UNACCOUNTED**. Historical job cost must not change
  because today's rate changed (effective-dated). Model = Technician × Work Order × time interval.
- **Dependencies:** Service Operations convergence + governed field lifecycle + F2 + realistic sandbox.
- **Roadmap trigger:** Assess as Service Operations convergence matures (the governed field lifecycle is the
  critical input) → minimum governed labor attribution → management/Accounting projections → scheduling/AI.
- **Current maturity:** `IDENTIFIED`.
- **Related:** Work Order lifecycle; WO parts readiness (shared AVAILABILITY=UNKNOWN posture).

### 14. Multi-Equipment Fulfillment / Coordinated Field Execution
- **Business problem:** Selling/servicing multiple machines (e.g. 5×C713) must keep **per-unit execution
  accountability** without forcing five separate user experiences for one coordinated Customer visit. Taylor
  today makes one Work Order per machine (cumbersome), but the underlying need — each serialized unit
  independently accountable — is legitimate. Goal: **accountability of five WITH the operating experience of
  one coordinated job.**
- **Primary domains:** Sales, Service/Dispatch, Equipment, Inventory/Warehouse, Billing.
- **Known canonical authorities:** `fieldops_wos` (Work Order execution), Scheduling, Dispatch, Sales Order
  (greenfield, downstream of WON), `equipment` (serialized asset), Warehouse fulfillment, Technician Current
  Job. **Do NOT invent a Job/Visit/WorkOrderGroup/InstallationGroup/FieldMission canonical collection yet** —
  first determine whether existing authorities can COORDINATE related Work Orders (shared Customer/Location/
  window/Technician/Truck) without duplicating each unit's independent execution state.
- **Critical cardinality distinction (do not conflate):** COMMERCIAL granularity (Sales Order) · VISIT/
  SCHEDULING granularity (one coordinated visit) · EXECUTION granularity (per-Equipment accountability) ·
  PHYSICAL-ASSET granularity (one serialized unit). Example: 1 Opportunity → 1 Sales Order → 5 serialized
  C713 → potentially 5 Equipment-accountable execution records → 1 coordinated delivery/install visit.
- **Partial completion is first-class:** 4 installed / 1 blocked ⇒ overall 4/5 ATTENTION — never fake whole-
  visit COMPLETE/INCOMPLETE. Preserve fulfillment evidence (SO qty 5 / fulfilled 4 / unresolved 1) for later
  Billing/A/R; do NOT define partial-billing policy now. Also a general Service pattern (multi-equipment PM in
  one visit; loaner remove+install).
- **Key business questions:** Can existing authorities coordinate related Work Orders under one visit while
  each unit keeps independent execution state? If yes → reuse; if no → return at Assessment with evidence a
  parent Visit/Job is necessary.
- **Dependencies:** Won Opportunity → Sales Order + Sales Order → fulfillment + Service Ops/Scheduling
  convergence.
- **Roadmap trigger:** Revisit during Won→Sales Order + SO→fulfillment + Service Ops/Scheduling convergence,
  **before** the Sales-Order-line ↔ serialized-Equipment ↔ Work-Order ↔ scheduled-visit cardinality is
  finalized. NOT in Opportunity Cycle 3.
- **Current maturity:** `IDENTIFIED`.

---

## Change log

- **2026-08-07** — Register created (roadmap hygiene, Owner direction). Seeded with capabilities 1–11
  (11 = watch item) plus cross-domain requirements 12 (Temporary Equipment) and 13 (Technician Labor). All
  `IDENTIFIED`.
- **2026-08-07 (2)** — Owner corrections: reworded #12 to "Temporary Equipment Placement / Custody
  Relationship — representation TBD by Assessment" (persistence shape not yet a ratified authority); added
  #14 Multi-Equipment Fulfillment / Coordinated Field Execution (`IDENTIFIED`).
