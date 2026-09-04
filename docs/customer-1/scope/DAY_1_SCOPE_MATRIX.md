# Customer 1 — Day-1 scope matrix (PROPOSED)

**Gate:** `C1-SCOPE-01` — Day-1 scope and exclusions. **Status: OPEN.**
**Authority:** Verenward + Taylor. This file does not close the gate.

Everything in the classification column is a **proposal by Verenward engineering**. A proposal is
not an acceptance. `C1-SCOPE-01` closes only when Taylor and Verenward accept a classification for
every row *and* accept the explicit exclusions — recorded as evidence on the gate in
[`CUSTOMER_1_LEDGER.json`](../CUSTOMER_1_LEDGER.json), not by editing this table.

Nothing here declares Owner visual acceptance. Acceptance state is copied from the authority that
owns it and is cited, never re-derived.

## Vocabulary

| Token | Meaning |
|---|---|
| `DAY_1` | Taylor is proposed to depend on this from the first production day. |
| `POST_DAY_1` | Real Customer 1 need, deliberately after cutover. |
| `PILOT` | Available Day 1 to a bounded set of users, with no operational dependency. |
| `EXCLUDED` | Not part of Customer 1 at all. |
| `UNDETERMINED` | Classification depends on a Taylor or Owner decision that is not this lane's to make. Every `UNDETERMINED` row names its blocker. |

## What counts as a family

`C1-SCOPE-01` says *every EOS family*. Two different things are called a family in this repository,
and conflating them is how a matrix ends up looking complete while omitting half the product:

1. **North Star page families** — numbered rows in
   [`north-star-migration-ledger.md`](../../design/north-star-migration-ledger.md), each carrying
   its own Owner acceptance state. Families 1–11, plus 4b, plus the un-numbered Dispatch &
   Scheduling entry.
2. **Operational areas that Customer 1 evidence already depends on but that hold no numbered North
   Star row** — Purchasing, Inventory/Cycle Count, Financials, Reporting, and administrative
   access. They appear in `C1-PRODUCT-01` and `C1-SECURITY-01` evidence today. Omitting them
   because they lack a family number would make this matrix quietly false.

Both are rows below. Future-capability entries in
[`business-capability-register.md`](../../roadmaps/business-capability-register.md) are **not** rows:
they are `IDENTIFIED` needs with no built surface, and are outside Day 1 by construction.

## Proposed classification matrix

| Row | Evidence source | Acceptance state | Proposed | Blocker |
|---|---|---|---|---|
| Family 1 — Work Order | north-star-migration-ledger.md | Closed 2026-08-25 | `DAY_1` | — |
| Family 2 — Sales Order | north-star-migration-ledger.md | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `DAY_1` | — |
| Family 3 — Account (Customer 360) | north-star-migration-ledger.md | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `DAY_1` | — |
| Family 4 — Opportunity (record) | north-star-migration-ledger.md | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `UNDETERMINED` | BLK-canary-A-1 |
| Family 4b — Opportunity collection | north-star-migration-ledger.md | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `UNDETERMINED` | BLK-canary-A-1 |
| Family 5 — Sales Agreement | north-star-migration-ledger.md | Closed 2026-08-27 | `UNDETERMINED` | BLK-canary-A-1 |
| Family 6 — Service Operations | north-star-migration-ledger.md | Closed 2026-08-30 | `DAY_1` | — |
| Family 7 — Parts | north-star-migration-ledger.md | Closed 2026-08-31 | `DAY_1` | — |
| Family 8 — Equipment | north-star-migration-ledger.md | Closed 2026-08-31 | `DAY_1` | — |
| Family 9 — Receiving | north-star-migration-ledger.md | Closed 2026-08-31 | `DAY_1` | — |
| Family 10 — My Dashboard | north-star-migration-ledger.md | Closed 2026-09-03 | `DAY_1` | — |
| Family 11 — Technician Dashboard | north-star-migration-ledger.md | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `DAY_1` | — |
| Dispatch & Scheduling | north-star-migration-ledger.md | Accepted 2026-08-29 | `DAY_1` | — |
| Purchasing | CUSTOMER_1_LEDGER.json C1-PRODUCT-01 | No North Star family row | `DAY_1` | — |
| Inventory / Cycle Count | CUSTOMER_1_LEDGER.json C1-PRODUCT-01 | No North Star family row | `DAY_1` | — |
| Administrative access and roles | CUSTOMER_1_LEDGER.json C1-SECURITY-01 | No North Star family row | `DAY_1` | — |
| Financials / AR | CUSTOMER_1_LEDGER.json C1-PRODUCT-01 | No North Star family row | `UNDETERMINED` | BLK-A-3 |
| Reporting | CUSTOMER_1_LEDGER.json C1-SECURITY-01 | No North Star family row | `UNDETERMINED` | BLK-canary-A-2 |

Acceptance values are the North Star ledger's own tokens. Where a family's ledger row was appended
to more than once, the value above is the latest dated entry, which is how that ledger is written:
appended, never rewritten.

## Why each `DAY_1` proposal is proposed

Taylor Arizona is a service, parts, and equipment operation. The proposals below follow from what a
technician, a parts clerk, and a dispatcher must do on the first production morning, not from what
happens to be built:

- **Work Order, Service Operations, Technician Dashboard, Dispatch & Scheduling** — a service call
  cannot be taken, assigned, worked, or closed without them.
- **Parts, Inventory/Cycle Count, Receiving, Purchasing** — a Work Order that consumes stock needs
  stock that is real, replenished, and received.
- **Equipment** — the installed base a service call is *about*.
- **Account, Sales Order** — the customer a job is billed to and the order it is worked against.
  Both branches of BLK-canary-A-1 include Sales Order, so this proposal does not presume its answer.
- **My Dashboard, administrative access and roles** — the landing surface and the ability for Taylor
  to administer itself; `C1-ADMIN-01` is launch-critical on its own.

## Why each `UNDETERMINED` row is not classified here

- **Families 4, 4b, 5 (Opportunity, Sales Agreement)** — whether Taylor's Day-1 commercial flow
  begins at Opportunity or at Sales Order is a Taylor business fact. Open blocker
  **BLK-canary-A-1**. Note that Family 5 is Owner-accepted product: acceptance is not scope.
- **Reporting** — Day 1, pilot, or post-Day-1 is an Owner commercial call. Open blocker
  **BLK-canary-A-2**.
- **Financials / AR** — new blocker **BLK-A-3**: does Taylor depend on EOS financial/AR surfaces
  from Day 1, or does an existing accounting system remain the authority for money, with EOS
  costing feeding it? The ledger already records that Taylor's actual financial-policy profile is a
  customer/accounting choice this program does not infer.

## What remains for `C1-PRODUCT-01` on the proposed Day-1 rows

`C1-PRODUCT-01` closes when every Day-1 workflow passes its **applicable** governed functional,
sandbox, North Star, and acceptance gates. Against the proposals above, the outstanding items are:

| Row | Outstanding |
|---|---|
| Family 2 — Sales Order | Owner visual acceptance |
| Family 3 — Account | Owner visual acceptance |
| Family 11 — Technician Dashboard | Owner visual acceptance |
| Cross-family — EOS visual system | Owner visual acceptance of the site-wide result |
| Purchasing, Inventory/Cycle Count, Administrative access | No North Star family row exists; whether one is *required* for Day 1 is a product-authority question, not a defect |
| All rows | Production evidence. Every acceptance above is sandbox acceptance. `C1-SECURITY-01` and `C1-OWNER-01` remain the production boundary |

Nothing in this section moves `C1-PRODUCT-01`. It records what closing it would still take if these
proposals were accepted exactly as written.

## Verification

`node docs/customer-1/scope/verify-scope-matrix.mjs` — parses the ledger JSON, checks every
classification token against the vocabulary above, checks that every `UNDETERMINED` row names a
blocker, resolves this file's relative links on disk, and checks that the `CUSTOMER_1_READINESS.md`
gate table agrees with `CUSTOMER_1_LEDGER.json`.
