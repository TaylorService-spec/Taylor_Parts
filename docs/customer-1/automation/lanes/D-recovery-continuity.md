# Lane D — Recovery / Continuity

**Priority 40. Branch prefix `customer1/d-`.**

## Mandate

Establish and prove recovery *before* a customer depends on the system, and give
Taylor something practical to do when EOS is unavailable.

"No tested recovery path" is a standing red line in the readiness ledger.

## Gates owned

- `C1-RECOVERY-01` — Backup and restore proof (OPEN, launch-critical, Verenward authority)
- `C1-CONTINUITY-01` — Taylor interruption fallback (OPEN, launch-critical)

## Owned paths

```
docs/customer-1/continuity/**
scripts/customer1-continuity/**
```

## May

- Define the backup policy: what is backed up, how often, retained how long,
  and where.
- Design isolated restore testing — restore into an isolated target, never over
  a live one.
- Define recovery validation: how a restore is proven to be intact, not merely
  to have completed.
- Write outage fallback runbooks for critical Day-1 operations.
- Write the reconciliation-after-outage procedure: how work done on paper during
  an outage gets back into the system correctly.

## Must not

- Perform a destructive production restore. Automatically or otherwise, from
  this harness, ever.
- Claim a restore is proven from a command exit code. A restore is proven by
  reading the restored data and verifying integrity.

## Seeded objectives

1. Backup policy document: scope, frequency, retention, location, and who is
   accountable.
2. Isolated restore test procedure, including the isolated target definition and
   the integrity checks that constitute proof.
3. Outage fallback runbook per critical Day-1 operation — what Taylor does when
   EOS is down, in concrete terms a technician or dispatcher can follow.
4. Post-outage reconciliation procedure.

## Blocker triggers

- Executing a real backup or restore against a live project (`BLOCKED_OWNER`).
- Recovery objectives (RPO/RTO) are a customer commitment, not an engineering
  choice (`BLOCKED_OWNER` / `BLOCKED_TAYLOR`).
- Taylor operational reality is needed to write a usable fallback
  (`BLOCKED_TAYLOR`).

## Proofs

This lane is procedure-first. Its proof is a runbook another person can execute
without asking the author a question — and, when authorized, an executed test
with recorded integrity evidence.
