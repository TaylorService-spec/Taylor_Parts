# Lane G — Cutover / Launch

**Priority 70 (lowest). Branch prefix `customer1/g-`.**

## Mandate

Make the launch repeatable on paper before it happens once in reality, and
assemble the package the Owner reviews when authorizing production dependency.

## Gates owned

- `C1-CUTOVER-01` — Cutover rehearsal and authorization package (OPEN, launch-critical)
- `C1-OWNER-01` — Final production dependency authorization (NOT_AUTHORIZED, **Owner only**)

`C1-OWNER-01` is permanently `automaticTransitionAllowed: false`. This lane
prepares its package. It can never transition it.

## Owned paths

```
docs/customer-1/cutover/**
```

## May

- Write and maintain the cutover runbook: source freeze, final exports,
  migration, reconciliation, user activation, smoke tests, fallback, signoff.
- Collect dependency receipts — which gate, which evidence, which SHA.
- Validate prerequisites (read-only) and report what is not yet satisfied.
- Design a non-destructive rehearsal and the smoke-test plan.
- Write the fallback plan, including the decision point at which it is invoked
  and who invokes it.
- Assemble the launch evidence package.

## Must not

- Perform production go-live.
- Transition final Owner authorization, or represent readiness as authorization.
- Perform any destructive customer action.
- Report a gate as satisfied on the strength of another lane's narrative. Cite
  the gate's own evidence.

## Dependencies

This is the only lane with hard lane dependencies. It may run at any time to
draft procedure, but it may not declare the authorization package complete until
lanes A through F report their gates closed on their own `closeWhen` terms.

Drafting the runbook early is useful precisely because it surfaces which
prerequisites nobody owns yet.

## Seeded objectives

1. Cutover runbook covering the full sequence, with each step naming its owner,
   its precondition, its verification, and its rollback.
2. Prerequisite receipts matrix: one row per launch-critical gate, its current
   status read from `CUSTOMER_1_LEDGER.json`, and the evidence link.
3. Non-destructive rehearsal plan — what can be rehearsed without touching
   production, and what honestly cannot.
4. Smoke-test plan for the first hour after cutover.
5. Fallback plan with a named decision point and decision owner.
6. The authorization package index the Owner reads to make the go/no-go call.

## Blocker triggers

- Any rehearsal step that would require a production action (`BLOCKED_OWNER`).
- A cutover step whose owner is a Taylor role that has not been designated
  (`BLOCKED_TAYLOR`).
- The go/no-go decision itself, always (`BLOCKED_OWNER`).

## Proofs

The prerequisite matrix is generated from the ledger, not hand-maintained, so
that it cannot drift into optimism. Its check is that every launch-critical gate
in `CUSTOMER_1_LEDGER.json` appears in the matrix with its current status.
