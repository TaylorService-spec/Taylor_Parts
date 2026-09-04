# Day-1 Administrative Action Census

**Gate:** `C1-ADMIN-01` — Taylor administrative self-service (OPEN, launch-critical)
**Lane:** C — Admin / Identity / Security
**Status of this document:** measured against the repository at the commit that introduced it. Not production evidence.
**Verifier:** `node docs/customer-1/admin/verify-day1-admin-census.mjs`

## What this document is

`C1-ADMIN-01` closes when *"designated Taylor EOS administrators can perform ordinary
Day-1 administration without source-code changes, CLI commands, direct database edits,
or Verenward engineering."*

That close condition names four disqualifiers but never names the actions. This census
supplies the missing half: the enumerated list of ordinary Day-1 administrative actions,
each classified against those four disqualifiers, with a repository citation for the
classification.

It classifies **repository capability only**. Nothing here asserts that any surface is
deployed to production, that any capability is activated in production, or that Taylor
has accepted any of it. Those are `C1-SECURITY-01` and Taylor-acceptance questions
respectively, and this lane cannot answer either.

## Classification vocabulary

| Class | Meaning |
| --- | --- |
| `SUPPORTED` | A Taylor administrator can complete the action in the product today, given only an activated capability and a deployed backend. No code change, CLI, database edit, or Verenward engineering. |
| `PARTIAL` | The surface and its governed backend path exist and are built, but the action cannot be completed today for a stated, non-code reason (capability registered inactive, callable undeployed, no governed read to select a target). Closing it is an activation/deployment gate, not a build. |
| `MISSING` | No path exists in the product. Performing the action today requires a source-code change, a CLI script, a direct database edit, or Verenward engineering — i.e. it fails the `C1-ADMIN-01` close condition as written. |

`PARTIAL` and `MISSING` are both open against the gate. They are separated because they
have different remedies and different owners: `PARTIAL` items are cleared by an
activation or deployment decision, `MISSING` items require build work first.

## The census

### A. Identity and access administration

| # | Day-1 administrative action | Class | Evidence |
| --- | --- | --- | --- |
| A1 | Onboard a new employee and link them to application access | `MISSING` | `employees` has exactly one writer, and it is an operator CLI script: `functions/scripts/provisionEmployeeAccess.js`. `field-ops-app-vite/src/modules/administration/EmployeesList.jsx:62-66` states the absence of a create action explicitly and names the script as the procedure. This fails the close condition's "without CLI commands" clause directly. |
| A2 | Enable or disable a user account | `MISSING` | The trusted `setUserStatus` command exists and its capability `admin.userStatus.write` is active and granted, but the product has no way to reach it: both controls render `variant="protected"` because no governed target-user directory read exists for the action. `AdminUsers.jsx:144-164`. |
| A3 | Reset another user's password | `PARTIAL` | Fully built, view-model tested, wired through `access/adminPasswordResetClient.js`. Gated on `admin.credentialReset.initiate`, registered `active: false` in `access/permissionCatalog.ts`, and the callables are undeployed. `AdminUsers.jsx:60-107, 166-234`. |
| A4 | Assign an already-approved Role to a person | `MISSING` | `AdminRolesPermissions.jsx:17-39` records that there is no trusted read of live principals and `roleAssignments`, so the screen cannot list who holds what and its one assign affordance stays disabled. The trusted writer exists; the product cannot select a target. |
| A5 | Approve or reject a privileged Role grant | `PARTIAL` | `ApprovalRequests.jsx` is wired to `services/privilegedApprovalClient.js` and the callable authorizes server-side from `request.auth.uid`. Built and reachable; completion depends on the callable being deployed and the queue being readable. |
| A6 | See what a Role can actually do | `SUPPORTED` | `AdminObjects.jsx` renders the real Role × Object × CRED grid from the live access contracts, and `AdminRolesPermissions.jsx` renders per-Role reach with granted-but-inert capabilities counted separately from effective ones. Read-only, no backend dependency — the contracts are in the bundle. |
| A7 | See who holds which Role | `MISSING` | The principal→Role direction is the half A4 and A6 cannot answer. No trusted roster read exists. Consistent with `PR #1752`, which found production carrying two RoleAssignments on one principal. |
| A8 | Change what a Role is permitted to do | `MISSING` | Role definitions live in code (`access/governedBusinessRoles.ts`, `access/compatibilityRoles.ts`) and no governed command mutates a Role's permission set — the trusted writers grant Roles to people, not permissions to Roles. `AdminObjects.jsx:33-37`. **This is a permanent Verenward-engineering dependency as designed**, and therefore a scope question for the gate rather than a defect: see Open question 1. |
| A9 | Explain why a user can or cannot perform an action | `MISSING` | The Permission Preview surface is advertised on the Administration hub (`AdministrationOverview.jsx:33-37`) but routes to `AdministrationUnavailable` (`App.jsx`, `administration`/`permissionPreview`). |
| A10 | Review the access audit trail | `MISSING` | Audit Logs is advertised on the same hub (`AdministrationOverview.jsx:38-43`) and likewise routes to `AdministrationUnavailable`. Audit behavior verification is also a `C1-SECURITY-01` obligation. |

### B. Operational reference-data administration

| # | Day-1 administrative action | Class | Evidence |
| --- | --- | --- | --- |
| B1 | View the employee directory | `SUPPORTED` | `EmployeesList.jsx` mounts the governed `employee.index` metadata declaration on the standard list runtime. Read-only. Note the stated limit: the `securityRole` column mirrors the legacy `users/{uid}.role` (admin/dispatcher/technician) and is **not** the governed Role — an administrator reading this column will misjudge access. |
| B2 | Maintain an employee record after onboarding | `MISSING` | No employee record page and no row click target exist (`EmployeesList.jsx:72-73`), and `provisionEmployeeAccess.js` remains the collection's only writer. Ordinary changes — a name, an employment status, a role change — are a CLI or database action today. |
| B3 | Describe or change a warehouse's racking and bins | `PARTIAL` | `AdminWarehouseRacking.jsx` is built against the trusted `previewBinCreates` / bin command path with read and manage gated independently. Both `inventory.location.bin.read` and `inventory.location.bin.manage` are registered `active: false` and granted to no Role. |
| B4 | Configure the operating company's financial policy profile | `PARTIAL` | `AdminFinancialPolicy.jsx` is built against the trusted command. `financialPolicy.profile.read` and `financialPolicy.profile.configure` are both `active: false` in the catalog. Note the designed one-way door: once a profile is LOCKED, no capability including admin or owner may edit it — changing accounting policy afterwards is a governed migration. |
| B5 | Maintain duplicate-detection rules | `MISSING` | `AdminDuplicateRules.jsx:13-29` renders a seeded ruleset for review; the `matching_rules` / `duplicate_rules` collections and their trusted read/write services are not built, so every edit control is `variant="protected"`. |
| B6 | Request or configure an integration to an existing company system | `MISSING` (informational only) | `IntegrationsFaq.jsx` is guidance and intake preparation. It does not submit a request, show connection status, or manage credentials — stated as intentional in `field-ops-app-vite/src/modules/administration/README.md:139-147`. Any actual Day-1 integration is Verenward engineering. |

## Measured summary

| Class | Count | Items |
| --- | --- | --- |
| `SUPPORTED` | 2 | A6, B1 |
| `PARTIAL` | 4 | A3, A5, B3, B4 |
| `MISSING` | 10 | A1, A2, A4, A7, A8, A9, A10, B2, B5, B6 |

**16 enumerated Day-1 administrative actions. 2 are self-service today.**

`C1-ADMIN-01` cannot close on this evidence, and the distance is not marginal. The
census also isolates the single highest-leverage structural gap: **five separate MISSING
items (A2, A4, A7, plus the reach of A9 and A10) share one root cause — there is no
governed trusted read of live principals and their role assignments.** The trusted
writers for user status and role assignment already exist and are already granted; they
are unreachable because the product cannot name a target. One governed roster read
converts more of this table than any other single piece of work.

This is consistent with, and explains, the `PR #1752` production finding recorded on
`C1-SECURITY-01`: production carries two RoleAssignments on one principal and no manager
Roles. A governed access model that no administrator can see or operate is a model the
business will not populate.

## Open questions for the Owner

These are recorded, not decided. This lane implements authority; it does not create it.

1. **Is A8 in Day-1 scope for `C1-ADMIN-01`?** Changing a Role's permission set is a
   code change by design — the access contracts are compiled artifacts and no governed
   command mutates them. Read literally, the gate's "without source-code changes"
   clause can never be satisfied for A8. Either A8 is excluded from Day-1 administrative
   self-service (making it a `C1-SCOPE-01` exclusion), or the gate requires a governed
   Role-editing authority that does not exist and has not been ruled.

2. **Is B6 in Day-1 scope?** If Taylor expects any live integration on Day 1, that is
   Verenward engineering by the module's own stated design and cannot satisfy this gate.

3. **Who are Taylor's designated EOS administrators?** The gate's close condition is
   scoped to "designated Taylor EOS administrators." No such designation exists in the
   repository, and this lane must not invent Taylor personnel. Least-privilege
   verification per `C1-IDENTITY-01` cannot begin without it.

## What this census does not establish

- No production deployment, activation, or behavior is claimed anywhere above.
- `PARTIAL` does not mean "nearly done." Every `PARTIAL` item's remaining step is an
  activation or deployment decision that sits outside this lane.
- No Taylor acceptance is claimed or implied.

## Next work in this lane

The governed principal/role-assignment roster read (the A2/A4/A7/A9/A10 root cause) is
the highest-value item this census surfaces, but specifying it touches access
architecture beyond this lane's owned paths. The next bounded item should instead be
seeded objective 3 — the production authority verification plan for `C1-SECURITY-01` —
which is fully inside `docs/customer-1/security/**` and does not depend on the open
questions above.
