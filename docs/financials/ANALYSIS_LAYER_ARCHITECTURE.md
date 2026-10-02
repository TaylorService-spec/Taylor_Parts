# EOS Financial & Operational Analysis Layer — Architecture

**Status:** REQUIRED product architecture (Controller, 2026-10-01; DECISIONS #192). **Recorded, not implemented.**
**Governs alongside:** #145 (operational financial subledger), #190 (Taylor / Ventana / Saratoga / Rental), #191 (Finance
target model + billing authority). Companion: [`FINANCE_TARGET_PRODUCT_MODEL.md`](FINANCE_TARGET_PRODUCT_MODEL.md).

The Analysis Layer is **not a reporting add-on**. It is the governed management-analysis layer over EOS operational and
financial truth. It answers:

- What happened? Why did it happen?
- Where is money or capital tied up?
- What changed, and what is driving the change?
- Is it normal, or an exception? What requires attention?
- Which business records caused the result?
- What action can an authorized employee take?

## 1. Progression and sequence

```
FACTS → MEASURES → COMPARISONS → VARIANCES → DRIVERS → EXCEPTIONS → INSIGHTS → AUTHORIZED ACTIONS
```

**Program sequence (never inverted):**
GOVERNED FACTS → FINANCIAL CONSEQUENCES → MEASURES → ANALYSIS → PERSONA UI → OPTIONAL AI EXPLANATION.

AI is not required anywhere in this chain.

## 2. Analytical provenance (no unexplained dashboard math)

Every material KPI must trace:

KPI → MEASURE DEFINITION → CALCULATION → CONTRIBUTING FACTS → SOURCE TRANSACTIONS → ORIGINATING BUSINESS RECORDS.

**Each measure eventually states:**
- definition
- source of truth
- basis
- operating-company scope
- period
- dimensions
- comparison and variance
- drivers
- drill-down
- data quality / completeness
- actionability

**Basis classes, never combined:** ACCOUNTING ACTUAL · EOS OPERATIONAL ACTUAL · EOS OPERATIONAL ESTIMATE · FORECAST ·
TARGET / BUDGET.

- An operational estimate is never presented as formal accounting truth.
- Missing information is never turned into zero.

## 3. Dimensions and relationships

Analysis reaches its dimensions through **governed source relationships and provenance**, not by widening
`financial_facts`. A fact carries:
- its operating company and counterparty;
- its source domain, source record and source line;
- its amount, currency and basis;
- its effective time and recorded time;
- its correlation id and its reversal / correction links.

Every other dimension resolves through the source record.

| Dimension | Reached through |
|---|---|
| operating company | the fact |
| financial counterparty | the fact |
| commercial customer / site, salesperson, channel | Sales Order / Agreement / Opportunity |
| Work Order, technician / team, Work Type, billing responsibility | the Work Order record |
| Equipment, serialized asset, model / family | Equipment, serialized custody, catalog |
| Part, product family, vendor / supplier, warehouse, truck | ledger, receipt, catalog, supplier ↔ organization link |
| Purchase Order, receipt, inventory movement | source record / line |
| Rental Agreement | future Rental domain |
| quantity, unit price, cost basis | the source line, e.g. `inventory_acquisition_costs` |
| commercial disposition | the originating commercial record (#190 §11) |
| accounting reference | counterparty company profile; future outbox acknowledgement |
| data quality | exception records (e.g. `cost_evidence_exceptions`); future quality states |
| audit | fact `created_by`, `created_at`, `reason`; `eos_policy.audit_events` |

## 4. Analytical families (future)

- **Contribution economics:** REVENUE − direct equipment / part cost − direct labor − direct delivery / install − direct
  rental service cost = CONTRIBUTION MARGIN.
  - Only where governed allocation exists later: − attributable operating expense = OPERATING CONTRIBUTION.
  - No allocation policy is invented now.
  - Dimensions: customer, site, salesperson, channel, equipment family, Equipment, Part, Work Order type,
    technician / team, vendor, rental asset, operating company, direct vs financed, service type, disposition.
- **Price / cost / mix / volume:** decompose movement into PRICE, COST, MIX and VOLUME effects. Quantity, price, cost,
  product / customer and time provenance are preserved for this.
- **Margin leakage**, always classified as CONFIRMED, POTENTIAL, or AUTHORIZED / EXPECTED VARIANCE — not every variance
  is lost money. Signals:
  - out-of-range discount, price override
  - unbilled labor, parts consumed but not billed
  - delivery / install without the expected charge, missed travel charge
  - completed Work Order not billing-ready, fulfilled Equipment not financially cleared
  - rental deployed without billing eligibility
  - unexpected warranty / covered work
  - cost increase after quote
  - manual correction, unreconciled funding
- **Working capital (operational, never bank or GL authority):**
  - customer and Saratoga funding receivables, inventory, serialized equipment, rental fleet;
  - vendor obligations and payables, customer deposits, open purchasing and commercial commitments.
  - Measures: DSO, receivable and funding aging, inventory days and turns, payable days, cash-conversion-cycle
    components, slow / excess / dead / obsolete inventory, capital by warehouse / product family / company.
- **Inventory economics:**
  - quantity, operational cost basis, estimated capital deployed, turns, days on hand, demand velocity;
  - stockout frequency, slow / dead / excess / obsolete stock, emergency-purchase frequency;
  - supplier lead time, demand variability, service level, inventory variance, GMROI where appropriate.
  - OPERATIONAL INVENTORY VALUE ESTIMATE ≠ FORMAL ACCOUNTING VALUATION.
  - Missing cost stays visibly missing and never produces an artificial 100% margin.
- **Rental fleet economics (per serialized rental Equipment):**
  - acquisition cost, cost basis, revenue;
  - days owned / available / deployed / unavailable, service downtime;
  - maintenance, delivery, pickup and governed damage cost; swap / replacement history;
  - lifetime revenue and contribution, utilization, revenue per available / deployed day, maintenance per deployed
    day, payback, break-even, return on invested capital where appropriate, replacement economics.
  - Depreciation is not required; if introduced, its basis is labelled.
- **Customer contribution:**
  - equipment, service, parts and rental revenue / cost; discounts, covered work, delivery / install;
  - repeat and emergency visits, funding / payment behaviour, attributable direct cost.
  - Drill-down: CUSTOMER → SITE → TRANSACTION FAMILY → TRANSACTION → FACTS. No arbitrary overhead allocation.
- **Service job economics:**
  - expected vs actual labor and parts; billable vs absorbed labor and parts;
  - revenue, direct cost, contribution; travel, return visits, rework, first-time-fix;
  - warranty / contract / rental coverage.
  - Employee dimensions are used to understand process, training, complexity, reliability, routing and workload —
    never as simplistic rankings.
- **Quote-to-actual:** QUOTED → AGREED → ORDERED → FULFILLED → INSTALLED → BILLING READY → SENT TO ACCOUNTING →
  INVOICED / FUNDED → SETTLED.
  - Quoted vs final revenue, cost, margin and labor / parts; discount changes, corrections, funding differences.
- **Purchasing / vendor economics:**
  - volume, price trend, purchase price variance, lead-time performance / variance, fill rate, partial shipments;
  - receiving discrepancies, return / defect, emergency orders, concentration, operational landed cost;
  - unpriced-receipt frequency, reconciliation exceptions.
  - Taylor ↔ Ventana stays individually identifiable. Consolidated may eliminate correlated intercompany amounts but
    never destroys the company records.
- **Revenue quality:** by equipment / parts / service / installation / rental; direct vs Saratoga-financed; Taylor /
  Ventana / intercompany; recurring vs transactional; customer concentration; product family.
- **Cash / funding conversion:**
  - Saratoga: SALE / APPROVAL → FULFILLMENT → FUNDING ELIGIBLE → SUBMITTED → FUNDED → RECONCILED.
  - Direct: FULFILLMENT / SERVICE COMPLETE → BILLING READY → SENT TO ACCOUNTING → ACCOUNTING INVOICE → PAYMENT →
    RECONCILED.
  - Time at each stage, where value waits, the responsible workflow, amount, age and exception reason.
- **Forecast / target / actual:** ACTUAL, OPERATIONAL ESTIMATE, FORECAST and TARGET / BUDGET kept apart.
  - Forecasts carry version, creation time, assumptions / model, scope, period, source and comparison to actual.
  - The dormant forecasting engine is **not** activated.
- **Period comparison:** current, prior, prior year, rolling, target / budget, forecast. Absolute and percentage variance;
  driver decomposition where supported. No hard-coded calendar assumptions that would block company configuration.
- **Data quality / confidence states:** COMPLETE, ESTIMATED, PARTIAL, MISSING_COST, MISSING_PRICE, UNRECONCILED,
  STALE, PENDING_EXTERNAL_CONFIRMATION. Missing data is never hidden as zero.

## 5. Exception-first and actionability

Workspaces lead with:
- material exceptions and variances, stale items
- missing financial evidence, funding delays, reconciliation failures, margin leakage
- inventory risks, rental underutilization, service overruns, vendor issues

Each answers: what needs my attention, why, how much it matters, and what I can do.

Analysis links back to the operational records:

| Signal | Links to |
|---|---|
| leakage | WO / SO |
| unpriced receipt | PO / receipt |
| slow inventory | Part |
| funding delay | financed SO |
| underutilization | rental Equipment |
| intercompany mismatch | both correlated records |

Analytics may surface or recommend an action. It never bypasses EOS authority.

## 6. Deterministic first — AI optional

The full layer works with AI OFF. **EOS owns:**
- facts, measures and KPI calculations
- variances, rules and thresholds
- provenance and data-quality classification
- drill-down and governed actions

**Optional EOS AI may add:** explanation, summarization, driver narratives, anomaly explanation, question answering,
and suggested investigation or actions.

- AI never manufactures financial truth and gains no business authority.
- It stays an optional plug-in: local-first, approved rented compute when configured, governed context, auditable use.

## 7. Governed measure registry (future)

Each measure will carry:

| Element | Element |
|---|---|
| id | business name |
| description | formula |
| source facts | dimensions |
| time basis | company scope |
| basis class | quality requirements |
| comparison rules | drill-down target |
| visibility / authority | version |

One definition per KPI, so no two dashboards compute it differently. **Not built now.**

## 8. REQUIRED workstream — ANALYSIS UI / PERSONA ANALYTICS

This is purpose-built EOS UI and **required product work — not a post-launch nice-to-have. Not built in this package.**

| Persona | Experience (future) |
|---|---|
| **Owner / GM** (company selector: TAYLOR / VENTANA / CONSOLIDATED) | commercial activity, contribution, margin, working capital, receivables / funding, inventory capital, rental, service, purchasing / vendor, Saratoga, variances, exceptions, trends, drivers. Every material metric drills down. |
| **Finance / Accounting** (exception-first) | ready for accounting, open obligations, funding receivables, reconciliation, exceptions, missing cost / price, unbilled eligibility, intercompany mismatches, corrections, failed handoffs, aging, leakage |
| **Sales** | pipeline, booked, fulfilled, direct vs financed, quoted vs actual, margin / contribution, discounts, Saratoga status / funding, customer contribution, commercial exceptions |
| **Service** | job economics, labor, parts, billability, cost, contribution, rework, return visits, first-time-fix, coverage, billing responsibility, unbilled work, leakage |
| **Parts / Purchasing** | inventory economics, stockouts, slow / dead / excess, turns, days on hand, vendor performance, price changes, unpriced receipts, commitments, receiving discrepancies, capital tied up |
| **Warehouse / Inventory** | inventory by company, capital by location, movement, variance, cycle-count patterns, slow / excess, stockout risk, custody exceptions |
| **Rental** | fleet, availability, deployment, utilization, revenue, cost, contribution, downtime, payback, break-even, underutilized assets, return / exchange status |

**Design principle:** not a wall of charts. Use summary metrics, trend indicators, material variances, driver
explanations, exception queues, ranked issues, drill-down, record context and authorized actions.

**Contextual economics on records:**

| Record | Economics view |
|---|---|
| Customer | Customer Economics |
| Equipment | Equipment Economics |
| Work Order | Job Economics |
| Part | Inventory Economics |
| Rental Equipment | Rental Economics |
| Sales Order | Quote-to-Actual / Funding Economics |
| Vendor | Vendor Economics |
| Operating Company | Company Economics |

Plus the persona workspaces above. All of it is persona-driven, work-first, exception-first, responsive,
company-aware, authority-aware, record-linked, North-Star consistent, site-search integrated, and usable with AI
disabled.

**UI security:**
- Visibility follows EOS authority. An aggregate never grants access to the information under it.
- Company and consolidated visibility is permission-controlled.
- Drill-down enforces the same or stronger authority.
- No client-only hiding as security.

## 9. Performance / scale

KPIs are not computed by scanning transactional tables in the browser. Governed projections, materialized views,
summary tables, incremental aggregation and caches may be used; all remain derived, and every authoritative fact stays
traceable. UAT tests increasing volume and concurrency.

## 10. Analysis UAT (future)

Known source records must produce the expected facts, then the expected measure, variance, driver and drill-down.

Coverage also includes:
- missing cost and missing price
- reversal, correction, late-arriving data
- intercompany elimination, Taylor / Ventana separation, the Consolidated projection
- Saratoga funding, the rental lifecycle, service coverage
- large datasets

A dashboard number that cannot be traced to its contributing facts fails acceptance.

## 11. Foundation readiness check (Finance foundation `76335e8e`) — READY, no schema change

| Requirement | Preserved by | Status |
|---|---|---|
| Provenance / source identity | `financial_facts.source_domain`, `source_record_id`, `source_line`; idempotency key; acquisition-cost key `acq:<evidence id>` | READY |
| Company | `operating_company_id` NOT NULL, FK, never `consolidated`, frozen at write | READY |
| Counterparty | `counterparty_id` (external organization or internal company), per-company profiles | READY |
| Amount / currency | signed minor units, non-zero, ISO currency | READY |
| Basis | `basis` (e.g. `PURCHASE_ORDER_LINE_PRICE`) + `fact_class` (COMMITMENT / COST_EVIDENCE / OBLIGATION / SETTLEMENT) | READY (basis-class vocabulary is additive later) |
| Time | `effective_at` (financial effective time) + `created_at` (recorded time); source event time on the source record | READY (late-arriving data is visible as recorded vs effective) |
| Correlation | `correlation_id` (PO id for acquisition cost; intercompany pair id) | READY |
| Reversal / correction | `reverses_fact_id` (at most once, exact opposite), `corrects_fact_id`, `reason`; originals immutable | READY |
| Obligation relationships | obligation → facts (origination / settlement), derived balances, kind ↔ counterparty fit | READY |
| Data-quality exception path | `cost_evidence_exceptions` (COST_EVIDENCE_MISSING per receipt line); no zero-cost fact possible | READY (further quality states are additive) |
| Quantity / unit price / supplier / location for cost | the immutable source line `eos_finance.inventory_acquisition_costs` (append-only), reachable by receipt + line | READY |

**No Foundation correction is needed.** Nothing would be irreversibly lost:
- Every dimension not on the fact is held by an immutable or governed source record the fact names.
- Future vocabularies (basis classes, quality states, exception resolutions) are additive: new columns with safe
  defaults, or new tables.

Deliberately not added (no speculative schema): quantity / price / dimension columns on facts, a basis-class column,
measure tables, projections.

**Deferred dependencies** — owned by later packages, not the foundation:
- **Equipment:** owner / custodian / disposition fields (#190 §14), serial ↔ cost-evidence link.
- **Service economics:** billing responsibility, labor cost rates, pricing (deferred service billing policy).
- **Rental:** Rental domain and agreements (deferred rental billing rules).
- **Saratoga:** Financing Relationship, funding package (deferred workflow / title details).
- **Intercompany:** correlation record and pairing (target-model step 8).
