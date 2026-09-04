# Lane F — Training

**Priority 60. Branch prefix `customer1/f-`.**

## Mandate

Keep training current with what is actually deployed, and enforce the permanent
deployment-close rule.

## Permanent rule

> A user-impacting deployment is not formally CLOSED until training is verified,
> unless training is explicitly proven not applicable.

The authoritative statement of this rule is `docs/training/README.md`. This lane
operates it; it does not restate or reinterpret it.

## Gates owned

- `C1-TRAINING-01` — Day-1 training readiness (OPEN, launch-critical)

## Owned paths

```
docs/training/**
docs/customer-1/training/**
```

## May

- Detect user-impacting changes in merged and deployed work.
- Create and update role and workflow training guides.
- Identify missing training coverage against the Day-1 role matrix.
- Maintain training-close evidence, recording the deployed SHA or version each
  guide represents.

## Must not

- Record Taylor acceptance of training. Acceptance is Taylor's.
- Close a deployment as trained without either live verification or a verified
  no-user-impact finding. "Probably no user impact" is not a finding.
- Write a guide against code rather than against deployed behavior, without
  saying so plainly in the guide.

## Current state to build from

- `docs/training/MY_DASHBOARD.md` — COMPLETE, LIVE VERIFIED against the
  Owner-accepted sandbox behavior (PR #1792 / `c6589c06`).
- `docs/training/PURCHASING_RECORD_PURCHASE_ORDER.md` — exists; completion is
  still tied to live deployment verification.

`C1-TRAINING-01` stays OPEN because its close condition is broader than any one
guide: every agreed Day-1 role and workflow needs current training, and
designated Taylor administrators must be trained.

## Seeded objectives

1. Day-1 role and workflow training matrix — derived from Lane A's scope
   matrix — showing which guides exist, which are current against a deployed
   revision, and which are missing.
2. Close the gaps, one guide per work item, verified against deployed behavior.
3. Training-close evidence index: guide path, deployed revision represented,
   verification method, and status.

## Dependency note

This lane is most productive after Lane A proposes a Day-1 scope, because the
role matrix derives from it. It is not formally blocked on Lane A: guides for
already-accepted families can be written now.

## Blocker triggers

- The workflow is not deployed anywhere it can be verified (`BLOCKED_EXTERNAL`).
- Day-1 role definitions are unresolved (`BLOCKED_TAYLOR`).
- Taylor administrator training delivery and acceptance (`BLOCKED_TAYLOR`).

## Proofs

Each guide states the revision it was verified against and how. A guide that
cannot name its verification basis is not COMPLETE.
