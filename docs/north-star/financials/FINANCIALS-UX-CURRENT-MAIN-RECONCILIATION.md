# Financials North Star P1 — Current-Main Authority Reconciliation

Date: 2026-09-01 · Reconciled against origin/main `dfb362d5e863472f0dd55b7121f4103f5d9cdba7`
Status: **CURRENT-MAIN AUTHORITY RECONCILIATION: COMPLETE** · Design direction: **APPROVED** (unchanged) · Implementation composition map: **READY**

The Design package (this folder) was corrected 2026-09-01 *before* the overnight Financials implementation fully landed. Its per-page handoffs still describe FIN-003…FIN-010 as `OPEN`. That wording is stale. This document is the binding reconciliation: **current repository authority wins for system behavior; the approved visual composition is unchanged** except the three visible deltas listed below.

## Classification vocabulary

`IMPLEMENTED` · `BUILT_DORMANT` · `NOT ACTIVATED` · `NOT USER-EXPOSED` · `POLICY NOT CONFIGURED` · `DATA SUPPLY MISSING` · `FUTURE INTEGRATION` · `UNKNOWN` · `UNELIMINATED_SUM` · `DENIED`

## Authority truth table (current main)

| Authority | Handoff said | Current truth | Evidence |
|---|---|---|---|
| FIN-001 Authority map | COMPLETE | IMPLEMENTED | `docs/financials/FIN-001_FINANCIAL_AUTHORITY_MAP.md` |
| FIN-002 Reporting attribution | COMPLETE | IMPLEMENTED (attribution facts on invoice records; creditedSalespersonId ≠ ownership; line-level BU; integer minor units) | `functions/src/finance/financialAttribution.ts` |
| FIN-003 Plan vs Actual | OPEN | BUILT_DORMANT + DATA SUPPLY MISSING (record build/compare core merged; **no collection, no command, no read callable**) | `functions/src/finance/planVsActual.ts` |
| FIN-004 Financial visibility | OPEN | IMPLEMENTED server-side, NOT ACTIVATED (5 scopes + 5 capabilities exist, all `active:false`; FIN-BLOCK-001 **CLOSED** — governed `operatingCompany`/`businessUnit` scope bindings, DECISIONS #157) | `functions/src/finance/financialVisibility.ts`, `financeReadCallables.ts` |
| FIN-005 Forecast | OPEN | BUILT_DORMANT + POLICY NOT CONFIGURED (record/version/as-of core merged; **methodology is an unconfigured policy**; no storage/callable) | `functions/src/finance/forecasting.ts` |
| FIN-006 Cost & margin | OPEN | BUILT_DORMANT + DATA SUPPLY MISSING (derivation core merged; margin = UNKNOWN unless every governed cost fact exists; cost-fact supply = FIN-BLOCK-003, Owner decision) | `functions/src/finance/costMargin.ts` |
| FIN-007 Approval/exception | OPEN | BUILT_DORMANT + POLICY NOT CONFIGURED (mechanism merged; self-approval forbidden; missing policy fails closed; thresholds/roles/escalation unconfigured) | `functions/src/finance/financialApprovals.ts` |
| FIN-008 Period & close | OPEN / "AUTHORITY NOT IMPLEMENTED" | BUILT_DORMANT + POLICY NOT CONFIGURED (OPEN/CLOSED per company; close preserves actor/time/reason; closed-period writes refuse; reopen not modeled; cadence/closer/late-event policy unconfigured; no storage yet) | `functions/src/finance/financialPeriods.ts` |
| FIN-009 Allocation/intercompany | OPEN | BUILT_DORMANT; consolidated = **UNELIMINATED_SUM** until elimination policy exists; intercompany treatment = FIN-BLOCK-004 (Owner) | `functions/src/finance/financialAllocation.ts` |
| FIN-010 Reconciliation | OPEN | Internal operational reconciliation: BUILT_DORMANT + NOT USER-EXPOSED (IN_SYNC/DRIFT core merged, no results surface). External accounting reconciliation: **FUTURE INTEGRATION** (no accounting authority selected) | `functions/src/finance/financialReconciliation.ts` |
| Invoice/payment/adjustment/refund commands | BUILT_DORMANT | BUILT_DORMANT + NOT ACTIVATED (5 callables exported, capabilities `active:false`, EXPORT ≠ DEPLOY) | `functions/src/finance/*Callables.ts` |
| Finance read (`listAccountInvoiceAr`) | "read activation pending" | BUILT_DORMANT + NOT ACTIVATED — the **only** wired client read chain (`useAccountAr` → `financeReadCallableClient` → callable). DENIED = thrown `permission-denied`; distinct from `unavailable`. | `field-ops-app-vite/src/hooks/useAccountAr.js` |
| Payments / corrections reads | — | NOT USER-EXPOSED (command cores merged; **no read callable exists**) | recon report |
| Service billing readiness | FIN-AG-SERVICE-BILLING-READINESS | Unchanged: FIN-BLOCK-002 (Owner decision package prepared, no policy coded) | `docs/financials/FIN-BLOCK-002_SERVICE_BILLING_DECISION_PACKAGE.md` |
| Unapplied-cash workflow | FUTURE AUTHORITY | Unchanged: FUTURE (over-application refused today; FIN-PQ-UNAPPLIED-POLICY open) | `functions/src/finance/paymentCommands.ts` |

## Capability truth (exact ids, all `active:false`)

`finance.invoice.issue` · `finance.payment.apply` · `finance.adjustment.record` · `finance.refund.record` · `finance.read` · `finance.visibility.self` · `finance.visibility.team` · `finance.visibility.businessUnit` · `finance.visibility.company` · `finance.visibility.consolidated`

Design's conceptual capability names (invoice-create, payment-record, correction-approve, …) are **not** implementation ids. UX consumes only the ids above; no new capability is minted in UX PRs. Nav gating stays at the placeholder default (admin/dispatcher) per `test/financialsNavStructure.test.mjs` — FIN-004 data authorization is server-side.

## Visible design deltas applied in this pass (installed sources edited in place)

1. **Page 16 Reconciliation** — split into two sections per current FIN-010 truth: **Operational integrity** (internal IN_SYNC/DRIFT, BUILT_DORMANT, only actual governed results ever render) and **External accounting reconciliation** (FUTURE INTEGRATION, no accounting authority selected; dimmed structural specimen retained). Desktop + 375 both updated.
2. **Page 20 Governance** — period row corrected from `AUTHORITY NOT IMPLEMENTED` to `Built dormant · Policy not configured` with the full FIN-008 truth in the tooltip; cost/goal/budget/correction rows likewise reclassified `Built dormant` (+ policy/data caveat); state strip gains `BUILT_DORMANT`. 375 list updated.
3. **Page 10 Forecasting** — no visual change (composition approved as drawn). Binding update only: forecast domain/version/as-of core EXISTS (BUILT_DORMANT); methodology remains unconfigured — method cells keep reading `Method TBD — FIN-005`. `Opportunity.expectedValue` is never promoted to forecast revenue.
4. **Page 05 Payments** — approved as drawn; unapplied cash stays labelled FUTURE AUTHORITY; not operationalized.

Frames under `frames/` predate deltas 1–2 (16/20 PNGs show the pre-reconciliation composition); the edited `.dc.html` sources are the design authority for those two pages.

## Implementation composition rules (binding for all UX waves)

- UI **composes** authority, never recreates it: no client-side financial filtering as authority, no second calculators, no raw reads of deny-all collections (`invoices`, `payments`, `payment_applications`, `invoice_adjustments`, `refunds`).
- All authoritative money stays integer minor units; display via `src/domain/money.js` / `moneyDisplay.js` only.
- Missing authority renders its named honest state (`HonestState`: DENIED / NOT_ENABLED / UNAVAILABLE / UNKNOWN…), never zeros, never specimen fixture values ($412,800 / $231,900 / $425,000 … are design specimens only).
- UNKNOWN margin stays UNKNOWN; consolidated stays UNELIMINATED_SUM with its caveat; internal vs external reconciliation never conflated; future payment behavior not enabled.

## Blocker register (this run)

- FIN-BLOCK-001 — CLOSED (DECISIONS #157) before this run; UX consumes the canonical binding.
- FIN-BLOCK-002/003/004 — OPEN (Owner decision packages); blocked functionality renders truthfully, never fabricated.
- FIN-BLOCK-005 (Design availability) — **CLOSED by this install**: the approved Financials P1 design package is now in-repo at `docs/north-star/financials/`.
