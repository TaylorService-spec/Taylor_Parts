# Access explained (Option A piece 3), 2026-10-23

Status: built, read-only, not deployed. Design source: the simplified permission model proposal, section 3A.1 (the
eleven-gate chain), section 9A (Access explained) and Appendix G (the settings register). The proposal is not yet approved by
the Owner; this feature changes no grant, role, capability, server authorization or migration.

## What it is

One read, `explainAccessGates { principalId, question? }`, on `/admin/policy`, and one Administration tab, Employee >
**Access explained** (`EmployeeAccessExplained.jsx`). It answers "why can or can't this person do X" by evaluating the gates in
order and stopping at the first refusal.

`question` is one of `{ capabilityKey | objectKey + actionKey, businessContext }` (an action, optionally for a record in a
company, warehouse or sales channel) or `{ surfaceKey }` (a page). No question gives the person-level overview and the
picker vocabulary (`options`).

## Authority (unchanged)

`READ_OPERATION_SURFACE.explainAccessGates = "users"`, so the dispatcher requires `admin.principalAccess.read`, exactly like
`explainEffectiveAccess`, `getPrincipalEffectiveAccess` and `readLoginAccount`. The enforcement suite
(`administrationReadEnforcement.test.mjs`) pins it and proves a non-holder is refused. The sign-in read reuses
`EosLoginService.readLoginAccount`, which re-checks the same key. A principal with no membership in the caller's tenant is not found.

## No new authorization logic

Every gate is read off the resolver that already decides it:

| Step | Gate | Source | Covered |
|---|---|---|---|
| 1 | Sign-in | `EosLoginService.readLoginAccount` (settings 1.1, 1.2, 1.4, 1.5) | yes, when EOS login is composed |
| 2 | Principal and tenant | `resolvePrincipalContextById` (1.9, 1.11) | yes |
| 3 | Employment eligibility | the same call, `EMPLOYEE_NOT_ACCESS_ELIGIBLE` (1.12, 2.1) | yes |
| 4 | Company | `resolveCompanyAuthority`; grants from `listCompanyAuthorityGrants` against the database clock (3.1, 3.3, 2.2) | yes |
| 5 | Activation | not read by the EOS API (the `active:false` flags and per-environment lifting apply to legacy Firebase gates; setting 5.1 is shown for information) | **no** |
| 6 | Door | `explainEffectiveAccess.surfaces` (`grantedSurfaceKeys`) (6.1) | yes |
| 7 | Object | `authorizeOperationalAction` through `explainEffectiveAccess` `questionDecision` (4.1, 4.7) | yes |
| 8 | Field | field groups are defined per command module; no registry to ask | **no** |
| 9 | Record access | the same decision with the record's business context (scoped assignments 4.1; operational scopes, work eligibility 4.2, 2.3). Per-record assignment (`RECORD_ASSIGNMENT`) is reported as "decided per record" | partly |
| 10 | Process | `deriveWorkflowResponsibilities` over the active workflow definitions (7.2) | yes |
| 11 | System | protected rules apply to a concrete change | **no** (admin actions are marked Not covered) |

`explainEffectiveAccess` gained one optional input (`options.question`) and one optional output field (`questionDecision`); it
is otherwise unchanged and its parity suite passes.

## Output shape (layer-ready)

`gates[]`, always eleven, each `{ step, key, label, proposedLayer, status, summary, failure, settings[] }` with `status` one of
PASS, FAIL, NOT_APPLICABLE, NOT_EVALUATED, NOT_COVERED, and `settings[]` rows `{ id (Appendix G), label, value, authority }`.
`proposedLayer` carries the proposal's layer name per gate (section 3A.1) so a layer view needs no server change; the payload
says `layerNamesApproved: false` and the page does not show the column until the server sets it true. No mapping beyond the
proposal's own table is invented. `firstFailure.text` is the "Blocked at: <gate>. <plain words>" sentence.

## Tests and CI

* `functions/test/accessGatesExplanationPostgres.test.mjs` (Postgres, registered in `adminPolicySuites.json` and the CI paths list).
* `functions/test/administrationReadEnforcement.test.mjs` and `adminPolicyIdentity.test.mjs` pin the new read and its authority.
* `field-ops-app-vite/test/employeeAccessExplained.test.jsx` (registered in `eos-admin-policy-tests.yml`).
