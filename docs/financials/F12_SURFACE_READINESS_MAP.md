# F12 — Financials Product Surface Readiness Map

**Status:** MAP ONLY — no surface was built or altered in F12, and none may be built
autonomously: under the North Star three-authority model (DECISIONS #122), **visual
composition belongs to the Design authority**; minting twenty financial screens without
approved design sources would be Design inventing itself in code. Recorded as
FIN-BLOCK-005. Every section keeps its honest Frame 0 PlaceholderPage. Recorded
2026-09-01, overnight financials run phase F12.

This map states, per navigation section, WHICH governed dormant authority the surface will
bind to when its design source exists, and what else gates it. "Authority" = merged
repository code, all dormant (capabilities `active:false`, nothing granted, nothing
deployed). Every read composes FIN-004 visibility (`finance.read` + a scope — both
required).

| Section (path) | Backing authority (merged, dormant) | Gates beyond design + activation |
|---|---|---|
| Overview (``) | rollups over the below | everything below; margin/consolidated caveats apply |
| Billing Queue (`billing-queue`) | `billingQueue.ts` (F4) — SO-anchored statuses, no amounts | service work structurally absent — FIN-BLOCK-002 |
| Invoices (`invoices`) | `invoiceCommands.ts` + numbering + attribution (FIN-002) | — |
| Accounts Receivable (`accounts-receivable`) | `financeReadCallables.ts` scoped AR read (F2) + outstanding projection | COMPANY/BU visibility scopes — FIN-BLOCK-001 |
| Payments (`payments`) | `paymentCommands.ts` + F3 attribution | — |
| Credits & Adjustments (`credits-adjustments`) | `adjustmentCommands.ts` / `refundCommands.ts` + F3 attribution; FIN-007 approval machinery | approval policy values (FIN-007 §2) |
| Customer Financials (`customer-financials`) | AR read + attribution `customerId` grain | FIN-BLOCK-001 for non-consolidated principals |
| Sales to Goal (`sales-to-goal`) | `planVsActual.ts` (F6, GOAL) | plan storage + approval authority (FIN-007); BOOKED facts wiring |
| Cost to Budget (`cost-to-budget`) | `planVsActual.ts` (F6, BUDGET, COST basis) | **cost facts do not exist** — FIN-BLOCK-003; until ruled the surface can only show UNKNOWN |
| Forecasting (`forecasting`) | `forecasting.ts` (F7) | forecast storage; methodology policy |
| Gross Margin & Profitability (`profitability`) | `costMargin.ts` (F5) | FIN-BLOCK-003 — structurally UNKNOWN today, and must display as unknown, never 0% |
| Budget Management (`budgets`) | `planVsActual.ts` plan records (BUDGET) | storage; FIN-007 approval |
| Goal Management (`goals`) | `planVsActual.ts` plan records (GOAL) | storage; FIN-007 approval |
| Company & BU Performance (`company-performance`) | `summarizeByCompany` (F10) + FIN-002 dimensions | Consolidated column is typed UNELIMINATED_SUM — FIN-BLOCK-004; BU scope binding — FIN-BLOCK-001 |
| Salesperson & Employee Performance (`employee-performance`) | FIN-002 `creditedSalespersonId` snapshots + FIN-004 SELF/TEAM scopes | — |
| Reconciliation & Exceptions (`reconciliation`) | `financialReconciliation.ts` (F11, internal drift) | external reconciliation awaits the authority-of-record selection (#145) |
| Intercompany (`intercompany`) | none — deliberately | FIN-BLOCK-004: no intercompany record type may exist until the Owner rules treatment |
| Financial Audit & History (`audit`) | audit events + frozen attribution/approval/period records | — |
| Reporting & Exports (`reports`) | F13 reporting matrix (next phase) | export governance; invariant E (visibility follows the number into exports) |
| Financial Settings & Governance (`governance`) | FIN-007 policy lines, FIN-008 periods, activation state | Owner policy values (approval thresholds, close cadence) |

## Binding rules for every future surface

1. Compose the pure core — never re-derive amounts, margins, variances, or statuses in UI.
2. FIN-004: no financial fact renders without `finance.read` + reach; invariant E extends
   this to exports, search, dashboards, notifications.
3. UNKNOWN renders as unknown (never 0, never blank-as-zero); UNELIMINATED_SUM renders with
   its caveat; excluded facts render with their reasons.
4. Every new screen passes the impeccable + taste review bar, against an approved design
   source (FIN-BLOCK-005).
