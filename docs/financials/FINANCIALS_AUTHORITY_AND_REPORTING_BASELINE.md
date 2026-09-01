# Financials Authority & Reporting Baseline

**Status:** Frame 0 (navigation/presentation structure only) — recorded 2026-08-30
**Structure:** `field-ops-app-vite/src/navigation/navConfig.js` (the `financials` NAV_DOMAINS domain)
**Structural contract:** `field-ops-app-vite/test/financialsNavStructure.test.mjs`

Financials is now a first-class EOS domain with twenty addressable sections. **No item
below is considered implemented merely because its destination now exists in navigation.**
Every section renders an honest PlaceholderPage stating that its authority is not built.
Navigation visibility is NOT financial data authority: every eventual Financials read or
write must independently enforce governed financial visibility and scope.

## Open authority workstreams

| ID | Workstream | Status |
|---|---|---|
| FIN-001 | Financial Authority & State Model | **COMPLETE** (audit: [FIN-001_FINANCIAL_AUTHORITY_MAP.md](./FIN-001_FINANCIAL_AUTHORITY_MAP.md); authority mode ratified — EOS = governed operational financial subledger, external accounting = future authority of record (not yet selected), GL in EOS out of scope; DECISIONS #145) |
| FIN-002 | Reporting Attribution Model | **COMPLETE** (repository authority — [FIN-002_REPORTING_ATTRIBUTION_MODEL.md](./FIN-002_REPORTING_ATTRIBUTION_MODEL.md); DECISIONS #154; canonical `financialAttribution.ts`; creation paths preserve truthful attribution; visibility/exposure stays FIN-004; backfill plan only, not executed) |
| FIN-003 | Plan vs Actual Model | **OPEN** |
| FIN-004 | Financial Visibility Model | **IMPLEMENTED** (server-enforced scope model — [FIN-004_FINANCIAL_VISIBILITY_MODEL.md](./FIN-004_FINANCIAL_VISIBILITY_MODEL.md); DECISIONS #156; SELF/TEAM/CONSOLIDATED enforced, COMPANY/BU principal-binding blocked on the Owner's access-scope ruling FIN-BLOCK-001; all capabilities `active:false`, nothing granted) |
| FIN-005 | Forecast Model | **OPEN** |
| FIN-006 | Cost & Margin Authority | **INVARIANT CORE IMPLEMENTED** (margin = governed cost facts only, else UNKNOWN — [FIN-006_COST_MARGIN_MODEL.md](./FIN-006_COST_MARGIN_MODEL.md); cost supply undecided — FIN-BLOCK-003) |
| FIN-007 | Adjustment / Approval / Exception Governance | **OPEN** |
| FIN-008 | Period & Close Governance | **OPEN** |
| FIN-009 | Allocation & Intercompany Governance | **OPEN** |
| FIN-010 | Reconciliation / Traceability / Audit | **OPEN** |

## Approved reporting requirements

The reporting spine is:

```
Company -> Business Unit -> Responsible/Credited Person -> Financial Event
```

and the basis separation rule is:

```
Actual != Forecast != Budget != Goal != Reconciled Accounting Fact
```

They may be compared but never silently blended.

### Required reporting axes (recorded now, NOT implemented)

These are stable dimensions the Financials model must eventually support. They must NOT be
implemented as mutable UI-only filters backed by guessed fields.

- **Company:** Consolidated · Taylor · Ventana
- **Business Unit:** Service · Equipment Sales · Parts · Installation · future governed units
- **Person / Responsibility:** salesperson · responsible employee · team · manager where appropriate
- **Period:** month · quarter · YTD · year · custom
- **Financial basis:** booked · billable · billed · collected · A/R · cost · gross margin ·
  goal · budget · forecast · reconciled accounting fact

## Governing financial invariants

**A. ACTUAL != FORECAST != BUDGET != GOAL != RECONCILED ACCOUNTING FACT.** They may be
compared but never silently blended.

**B. HISTORICAL STAYS HISTORICAL.** Changing customer owner, employee assignment,
business-unit assignment, company ownership, sales credit, a goal, or a budget must not
silently rewrite historical financial attribution.

**C. ISSUED FINANCIAL EVENTS ARE HISTORY.** Corrections create governed adjustment events
rather than modifying the original historical event in place.

**D. REPORTING ATTRIBUTION MUST BE EXPLICIT.** Do not infer: Taylor vs Ventana from
warehouse/location names; salesperson from current `Customer.owner`; business unit from a
route name; reporting period from UI state; cost from retail price; margin from incomplete
cost sources.

**E. VISIBILITY FOLLOWS THE NUMBER EVERYWHERE.** If a principal cannot view margin, cost,
budget, A/R, or another employee's performance in Financials, that same principal must not
receive the restricted fact through Sales Order, Agreement, Customer, Work Order,
dashboards, reports, exports, APIs, search, or notifications.

## Access posture (Frame 0)

The future Financial Visibility capability model — `financial.reporting.self/team/
businessUnit/company/consolidated.read`, `financial.revenue/cost/margin/budget/goal/
forecast/ar/payment.read`, `financial.goal/budget/adjustment/reconciliation/governance.
manage` — is a **design input for FIN-001/FIN-004**, not something Frame 0 declares. No
capability identifier was created; no Financials nav item declares `capabilityAccess`.
Every section takes the repository's existing conservative no-legacyKey compatibility
default (`PLACEHOLDER_DEFAULT_ROLES`: admin/dispatcher; technicians excluded). No existing
role's access was broadened.

## Section responsibility map

| Section | Responsibility |
|---|---|
| Overview | Read-only management rollup. |
| Billing Queue | Operational readiness between fulfilled/billable work and invoice issuance. |
| Invoices | Issued invoice lifecycle and lineage. |
| Accounts Receivable | Issued unpaid obligations and aging. |
| Payments | Payment receipt/application/reconciliation. |
| Credits & Adjustments | Explicit correction events. |
| Customer Financials | Customer-grain financial rollup. |
| Sales to Goal | Actual performance versus approved goal. |
| Cost to Budget | Actual cost versus approved budget. |
| Forecasting | Expected future performance; never actual. |
| Gross Margin & Profitability | Revenue minus governed authoritative cost. |
| Budget Management | Versioned planning authority. |
| Goal Management | Versioned target authority and measurement basis. |
| Company & Business Unit Performance | Taylor/Ventana/consolidated and Service/Sales/etc reporting. |
| Salesperson & Employee Performance | Governed person-attributed performance. |
| Reconciliation & Exceptions | EOS versus external accounting discrepancies/freshness. |
| Intercompany | Cross-operating-company financial treatment. |
| Financial Audit & History | Attribution, approval, adjustment, plan and event lineage. |
| Reporting & Exports | Governed query/export surface. |
| Financial Settings & Governance | Authorized configuration only. |

## What Frame 0 explicitly did NOT do

No Firestore collections, Functions, or Rules changes; no financial calculations; no
fabricated invoice/payment/A/R/budget/goal data; no capability identifiers; no permission
expansion; no change to existing Sales Agreement / Sales Order / Work Order authority; no
accounting/GL authority; no financial writes; no dashboards over synthetic numbers.
`AccountFinancialsSection` and the existing Sales/AR authority are untouched.
