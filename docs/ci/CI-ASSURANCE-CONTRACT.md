# CI Assurance Contract

Status: GOVERNED  
Scope: Repository-wide CI validation, test selection, workflow routing, and CI cost optimization.

## Purpose

A validation contract is not considered governed merely because:

- the test exists,
- the workflow exists,
- the workflow has passed historically, or
- the test is listed in CI.

Governed assurance requires that the contract is selected whenever any repository input capable of affecting that contract changes.

This rule exists to prevent CI-blind states where main can drift out of compliance without the responsible contract running.

## Governing Rule

A CI validation contract is governed only when both conditions are true:

1. The contract is registered and executable.
2. Changes to every authoritative repository input capable of affecting that contract select the contract for execution.

Trigger and routing coverage MUST therefore account for files read directly or indirectly by:

- the test,
- scripts invoked by the test,
- libraries used to derive asserted state,
- governed configuration consumed by the test,
- authoritative documentation or ledgers interpreted by the test,
- generated or derived inputs that materially affect the asserted result.

Test location, workflow filename, or directory proximity alone is not sufficient evidence of coverage.

## Selection Invariant

For every governed contract:

```
affected input changes
        ↓
CI selection/routing recognizes the change
        ↓
responsible contract executes
        ↓
result is attributable to the candidate SHA
```

A change to an authoritative input MUST NOT be capable of bypassing the contract that asserts on it.

## Fail-Closed Requirement

Where routing or classification is used:

- unknown paths MUST NOT silently receive zero validation,
- unclassified paths MUST fail routing validation,
- docs-only or no-test classifications MUST be explicit,
- ignored paths MUST be governed and intentional,
- selected contracts MUST have a defined execution route,
- the aggregate CI gate MUST validate the routing decision itself.

Future router implementations MUST model contract inputs and dependencies, not only test filenames or workflow locations.

## Historical Green Is Not Coverage

A historical green workflow does not prove current assurance if relevant repository changes can bypass selection.

The following statement is invalid:

> "The workflow passed last time, therefore this area is covered."

The correct standard is:

> "The workflow is selected whenever any input that can affect its contract changes."

## Mutable-State Assertion Rule

Tests over intentionally changing operational state SHOULD assert durable invariants rather than pinning a transient state.

Do not encode a moment-in-time snapshot as a permanent contract unless that exact snapshot is itself governed authority.

Examples of durable assertions include:

- the source parses,
- required governed record types exist,
- derived state equals the governing authority's derivation,
- impossible combinations are rejected,
- terminal state is not reported while runnable work exists.

Fixture tests SHOULD cover explicit reachable states separately from live/current repository-state assertions.

## CI Defect Handling Procedure

When a candidate PR exposes a CI failure:

1. Determine whether the failure is caused by the candidate or already exists on main.

2. If the failure is candidate-caused, repair the candidate normally.

3. If the failure is independent and pre-existing:

   - HOLD the candidate.
   - Do not merge the candidate red merely because the failure is unrelated.
   - Repair the pre-existing governance or CI defect in a separate focused PR.
   - Restore main to green.
   - Update or rebase the original candidate onto repaired main.
   - Revalidate the exact new candidate SHA.
   - Merge only after applicable checks are green.

4. Do not mix unrelated feature, authority, permission, trigger, or cost-optimization work into the repair PR.

The normal recovery sequence is:

```
CI defect discovered
        ↓
Determine candidate-caused vs pre-existing
        ↓
If pre-existing: HOLD candidate
        ↓
Repair defect in separate focused PR
        ↓
Restore main green
        ↓
Update original candidate onto repaired main
        ↓
Revalidate exact candidate SHA
        ↓
Merge candidate
```

## CI Optimization Constraint

CI cost reduction MUST NOT silently weaken governed assurance.

Before removing, consolidating, skipping, localizing, or rerouting a validation lane, establish:

- what contract it protects,
- what repository inputs affect that contract,
- when the contract must run,
- whether another lane provides equivalent assurance,
- whether selection remains fail-closed.

Optimization may reduce duplicate execution.

Optimization may NOT create unobserved changes to governed inputs.

GitHub remains the independent validation boundary unless a later governed decision explicitly changes that architecture.

Local validation may supplement GitHub validation, but moving validation local MUST NOT occur merely to satisfy a cost target.

Any future local-validation model must preserve:

- exact-SHA evidence,
- reproducibility,
- governed contract selection,
- independent trust-boundary validation,
- security and authority checks,
- release eligibility evidence.

## Contract Registration Rule

The following are distinct states:

```
REGISTERED != SELECTED != GOVERNED
```

Definitions:

**REGISTERED**  
The contract exists and is known to the CI system.

**SELECTED**  
The contract is chosen for execution for the current repository change.

**GOVERNED**  
The contract is registered, selected whenever its authoritative inputs change,
executes successfully against the relevant candidate SHA, and cannot be silently
bypassed by an unclassified authoritative input.

Registration alone is therefore insufficient evidence of governed coverage.

## Input Dependency Rule

A contract's governed input set includes repository inputs that influence its result, whether those relationships are direct or indirect.

Examples include:

```
test -> file

test -> library -> configuration

test -> parser -> governed ledger

test -> script -> source file inspected as text

test -> derived state -> authoritative document
```

A future CI router or contract registry MUST represent these relationships sufficiently to guarantee selection.

It is not acceptable to infer coverage only from:

- directory names,
- test filenames,
- workflow filenames,
- feature names,
- or historical workflow behavior.

## Scope Discipline

A repair prompted by this contract should remain as narrow as possible.

If a CI defect is discovered while another PR is under review:

- keep the original PR's claim clean,
- repair the independent defect separately,
- do not opportunistically refactor unrelated CI,
- do not combine permission hardening,
- do not combine cost optimization,
- do not combine router implementation,
- do not combine unrelated trigger cleanup.

Each PR should retain a truthful and reviewable scope.

## Evidence Origin

This contract was formalized after the orchestration CI trigger defect discovered during CI-V2-1.

The failure demonstrated that:

- `current-state.test.mjs` asserted on `docs/orchestration/execution-backlog.md`.
- `execution-backlog.md` was absent from the responsible workflow's trigger paths.
- A backlog change therefore bypassed the contract.
- Historical CI remained green even though the current repository state no longer satisfied the stale assertion.
- The defect surfaced only when an unrelated workflow-file change selected the lane.
- A bounded trigger-coverage guard then found a second asserted-but-unwatched input that a manual review had missed.

The incident proved that a suite may be:

- present,
- registered,
- historically green,
- and still CI-blind.

The governing conclusion is:

```
REGISTERED != SELECTED != GOVERNED
```

A contract is governed only when registration, selection, execution, and authoritative-input coverage all hold.
