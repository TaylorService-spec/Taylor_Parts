# Privileged Approval Scope Correction

**Status:** governing rule + classification review (INV-1 Post-Phase-1, GOVERNANCE gate). This document records **which** capabilities require two-person approval and reclassifies exactly one Role (`inventoryCreateExecutor`). It changes no other Role.

## Governing rule

**Two-person approval (`privileged: true`) is reserved for capabilities that can materially:**

- administer security or access policy
- grant platform-wide or security-administrator authority
- change Role or Permission definitions
- change tenant / company isolation
- deploy or weaken security enforcement
- bypass trusted-command authorization
- disable authentication, authorization, logging, or auditing
- alter, delete, suppress, backdate, or weaken audit evidence
- perform another explicitly classified critical and broadly irreversible action

**Normal operational access** — one authorized Owner/admin **plus append-only audit**, no second approver — unless specifically classified critical above. This includes inventory catalog management, Part creation, receiving, transfers, reservations, issuing, reconciliation, purchasing, warehouse operations, and governed bulk imports.

The distinction is *what the capability can do to the platform's security/integrity*, not how impactful the operation is operationally. A capability that only reads/writes descriptive business data — however important — is operational, not privileged.

## Configuration authority

`privileged` is a static, reviewed property of each Role definition in `functions/src/access/governedBusinessRoles.ts` and `functions/src/access/compatibilityRoles.ts` (client-mirrored). The trusted grant path (`functions/src/access/trustedWriterCommands.ts`) enforces the two-person constraint for any Role whose definition is `privileged: true` (self-approval rejected; distinct, independently-authorized approver required). Changing a Role's classification is itself a reviewed code change (this document + the definition), never a runtime toggle.

## Privileged-Role review table

| Role | Module | Capabilities (summary) | Current `privileged` | Recommended | Reason | Required approval |
|---|---|---|---|---|---:|---|
| `admin` | compatibilityRoles.ts | Full security/access administration incl. `admin.roleAssignment.write`, `admin.userStatus.write` — grants/revokes roles, administers access policy | `true` | **`true` (keep)** | Administers security & access policy; can grant platform/security-admin authority | Two-person |
| `owner` | governedBusinessRoles.ts | Everything `admin` holds (via the resolver) **plus** every active `report.*` capability — full-platform, security-administrative | `true` | **`true` (keep)** | Full-platform + access-policy administration; the broadest authority in the system | Two-person |
| `inventoryCreateExecutor` | governedBusinessRoles.ts | **`inventory.catalog.manage` only** — create/edit descriptive canonical Part records via the trusted Part Master service | `true` → **`false`** | **`false` (this PR)** | Operational catalog authority; administers no security, grants no admin authority, changes no policy, cannot touch audit integrity | **One authorized Owner/admin + append-only audit** |

Only `inventoryCreateExecutor` is changed in this PR. `admin` and `owner` are reviewed and **retained** as two-person (no change). The seven non-privileged governed business Roles (generalEmployee, officeManager, salesManager, accountingManager, financeManager, fieldManager, operationsManager) were already `privileged: false` and correctly remain operational.

## INV-1 result for `inventoryCreateExecutor`

- `privileged: false`
- capability unchanged: `inventory.catalog.manage` only (not `.activate`, no other id)
- assignment remains through the trusted role-assignment commands; grant and revoke remain **append-only audited**
- **no second approver required**; **no standing entitlement** — revoke immediately after CREATE execution and reconciliation

> **Finding (separate change, not made here):** the trusted role-assignment commands (`trustedWriterCommands.ts` grantRole/assign/revoke) resolve `roleId` against `COMPATIBILITY_ROLES` only, so governed business Roles (including this one) have no trusted grant path yet. Making governed Roles assignable through the trusted commands is a distinct change requiring its own approval; it is intentionally **not** performed in this reclassification PR. Reclassification removes the two-person *policy* barrier; the command wiring is tracked separately.
