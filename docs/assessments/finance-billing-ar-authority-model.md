# Finance / Billing / AR — Authority Model (design-first)

**Status:** Design-first assessment + a PURE, amounts-free foundation (this increment). No persistence, no
governed write, no Rules, no amounts/tax/revenue/policy. Several Finance decisions are **genuinely material
(multiple legitimate business models)** and are **returned for Owner/Finance judgment** (§ Material decisions).

## 1. Reconciliation against repository authority

- The **only** operations→Finance handoff today is the pure `computeBillingEligibility`
  (`functions/src/fulfillment/billingEligibility.ts`): `NOT_YET | PARTIALLY_ELIGIBLE | ELIGIBLE | HELD |
  CANCELLED`, carrying **no invoice, amount, tax, or "when to bill"** — it explicitly states the Finance domain
  is greenfield and owns financial processing, and that **order amount ≠ invoice ≠ payment ≠ revenue**.
- There is **no invoice / AR / payment / revenue** domain anywhere (grep: only `paymentTerms` / `taxStatus` /
  `billingContact` on the Account commercial profile, and `financialForecastHorizons` — none of which is an AR
  ledger). Finance is genuinely greenfield beyond the billing-eligibility seam.
- The Account already carries `paymentTerms` (net terms) and `taxStatus` — inputs a future Finance domain
  consumes to compute due dates and tax; this foundation does **not** consume them yet (that is policy).

## 2. Authority model (pure; `field-ops-app-vite/src/domain/commercialFinance.js`)

Built strictly on what is unambiguous; **carries no amounts** so it commits no pricing/tax/revenue policy.

- **Invoice lifecycle (amounts-free):** `DRAFT → ISSUED → SENT → (PARTIALLY_PAID ⇄ PAID) → | VOID`. `PAID`/`VOID`
  terminal; `canTransitionInvoice` is the legal graph. **OVERDUE is NOT a stored state** — it is derived.
- **AR position (factual, policy-free):** `deriveArPosition(invoice, now)` → `CURRENT | OVERDUE | PAID | VOID |
  UNKNOWN` with a factual `daysOverdue`. Missing due date ⇒ **UNKNOWN** (never assumed current). It deliberately
  computes **no aging buckets** (a policy decision).
- **Operations → Finance candidate:** `invoiceCandidateFromBillingEligibility(eligibilityResult, lines)` turns
  an `ELIGIBLE` / `PARTIALLY_ELIGIBLE` billing eligibility into **candidate billable lines** (`{ref,
  billableQty}` = the fulfilled portion) with **no amount / price / tax**. `HELD`/`NOT_YET`/`CANCELLED` ⇒ **no
  candidate** (fail-closed). `PARTIALLY_ELIGIBLE` sets `finalityDeferredToFinance` — the candidate says what
  *could* be billed; Finance decides what/when.
- **Money concepts stay distinct:** the foundation moves **quantities**, never amounts — order ≠ invoice ≠
  payment ≠ revenue is preserved by construction (tested: no amount/price/tax field on any candidate line).

## 3. Material decisions — RETURNED for Owner/Finance judgment

These are genuinely different business semantics with multiple legitimate models; per the roadmap rule they are
**not** decided autonomously. The pure foundation above is deliberately shaped to accommodate any choice:

1. **Revenue recognition** — on-invoice vs on-fulfillment vs milestone/percentage-complete vs on-payment. Drives
   whether "revenue" is a separate ledger from invoicing.
2. **Tax computation** — jurisdiction/engine, tax-on-invoice vs tax-at-order, exemption handling (Account
   `taxStatus` exists but the engine/policy does not).
3. **Pricing → amounts** — where the billable amount comes from (Sales Order `unitPrice` snapshot vs a Finance
   price book vs re-priced at invoice), rounding/currency policy.
4. **AR aging buckets + collections** — bucket thresholds (0-30/31-60/… vs custom) and what triggers a
   collections workflow. `daysOverdue` is factual; the buckets/triggers are policy.
5. **Partial-billing policy** — for `PARTIALLY_ELIGIBLE`, whether/when to bill the fulfilled portion (bill-as-you-
   fulfill vs bill-on-complete vs milestone).
6. **Invoice numbering / identity** — scheme, sequence authority, per-company vs global.
7. **Credits / adjustments / refunds / write-offs** — the negative-AR lifecycle (not modeled here).

## 4. Buildable-next (after the material decisions, or the parts that don't need them)

- Governed invoice/payment collections + write commands + Rules (deny-all, inert) — the repo-only fail-closed
  pattern (register `active:false`, export ≠ deploy), a **protected** activation later.
- An amounts-free AR read surface (invoice lifecycle + AR position + candidate) — UX-owned for IA.

## 5. Boundary

No capability grant, callable deploy, Rules change, production action, amounts, tax, or revenue policy in this
increment. The billing-eligibility seam and money-concept distinctions are preserved. The material Finance
decisions above require Owner/Finance judgment before the amount-bearing parts are built.
