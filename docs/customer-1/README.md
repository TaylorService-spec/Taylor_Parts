# Taylor Customer 1 — Production Readiness

**Status: LIVE PROGRAM LEDGER.**

This directory is the durable source of truth for the question:

> What has been completed, what remains, what is blocking Taylor Freezer of Arizona from depending on EOS in production, and who owns the next action?

It is not a feature backlog and it is not a substitute for the existing governed product, deployment, authorization, North Star, or certification authorities. It reconciles those authorities into a Customer 1 launch decision.

## Files

- `CUSTOMER_1_READINESS.md` — human-readable executive ledger and go/no-go view.
- `CUSTOMER_1_LEDGER.json` — machine-readable gate state for agents and tooling.
- `AUTOMATION_RULES.md` — rules for evidence collection, status transitions, cost control, and human authority.
- `../training/README.md` — permanent deployment training-close gate.

## Status vocabulary

- `READY` — required evidence exists and the gate is closed.
- `IN_PROGRESS` — material work/evidence exists, but the gate is not closed.
- `OPEN` — required decision, work, evidence, or acceptance is missing.
- `CUSTOMER_ACTION` — Taylor must provide, reconcile, assign, approve, or decide.
- `DEFERRED` — explicitly outside Day-1 production scope and not launch-blocking.
- `BLOCKED` — cannot proceed until a named dependency is resolved.
- `NOT_AUTHORIZED` — reserved for a human-controlled authorization that has not been granted.

## Authority rules

1. Objective repository evidence may be added automatically or by an agent.
2. An agent may propose a status transition when the evidence supports it.
3. An agent must not invent missing business facts or acceptance.
4. Taylor acceptance gates require Taylor evidence.
5. Owner authorization gates require the Owner.
6. `C1-OWNER-01` can never be changed to `READY` automatically.
7. Production launch remains `NO-GO` while any launch-critical gate is `OPEN`, `BLOCKED`, `CUSTOMER_ACTION`, `IN_PROGRESS`, or `NOT_AUTHORIZED`.
8. A deployment is not `CLOSED` until the training-close gate in `docs/training/README.md` is satisfied.

## Working sequence

Customer 1 readiness runs in parallel with product work. Work is prioritized when it closes a Day-1 launch gate, removes a critical dependency, or materially reduces Customer 1 operating risk.

The intended sequence is:

1. Scope and commercial boundary
2. Data discovery and migration design
3. Taylor configuration and administrative self-service
4. Migration rehearsal and reconciliation
5. Production readiness, support, recovery, monitoring, and training
6. Cutover rehearsal
7. Final go/no-go review
8. Owner production authorization
9. Cutover
10. Stabilization

## Cost rule

Customer 1 ledger/documentation changes must not wake broad application CI or Windows-hosted GitHub Actions. Prefer no CI for documentation-only changes; when validation is necessary, use a narrowly path-filtered Linux job or a local validation command.

## Current decision

**CONTINUE TOWARD CUSTOMER 1 — PRODUCTION DEPENDENCY NOT YET AUTHORIZED.**
