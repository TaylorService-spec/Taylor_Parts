# Enterprise Business Metrics Framework

Status: **Proposed — Pending Architecture Review — NOT binding.** No section of this document may be cited as settled, and no Specification or Implementation Plan may proceed based on it, until it is formally Accepted.
Scope: Platform-wide — Enterprise Operations OS, company-neutral. Taylor Parts is the first deployment, not a special case.
Depends on: `docs/BusinessEntityModel.md` (entity definitions), `docs/architecture/SYSTEM_AUTHORITIES.md` ("who owns what" pattern this document extends into financial ownership)
Prompted by: `docs/assessments/customer-account-business-model.md`'s finding that no authoritative sales/revenue amount exists anywhere in the current Taylor Parts implementation, and that "Sales Summary" cannot be built without first deciding what "sales" means

**This document defines architecture and semantics. It does not implement any domain, collection, or field described below** — see Section 20.

## 1. Purpose

This document establishes the canonical business terminology, financial ownership rules, lifecycle definitions, KPI semantics, and reporting standards used across the Enterprise Operations OS.

- Every financial amount must have a clearly defined business meaning.
- Every amount must have one authoritative owning domain.
- Operational documents must not compete as duplicate sources of truth.
- Historical financial events must remain auditable.
- Dashboards and AI features must use standardized metric definitions.
- **"Revenue" is reserved language.** It names either an implemented accounting authority's own recognized-revenue figure, or a clearly described external accounting metric sourced from one — never a generic field name on a commercial-stage record. A field that merely estimates, quotes, books, collects, or credits a *value* is not, by itself, "revenue."

A platform that lets any domain write an ambiguous `sales`, `revenue`, `amount`, or `pending` field accumulates competing, silently-disagreeing numbers the moment more than one domain needs to report on money. This framework exists to prevent that class of defect architecturally, before any such field is written.

**General rule, applying throughout this document: when a metric's required prerequisite data is unavailable, the metric is unavailable — never rendered as zero, and never silently omitted without an explicit unavailable/unconnected/stale state (Section 18).** A missing input is not a known fact of "nothing," and must never be presented as one.

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

**This chain is the canonical maximum path, not a mandatory sequence every transaction must pass through.** Lifecycle stages are optional by deployment and integration — a customer relationship may legitimately enter the platform at Sales Order or Invoice (e.g. an ERP integration that never models Opportunities/Quotes, or a walk-in sale with no prior pipeline). **A missing earlier stage must never be fabricated or backfilled** to make the chain look complete; the metrics for stages that were genuinely skipped are simply unavailable (per Section 1's general rule), not zero and not synthesized.

Primary amount owned at each stage:

| Stage | Primary amount | Field name |
|---|---|---|
| Opportunity | Estimated opportunity value | `estimatedOpportunityValue` |
| Quote | Quoted value | `quotedValue` |
| Sales Order | Booked value | `bookedValue` (a deployment may alias this `committedValue` internally; the canonical name for cross-domain contracts is `bookedValue`) |
| Fulfillment / Work Order | Fulfilled Service Value — **derived, not independently owned** (Section 3) | `fulfilledServiceValue` (always computed, never a value a Work Order stores as its own authoritative fact — see Section 3) |
| Invoice | Componentized — no single "invoiced revenue" field | `invoiceSubtotal`, `invoiceTax`, `invoiceTotal` (see Section 9) |
| Payment | Payment amount | `paymentAmount` |
| Credit Memo | Componentized credit — no single "credited revenue" field | per-component credit amounts (revenue portion, tax portion, shipping portion, fee portion — see Section 8) |

None of these field names contain the word "revenue." **"Revenue" is reserved for an implemented accounting authority or a clearly described external accounting metric** (Section 13) — every field above names what it actually is (an estimate, a quote, a booking, a fulfillment fact, an invoice component, a payment, a credit component), not a premature claim about revenue recognition.

Each stage owns its own financial truth and must not overwrite the amount owned by another stage. A later stage may *reference* an earlier stage's amount (e.g. an Invoice referencing the Sales Order it bills against) but never silently mutates it.

**Fulfillment / Work Order is not automatically a financial stage, and — even when it is — it is never an independent price authority.** See Section 3's full composite-ownership model.

## 3. Canonical Metric Definitions

### Open Pipeline

Potential value associated with active opportunities.

**Authoritative owner:** Opportunity domain (`estimatedOpportunityValue`).

Rules:
- Includes only qualifying open opportunities.
- Must not be treated as booked value or revenue of any kind.
- May be weighted separately by probability.
- Cancelled, lost, or disqualified opportunities are excluded from active pipeline.

### Quoted Value

The value presented to a customer in an active quote.

**Authoritative owner:** Quote domain (`quotedValue`).

Rules:
- Must preserve quote revisions or versions.
- Superseded quotes must not be counted as simultaneously active.
- Quote acceptance does not itself constitute invoiced or collected value.

### Booked Value

Customer-committed value from an accepted order or equivalent binding commitment.

**Authoritative owner:** Sales Order domain (`bookedValue`).

Rules:
- Becomes booked only after the configured acceptance threshold is met.
- Changes after booking require an amendment, cancellation, or adjustment event.
- Booked value is not the same as fulfilled, invoiced, or collected value.

### Committed Backlog

Booked value not yet fulfilled.

```
committedBacklog = bookedValue - fulfilledServiceValue - cancelledUnfulfilledValue
```

The exact derivation may be line-based when partial fulfillment is supported (see Section 11) — this top-level formula is the platform-wide invariant; a deployment's actual computation may sum it per line rather than as one subtraction against three aggregate totals. Per Section 1's general rule: where `fulfilledServiceValue` is unavailable (no authoritative price source, see below), Committed Backlog is **unavailable**, not computed as if `fulfilledServiceValue` were `0`.

### Fulfilled Service Value — composite, derived, never independently owned by Work Order

Dollar value of goods delivered or services completed, computable **only** when an authoritative customer-price source exists for what was fulfilled. This is the single most important ownership boundary in this framework: **a Work Order/Fulfillment record can never become an independent customer-price authority, even by copying and storing the result of this calculation.**

**Composite authority model (binding):**
- **Sales Order or accepted Quote owns:** price, currency, discounts, and the commercial commitment itself. This is the only source of truth for "what a unit of this work is worth."
- **Fulfillment / Work Order owns:** fulfilled quantity, milestone reached, acceptance, and completion date. This is the only source of truth for "how much of the committed work actually happened, and when."
- **The canonical metrics/reporting layer — not either source record — derives Fulfilled Service Value** by joining the Sales Order/Quote's price facts against the Fulfillment/Work Order's quantity/acceptance facts. Neither source record computes or stores this figure as its own independent fact.
- **Every derived value must carry:** the source entity type and ID for both the price side and the quantity side, the source version of each (e.g. which Sales Order amendment, which Work Order revision), a calculation version (which formula/logic produced this number), and an `asOf` timestamp (when the join was performed).
- **If a derived Fulfilled Service Value is ever stored as a cache or snapshot** (for performance, search, or display), it must be labeled **derived/non-authoritative** at the point of storage, and must retain full lineage back to both source records — a snapshot is a convenience copy, never a second authority, per Section 6's general copying rule.

Rules:
- Must support partial fulfillment.
- Must be valued against the authoritative price source's own line prices — never a new, independently-estimated price invented at the fulfillment stage.
- Must not exceed the active booked value without an approved amendment.
- **Must not be computed, displayed, or stored when no authoritative price source exists.** In that case, the metric is unavailable — use `Completed Work Orders` / `Open Work Orders` instead (below), never a fabricated or estimated dollar figure, and never `$0` standing in for "unknown."
- **"Recognized Revenue" remains prohibited** as a name for this or any other metric until an implemented accounting authority defines it (Section 13) — Fulfilled Service Value is a derived commercial/operational figure, not an accounting recognition event, and does not become one merely by existing.

### Completed Work Orders / Open Work Orders (operational counts — not revenue, not a price authority)

Operational activity counts of Work Orders by status (Section 2's Fulfillment/Work Order stage), used **only** when no authoritative price source exists for what was fulfilled — the unconditional, always-available alternative to Fulfilled Service Value.

**Authoritative owner:** Fulfillment or Work Order domain.

Rules:
- **`Completed Work Orders` and `Open Work Orders` are operational activity metrics. They are not sales, revenue, financial totals, or financial proxies of any kind.**
- **A count and a dollar metric must never share a label, and one must never be substituted for the other** — a dashboard, API response, or UI component may show both side by side, clearly separately labeled, but must not merge them into one figure or imply a count "stands in for" a dollar amount.
- `Completed Work Orders` = Work Orders in a terminal-and-fulfilled state (e.g. `COMPLETED`/`CLOSED` in Taylor Parts' own `WorkOrderStatus`, per Section 20); a cancelled Work Order is excluded from this count, the same exclusion Section 7 requires for cancelled commercial records.
- `Open Work Orders` = Work Orders in any non-terminal, non-cancelled state.
- These counts may be surfaced under a clearly separate label such as **"Service Activity"** (see Section 20) — never inside a "Sales" or "Revenue" section or KPI list.

### Invoice components

An Invoice has no single "invoiced revenue" field — it is componentized from creation:

- `invoiceSubtotal` — the revenue-bearing line total, before tax, before any component the deployment classifies as pass-through/liability (Section 9).
- `invoiceTax` — tax component, stored separately, never commingled with revenue.
- `invoiceTotal` — the full billed amount (subtotal + tax + any shipping/fee components the deployment includes on the invoice), i.e. what the customer actually owes — a billing-document total, not a revenue figure.

**Authoritative owner:** Invoice domain.

Rules:
- Posted invoices are immutable.
- Corrections require voids, credit memos, replacement invoices, or other auditable adjustments.
- `invoiceTax` must never be folded into any revenue-labeled metric.

### Cash Collected

Customer payments successfully received and applied, tracked as `paymentAmount` per payment event, applied by component (an application may cover invoice subtotal, tax, shipping, or fees separately).

**Authoritative owner:** Payment or Accounts Receivable domain.

Rules:
- Must support partial payments.
- Must distinguish received, unapplied, applied, reversed, refunded, and failed payments.
- Cash Collected must not be inferred from invoice status alone.
- **Cash Collected is not automatically revenue.** A customer's payment can settle tax, shipping, or fee components as well as the revenue-bearing subtotal — a "total cash in" figure and a "revenue collected" figure are different questions unless a deployment explicitly defines Cash Collected as revenue-component-only cash, and states that choice.

### Outstanding Receivables

Amount invoiced but not yet collected.

```
outstandingReceivables = postedInvoiceSubtotal_plusApplicableComponents
                         - appliedPayments
                         - appliedCredits
                         - approvedWriteOffs
                         + validAdjustments
```

Which invoice components ("subtotal only" vs. "subtotal + tax" vs. full `invoiceTotal`) feed this formula is a deployment policy decision (Section 16) that must be stated explicitly wherever this metric is displayed — never assumed silently.

### Credited components / Credited Net Sales

A credit memo is componentized, the same way an Invoice is — a single "credited revenue" field does not exist:

- Revenue-bearing credit component (reduces `invoiceSubtotal`-equivalent value).
- Tax credit component.
- Shipping credit component.
- Fee credit component.

**`Credited Net Sales`** is the canonical metric name for **only the revenue-bearing credit component**, never the full credit memo total (which may also reverse tax/shipping/fees, per Section 8).

**Authoritative owner:** Credit Memo or Financial Adjustment domain.

### Invoiced Net Sales

```
invoicedNetSales = sum(postedInvoiceSubtotal across posted invoices)
                   - sum(creditedNetSales across posted credit memos)
```

Built from the **revenue-bearing subtotal only** — `invoiceTax` and any component the deployment has classified as pass-through/liability (Section 9) are excluded by definition, not merely "normally" excluded. Invoiced Net Sales is a billing-domain figure, not a cash figure — it must be clearly distinguished from Cash Collected above.

## 4. Meaning of "Sales"

The platform must not expose an unlabeled generic **"Sales"** KPI in architecture, APIs, analytics contracts, or reusable UI components.

Every displayed **financial** metric must use an explicit canonical label:

- Open Pipeline
- Quoted Value
- Booked Value
- Committed Backlog
- Invoiced Net Sales
- Cash Collected
- Credited Net Sales

A deployment may configure one of these as its primary executive sales KPI (Section 16), but the underlying canonical metric name must remain explicit — the configured *default view* does not get to rename the metric it displays.

**`Completed Work Orders` and `Open Work Orders` are never part of this list.** They are operational activity counts (Section 3), not financial metrics — they must not appear in a "Sales" KPI set, must not be offered as a configurable "primary sales KPI" (Section 16), and must not be relabeled as if they were a dollar figure. Where fulfillment has no authoritative price source (Fulfilled Service Value cannot be computed, Section 3), these counts are the *only* thing this stage may display — but they display as their own, separately-labeled operational fact, never as a stand-in "Sales" number.

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

**Derived values (Fulfilled Service Value above all) carry a stricter requirement** — source entity IDs and versions for *every* contributing record (not just one), a calculation version, and an `asOf` timestamp (Section 3).

| Lifecycle Stage | Domain | Canonical Amount | Meaning | Authoritative Owner | Mutability Rule |
|---|---|---|---|---|---|
| Opportunity | Opportunity | `estimatedOpportunityValue` | Potential value from an open, qualifying opportunity | Opportunity domain | Mutable while open; frozen/excluded on close (won/lost/disqualified) |
| Quote | Quote | `quotedValue` | Value presented to the customer in the active quote revision | Quote domain | Each revision is its own immutable version; superseded revisions are retained, not overwritten |
| Sales Order | Sales Order | `bookedValue` | Customer-committed value once the acceptance threshold is met | Sales Order domain | Mutable only via amendment, cancellation, or adjustment event — never a silent field overwrite |
| Fulfillment / Work Order | **Reporting/metrics layer** (composite-derived — see Section 3) | `fulfilledServiceValue` *(conditional, derived)* / `Completed Work Orders` \| `Open Work Orders` *(unconditional, operational)* | Dollar value only if an authoritative price source exists, derived by joining Sales Order/Quote price facts with Work Order quantity/acceptance facts; otherwise an operational count only | **Price/currency/discounts: Sales Order or accepted Quote. Quantity/milestone/acceptance/date: Fulfillment/Work Order. Neither owns the joined dollar figure alone.** | `fulfilledServiceValue` is recomputed, not directly mutated, as source facts change; never exceeds active booked value without an approved amendment; a Work Order must never be treated as having independently set this value |
| Invoice | Invoice | `invoiceSubtotal` / `invoiceTax` / `invoiceTotal` | Componentized billed amounts | Invoice domain | Immutable once posted; corrected only via void/credit memo/replacement invoice |
| Payment | Payment | `paymentAmount` | Payments successfully received and applied | Payment / Accounts Receivable domain | Each payment event is its own immutable record; reversals/refunds are new events, not edits to the original |
| Credit Memo | Credit Memo | Componentized credit amounts (revenue/tax/shipping/fee) | Value reduced through an approved credit or adjustment, by component | Credit Memo / Financial Adjustment domain | Immutable once approved/posted; a further correction is a new adjustment record, not an edit |

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
- Booked value reporting may show gross bookings and cancellations separately.
- Active booked value and backlog must be reduced by approved order cancellations.
- **Fulfilled Service Value already recorded for delivered/accepted fulfillment must not be reversed merely because the remaining order is cancelled** — value already delivered stays delivered. This is a commercial/operational fact, not an accounting recognition claim (Section 13) — nothing in this rule implies revenue was "recognized" in an accounting sense. Where no Fulfilled Service Value exists because there was no price source, a cancellation has no dollar figure to reverse in the first place — only the operational Work Order count/status changes.
- Posted invoices require accounting-grade void or credit handling, never a direct edit.

## 8. Credits, Refunds, Write-Offs, and Reversals

These are distinct concepts and must not be represented by overwriting the original amount:

- **Credit memo** — reduces billed customer obligation. **May reverse revenue, tax, shipping, fees, or other components separately** — a credit memo is not required to be a single undifferentiated amount; each component it reverses must be tracked against the specific original component it offsets (Section 3's "Credited components").
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
- Revenue KPIs (Invoiced Net Sales, Credited Net Sales, and any "revenue" cross-reference) must exclude tax, unconditionally — not merely "normally."
- Discounts reduce revenue according to documented allocation rules.
- Shipping and fees must be explicitly classified as revenue, pass-through, or liability by deployment policy — and that classification must be stated wherever a metric derived from them is displayed.
- Every calculation must be currency-aware (Section 10).
- Multi-currency reporting must retain transaction currency and normalized reporting currency where supported (Section 10).

## 10. Monetary Representation and Currency

Binding requirements for every monetary record and calculation in the platform:

- **ISO 4217 currency code required on every monetary record.** No monetary field may exist without an accompanying currency code — a bare number is not a valid representation of money in this platform.
- **Decimal or minor-unit integer representation only.** Authoritative money must never be stored or calculated as binary floating-point (e.g. IEEE 754 `double`) — use a decimal type or integer minor units (e.g. cents) with an explicit scale, per currency.
- **Explicit scale and rounding policy required**, documented per currency (most currencies: 2 decimal places; some, e.g. JPY, use 0; a deployment must not assume 2 universally). Rounding method (e.g. half-up, banker's rounding) must be stated, not left to whatever the implementation language defaults to.
- **Formulas operate per currency.** Two amounts in different currencies must never be added or subtracted directly — they must first be normalized to a common reporting currency (below), with that conversion itself recorded, not silently applied inline.
- **Normalized reporting currency requires:** the FX source (which rate provider), the rate itself, the rate's date/time, the conversion direction, and a calculation version — the same lineage discipline Section 3 requires of derived values generally. A normalized figure without this provenance is not trustworthy and must not be presented as authoritative.
- **Original transaction amount and currency are immutable and always retained** alongside any normalized figure — normalization is an additional, derived view, never a replacement of the original fact.
- **Credits, discounts, tax, fees, shipping, refunds, and write-offs each retain their own component amount and currency** — a multi-component monetary document is not collapsed into one number at any stage of storage or calculation; components are combined only at the point of display/reporting, and even then per Section 9's classification rules.

## 11. Partial Fulfillment

Line-level support is required wherever the business process allows partial delivery or partial service completion.

Example — a Sales Order for $10,000 (an authoritative price source) is 40% fulfilled:

| Metric | Value |
|---|---|
| Booked Value | $10,000 |
| Fulfilled Service Value | $4,000 |
| Committed Backlog | $6,000 |

This example presupposes a priced Sales Order backing the fulfillment — the case where Fulfilled Service Value is computable at all (Section 3). Where fulfillment happens with **no** such price source (Taylor Parts' actual current state, per Section 20 — Work Orders carry no price today), there is no Booked Value or Fulfilled Service Value to report; only `Completed Work Orders` / `Open Work Orders` counts apply, and Committed Backlog is unavailable, not computable as a number.

Fulfillment percentage must be based on line quantities, milestones, accepted service units, or another explicit allocation basis — never an undocumented, unexplained percentage.

## 12. Dates and Reporting Basis

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
- `asOf` (Section 3/10 — required on every derived or normalized value, in addition to whichever business date above applies to its underlying facts)

**Every KPI must declare its date basis.** Examples:
- Bookings by `bookedAt`.
- Fulfillment by `fulfilledAt`.
- Invoices by `invoicePostedAt`.
- Collections by `paymentAppliedAt` or `paymentReceivedAt`, depending on the stated report definition.

The UI must not silently mix date bases within one report or chart.

## 13. Accounting Boundary

Enterprise Operations OS may model operational and commercial financial events without claiming to replace a general ledger, unless an accounting module is explicitly implemented.

The platform must clearly distinguish:
- operational metrics,
- commercial commitments,
- billing records,
- cash events,
- accounting recognition.

**Do not use the term "recognized revenue"** unless formal accounting recognition rules and an authoritative accounting source are implemented. **"Revenue" as a bare word is reserved the same way** (Section 1) — every canonical metric this document defines names what it actually is (Invoiced Net Sales, Cash Collected, Fulfilled Service Value, etc.), not a generic "revenue" claim. (Section 22 restates this as this document's own proposed decision record, ADR-BMF-010 — an internal index entry within this still-Proposed document, not a separately governed record.)

## 14. Analytics and Dashboard Standards

Reusable dashboards must obtain metrics through a canonical analytics contract or reporting layer, not by implementing independent business formulas in UI components.

Every KPI definition must document:
- canonical name,
- business description,
- owning domain,
- formula,
- status filters,
- date field,
- currency basis and rounding policy (Section 10),
- tax treatment,
- cancellation treatment,
- credit treatment,
- partial fulfillment behavior,
- refresh expectations,
- source version.

**Dashboards must not redefine canonical metric formulas locally.**

## 15. Auditability and Immutability

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

## 16. Multi-Company Configuration

**Platform-wide and non-configurable:**
- canonical metric names,
- ownership boundaries,
- audit requirements,
- prohibition on ambiguous "Sales" and "Pending" labels,
- prohibition on the bare word "revenue" outside an implemented accounting authority,
- distinction among booked, invoiced, and collected amounts, and Fulfilled Service Value where a price source exists,
- prohibition on treating `Completed Work Orders`/`Open Work Orders` (or any other operational count) as a financial amount or sales proxy,
- the composite-ownership model for Fulfilled Service Value (Section 3),
- currency/rounding/lineage requirements (Section 10),
- lifecycle stages being optional per relationship, never fabricated to appear complete (Section 2).

**Tenant-configurable:**
- quote acceptance threshold,
- order booking trigger,
- fulfillment acceptance rule,
- treatment of shipping and fees as revenue/pass-through/liability,
- which invoice components feed Outstanding Receivables (Section 3),
- reporting currency,
- fiscal calendar,
- primary executive KPI (from the canonical list only, Section 4),
- allowed cancellation workflows,
- accounting integration,
- which financial provider(s) are connected (Section 17).

Tenant configuration must not change the *meaning* of a canonical metric name — a tenant may choose which metric is their headline KPI, not redefine what "Booked Value" means.

## 17. External Financial Provider Contract

The platform must remain portable across ERP, accounting, CRM, data-lake, and local-ledger sources — no canonical metric may be hard-wired to one specific external system's shape. Every financial provider/adaptor integration must expose:

- **source system and tenant** — which external system, which tenant/org within it,
- **source record ID and source version** — the exact record and revision this data came from,
- **canonical lifecycle/metric mapping** — which of this document's canonical metrics (Section 3) the provider's fields map to, explicitly, not inferred,
- **transaction currency and normalized currency where applicable** (Section 10),
- **business dates and `asOf`** (Section 12),
- **last successful refresh timestamp and freshness status**,
- **state, one of:** `complete`, `partial`, `stale`, `error`, or `unconfigured` — distinct states, never collapsed into a single boolean "connected/not connected",
- **authority mode** — see "Authority is configured, not assumed from storage location" below,
- **idempotency/deduplication key** — so a repeated sync never double-counts,
- **lineage back to drill-down records** — a summary figure must always be traceable to the underlying records that produced it.

**Authority is configured, not assumed from storage location.** A cached or imported record does not become authoritative merely because it is stored locally, and a locally-stored record is not automatically *non*-authoritative either — the deployment's chosen **authority mode** decides:
- **Imported/cached external data** (ERP, CRM, data lake, any external accounting system) always remains subordinate to that external source — the local copy is a snapshot, subject to the same lineage/labeling rules as any other derived value (Section 3/6), and the external system is the authority of record.
- **A governed local ledger may itself be the authoritative source** when a deployment explicitly selects that mode — a customer who manages financial data locally instead of through an external ERP/data-lake is not required to treat their own governed ledger as a mere cache of nothing. In this mode, the local ledger's own records are the authority, subject to the same immutability/audit/lineage rules (Section 15) any other authoritative source must meet.
- **Storage location alone never determines authority** — "local" and "external" are not synonyms for "cache" and "source of truth." Every provider integration's **authority mode** field states explicitly, per configured provider, which posture applies; nothing may assume one or the other from where the bytes happen to sit.

**Five distinct states an Account (or any) page must be able to render, never conflated:**
- **"Sales data source not connected"** — no financial provider is configured at all (`unconfigured`).
- **"Sales data temporarily unavailable"** — a provider is configured but the current sync/read failed or timed out (`error`).
- **"Sales data may be stale as of [`asOf`/last-refresh time]"** — a provider is configured and has data, but it is older than the deployment's configured freshness threshold (`stale`).
- **"Partial data for [stated metric/scope/date range]"** (`partial`) — see the dedicated treatment immediately below; not the same state as `stale` (data can be current *and* incomplete) or `error` (a partial state is not a failure, it is a known, bounded gap).
- **Fully rendered figures** (`complete`) — meaning complete *for the stated metric, scope, and `asOf`* only, never a claim of universal data completeness across every metric/date range the platform could ever compute.

None of these may be displayed as `$0`, as a blank section with no explanation, or as each other — a user must be able to tell "nothing is connected" apart from "something is connected but broken" apart from "something is connected and working, but this number might be a few hours old" apart from "some of what you're looking at is real, some of it is a known gap."

**The `partial` state, defined explicitly:**
- **Completeness is evaluated per metric and per date range, not for the provider connection as a whole.** A provider can be `complete` for Cash Collected this month and `partial` for Committed Backlog over the last year, simultaneously — one blanket status per provider is not sufficient.
- **Available values may render with a clear "partial data" warning** attached directly to the figure they qualify — the warning travels with the number, not just as a page-level banner easily missed once scrolled past.
- **The missing portion remains unavailable, never `$0` and never silently blank** — a partial sync that's missing December's records must show December as unavailable, not as zero December activity.
- **Drill-down/provenance must show what was included and what was excluded** — which source records/date ranges/entities contributed to the rendered figure, and which are known to be missing, not just "some data is missing" with no specifics.
- **`complete` itself must mean complete for the stated metric, scope, and `asOf`** — never a platform-wide or provider-wide claim. A page showing several metrics side by side may correctly show some as `complete` and others as `partial` at the same moment, from the same provider.

## 18. AI and Automation Data Contract

AI features must consume explicit canonical metrics and lifecycle states. AI must not infer that:
- an accepted quote is paid,
- a completed work order is invoiced,
- an invoice is collected,
- a Work Order count represents a dollar amount,
- a locally-cached/imported figure is authoritative merely because it's stored locally (Section 17),
- or a generic amount field represents revenue.

AI outputs should identify the metric and date basis being analyzed, and must keep operational counts and financial amounts in clearly separate output fields. Examples:
- `projectedBookedValue`
- `predictedCollectionDate`
- `backlogRisk`
- `expectedFulfilledServiceValue` (only where an authoritative price source exists for the underlying work; otherwise unavailable, not estimated)
- `projectedCompletedWorkOrders` (an operational count projection — never labeled or summed as revenue)
- `invoicePaymentRisk`

**Whether AI may access raw financial provider documents at all, versus only pre-approved aggregates, is a governance decision a future Specification must make explicitly (Section 19)** — this section does not itself grant either level of access.

This binds the same discipline `docs/architecture/SYSTEM_AUTHORITIES.md` already requires of human contributors ("if a row here disagrees with what you find in the actual file, the code wins") to AI-generated financial claims specifically: an AI output naming a metric that doesn't map to one of this document's canonical definitions is a defect, not a stylistic choice.

## 19. Authorization and Data Governance

**Financial visibility is not implied by access to an Account page, or to any other record's general read permission.** A future Specification that introduces any financial metric or drill-down must explicitly define:

- **which roles may view each financial metric and its drill-down records** — visibility may differ per metric (e.g. Cash Collected might be more restricted than Open Pipeline), not granted uniformly by "can view this Account."
- **field masking/export boundaries** — whether a role can see a figure on screen but not export/print/API-fetch it, or see a rounded/bucketed value but not the exact figure.
- **tenant isolation** — a multi-company deployment must guarantee one tenant's financial data is architecturally unreachable from another's context, not merely filtered by a query the caller could bypass.
- **audit logging for financial-provider configuration and corrections** — connecting/reconfiguring a provider (Section 17), and any manual correction/adjustment/write-off, must itself be an audited event (Section 15), not just the underlying financial record.
- **retention and provenance requirements** — how long source/lineage data (Section 3/6/17) must be kept, and what happens to reporting when a source record's retention period ends.
- **whether AI may access raw financial documents or only approved aggregates** (Section 18) — stated explicitly per deployment/role, not assumed.

None of these are decided by this document — it only requires that they be decided, explicitly, before any financial-metric Specification proceeds.

## 20. Initial Implementation Guidance

**This document defines architecture and semantics — it is not an instruction to immediately create every domain described above.**

Grounded in the actual current Taylor Parts implementation, verified while writing this document (not assumed):
- **No Invoice, Opportunity/Quote, or Sales Order entity exists today.** `docs/BusinessEntityModel.md` Section 2 lists all three as **Future** entities — no collection, no schema, no code.
- **Work Order (`fieldops_wos`, the only entity currently linked to an Account via `customerId`) has zero monetary fields** — confirmed by reading `field-ops-app-vite/src/types/workOrder.ts` in full. No `price`/`cost`/`amount`/`total`/`revenue` field exists on it. Its `WorkOrderStatus` values (`CREATED`/`READY_TO_DISPATCH`/`SCHEDULED`/`DISPATCHED`/`ACCEPTED`/`EN_ROUTE`/`ARRIVED`/`WORK_IN_PROGRESS`/`COMPLETED`/`CLOSED`/`CANCELLED`) are the basis for `Completed Work Orders` (`COMPLETED`/`CLOSED`) and `Open Work Orders` (every non-terminal, non-cancelled value) per Section 3 — today, this is the *only* form either metric can take, since no price source exists to compute Fulfilled Service Value, and no Sales Order/Quote entity exists to own one anyway.
- **Every real monetary total in the current codebase is procurement spend, not sales revenue** (`purchase_orders.totalCost`, `procurementBridge.ts`'s cost estimation) — neither is linked to an Account.
- This is exactly the gap `docs/assessments/customer-account-business-model.md` (Issue #158) surfaced when asked to build a Customer/Account "Sales Summary" section: there was no canonical definition of "sales" to build against, and no authoritative amount field to read.

Going forward, for the current system:
- Inventory and service features may *reference* future commercial domains named in this document, but must not assume they exist.
- New generic fields named `sales`, `pendingSales`, `revenue`, or `amount` must not be introduced without a canonical definition from Section 3 above.
- Existing ambiguous fields should be inventoried before any migration (none were found to exist yet as of this writing, beyond the procurement-side fields already named in this section).
- Implementation plans must identify the authoritative source and lifecycle meaning for every financial amount they introduce, including currency/lineage per Section 10, and the provider-state handling per Section 17 if the source is external.
- No collection should be declared the universal source of "sales."

**Account-page behavior, as a concrete application of this framework (example only — not itself an authorization to build a Sales Summary; a future Specification decides that):**
- Until an authoritative financial provider (a real Invoice/Sales Order/priced-Quote source) exists, an Account page's financial section must show one of Section 17's explicit states — **"Sales data source not connected"** today (since no provider exists at all in the current system), reserving "temporarily unavailable"/"stale"/"partial" for once a provider is actually connected.
- **It must never show `$0`** — `$0` reads as a true, known zero and would misrepresent "no data source" as "we checked and there were no sales."
- `Completed Work Orders` / `Open Work Orders` counts may appear on the same page, but only under a separately-labeled section such as **"Service Activity"** — never inside or adjacent to a "Sales"-labeled section in a way that could be read as the same kind of figure.
- **Vendor procurement spend must never appear as customer sales.** Per `docs/assessments/customer-account-business-model.md`'s finding, the existing `purchase_orders.totalCost`/procurement cost-estimation figures are money the business pays *out* to Suppliers — structurally and semantically the opposite of customer sales revenue. If an Account is ever flagged as also a vendor (that Assessment's own open question), any procurement/spend figures shown for that relationship must be their own, separately-labeled figures, never merged into or displayed alongside that Account's sales metrics.
- **Who may see any of this at all is not decided here** — Section 19 requires an explicit Specification-level answer before any financial section ships, regardless of data-source readiness.

## 21. Required Decision Checklist

Every future specification or implementation plan that introduces financial reporting must answer:

- What exact metric is being displayed?
- Which domain owns it? (For a derived value: which domains own each contributing fact, per Section 3/6.)
- Which collection or aggregate is authoritative?
- What statuses are included?
- What statuses are excluded?
- Which date field determines the reporting period, and what is the `asOf` for any derived/normalized figure?
- Is tax included? Are discounts included?
- What is the currency, scale, and rounding policy (Section 10)?
- How are cancellations, credits, refunds, and reversals each handled (they are not one question)?
- How is partial fulfillment handled?
- Is the value operational, commercial, billing, cash, or accounting?
- Is the metric stored, snapshotted, or derived — and if derived, what is its full lineage (Section 3/6)?
- If sourced externally, what is the provider's state contract (Section 17)?
- Who may view this metric and its drill-down, and under what masking/export rules (Section 19)?
- What audit evidence supports the value?

## 22. Architectural Decisions

**These are this document's own proposed decision records, indexed here for reference within this file only — they are not separately governed ADR files in the sense `docs/architecture/ADR-001` through `ADR-004` are (those are independently Accepted records; see `docs/CLAUDE_CONTEXT.md`'s "Architecture decision docs that actually exist").** Each `ADR-BMF-NNN` below restates a rule already stated in the numbered section it summarizes; nothing here should be cited from elsewhere as if it were a standalone, independently-approved record until this entire document is formally Accepted (per its own header status).

**ADR-BMF-001:** The platform will not define a single universal "sales" amount.

**ADR-BMF-002:** Each lifecycle domain owns its own canonical financial amount; for a composite/derived metric (Fulfilled Service Value), ownership is explicitly split across the contributing domains and joined only at the reporting layer (Section 3).

**ADR-BMF-003:** "Sales" and "Pending" may not be used as standalone reusable KPI names.

**ADR-BMF-004:** Booked Value, Invoiced Net Sales, and Cash Collected are distinct financial metrics. Fulfilled Service Value is a distinct, derived financial metric available *only* when an authoritative customer-price source exists, and is never independently owned or stored as an authoritative fact by a Work Order. `Completed Work Orders`/`Open Work Orders` are operational activity counts, never financial metrics — a count and a dollar amount must never share a label or be substituted for one another.

**ADR-BMF-005:** Tax is excluded from canonical revenue-labeled metrics unconditionally, not merely by default.

**ADR-BMF-006:** Posted financial events are corrected through auditable adjustments rather than destructive edits.

**ADR-BMF-007:** Partial fulfillment must preserve Booked Value, Fulfilled Service Value (where a price source exists) or Work Order counts (where it does not), and remaining Committed Backlog as separate figures — never collapsed into one number.

**ADR-BMF-008:** Dashboard and AI metrics must use a centralized semantic definition.

**ADR-BMF-009:** Canonical business meanings are platform-wide; workflow policy may be tenant-configurable.

**ADR-BMF-010:** The platform will not label a metric "recognized revenue," nor use the bare word "revenue" as a field or metric name, without an implemented accounting authority or a clearly described external accounting source.

**ADR-BMF-011:** All monetary records require an ISO 4217 currency code, decimal/minor-unit representation, and an explicit scale/rounding policy; authoritative money is never represented in binary floating-point.

**ADR-BMF-012:** Every financial provider integration must expose the state contract of Section 17 (`complete`/`partial`/`stale`/`error`/`unconfigured`, source IDs/versions, freshness, lineage, authority mode). Imported/cached external data is never authoritative merely by being stored locally; a governed local ledger may itself be authoritative when explicitly configured as such — storage location alone never determines authority.

**ADR-BMF-013:** Lifecycle stages (Section 2) are optional per customer relationship; a missing earlier stage is never fabricated to complete the canonical chain.

**ADR-BMF-014:** A missing prerequisite for any metric makes that metric unavailable, never zero, and never silently omitted without an explicit unavailable/unconnected/stale state.

**ADR-BMF-015:** Financial-metric visibility, masking, tenant isolation, audit logging, retention, and AI access boundaries (Section 19) must be explicitly defined by any Specification introducing financial reporting — access to a record does not imply access to its financial metrics.
