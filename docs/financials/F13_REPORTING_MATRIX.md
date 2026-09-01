# F13 — Financials Reporting Matrix

**Status:** the honest capability matrix for the approved reporting axes (Frame 0 baseline
§"Required reporting axes") against merged repository authority. Everything is DORMANT
(no activation, no deployment, no data); "supported" means the governed derivation exists
and is tested. Recorded 2026-09-01, overnight financials run phase F13.

## Axis support

**Company** — every reportable event carries a REQUIRED `operatingCompanyId` (FIN-002
snapshots; F3 stamped it on payments/adjustments/refunds). Per-company rollups are exact
(`summarizeByCompany`); **Consolidated is typed `UNELIMINATED_SUM`** and must render with
that caveat until FIN-BLOCK-004 rules elimination.

**Business Unit** — line-level on commercial orders (mixed orders bill mixed units);
invoice headers deliberately `null`. BU reporting is line-grain; BU-scoped *visibility*
awaits FIN-BLOCK-001.

**Person / Responsibility** — `creditedSalespersonId` frozen at event time (OWNERSHIP ≠
SALES CREDIT; never the acting user); `responsibleEmployeeId` honestly nullable.
SELF/TEAM visibility enforced (F2); historical credit never rewritten by owner changes
(invariant B).

**Period** — every event carries ctx-supplied server event time (`bookedAtMillis`,
`eventAtMillis`, `recordedAtMillis`); FIN-008 periods gate writes per company once
activated. Month/quarter/YTD/custom grouping is presentation over these timestamps;
closed vs open windows must be labeled distinctly.

**Financial basis** — the load-bearing axis (invariant A: compared, never blended):

| Basis | Governed source | Status |
|---|---|---|
| Booked | FIN-002 `bookedAtMillis` at agreement acceptance | SUPPORTED (dormant) |
| Billable | `billingQueue.ts` unbilled-eligible quantities (no amounts) | SUPPORTED for SO-anchored work; service work absent (FIN-BLOCK-002) |
| Billed | issued invoices (server-recomputed amounts) | SUPPORTED (dormant) |
| Collected | payment applications, F3-attributed | SUPPORTED (dormant) |
| A/R | derived outstanding (facts formula) + F11 drift check | SUPPORTED (dormant) |
| Cost | FIN-006 governed cost facts | **STRUCTURALLY UNKNOWN** — no cost facts exist (FIN-BLOCK-003) |
| Gross margin | `deriveGrossMargin` | **STRUCTURALLY UNKNOWN** — same |
| Goal / Budget | FIN-003 versioned plans (APPROVED only measures) | SUPPORTED core; storage + approval authority pending (FIN-007 values) |
| Forecast | FIN-005 as-of-stamped records | SUPPORTED core; methodology pending |
| Reconciled accounting fact | external authority of record | **ABSENT BY DECISION** — authority not yet selected (DECISIONS #145); nothing may masquerade as reconciled |

## Rendering rules (bind on every report/export)

1. One basis per figure, labeled; cross-basis comparison uses the F6/F7 comparison cores
   (mismatch throws — a report cannot silently blend).
2. UNKNOWN is rendered as unknown; UNELIMINATED_SUM carries its caveat; exclusions render
   with reasons; A/R pages that would truncate render "unavailable", never a partial
   "ready" (F2 bounded-read honesty).
3. Invariant E: every report and export path composes FIN-004 visibility — the export of a
   number is the number.
4. No report reads a raw collection: reports compose the pure cores and the trusted read
   callables only.
