# Assessment — Completion → Finance seam + Billing / AR (design-first)

Finance is **greenfield** (register #6 A/R & Collections; financials nav is a `future` placeholder). This
assessment establishes the **minimum truthful handoff** from operations to Finance and the shape of a future
Billing/AR domain — **without inventing invoice policy** now. Neither the Work Order nor the Sales Order is the
accounting authority; **Finance owns financial processing.**

## The seam (BUILT — `functions/src/fulfillment/billingEligibility.ts`)
Operations produce a truthful **billing-eligibility** read from three inputs it already owns:
```
commercial commitment (Sales Order)  +  fulfillment evidence (per-line fulfilled vs ordered)
                                     +  operational completion (coordinated field mission)
                                          ↓
                                   BILLING ELIGIBILITY   →   Finance
```
Honest states, each explicit (Owner): `ELIGIBLE` (fully fulfilled) · `PARTIALLY_ELIGIBLE` (Finance decides
what/when) · `HELD` (a blocked unit or unresolved additional-work/exception — never bill through a blocker) ·
`CANCELLED` · `NOT_YET`. It reports **only eligibility + fulfilled fraction** — **no invoice, no amount, no
tax/discount, no "when to bill".** That is the Finance domain's authority.

## Money concepts stay distinct (do not conflate)
`order amount ≠ invoice amount ≠ payment ≠ revenue ≠ technician cost ≠ commission.` The seam carries the
order-side fulfillment truth; each other concept is a separate later authority.

## Future Billing / AR domain (design-first — NOT built)
Minimum flow when the domain is authorized: `billing eligibility → Invoice → Sent → Due → Payment / Partial
Payment → Overdue → Collections → Paid/Settled`. It must preserve the business distinction between
**operationally complete**, **invoiced**, and **financially complete** (register #6). Delivery method
(email/mail), amount due, payments, outstanding balance, collection status are Finance-domain fields — do NOT
overbuild ERP/accounting; define the EOS operational seam + authoritative integration boundary. Sales gets
completion/paid **visibility** only (register #7); Sales is never the payment authority, and commission is
visibility ≠ calculation/payment.

## Boundaries preserved
- Work Order / Sales Order never become the accounting authority.
- The eligibility seam is a pure READ over existing evidence — no new inventory/commercial/finance authority,
  no Rules, no capability. When the Finance domain is authorized it CONSUMES this eligibility rather than
  operations reaching into accounting.
- Effective-dated cost/attribution (Technician Labor #13; Commercial Coverage #15) and Warranty/Entitlement
  (#2) feed Finance later; none is foreclosed.

## Roadmap trigger
Build the Finance/Billing domain when Sales Order → Billing architecture is authorized (its own greenfield
design-first cycle). Until then this eligibility seam is the truthful operations→Finance boundary and is
inert-safe (a pure projection).
