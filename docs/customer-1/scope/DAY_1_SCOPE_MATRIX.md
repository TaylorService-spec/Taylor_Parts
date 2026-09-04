# Customer 1 — Day-1 scope matrix (PROPOSED)

**Gate:** `C1-SCOPE-01` — Day-1 scope and exclusions. **Status: OPEN.**
**Authority:** Verenward + Taylor. Nothing on this page is accepted scope.

Every classification below is a **proposal by Verenward engineering**, derived from repository
evidence only. A proposal becomes scope when Taylor and Verenward accept it and that acceptance is
recorded in `CUSTOMER_1_LEDGER.json`. Until then `C1-SCOPE-01` stays `OPEN` even if every row is
filled in.

## Classification vocabulary

| Value | Meaning |
|---|---|
| `DAY_1` | Taylor is expected to depend on this family in production from Day 1. |
| `POST_DAY_1` | Real scope, deliberately after Day 1. |
| `PILOT` | Available Day 1 to a named subset, not depended on by the business. |
| `EXCLUDED` | Not in the Customer 1 engagement. Exclusion must be explicit and accepted. |
| `BLOCKED` | Cannot be proposed without a Taylor or Owner fact that is not in the repository. |

## Evidence sources

- Family acceptance state — [`docs/design/north-star-migration-ledger.md`](../../design/north-star-migration-ledger.md)
- Broader capability list — [`docs/roadmaps/business-capability-register.md`](../../roadmaps/business-capability-register.md)
- Gate record — [`CUSTOMER_1_LEDGER.json`](../CUSTOMER_1_LEDGER.json)

The acceptance column is copied from the migration ledger's own `Acceptance` cell. It is design
acceptance on sandbox, **not** production readiness and **not** `C1-PRODUCT-01`.

## North Star family register

| Family | North Star acceptance (source: migration ledger) | Proposed Day-1 class | Basis for the proposal |
|---|---|---|---|
| 1 — Work Order | Closed 2026-08-25 | `DAY_1` | Taylor is a field-service business; a work order is the unit of service work. No repository evidence suggests service can run without it. |
| 2 — Sales Order | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `DAY_1` | Parts sales and fulfillment already depend on it; the consumption/availability chain proved in `C1-PRODUCT-01` evidence runs through Sales Order availability. |
| 3 — Account (Customer 360) | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `DAY_1` | Every other Day-1 family resolves a customer. Excluding it would strand the rest. |
| 4 — Opportunity (record) | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `BLOCKED` | Depends on open blocker `BLK-canary-A-1`: whether the Day-1 commercial flow starts at Opportunity or at Sales Order. |
| 4b — Opportunity collection | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `BLOCKED` | Same blocker as family 4; the two surfaces are one family and classify together. |
| 5 — Sales Agreement | Closed 2026-08-27 | `BLOCKED` | Depends on `BLK-canary-A-1`: whether Taylor sells under Sales Agreements from Day 1. |
| Dispatch & Scheduling | ACCEPTED (Owner, 2026-08-29) | `DAY_1` | Service work must be assigned and scheduled for family 1 to be operable. |
| 6 — Service Operations | Closed 2026-08-30 | `DAY_1` | The execution surface for accepted service work. |
| 7 — Parts | Closed 2026-08-31 (P1v2) | `DAY_1` | Parts inventory is a named launch-critical gate of its own (`C1-INV-01`). |
| 8 — Equipment | Closed 2026-08-31 | `DAY_1` | Serialized customer equipment is the object service and warranty attach to. |
| 9 — Receiving | Closed 2026-08-31 | `DAY_1` | Without receiving, on-hand inventory cannot be maintained after opening balances. |
| 10 — My Dashboard | ACCEPTED (Owner, 2026-09-03) | `DAY_1` | The general landing surface; training is already `COMPLETE — LIVE VERIFIED`. |
| 11 — Technician Dashboard | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `DAY_1` | Technicians are a Day-1 persona and this is their entry surface. |

## Surfaces outside the family register

These are shipped or specified EOS areas that the North Star migration ledger does not carry as a
numbered family. They are listed because `C1-SCOPE-01` closes on *every* EOS family, and silently
omitting them would make the gate close on a narrower census than it claims.

| Area | Repository evidence | Proposed Day-1 class | Basis |
|---|---|---|---|
| Purchasing (purchase orders, price entry) | `C1-PRODUCT-01` evidence (PR #1762 cost activation); `docs/training/PURCHASING_RECORD_PURCHASE_ORDER.md` | `DAY_1` | Receiving and parts costing both depend on a governed purchase commitment. |
| Financials / AR (20 North Star pages) | `docs/financials/FINANCIALS_IMPLEMENTATION_RUN_LEDGER.md`; `docs/north-star/financials/` | `BLOCKED` | Depends on open blocker `BLK-run-20260904-065957-A-2`: whether an existing accounting system remains the authority for money. |
| Reporting | `C1-SECURITY-01` evidence (PRs #1768, #1779) | `BLOCKED` | Depends on open blocker `BLK-canary-A-2`. |
| Administration / access management | Gate `C1-ADMIN-01` | `DAY_1` | `C1-ADMIN-01` is independently launch-critical; Taylor cannot depend on EOS without ordinary self-service administration. |

## What this page does not do

- It does not move `C1-SCOPE-01`. The gate closes on Taylor and Verenward acceptance, not on the
  existence of this matrix.
- It does not declare Owner visual acceptance for any family. The acceptance column is copied from
  the migration ledger, which is the only place that state is set.
- It does not resolve the four blocked rows. Those are Taylor and Owner business decisions and are
  recorded as blockers rather than guessed.
- It does not assert that a `DAY_1` proposal is *ready*. Readiness is `C1-PRODUCT-01`; the per-family
  gate reconciliation against these proposals lives in
  [`../acceptance/DAY_1_GATE_RECONCILIATION.md`](../acceptance/DAY_1_GATE_RECONCILIATION.md).

## Open question this matrix surfaces

The census boundary itself is undecided. `C1-SCOPE-01` says "every EOS family", and the repository
holds two candidate registers: the North Star migration ledger (13 family rows) and the business
capability register (broader, capability-shaped, not page-shaped). This matrix covers the first and
names the four largest surfaces outside it, but which register is authoritative for the gate's close
condition is a governance decision, not an engineering one.
