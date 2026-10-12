---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-10-12
owner: Claude Code
related_adrs: []
depends_on: [docs/governance/eos-dashboard-composition-authority.md, docs/assessments/eos-dashboard-reporting-authority-census.md, functions/src/performance/performanceMetricRegistry.ts, functions/src/reportingPeriod/reportingPeriod.ts]
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Sprint Specification: Governed object-page metric charts — Financials first slice

**Architecture Review:** not yet held. **This is a draft and authorizes nothing.** It needs Owner approval of the
material architecture choice (§ Open questions, OQ-1/OQ-2) before an Implementation Plan is written.

## Executive summary

The Owner wants charts on object pages throughout EOS, scoped to the object being viewed: financials for Taylor and
Ventana with filtering between them, sales and pipeline, and service cost, margin and revenue. This spec defines **one
reusable chart section** for metadata-driven record pages, fed by **one governed time-series read**. The first slice is
a **Financials section on the Account page**: billed vs collected by month, with a Taylor / Ventana / Consolidated
filter and a governed reporting period.

Charts compose existing authority. They mint no capability, compute no money in the browser, and render UNKNOWN or
UNAVAILABLE honestly. Pipeline value and service cost, margin and revenue are **out of scope** because they are
blocked by open decisions (see the table at the end of § Scope), not by missing chart code.

## Sprint objective

An authorized viewer on an Account record page sees a Financials section with:

- a monthly billed vs collected bar chart over a selectable governed period (QTD / YTD / T12M);
- an operating-company filter: Taylor, Ventana, or Consolidated (labelled `UNELIMINATED_SUM`);
- three headline figures (billed, collected, collected ÷ billed), all computed server-side;
- the correct honest state whenever data is incomplete, unavailable, or not visible to them.

## Scope

1. **`MetricChart` record section.** A new `RECORD_SECTION` component registered through the existing extension point
   (`field-ops-app-vite/src/metadata/registry.js` `componentRegistry.register`), resolved by
   `MetadataRecordPage.jsx`. It follows the same adapter pattern as `accountPageComponents.js`. It is configured per
   page section with a list of `metricId`s, the record key it scopes by (e.g. `accountId`), and the allowed company
   filter mode.
2. **Account page wiring.** One new `componentId` section in the Account page definition, with a
   `capabilityRequirement` equal to the one the Account invoices/AR panel already uses. No new capability.
3. **Governed time-series read** (`readMetricSeries`). Server-side, at the viewer's own scope. Input: `metricIds`,
   record scope, `periodType`, `operatingCompanyId | "ALL"`. Output: per-bucket values per company and per currency, a
   completeness state, and the resolved period. Lives where OQ-1 decides.
4. **Metrics in this slice:** only the two already-ACTIVE registry metrics, `sales.billed.amount` and
   `sales.collected.amount` (`performanceMetricRegistry.ts:443,467`). Their `actualAuthority`, event time and rollup
   (`SUM`) are reused as declared, not redefined.
5. **Chart rendering:** inline SVG bars in a shared `src/shared/ui` primitive. **No chart library dependency.**

### What can be charted now

| Area | Status | Why |
|---|---|---|
| Billed and collected, Taylor / Ventana / Consolidated | **This slice** | Active metrics; financial facts carry the operating company |
| Work order queues, technician completion, PO metrics | Next slice, same section | Active metrics. Work orders and equipment carry `operating_company_key` in the PostgreSQL runtime (`1761004800000_work-order-object-authority.sql:121`), so a company split is available there |
| Pipeline value | Blocked | `expectedValue` has no currency and no weighting model (census G-18) |
| Service cost, margin, revenue | Blocked | Work orders carry no monetary facts (FIN-BLOCK-002); `deriveGrossMargin` returns UNKNOWN without governed cost (`costMargin.ts:59`); inventory valuation policy undecided |

## Explicitly out of scope

- Pipeline value, weighted forecast, stage probability, or any FORECAST / PREDICTION metric.
- Service cost, revenue or margin; inventory value / turns.
- Any new capability, role, grant, or `dashboard.*` permission (DECISIONS #161).
- Any `firestore.rules` change.
- Activating finance reach in production (`finance.read` / `finance.visibility.*`). This is a separate Owner decision.
- Chart sections on Work Order, Sales Order or Equipment pages (next slices; same component).
- Exports, saved charts, drill-through to transactions, and user-defined charts (the report creator, ADR-007, owns
  user-defined reporting).
- Any reconciled, GL or accounting-consolidated figure (#145; no accounting system is chosen).

## Technical design

### Read contract — `readMetricSeries`

An **aggregate contract, not a list contract**, on the model of `accountPortfolioSummary.ts:7-15`: no cursor, no page
size, no client-visible limit.

```
request  { metricIds: string[], scope: { kind: "ACCOUNT", id }, periodType: "QTD"|"YTD"|"T12M",
           operatingCompanyId: "taylor"|"ventana"|"ALL" }
response { state: "READY"|"UNAVAILABLE"|"NOT_VISIBLE",
           period: <ReportingPeriodResolution>,             // from resolveReportingPeriod (#163)
           buckets: [{ key: "2026-10", partial: boolean }], // calendar months, America/Phoenix
           series: [{ metricId, operatingCompanyId, currency,
                      values: (minorUnits|null)[] }],        // null = UNKNOWN for that bucket
           consolidated: { basis: "UNELIMINATED_SUM", series: [...] } | null }
```

Rules the read enforces:

- **Completeness or nothing (#172, census X-9).** If the read cannot establish the complete population for the request,
  it returns `UNAVAILABLE`. It never returns a smaller number labelled as a total.
- **Scope is the viewer's own.** It applies the same `finance.read` + `finance.visibility.*` evaluation the financial
  facts read already applies. If the viewer can see none of the population, it returns `NOT_VISIBLE`. If they can see
  part of it, the series covers only their reach, and the response says so: it is never presented as account-wide.
- **Event time and period** come from each metric's declared event time and `resolveReportingPeriod`. The current
  month is flagged `partial`.
- **Currency is never summed across currencies.** One series per currency (`formatByCurrency` precedent).
- **Consolidated** is computed server-side as an arithmetic sum of the per-company series, and labelled
  `UNELIMINATED_SUM` (FIN-BLOCK-004). It is not intercompany-eliminated.
- **Ratios** (collected ÷ billed) use `RATIO_OF_SUMS` and are computed server-side. They are never an average of
  monthly ratios.

### Client

- `MetricChart` takes `{ section, record }`, calls the read through a service client, and renders:
  - `READY`: bars plus headline figures and the period caption.
  - `UNAVAILABLE`: `HonestState UNAVAILABLE` ("Financials could not be read just now").
  - `NOT_VISIBLE`: "Not available to you" (design rule A-D2), never silence and never zero.
  - `null` bucket: a gap with an "Unknown" tooltip, never a zero-height bar.
- The company filter is a segmented control. "Consolidated" shows the `UNELIMINATED_SUM` annotation using the existing
  `FinAnnotation` wording from `FinancialsCompanyPerformance.jsx`.
- The period control reuses `FinancialsPeriodControl` / `useFinancialsPeriod`.
- No arithmetic on money in React. Display formatting only.

## Firestore Rules impact

None. Both `firestore.rules` copies are unchanged. The read runs server-side, and no client reads a new collection.

## UI impact

The Account record page gains one Financials section. The rest of the page is unchanged. Viewers without finance reach
see the section header with "Not available to you". The approved mockup (session of 2026-10-12) is the visual reference:
company and period segmented controls above, three headline metrics, monthly bars, and margin/pipeline shown as
Unknown / Not available yet with their reasons.

## Testing strategy

- **Server unit tests:**
  - bucketing at month boundaries in America/Phoenix;
  - partial current month;
  - multi-currency (no cross-currency sum);
  - Consolidated equals the sum of the company series;
  - `RATIO_OF_SUMS`;
  - an incomplete population returns `UNAVAILABLE`;
  - no reach returns `NOT_VISIBLE`;
  - partial reach is flagged.
- **Emulator / sandbox integration:** seeded synthetic invoices and payment applications for both companies; assert the
  series against hand-computed totals.
- **Client tests:** each honest state renders the right copy; a `null` bucket renders a gap, not a zero; no money
  arithmetic in the component (conformance test in the style of `dashboardDesignConformance.test.mjs`).
- **Regression:** existing Account page sections and the Financials module tests stay green; the Firebase exit guard
  reports 0 new violations.

## Rollback strategy

Fully reversible. Remove the section from the Account page definition and the read is no longer called. No migration,
no data write, no rules or permission change. Nothing in this slice is irreversible.

## Acceptance criteria

- [ ] `MetricChart` is registered via `componentRegistry` and rendered by `MetadataRecordPage` on the Account page.
- [ ] The section uses an existing capability requirement; no capability, role or grant is added.
- [ ] `readMetricSeries` returns `READY` / `UNAVAILABLE` / `NOT_VISIBLE` per the rules above, with tests for each.
- [ ] Billed and collected match hand-computed sandbox totals per company per month.
- [ ] Consolidated equals Taylor + Ventana and carries the `UNELIMINATED_SUM` label.
- [ ] No cross-currency sum; multi-currency renders separate series.
- [ ] Period windows come from `resolveReportingPeriod`; the current month is marked partial.
- [ ] An unknown bucket renders as a gap labelled Unknown, never as 0.
- [ ] No chart library added to `package.json`.
- [ ] The Firebase exit guard reports 0 new violations.

## Risks

- **Two finance stores.** Invoices and payments exist both in PostgreSQL (`1758931200000_invoice-authority.sql`,
  `1759017600000_ar-cash-application-authority.sql`) and behind the Firebase `listFinancialFacts` read, which the
  registry names as the `actualAuthority`. Charting the wrong store would show numbers that disagree with the
  Financials pages. OQ-1 must settle this first.
- **Firebase exit guard.** A new Firebase callable would add a server dependency against a baseline that "only
  shrinks". The read probably belongs in the EOS runtime.
- **Empty in production.** Finance reach is sandbox-only today, so the section renders "Not available to you" for
  everyone in production until the Owner activates reach. This is correct behaviour, but it should not be mistaken for a
  bug.
- **Stale planning docs.** The census and ownership-matrix notes still claim work orders have no company (reconciliation
  queued separately). Later slices must check the PostgreSQL runtime, not those notes.

## Open questions

- **OQ-1 (Owner / architecture): source of truth for billed/collected series.** PostgreSQL `invoices` / `payments`
  (aligned with Firebase retirement), or the Firestore facts behind `listFinancialFacts` (the registry's current
  `actualAuthority`)? *Recommendation:* PostgreSQL, with the registry's `actualAuthority` updated in the same change,
  provided it is confirmed to be the authoritative writer for issued invoices and payment applications.
- **OQ-2 (Owner / architecture): approve the pattern.** One `MetricChart` record section plus one aggregate
  `readMetricSeries` read, reused by later object pages.
- **OQ-3:** should partial reach (e.g. a sales manager who sees only their team's invoices on an account) render the
  partial series with a "your reach only" label, or `NOT_VISIBLE`? *Recommendation:* partial series with the label,
  matching #161 ("a fact the viewer can't see is ABSENT").
- **OQ-4 (later slices):** the FIN-BLOCK-002 service billing model, inventory valuation policy, and the
  `expectedValue` currency / weighting model gate the service and pipeline charts.

## Approval

Not approved. Requires Owner decision on OQ-1 and OQ-2 (material architecture), then Architecture Review, before an
Implementation Plan is written.

Developed under the direction of Rudy DiGiorgio using AI-assisted engineering tools.
