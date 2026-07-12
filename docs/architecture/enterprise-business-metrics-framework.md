# Enterprise Business Metrics Framework

Status: **Proposed — Pending Architecture Review — NOT binding.** No section of this document may be cited as settled, and no Specification or Implementation Plan may proceed based on it, until it is formally Accepted.
Scope: Platform-wide — Enterprise Operations OS, company-neutral. Taylor Parts is the first deployment, not a special case.
Depends on: `docs/BusinessEntityModel.md` (entity definitions), `docs/architecture/SYSTEM_AUTHORITIES.md` ("who owns what" pattern this document extends into financial ownership)
Prompted by: `docs/assessments/customer-account-business-model.md`'s finding that no authoritative sales/revenue amount exists anywhere in the current Taylor Parts implementation, and that "Sales Summary" cannot be built without first deciding what "sales" means

**This document defines architecture and semantics. It does not implement any domain, collection, or field described below** — see Section 17.

## 1. Purpose

This document establishes the canonical business terminology, financial ownership rules, lifecycle definitions, KPI semantics, and reporting standards used across the Enterprise Operations OS.

- Every financial amount must have a clearly defined business meaning.
- Every amount must have one authoritative owning domain.
- Operational documents must not compete as duplicate sources of truth.
- Historical financial events must remain auditable.
- Dashboards and AI features must use standardized metric definitions.

A platform that lets any domain write an ambiguous `sales`, `revenue`, `amount`, or `pending` field accumulates competing, silently-disagreeing numbers the moment more than one domain needs to report on money. This framework exists to prevent that class of defect architecturally, before any such field is written.

## 2. Revenue Lifecycle

Canonical lifecycle:

```
Lead
  → Opportunity
  → Quote
  → Sales Order
  → Fulfillment / Work Order
  → Invoice
  → Payment
  → Credit or Adjustment (when applicable)
```

Primary amount owned at each stage:

| Stage | Primary amount |
|---|---|
| Opportunity | `estimatedRevenue` |
| Quote | `quotedRevenue` |
| Sales Order | `bookedRevenue` |
| Fulfillment / Work Order | `fulfilledServiceValue` *(conditional — see below)* |
| Invoice | `invoicedRevenue` |
| Payment | `collectedRevenue` |
| Credit Memo | `creditedRevenue` |

Each stage owns its own financial truth and must not overwrite the amount owned by another stage. A later stage may *reference* an earlier stage's amount (e.g. an Invoice referencing the Sales Order it bills against) but never silently mutates it.

**Fulfillment / Work Order is not automatically a financial stage.** Fulfillment is evidence that work happened, not evidence of revenue — it only carries a dollar amount (`fulfilledServiceValue`) when an authoritative customer-price source (e.g. a Sales Order's booked line values) actually exists for what was fulfilled. Without one, this stage produces **operational counts only** — `Completed Work Orders` / `Open Work Orders` — never a dollar figure, never labeled "revenue," and never substituted for one. See Section 3's "Fulfilled Service Value" and "Completed Work Orders / Open Work Orders" entries, and Section 17's Taylor Parts grounding (today, no authoritative price source exists for any Work Order, so only the operational-count form applies).

## 3. Canonical Metric Definitions

### Open Pipeline

Potential revenue associated with active opportunities.

**Authoritative owner:** Opportunity domain.

Rules:
- Includes only qualifying open opportunities.
- Must not be treated as booked or recognized revenue.
- May be weighted separately by probability.
- Cancelled, lost, or disqualified opportunities are excluded from active pipeline.

### Quoted Revenue

The value presented to a customer in an active quote.

**Authoritative owner:** Quote domain.

Rules:
- Must preserve quote revisions or versions.
- Superseded quotes must not be counted as simultaneously active.
- Quote acceptance does not itself constitute invoiced or collected revenue.

### Booked Revenue

Customer-committed value from an accepted order or equivalent binding commitment.

**Authoritative owner:** Sales Order domain.

Rules:
- Becomes booked only after the configured acceptance threshold is met.
- Changes after booking require an amendment, cancellation, or adjustment event.
- Booked revenue is not the same as fulfilled, invoiced, or collected revenue.

### Committed Backlog

Booked revenue not yet fulfilled.

```
committedBacklog = bookedRevenue - fulfilledServiceValue - cancelledUnfulfilledRevenue
```

The exact derivation may be line-based when partial fulfillment is supported (see Section 10) — this top-level formula is the platform-wide invariant; a deployment's actual computation may sum it per line rather than as one subtraction against three aggregate totals. `fulfilledServiceValue` here is the conditional metric defined immediately below — where no authoritative price source exists for fulfillment, this formula cannot resolve to a dollar figure at all, and Committed Backlog must not be computed or displayed as if `fulfilledServiceValue` were `0` (that would misrepresent unpriced completed work as work that reduced backlog by nothing, which is not a known fact).

### Fulfilled Service Value (conditional — requires an authoritative price source)

Dollar value of goods delivered or services completed, **only when an authoritative customer-price source exists** for what was fulfilled (e.g. a Sales Order's own booked line values, or a priced Quote that was accepted). This is not the same concept as "fulfillment happened" — it is "fulfillment happened *and* we know what it was worth to the customer."

**Authoritative owner:** Fulfillment or Work Order domain, sourced from the priced commitment it fulfills (Sales Order/Quote), never invented independently at the fulfillment stage.

Rules:
- Must support partial fulfillment.
- Must be derived from fulfilled line quantities or accepted service completion, valued against the authoritative price source's own line prices — never a new, independently-estimated price.
- Must not exceed the active booked value without an approved amendment.
- **Must not be computed, displayed, or stored when no authoritative price source exists.** In that case, use Completed Work Orders / Open Work Orders instead (below) — never a fabricated or estimated dollar figure, and never `$0` standing in for "unknown."
- **"Recognized Revenue" remains prohibited** as a name for this or any other metric until an implemented accounting authority defines it (Section 12, ADR-BMF-010) — Fulfilled Service Value is a commercial/operational figure, not an accounting recognition event.

### Completed Work Orders / Open Work Orders (operational counts — not revenue)

Operational activity counts of Work Orders by status (Section 2's Fulfillment/Work Order stage), used **only** when no authoritative price source exists for what was fulfilled — the unconditional, always-available alternative to Fulfilled Service Value.

**Authoritative owner:** Fulfillment or Work Order domain.

Rules:
- **`Completed Work Orders` and `Open Work Orders` are operational activity metrics. They are not sales, revenue, financial totals, or financial proxies of any kind.**
- **A count and a dollar metric must never share a label, and one must never be substituted for the other** — a dashboard, API response, or UI component may show both side by side, clearly separately labeled, but must not merge them into one figure or imply a count "stands in for" a dollar amount.
- `Completed Work Orders` = Work Orders in a terminal-and-fulfilled state (e.g. `COMPLETED`/`CLOSED` in Taylor Parts' own `WorkOrderStatus`, per Section 17); a cancelled Work Order is excluded from this count, the same exclusion Section 7 requires for cancelled commercial records.
- `Open Work Orders` = Work Orders in any non-terminal, non-cancelled state.
- These counts may be surfaced under a clearly separate label such as **"Service Activity"** (see Section 17) — never inside a "Sales" or "Revenue" section or KPI list.

### Invoiced Revenue

Value formally billed to the customer.

**Authoritative owner:** Invoice domain.

Rules:
- Posted invoices are immutable.
- Corrections require voids, credit memos, replacement invoices, or other auditable adjustments.
- Tax must be stored separately from revenue unless a jurisdiction-specific rule explicitly requires otherwise.

### Cash Collected

Customer payments successfully received and applied.

**Authoritative owner:** Payment or Accounts Receivable domain.

Rules:
- Must support partial payments.
- Must distinguish received, unapplied, applied, reversed, refunded, and failed payments.
- Cash Collected must not be inferred from invoice status alone.

### Outstanding Receivables

Amount invoiced but not yet collected.

```
outstandingAR = postedInvoiceSubtotal
               - appliedPayments
               - appliedCredits
               - approvedWriteOffs
               + validAdjustments
```

### Credited Revenue

Value reduced through an approved credit memo or equivalent adjustment.

**Authoritative owner:** Credit Memo or Financial Adjustment domain.

### Invoiced Net Sales

```
invoicedNetSales = postedInvoiceRevenue - postedCredits
```

Invoiced Net Sales is a billing-domain figure, not a cash figure — it must be clearly distinguished from cash actually collected (see Cash Collected above).

## 4. Meaning of "Sales"

The platform must not expose an unlabeled generic **"Sales"** KPI in architecture, APIs, analytics contracts, or reusable UI components.

Every displayed **financial** metric must use an explicit canonical label:

- Open Pipeline
- Quoted
- Booked
- Committed Backlog
- Invoiced
- Cash Collected
- Invoiced Net Sales

A deployment may configure one of these as its primary executive sales KPI (Section 15), but the underlying canonical metric name must remain explicit — the configured *default view* does not get to rename the metric it displays.

**`Completed Work Orders` and `Open Work Orders` are never part of this list.** They are operational activity counts (Section 3), not financial metrics — they must not appear in a "Sales" KPI set, must not be offered as a configurable "primary sales KPI" (Section 15), and must not be relabeled as if they were a dollar figure. Where fulfillment has no authoritative price source (Fulfilled Service Value cannot be computed, Section 3), these counts are the *only* thing this stage may display — but they display as their own, separately-labeled operational fact, never as a stand-in "Sales" number.

## 5. Meaning of "Pending"

**"Pending" is prohibited as a standalone financial metric** because it is ambiguous — pending what, at which stage, blocking which party?

Use explicit states instead:

- Pending Quote Approval
- Pending Customer Acceptance
- Pending Fulfillment
- Pending Invoice
- Pending Payment
- Pending Credit Approval

Each pending metric must identify:
- the domain,
- the lifecycle state,
- the authoritative amount,
- the date basis,
- and the inclusion and exclusion criteria.

## 6. Authoritative Amount Ownership

Copying an amount into another domain for display, caching, search, or snapshot purposes **does not transfer authority**. Any copied amount must identify:

- source entity type,
- source entity ID,
- source version or event,
- copied timestamp,
- whether it is a snapshot or derived value.

| Lifecycle Stage | Domain | Canonical Amount | Meaning | Authoritative Owner | Mutability Rule |
|---|---|---|---|---|---|
| Opportunity | Opportunity | `estimatedRevenue` | Potential revenue from an open, qualifying opportunity | Opportunity domain | Mutable while open; frozen/excluded on close (won/lost/disqualified) |
| Quote | Quote | `quotedRevenue` | Value presented to the customer in the active quote revision | Quote domain | Each revision is its own immutable version; superseded revisions are retained, not overwritten |
| Sales Order | Sales Order | `bookedRevenue` | Customer-committed value once the acceptance threshold is met | Sales Order domain | Mutable only via amendment, cancellation, or adjustment event — never a silent field overwrite |
| Fulfillment / Work Order | Fulfillment / Work Order | `fulfilledServiceValue` *(conditional)* / `Completed Work Orders` \| `Open Work Orders` *(unconditional, operational)* | Dollar value only if an authoritative price source exists; otherwise an operational count only — never a fabricated dollar figure | Fulfillment or Work Order domain | `fulfilledServiceValue` grows as fulfillment lines complete, never exceeds active booked value without an approved amendment; the operational counts are never treated as mutable financial amounts at all |
| Invoice | Invoice | `invoicedRevenue` | Value formally billed | Invoice domain | Immutable once posted; corrected only via void/credit memo/replacement invoice |
| Payment | Payment | `collectedRevenue` | Payments successfully received and applied | Payment / Accounts Receivable domain | Each payment event is its own immutable record; reversals/refunds are new events, not edits to the original |
| Credit Memo | Credit Memo | `creditedRevenue` | Value reduced through an approved credit or adjustment | Credit Memo / Financial Adjustment domain | Immutable once approved/posted; a further correction is a new adjustment record, not an edit |

## 7. Cancellations

Distinct treatment is required for:

- cancelled opportunity,
- cancelled quote,
- cancelled order before fulfillment,
- partially fulfilled cancellation,
- cancelled invoice,
- payment reversal.

Rules:
- Do not delete historical records.
- Use explicit cancellation or reversal events.
- Pipeline should exclude cancelled opportunities.
- Booked revenue reporting may show gross bookings and cancellations separately.
- Active booked revenue and backlog must be reduced by approved order cancellations.
- Fulfilled Service Value already recognized must not be reversed merely because the remaining order is cancelled — value already delivered stays delivered. (Where no Fulfilled Service Value exists because there was no price source, a cancellation has no dollar figure to reverse in the first place — only the operational Work Order count/status changes.)
- Posted invoices require accounting-grade void or credit handling, never a direct edit.

## 8. Credits, Refunds, Write-Offs, and Reversals

These are distinct concepts and must not be represented by overwriting the original amount:

- **Credit memo** — reduces billed customer obligation.
- **Refund** — returns money previously collected.
- **Write-off** — records an approved uncollectible balance.
- **Payment reversal** — reverses a prior payment event.
- **Order adjustment** — changes the commercial commitment before invoicing.

## 9. Tax, Fees, Discounts, and Shipping

Monetary documents require separate components:

- `subtotal`
- `lineDiscount`
- `orderDiscount`
- `shipping`
- `serviceFees`
- `tax`
- `total`
- `currency`

Rules:
- Revenue KPIs should normally exclude tax.
- Discounts reduce revenue according to documented allocation rules.
- Shipping and fees must be explicitly classified as revenue, pass-through, or liability by deployment policy.
- Every calculation must be currency-aware.
- Multi-currency reporting must retain transaction currency and normalized reporting currency where supported.

## 10. Partial Fulfillment

Line-level support is required wherever the business process allows partial delivery or partial service completion.

Example — a Sales Order for $10,000 (an authoritative price source) is 40% fulfilled:

| Metric | Value |
|---|---|
| Booked Revenue | $10,000 |
| Fulfilled Service Value | $4,000 |
| Committed Backlog | $6,000 |

This example presupposes a priced Sales Order backing the fulfillment — the case where Fulfilled Service Value is computable at all (Section 3). Where fulfillment happens with **no** such price source (Taylor Parts' actual current state, per Section 17 — Work Orders carry no price today), there is no Booked Revenue or Fulfilled Service Value to report; only `Completed Work Orders` / `Open Work Orders` counts apply, and Committed Backlog is not computable either.

Fulfillment percentage must be based on line quantities, milestones, accepted service units, or another explicit allocation basis — never an undocumented, unexplained percentage.

## 11. Dates and Reporting Basis

Required business dates, where applicable to the domain:

- `opportunityCreatedAt`
- `expectedCloseDate`
- `quoteIssuedAt`
- `quoteAcceptedAt`
- `bookedAt`
- `scheduledFulfillmentAt`
- `fulfilledAt`
- `invoiceIssuedAt`
- `invoicePostedAt`
- `paymentReceivedAt`
- `paymentAppliedAt`
- `cancelledAt`
- `creditedAt`

**Every KPI must declare its date basis.** Examples:
- Bookings by `bookedAt`.
- Fulfillment by `fulfilledAt`.
- Invoices by `invoicePostedAt`.
- Collections by `paymentAppliedAt` or `paymentReceivedAt`, depending on the stated report definition.

The UI must not silently mix date bases within one report or chart.

## 12. Accounting Boundary

Enterprise Operations OS may model operational and commercial financial events without claiming to replace a general ledger, unless an accounting module is explicitly implemented.

The platform must clearly distinguish:
- operational metrics,
- commercial commitments,
- billing records,
- cash events,
- accounting recognition.

**Do not use the term "recognized revenue"** unless formal accounting recognition rules and an authoritative accounting source are implemented (see ADR-BMF-010).

## 13. Analytics and Dashboard Standards

Reusable dashboards must obtain metrics through a canonical analytics contract or reporting layer, not by implementing independent business formulas in UI components.

Every KPI definition must document:
- canonical name,
- business description,
- owning domain,
- formula,
- status filters,
- date field,
- currency basis,
- tax treatment,
- cancellation treatment,
- credit treatment,
- partial fulfillment behavior,
- refresh expectations,
- source version.

**Dashboards must not redefine canonical metric formulas locally.**

## 14. Auditability and Immutability

Finalized commercial and financial events must be preserved through append-only events, versioned documents, amendments, reversals, or adjustment records.

At minimum, important transitions should capture:
- actor,
- timestamp,
- prior state,
- new state,
- reason,
- source,
- correlation or transaction ID.

The platform must avoid destructive updates that erase financial history — the same permanent-record posture already established for Reorder Request Cancel/Void in `docs/BusinessEntityModel.md` Section 4 ("Per the platform's permanent no-delete rule... never deleted, rewritten, or reopened") extends to every financial event this document governs, not just that one workflow object.

## 15. Multi-Company Configuration

**Platform-wide and non-configurable:**
- canonical metric names,
- ownership boundaries,
- audit requirements,
- prohibition on ambiguous "Sales" and "Pending" labels,
- distinction among booked, invoiced, and collected amounts, and Fulfilled Service Value where a price source exists,
- prohibition on treating `Completed Work Orders`/`Open Work Orders` (or any other operational count) as a financial amount or sales proxy.

**Tenant-configurable:**
- quote acceptance threshold,
- order booking trigger,
- fulfillment acceptance rule,
- treatment of shipping and fees,
- reporting currency,
- fiscal calendar,
- primary executive KPI,
- allowed cancellation workflows,
- accounting integration.

Tenant configuration must not change the *meaning* of a canonical metric name — a tenant may choose which metric is their headline KPI, not redefine what "Booked Revenue" means.

## 16. AI and Automation Data Contract

AI features must consume explicit canonical metrics and lifecycle states. AI must not infer that:
- an accepted quote is paid,
- a completed work order is invoiced,
- an invoice is collected,
- a Work Order count represents a dollar amount,
- or a generic amount field represents revenue.

AI outputs should identify the metric and date basis being analyzed, and must keep operational counts and financial amounts in clearly separate output fields. Examples:
- `projectedBookedRevenue`
- `predictedCollectionDate`
- `backlogRisk`
- `expectedFulfilledServiceValue` (only where an authoritative price source exists for the underlying work)
- `projectedCompletedWorkOrders` (an operational count projection — never labeled or summed as revenue)
- `invoicePaymentRisk`

This binds the same discipline `docs/architecture/SYSTEM_AUTHORITIES.md` already requires of human contributors ("if a row here disagrees with what you find in the actual file, the code wins") to AI-generated financial claims specifically: an AI output naming a metric that doesn't map to one of this document's canonical definitions is a defect, not a stylistic choice.

## 17. Initial Implementation Guidance

**This document defines architecture and semantics — it is not an instruction to immediately create every domain described above.**

Grounded in the actual current Taylor Parts implementation, verified while writing this document (not assumed):
- **No Invoice, Opportunity/Quote, or Sales Order entity exists today.** `docs/BusinessEntityModel.md` Section 2 lists all three as **Future** entities — no collection, no schema, no code.
- **Work Order (`fieldops_wos`, the only entity currently linked to an Account via `customerId`) has zero monetary fields** — confirmed by reading `field-ops-app-vite/src/types/workOrder.ts` in full. No `price`/`cost`/`amount`/`total`/`revenue` field exists on it. Its `WorkOrderStatus` values (`CREATED`/`READY_TO_DISPATCH`/`SCHEDULED`/`DISPATCHED`/`ACCEPTED`/`EN_ROUTE`/`ARRIVED`/`WORK_IN_PROGRESS`/`COMPLETED`/`CLOSED`/`CANCELLED`) are the basis for `Completed Work Orders` (`COMPLETED`/`CLOSED`) and `Open Work Orders` (every non-terminal, non-cancelled value) per Section 3 — today, this is the *only* form either metric can take, since no price source exists to compute Fulfilled Service Value.
- **Every real monetary total in the current codebase is procurement spend, not sales revenue** (`purchase_orders.totalCost`, `procurementBridge.ts`'s cost estimation) — neither is linked to an Account.
- This is exactly the gap `docs/assessments/customer-account-business-model.md` (Issue #158) surfaced when asked to build a Customer/Account "Sales Summary" section: there was no canonical definition of "sales" to build against, and no authoritative amount field to read.

Going forward, for the current system:
- Inventory and service features may *reference* future commercial domains named in this document, but must not assume they exist.
- New generic fields named `sales`, `pendingSales`, `revenue`, or `amount` must not be introduced without a canonical definition from Section 3 above.
- Existing ambiguous fields should be inventoried before any migration (none were found to exist yet as of this writing, beyond the procurement-side fields already named in this section).
- Implementation plans must identify the authoritative source and lifecycle meaning for every financial amount they introduce.
- No collection should be declared the universal source of "sales."

**Account-page behavior, as a concrete application of this framework (example only — not itself an authorization to build a Sales Summary; a future Specification decides that):**
- Until an authoritative financial provider (a real Invoice/Sales Order/priced-Quote source) exists, an Account page's financial section must show an explicit **"Sales data source not connected"** state.
- **It must never show `$0`** — `$0` reads as a true, known zero and would misrepresent "no data source" as "we checked and there were no sales."
- `Completed Work Orders` / `Open Work Orders` counts may appear on the same page, but only under a separately-labeled section such as **"Service Activity"** — never inside or adjacent to a "Sales"-labeled section in a way that could be read as the same kind of figure.
- **Vendor procurement spend must never appear as customer sales.** Per `docs/assessments/customer-account-business-model.md`'s finding, the existing `purchase_orders.totalCost`/procurement cost-estimation figures are money the business pays *out* to Suppliers — structurally and semantically the opposite of customer sales revenue. If an Account is ever flagged as also a vendor (that Assessment's own open question), any procurement/spend figures shown for that relationship must be their own, separately-labeled figures, never merged into or displayed alongside that Account's sales metrics.

## 18. Required Decision Checklist

Every future specification or implementation plan that introduces financial reporting must answer:

- What exact metric is being displayed?
- Which domain owns it?
- Which collection or aggregate is authoritative?
- What statuses are included?
- What statuses are excluded?
- Which date field determines the reporting period?
- Is tax included?
- Are discounts included?
- How are cancellations handled?
- How are credits handled?
- How are refunds and reversals handled?
- How is partial fulfillment handled?
- Which currency is used?
- Is the value operational, commercial, billing, cash, or accounting?
- Is the metric stored, snapshotted, or derived?
- What audit evidence supports the value?

## 19. Architectural Decisions

**ADR-BMF-001:** The platform will not define a single universal "sales" amount.

**ADR-BMF-002:** Each lifecycle domain owns its own canonical financial amount.

**ADR-BMF-003:** "Sales" and "Pending" may not be used as standalone reusable KPI names.

**ADR-BMF-004:** Booked, Invoiced, and Cash Collected are distinct financial metrics. Fulfilled Service Value is a distinct financial metric available *only* when an authoritative customer-price source exists. `Completed Work Orders`/`Open Work Orders` are operational activity counts, never financial metrics — a count and a dollar amount must never share a label or be substituted for one another.

**ADR-BMF-005:** Tax is excluded from canonical revenue metrics by default.

**ADR-BMF-006:** Posted financial events are corrected through auditable adjustments rather than destructive edits.

**ADR-BMF-007:** Partial fulfillment must preserve booked, Fulfilled Service Value (where a price source exists) or Work Order counts (where it does not), and remaining Committed Backlog as separate figures — never collapsed into one number.

**ADR-BMF-008:** Dashboard and AI metrics must use a centralized semantic definition.

**ADR-BMF-009:** Canonical business meanings are platform-wide; workflow policy may be tenant-configurable.

**ADR-BMF-010:** The platform will not label a metric "recognized revenue" without an implemented accounting-recognition authority.
