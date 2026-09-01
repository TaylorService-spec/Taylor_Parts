# FIN-008 — Period & Close Governance (F9)

**Status:** period machinery IMPLEMENTED (repository, dormant — no storage, not composed by
any command path yet). Recorded 2026-09-01, overnight financials run phase F9.
**Authority sources composed:** DECISIONS #145 (EOS = operational subledger — this is the
OPERATIONAL reporting close, NOT an accounting close; the external authority of record,
not yet selected, owns that); #154 (per-company discipline); invariants B/C.

## 1. The machinery

`functions/src/finance/financialPeriods.ts`:

- **Period record** (`buildFinancialPeriod`, frozen): per operating company (Taylor's close
  is not Ventana's), inclusive ISO window, `OPEN | CLOSED`. A CLOSED period must carry who
  closed it, why, and when (ctx-supplied); an OPEN one must not. **REOPEN is deliberately
  unmodeled** — a closed period cannot be quietly reopened; reopening would be its own
  Owner decision.
- **Event guard** (`assertEventDateOpen`): a new financial event dated inside a CLOSED
  period of its company is REFUSED (`PERIOD_CLOSED`) — closed history is not writable;
  late facts go through the governed late-event path (FIN-007 approval + an adjustment in
  an open period), never slipped into closed history.
- **A close regime governs only what it declares:** an event date covered by NO declared
  period is ALLOWED — closing is an explicit act; the absence of a period record cannot
  retroactively close anything. Overlapping declared periods for one company are a thrown
  configuration defect (`PERIODS_OVERLAP`).

## 2. Owner-undecided (policy values)

- Close cadence (monthly/quarterly/annual) and calendar (fiscal = calendar?).
- WHO may close (capability/role — nothing minted or granted).
- Late-event policy detail (which adjustment types are legal against a closed window's
  facts, and in which open period they land).
- Which event date each fact class is judged by at composition time (booked vs issued vs
  applied vs effective) — the guard takes an explicit date + label per call site.

## 3. Composition contract

Invoice issuance, payment application, adjustments, and refunds compose
`assertEventDateOpen` at activation (F14); FIN-010 reconciliation reads closed windows as
its stable comparison base; F13 reporting labels closed vs open periods distinctly.
