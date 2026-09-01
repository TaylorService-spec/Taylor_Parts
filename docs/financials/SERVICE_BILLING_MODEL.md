# Service Billing Model (F4)

**Status:** SO-anchored Billing Queue projection IMPLEMENTED (repository, dormant); the
service-work→billable bridge is an UNDECIDED Owner decision (FIN-BLOCK-002) and is
deliberately NOT built. Recorded 2026-09-01, overnight financials run phase F4.
**Authority sources composed (never re-decided):** DECISIONS #145 (EOS = operational
subledger), #154 (attribution + required company), FIN-001 FIN-GAP-014.

## 1. What "Billing Queue" governs today

The Billing Queue answers one operational question: **which commercial commitments have
billable work that is not yet billed?** Its implemented authority is
`functions/src/finance/billingQueue.ts` (`deriveBillingQueueEntry`) — a PURE read-side
composition of two already-governed authorities:

| Fact | Governed source |
|---|---|
| Eligibility (whether/how much may be billed) | `computeBillingEligibility` — the fulfillment→finance seam (fulfillment evidence + operational completion + holds) |
| Billed position (what has been billed) | Sales Order lines' `billedQty` — the projection `issueInvoice` maintains transactionally |
| Unbilled-eligible per line | `max(0, min(ordered, fulfilled) − billed)` — the SAME formula `issueInvoice` enforces as its `billableQty` cap, so the queue can never show as billable what issuance would refuse |
| Company | the SO's governed `operatingCompanyId`; when absent the entry is still SHOWN with an explicit "issuance will refuse (COMPANY_REQUIRED)" reason — backlog visibility is never suppressed, billing is |

Statuses (closed set): `NOT_READY · READY_TO_BILL · PARTIALLY_READY · HELD · CANCELLED ·
FULLY_BILLED`. A billed quantity exceeding fulfilled evidence is surfaced as a
reconciliation reason, never silently normalized.

**The queue carries NO amount, price, tax, or discount** (test-asserted). Quantities and
states only — pricing/amounts exist only at governed invoice issuance.

## 2. What is deliberately NOT built — the service-work bridge (FIN-BLOCK-002)

Work Orders carry zero monetary/billable facts, and no code path connects WO
COMPLETED/CLOSED to billing (FIN-001 FIN-GAP-014; labor is hours-only by ratified design).
Service work therefore **cannot enter the Billing Queue at all** — fail-closed by absence.
Nothing infers billability from WO status, route, location, or labor hours.

The bridge requires Owner decisions no repository fact can answer:

1. **What makes service work billable** — agreement-covered vs time-and-materials vs
   warranty vs no-charge/goodwill; where that classification is recorded and by whom.
2. **Price source for service billing** — labor rates (none exist; hours ≠ billable ≠
   cost), parts consumed on WOs, trip/travel treatment.
3. **Relation to SO-anchored billing** — does service billing flow THROUGH a Sales Order
   (service lines on an SO) or through a new governed billable-work record type feeding
   the same queue?
4. **Who approves** billable classification before it becomes an invoice candidate
   (composes FIN-007 approval governance).

Until these are ruled, any "service billing" number would violate invariant D (explicit
attribution, never inferred). The queue's design already accepts a future second input
type without redesign: a decided service model produces entries with the same status set
and the same no-amount discipline.

## 3. Invariants that bind any future service model

- Fail-closed: unclassified work is UNBILLABLE — absence of a decision is never "billable".
- Integer minor units at any future pricing point; no amounts in the queue itself.
- FIN-002 attribution: company/BU/credit from governed records; a service billable fact
  must name its governed source (`sourceType`/`sourceRecordId`), never the acting user.
- Hours ≠ billable ≠ cost ≠ revenue (labor domain boundary stays intact).
- HELD blocks billing, not visibility.
