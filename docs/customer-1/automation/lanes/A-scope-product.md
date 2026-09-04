# Lane A — Scope / Product Close

**Priority 10 (highest). Branch prefix `customer1/a-`.**

## Mandate

Freeze what Day 1 actually is, and reconcile product evidence against it. Lane
A exists because `C1-SCOPE-01` is the top of the Customer 1 critical path: until
each EOS family is explicitly Day 1, post-Day-1, pilot, or excluded, no product
gate can honestly close even when individual families do.

## Gates owned

- `C1-SCOPE-01` — Day-1 scope and exclusions (OPEN, launch-critical)
- `C1-PRODUCT-01` — Day-1 workflow readiness (IN_PROGRESS, launch-critical)

## Owned paths

```
docs/customer-1/CUSTOMER_1_READINESS.md
docs/customer-1/CUSTOMER_1_LEDGER.json
docs/customer-1/scope/**
docs/customer-1/acceptance/**
```

## May

- Build and maintain the Customer 1 Day-1 scope matrix.
- Reconcile North Star family status (`docs/design/north-star-migration-ledger.md`)
  against Customer 1 Day-1 need.
- Prepare acceptance evidence packages so the Owner can review, not reconstruct.
- Fix bounded, non-governance corrective defects that block an agreed Day-1
  workflow.

## Must not

- Declare Owner visual acceptance. Acceptance is the Owner's, always.
- Broaden product authority.
- Decide whether ambiguous business scope belongs in Day 1 — that is a Taylor
  and Verenward decision. Propose a classification, record the ambiguity as a
  blocker, and move on.
- Mark a gate READY because implementation exists. The gate closes on its own
  `closeWhen`, nothing else.

## Seeded objectives

These are top-level objectives, not an enumerated work queue. The worker derives
one bounded item per session.

1. Produce a scope matrix listing every EOS family with a **proposed**
   classification (Day 1 / post-Day-1 / pilot / excluded) and the evidence
   behind each proposal. Proposals are proposals until Taylor and Verenward
   accept them.
2. For each proposed Day-1 family, record which governed gates it has already
   passed and which remain, citing the source evidence rather than copying it.
3. Maintain the acceptance evidence index so any accepted family points at the
   live build it was accepted against.

## Blocker triggers

Record a blocker rather than deciding, when:

- a family's Day-1 status depends on a Taylor business fact not in the repo
  (`BLOCKED_TAYLOR`);
- classification requires a commercial or contractual boundary (`BLOCKED_OWNER`);
- closing a gate would require an authority change (`BLOCKED_GOVERNANCE`).

## Proofs

Documentation items: JSON parse of the ledger, internal link resolution, and
consistency between `CUSTOMER_1_LEDGER.json` and `CUSTOMER_1_READINESS.md`.

Corrective defect items: the narrowest existing targeted test for the touched
surface. Do not run the full suite.
