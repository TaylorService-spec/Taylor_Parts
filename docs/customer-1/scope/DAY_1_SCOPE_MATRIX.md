# Customer 1 — Day-1 scope matrix (PROPOSED)

**Gate:** `C1-SCOPE-01` — Day-1 scope and exclusions. **Status: OPEN.**

Everything on this page is a **proposal by Verenward engineering**. Nothing here is a Taylor
acceptance, an Owner authorization, or a contractual commitment. `C1-SCOPE-01` closes only when
Taylor and Verenward accept a classification for every family *and* accept the exclusions —
publishing this matrix does not close it.

## Vocabulary

| Class | Meaning |
|---|---|
| `DAY_1` | Taylor is expected to depend on this family from the first production day. |
| `POST_DAY_1` | Real committed scope, delivered after Day 1. Not required for cutover. |
| `PILOT` | Available Day 1 to a limited group, with no operational dependency on it. |
| `EXCLUDED` | Explicitly not part of the Customer 1 engagement. Must be accepted as an exclusion. |
| `UNCLASSIFIED` | Classification depends on a Taylor business fact or a commercial boundary that is not in this repository. Recorded as a blocker, not guessed. |

## What "family" means here

The unit is an **EOS family** as the repository already governs it: a page family in
[`docs/design/north-star-migration-ledger.md`](../../design/north-star-migration-ledger.md), or a
governed operational domain that has its own acceptance record. That register is the family universe
this matrix proposes; if Taylor and Verenward want a different unit of scope, that is itself a scope
decision and this matrix should be re-cut, not patched.

Acceptance states below are **copied by reference, not re-adjudicated**. The North Star ledger is the
authority for whether the Owner has accepted a family. This page never upgrades one.

## Matrix

| # | Family | Proposed class | Acceptance state (source of truth) | Evidence |
|---|---|---|---|---|
| 1 | Work Order | `DAY_1` | Closed 2026-08-25 | North Star ledger, Family 1 |
| 2 | Sales Order | `DAY_1` | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | North Star ledger, Family 2 |
| 3 | Account (Customer 360) | `DAY_1` | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | North Star ledger, Family 3 (second pass, 2026-08-26) |
| 4 | Opportunity (incl. 4b collection) | `UNCLASSIFIED` | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | North Star ledger, Families 4 and 4b — see blocker **S-1** |
| 5 | Sales Agreement | `UNCLASSIFIED` | Closed 2026-08-27 | North Star ledger, Family 5 — see blocker **S-1** |
| 6 | Service Operations | `DAY_1` | Closed 2026-08-30 | North Star ledger, Family 6 |
| 7 | Parts | `DAY_1` | Closed 2026-08-31 (P1v2, deployed `0f1ac714`) | North Star ledger, Family 7 |
| 8 | Equipment | `DAY_1` | Closed 2026-08-31 (deployed `f33dd113`) | North Star ledger, Family 8 |
| 9 | Receiving | `DAY_1` | Closed 2026-08-31 | North Star ledger, Family 9 |
| 10 | My Dashboard | `DAY_1` | Closed 2026-09-03 (`50792fef`) | North Star ledger, Family 10; ledger gate `C1-PRODUCT-01` |
| 11 | Technician Dashboard | `DAY_1` | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | North Star ledger, Family 11 |
| — | Dispatch & Scheduling | `DAY_1` | Accepted 2026-08-29 (P1v1) | North Star ledger, *Dispatch & Scheduling — P1v1* |
| — | Lists / collection surfaces (P2) | `DAY_1` (cross-cutting) | Not a separately accepted family | [`docs/north-star/lists/README.md`](../../north-star/lists/README.md) |
| — | Purchasing | `DAY_1` | No page-family acceptance record | Certification closeout PR #1761 (live Purchasing evidence); cost activation PR #1762, cited in `CUSTOMER_1_LEDGER.json` |
| — | Inventory / Cycle Count | `DAY_1` | No page-family acceptance record | Certification closeout PR #1761 (live Cycle Count evidence); consumption fix PR #1775, cited in `CUSTOMER_1_LEDGER.json` |
| — | Financials | `POST_DAY_1` | Design approved; **implementation NOT performed** | [`docs/north-star/financials/README.md`](../../north-star/financials/README.md) — `READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW`, 15 open authority gaps, 13 open product questions |
| — | Reporting | `UNCLASSIFIED` | Activation representable in repository configuration; **not live production evidence** | PRs #1768 / #1779, cited under `C1-SECURITY-01` — see blocker **S-2** |
| — | Taylor administrative self-service | `DAY_1` | Gate `C1-ADMIN-01` is OPEN | [`CUSTOMER_1_LEDGER.json`](../CUSTOMER_1_LEDGER.json), gate `C1-ADMIN-01` |
| — | EOS Contextual Assistant | `EXCLUDED` | Seam only; disabled by default | [`docs/roadmaps/business-capability-register.md`](../../roadmaps/business-capability-register.md) §17 |

## Proposed exclusions

Every capability in [`docs/roadmaps/business-capability-register.md`](../../roadmaps/business-capability-register.md)
that is not listed as a family above is proposed `EXCLUDED` from Customer 1 Day 1, on the single
stated ground that **none of them is built**. The register itself is explicit that it is a record of
future capability, not shipped behavior. This includes service contracts / preventive maintenance,
warranty and entitlement, returns / RMA / credits, purchasing economics and vendor performance,
accounts receivable and collections, sales credit and commissions, technician skills and work
eligibility, capacity and customer promise, exception ownership, temporary equipment custody,
technician labor cost accounting, multi-equipment fulfillment, commercial coverage and territory,
tenant metadata self-service, and multi-currency / FX.

An exclusion is not accepted because it is written here. It is accepted when Taylor accepts it.

## Open blockers this matrix raises

| Id | Category | Decision needed |
|---|---|---|
| **S-1** | `BLOCKED_TAYLOR` | Does Taylor operate a CRM pipeline (Opportunity) and sell under Sales Agreements from Day 1, or does Day 1 begin at Sales Order? Families 4, 4b and 5 are built and partly accepted, so this is a business-operating-model fact, not a readiness fact. |
| **S-2** | `BLOCKED_OWNER` | Is Reporting a Day-1 commitment, a pilot, or post-Day-1? The repository can represent production activation but has no live production evidence, so this is a commercial/contractual boundary rather than a technical one. |

## Relationship to `C1-PRODUCT-01`

`C1-PRODUCT-01` closes when every **Day-1** workflow has passed its applicable governed gates. It
therefore cannot close before this matrix is accepted, because until then the set of Day-1 workflows
is not defined. Of the families proposed `DAY_1` above, these still lack Owner visual acceptance and
are the current product-gate remainder:

- Family 2 — Sales Order
- Family 3 — Account
- Family 11 — Technician Dashboard
- Purchasing, Inventory / Cycle Count, and Lists have certification and gate evidence but no
  page-family acceptance record of their own.

Families 4, 4b and 5 are deliberately not counted in that remainder while blocker **S-1** is open.

## Maintenance rule

When a family's acceptance changes in the North Star ledger, update the *Acceptance state* column
here by reference. Do not restate the evidence. If a classification changes, that is a scope
decision and needs Taylor and Verenward, not an edit.
