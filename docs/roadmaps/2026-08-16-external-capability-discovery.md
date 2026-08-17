# External Capability Discovery — sweep 1 (2026-08-16)

**Status: discovery inventory, verified against the repository. Nothing here is authorized or scheduled.**

> ## ⚠️ Model correction (post-review) — read before trusting any activation claim below
>
> This document uses **`BUILT_INERT`** to mean "built and hard-denied everywhere". **That reading is
> wrong**, and it is the same class of error the document elsewhere records itself making.
> `functions/src/access/environmentCapabilityOverrides.ts` activates **27** catalog-inactive
> capabilities in `eos-platform-sandbox`. A capability can be `active:false` in the catalog **and have
> its capability-level activation gate enabled in sandbox at the same time**. Activation is a gate, not a
> grant — a principal still needs the applicable Role grant, which nothing here evaluates.
>
> Concretely: `salesOrder.fulfill`, `finance.invoice.issue`, `opportunity.write`, and the transfer and
> cycle-count families are described below as gated or fail-closed. In the **catalog baseline** they
> are. **In sandbox they are activated.** Statements below of the form "built but switched off" should
> be read as "catalog-inactive", never as "unusable everywhere".
>
> The repo's own rule, which this document failed to honour:
> **eligibility != activation != authorization.**
>
> The corrected, machine-checked view is
> [`../architecture/capability-graph.md`](../architecture/capability-graph.md) — it reports catalog
> declaration, implementation evidence, and environment activation as three separate facts, and computes
> effective state only for an explicitly named environment. **Prefer it over any activation claim here.**
>
> The wording below is left in place deliberately. It is the evidence of the failure mode the graph
> exists to prevent, and sanitising it would destroy that record.

The durable output of the first **outward-facing** discovery sweep. The site-work discovery loop had only
ever been pointed inward (at our own code and UX); this sweep points it at external sources — competing
products and trade-domain practice — to surface capabilities we have not considered at all, as distinct
from capabilities we know about and have deferred.

**Every candidate was then verified against the actual repository** before being called a gap. That pass
materially changed the result: several "gaps" turned out to be built-and-gated or already designed, and
two of the premises behind them were simply wrong. Section 3 carries the verdicts.

Relationship to neighbouring artifacts:

- [`business-capability-register.md`](business-capability-register.md) — the governed register. Items are
  **promoted** from here into that; this file is the raw catch.
- [`2026-08-15-owner-capability-additions.md`](2026-08-15-owner-capability-additions.md) — Owner-recorded
  additions #16–18 plus UX-layer design intents.
- [`../design/inventory-sales-templates-and-lines-of-business-wireframe.md`](../design/inventory-sales-templates-and-lines-of-business-wireframe.md)
  — **carries its own `G##` gap numbering (G43, G44, …).** This document therefore uses an `EXT-##`
  prefix to avoid collision.
- [`../FUTURE_ARCHITECTURE_BACKLOG.md`](../FUTURE_ARCHITECTURE_BACKLOG.md) — code-level deferrals, below this level.

Future sweeps **append** to this file rather than starting over.

---

## 1. Sources swept

| # | Source | Type | Why chosen |
|---|---|---|---|
| S1 | Dynamics 365 Business Central (via usedynamics.com) | General SMB ERP | Complete ERP scope baseline; ~600-video taxonomy weighted by real user need |
| S2 | ServiceTitan | Field service platform | Publishes a dedicated **commercial food equipment service** configuration |
| S3 | BuildOps + FieldEdge | Commercial contractor FSM | BuildOps targets commercial mechanical contractors — closest structural match |
| S4 | Commercial refrigeration / ice machine trade practice | **Domain, not software** | Regulatory and trade realities absent from every product feature list |
| S5 | Wholesale / parts distribution (Epicor P21 & Eclipse, HARDI) | **Domain, not software** | The parts-distribution half of the business |
| S6 | Salesforce (Sales Cloud + Service Cloud case model) | CRM benchmark | Owner-directed; CRM is the thinnest side of the platform |

**Source caveats.** S1 content is ~2019–2021 vintage (pre-Copilot, stale pricing). S4 regulatory thresholds
and dates **must be verified against primary EPA text before anything is encoded**; PM cadence, loaner
norms and core-charge practice vary regionally. S5 restocking percentages are industry-typical, not
universal. S6 edition/packaging claims are directional.

## 1b. Verification method — and one flaw in it

Three read-only scouts checked each candidate against `docs/`, `field-ops-app-vite/src/`, and `functions/`,
assigning: **SHIPPED** / **BUILT_INERT** (code exists, gated or undeployed) / **DESIGNED** (spec or design
doc, no code) / **RECORDED** (named in a register only) / **NO_TRACE**.

⚠️ **Known contamination.** Two of the three scouts found *this document* and cited it as evidence that
items were "RECORDED" — circular, since they were recorded here hours earlier. Those verdicts were
discarded; only their **code-inspection** findings are used below. A future verification pass must exclude
the artifact under verification from the scout's reading.

---

## 2. What the sweep CONFIRMED — the register is in good shape

**17 of 18 registered capabilities were independently corroborated by at least one external source.** The
register is not behind a mature ERP on the service side.

| Register # | Capability | Corroborated by |
|---|---|---|
| 1 | Service Contracts / PM | S1, S2, S3, S4 — all four |
| 2 | Warranty / Service Entitlement | S1, S3, S4 |
| 3 | Installed Base / Equipment Lifecycle | S1, S2, S3, S4 |
| 4 | Returns / RMA / Credits | S1, S5 |
| 5 | Purchasing Economics + Vendor Performance | S5 |
| 6 | AR / Collections | S1 |
| 7 | Sales Credit / Commissions | S5 |
| 8 | Technician Skills / Certifications | S2, S3, S4 — EPA 608 makes this compliance, not preference |
| 9 | Capacity + Customer Promise | S2, S5 |
| 12 | Temporary Equipment Placement | S4 — loaner/rental during downtime is a real trade pattern |
| 13 | Technician Labor + Cost Accounting | S1, S2, S3 |
| 15 | Commercial Coverage & Territory | **S5 + S6 — strongest corroboration in the sweep.** Salesforce Enterprise Territory Management is precisely this: model-level assignment rules on account attributes, territories carrying their own teams (many-to-many, not one salesperson field), versioned realignment. Not speculative — it is how the category leader models coverage. |
| 16 | Warehouse Location / Container / Scan Movement | S1, S2, S5 |
| 17 | Serialized Asset Location & Tracking | S1, S2, S3 |
| 18 | Optional Marketing Module | S1 |

**No external equivalent found** for #10 (Exception Ownership) or for #12 as a *governed custody
relationship* beyond simple rental. Those appear to be genuinely ours.

**#15 is better than recorded.** Verification found the seam instruction was actually followed:
`src/domain/commercialCoverage.js` defines `CoverageAssignment` (assignee, scope, responsibility, priority,
effective dating), with a governed backend read callable `resolveCoverageForContext`
(`functions/src/coverage/coverageReadCallables.ts`, exported), fail-closed behind `coverage.read`
`active: false`, and an assessment at `docs/assessments/commercial-coverage-territory-authority-model.md`.
No UI consumes it. Inert by design, exactly as the register instructed.

---

## 3. Verified findings

`EXT-##` IDs are local to this document. **Disposition** is a recommendation, not a decision.

### 3a. NOT gaps — already built, gated, or designed

The verification pass reclassified these. **Recording them matters as much as the gaps** — they are where
we would otherwise have duplicated existing work.

| ID | Candidate | Verdict | Evidence | Disposition |
|---|---|---|---|---|
| EXT-01 | Stock allocation / reservation / available-to-promise | **BUILT_INERT** | `functions/src/fulfillment/allocateSalesOrder.ts`, `allocationProjection.ts` — states `ALLOCATED/PARTIAL/BACKORDERED/UNAVAILABLE/UNKNOWN`, nets other SO commitments and WO reservations; gated behind `salesOrder.fulfill` `active:false` | Drop. Activation question, not a capability gap |
| EXT-02 | Reorder point / safety stock / recommended qty | **SHIPPED** | `functions/src/inventoryAnalyticsService.ts` + `src/domain/inventoryAnalyticsEngine.ts`, wired via `inventoryAnalyticsCallables.ts` | Drop. See EXT-24 for the genuinely missing parts |
| EXT-03 | Cycle counting | **SHIPPED** | `functions/src/cycleCount/` — command, callables, repository, expected-quantity, validation. Owner un-hid the nav entry 2026-08-16 because a backend exists | Drop. An earlier internal report calling this a route stub was **wrong** |
| EXT-04 | Vendor lead time | **SHIPPED** | `functions/src/partMaster/partSupplierItems.ts` — governed `leadTimeDays`, validated 0–3650 | Drop |
| EXT-05 | Account teams / multiple named people per account | **BUILT_INERT** | `src/domain/commercialCoverage.js` `CoverageAssignment`; callable `resolveCoverageForContext`; `coverage.read` `active:false`; no UI consumer | Drop — subsumed by register #15 |
| EXT-06 | Customer-specific pricing (contract, tiered, effective-dated) | **DESIGNED** | `docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md` — Owner direction recorded, item×account rows, effective dating, open question Q37 on precedence | Drop as a discovery finding; it is an open design item under its own G-numbering |
| EXT-07 | Price book / national-account price list | **DESIGNED** | Same wireframe, its **G44**; explicitly deferred as "a subsystem" | Drop; tracked there |
| EXT-08 | Credit limit / terms / credit hold | **DESIGNED** | `docs/assessments/account-commercial-profile-and-financial-forecast-horizons.md` — `creditStatus`/`creditLimit` specced, authority "undefined here"; deferred in the implementation plan | Drop; tracked there |
| EXT-09 | Sales tax handling | **BUILT (partial)** | `taxStatus` enum `UNKNOWN\|TAXABLE\|EXEMPT\|RESELLER` in `src/domain/constants.js`; `financeInvoiceAmounts.js` computes taxable base and tax per line | Narrow to certificates only — see EXT-25 |
| EXT-10 | Customer returns / RMA | **BUILT_INERT (partial)** | `functions/src/inventoryLedger/operationalMovementTypes.ts` — `RETURNED` movement sourced from `"RMA"`; module header states it is inert with no callable surface. No restocking-fee logic. `finance/refundCommands.ts` is a money refund against an invoice — adjacent, not a parts RMA | Keep as register #4 refinement, not a new item |
| EXT-14 | Warranty as a classification of service performed | **LIKELY SHIPPED** | `"WARRANTY"` work-order type in `src/types/workOrder.ts`, selectable via `WorkOrderWizard.jsx` `TYPE_OPTIONS` | **Drop unless one of the residuals below applies.** *Owner, 2026-08-16: "warranty is really only used in this system to represent that the service performed was related to warranty work."* With claims, reimbursement, entitlement lookup and coverage determination all explicitly out of scope, the existing type tag is the capability — not a placeholder for one. Earlier entries in this document treated it as a gap by carrying a claims framing the Owner has since removed; that was wrong. **Two residuals worth a yes/no:** (a) **grain** — is warranty a property of the whole work order, or can one job carry warranty and billable lines together? (b) **reportability** — can "how much warranty work did we perform" be answered from the tag today? If both are fine, this closes. |

### 3b. Premise corrections — findings built on things that turned out not to exist

| ID | Correction |
|---|---|
| EXT-11 | **`operatingCompanyId` and `isNationalAccount` are not implemented.** They appear only in design docs, and `src/domain/constants.js` explicitly says "NOT operatingCompanyId… NOT salesChannel". An earlier claim in this sweep that the data model "already anticipates" national accounts was **wrong** — it is a design proposal with, per `docs/reviews/what-would-perfect-look-like.md`, "zero code". The dimensions and account-hierarchy findings below stand, but nothing exists to build on. |
| EXT-12 | **`financialForecastHorizons` is not sales forecasting.** It is AR/receivables and pipeline-order *financial* forecasting, and only its `unconfigured` state is reachable. Sales forecasting (EXT-33) remains absent. |

### 3c. Real gaps — verified absent from docs and code

**Tier 1 — highest priority after Owner scoping (2026-08-16)**

> **Owner decisions applied.** Refrigerant management (former EXT-13) and the A2L transition (former
> EXT-15) are **out of scope for this system** — moved to §4. Warranty is **not** a claims subsystem —
> EXT-14 is rescoped below. Over-the-counter sale is **a major line of business**, so the former Tier 3
> distribution cluster is the real Tier 1; see §3d.

| ID | Gap | Src | Verified |
|---|---|---|---|
| **EXT-14** | **Warranty as a classification of service performed** — *see §3a; this is very likely already covered and is retained here only as a pointer.* | S4 | **LIKELY SHIPPED** |

**Tier 2 — the SLA engine, and the structural items**

| ID | Gap | Src | Verified |
|---|---|---|---|
| **EXT-16** | **Entitlements, milestones and business hours — the SLA engine.** *Best cross-source convergence in the sweep.* S4 established that commercial refrigeration agreements carry priced response windows (4-hour emergency vs next-business-day) and enumerate covered equipment **by serial**. S6 supplies the mechanism: an entitlement attaches to an account, contract, **or individual asset** and drives a timeline of milestones ("first response within 2 business hours") with success/warning/violation actions, measured against a **business-hours and holiday calendar**, escalating on breach. A response-time promise is a running clock, not a text field. Sits across register #1, #2 and #9 and is the core none of them names. **Note the primitive: the business-hours calendar is small, load-bearing, and routinely omitted — after which SLA math is silently wrong.** | S4+S6 | **NO_TRACE** — no entitlement/milestone/SLA/business-hours engine |
| **EXT-17** | **Service contract entity** binding coverage to a specific list of serialized assets, with coverage tier and response SLA, determining covered-vs-billable per line at work-order open. | S1–S4 | **NO_TRACE** — register #1 states "Contract/PM authority = greenfield" |
| **EXT-18** | **Recurring PM generation.** PM as a distinct work-order type with a checklist, interval driven by site water hardness and environment rather than a flat calendar, and PM-overdue as a leading indicator. | S1–S4 | **NO_TRACE** — `"PM"` exists only as a work-order type option; no generator, no due tracking |
| **EXT-19** | **Analysis dimensions.** A general attribution model for reporting across Taylor and Ventana — BC's mechanism for multi-entity reporting without separate tenancy. Explicitly **not** multi-tenancy (Issue #140, deferred). | S1 | **DESIGNED as a single scalar only** — no general dimension model, no rollup. See EXT-11 |
| **EXT-20** | **Multi-level asset hierarchy** — property → system → unit → component, with rollup at each level. Our serialized-equipment model is flat. | S3 | **NO_TRACE** |
| **EXT-21** | **Customer / site hierarchy and portfolio rollup** — parent/child accounts, corporate → property → contact, cross-property reporting. | S3+S6 | **NO_TRACE** for hierarchy; the flag it would hang on does not exist either (EXT-11) |

### 3d. Parts distribution — **the priority cluster** (Owner, 2026-08-16)

> **"Over the counter is a major business point, and why I needed to work on an inventory system."**
> A primary line of business, not a tail-end nicety.
>
> ⚠️ **CORRECTION 2026-08-16 — this cluster was substantially overstated.** *Owner: "the idea of knowing the
> customer, what it bought, moving said inventory and then handing it through the sales process is
> covered. You're inventing gaps."* **Correct.** That chain is built end to end:
> customer → Sales Order with lines → `allocateSalesOrder` (allocation/ATP) → fulfillment →
> `inventory_transactions` ledger movement → `issueInvoice` → `applyPayment`. Every piece is repo-complete
> and exported; it is `active: false` by deliberate governance decision.
>
> **The error:** treating *inert* as *missing*. An activation decision is not a capability gap. EXT-01 was
> correctly classified as BUILT_INERT during verification and then contradicted in the prose around it,
> including a claim that a sale had "nowhere for the value to land" — invoicing exists and value lands on
> an invoice.
>
> **What this leaves.** Counter sale is a question about *flow*, not capability: does the existing Sales
> Order path suit a walk-in cash-and-carry transaction, or is it too heavy for one? That is a UX and
> sequencing question against shipped code, and it belongs to whoever owns the inventory workstream — not
> to a discovery sweep. The genuinely untraced items below stand on their own or not at all; **none of them
> should be read as implying the sales chain is missing.**
>
> **Second Owner input with structural consequences:** subcontractors are **customers who buy equipment for
> projects they run** — not parties Taylor subcontracts to. So the trade-sale channel sells **equipment**,
> not only parts, and often to a party who is not the end user and not the delivery destination. See EXT-48.

| ID | Gap | Verified |
|---|---|---|
| **EXT-22** | **Counter / will-call sale** — a paid, picked-up sale with no work order, no technician, no job cost object. **Owner-confirmed as a major line of business.** Needs instant price lookup, tender and payment, immediate stock decrement, and a sale object that is not a work order. Everything else in this cluster hangs off it. | **NO_TRACE** |
| EXT-23 | **Customer-facing parts quote** — quote as a sales instrument, quote-to-order, expiry. The navHidden `quotes` entry is under **Purchasing** (supplier quotes) and is unwired — unrelated. | **NO_TRACE** |
| EXT-24 | **ABC classification, EOQ, dead-stock identification** — the parts of replenishment not covered by EXT-02. | **NO_TRACE** |
| EXT-25 | **Resale / exemption certificate** storage and verification — `taxExemptionRef` is marked future in the spec. | **NO_TRACE** (narrowed from EXT-09) |
| EXT-26 | **Inventory valuation method** — FIFO / average / standard cost, cost layers, COGS. **Depends on §5 Q1.** | **NO_TRACE** |
| EXT-27 | **Core charge / exchange program** — deposit on a remanufacturable part refunded on return. Foundational for compressors per S5; S4 could not confirm trade prevalence. **Needs Owner confirmation (§5 Q5).** | **NO_TRACE** |
| EXT-28 | **Part cross-reference and supersession** — OEM cross-ref, superseded numbers, competitor interchange. Equipment-compatibility work is **adjacent but different**: `equipmentModel.ts` aliases are alternate names for an equipment *model*, and `SUPERSEDED_BY`/`REPLACED_PART` in `compatibility.ts` are *rejected* evidence types in a fitment taxonomy — not a part-to-part supersession system. | **NO_TRACE** |
| EXT-29 | **Drop-ship** — supplier direct to customer. Acknowledged as a *state* (`inventoryControlLifecycle.js` notes "Ventana drop-ship never in Taylor custody") with no order or workflow. | **RECORDED as a state only** |
| EXT-30 | **Freight / carrier / shipping.** | **NO_TRACE** |
| EXT-31 | **Kitting** — a sellable bundle with its own identity and BOM. "Kit" appears only as a catalog item *name*. | **NO_TRACE** |
| EXT-32 | **Supplier price-file import and vendor rebates** — bulk catalog/price feeds; volume and growth rebate programs, often material to net margin. Adjacent to register #5 but distinct from vendor *performance*. | **NO_TRACE** |
| ~~EXT-48~~ | **WITHDRAWN 2026-08-16.** Proposed as "trade equipment sale to a non-end-user with a distinct delivery destination", modelled as a bill-to/ship-to distinction on the account. **Owner:** contractors can pick up equipment and parts; the service department may install equipment they buy, or drop equipment off at locations — *"this is all controlled in the inventory management system, not a new feature not already considered."* The three cases resolve to mechanisms that already exist: pickup is the counter sale (**EXT-22**), install-by-service is an ordinary service work order, and drop-off is a stock movement to a location. **Owner, same exchange:** contractors *"are considered a customer and would live in the CRM"* — so there is no contractor segment, party type, or special account shape to model either; a contractor is a customer record like any other. **Cause of the error:** a distribution-ERP framing (order-level bill-to/ship-to, plus a distinct trade-party type) was imposed on something Taylor governs as inventory control against an ordinary customer. See §7. | n/a |

**Tier 4 — service delivery** (present in every FSM swept)

| ID | Gap | Verified |
|---|---|---|
| EXT-33 | **Service request / case intake** — an object for "a customer has a problem" *before* a work order exists: origin channel, status lifecycle, queues with assignment rules, age-based escalation. Our chain begins at work-order creation. | **NO_TRACE** |
| EXT-34 | **Customer-facing communication** — arrival windows, on-the-way notification, tracking link, post-job survey. The shipped `NotificationPanel` is confirmed **internal staff only** — verified as adjacent, not this. | **NO_TRACE** |
| EXT-35 | **Mobile forms / checklist engine** — configurable checklists per job or equipment type. **Load-bearing:** PM checklists (EXT-18), sanitation logs (EXT-37), and A2L safety procedures (EXT-15) all depend on it. | **NO_TRACE** |
| EXT-36 | **Deficiency → quoted work** — a PM finding converting into a quote. The revenue loop of a maintenance business; register #1 and Opportunities exist with no path between them. | **NO_TRACE** |
| EXT-37 | **Sanitation / cleaning compliance log** — FDA Food Code and NSF set a six-month floor for ice-contact surfaces; inspectors treat visible contamination as citable; operators need retrievable logs. | **NO_TRACE** |
| EXT-38 | **Water filtration programme tracking** — filter changes per asset by date and gallons. Scotsman ties 84-month evaporator coverage to six-month changes *reported back to them*; a missed change silently voids warranty. | **NO_TRACE** |
| EXT-39 | **Flat-rate pricebook** — standardised flat-rate catalog with good/better/best tiers, distinct from time-and-materials. | **NO_TRACE** |
| EXT-40 | **Billing basis per job** — fixed-price vs T&M as a first-class attribute driving separate costing and invoicing. Sits between register #6 and #13; neither covers it. | **NO_TRACE** |
| EXT-41 | **Per-truck standard stock template** with min/max replenishment. Partially adjacent to register #16. | **NO_TRACE** |

**Tier 5 — CRM relationship layer**

| ID | Gap | Verified |
|---|---|---|
| EXT-42 | **Activity model** — tasks, events, logged calls, notes, follow-ups as first-class records, with a timeline and last-activity rollup. **Nuance:** `ServiceActivitySection` + `serviceActivityView.js` render a timeline **derived from work orders**; there is no path for any user to *create* an activity or note. Recorded as design intent in the 2026-08-15 additions, with persistence "not ratified". **Gates EXT-43 and EXT-44.** | **DESIGNED (intent only)** |
| EXT-43 | **Close / loss reason codes** — `OPPORTUNITY_OUTCOMES = ["WON","LOST"]` with no reason field. Cheap now; the only route to win/loss analytics later. | **NO_TRACE** |
| EXT-44 | **Sales forecasting and quota** — forecast categories, rollup hierarchy, quota, attainment. Depends on EXT-42. See EXT-12 — the existing forecast module is something else. | **NO_TRACE** |
| EXT-45 | **Contact belonging to multiple accounts** — a junction carrying its own role. Contacts today carry one free-text role and the account "is ALWAYS fixed by context". Real for restaurant groups and multi-site operators. | **NO_TRACE** |
| EXT-46 | **Contact roles on an opportunity** — decision maker / influencer / economic buyer per deal. | **NO_TRACE** |
| EXT-47 | **Duplicate / matching rules** on customers and contacts. Only CSV-import-time skip exists (`contactCsvImport.js`), scoped to bulk import. Unglamorous; quietly wrecks account hierarchy (EXT-21) if missing. | **NO_TRACE** |

---

## 4. Assessed as out of scope — recorded so the question stops recurring

| Area | Src | Reason |
|---|---|---|
| Manufacturing — production orders, BOM/routing versions, MRP, capacity planning, machine centers, finite loading | S1 | Not a manufacturer |
| Intrastat reporting | S1 | EU statistical regime |
| Multi-currency | S1 | Domestic operations |
| Multiple languages | S1 | Revisit only if the workforce requires it |
| Membership / subscription programmes | S2 | Consumer loyalty model; commercial accounts use service agreements (register #1) |
| Consumer point-of-sale financing | S2 | Commercial accounts buy on terms — see EXT-08 |
| Deferral schedules, fixed assets, depreciation | S1 | **Conditional on §5 Q1** |
| **Refrigerant management** — per-asset charge weight, leak-rate tracking, EPA §608 recordkeeping, refrigerant-add events, technician 608 certification gating | S4 | **Owner decision 2026-08-16: this system does not manage refrigerant.** The regulatory obligation on the business is unaffected by this decision; it is simply not carried here. Recorded so the finding is not re-raised by a future sweep. |
| **A2L / AIM Act transition handling** — refrigerant type driving safety procedure or technician-qualification routing | S4 | **Owner decision 2026-08-16**, same rationale as above |
| **Warranty claims and manufacturer reimbursement** — claim submission, reimbursement status, labor-allowance caps, OEM-claimable vs customer-billable line splitting | S4 | **Owner decision 2026-08-16: not a claims subsystem.** Warranty is wanted only as a *recognized audit fact during the process* — see EXT-14 |
| Project / construction management — RFIs, submittals, change orders, phase scheduling, punch lists | S3 | **Owner decision 2026-08-16: Taylor is not in the construction business.** It supplies equipment to end users and services equipment |
| Subcontractor-of-record tracking, GC-relationship documentation | S3 | **Owner decision 2026-08-16: Taylor does not subcontract to GCs.** Subcontractors appear only as *customers buying equipment for their own projects* — a customer segment, not a contracting relationship. That segment does create a real requirement: see **EXT-48** |

---

## 5. Owner questions — four answered 2026-08-16

**ANSWERED**

- **Q2 — refrigerant.** *"We are also not managing in this system refrigerant."* → former EXT-13 and
  EXT-15 moved to §4 non-goals.
- **Q3 — construction.** *"Taylor is not in the construction business and only provides equipment to end
  users or services the equipment."* → BuildOps project cluster is a non-goal.
- **Q4 — subcontractors.** *"The only connection to subcontractor is that they buy equipment for projects
  they run."* → subcontractor-of-record is a non-goal; the segment is a **customer type**, generating the
  new requirement **EXT-48**.
- **Q6 — counter sales.** *"Over the counter is a major business point and why I needed to work on an
  inventory system."* → EXT-22 is a primary line of business; §3d is now the priority cluster.
- **Warranty scoping (volunteered).** *"We are not handling true warranty scaffolding. I only want it to be
  a recognized audit during the process."* → EXT-14 rescoped to recognition-and-audit; the claims subsystem
  is a non-goal.

**STILL OPEN**

1. **Is Field Ops ever the book of record financially, or does it hand off to an accounting package?**
   Reclassifies roughly a third of the ERP catalog — GL, chart of accounts, posting groups, bank
   reconciliation, budgets, fixed assets, deferrals — as either a large unbuilt domain or a deliberate
   integration boundary. Also decides EXT-26 (inventory valuation). **This question got heavier, not
   lighter:** a major counter-sales channel means cash tender, taxable sales, and cost of goods sold at the
   point of sale, all of which need somewhere to land. `Financials` is currently a hidden `future: true`
   nav placeholder with nothing behind it.
5. **Are core / exchange charges real in your parts lines** (EXT-27), particularly compressors?

**Raised by the answers, then closed**

- ~~Q7 — does trade-channel equipment enter the installed base?~~ **Closed with EXT-48.** Custody and
  disposition are inventory-control concerns already modelled; there is no separate question here.

**Still open from the answers**

- **Q8 — is counter sale walk-in only, or also phone-and-collect / charge-to-account?** Determines whether
  credit terms (EXT-08, already designed) and delivery (EXT-30) belong in the first slice of §3d, or
  whether the first slice is purely cash-and-carry.

---

## 6. Recommended next actions

Nothing here is authorized.

Reordered after the 2026-08-16 Owner scoping.

1. **Assess §3d (parts distribution) as one cluster — this is now the head of the list.** Counter sale is a
   major line of business and the least-modelled area of the platform. The cluster has a natural spine:
   **EXT-22 (the sale object)** → pricing (already designed elsewhere) → **EXT-25 tax certificates** →
   **EXT-23 quote** → **EXT-48 ship-to / trade equipment sale** → **EXT-30 freight**. Sequencing it as one
   assessment is the difference between a coherent channel and six disconnected features.
2. **Answer the two remaining §5 questions**, particularly the financial-scope one — a cash-and-carry
   channel makes it materially more pressing than it was this morning.
3. **Promote EXT-16 (entitlements / SLA / business hours) to the register** at `IDENTIFIED`. The
   operational core that register #1, #2 and #9 each circle without naming; left implicit across three
   rows it gets built three incompatible ways.
4. **Promote EXT-14 (warranty recognition as audit fact)** at `IDENTIFIED`, scoped as the Owner defined
   it — recognition and audit only, explicitly not claims. Recording the boundary is the point.
5. **Assess Tier 5 (CRM) as a cluster** with its dependency order intact: EXT-42 activity → EXT-43 reason
   codes → EXT-44 forecasting.
6. **Record §4 as explicit non-goals** in whatever artifact the repo prefers. Five of the nine are now
   Owner decisions rather than inferences, which is precisely the value — they should not resurface.
7. **Correct the stale internal claim** that Cycle Counts is a backend-less stub (EXT-03).

## 7. Method notes for sweep 2

**Worked:** pointing scouts at *domain practice* (S4, S5) rather than only at products — S4 produced the
highest-value findings and none would appear in any feature list. Capped output per scout, self-flagging
against a stated inventory of what exists, and an explicit instruction not to recommend or rank: the
enumeration is delegable, the judgment is not.

**Fix next time:** (a) exclude the artifact under verification from the verification scouts' reading — see
§1b; (b) check the repo's existing ID schemes before assigning new ones; (c) verify *before* reporting
findings, not after — the first pass over-reported the distribution cluster substantially.

**The characteristic failure mode of an outward sweep — imported structure.** External sources supply both
*capabilities* and *the architecture those vendors chose to deliver them with*, and the second travels
along unnoticed. Two instances in this sweep:

- **EXT-48 (withdrawn).** Distribution ERPs model "deliver somewhere other than the buyer" as bill-to/ship-to
  on an order, so that shape was proposed here — where the same reality is already handled as inventory
  movement against an ordinary customer.
- **EXT-14 (closed).** Salesforce and BuildOps model warranty as entitlement plus claims, so warranty was
  read as a missing subsystem — where what is wanted is a classification on the service performed, which
  already exists.

Both were *capability* matches and *structure* mismatches. The corrective is to state the finding as a
business outcome the business needs ("a contractor takes a machine away and we still know where it went")
before naming any mechanism, and to ask how Taylor handles that outcome today before concluding it cannot.
A sweep is a source of questions about our model, not of answers about it.

**Candidate sources for sweep 2:** CFESA and foodservice-equipment dealer material; HARDI distribution
benchmarking; a direct read of ServiceTitan's commercial food equipment configuration; and — highest value
and currently uncaptured — **the questions Taylor's own staff and customers actually ask**.
