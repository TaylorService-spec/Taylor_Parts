---
artifact_type: assessment
gate: Production Exposure Census
status: Complete
date: 2026-09-02
owner: Claude Code (Ownership / Workstream 2C.5)
related_adrs: []
depends_on: [docs/DECISIONS.md]
implements: []
supersedes: []
superseded_by: []
related_pr: TBD
related_issue: []
target_release: TBD
---

# R-32 production exposure census

**Read-only. No production write, grant, revoke, repair, migration or deploy was performed.**

## What was asked, and why

R-32 (DECISIONS #152) moved six manager-conditioned capabilities off the `technician` compatibility
Role onto the governed `partsManager` / `warehouseManager` Roles. A principal who holds **both** the
`technician` Role **and** an active `PARTS_MANAGER` / `WAREHOUSE_MANAGER` operational role receives
those capabilities today *through the compatibility carrier*, and would **lose** them on deployment
unless they separately hold the governed manager Role.

Sandbox exposure was measured during 2C.4 and is nil. Production was never measured, which is why
`PRODUCTION_DEPLOYMENT` has stood **BLOCKED** since DECISIONS #153. This census closes that gap.

## Measurement

| | |
|---|---|
| measured at | 2026-09-02T23:29:21Z |
| production project | `taylor-parts` — resolved from `config/environments.json` (`role: production`), **not** from `.firebaserc`, which defaults to production and is a standing hazard |
| census script | `functions/scripts/r32ProductionExposureCensus.js` |
| mode | `--read-only --projectId taylor-parts` (both flags required; the script refuses any other project id) |
| writes performed | **0** |
| deploys performed | **0** |

**The script has no write path, and that is enforced rather than asserted.** It imports no writer,
seeder, migration or backfill module, reaches no Firestore write verb, and is inert on import.
`functions/test/r32ProductionExposureCensus.test.mjs` fails if any of that changes. There is
deliberately no `--apply` mode: a census that can also mutate is a migration tool with a modest
default.

## Production totals

| collection | count |
|---|---|
| `roleAssignments` | 2 |
| `users` | 16 |
| `employees` | 6 |
| `warehouses` | 2 |

## Primary exposure — the question this census exists to answer

    technician + PARTS_MANAGER          0
    technician + WAREHOUSE_MANAGER      0
    technician + BOTH                   0
    UNIQUE EXPOSED PRINCIPALS           0

**No production principal holds the `technician` compatibility Role at all.** Exactly one principal
holds any active RoleAssignment: `admin` at `global` scope. The `admin` Role declares no
`scopesByPermission`, so R-32's binding policy does not restrict it and its authority is unchanged
by deployment.

## Manager governed-role coverage

| | total | with governed Role | without |
|---|---|---|---|
| PARTS_MANAGER | 1 | 0 | 1 |
| WAREHOUSE_MANAGER | 1 | 0 | 1 |

Both are classified `OPERATIONAL_ROLE_ONLY`: they carry the operational role on their employee
record and hold **no RoleAssignment whatsoever** — not the governed manager Role, and not the
`technician` carrier either.

**That is why they are not exposed.** They have no governed reorder authority today, so R-32 takes
nothing from them. It is not that the deployment preserves their access; it is that there is no
access to preserve. Granting them the governed manager Role at `location` scope is the separate,
Owner-gated step that would give them the authority R-32 designed for them — and this census does
not do it.

## Scope health

    valid location grants     0
    global manager grants     0
    malformed scopes          0
    unknown warehouse         0
    unresolved                0

No manager Role is assigned at any scope in production, so none of R-32's scope hazards — a
location-required binding reached from a global assignment, a grant naming a missing warehouse — has
anything to act on.

## `assignedWarehouseIds` comparison — diagnostic only

    match                  0
    governed only          0
    assignedWarehouse only 0
    contradictory          0
    both empty             2

Both production managers have an empty `assignedWarehouseIds` **and** no governed location grant.
This section closes nothing: `ASSIGNEDWAREHOUSEIDS_PROJECTION` remains an open item.

## Six-capability effect

No exposed principal, therefore no rows.

    unchanged 0 · narrowed 0 · lost 0 · gained 0 · unresolved 0

## Anomalies found — recorded, not fixed

| kind | detail |
|---|---|
| `PRINCIPAL_HAS_NO_EMPLOYEE_LINK` | `JBslDvmpq8RqQAiyzfvwne9yCWc2` (the `admin@global` principal) has no `users/{uid}.employeeId` |

This is **not** an unresolved join and does not block deployment. A principal with no employee link
cannot carry an operational role, so it cannot satisfy the exposure definition — the classification
is determinate, not ambiguous. It is recorded because an admin principal outside the employee model
is worth someone's attention on its own terms.

No duplicate active same-role assignments, no assignment referencing a missing Role or principal, no
disabled row presenting as active, no unknown `ScopeType`, and no permission id absent from the
current catalog were found.

## `read.queue` / `assign` — not overclaimed

Catalog effect only. This census measured **CATALOG_EFFECT**; it did not measure production runtime
behaviour for either capability, and it closes neither open item. Note that
`ASSIGN_RUNTIME_ENFORCEMENT` was separately ruled `CLOSED_SANDBOX` in DECISIONS #158 — sandbox, not
production.

## The honest framing of this result

Production is safe for R-32 because **production is barely using the governed access model at all**:
two role assignments, one principal, no manager Roles, no location scopes. The deployment cannot
break governed manager authority in production because there is none to break.

That is a real and sufficient answer to the exposure question. It is not evidence that production is
*ready to use* R-32 — activating manager authority there is a grant decision, and this census
performed none.

## Recommendation

    R32_PRODUCTION_DEPLOYMENT_READY_FOR_SEPARATE_AUTHORIZATION

**This is not deployment authorization.** It states only that the exposure question that blocked
consideration is now measured and answered: zero principals lose or narrow authority.
