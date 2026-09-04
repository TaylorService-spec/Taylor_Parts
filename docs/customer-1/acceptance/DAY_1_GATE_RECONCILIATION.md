# Customer 1 — Day-1 gate reconciliation and acceptance evidence index

**Gate:** `C1-PRODUCT-01` — Day-1 workflow readiness. **Status: IN_PROGRESS.**
**Authority:** Verenward + Owner acceptance where required.

`C1-PRODUCT-01` closes when *every Day-1 workflow has passed its applicable governed functional,
sandbox, North Star, and acceptance gates.* This page is the per-family reconciliation of that
condition against the Day-1 rows **proposed** in
[`../scope/DAY_1_SCOPE_MATRIX.md`](../scope/DAY_1_SCOPE_MATRIX.md).

Two things this page is not:

- It is **not** scope. The Day-1 column here is a Verenward proposal; `C1-SCOPE-01` is still `OPEN`.
  A row can be fully green and still not be Day 1.
- It is **not** an acceptance. Owner visual acceptance is set in
  [`../../design/north-star-migration-ledger.md`](../../design/north-star-migration-ledger.md) and
  nowhere else. Every `ACCEPTED` cell below is a citation of that file, not a grant.

## The four gate columns

| Column | What it means | What it does not mean |
|---|---|---|
| Functional | Family-specific automated proof exists and is recorded in the migration ledger's `Proof` row. | That the proof ran against the deployed build. |
| Sandbox | A North Star Quick Gate or the Full Sandbox Regression Gate passed against a **named deployed** commit. | Production. Nothing here is production evidence. |
| North Star | The family has a design authority artifact and a composition built against it. | Acceptance. |
| Acceptance | The Owner gave visual acceptance, recorded in the migration ledger. | That the accepted build is the current sandbox build. |

## Reconciliation — proposed Day-1 rows

| Proposed Day-1 row | Functional | Sandbox | North Star | Acceptance | Accepted against |
|---|---|---|---|---|---|
| 1 — Work Order | PASSED | PASSED — Full Sandbox Regression Gate, 300/300 visits, 40/40 scanner | PASSED — P1v2 ruling 2026-08-25 | ACCEPTED 2026-08-25 | **not recorded** (see gap G-1) |
| 2 — Sales Order | PASSED — 4 suites + 10 mutation proofs | PASSED — Quick Gate vs deployed `1c8095d3` | PASSED — composed from the grammar, no design artifact received | **REMAINS** — `AWAITING_OWNER_VISUAL_ACCEPTANCE` | — |
| 3 — Account (Customer 360) | PASSED — 5 suites, second pass | **REMAINS** — Quick Gate certified `1c8095d3`, which predates the P1 second pass `7b6eaf14`; a refresh is owed | PASSED — `North Star - Account P1.dc.html` | **REMAINS** — `AWAITING_OWNER_VISUAL_ACCEPTANCE` | — |
| Dispatch & Scheduling | PASSED | PASSED — accepted over live interactions | PASSED — P1v1 | ACCEPTED 2026-08-29 | `36280c30` (Hosting only) |
| 6 — Service Operations | PASSED — 4 suites | PASSED — local full suites; acceptance was given on the live composition | PASSED | ACCEPTED 2026-08-30 | `0a5aeca3` |
| 7 — Parts | PASSED — 4 suites | PASSED — 29/29 vs deployed `0f1ac714` (P1v2 closing run) | PASSED — P1v2 after the P1 composition was rejected | ACCEPTED 2026-08-31 | `0f1ac714` |
| 8 — Equipment | PASSED — 3 new suites + 9 re-anchored | PASSED — Quick Gate 35/0/3 vs deployed `9848ec9d` | PASSED | ACCEPTED 2026-08-31 | `f33dd113` (see gap G-2) |
| 9 — Receiving | PASSED — behavior anchored by existing receiving suites | PASSED — Quick Gate 20/20 vs the deployed release | PASSED — six frames | ACCEPTED 2026-08-31 | `0abc2353` |
| 10 — My Dashboard | PASSED — 6 suites | PASSED — corrected build, gate 245/245 | PASSED — `DESIGN-HANDOFF-MY-DASHBOARD-P1v2` | ACCEPTED 2026-09-03 | `50792fef` (per `CUSTOMER_1_LEDGER.json`, PR #1792) |
| 11 — Technician Dashboard | PASSED — 9 technician tests + 4 mutation proofs | **REMAINS** — no family Quick Gate recorded | PASSED — shares the Family 10 design authority, §4.1 | **REMAINS** — `AWAITING_OWNER_VISUAL_ACCEPTANCE` | — |
| Purchasing | PASSED — cost activation, Decision #166 | PASSED — bounded live Purchasing ceremony evidence in the certification closeout (PR #1761) | **N/A** — not a North Star family row | **REMAINS** — no Owner visual acceptance recorded | — |
| Administration / access management | **REMAINS** — no Day-1 administration proof set identified | **REMAINS** | **N/A** — not a North Star family row | **REMAINS** | — |

The row set above is machine-checked against the scope matrix by
[`../scope/verify-scope-matrix.mjs`](../scope/verify-scope-matrix.mjs): every `DAY_1` proposal must
have exactly one row here, and every row here must be a `DAY_1` proposal. If a blocked row is later
classified `DAY_1`, that check fails until this table grows the row.

Source for every Functional / Sandbox / North Star / Acceptance cell is the family's own row in
[`../../design/north-star-migration-ledger.md`](../../design/north-star-migration-ledger.md), except
Purchasing and Administration, whose evidence is the `C1-PRODUCT-01` and `C1-ADMIN-01` entries in
[`../CUSTOMER_1_LEDGER.json`](../CUSTOMER_1_LEDGER.json). Evidence is cited, not copied.

## Acceptance evidence index

Seven proposed Day-1 rows carry Owner visual acceptance. Six of them name the live build the
acceptance was given against; those SHAs are the `Accepted against` column above and are the index
this lane maintains. All are `platform-sandbox`. **No row on this page is production evidence.**

Each named SHA is a **citation**, so
[`../scope/verify-scope-matrix.mjs`](../scope/verify-scope-matrix.mjs) checks that it still appears
in a source of record — the migration ledger or [`../CUSTOMER_1_LEDGER.json`](../CUSTOMER_1_LEDGER.json).
An `ACCEPTED` row must therefore either name a build that its source also names, or cite a recorded
gap. A mistyped or invented SHA fails the check; the check does not confirm the acceptance itself,
which only the migration ledger grants.

## What remains for `C1-PRODUCT-01`

Against the *proposed* Day-1 set, the gate cannot close until at least:

1. Families 2, 3 and 11 receive Owner visual acceptance — Owner authority, not schedulable here.
2. Family 3's sandbox gate is refreshed from `7b6eaf14`; the recorded Quick Gate certified an
   earlier commit and says nothing about the second pass. `scripts/_sandboxRefresh.run.sh` is
   human-triggered by design.
3. Family 11 gets a sandbox gate, or the migration ledger records why one is not applicable.
4. Purchasing and Administration are either given an applicable-gate set or classified out of the
   Day-1 workflow set by `C1-SCOPE-01`.
5. The six `BLOCKED` scope rows (families 4, 4b, 5, Financials/AR, Reporting, CAP-6 Accounts
   Receivable) are classified. If any lands in Day 1, this reconciliation grows rows.

## Recorded gaps

- **G-1 — Family 1 acceptance has no deployed SHA.** The migration ledger records `Closed
  2026-08-25` but not the build it was accepted against, so the acceptance evidence index cannot
  point family 1 at a live build. This is a Verenward record gap in a file outside this lane's owned
  paths; recorded here rather than edited there.
- **G-2 — Family 8 gate SHA and accepted SHA differ.** The Quick Gate ran against deployed
  `9848ec9d`; acceptance was given on deployed `f33dd113`. Both are recorded in the migration
  ledger as-is. Whether the gate result carries forward to the accepted build is a question for the
  family's authority, not for this reconciliation.
- **G-3 — accepted builds may not be current.** Acceptance is pinned to a build, and sandbox has
  been redeployed since (the EOS visual system landed on `5eaa403a`, 2026-09-02). An accepted
  family is accepted against its named SHA, not against whatever sandbox runs today.
