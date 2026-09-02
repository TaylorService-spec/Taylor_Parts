# Customer 1 Ledger Automation Rules

These rules govern how ChatGPT, Claude, Codex, scripts, and CI may interact with the Taylor Customer 1 readiness ledger.

## Objective

Keep `CUSTOMER_1_LEDGER.json` and `CUSTOMER_1_READINESS.md` current enough that the Owner can answer three questions without reconstructing months of project history:

1. What is done?
2. What is left?
3. What blocks Taylor production dependency?

## Evidence collection

Agents may automatically collect and append objective evidence such as:

- merged PR number and reviewed head SHA;
- test and gate results;
- sandbox or production deployment identity;
- read-only production verification;
- migration rehearsal output;
- backup/restore test evidence;
- training document path and deployed revision represented;
- executed document or customer-acceptance evidence when an authorized human records it.

Agents must link to the original evidence rather than copying large proof bodies into the Customer 1 ledger.

## Status transitions

### Automatic transitions permitted

An objective gate may move to `READY` without separate Owner acceptance only when:

- its `authority` does not reserve acceptance to the Owner or Taylor;
- its `closeWhen` condition is objectively satisfied;
- evidence is present and non-vacuous;
- no named dependency remains open;
- the transition does not itself authorize production, money movement, legal acceptance, or customer acceptance.

### Human-controlled transitions

The following may never be inferred from code, CI, or an agent statement:

- Taylor accepts migrated data or opening inventory;
- Taylor accepts scope or commercial terms;
- a contract is executed;
- Taylor accepts training or operational handoff where acceptance is required;
- Owner visual acceptance;
- final production dependency authorization.

`C1-OWNER-01` is permanently `automaticTransitionAllowed: false`.

## Deployment reconciliation

For each customer-facing deployment or accepted North Star family:

1. inspect the changed user workflows and roles;
2. determine training impact;
3. update/create the applicable role/workflow training guide;
4. record the deployed SHA/version represented by the guide;
5. record `TRAINING: COMPLETE` or `TRAINING: NOT REQUIRED — VERIFIED NO USER IMPACT`;
6. only then record the deployment/family as `CLOSED` where training is the final remaining close item.

See `docs/training/README.md`.

## Cost controls

Customer 1 automation is documentation/governance work and must be cheap by default.

- Do not use GitHub-hosted Windows Actions for ledger automation.
- Do not trigger broad application suites for a `docs/customer-1/**` or `docs/training/**`-only change.
- Do not rebuild/deploy GitHub Pages for documentation-only ledger updates.
- Prefer repository reads plus direct documentation commits/PRs over scheduled CI.
- Prefer local validation for JSON/Markdown consistency.
- If CI validation is later added, it must use a path-filtered `ubuntu-latest` job with a short timeout.
- Never add a scheduled polling workflow solely to keep the ledger fresh when ChatGPT/agent review of merged work can perform the reconciliation.

## Recommended update rhythm

### Event-driven

Whenever a PR, deployment, migration run, customer decision, contract event, restore test, training update, or other material event affects a `C1-*` gate, update the evidence and status in the same workstream when possible.

### Reconciliation review

Periodically review recent merged PRs and decisions for Customer 1 impact. The review should report only:

- gates changed;
- new evidence;
- newly discovered blockers;
- stale or conflicting evidence;
- required human decisions.

No status should change merely because time passed.

## Conflict handling

If evidence conflicts:

1. do not choose the more convenient claim;
2. mark the affected gate `IN_PROGRESS` or `BLOCKED` as appropriate;
3. identify the conflicting sources;
4. name the exact read/test/decision needed to resolve the conflict.

## No silent completeness

A PR being merged, a feature being deployed, a test passing, or a North Star page being accepted does not automatically mean a Customer 1 gate is closed. The gate closes only when its own `closeWhen` condition is satisfied.
