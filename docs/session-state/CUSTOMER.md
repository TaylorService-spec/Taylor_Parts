# Customer Session State

## Baseline
- Main commit: `f97edf19a0027d8e0cc1ec591cbfc099e7a495c0`
- Last reconciled: 2026-07-26
- Relevant PRs: none assigned conclusively
- Relevant issues: link when an active Customer assignment is authorized

## Current Objective
No active Customer-domain implementation assignment is recorded here.

## Status
Needs reconciliation.

## Delta Since Last Handoff
- The repository now has a per-workstream state proposal.
- Authentication PR #444 is active, but its ownership between Customer and Platform has not been formally reconciled.

## Decisions
- [`customer-domain-foundation.md`](../architecture/customer-domain-foundation.md)
- [`DECISIONS.md`](../DECISIONS.md)

## Dependencies
- Preserve `customerId` and `locationId` compatibility with Work Orders.
- Equipment remains outside this workstream unless repository governance explicitly reassigns it.
- Cross-domain authentication and access work requires Coordination ownership reconciliation.

## Production Evidence

### Verified
- None recorded here.

### Unverified
- Current Customer-domain production parity.

### Failed
- None recorded here.

### Not applicable
- No production operation is authorized by this file.

## Risks
- High: destructive customer/location migration could break Work Order references.
- Medium: absorbing Equipment would create unclear domain ownership.

## Next Action
Reconcile the next authorized Customer-domain assignment against current main and its governing issue or plan.

## Stop Conditions
- Missing authorization for a new implementation phase.
- Proposed destructive migration without approved reconciliation and rollback.
- Any change that absorbs Equipment or breaks existing customer/location references.
- Conflict with another workstream’s active PR.

## Last Updated
- Date: 2026-07-26
- Commit: `f97edf19a0027d8e0cc1ec591cbfc099e7a495c0`
- Updated by: designated Customer session
