# EOS Dashboard Reporting Authority Census

**Status:** CENSUS AND RECONCILIATION — analysis only. No dashboard was built, no authority was
created, no capability activated, no calculation defined, no role or scope widened. Recorded
2026-09-02 against repository commit `d65bbf01`.

**Grain.** The unit of this census is a **dashboard fact family** — "on hand", "past due work",
"AR outstanding" — not an individual field. A family is classified once; where one family splits
across two authorities with different states (a booked figure vs a billed figure), it is recorded
as two rows.

**Governing rule.** A dashboard COMPOSES existing authority. It does not invent authority. Where
authority does not exist the correct dashboard result is **UNAVAILABLE / AUTHORITY REQUIRED**, not
a fabricated value. This document establishes no authority of its own; every REPORTABLE row points
at an authority that already exists somewhere else in the repository.

**Environment is part of the answer.** Many capabilities are registered `active: false` in
`functions/src/access/permissionCatalog.ts` and lifted for `platform-sandbox` only by
`config/environments.json` → `capabilityActivationOverrides` (mirrored in
`functions/src/access/environmentCapabilityOverrides.ts`). Production is triple-blocked. Where a row
says ACTIVATION_REQUIRED and notes "sandbox-active", it means the surface can be exercised in
sandbox today and is DENIED in production by design.

> ## ⚠ CORRECTION — 2026-09-02, after this census was merged
>
> **This document's headline finding was WRONG, and the error was in the measurement.**
>
> §1 result 1, §9 decision 1 and §11 correction C-2 claimed that **no Role carries any
> `finance.visibility.*` capability**, and that fourteen fact families were therefore blocked
> behind a missing grant. Re-measured against `fd40ff5d` by resolver rather than by text search:
> **`admin` and `owner` carry all five scopes.** In sandbox, where
> `finance.visibility.consolidated` is activated, their reach is exactly CONSOLIDATED — so
> sandbox Financials resolves reach today and the 2026-09-01 activation achieved what it was for.
>
> **The cause:** admin's permissions are DERIVED — `ADMIN_CURATED_PERMISSIONS` plus every id in
> `PERMISSION_CATALOG` (an Owner ruling, 2026-08-19). The five ids are real grants that appear
> **nowhere as literals** in any Role source, so the grep this census relied on returned nothing
> and looked like proof of absence. A green test (`financialVisibilitySandboxActivation.test.mjs`)
> already asserted the opposite; this census contradicted it without running it.
>
> **What survives the correction:** the eleven Roles that hold `finance.read` with no scope do
> reach nothing — that is the FIN-004 invariant working, not a defect — so every financial row
> below remains correct for every principal except admin and owner. The rows are reclassified
> from BLOCKED_BY_DEPENDENCY to activation-class **for admin/owner in sandbox only**; §3 keeps its
> original classification because it is stated for the general principal, and the exception is
> named in each row's Dependency cell.
>
> Full re-measurement, the measured Role/scope matrix, the five deterministic proofs, and the one
> genuinely open Owner decision (Finance Manager holds no finance capability at all):
> **`fin004-reach-reconciliation.md`**.

**CI posture.** This is a documentation artifact. Its deterministic validator
(`scripts/dashboardCensus.test.mjs`) is runnable with `node --test` but is deliberately NOT added to
any workflow: repository governance does not require CI for a documentation-only output, and adding
a workflow would be CI infrastructure minted for one document.

---

## 1. Executive result

```
REPORTABLE_NOW:                       45
EXISTING_ACTIVATION_REQUIRED:         27
FORMALIZATION_REQUIRED:                9
DEFINITION_GAP:                        8
AUTHORITY_GAP:                        14
BLOCKED_BY_DEPENDENCY:                19
NOT_REPORTABLE:                       10
UNKNOWN:                               0
                                    ----
TOTAL FACT FAMILIES:                 132
```

These totals are not typed by hand: they are computed from §3 by `scripts/dashboardCensus.lib.mjs`
and asserted against this block by the validator, so a row added to §3 without updating this count
fails the check.

**The three results that matter most.**

1. ~~**The single largest blocker in the repository is not a missing authority — it is a missing
   grant.**~~ **WITHDRAWN 2026-09-02 — see the correction box above.** This result claimed no Role
   carried any `finance.visibility.*` capability. It was measured by text search over the Role
   source files, which cannot see admin's derived grants. `admin` and `owner` carry all five
   scopes; sandbox reach is CONSOLIDATED and real.

   **What the corrected result says.** FIN-004 requires TWO facts for any financial read: the
   fact-family gate (`finance.read`) AND a reach scope (`finance.visibility.*`). Thirteen Roles
   carry `finance.read`; **exactly two — `admin` and `owner` — carry any scope.** So the fourteen
   financial fact families below are ACTIVATION-CLASS for admin/owner in sandbox, and genuinely
   unreachable for the other eleven finance-gate Roles, which is a scope-grant decision rather
   than a defect. The remaining open question is narrower and different: **which non-admin Role
   should carry which scope** — F14 §2 still records "carrying role TBD" for every persona in its
   grant table. Evidence and matrix: `fin004-reach-reconciliation.md`.

2. **Inventory commitment and ATP are not authority gaps.** Both were ratified by the Owner
   (2026-08-07, amended 2026-08-17) and are implemented, pure, and tested in
   `functions/src/fulfillment/fulfillmentAvailability.ts`; the batch read that the Parts workspace
   needed (`getPartBalances`) exists. What stands between them and a dashboard is a client transport
   flag (`INVENTORY_BALANCE_READ_READY: false`) — bounded activation, not a business decision.

3. **The largest genuinely-open authority cluster is COST.** Inventory value, inventory turns,
   carrying cost, gross margin, cost-to-budget and any margin-bearing performance figure all
   terminate at FIN-BLOCK-003, where no governed cost fact exists anywhere in the repository. Until
   the Owner rules the cost supply, `deriveGrossMargin` truthfully returns UNKNOWN on every real
   invocation, and that is the correct dashboard answer.

---

## 2. Known 17-authority reconciliation

| ID | Authority | Current classification | Evidence | Dependency | Dashboard capability unlocked | Required next action |
|---|---|---|---|---|---|---|
| K-1 | Inventory Commitment / Reservation | **CLOSED — ACTIVATION ONLY** | `functions/src/fulfillment/fulfillmentAvailability.ts` `openWorkOrderReserved` (RESERVED − RELEASED − CONSUMED over `inventory_transactions`); Owner-ratified 2026-08-07, ledger amendment 2026-08-17. Commitment is the WO lifecycle effect (DISPATCHED → `reserveParts`). Decision #116 pins that a PICK reserves nothing | none | Reserved / committed quantity per part and per location | Flip `INVENTORY_BALANCE_READ_READY` for the target environment and confirm `getPartBalance`/`getPartBalances` are deployed |
| K-2 | Available-to-Promise (ATP) | **CLOSED — ACTIVATION ONLY** | Same file: "Parts AVAILABLE_TO_PROMISE = eligible ON_HAND (ACTIVE warehouses) − open WO reservations − other active Sales Order allocations. Never below 0. UNKNOWN stays UNKNOWN". Composed by `functions/src/inventory/partBalanceReadService.ts` | K-1, K-13 | Available / ATP per part; allocation feasibility | Same as K-1. Serialized equipment ATP stays UNKNOWN-fail-closed by ratified design — do not "fix" it |
| K-3 | FIN-003 Sales Goal | **PARTIALLY ESTABLISHED — genuinely open** | `functions/src/finance/planVsActual.ts` is the measurement core (versioned GOAL, explicit basis, APPROVED-only). `docs/financials/FIN-003_PLAN_VS_ACTUAL_MODEL.md` §2 defers plan STORAGE, capability ids, and approval authority | FIN-007 policy values; K-11 | Sales-to-Goal %, pace/day, salesperson target progress | Owner: plan storage shape + who approves a plan version (FIN-007 §2 values) |
| K-4 | Billing Reporting / Read Activation | **ACTIVATION + BLOCKED** | `functions/src/finance/billingQueue.ts` (F4) derives unbilled-eligible = `max(0, min(ordered, fulfilled) − billed)`, no amounts, test-asserted. `financialReportingRead.ts` `listFinancialFacts` serves INVOICE/PAYMENT/PAYMENT_APPLICATION only | FIN-004 reach (see §9 #1); service work absent — FIN-BLOCK-002 | Billing queue; billed KPI/trend | Grant a `finance.visibility.*` scope to a carrying Role; Owner ruling on service billing (FIN-BLOCK-002) for service work to enter the queue at all |
| K-5 | FIN-005 Forecast / Projection | **PARTIALLY ESTABLISHED — genuinely open** | `functions/src/finance/forecasting.ts` — as-of-stamped record, supersession, never-blend comparison. `FIN-005_FORECAST_MODEL.md` §2: methodology/cadence is Owner process policy; storage absent; Opportunity `expectedValue` is currency-less and flows nowhere | K-3 accumulator; K-11 | Forecast vs actual; projection tiles | Owner: forecast methodology + cadence + whether pipeline ever feeds a derived forecast |
| K-6 | Reorder Point | **CLOSED — NOT ESTABLISHED (a decided negative)** | ND-29, Owner ruling 2026-08-30: a reorder point must not be presented as operationally meaningful when the same state says "Insufficient usage history". Proven by arithmetic: `reorderPoint === 0 ⟺ totalConsumed === 0 ⟺ hasUsageHistory === false`. Metadata register: `PART_REORDER_POINT_IS_DERIVED` — "calculated from usage, NOT stored on the Part". Shipped: `partReorderPointDisplay` in `field-ops-app-vite/src/domain/partsNorthStar.js`; proof `test/partsReorderPointSemantics.test.jsx` | none | Reorder point may render ONLY as the derived figure with its derivation named, or as "Not established" | None for a dashboard. A STORED governed reorder point is a separate future Owner decision; do not invent a reorder calculation |
| K-7 | FIN-006 Inventory Cost / Valuation | **GENUINELY OPEN (FIN-BLOCK-003)** | `functions/src/finance/costMargin.ts` `deriveGrossMargin` is implemented; the cost-fact SUPPLY does not exist. `FIN-006_COST_MARGIN_MODEL.md` §2 lists four undecided items. ND-27 (Owner, 2026-08-30): the legacy static cost may NOT be displayed; `part.js` blocks `unitCost` `displayable`/`reportable`/`exportable` together | ND-27 `PART_INVENTORY_VALUATION_AUTHORITY_GAP` | Inventory value, margin, turns-by-value, carrying cost, cost-to-budget | Owner: costing method/basis vocabulary, capture point, labor cost treatment, valuation authority |
| K-8 | Inventory Aging | **AUTHORITY GAP** | Repository-wide search for aging/turnover/carrying-cost/inventory-value logic in `functions/src` and `field-ops-app-vite/src` returns nothing. The append-only `inventory_transactions` ledger carries the movement timestamps such a metric would consume | K-7 for any value-weighted aging | Aging buckets; no-movement lists | Owner: aging thresholds and the movement event that starts the clock |
| K-9 | Sales Booking | **CLOSED — ACTIVATION (read wiring) ONLY** | FIN-002 `bookedAtMillis` = agreement acceptance, ctx-supplied only, frozen in `buildFinancialAttributionSnapshot`; F13 records Booked as SUPPORTED (dormant). DECISIONS #154 | FIN-004 reach | Booked KPI and trend; booked-basis AOV numerator | `listFinancialFacts` serves persisted fact types only and excludes booked BY CONSTRUCTION (test-guarded) — a bounded read addition, plus a FIN-004 scope grant |
| K-10 | Average Order Value | **DEFINITION GAP** | No AOV definition exists in the repository. Every component it needs is basis-sensitive, and invariant A forbids blending bases | K-9 or K-4 for the numerator; K-11 for the window | AOV tile and trend | Owner: numerator basis, order population, exclusions (voids, credits, intercompany) |
| K-11 | Reporting Period / Time | **PARTIALLY ESTABLISHED — DEFINITION GAP for period-relative figures** | Every financial event carries a server event time (`bookedAtMillis`/`eventAtMillis`/`recordedAtMillis`); FIN-008 `financialPeriods.ts` gives per-company OPEN/CLOSED frozen periods. **No MTD/QTD/YTD, fiscal-calendar, or reporting-timezone definition exists anywhere** (repo-wide search returns zero hits). The only IANA timezone authority in the repo is `functions/src/scheduling/` — technician working hours, a different authority | none | Any period-relative KPI, prior-period delta, or pacing figure | Owner: reporting calendar (fiscal vs civil), reporting timezone, partial-period rule, prior-period comparison rule |
| K-12 | Company / Business-Unit Attribution | **CLOSED for financial events; AUTHORITY GAP for operational records** | FIN-002: every reportable financial event carries a REQUIRED `operatingCompanyId`; `BUSINESS_UNITS` = SERVICE/EQUIPMENT_SALES/PARTS/INSTALLATION, line-level, invoice headers deliberately null. Governed company ids `taylor`/`ventana` (`ownership/operatingCompanyAuthority.ts`, D-2). **But** DECISIONS #143: the 30 unresolved sandbox Work Orders are `NO_GOVERNED_COMPANY_SOURCE`, and the ownership model is inert — no writer stamps it | FIN-BLOCK-004 for the Consolidated column | Company mix on financial facts; per-company rollups (`summarizeByCompany`) | Financial: nothing. Operational (WO/job company mix): Owner ruling on company provenance for records with no governed upstream |
| K-13 | Inventory Location | **CLOSED** | `warehouses.status === ACTIVE` is the governed eligibility authority (`warehouseGovernance/governedWarehouseValidation.ts`, R-18); Decision #116: a bin is DESCRIPTIVE, not custody — the warehouse owns the stock; MOBILE/truck stock is deliberately excluded from warehouse on-hand | none | Per-location on-hand breakdown; receiving location options; warehouse scope | None. Note the deliberate exclusion: van stock is invisible to `partBalance` by design; the mobile-location presence probe is its authority |
| K-14 | Stockout Definition | **NOT ESTABLISHED — derived information only** | `inventoryAnalyticsService.ts` produces `StockoutPrediction` (daysRemaining, riskLevel, estimatedStockoutDate) as a deterministic forecast over ledger history, explicitly "NOT an inventory control system". ND-28 Owner ruling: derived informational facts are permitted when clearly identified; they may not be promoted into the identity layer or renamed as governed stock truth | K-1/K-2 for a governed available-based definition | A "stockout risk" panel labelled as derived; NOT a governed stockout count | Owner (only if a governed stockout STATE is wanted): the threshold and the quantity basis |
| K-15 | Inventory Turns | **AUTHORITY GAP, DEPENDENCY-BLOCKED** | No turns implementation exists. Turns require a cost or value basis and a period | K-7 (cost), K-11 (period) | Turns; days-of-inventory | Blocked. Do not attempt before FIN-BLOCK-003 and the reporting-period ruling |
| K-16 | Pipeline Reporting | **PARTIALLY ESTABLISHED** | Stage is governed (`functions/src/opportunity/opportunityLifecycle.ts`); the read is `listOpportunityContext`/`listOpportunitiesForAccount` (`opportunity.read`, sandbox-active); "My opportunities" is viewer-scoped via the viewer's employee id and renders NO COUNT rather than a false `0` when the link is missing (migration ledger, Family 4b). **Value-bearing pipeline is not established**: `expectedValue` is a currency-less forecast number that flows nowhere (FIN-001 §1.6), and no probability/weighting model exists | K-5 for any derived forecast | Stage counts, my-pipeline lists, stage-transition queues | Countable pipeline: nothing beyond activation. Value-weighted pipeline: Owner must close the `expectedValue` currency gap first |
| K-17 | Dashboard Read / Scope | **FORMALIZATION REQUIRED — and the precedent already exists** | `field-ops-app-vite/src/navigation/LandingPage.jsx` is the shipped precedent: it computes the signed-in principal's REAL reachable destination set using the SAME `isDomainVisible`/`isNavItemVisible` functions the nav rail uses — "No metric, no count — a destination is either genuinely reachable right now, or it is not listed." No dashboard-specific read authority exists, and none should be created | every fact family it composes | Any personalized dashboard | Record the rule rather than build a layer: a dashboard composes each domain's own read authority at its own scope; it never becomes a second permission layer. See §7 F-01 |

**Reconciliation summary:** CLOSED/REPORTABLE 4 (K-1, K-2, K-6, K-13) · ACTIVATION ONLY 3 (K-4 read half, K-9, K-16 count half) · FORMALIZATION ONLY 1 (K-17) · GENUINELY OPEN 6 (K-3, K-5, K-7, K-8, K-10, K-11) · DEPENDENCY BLOCKED 3 (K-12 operational half, K-14, K-15).

---

## 3. Full fact census

Legend for **Classification**: `NOW` = REPORTABLE_NOW · `ACT` = REPORTABLE_EXISTING_ACTIVATION_REQUIRED · `FORM` = FORMALIZATION_REQUIRED · `DEF` = DEFINITION_GAP · `AUTH` = AUTHORITY_GAP · `DEP` = BLOCKED_BY_DEPENDENCY · `NO` = NOT_REPORTABLE.

Scope values use the repository's own vocabulary where one exists (`{type:"global"}`, `{type:"location", value:<warehouseId>}`, `{type:"operatingCompany"|"businessUnit"}` per DECISIONS #157; SELF/TEAM/BUSINESS_UNIT/OPERATING_COMPANY/CONSOLIDATED per FIN-004). Where no governed scope name exists the census names the actual binding (e.g. `users/{uid}.technicianId`).

### 3.1 Customer / CRM

| # | Dashboard fact / action | Definition | Cls | Canonical source | Read authority | Scope | Eligible roles | Time basis | Dependency | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| C-1 | Account portfolio counts (total / active / prospect / inactive / archived / unclassified) | Complete server-side `count()` over the authorized scope; never a page, never a sample; unknown status values surface as `unclassified` rather than vanishing | NOW | `accounts` | `getAccountPortfolioSummary` | `customer.record.read`, global | Roles carrying `customer.record.read` | none (point-in-time) | — | `functions/src/account/accountPortfolioSummary.ts:1-60` |
| C-2 | Account record identity + status | Canonical uppercase status enum ACTIVE/PROSPECT/INACTIVE/ARCHIVED | NOW | `accounts` | `customer.record.read` | global | as C-1 | none | — | `accountPortfolioSummary.ts` `ACCOUNT_STATUS_VALUES` |
| C-3 | Account attention — WO past due | Composes `workOrderPastDueItem()` over this account's SCHEDULED work orders; never re-implements the predicate | NOW | `fieldops_wos` | account-scoped WO fetch | own account records | admin, dispatcher | `scheduledStart` vs now | — | `field-ops-app-vite/src/domain/accountAttentionProjection.js:1-20` |
| C-4 | Account attention — AR overdue | Reads `accountArView().rows[i].position === "OVERDUE"`; never recomputes an AR position or outstanding balance | DEP | `invoices` + `invoice_adjustments` | `listAccountInvoiceAr` | FIN-004 reach | admin, owner (CONSOLIDATED, sandbox only) | invoice due date | FIN-004 reach — admin/owner only; see fin004-reach-reconciliation.md | `accountAttentionProjection.js:11-15`; `functions/src/finance/financialVisibility.ts` |
| C-5 | Contacts / locations per account | Sub-records of an Account | FORM | `contacts`, `locations` | Account Detail client reads | own account | admin, dispatcher | none | — | `navConfig.js` (global Contacts/Locations subnav retired — they belong to an Account); no aggregate read authority exists for a dashboard-scale count |
| C-6 | CRM activity feed (notes / activities) | Governed CRM activity records | ACT | `crm_activities` | `getCrmActivities` (`crm.activity.read`) | global | admin, owner, dispatcher (via `crmActivityContributor`) | record timestamp | catalog `active:false` — sandbox-active | `permissionCatalog.ts`; `environments.json` overrides; `compatibilityRoles.ts:187-188` |
| C-7 | Customer ownership (account owner) | `accountOwner` / `ownerEmployeeId` are the authoritative STORAGE; `typedOwner.ts` is a derived read projection with **no setter** | NOW | `accounts` | `customer.record.read` | global | as C-1 | none | typed-owner model is inert (D-1) | SYSTEM_AUTHORITIES "EOS Ownership Model v1 — typed owner" |
| C-8 | Customer financial position (AR balance, aging) | Outstanding = total − applied − credits + charges − write-offs; a transactionally-maintained projection, NOT an independent accounting authority | DEP | `invoices` | `listAccountInvoiceAr` | FIN-004 reach | admin, owner (CONSOLIDATED, sandbox only) | invoice due date | FIN-004 scope grant for any non-admin Role | SYSTEM_AUTHORITIES "Finance — trusted AR read"; F12 `customer-financials` |
| C-9 | This account's equipment | The account-scoped view of the register (distinct from E-1, the whole register). `CustomerEquipment.jsx` filters client-side over already-loaded docs | NOW | equipment register | Account Detail equipment reads | own account | admin, dispatcher | none | — | `modules/equipment/CustomerEquipment.jsx`; the client-side-filter shape is noted in `accountAttentionProjection.js`'s audited omissions |
| C-10 | Customer since / account lifecycle stage | — | AUTH | — | — | — | — | — | — | **ND-11: "An Account has no lifecycle to make visible"** — the page says so out loud rather than inventing one |

### 3.2 Sales

| # | Dashboard fact / action | Definition | Cls | Canonical source | Read authority | Scope | Eligible roles | Time basis | Dependency | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| S-1 | Opportunity list / stage counts | Governed stage state machine | ACT | `opportunities` (deny-all to clients) | `listOpportunityContext` (`opportunity.read`) | caller's whole authorized scope — **no accountId parameter exists** | admin, dispatcher, roles carrying `opportunity.read` | none | catalog `active:false` — sandbox-active | `functions/src/opportunity/opportunityReadService.ts`; SYSTEM_AUTHORITIES "Sales Opportunity lifecycle" |
| S-2 | "My opportunities" | Viewer-scoped by the viewer's linked employee id; renders **no count** rather than `0` when the link is missing | ACT | as S-1 | as S-1, filtered on the viewer's employee id | viewer's own opportunities | as S-1 | none | as S-1 | `docs/design/north-star-migration-ledger.md:784-793` |
| S-3 | Opportunity attention | Pre-commitment attention derivation | ACT | `opportunities` | `deriveAttention` in `domain/opportunityLifecycle.js` | as S-1 | as S-1 | none | as S-1 | `field-ops-app-vite/src/domain/obligationAttention.js:5-7` (names it as the pre-commitment counterpart) |
| S-4 | Pipeline VALUE / weighted pipeline | — | DEF | — | — | — | — | — | K-5 | FIN-001 §1.6 / FIN-005 §2: `expectedValue` is a **currency-less** forecast-flavoured number that **flows nowhere**; no probability or weighting model exists |
| S-5 | Stale opportunities / missing next step | — | AUTH | — | — | — | — | — | — | No next-step, follow-up, or last-touched record exists. ND-12 was WITHDRAWN — the design did not ask for stage times; an Opportunity records **no stage times except the close** |
| S-6 | Sales Agreements awaiting acceptance | DRAFT agreements; both terminal states irreversible | ACT | `sales_agreements` (deny-all) | `getSalesAgreementContext` (`salesAgreement.read`) | global | roles carrying `salesAgreement.read` | none | catalog `active:false` — sandbox-active | SYSTEM_AUTHORITIES "Commercial commitment — Sales Agreement". **ND-14: `DECLINED` is modelled but nothing can produce it** — a "declined" tile would always read 0 |
| S-7 | Sales Orders index / open orders | Committed commercial order following a WON Opportunity | ACT | `sales_orders` (deny-all) | `listSalesOrderIndex` (`salesOrder.read`) | global | roles carrying `salesOrder.read` | none | catalog `active:false` — sandbox-active | SYSTEM_AUTHORITIES "Sales Order lifecycle" |
| S-8 | Sales Order lifecycle stage times | — | AUTH | — | — | — | — | — | — | **ND-8: "A Sales Order records no lifecycle stage times"** |
| S-9 | Booked sales ($) | BOOKED basis = FIN-002 `bookedAtMillis`, stamped at agreement acceptance, ctx-supplied only, frozen | ACT | agreement acceptance snapshot | **none — read wiring missing** | FIN-004 reach | admin, owner (CONSOLIDATED, sandbox only) | `bookedAtMillis` | FIN-004 scope grant for any non-admin Role; K-11 for any period figure | F13 "Booked · SUPPORTED (dormant)"; `financialReportingRead.ts` serves persisted fact types only, booked excluded by construction (test-guarded) |
| S-10 | Billed sales ($) | Issued invoices, server-recomputed amounts | DEP | `invoices` | `listFinancialFacts` | FIN-004 reach | admin, owner (CONSOLIDATED, sandbox only) | invoice event time | FIN-004 scope grant for any non-admin Role | SYSTEM_AUTHORITIES "Finance — governed reporting read"; F13 |
| S-11 | Collected ($) | Payment applications, F3-attributed | DEP | `payments`, `payment_applications` | `listFinancialFacts` | FIN-004 reach | admin, owner (CONSOLIDATED, sandbox only) | `recordedAtMillis` | FIN-004 scope grant for any non-admin Role | F13 |
| S-12 | Average Order Value | — | DEF | — | — | — | — | — | K-9/K-4, K-11 | No AOV definition exists. Invariant A forbids blending bases, so the numerator basis is a required decision |
| S-13 | Salesperson attribution / sales credit | `creditedSalespersonId` frozen at event time; **never the acting user**; OWNERSHIP ≠ SALES CREDIT; exposed verbatim, never re-derived | DEP | FIN-002 snapshot on the financial event | `listFinancialFacts` | FIN-004 SELF/TEAM | admin, owner (CONSOLIDATED, sandbox only) | event time | FIN-004 scope grant for any non-admin Role | SYSTEM_AUTHORITIES "Finance — reporting attribution" (DECISIONS #154) |
| S-14 | Sales goal % / pace / target progress | — | DEP | `planVsActual.ts` core exists; plan RECORDS have no storage | — | FIN-002 dimensions | — | plan period (inclusive ISO) | **plan storage + FIN-007 approval authority** | FIN-003 §2 |
| S-15 | Forecast / projection | — | DEP | `forecasting.ts` core exists; forecast records have no storage | — | FIN-002 dimensions | — | `asOfMillis` | **forecast storage + methodology (Owner policy)** | FIN-005 §2 |
| S-16 | Top customers by revenue | — | DEP | `invoices` | `listFinancialFacts` (customerId grain) | FIN-004 reach | admin, owner (CONSOLIDATED, sandbox only) | event time | FIN-004 scope grant for any non-admin Role; K-11 for a window | F12 `customer-financials` |
| S-17 | Company / business-unit revenue mix | Per-company rollups are exact; **Consolidated is typed `UNELIMINATED_SUM`** and must render with that caveat | DEP | FIN-002 dimensions | `summarizeByCompany` | OPERATING_COMPANY / CONSOLIDATED | admin, owner (CONSOLIDATED, sandbox only) | event time | FIN-004 scope grant for any non-admin Role; FIN-BLOCK-004 for elimination | SYSTEM_AUTHORITIES "Finance — allocation & consolidation (FIN-009)"; F13 |
| S-18 | Orders requiring action (fulfillment exceptions) | BLOCKED / WAITING_ON_MATERIAL / PARTIAL / REMAINING_WORK / UNKNOWN — **does not invent SLA, risk score, customer promise, severity, or ETA** | ACT | `sales_orders` + coordinated visit projection | `listCoordinatedOperations` (`fulfillment.coordinatedVisit.read`) | global | roles carrying the capability | none | catalog `active:false` — sandbox-active | `field-ops-app-vite/src/domain/obligationAttention.js:1-19` |

### 3.3 Service

| # | Dashboard fact / action | Definition | Cls | Canonical source | Read authority | Scope | Eligible roles | Time basis | Dependency | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| SV-1 | Open Work Order counts by status | The real 11-value `WorkOrderStatus`; never the legacy derived `WORK_ORDER_STATE` enum | NOW | `fieldops_wos.status` | `subscribeToWorkOrders` / `operationsQueries.ts` | `firestore.rules` admin/dispatcher | admin, dispatcher | none | — | SYSTEM_AUTHORITIES "Work Order reads"; `domain/constants.js:380-395` |
| SV-2 | Unassigned / ready-to-dispatch queue | `SCHEDULABLE_STATUS` — the one status from which Schedule is a valid transition, derived from the transition table | NOW | `fieldops_wos` | as SV-1 | as SV-1 | admin, dispatcher | none | — | `domain/workOrderAttentionProjection.js:10-11` |
| SV-3 | Scheduled work (today / week) | `scheduledStart` is the ONLY date authority and exists only once scheduled — **a due date for unscheduled work would be a fabrication and is explicitly refused** | NOW | scheduling projection on `fieldops_wos` | as SV-1 | as SV-1 | admin, dispatcher | `scheduledStart` | — | `workOrderAttentionProjection.js:18-22` |
| SV-4 | Past due scheduled work | `workOrderPastDueItem()`, applied globally (not week-bound) | NOW | as SV-3 | as SV-1 | as SV-1 | admin, dispatcher | `scheduledStart` vs now | — | `workOrderAttentionProjection.js:12-14` |
| SV-5 | Scheduling conflicts / overlaps | `detectDayOverlaps()` — the same primitives the scheduling workspace uses | NOW | as SV-3 | as SV-1 | as SV-1 | admin, dispatcher | scheduled window | — | `workOrderAttentionProjection.js:12-14` |
| SV-6 | Blocked work — parts | `buildWorkOrderPartsReadiness()` OUTPUT, composed not re-derived | NOW | `fieldops_wos` + parts readiness | as SV-1 | as SV-1 | admin, dispatcher | none | — | `workOrderAttentionProjection.js:15-18` |
| SV-7 | Technician recorded working hours + blocked time | Recurring weekly wall-clock hours + IANA zone; dated one-off exceptions. **ABSENT IS NOT EMPTY** — no record renders "no working schedule recorded", never 0% booked | NOW | `technician_working_availability`, `technician_blocked_time` (both Admin-SDK-only, all client access denied) | `readTechnicianAvailability` | global | admin, dispatcher | IANA zone on the record | — | SYSTEM_AUTHORITIES "Technician availability authority (ND-22)" |
| SV-8 | Technician utilisation / % booked | — | FORM | `estimatedDurationMinutes` is OPTIONAL and **absent is the normal case and must never be read as zero** | — | — | — | — | SV-7's ABSENT-IS-NOT-EMPTY rule | ND-21. A utilisation percentage over optional estimates against possibly-unrecorded hours has no governed definition |
| SV-9 | Work Order aging (open, unscheduled) | — | FORM | `fieldops_wos` timestamps exist; an "age" display precedent exists | as SV-1 | as SV-1 | admin, dispatcher | creation timestamp | — | `WorkOrderQueue.jsx` age display, cited in `workOrderAttentionProjection.js` as an existing display-only category. **No governed aging threshold exists** — buckets would be invented |
| SV-10 | Completed today / completion counts | Real persisted `completedAt`, used purely for display grouping of an already-terminal status — **not** to infer lifecycle state | NOW | `fieldops_wos` | as SV-1 | as SV-1 | admin, dispatcher | `completedAt` (calendar day) | K-11 for any period beyond "today" | `TechnicianDashboard.jsx:28-33` |
| SV-11 | First-time fix rate | — | AUTH | — | — | — | — | — | — | No revisit, callback, or repeat-visit linkage exists in the model |
| SV-12 | Service response / SLA metrics | — | AUTH | — | — | — | — | — | — | `obligationAttention.js:17`: "It does NOT invent SLA, risk score, customer promise, severity, or ETA" |
| SV-13 | Callbacks | — | AUTH | — | — | — | — | — | — | No callback concept exists |
| SV-14 | Parts-delay impact on service | — | AUTH | — | — | — | — | — | K-7 | Requires a delay clock and a cost/impact basis; neither exists |
| SV-15 | Coordinated visits | Read projection exposing a Sales Order's fulfillment as one coordinated visit — **projection-only, assigns no work, holds no authority over WO or schedule state** | ACT | `fieldops_wos` sharing a `salesOrderId` | `listCoordinatedOperations` | global | roles carrying `fulfillment.coordinatedVisit.read` | none | catalog `active:false` — sandbox-active | SYSTEM_AUTHORITIES "Fulfillment — coordinated operations projections" |
| SV-16 | Unschedule / reschedule / reassign actions requiring a dispatcher | `Unschedule` IS a lifecycle transition (ND-18, `SCHEDULED` only, reason required); re-timing and reassignment are NOT and live in `schedulingCommands.ts` | NOW | `transitionEngine.ts` + `ACTION_ALLOWED_FROM` | `getAllowedActions()` | role-based admin/dispatcher | admin, dispatcher | none | — | SYSTEM_AUTHORITIES "Scheduling authority (ND-18 – ND-22)" |
| SV-17 | Stalled-job risk / dispatch ranking | Existing 4-tier severity panels | NOW | `jobRiskScoring.js` / `dispatchScoring.js` | client panels | as SV-1 | admin, dispatcher | none | — | `workOrderAttentionProjection.js:22-27` — deliberately NOT re-projected into the attention taxonomy, to avoid "same badge vocabulary, different meaning" |

### 3.4 Technician / Field

| # | Dashboard fact / action | Definition | Cls | Canonical source | Read authority | Scope | Eligible roles | Time basis | Dependency | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| T-1 | My assigned work orders | A separate, additional query (`where("assignedTechId","==",technicianId)`) — never a modification of the dispatcher-side read | NOW | `fieldops_wos` | `subscribeAssignedWorkOrders()` | `users/{uid}.technicianId` → `fieldops_technicians/{id}` | technician | none | — | SYSTEM_AUTHORITIES "Technician-scoped Work Order reads" (PT-002) |
| T-2 | My work buckets (ready to start / waiting / in progress / completed today) | Pure client-side grouping of the real 11-value status enum; no new backend concept | NOW | as T-1 | as T-1 | own assignment | technician | `completedAt` for the "today" bucket only | — | `TechnicianDashboard.jsx:26-42` |
| T-3 | Next job | — | FORM | `scheduledStart` exists | as T-1 | own assignment | technician | `scheduledStart` | — | No governed "next" ordering rule exists: which statuses qualify, and what a DISPATCHED job with no scheduled window ranks as, are undecided |
| T-4 | My performance snapshot (all-time) | Honest all-time totals | NOW | technician execution data | `getTechnicianExecutionStats` | own technician id | technician | **all-time only** | K-11 for any window | `PerformanceSnapshot.jsx:11-18` — "Shows the real, honest all-time total instead of fabricating a weekly figure this data can't actually support" |
| T-5 | My performance, period-windowed (this week / month) | — | DEF | — | — | — | — | — | K-11 | Same evidence as T-4: no per-transaction date breakdown is available to this read |
| T-6 | Actions I must take on a job | `getAllowedActions()` with `isOwnAssignment` hardcoded true (every WO reaching it already came from a technician-scoped query) | NOW | `workOrderWorkflow.js` | as T-1 | own assignment | technician | none | — | SYSTEM_AUTHORITIES "Technician-facing Work Order actions" |
| T-7 | Which scanning workflows I may use, and why not | `deriveScanWorkflows` is the single authority and is **CAPABILITY-derived — it never receives a persona and cannot branch on one**; the REASON for every unavailability comes from here | NOW | `access/scanWorkflows.js` | capability feed | per-capability | all, per capability | none | — | SYSTEM_AUTHORITIES "Which scanning workflows a person may use"; matrix pinned by `test/personaOperability.test.mjs` |
| T-8 | My scans / put-aways / returns | A put-away writes NO ledger event, changes NO quantity, touches NO balance (Decision #116) | ACT | `bin_placements`, `inventory_returns` | placement/returns reads | `inventory.placement.record` / `inventory.returns.intake` | `inventoryPutAwayOperator`, `inventoryReturnsIntakeClerk` | event time | catalog `active:false` — sandbox-active | SYSTEM_AUTHORITIES "Placement", "Returns intake" |
| T-9 | Unverified / queued offline submissions | UNVERIFIED is a first-class state, **never a spinner**; the queue stores a callable name + opaque payload and cannot merge, reorder or combine | NOW | `domain/offlineSubmissionQueue.js` (client-local) | `hooks/useSubmissionQueue.js` | own device | technician, warehouse handheld users | queue time | adopted by put-away ONLY, by design | SYSTEM_AUTHORITIES "Offline submission queue" |
| T-10 | My truck / van stock | Van stock is **deliberately invisible** to `partBalance` (WAREHOUSE movements only); the mobile-location presence probe is its authority | ACT | `inventory_transactions` at MOBILE locations | `mobileLocationPresenceProbe` | truck / mobile location | warehouse + technician roles | none | probe is a presence answer, not a quantity | SYSTEM_AUTHORITIES "Part balance projection"; `inventoryLedger/mobileLocationPresenceProbe.ts` |
| T-11 | Returns awaiting disposition | Single state `AWAITING_DISPOSITION` | ACT | `inventory_returns` | returns read | `inventory.returns.intake` | `inventoryReturnsIntakeClerk` | intake time | catalog `active:false` | SYSTEM_AUTHORITIES: **"Disposition is a separate authority that does not exist"** (Decision #118) — a disposition ACTION queue is AUTH, see W-8 |

### 3.5 Inventory

| # | Dashboard fact / action | Definition | Cls | Canonical source | Read authority | Scope | Eligible roles | Time basis | Dependency | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| I-1 | On hand (governed) | `sumLedgerEligibleOnHand` — physical on-hand at ACTIVE warehouses from the append-only ledger. **UNKNOWN is a value and is never coerced to 0**; SERIAL-tracked parts report `NOT_COUNTED_BY_QUANTITY` | ACT | `inventory_transactions` | `getPartBalance` / `getPartBalances` (`inventory.balance.read`) | global read; per-location breakdown from one eligible set | ~10 roles carry `inventory.balance.read` | none (point-in-time) | catalog `active:false` — **sandbox-active**; client transport flag `INVENTORY_BALANCE_READ_READY: false` | `functions/src/inventory/partBalanceReadService.ts:1-34`; `config/environments.json` |
| I-2 | Reserved / committed | `openWorkOrderReserved` = RESERVED − RELEASED − CONSUMED. Commitment is the WO lifecycle effect; **a pick reserves nothing** | ACT | as I-1 | as I-1 | as I-1 | as I-1 | none | as I-1 | `fulfillmentAvailability.ts`; Decision #116 |
| I-3 | Available / ATP | eligible ON_HAND − open WO reservations − other active Sales Order allocations; never below 0; **UNKNOWN is infectious** — an unknown on-hand yields an unknown available, never a confident subtraction | ACT | as I-1 | as I-1 | as I-1 | as I-1 | none | as I-1 | `fulfillmentAvailability.ts:11-14`; `partBalanceReadService.ts` |
| I-4 | Per-location on-hand breakdown | Derived from the SAME eligible set as the total, so a breakdown can never disagree with its own total | ACT | as I-1 | as I-1 | per-warehouse | as I-1 | none | as I-1 | SYSTEM_AUTHORITIES "Part balance projection" |
| I-5 | Ledger-derived stock forecast (avg daily usage, days remaining) | **Derived INFORMATION, explicitly not a governed stock position.** Owner ruling ND-28: "Stock forecast may compose clearly identified derived information" | NOW | `inventory_transactions` | `inventoryAnalyticsEngine` (client mirror of `inventoryAnalyticsService.ts`) | admin/dispatcher Rules scope | admin, dispatcher, parts roles on their surfaces | rolling consumption window | — | ND-28 Owner ruling 2026-08-30. **Refused: calling it On hand, calling it Available, promoting it into a record header or a workspace principal quantity column** |
| I-6 | Reorder point | May render only as the derived figure with its derivation named, or as "Not established" | NO (as a governed number) | derived only — **there is no stored reorder point anywhere** | `partReorderPointDisplay` | as I-5 | as I-5 | usage window | — | ND-29 Owner ruling; `PART_REORDER_POINT_IS_DERIVED`; proof `test/partsReorderPointSemantics.test.jsx` |
| I-7 | Stockout risk / prediction | Deterministic forecast over ledger history; `NEEDS_PLANNING` means "the engine had nothing to compute", **not** "risk is low" | NOW (as derived information) | `inventoryAnalyticsService.ts` `StockoutPrediction` | as I-5 | as I-5 | as I-5 | usage window | — | `functions/src/inventoryAnalyticsService.ts:1-10, 45-60` |
| I-8 | Governed stockout STATE / count | — | DEF | — | — | — | — | — | K-1/K-2 | No stockout definition authority exists — threshold and quantity basis are both undecided |
| I-9 | Movement counts (receipts, issues, transfers, adjustments) | Append-only ledger; the seven operations collections are all Cloud-Function-write-only | NOW | `inventory_transactions` | `operationsQueries.ts` (one-shot reads) | `firestore.rules` admin/dispatcher | admin, dispatcher | event timestamp | — | `field-ops-app-vite/src/services/operationsQueries.ts:1-6` |
| I-10 | Open demand | — | DEF | — | — | — | — | — | — | No demand record exists distinct from WO reservations and SO allocations; "open demand" would need a definition choosing between them |
| I-11 | Inventory aging / no-movement | — | AUTH | — | — | — | — | — | K-7 for value-weighted aging | Repo-wide search finds no aging implementation. Thresholds and the clock-start event are undecided |
| I-12 | Fastest / slowest movers | — | FORM | per-part `UsageStats` exist (`totalConsumed`, `avgDailyUsage`, volatility) | as I-5 | as I-5 | as I-5 | ranking window undefined | K-11 | `inventoryAnalyticsService.ts` `UsageStats`. The statistics exist; the ranking window and population do not |
| I-13 | Transfer orders in flight | Governed transfer lifecycle | ACT | `transfer_orders` | transfer reads | `inventory.transfer.*` | `inventoryTransferOperator` | event time | catalog `active:false` — sandbox-active | `environments.json` overrides; SYSTEM_AUTHORITIES warehouse rows |
| I-14 | Cycle counts and variances | Governed count → submit → reconcile | ACT | cycle count records | cycle count reads | `inventory.cycleCount.*` | `inventoryCycleCountCounter`, `inventoryCycleCountReconciler` | event time | catalog `active:false` — sandbox-active | `environments.json` overrides |
| I-15 | Inventory value ($) | — | AUTH | — | — | — | — | — | K-7 (FIN-BLOCK-003), ND-27 | No governed cost fact exists anywhere. `part_supplier_items.cost` is a quote/term and FIN-001 rules it non-authoritative for margin. `unitCost` is blocked `displayable`/`reportable`/`exportable` together |
| I-16 | Inventory turns | — | DEP | — | — | — | — | — | K-7, K-11 | No implementation; requires both a value basis and a reporting period |
| I-17 | Carrying cost | — | DEP | — | — | — | — | — | K-7 | Same |
| I-18 | Demand projection / replenishment plan | — | DEF | — | — | — | — | — | K-6, K-14 | The analytics engine is explicitly "NOT an inventory control system, warehouse system, automation engine, or workflow system" |
| I-19 | Location eligibility (which warehouses count) | `warehouses.status === ACTIVE`; MOBILE/truck stock excluded from sellable warehouse stock by design | NOW | `warehouses` (all client writes denied) | governed warehouse validator | `{type:"location", value:<warehouseId>}` where a capability is location-scoped | admin, dispatcher global; `partsManager`/`warehouseManager` via governed location-scoped assignments | none | — | SYSTEM_AUTHORITIES R-18 / R-29 / R-32 rows |
| I-20 | Bin / placement location of stock | **A bin is DESCRIPTIVE, not a custody authority** — the warehouse still owns the stock | ACT | `bin_placements`, `bins` | `listBins` (`inventory.location.bin.read`) | per-warehouse | `inventoryBinAdministrator`, put-away operators | placement event time | catalog `active:false` — sandbox-active | SYSTEM_AUTHORITIES "Bin registry", "Placement" (Decision #116) |

### 3.6 Parts / Warehouse / Receiving

| # | Dashboard fact / action | Definition | Cls | Canonical source | Read authority | Scope | Eligible roles | Time basis | Dependency | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| W-1 | Receiving queue (receivable purchase orders) | Receipts apply only against an ORDERED source; two source authorities discriminated by an explicit closed-set `source.type` with **no fallback lookup** | NOW | `purchase_orders`, `reorder_purchase_orders` | `listReceivablePurchaseOrders` | `inventory.stock.receive` (active — needs no override) | admin, dispatcher, owner | none | receiving DEPLOYED live 2026-08-06 | SYSTEM_AUTHORITIES "Inventory receiving" (Decision #63; Phase C / Decision #115) |
| W-2 | PO receipt progress / partial receipts | Received and remaining are **DERIVED from committed receipts, never stored on the PO**; derived progress is a separate concept from stored `purchase_orders.status`, which stays SENT while partial | NOW | committed receipts | `getPurchaseOrderReceivingProgress` | as W-1 | as W-1 | receipt event time | — | SYSTEM_AUTHORITIES Phase C row |
| W-3 | Receiving location options | Eligibility = `warehouses.status` ACTIVE | NOW | `warehouses` | `listReceivingLocationOptions` | as W-1 | as W-1 | none | — | SYSTEM_AUTHORITIES; I-LA C2 |
| W-4 | Put-away queue | — | ACT | `bin_placements` | placement reads | `inventory.placement.record` | `inventoryPutAwayOperator` | event time | catalog `active:false` — sandbox-active | SYSTEM_AUTHORITIES "Placement" |
| W-5 | Picks | A pick is a placement carrying `pickedForWorkOrderId` | ACT | `bin_placements` | as W-4 | as W-4 | as W-4 | event time | as W-4 | SYSTEM_AUTHORITIES "Placement" |
| W-5b | Picks presented as reservations | — | NO | — | — | — | — | — | — | Decision #116, load-bearing invariant asserted on the source: a pick **reserves nothing**; commitment stays the WO lifecycle effect. Presenting picks as reservations would double-count demand |
| W-6 | Reorder request queue + assignment oversight | Live governed workflow: create → assign → purchasing in progress → received / cancelled / voided / rejected | NOW | `reorder_requests`, `reorder_purchase_orders` | `useReorderRequestsByStatus(es)`, `useReviewedRequestsHistory` | `reorder.request.create.manual` resolved against `{type:"location", value:warehouseId}`; the picker filters by the same authority the create enforces (*offered == accepted*) | `partsManager`, `warehouseManager`, `partsAssociate`, admin, dispatcher | request timestamps | ACTIVATED IN SANDBOX 2026-08-31, live-verified | SYSTEM_AUTHORITIES "Reorder trusted command authority" (R-13/R-15/R-16, R-32); `PartsManagerHome.jsx` |
| W-7 | Shortages | — | DEF | — | — | — | — | — | K-1/K-2, I-10 | No shortage definition exists; it would require choosing a demand basis (WO reservation vs SO allocation vs reorder request) |
| W-8 | Returns awaiting DISPOSITION action | — | AUTH | — | — | — | — | — | — | Decision #118: "Disposition is a separate authority that does not exist" — which is why `RETURNED`, a schema-legal movement type, still has no writer anywhere. Package: `docs/product/returns-disposition-decision-package.md` |
| W-9 | Truck replenishment | — | AUTH | — | — | — | — | — | T-10 | No replenishment model, par level, or min/max for mobile locations exists |
| W-10 | Custody / location exceptions | — | FORM | `warehouses`, `mobile_locations`, `serialized_assets` | per-domain reads | per-domain | — | none | — | The facts exist across three roots; no exception definition composes them. Note the recorded hazard: `mobile_locations`' writer is a full-document replace that would erase a stored company (SYSTEM_AUTHORITIES R-18 CORRECTED note) |
| W-11 | Warehouse handheld operability (what this person may do here) | Capability-derived, with the reason for every unavailability | NOW | `access/scanWorkflows.js` | capability feed | per-capability | all, per capability | none | — | Same authority as T-7: `deriveScanWorkflows` is the single, capability-derived answer and cannot branch on a persona; the resulting matrix is pinned by `field-ops-app-vite/test/personaOperability.test.mjs` |

### 3.7 Purchasing

| # | Dashboard fact / action | Definition | Cls | Canonical source | Read authority | Scope | Eligible roles | Time basis | Dependency | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| P-1 | Open purchase orders | Canonical multi-line `purchase_orders` | NOW | `purchase_orders` | `fetchProcurementPurchaseOrders` / `operationsQueries.ts` | `firestore.rules` admin/dispatcher | admin, dispatcher | none | — | `operationsQueries.ts:245`; `modules/purchasing/PurchaseOrders.jsx` |
| P-2 | Supplier list / supplier catalog | — | NOW | `suppliers`, `supplier_catalog` | `fetchSuppliers`, `fetchSupplierCatalog` | as P-1 | admin, dispatcher | none | — | `operationsQueries.ts:184-185` |
| P-3 | Overdue POs / expected receipts | — | DEF | — | — | — | — | — | K-11 | No governed promise/expected date or overdue threshold exists on a PO. An "overdue PO" tile would invent both |
| P-4 | PO approval queue / approval thresholds | — | AUTH | — | — | — | — | — | — | `procurementService.ts` create/approve/send remain **UNEXPORTED** — no capability, actor, audit or idempotency. The only canonical-PO write today is made inside the receiving transaction. No approval policy exists |
| P-5 | Reorder requests awaiting my action | The same live governed workflow as W-6, read from the purchasing side | NOW | `reorder_requests` | `useReorderRequestsByStatus(es)` | `reorder.request.create.manual` at `{type:"location", value:warehouseId}` | `partsManager`, `warehouseManager`, `partsAssociate`, admin, dispatcher | request timestamps | — | SYSTEM_AUTHORITIES "Reorder trusted command authority" (R-13/R-15/R-16, R-32); activated in sandbox 2026-08-31 and live-verified against the deployed callables |
| P-6 | PO receipt discrepancies | Over-received lines surface reconciliation reasons | NOW | committed receipts vs PO lines | `getPurchaseOrderReceivingProgress` | `inventory.stock.receive` | admin, dispatcher, owner | receipt time | — | SYSTEM_AUTHORITIES receiving Phase C row (Decision #115): received and remaining are DERIVED from committed receipts, never stored on the PO |

### 3.8 Equipment

| # | Dashboard fact / action | Definition | Cls | Canonical source | Read authority | Scope | Eligible roles | Time basis | Dependency | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| E-1 | Equipment register (installed base) | Register spans customers | NOW | equipment register | register reads | global | admin, dispatcher | none | — | ADR-006; `modules/equipment/EquipmentRegister.jsx` |
| E-2 | Available serialized equipment | Company-controlled, at an eligible location, operationally available, not selected by another active Sales Order, no active temporary-placement conflict | ACT | `serialized_assets` | `getAvailableEquipment` (`inventory.serializedAsset.read`) | global | roles carrying the capability | none | catalog `active:false` — sandbox-active | `functions/src/serializedAsset/serializedAssetReadService.ts:39`; `functions/src/index.ts:78` |
| E-3 | Equipment availability as a confident figure | — | NO | — | — | — | — | — | — | Ratified design: **equipment availability fails closed = UNKNOWN, never fabricated** (missing/contradictory evidence ⇒ UNKNOWN). A count that silently treats UNKNOWN as unavailable is a fabricated claim |
| E-4 | Inventory-control lifecycle state (Ventana ice machines) | Taylor inventory control ENDS only when BOTH installation complete (asset `INSTALLED`) AND sale closed (SO `CLOSED`) — allocation, delivery and invoicing end none of it | ACT | `inventoryControlLifecycle.ts` (server) mirrored client-side | projection | global | roles carrying the composing reads | none | governed-inert: no Rules/schema/deploy | SYSTEM_AUTHORITIES "Inventory-control lifecycle — two-condition exit" |
| E-5 | Installations recorded | — | ACT | installed-asset records | install reads | `equipment.install` | `equipmentInstaller` | install event | catalog `active:false` — sandbox-active | SYSTEM_AUTHORITIES; `environments.json` |
| E-6 | Equipment ownership / title / custody | Ownership/title, custody and availability are **SEPARATE axes and never inferred from control state**. A CUSTOMER may hold title without owning the internal record (D-3) | NO where unknown | `explicitTitleHolder` and the custody authorities are distinct and non-collapsing | per-axis reads | per-axis | — | none | ownership model is INERT — no Rules enforce it, no writer stamps it, no backfill has run | SYSTEM_AUTHORITIES "EOS Ownership Model v1 — typed owner + handoff" (NON-COLLAPSE, ratified) |
| E-7 | Equipment compatibility | — | ACT | compatibility records | `equipment.compatibility.view` | global | roles carrying the capability | none | catalog state | `functions/src/equipmentCompatibility/readService.ts:41` |

### 3.9 Financials

Every row here composes FIN-004. **CORRECTED 2026-09-02.** These rows previously said all were blocked because no Role carried any `finance.visibility.*` capability. That was a measurement error (see the correction box at the head of this document). The accurate position:

- **`admin` and `owner` carry all five scopes.** In `platform-sandbox`, where `finance.visibility.consolidated` is activated, their reach is CONSOLIDATED — so these rows are ACTIVATION-CLASS for those two principals there, and every one of them can be exercised today.
- **Every other principal reaches nothing**, in every environment, because eleven governed Roles hold `finance.read` with no scope and the rest hold neither. That is the FIN-004 invariant working, not a defect.
- **Production reaches nothing for anyone, admin included** — no visibility capability is activated there, and the block is role-keyed, override-free and test-asserted.

The `DEP` classification below is retained because §3 is stated for the general principal; the admin/owner sandbox exception is named in each Dependency cell. They are listed individually because they unblock individually and their SECOND gates differ.

| # | Dashboard fact / action | Definition | Cls | Canonical source | Read authority | Scope | Eligible roles | Time basis | Dependency | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| F-1 | Invoices (list, detail) | Issued invoice history is immutable | DEP | `invoices` (Admin-SDK-only, deny-all both Rules mirrors) | `listFinancialFacts` / `listAccountInvoiceAr` | FIN-004 reach | admin, owner (CONSOLIDATED, sandbox only) | `eventAtMillis` | FIN-004 scope grant for any non-admin Role | SYSTEM_AUTHORITIES "Finance — invoice issuance"; F12 |
| F-2 | A/R outstanding + position | `outstanding = total − applied − credits + charges − writeoffs`; a transactionally-maintained projection, **not** an independent accounting authority. Positions CURRENT/OVERDUE/SETTLED/VOID/UNKNOWN | DEP | as F-1 | `listAccountInvoiceAr` | FIN-004 reach | admin, owner (CONSOLIDATED, sandbox only) | invoice due date | FIN-004 scope grant for any non-admin Role | SYSTEM_AUTHORITIES "Finance — trusted AR read". **Truncation honesty: a page that would truncate renders "unavailable", never a partial "ready"** |
| F-3 | Payments / receipts | Cash receipt and payment application are separate facts; over-application rejected | DEP | `payments`, `payment_applications` | `listFinancialFacts` | FIN-004 reach (payments inherit their invoice's visibility) | admin, owner (CONSOLIDATED, sandbox only) | `recordedAtMillis` | FIN-004 scope grant for any non-admin Role | SYSTEM_AUTHORITIES "Finance — payment / AR" |
| F-4 | Credits, adjustments, refunds | CREDIT_MEMO / DEBIT_CHARGE / WRITE_OFF; credit and write-off ≤ outstanding; an issued invoice is never rewritten | DEP | `invoice_adjustments`, `refunds` | trusted reads | FIN-004 reach | admin, owner (CONSOLIDATED, sandbox only) | event time | FIN-004 scope grant for any non-admin Role; FIN-007 policy values for the approval half | SYSTEM_AUTHORITIES "Finance — adjustments", "Finance — refund" |
| F-5 | Billing queue (unbilled eligible) | unbilled-eligible = `max(0, min(ordered, fulfilled) − billed)` per line — identical to issuance's cap, so the queue never shows what issuance would refuse. **No amounts, test-asserted** | DEP | `sales_orders` + `billedQty` projection | `billingQueue.ts` | FIN-004 reach | admin, owner (CONSOLIDATED, sandbox only) | none | FIN-004 scope grant for any non-admin Role; **service work structurally cannot enter — FIN-BLOCK-002** | SYSTEM_AUTHORITIES "Finance — Billing Queue (F4)" |
| F-6 | Gross margin / profitability | Margin is COMPUTED only when EVERY revenue line carries a governed cost fact; otherwise **UNKNOWN with no number at all** — never revenue − 0, never a partial margin | NO | `costMargin.ts` | `deriveGrossMargin` | FIN-004 reach | admin, owner (CONSOLIDATED, sandbox only) | none | **FIN-BLOCK-003 — no governed cost fact exists anywhere** | FIN-006 §1: "every real invocation returns UNKNOWN — which is the truthful current answer to every margin question" |
| F-7 | Company / BU performance | Per-company rollups exact; **Consolidated typed `UNELIMINATED_SUM`** and must render with that caveat | DEP | FIN-002 dimensions | `summarizeByCompany` | OPERATING_COMPANY / CONSOLIDATED | admin, owner (CONSOLIDATED, sandbox only) | event time | FIN-004 scope grant for any non-admin Role; FIN-BLOCK-004 | SYSTEM_AUTHORITIES FIN-009; F13 |
| F-8 | Salesperson / employee performance | `creditedSalespersonId` frozen at event time, exposed verbatim, never re-derived from customer owner, createdBy, assignment, technician or warehouse | DEP | FIN-002 snapshots | `listFinancialFacts` | FIN-004 SELF/TEAM | admin, owner (CONSOLIDATED, sandbox only) | event time | FIN-004 scope grant for any non-admin Role | SYSTEM_AUTHORITIES "Finance — governed reporting read" |
| F-9 | Intercompany position | — | NO | — | — | — | — | — | FIN-BLOCK-004 | F12: "none — deliberately. No intercompany record type may exist until the Owner rules treatment". D-3: Ventana is the upstream supplier |
| F-10 | Reconciled accounting fact | — | NO | — | — | — | — | — | DECISIONS #145 | F13: "ABSENT BY DECISION — authority not yet selected; **nothing may masquerade as reconciled**" |
| F-11 | Internal AR reconciliation / drift | Recomputes applied/credits/charges/write-offs/outstanding/state from durable facts and diffs vs the stored cache: IN_SYNC or DRIFT with per-field values. Foreign or malformed facts are THROWN — **an unreconcilable set never reports sync**; nothing is auto-fixed | ACT | `financialReconciliation.ts` | internal | FIN-004 reach for display | admin, owner (CONSOLIDATED, sandbox only) | none | FIN-004 scope grant for any non-admin Role | SYSTEM_AUTHORITIES "Finance — internal reconciliation (FIN-010)" |
| F-12 | Period open / closed | Per-company frozen periods (OPEN\|CLOSED); a close names who/why/when; REOPEN deliberately unmodelled; **an uncovered date is allowed — closing is explicit, absence closes nothing** | ACT | `financialPeriods.ts` | internal | per operating company | admin, owner (CONSOLIDATED, sandbox only) | period bounds | no periods declared today = nothing closed (safe) | SYSTEM_AUTHORITIES "Finance — period & close (FIN-008)". This is an OPERATIONAL reporting close, not an accounting close |
| F-13 | Financial approvals awaiting me | Fail-closed requirement engine: **no policy line ⇒ approval required**; unconditional self-approval prohibition; approving 100 is not approving 150 | DEP | `financialApprovals.ts` | internal | approver role | admin, owner (CONSOLIDATED, sandbox only) | none | **FIN-007 policy VALUES are Owner-undecided** — composed actions fail closed until then | SYSTEM_AUTHORITIES "Finance — approval governance (FIN-007)" |

### 3.10 Admin / Governance

| # | Dashboard fact / action | Definition | Cls | Canonical source | Read authority | Scope | Eligible roles | Time basis | Dependency | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| A-1 | Privileged role requests awaiting decision | Two-person approval applies to capabilities that can materially administer security/access policy | NOW | privileged request records | `listPrivilegedRoleRequests` | global admin | admin, owner | request time | — | `functions/src/index.ts`; `docs/governance/privileged-approval-classification.md` |
| A-2 | Access requests to decide | — | NOW | access request records | `admin.accessRequest.decide` | global admin | admin, owner | request time | — | `compatibilityRoles.ts` ADMIN_CURATED_PERMISSIONS |
| A-3 | Password-reset-eligible users | — | NOW | `users` + Auth | `listResetEligibleUsers` | global admin | admin, owner | none | — | `functions/src/index.ts` |
| A-4 | Effective access for a principal (what this person can actually do) | The resolver is the authority; UI hiding is never authority | NOW | `resolveEffectivePermission` | `effectiveAccessFeed` / `resolveEffectiveAccessCallable` | per principal | all (for self); admin for others | none | — | SYSTEM_AUTHORITIES access rows; `LandingPage.jsx` is the shipped consumer precedent |
| A-5 | Audit event history | Append-only; the existing writer was EXTENDED, never forked into a parallel system | FORM | `audit_events` | no enumerated governed READ capability or list callable | — | — | event time | — | `functions/src/access/auditEventWriter.ts`. `FinancialsAudit.jsx` is a surface without an enumerated read seam — a read authority must be named before an audit feed can be surfaced |
| A-6 | Capability activation state per environment | Read-only declaration; adding an entry does not create anything | NOW | `config/environments.json` + `environmentCapabilityOverrides.ts` (drift-guard-tested pair) | build-time / server-side | per environment | admin, owner | none | — | `config/environments.json` header |
| A-7 | Deployment / release signoff status | — | NO | — | — | — | — | — | — | EOS has no governed in-app source for release state; it lives in the repository and CI. Surfacing it would mean inventing a record type |
| A-8 | Governance decisions awaiting the Owner | — | NO | — | — | — | — | — | — | The decision register is `docs/DECISIONS.md` and the ND register — repository documents, not governed EOS records. A dashboard may link to them; it may not claim a count |
| A-9 | Employee directory / assignable employees | — | NOW | `employees` | `useAssignableEmployees` (scoped) / `useEmployeeDirectory` (admin audience) | scoped vs unscoped are deliberately different audiences | per audience | none | — | `PartsManagerHome.jsx:35-38` — an assignee not in the scoped lookup renders "Unknown assignee", never a raw uid |

### 3.11 Cross-domain

| # | Dashboard fact / action | Definition | Cls | Canonical source | Read authority | Scope | Eligible roles | Time basis | Dependency | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| X-1 | "What needs your attention" — ACTION_ITEM | Owner's taxonomy: ACTION_ITEM = "you need to do something". **No ALERT category** — no repository evidence justifies inventing severity independent of workflow status | NOW | per-domain authorities, composed | the three attention projections | per-domain scope | per-domain roles | per-domain | — | `partsAttentionProjection.js`, `workOrderAttentionProjection.js`, `accountAttentionProjection.js` |
| X-2 | "Waiting / not on you" — NOTIFICATION | NOTIFICATION = "something happened / is in motion, no action required right now" | NOW | per-domain authorities, composed | the three attention projections | per-domain scope | per-domain roles | per-domain | — | The other half of the same Owner-ratified taxonomy as X-1, from the same three modules: `partsAttentionProjection.js`, `workOrderAttentionProjection.js`, `accountAttentionProjection.js` |
| X-3 | Attention projections re-badging existing severity models | — | NO | — | — | — | — | — | — | `workOrderAttentionProjection.js:22-27`: re-projecting `jobRiskScoring`/`dispatchScoring` into the 2-value taxonomy would create the exact "same badge vocabulary, different meaning" confusion the pattern's own consumer warns against |
| X-4 | Recent meaningful activity (cross-domain roll-up) | — | FORM | four existing surfaces at four grains over three data sources | per-surface | per-surface | per-surface | per-surface | — | **Owner decision 2026-08-09 RETIRED the standalone Activity destination.** "Do NOT restore it without an explicit product decision. Reinstating it means choosing what it IS ('my activity' or a cross-domain roll-up), and each is a new product with its own authority and projection — not a nav entry." `navConfig.js`; `docs/reviews/ux3-activity-destination-scope.md` |
| X-5 | Notification history | — | AUTH | — | — | — | — | — | — | `navConfig.js`: the Notifications destination is `navHidden` with the explanation "the full notification history, which is not built yet" |
| X-6 | Reachable destinations for this principal ("go to") | Computed with the SAME `isDomainVisible`/`isNavItemVisible` functions the nav rail and the route table use — "a destination is either genuinely reachable right now, or it is not listed" | NOW | `navConfig.js` + capability feed | `LandingPage.jsx` | per principal | all | none | — | `field-ops-app-vite/src/navigation/LandingPage.jsx:1-25` |
| X-7 | Operating-company scope on OPERATIONAL records | — | AUTH | — | — | — | — | — | K-12 | DECISIONS #143: the 30 unresolved sandbox Work Orders are `NO_GOVERNED_COMPANY_SOURCE` — a company-provenance gap. The ownership model is INERT: no Rules enforce it, no writer stamps it, no backfill has run. A Taylor/Ventana split on operational dashboards would be fabricated |
| X-8 | Dashboard read / scope layer | — | FORM | — | — | — | — | — | K-17 | No dashboard-specific read authority exists and none should be created. The rule to record: a dashboard composes each domain's own read authority at that domain's own scope, and **dashboard personalisation is never a new permission layer** |
| X-9 | Truncation / completeness honesty on any dashboard count | A bounded read may return a page and say so; **a TOTAL may not** — bounding an aggregate produces a number smaller than the truth while still labelled "Total", which is worse than the slow unbounded read it replaced | NOW (as a binding rule) | `accountPortfolioSummary.ts` (aggregate contract) + `financialVisibility.ts` (unfiltered-set rule) | the rule binds every read; it has none of its own | all | all | none | — | `accountPortfolioSummary.ts:7-15` — "THIS IS AN AGGREGATE CONTRACT, NOT A LIST CONTRACT … no cursor, no pageSize, no limit". FIN-004: truncation honesty is judged on the UNFILTERED set, and an A/R page that would truncate renders "unavailable", never a partial "ready" |

### 3.12 Global search

| # | Fact | Finding |
|---|---|---|
| G-1 | Existing implementation | `field-ops-app-vite/src/shared/search/GlobalSearch.jsx` (79 lines) + `searchProviders.js` (141 lines). Generic result shape `{id, entityType, primaryText, secondaryText, route}`; the component knows nothing about specific entities |
| G-2 | Currently reachable | **In exactly ONE place: `PartsList.jsx:982`**, mounted with `providerKeys={["parts"]}`. There is no application-shell global search — `WorkspaceHeader.jsx` merely reserves a slot for one |
| G-3 | Registered providers | Three: `accounts`, `workOrders`, `parts`. **`accounts` and `workOrders` have NO CALLER** and the source says they must not gain one on a bounded list |
| G-4 | Why | "LIST PAGE != SEARCH CORPUS." The provider shape is only honest when the caller holds the WHOLE collection. Both former callers were unbounded whole-collection reads and were replaced by bounded paged queries — handing this provider a paged screen's data would search ONE PAGE and report "no results" for a record that plainly exists. Their replacements are real bounded Firestore queries: `domain/accountSearch.js` (name prefix), `domain/workOrderSearch.js` (WO number prefix) |
| G-5 | Authorisation behaviour | The `parts` provider is canonical-first: access-version boundary-key guarded via PartsList's read, and fails closed on a denied/unavailable/incomplete/invalid canonical read (`catalogRows` becomes `[]` → no results, **never the raw static catalog**) |
| G-6 | Result scoping | Client-side filter over already-loaded, already-authorised data. No provider triggers a Firestore read of its own, so no provider can widen scope |
| G-7 | Not searchable | contacts, locations, equipment, employees, opportunities, sales agreements, sales orders, invoices, purchase orders, suppliers, serialized assets — none registered, stubbed or scaffolded |
| G-8 | Deliberate exclusions | Barcodes and aliases are **not** in the parts haystack: resolving those needs `inventory.catalog.alias.read`, registered `active:false` and granted to nobody, "so claiming them would be a promise the search cannot keep". Server-side description search is a separately recorded `PART_DESCRIPTION_SEARCH_INDEX_GAP` |
| G-9 | Gap vs true site-wide search | True site-wide search needs a bounded server-side read per domain (the `accountSearch`/`workOrderSearch` prefix-query pattern generalised), each authorised by that domain's own capability, plus a description/full-text index that does not exist. **Census only — not designed or scoped here** |

---

## 4. Persona dashboard matrix

Values: **SHOW** (visible at full scope) · **SHOW_SCOPED** (visible, narrowed by a governed scope) · **ACTION_REQUIRED** (an item the person must act on) · **WAITING** (in motion, not on them) · **GATED** (authority exists, activation/grant missing) · **NOT_VISIBLE**.

Personas use the repository's own role ids (`functions/src/access/governedBusinessRoles.ts`, 40 Roles; `compatibilityRoles.ts` for admin/dispatcher/technician). Columns are the eleven role families that have a distinct dashboard answer; the remaining governed Roles inherit their family's row.

| Fact | owner / generalManager | admin | operationsManager | salesManager | salesperson | accountingManager / controller / financeManager | dispatcher / fieldManager | technician | partsManager | partsAssociate / warehouseAssociate | warehouseManager |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **A. What needs your attention** |
| WO past due (SV-4) | SHOW | SHOW | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | ACTION_REQUIRED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Unassigned / ready to dispatch (SV-2) | SHOW | SHOW | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | ACTION_REQUIRED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Scheduling conflicts (SV-5) | SHOW | SHOW | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | ACTION_REQUIRED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Parts-blocked work (SV-6) | SHOW | SHOW | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | ACTION_REQUIRED | NOT_VISIBLE | ACTION_REQUIRED | WAITING | ACTION_REQUIRED |
| Reorder requests to assign (W-6) | SHOW | SHOW | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | SHOW | NOT_VISIBLE | ACTION_REQUIRED (SHOW_SCOPED, `{type:"location"}`) | ACTION_REQUIRED (assigned to me) | ACTION_REQUIRED (SHOW_SCOPED) |
| Receiving queue (W-1) | SHOW | ACTION_REQUIRED | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | ACTION_REQUIRED | NOT_VISIBLE | GATED (PARTS_ASSOCIATE receive deferred) | GATED | GATED |
| My assigned work (T-1) | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | SHOW_SCOPED (`users/{uid}.technicianId`) | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Account attention — AR overdue (C-4) | SHOW_SCOPED (CONSOLIDATED, sandbox) | SHOW_SCOPED (CONSOLIDATED, sandbox) | GATED | GATED | GATED | GATED | GATED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| **B. Approvals / decisions** |
| Privileged role requests (A-1) | ACTION_REQUIRED | ACTION_REQUIRED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Access requests (A-2) | ACTION_REQUIRED | ACTION_REQUIRED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Financial approvals (F-13) | GATED | GATED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | GATED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Sales agreements awaiting acceptance (S-6) | GATED | GATED | NOT_VISIBLE | GATED | GATED (SHOW_SCOPED once granted) | NOT_VISIBLE | GATED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| **C. Current work / today** |
| Open WO by status (SV-1) | SHOW | SHOW | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Scheduled today (SV-3) | SHOW | SHOW | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | SHOW | SHOW_SCOPED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| My work buckets (T-2) | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | SHOW_SCOPED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| My opportunities (S-2) | GATED | GATED | NOT_VISIBLE | GATED | GATED (SHOW_SCOPED to viewer's employee id) | NOT_VISIBLE | GATED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Put-away / picks queue (W-4/W-5) | GATED | GATED | GATED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | GATED | GATED | GATED (SHOW_SCOPED) | GATED (SHOW_SCOPED) | GATED (SHOW_SCOPED) |
| **D. Exceptions** |
| PO receipt discrepancies (P-6) | SHOW | SHOW | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | SHOW | NOT_VISIBLE | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED |
| Internal AR drift (F-11) | SHOW_SCOPED (CONSOLIDATED, sandbox) | SHOW_SCOPED (CONSOLIDATED, sandbox) | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | GATED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Stockout risk, labelled derived (I-7) | SHOW | SHOW | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | SHOW | NOT_VISIBLE | SHOW | SHOW | SHOW |
| Fulfillment obligation attention (S-18) | GATED | GATED | GATED | GATED | GATED | NOT_VISIBLE | GATED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| **E. Waiting / in progress** |
| Transfers in flight (I-13) | GATED | GATED | GATED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | GATED | NOT_VISIBLE | GATED (SHOW_SCOPED) | GATED | GATED (SHOW_SCOPED) |
| Open POs (P-1) | SHOW | SHOW | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | SHOW | NOT_VISIBLE | WAITING | WAITING | WAITING |
| Unverified offline submissions (T-9) | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | ACTION_REQUIRED | ACTION_REQUIRED | ACTION_REQUIRED | ACTION_REQUIRED |
| **F. Health / KPI facts** |
| Account portfolio counts (C-1) | SHOW | SHOW | SHOW | SHOW | SHOW | SHOW | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Governed on hand / reserved / available (I-1/2/3) | GATED | GATED | GATED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | GATED | NOT_VISIBLE | GATED | GATED | GATED |
| Ledger-derived stock forecast (I-5) | SHOW | SHOW | SHOW | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | SHOW | NOT_VISIBLE | SHOW | SHOW | SHOW |
| Billed / collected / A/R (S-10/11, F-2) | SHOW_SCOPED (CONSOLIDATED, sandbox) | SHOW_SCOPED (CONSOLIDATED, sandbox) | NOT_VISIBLE | GATED | GATED (SELF) | GATED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Gross margin (F-6) | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Inventory value / turns (I-15/16) | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| My performance, all-time (T-4) | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | SHOW_SCOPED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| **G. Recent activity** |
| CRM activity feed (C-6) | GATED | GATED | NOT_VISIBLE | GATED | GATED | NOT_VISIBLE | GATED | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| Cross-domain activity roll-up (X-4) | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE | NOT_VISIBLE |
| **H. "Go to" destinations** |
| Reachable destinations (X-6) | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED |
| Scan workflows available to me, with reasons (T-7/W-11) | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED | SHOW_SCOPED |

**The matrix's own rule.** Every SHOW_SCOPED cell names a scope that already exists in the governed model. Every GATED cell is gated by a capability or grant, never by the dashboard. **No cell was made visible by this census.** The same fact is REPORTABLE_NOW for one role and NOT_VISIBLE for another — that difference comes from the existing authority, and a dashboard that widened it would be minting permission.

**Roles with no distinct dashboard answer today.** The remaining governed Roles (`officeManager`, `marketingManager`, `purchasingManager`, `shopManager`, `shopAssociate`, `supportStaff`, `generalEmployee`, the three report Roles, and the single-purpose execution Roles such as `inventoryCreateExecutor`, `equipmentInstaller`, `workOrderPartsPlanner`, `inventoryCycleCountCounter`) resolve their dashboard from X-6 plus whatever capabilities they carry. They are not omitted — they have no *additional* eligible fact beyond their capability set, and minting a persona dashboard for them would be minting a persona.

---

## 5. Dependency graph

```
FIN-004 REACH  (admin + owner carry all five scopes; sandbox activates CONSOLIDATED only.
                Blocking applies to every OTHER principal: eleven Roles hold finance.read
                with no scope, and production activates nothing for anyone.)
  └─> F-1 Invoices ─ F-2 A/R ─ F-3 Payments ─ F-4 Adjustments ─ F-5 Billing queue
      F-7 Company/BU ─ F-8 Employee perf ─ F-11 AR drift display
      S-10 Billed ─ S-11 Collected ─ S-16 Top customers ─ S-13 Sales credit
      C-4 Account AR attention ─ C-8 Customer financial position
      (fourteen fact families; reachable by admin/owner in sandbox TODAY,
       and by nobody else anywhere until a scope is granted to a carrying Role)

FIN-BLOCK-003  COST FACT SUPPLY  (no governed cost fact exists)
  ├─> F-6 Gross margin  ─────> Cost-to-Budget surface
  ├─> I-15 Inventory value ──> I-16 Turns ──> I-17 Carrying cost
  └─> any margin-bearing performance figure

FIN-BLOCK-002  SERVICE BILLING  ──> F-5 (service work cannot enter the billing queue)
FIN-BLOCK-004  INTERCOMPANY     ──> F-9; and the Consolidated column stays UNELIMINATED_SUM (S-17, F-7)
DECISIONS #145 AUTHORITY OF RECORD ──> F-10 (nothing may masquerade as reconciled)

K-11 REPORTING PERIOD / TIME  (no MTD/QTD/YTD, calendar, or reporting timezone)
  ├─> every period-relative KPI and prior-period delta
  ├─> S-12 AOV ─ S-14 goal pace ─ T-5 windowed technician performance
  └─> I-12 movers ranking ─ I-16 turns

PLAN STORAGE + FIN-007 POLICY VALUES
  ├─> S-14 Sales-to-goal % / pace
  └─> F-13 Financial approvals awaiting me

FORECAST STORAGE + METHODOLOGY (Owner policy) ──> S-15

INVENTORY_BALANCE_READ_READY (client transport flag, false)
  └─> I-1 on hand ─ I-2 reserved ─ I-3 available/ATP ─ I-4 per-location
      (also: ND-28-F requires reconciling the Stock forecast composition against the
       governed balance when this activates — semantics must not change silently)

K-1 COMMITMENT ──> K-2 ATP ──> (any governed available-based reorder or stockout semantics)
K-13 LOCATION ELIGIBILITY ──> K-2 (only ACTIVE warehouses count)

OPERATIONAL COMPANY PROVENANCE (WO NO_GOVERNED_COMPANY_SOURCE, ownership model inert)
  └─> X-7 Taylor/Ventana split on any OPERATIONAL dashboard
      (financial company attribution is CLOSED and unaffected)

DISPOSITION AUTHORITY (does not exist, Decision #118) ──> W-8 returns disposition queue
```

**Chains the repository does NOT support — tested rather than assumed:**

- *Picking / assignment ⇒ reservation.* Refused. Decision #116's load-bearing invariant, asserted on the source: a pick writes no ledger event, changes no quantity, touches no balance, and reserves nothing.
- *Movement semantics ⇒ inventory aging.* The ledger carries the timestamps, but no aging authority exists and thresholds are undecided; the chain is a prerequisite, not a derivation.
- *Reorder point participates in ATP.* Refused: there is no stored reorder point for ATP to consult (ND-29).
- *Location name ⇒ ownership.* Refused: `operatingCompanyId` may not be inferred from location name, `lineOfBusiness`, technician, dispatcher, creator, or a legacy Job coincidence (DECISIONS #143).

---

## 6. Activation-only backlog

Authority exists; only bounded activation or read wiring remains. **None of these is a business decision.**

| # | Item | What remains | Fact families unlocked |
|---|---|---|---|
| AB-1 | Governed part balance | Flip `INVENTORY_BALANCE_READ_READY` for the target environment; confirm `getPartBalance`/`getPartBalances` deployed. ND-28-F requires reconciling the Stock forecast composition in the same change | I-1, I-2, I-3, I-4 |
| AB-2 | Booked-basis read | Add a bounded read for FIN-002 booked facts (`listFinancialFacts` excludes them by construction, test-guarded) | S-9 |
| AB-3 | Sales spine beyond sandbox | The `opportunity.*` / `salesAgreement.*` / `salesOrder.*` ids are catalog `active:false`, sandbox-overridden; a wider environment is an activation act | S-1, S-2, S-3, S-6, S-7 |
| AB-4 | Inventory operations spine | Same posture for `inventory.transfer.*`, `inventory.cycleCount.*`, `inventory.placement.record`, `inventory.returns.intake`, `inventory.location.bin.*` | I-13, I-14, I-20, W-4, W-5, T-8, T-11 |
| AB-5 | Equipment forward lifecycle | `inventory.serializedAsset.read`/`.acquire`, `equipment.install` — sandbox-eligible; note the deliberate separation: activating one must not implicitly activate the other | E-2, E-4, E-5 |
| AB-6 | CRM activity | `crm.activity.read` catalog-inactive, sandbox-overridden | C-6 |
| AB-7 | Coordinated operations | `fulfillment.coordinatedVisit.read` catalog-inactive, sandbox-overridden | S-18, SV-15 |

---

## 7. Formalization backlog

Behaviour appears coherent; explicit authority must be recorded before a dashboard consumes it.

| # | Item | What to record |
|---|---|---|
| F-01 | Dashboard read/scope rule (K-17, X-8) | That a dashboard composes each domain's own read authority at that domain's own scope, and is never a second permission layer. `LandingPage.jsx` is the shipped precedent to point at |
| F-02 | Attention taxonomy as the dashboard vocabulary | ACTION_ITEM / NOTIFICATION is Owner-ratified in three domain modules but is not recorded as the platform-wide dashboard vocabulary; the no-ALERT rule and the no-re-badging rule (X-3) belong with it |
| F-03 | Work Order aging (SV-9) | Whether an age display may become a bucketed metric, and on which timestamp |
| F-04 | Technician utilisation (SV-8) | Whether a utilisation figure may exist at all given optional estimates and the ABSENT-IS-NOT-EMPTY rule |
| F-05 | "Next job" ordering (T-3) | Which statuses qualify and how unscheduled dispatched work ranks |
| F-06 | Movers ranking (I-12) | The ranking window and population over existing `UsageStats` |
| F-07 | Contact/location aggregate reads (C-5) | Whether a dashboard-scale count is wanted, and its read authority |
| F-08 | Audit event read authority (A-5) | The read capability and list seam; the writer exists, the read does not |
| F-09 | Custody/location exception definition (W-10) | What composes an exception across the three physical roots |
| F-10 | Cross-domain activity (X-4) | Owner-retired; restoring it requires choosing what it IS. Recorded here so it is not re-derived |
| F-11 | Truncation/completeness honesty as a dashboard-wide rule (X-9) | Bounded list vs unbounded total; the rule exists in two places and binds everywhere |

---

## 8. Genuine authority backlog

Unresolved product/business decisions. Nothing here can be closed by reading the repository.

| # | Missing decision | Blocks |
|---|---|---|
| G-01 | **FIN-BLOCK-003** — costing method/basis vocabulary, cost capture point, labor cost treatment, valuation authority (ND-27) | F-6, I-15, I-16, I-17, cost-to-budget, all margin |
| G-02 | **FIN-BLOCK-002** — service billing rate/policy | F-5 service half |
| G-03 | **FIN-BLOCK-004** — intercompany treatment and elimination | F-9; the Consolidated caveat on S-17/F-7 |
| G-04 | **DECISIONS #145** — the external accounting authority of record | F-10 |
| G-05 | **Reporting period / time authority** — fiscal vs civil calendar, reporting timezone, partial-period rule, prior-period comparison | every period-relative KPI |
| G-06 | **Plan storage + FIN-007 policy values** — where a GOAL/BUDGET version lives, who approves it, approval thresholds per action | S-14, F-13 |
| G-07 | **Forecast storage + methodology** — who forecasts, how often, commit vs derived | S-15 |
| G-08 | **Average Order Value definition** | S-12 |
| G-09 | **Inventory aging thresholds + clock-start event** | I-11 |
| G-10 | **Open demand / shortage definition** | I-10, W-7 |
| G-11 | **Returns disposition authority** (Decision #118) | W-8, and the unwritable `RETURNED` movement type |
| G-12 | **PO expected/promise date + overdue threshold; PO approval policy** | P-3, P-4 |
| G-13 | **Operational-record company provenance** (WO `NO_GOVERNED_COMPANY_SOURCE`) | X-7 |
| G-14 | **Service metrics** — first-time fix, response/SLA, callback, parts-delay impact | SV-11, SV-12, SV-13, SV-14 |
| G-15 | **Notification history** as a product | X-5 |
| G-16 | **Account lifecycle** (ND-11) | C-10 |
| G-17 | **Sales Order stage times** (ND-8); **Opportunity next-step/follow-up record** | S-5, S-8 |
| G-18 | **`expectedValue` currency gap** (FIN-001 §1.6) | S-4 value-bearing pipeline |

---

## 9. Unknowns requiring Owner decision

Only genuine decisions repository evidence cannot resolve.

1. ~~**FIN-004 reach has no carrying Role — is that the intent?**~~ **WITHDRAWN 2026-09-02. The
   premise was false.** `admin` and `owner` carry all five `finance.visibility.*` scopes, through
   admin's DERIVED permission set (`ADMIN_CURATED_PERMISSIONS` + the whole `PERMISSION_CATALOG`),
   which is why they appear as no literal in any Role source and why a text-search measurement
   missed them. Sandbox reach for admin/owner is CONSOLIDATED and works.

   **Replaced by two narrower questions, both still open** (see `fin004-reach-reconciliation.md`
   §6):

   **1a. Which non-admin Role carries which `finance.visibility.*` scope?** Eleven governed Roles
   hold `finance.read` and no scope, so they reach nothing — correct fail-closed behaviour, and
   also the reason no Financials surface works for anyone but admin/owner. F14 §2 marks the
   carrying role TBD for all five of its personas (company manager, BU manager, self-view
   salesperson, team manager, consolidated executive). Unchanged, and unclosed.

   **1b. Finance Manager holds no finance capability at all, while both Roles' descriptions claim
   they are "intentionally identical".** `financeManager` has 5 permissions and zero `finance.*`
   ids; `accountingManager` has 17 including all five. The existing pinning test permits this
   because it asserts containment and `>=` rather than equality, so it passes while its own
   comment ("the two are identical again") is false. Three coherent answers, none of which a build
   may pick: restore parity, retire the parity claim, or re-specify Finance Manager as the first
   non-admin scope holder.

2. **Reporting period and time authority** (G-05). Nothing in the repository defines a fiscal
   calendar, a reporting timezone, MTD/QTD/YTD, partial-period handling, or a prior-period
   comparison rule. FIN-008 gives per-company OPEN/CLOSED frozen periods, which is a close
   authority, not a reporting calendar. Every period-relative dashboard figure is blocked on this
   one decision, and it cannot be inferred: the only IANA timezone in the repository governs
   technician working hours, a different authority.

3. **The cost supply** (G-01, FIN-BLOCK-003). Four sub-decisions, already packaged in
   `docs/financials/FIN-BLOCK-003_COST_AUTHORITY_DECISION_PACKAGE.md`. Recorded here because it is
   the single largest authority gap by dashboard reach: six fact families terminate at it, and
   until it is ruled the correct dashboard answer for all six is UNKNOWN with no number.

4. **Do derived informational figures belong on a DASHBOARD?** ND-28 ruled that clearly-identified
   derived information (the Stock forecast, days remaining, stockout risk) may appear on a *record
   page*, and prohibited promoting it into a record header or a workspace principal quantity
   column. A dashboard tile is a third surface the ruling did not address, and a tile is closer to
   a header than to a card. **Decision needed before I-5 or I-7 renders on a dashboard.**

---

## 10. Dashboard implementation readiness

### SAFE NOW

Build against existing authority, at existing scope, with no activation and no new decision:

- **Every persona:** reachable destinations (X-6), scan-workflow availability with reasons (T-7/W-11), effective access (A-4).
- **Owner / Admin / Operations Manager:** account portfolio counts (C-1), open WO by status (SV-1), scheduled work (SV-3), past due (SV-4), conflicts (SV-5), parts-blocked (SV-6), completion counts (SV-10), movement counts (I-9), open POs (P-1), suppliers (P-2), receiving queue (W-1), PO progress and discrepancies (W-2/P-6), reorder queue (W-6).
- **Dispatcher / Field Manager:** the whole Service block above as ACTION_REQUIRED, plus technician recorded availability (SV-7) and stalled-job risk (SV-17).
- **Technician:** my work (T-1), buckets (T-2), required actions (T-6), all-time performance (T-4), unverified submissions (T-9).
- **Parts / Warehouse:** reorder queue scoped to `{type:"location"}` (W-6), receiving progress (P-6), stockout risk labelled as derived (I-7), ledger-derived stock forecast labelled as derived (I-5) — **the last two subject to Owner decision 4**.
- **Admin:** privileged requests (A-1), access requests (A-2), reset-eligible users (A-3), environment capability state (A-6).

### SAFE AFTER EXISTING ACTIVATION

No new authority; §6 is the whole list. Ordered by dashboard value per unit of work:

1. AB-1 governed part balance — four fact families, one transport flag.
2. AB-7 + AB-6 coordinated operations and CRM activity — already sandbox-active.
3. AB-3 sales spine — five families, already sandbox-active.
4. AB-4 / AB-5 inventory operations and equipment lifecycle.
5. AB-2 booked-basis read — bounded, but pointless until Owner decision 1.

### DO NOT IMPLEMENT YET

- **Anything financial FOR A NON-ADMIN PERSONA**, until decision 1a grants a scope to a carrying Role — those principals render honest "unavailable" states, which is correct behaviour and a poor use of a build. **CORRECTED 2026-09-02: for `admin`/`owner` in sandbox these fourteen families are SAFE AFTER EXISTING ACTIVATION, not blocked** — reach is CONSOLIDATED and live. Production remains unreachable for everyone.
- **Any margin, inventory value, turns, or carrying-cost figure** — FIN-BLOCK-003. `deriveGrossMargin` returns UNKNOWN and must render as unknown, never 0%.
- **Any period-relative KPI, pacing figure, or prior-period delta** — no time authority.
- **AOV, forecast, goal %, pipeline value, first-time fix, SLA, callbacks, inventory aging, turns, shortages, truck replenishment, notification history, cross-domain activity roll-up, deployment status** — each is a named authority gap in §8.
- **A dashboard-local computation of anything in this document.** Every REPORTABLE row names a canonical derivation; a dashboard that recomputes one creates a second implementation of domain logic — the failure mode this platform has already been bitten by, in both directions.

---

## 11. Corrections made under §N small-correction authority

| # | Correction | Evidence | Applied? |
|---|---|---|---|
| C-1 | `docs/financials/F14_SANDBOX_ACTIVATION_READINESS.md` §2 said "the `finance.visibility.*` ids are deliberately in NO environment activation registry today." That became false on 2026-09-01: `finance.visibility.consolidated` is in `config/environments.json` platform-sandbox `capabilityActivationOverrides` and in the `environmentCapabilityOverrides.ts` snapshot (commit `cc261540`, PR #1711) | `git log -S"finance.visibility.consolidated" -- config/environments.json` → 2026-09-01; both files read directly | **YES** — a stale current-state label. No authority, behaviour, role or capability changes; the sentence's own point (that a grant is still required) is preserved and sharpened |
| C-2 | ~~`environmentCapabilityOverrides.ts` asserts "`admin` and `owner` already hold this capability in their Role definitions" — no Role holds any `finance.visibility.*`.~~ **WITHDRAWN 2026-09-02: the source comment is CORRECT and this correction was the error.** | The grep evidence was the defect, not the finding: `ADMIN_ALL_PERMISSIONS = ADMIN_CURATED_PERMISSIONS + every PERMISSION_CATALOG id`, so all five scopes are real admin grants that appear as no literal. `ROLES.admin.permissions.includes("finance.visibility.consolidated") === true`, asserted by the already-green `financialVisibilitySandboxActivation.test.mjs` and re-proven by `functions/test/fin004ReachComposition.test.mjs` | **NO — and correctly so, for the wrong reason.** Not applying it was right; the stated reason was wrong. Nothing in Functions needed changing because nothing in Functions was wrong |
| C-4 | This census's own §1 result 1, §9 decision 1 and C-2 above, all resting on the same text-search measurement | `fin004-reach-reconciliation.md` §2–§4; matrix measured by resolver on `fd40ff5d`; 10 mutation-verified proofs | **YES** — withdrawn inline above and in the correction box at the head of this document. The census's fourteen financial rows keep their §3 classification (stated for the general principal) with the admin/owner sandbox exception named |
| C-3 | ND-25 (2026-08-30) recorded that the governed balance read "is also single-part (`PART_LIST_BALANCE_N1_GAP`), so it could serve the record long before it could serve the list." A batch read now exists | `functions/src/inventory/partBalanceBatchReadService.ts`; `functions/src/index.ts:471` exports `getPartBalancesCallable as getPartBalances` | **NO** — the ND register records the state at the time of a decision and is deliberately append-only history, not a live status board. Recorded in this census instead (I-1, AB-1) |

---

## 12. Validation

`scripts/dashboardCensus.test.mjs` proves the ten §L rules against the machine-readable companion
(`eos-dashboard-reporting-authority-census.json`) and against this document. Run:

```bash
node --test scripts/dashboardCensus.test.mjs
```

Deliberately not wired into CI — see the CI posture note at the top of this document.
