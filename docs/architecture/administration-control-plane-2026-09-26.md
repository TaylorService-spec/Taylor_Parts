# EOS Administration control plane — server design and API contract

Date: 2026-09-26. Lane CP-S (server). Base `origin/main` 09d63c4e. Migration `1762646400000_administration-control-plane.sql`.

Owner requirement: EOS Administration is the operational control plane. The path is Admin UI → governed PostgreSQL configuration → the shared server-side evaluator. A routine grant, revoke or condition change needs no migration, code edit, deploy or Firebase change. Code supplies the engine and its primitives. Everything fails closed. There is no Firebase authority, no Role-name gate and no client-only logic.

## 1. Architecture

```
Admin UI ──POST /admin-policy {operation,input}──▶ adminPolicyHttp ─▶ executeAdminOperation (closed operation list)
                                                               │
                         reads: capability read gate (admin.securityPolicy.read, …)
                         mutations: policyCommands ─▶ requireSecurityAdministrationCapability
                                                               │  (admin.securityPolicy.write / admin.roleAssignment.write,
                                                               │   resolved from role_capabilities ∪ principal_capabilities)
                                                               ▼
                               ONE transaction: effective row + condition + ONE audit event + ONE decision
                                                               │
            eos_policy.role_capabilities   eos_policy.capability_grant_conditions   eos_policy.role_capability_decisions
                          │                                   │                          (append-only history)
                          ▼                                   ▼
   runtime: resolveOperationalContext(reader, pool, input, postgresGrantConditionProvider(pool))
            ├─ capabilities (flat set, from Roles)          ─▶ Commercial / CRM kernels (conditioned-only keys withheld)
            └─ entitlements() (grantor + condition, lazy)   ─▶ authorizeOperationalAction / Workforce kernels
```

The engine is unchanged. `conditionalEntitlement.authorizeEntitledAction` is the one decision procedure. What changed is where its inputs come from: Administration now writes them, and every transport reads them from PostgreSQL.

## 2. Schema and configuration design (migration 1762646400000)

| Object | Purpose |
|---|---|
| `eos_policy.role_capability_decisions` (new) | Append-only Administration decisions per (tenant, role_key, capability_key). Columns: `decision` ∈ {ADMIN_GRANTED, ADMIN_REVOKED}, `requires_condition`, `reason` (NOT NULL, non-blank), `actor_principal_id`, `audit_event_id` (FK → audit_events), `decided_at`, `superseded_at`/`superseded_by`. A partial unique index allows one current decision per cell. A trigger refuses DELETE and any UPDATE except the one-time supersession stamp. |
| `eos_policy.role_capabilities` | Unchanged, with no new column. It stays the effective authority the runtime reads. |
| `eos_policy.capability_grant_conditions` | Unchanged columns. A new trigger, `capability_grant_conditions_never_widen`, refuses RETIRE or DELETE of an ACTIVE condition while its grant is held, and refuses any change to a condition's cell identity. |
| `eos_policy.audit_events` | A new trigger, `audit_events_append_only`, refuses UPDATE and DELETE. |
| `admin.securityPolicy.write` (new capability) | `rolesPermissions / editSecurityPolicy`, ADMIN_ACTION. Granted to `admin`. |
| `generalManager → admin.roleAssignment.write` | NOT granted. This is a reported Owner conflict; see §6. |

Why a decision table and not a `source` column on `role_capabilities`: a revoke leaves NO row to carry a marker. The revocation must survive the absence of the row, so it lives in its own relation. The grant table keeps answering WHAT, which conditionalEntitlementPostgres pins, and the decision table answers WHY.

## 3. Precedence rule

```
SYSTEM_INVARIANT (forbidden pair)  >  current ADMIN decision (GRANTED | REVOKED)  >  SYSTEM_DEFAULT
```

This is implemented once, in `roleCapabilityAdministration.resolveCell` and `defaultWriterMayInsert`, and every writer and verifier consults it.

Writers of `role_capabilities` other than the Admin path, and how each honours the rule:

| Writer | Behaviour now |
|---|---|
| `reconcileInventoryCapabilityGrants` (catalog reconcile, used by `seedSampleCompany.js` step 3, `inventoryCapabilityGrantMigrationCli.js`, `employeeCapabilityGrants.ts`) | Skips a pair whose current decision is ADMIN_REVOKED (row status `ADMIN_REVOKED`) and skips a forbidden pair (`SYSTEM_INVARIANT`). The read is unguarded: a database without the decision relation makes the reconcile refuse. |
| `activateWorkOrderLifecycleGrants` (NONPROD_ACTIVATION tool) | Skips ADMIN_REVOKED pairs (`ADMIN_REVOKED` row status). It writes through the governed command, so what it does write is an audited ADMIN_GRANTED decision. |
| `bootstrapAdministrator` | Writes only the governing Administration grants, `ADMINISTRATION_BOOTSTRAP_GRANTS`, for a new tenant. |
| SQL migrations | These run at deploy time, not at seed time. The existing grant migrations predate decisions. A future grant migration must `LEFT JOIN role_capability_decisions … WHERE decision IS DISTINCT FROM 'ADMIN_REVOKED'`, and must never DELETE a pair whose current decision is ADMIN_GRANTED. |
| Baseline rebuild (roleCapabilityAuthorityBaselinePostgres) | Runs on a disposable database where no decision exists, so its exactness proof is unchanged. |

No writer deletes an ADMIN_GRANTED pair. The only DELETEs of `role_capabilities` are the Admin revoke, which records ADMIN_REVOKED, and guarded Down migrations keyed on their own `granted_by`.

## 4. Baseline split

1. **Platform catalog**: `eos_policy.capabilities`, written by migrations.
2. **System invariants**: `FORBIDDEN_ROLE_CAPABILITY_PAIRS`, derived from the constants that already carry the rulings, and never re-typed. It covers:
   - `owner` × `OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES` (19);
   - `owner` × `OWNER_EXCLUDED_NOT_AN_AUTHORITY` (2);
   - `technician` × `WITHHELD_CONDITIONED_CELLS` (2).

   They are refused on write. They are reported as `FORBIDDEN_PRESENT` drift whatever a decision says. `assertBaselineHonoursSystemInvariants` stops the baseline from ever declaring one.
3. **Tenant configuration**: `roleCapabilityAuthorityBaseline.json` supplies the SYSTEM_DEFAULT, and the tenant's current decisions are applied over it. `verifyLiveTenantAuthority({ live, decisions, environment })` returns:
   - `explainedByAdminGrant` and `explainedByAdminRevoke`, which are NOT drift;
   - `forbiddenPresent`, `unexplainedExtra`, `missingDefault`, `adminGrantedMissing` and `adminRevokedPresent`, which ARE drift.

AN2 ("do not bless live drift") is unchanged: a row explained by neither the baseline nor a decision is still UNEXPLAINED.

Pinned files moved:
- the baseline JSON (+1 MIGRATION_BACKED: 413 → 414, 356/53/5);
- `sampleCompany.v2.json` vocabulary (79 → 80);
- `ownerCapabilityContract` (vocabulary 80; admin.securityPolicy.write is admin-only by parity, NOT added to ruling A);
- `adminPolicyPostgres` (27 tables);
- `administrationReadEnforcement` (16 reads; 52 migrations);
- `adminPolicyIdentity` (operation lists).

The rest is listed in the lane report.

## 5. Condition model and fail-closed rule

- A condition narrows ONE grant cell `(ROLE:roleKey, capabilityKey)`. It never creates access. The condition row is separate from the grant row.
- **Storable kinds** are exactly what the evaluator supports today. Each is validated by `grantConditionCatalogFromRows`, the builder the runtime uses, plus the withheld-cell guard.

  | Kind | Supported | Notes |
  |---|---|---|
  | `RECORD_ASSIGNMENT` | yes | `relation: ASSIGNED_EMPLOYEE`, recordKind ∈ {workOrder, reorderRequest} |
  | `WORK_ELIGIBILITY` | yes | qualificationCode |
  | `OPERATIONAL_SCOPE` | yes | scopeType[, scopeId] |
  | `SELF` | NO | no evaluator |
  | `TEAM` | NO | registered as a concept, not bindable: no reportsTo edge |
  | `BUSINESS_UNIT` | NO | no evaluator |
  | `COMPANY` | NO | no evaluator |
  | `ALL` | n/a | an unconditioned grant is expressed by having no condition row |

  `paths` are alternatives (OR). A path is an AND of predicates.
- **Fail closed:**
  1. `setGrantCondition` on a held grant narrows it.
  2. `grantObjectActionToRole{condition}` writes grant and condition in ONE transaction, so a conditioned grant never exists unconditioned.
  3. `requiresCondition: true` with no supplied or active condition is refused (`CONDITION_REQUIRED`).
  4. `retireGrantCondition` is REFUSED while the grant is held (`CONDITION_RETIREMENT_WOULD_WIDEN`). The command, the API (409 CONFLICT) and the database trigger all enforce this.
  5. Revoking a grant leaves its condition ACTIVE and inert, so a re-grant is conditioned again.
  6. `admin.*` capabilities cannot be conditioned (`CONDITION_NOT_EVALUABLE`), because their gate reads the flat set.
  7. Flat-set kernels (Commercial, CRM) receive `capabilitiesWithoutUnevaluatedConditions`: a capability reached ONLY through conditioned grants is withheld there.
  8. An unreadable condition store is `CONTEXT_AUTHORITY_UNAVAILABLE` or a refusal. It is never read as "unconditioned".
- **Proof:**
  - the zero-condition parity subtest shows identical flat sets and identical `authorizeOperationalAction` decisions under the PostgreSQL provider and SHIPPED for 5 personas;
  - Case D shows own record ALLOWED via the condition, another's NOT_ASSIGNED, no record ⇒ refused, and every retire path refused;
  - revoke-then-retire leaves CAPABILITY_MISSING, never ALL.
- **Live paths switched to PostgreSQL conditions:**
  - `eosOpsHttp`: lazy provider;
  - `commercialHttp` and `crmHttp`: PostgreSQL provider plus flat-set withholding;
  - `workforceHttp`: the default is now the lazy PostgreSQL provider; "POSTGRES" (eager) and "SHIPPED" remain explicit compositions;
  - `authorizeEntitledResolvedAction`: now reads PostgreSQL.

  `SHIPPED_GRANT_CONDITIONS` stays only as the empty catalog for explicit test compositions.

## 6. Administration capability map

| Operation | Capability | Holders (parity with the former Role-name gate) |
|---|---|---|
| grantObjectActionToRole, revokeObjectActionFromRole, grantObjectActionToPrincipal, revokeObjectActionFromPrincipal, setGrantCondition, retireGrantCondition, workOrder lifecycle activation tool | `admin.securityPolicy.write` (NEW) | admin |
| assignRole, revokeRole | `admin.roleAssignment.write` (existing, 1761609600000) | admin, owner. **generalManager is NOT a holder, a narrowing that is reported below.** |
| all security-policy reads, including the three new reads | `admin.securityPolicy.read` (existing) | admin, owner |

- **Resolution.** The capability set comes from `actor.capabilities` when the API resolved it. Otherwise it comes from the actor's qualifying Role keys → `role_capabilities` ∪ direct `principal_capabilities`. A Role name never authorizes.
- **Anti-lockout.** The recovery property is now a SAFETY guard. A revoke of a Role grant, a direct grant or an assignment that would leave zero active principals holding `admin.securityPolicy.write` or `admin.roleAssignment.write` is refused with `WOULD_REMOVE_LAST_ADMINISTRATION_PATH`. The protected-Role last-admin guard on revokeRole still stands.
- **Bootstrap.** `bootstrapAdministrator` grants `ADMINISTRATION_BOOTSTRAP_GRANTS` to the existing Roles: admin gets securityPolicy.write and roleAssignment.write, and owner gets roleAssignment.write.

**Owner decision required: General Manager assignment authority.** Two rulings conflict:
- The former Role-name invariant (`ROLE_ASSIGNMENT_ROLE_KEYS`, PR #1822, 2026-09-08) let generalManager assign Roles.
- The 2026-08-21 ruling (pinned by `generalManagerNoAdmin.test.mjs`) says General Manager holds NO security administration, and names `admin.roleAssignment.write` as its self-escalation hazard.
- Migration 1762041600000 had already declined to "invent a grant decision" to match the invariant.

This lane therefore does NOT grant it, and the capability gate NARROWS generalManager (fail closed). To restore it, an administrator runs `grantObjectActionToRole {rolesPermissions, assignRole, generalManager}`. That is one audited Administration act with no migration, and the PostgreSQL acceptance test proves it.

**Still on the engine invariant.** These operations are not converted in this lane: createRole, updateRole, setObjectPermission, set/removeFieldPermissionOverride, updateObjectMetadata, createCustomField, updateCustomFieldMetadata, the workflow mutations, `ensureTenantPrincipal` and `rebindPrincipalIdentity`. Each is recorded as a follow-up.
- Workflow grants are Owner-held: migrationChainSafety forbids a migration from granting `workflowDefinition.*`.
- Definition edits can move to `admin.securityPolicy.write` with fixture churn only.

## 7. Audit

- Every control-plane mutation writes EXACTLY ONE `audit_events` row in the same transaction as its effect.
- A no-op writes none.
- Grant and revoke `before` and `after` carry:
  - objectKey, actionKey, capabilityKey;
  - granteeType and granteeKey;
  - held;
  - decision;
  - condition (plus the grant row).
- Condition events carry the condition and status before and after.
- `reason` is required for Role grant, revoke and condition operations. The request id is appended as `[request <id>]`, and a request id alone is not a reason.
- Each decision row names its `audit_event_id`.
- audit_events and role_capability_decisions are immutable at the database.

## 8. API contract, for the client lane

Transport: `POST` to the Admin policy endpoint (`adminPolicyHttp`).
- Body: `{ operation, input }`.
- Response: `{ ok: true, operation, tenantId, data }` or `{ ok: false, operation, code, message }`.
- `code` ∈ UNKNOWN_OPERATION | UNAUTHENTICATED | FORBIDDEN | INVALID_INPUT | NOT_FOUND | CONFLICT | INTERNAL.
- The tenant is never an input.

### Mutations (gate: see §6)

**`grantObjectActionToRole`**
- Input: `{objectKey, actionKey, roleKey, reason, condition?, requiresCondition?}`
- Output: the `role_capabilities` row `{id, roleId, capabilityId, grantedBy, grantedAt, …}`.
- Errors:
  - INVALID_INPUT: REASON_REQUIRED, CONDITION_INVALID, CONDITION_REQUIRED, CONDITION_NOT_EVALUABLE, "no governed Object/action", "role not found";
  - CONFLICT: SYSTEM_INVARIANT;
  - FORBIDDEN.
- An idempotent no-op returns the existing row.

**`revokeObjectActionFromRole`**
- Input: `{objectKey, actionKey, roleKey, reason}`
- Output: the removed row, or `null` if it was not held (no-op).
- Errors: INVALID_INPUT (REASON_REQUIRED), CONFLICT (WOULD_REMOVE_LAST_ADMINISTRATION_PATH), FORBIDDEN.

**`setGrantCondition`**
- Input: `{objectKey, actionKey, roleKey, condition, reason}`
- Output: `{id, grantScope:"ROLE", grantorKey, capabilityKey, condition, status:"ACTIVE", establishedBy, establishedAt, updatedBy, updatedAt}`.
- Errors: INVALID_INPUT (CONDITION_INVALID, CONDITION_NOT_EVALUABLE, REASON_REQUIRED), FORBIDDEN.

**`retireGrantCondition`**
- Input: `{objectKey, actionKey, roleKey, reason}`
- Output: the condition row with `status:"RETIRED"`, or `null` if none was active.
- Errors: CONFLICT (CONDITION_RETIREMENT_WOULD_WIDEN while the grant is held), FORBIDDEN.

**`grantObjectActionToPrincipal` / `revokeObjectActionFromPrincipal`**
- Input: `{objectKey, actionKey, principalId, reason, expiresAt?, condition?}` (grant); `{objectKey, actionKey, principalId, reason}` (revoke).
- These are governed DIRECT exceptions. Since lane DX (section 15) every runtime gate honours them exactly as it honours a Role grant.

**`assignRole` / `revokeRole`**
- Inputs are unchanged. The gate is now `admin.roleAssignment.write`.

### Reads (gate: `admin.securityPolicy.read`)

**`getSecurityRoleDetail`**
- Input: `{roleKey}`
- Output:

  ```
  {roleKey,name,description,protected,
   holders:[{principalId,displayName,assignmentId,scopeType,scopeValue,grantedAt}],
   actions:[{objectKey,actionKey,actionKind,displayLabel,capabilityKey,held,grantedBy,source,forbiddenBy,
             decision:{decision,reason,actorPrincipalId,decidedAt,requiresCondition,auditEventId}|null,
             condition:{condition,status,updatedAt}|null}]}
  ```

**`getObjectActionGrantMatrix`**
- Input: `{objectKey}`
- Output:

  ```
  {objectKey,label,actions:[{actionKey,actionKind,displayLabel,capabilityKey,
   roles:[{roleKey,held,source,condition}], principals:[{principalId,source:"DIRECT_EXCEPTION",grantedBy}]}]}
  ```
- `roles` lists only cells that are held, decided, conditioned or forbidden.

**`listRoleCapabilityDecisionHistory`**
- Input: `{roleKey?, capabilityKey?, limit?≤500}`
- Output: decision rows, oldest first, with superseded rows included.

**`source`** ∈ `ADMIN_GRANTED | ADMIN_REVOKED | SYSTEM_DEFAULT | SYSTEM_INVARIANT | null`. SYSTEM_INVARIANT cells must render as not grantable.

**Existing reads the UI also needs:**
- `listRoles`, `listObjectsWithActions`, `getRoleSecurity`, `getObjectSecurityMatrix`: `admin.securityPolicy.read`;
- `listTenantPrincipals`, `listPrincipalRoleAssignments`, `getPrincipalEffectiveAccess`: `admin.principalAccess.read`. `getPrincipalEffectiveAccess` reports ROLE / DIRECT / ROLE_AND_DIRECT provenance;
- `readPolicyAuditHistory {limit}`: `audit.event.read`.

### `explainEffectiveAccess` (IMPLEMENTED, 2026-09-26 follow-up)

**Gate.** `admin.principalAccess.read`, an existing key: the same authority as `getPrincipalEffectiveAccess`. No new capability.

**Input.** `{principalId}`. The principal must be a member of the caller's tenant; otherwise NOT_FOUND. A disabled or unresolvable Principal is also NOT_FOUND.

**Composition.** The read is served only when the server composes the evaluator (`AdminApiDeps.explainEffectiveAccess`, wired in `eosApi/server.ts` over the one shared pool). If it is not composed, the read refuses with INTERNAL; there is no fallback to a repository-only evaluator.

**Evaluator (`eosOps/effectiveAccessExplanation.ts`).**
- The Principal is resolved with `resolvePrincipalContextById`, which shares every rule after principal lookup with the runtime's `resolvePrincipalContext`.
- Capabilities come from `resolveOperationalContextForPrincipal`, which runs `capabilitiesForRoleKeys` plus the same entitlement resolver, with conditions from `postgresGrantConditionProvider`.
- Work Eligibility and Operational Scope are read with `postgresPrincipalDimensionReader`.
- Surfaces come from `grantedSurfaceKeys`.
- Each Object action is decided by `authorizeOperationalAction` over `snapshotContextualReader`.

**Output.**
```
{tenantId, principalId, securityRoleKeys, accessVersion,
 assignments:{excluded:[{assignmentId, roleKey, reason:"STALE"|"INACTIVE"|"SCOPED", scopeType?, scopeValue?}]},
 employeeId, workEligibility, operationalScopes, capabilities, surfaces,
 actions:[{objectKey, actionKey, actionKind, capabilityKey,
           result:"ALLOWED"|"CONDITIONAL"|"DENIED", reasonCode,
           sourceRoles:[{roleKey, condition|null}],
           directGrant:{label:"DIRECT_EXCEPTION", source:"DIRECT_EXCEPTION", exceptionReason, expiresAt, grantedBy, grantedAt,
                        condition|null, enforced:true}|null,
           withheldFromFlatSetKernels, surfaces:[...],
           workflowSource:[{workflowKey, version, actionKey, roleKey}]|null}]}
```

**Result semantics.**
- `reasonCode` is ALLOWED, RECORD_ASSIGNMENT_REQUIRED (the CONDITIONAL result), or the evaluator's refusal outcome.
- Only GLOBAL, non-stale, active assignments grant unscoped. A scoped assignment of a runtime-supported scope grants scope-qualified holdings only (section 12); any other scoped assignment is excluded (`SCOPE_UNSUPPORTED`) and grants nothing.

**Direct grants.** `principal_capabilities` gains `exception_reason` and `expires_at` (migration 1762646400000). `grantObjectActionToPrincipal` requires a reason and accepts an optional future `expiresAt`. Every reader ignores expired rows.

## 9. Findings recorded by this lane

- **The catalog reconcile adds six pairs that the baseline withholds.** On a baseline-equal tenant, the Sample Company reconcile path ADDS six reorder pairs that the governed baseline withholds:
  - `admin`, `dispatcher`, `partsManager` and `purchasingManager` → `reorder.request.read.queue`. This key is SUPERSEDED and "may never be granted again".
  - `admin` and `dispatcher` → `reorder.request.assign`. This key is operationalRole-conditioned in the legacy catalog.

  This predates the lane: the legacy Role catalog declares these pairs. The PostgreSQL acceptance test pins the six by name, and none of them is an Administration cell. The fix is an Owner decision. One option is to add `reorder.request.read.queue` to the system invariants for every Role.
- **Technician Purchase Order cells.** Treating the withheld technician Purchase Order cells as a system invariant means the catalog reconcile no longer grants `technician → reorder.purchaseOrder.read/.create` in Sample Company fixtures. The legacy catalog declares both. The verifier now reports them as `SYSTEM_INVARIANT`, not `MISSING_GRANT`. The nonprod baseline never held them.
- **Environmental test failures.** Four PostgreSQL down-migration suites fail on the shared local test database with `migration 027 cannot be reversed: eos_ops.parts holds 4 Part Master records`: eosOpsWarehouseBin, truckFleet, employeePrincipalLink and eosOpsEquipmentCustody. The same failure reproduces with this lane's migration removed, so it is pre-existing and environmental.

## 11. Pass 8: review defects fixed, and hardening

Source: the independent review at `round4-analysis/pass8-security-review.md`. Each proved probe is now a committed regression in `administrationControlPlaneSecurityPostgres.test.mjs`. I ran the suite against e896819f and every subtest failed there; all of them pass after the fix.

### Invariant set after Pass 8
The Owner rule is that only PLATFORM_SAFETY and OWNER_GOVERNANCE rules may be immutable.

**OWNER_GOVERNANCE (`FORBIDDEN_ROLE_CAPABILITY_PAIRS`, 20 pairs).** These are `owner` × the 19 ruling-A keys, plus `owner` × `reorder.request.assign`. They are enforced:
- on every Role grant;
- at the PRINCIPAL level: an owner holder may not reach an excluded key through a custom Role or a direct grant, and this is checked on assignRole, on grants to Roles the owner holds, and on direct grants;
- by the default writers;
- in drift reporting, as `FORBIDDEN_PRESENT` and `FORBIDDEN_PRINCIPAL_HOLDING`.

**PLATFORM_SAFETY (`PLATFORM_SAFETY_INVARIANTS`).**
- ANTI_LOCKOUT
- ADMIN_NOT_CONDITIONABLE, extended to "only `CONDITIONABLE_GRANTS` may carry a condition"
- NEVER_WIDEN_ON_RETIRE
- APPEND_ONLY_AUDIT

**Removed from the immutable set (LEGACY_BASELINE_ARTIFACT).**
- `owner` × `reorder.request.read.queue`.
- `technician` × `reorder.purchaseOrder.read/.create`. The technician ruling withholds condition ACTIVATION on these cells. That is preserved, because the condition allow-list never includes them and the PostgreSQL provider still asserts them withheld.

### Defect fixes
| # | Fix |
|---|---|
| D1 | `resolveOperationalContext` now reads the condition catalog eagerly (one indexed read). The flat `capabilities` set holds only keys with an UNCONDITIONAL grant, and conditioned-only keys move to `conditionallyHeld`, which only the entitled seam (`authorizeEntitledAction`) may evaluate. The Admin read gate and the mutation gate apply the same withholding. `setGrantCondition` is restricted to the `CONDITIONABLE_GRANTS` allow-list, currently `workOrder.record.read` × recordKind `workOrder`, because no flat gate reads that key. |
| D2 | Every Administration command runs `tx.beginAdministrationCommand()`, which takes a per-tenant advisory lock. The anti-lockout and protected-Role counts are recomputed INSIDE the transaction. |
| D3 | A `grant_cell_lock(tenant, scope, grantor, capability)` advisory lock is taken by the grant-insert trigger, the retire/delete trigger and the commands. The grant path re-reads the cell under the lock and writes the condition before the grant. |
| D4 | `administrationHolderCount` counts only principals that pass both conditions below. Unexpired direct grants with a set `expires_at` do NOT count, because an expiring grant would be a lockout on a timer. |
| D5 | Three rules: (a) no self-assignment of any Role, and no self-grant of a capability (directly, or to a Role the actor holds); (b) a Role carrying `admin.securityPolicy.write` may only be assigned by a holder of `admin.securityPolicy.write`; (c) ruling A applies at the principal level (above). |
| D6 | The `role_capabilities_honour_decisions` insert trigger refuses a Role grant whose current decision `requires_condition` while no ACTIVE condition exists. |
| D8 | An apply-mode reconcile is one transaction under the tenant governance lock, and it reads decisions inside that lock. The insert trigger refuses any non-command insert of an ADMIN_REVOKED pair. |
| D9 | Re-granting an expired direct exception refreshes its reason and expiry through `ON CONFLICT … WHERE expired`. The command refuses to audit a grant that is still expired. |
| D10 | Four changes. (1) The supersede stamp must name the EXISTING current decision for the same cell and tenant, with a now-bounded `superseded_at`. (2) Current-decision uniqueness is a DEFERRED exclusion constraint, so the successor is inserted first. (3) Statement-level TRUNCATE triggers now guard `audit_events`, `role_capability_decisions` and `capability_grant_conditions`. (4) The `audit_event_id` and `superseded_by` FKs are tenant-composite. |
| D11 | `revokeObjectActionFromPrincipal` requires a reason. Concurrent identical grants are a clean no-op: the no-op test runs inside the locks. |
| D7 | This is client-side and belongs to lane CP-C. |

**D4 holder rule, in full.** A principal counts only if both hold:
- the principal is ENABLED, with an ACTIVE membership;
- it holds the capability through an ACTIVE, GLOBAL, non-stale assignment to a Role that grants it UNCONDITIONED, or through a direct grant with NO expiry.

**Owner question from D5(b).** Owner holds `admin.roleAssignment.write` but not `admin.securityPolicy.write`, so Owner can NO LONGER appoint an Administrator. Owner can still staff every Role that confers no security-policy authority. This is implemented fail-closed.

### Capability map after Pass 8
| Operation | Capability |
|---|---|
| grant/revoke to a Role or a Principal, set/retire a condition, createRole, updateRole, setObjectPermission, set/remove field override, updateObjectMetadata, createCustomField, updateCustomFieldMetadata | `admin.securityPolicy.write` |
| assignRole, revokeRole, ensureTenantPrincipal, rebindPrincipalIdentity | `admin.roleAssignment.write` |
| Workflow mutations | unchanged; owned by lane WF |

No new capability keys were added.

### New and changed reads
**`listSupportedConditionKinds`** (gate: `admin.securityPolicy.read`).

Returns `{kinds:[{kind, supported, reason, parameters, recordKinds, capabilities:[{capabilityKey, objectKey, actionKey, recordKinds}]}]}`.
- Supported kinds:
  - RECORD_ASSIGNMENT: `relation ASSIGNED_EMPLOYEE`, recordKinds `["workOrder"]`.
  - WORK_ELIGIBILITY: `qualificationCode` must be one of the governed codes.
  - OPERATIONAL_SCOPE: `scopeType` is WAREHOUSE or REORDER_QUEUE; `scopeId` is optional.
- Unsupported kinds, each with its reason: SELF, TEAM, BUSINESS_UNIT, COMPANY, ALL.

**`readPolicyAuditHistory`** now accepts optional filters: `{principalId, employeeId, roleKey, objectKey, capabilityKey, actionKey, workflowKey, from, to, limit}`.
- The filters are tenant-scoped and parameterized, and use JSONB containment over `before`/`after` backed by GIN indexes.
- `roleKey` also matches assignment events by Role id.
- An unparseable date returns INVALID_INPUT.
- With no filter, the read behaves exactly as before.

**`explainEffectiveAccess`** adds `conditionallyHeld`.

## 10. Not done in this lane

- The client UI: object×action toggles, the condition editor, and retiring the CRED grid.
- Moving definition, Object and Workflow mutations off the Role-name invariant (§6).
- Principal-scope conditions: the relation supports them, but the API is ROLE-only.
- Applying migration 1762646400000 anywhere but local test databases.

## 12. Security Role assignment scope: the runtime (lane SC)

Effective authority is now Principal → Security Role assignment → capability → **assignment scope** → record business context → record relationship (grant condition) → domain preconditions. Before this lane a scoped `user_role_assignments` row granted nothing (fail closed) while `assignRole` stored any scope type unvalidated — configuration the runtime ignored.

### Classification

| Scope | Model | Runtime (PostgreSQL) | Verdict |
|---|---|---|---|
| OPERATING_COMPANY | `ScopeType.operatingCompany` (types/access.ts:33); `user_role_assignments.scope_type/scope_value` (1757462400000:183); value-matched in `assignmentScope.ts:61/73` and legacy `scopeMatches` (resolveEffectivePermission.ts:173); governed values `tenant_operating_companies` | Consumer: Workforce `employee.record.read` (the Employee's `operating_company_id`) | MODEL_EXISTS_RUNTIME_MISSING → **implemented here** |
| BUSINESS_UNIT | `ScopeType.businessUnit`; FIN-002 `BUSINESS_UNITS`; FIN-004 reach bound in Firestore `roleAssignments` (financeReadCallables.ts:50-66,120-128) | No PG gate carries a record business unit (Commercial: per line; flat-set kernels) | MODEL_EXISTS_RUNTIME_MISSING — evaluator decides it; `assignRole` refuses it (`SCOPE_TYPE_UNSUPPORTED`) |
| LOCATION (warehouse) | R-29/R-32 (DECISIONS #150/#152): `location` = warehouse id; `bindingScopePolicy.ts` (legacy) | R-32 location-bound reorder/inventory bindings are on the legacy path; Reorder cutover #1961 HELD | MODEL_EXISTS_RUNTIME_MISSING — refused until a PG consumer lands |
| WAREHOUSE (Employee Operational Scope) | `OPERATIONAL_SCOPE_TYPES` (operationalScopeVocabulary.ts:41) | `OPERATIONAL_SCOPE` grant-condition predicate; put-away / cycle-count surfaces (experienceAuthority.ts:188,194) | DOMAIN_SPECIFIC — MODEL_EXISTS_RUNTIME_WORKS (S1, not a Security Role scope) |
| REORDER_QUEUE (Employee Operational Scope) | 1761696000000:43 | Condition predicate; queue consumer waits on Reorder cutover | DOMAIN_SPECIFIC |
| SALES_CHANNEL (`salesChannel`) | lane GA: vocabulary `eos_commercial.commercial_sales_channel`; tenant activation `eos_policy.tenant_sales_channels` (1762905600000) | Consumers: the PostgreSQL Commercial reads (record's STORED channel) | **implemented (lane GA)** — see §14 |

### Runtime
- `assignmentScopeRuntime.ts` (pure): the decidable scope types and their record fact (`operatingCompanyId`, `businessUnit`, `warehouseId`), and `SCOPE_EVALUABLE_GRANTS`, the only (scope type, capability) pairs a scoped assignment can confer — today `operatingCompany × employee.record.read` (readEmployee, listEmployees, listManagedEmployees).
- `PrincipalContext.scopedAssignments` carries qualifying non-global assignments; `heldRoleKeys` stays GLOBAL only.
- `ResolvedOperationalContext.scopedHeld: [{capabilityKey, scopeType, scopeValue, sourceRole, assignmentId, condition}]` — never in `capabilities` or `conditionallyHeld`; `inertScoped` reports the rest. Zero extra reads for a principal with no scoped assignment.
- `authorizeEntitledAction` takes `businessContext` (resolved server-side from the governed record). Global path first and byte-identical; a scoped holding admits only an exact same-type value, then its grant condition still narrows. Refusals: `OUTSIDE_ASSIGNMENT_SCOPE`, `SCOPE_CONTEXT_REQUIRED`, `SCOPE_NOT_EVALUABLE`.
- Workforce reads opt in (`recordScope: "operatingCompany"`): a single record is decided on its own company inside the read snapshot; lists filter to admitted companies. Every other gate refuses a scoped-only holder exactly as before.

### Administration
- `assignRole` refuses: an unconsumed/unknown scope type (`SCOPE_TYPE_UNSUPPORTED`), a missing value, a value not governed in THIS tenant, a value on a global assignment (`SCOPE_VALUE_INVALID`), a Role with nothing evaluable at that scope (`SCOPE_NOT_EVALUABLE_FOR_ROLE`), and any protected Role or Role carrying an `admin.*` capability (`SCOPE_AMBIGUOUS_ADMINISTRATION`). All INVALID_INPUT. The owner principal rule is checked for scoped assignments too.
- `listSupportedAssignmentScopes {roleKey?}` (gate `admin.principalAccess.read`): every scope type with `supported`, `reason`, `contextKey`, `valueSource`, this tenant's `values`, and consumers; per Role, `assignableScopes: [{scopeType, assignable, refusal, scopedCapabilities, inertCapabilities}]`.
- Anti-lockout and the protected-Role count consider GLOBAL assignments only.

### Effective access
`explainEffectiveAccess` adds `scopedHeld`, `assignments.scoped` (per supported scoped assignment: capabilities granted within the scope, inert ones), per action `scopedSources: [{roleKey, scopeType, scopeValue, condition, result, reasonCode}]` (the evaluator's decision for a record inside that scope), and result `SCOPED` (`SCOPE_CONTEXT_REQUIRED`). `assignments.excluded` now reports only `STALE`, `INACTIVE` and `SCOPE_UNSUPPORTED`.

## 13. Functional Role (lane FR, migration 1762819200000)

Owner: Job Role ≠ Security Role ≠ Functional Role. A **Functional Role** is an Employee's business responsibility. It **grants nothing**. The capability-granting Security Roles that older prose calls "functional Roles" (cycle-count counter/reconciler, bin administrator, put-away operator, …) are untouched and stay Security Roles; terminology ruling R3 is pending.

**Schema** (`eos_workforce`, the `job_roles` / `employee_work_eligibility` shapes):
- `functional_roles (tenant_id, id 'fr_…', key, name, description, status ACTIVE|INACTIVE, created/updated_by/at)`. The key is immutable and unique per tenant, compared case- and punctuation-insensitively. A key may not collide with a Security Role key of the tenant or with a Work Eligibility code; the database enforces this in both directions (`functional_roles_guard`, `roles_key_not_functional_role`). Rows are never deleted. The catalog starts empty.
- `employee_functional_role_assignments (…, effective_from, effective_to, assignment_source 'ADMINISTRATION', assigned_by/at, reason NOT NULL, ended_by/at, end_reason)`. The Employee and Functional Role FKs are tenant-composite. An Employee may hold many current Functional Roles, but at most one open row per (Employee, Functional Role), with no overlapping periods. The table is append-only: the only permitted update ends a row, once. An INACTIVE Functional Role is refused.
- `workflow_role_bindings.functional_role_id` (tenant-composite FK). `role_id` is now nullable. `workflow_role_bindings_target_matches_kind` requires exactly one target, the one the binding kind names.
- `admin.employeeFunctionalRole.write` (object `employee`, action `setFunctionalRole`, ADMIN_ACTION):
  - It is registered but **granted to no Role**.
  - It is not a bootstrap grant; the comparable Employee keys are not bootstrap grants either.
  - It is not in the legacy `PERMISSION_CATALOG`, because the legacy admin Role composes the whole catalog.
  - Holders are configured through Administration (`grantObjectActionToRole employee/setFunctionalRole`). Pass 8 applies: the grant goes to a Role the granting administrator does not hold, and that Role is assigned to another principal.

**Workforce API** (`/workforce/employees`; each command takes the tenant governance lock and writes exactly one audit event, and a NO_CHANGE writes none):

| Operation | Gate | Notes |
|---|---|---|
| `listFunctionalRoles {status?}` | employee.record.read | Includes `currentHolderCount`. |
| `listFunctionalRoleHolders {functionalRoleId}` | employee.record.read | Current and scheduled holders. |
| `listEmployeeFunctionalRoles {employeeId}` | employee.record.read | `current`, `scheduled`, history. |
| `listFunctionalRoleHistory {functionalRoleId, limit?}` | employee.record.read | Catalog events and assignment events. |
| `createFunctionalRole {key, name, description?, reason?}` | admin.employeeFunctionalRole.write | `FUNCTIONAL_ROLE_KEY_COLLISION`, `…_KEY_TAKEN`, `…_NAME_TAKEN`. |
| `updateFunctionalRoleMetadata {functionalRoleId, name?, description?, reason?}` | same | The key never changes. |
| `setFunctionalRoleStatus {functionalRoleId, status, reason}` | same | Deactivation **fails closed**: `FUNCTIONAL_ROLE_HAS_CURRENT_HOLDERS` while any current or scheduled holder exists, and `FUNCTIONAL_ROLE_BOUND_TO_ACTIVE_WORKFLOW` while an ACTIVE version binds the role. Nothing is ended implicitly. |
| `assignEmployeeFunctionalRole {employeeId, functionalRoleId, reason, effectiveFrom?}` | same | `FUNCTIONAL_ROLE_INACTIVE`, `FUNCTIONAL_ROLE_SELF_ASSIGNMENT` (refused for your own linked Employee), `…_ASSIGNMENT_OVERLAP`. `effectiveFrom` cannot be in the past and can be at most 366 days ahead. |
| `endEmployeeFunctionalRoleAssignment {employeeId, assignmentId, reason, effectiveTo?}` | same | Ending an assignment that has not started cancels it: the period becomes zero-length. |

The Employee change history adds `employee.functionalRole.assign` and `employee.functionalRole.end`. `readMyWorkforceCapabilities` may now return the new key.

**Workflow binding.** `binding_kind = FUNCTIONAL_ROLE` is now SUPPORTED. The runtime rule (`workflowEngine.authorizeWorkflowAction`) is:

> **SECURITY_ROLE binding** (unchanged) **AND effective authority** over the action's capability (the same evaluator) **AND**, if the action has any FUNCTIONAL_ROLE binding, **the linked Employee currently holds one of them**.

- The Functional Role facts come from `eosOps/functionalRoleFacts.postgresWorkflowFunctionalRoleFacts`.
- Missing facts refuse the action (`functionalRoleFactsUnavailable`), and so does a Principal with no linked Employee (`employeeLinkRequired`).
- A FUNCTIONAL_ROLE-only binding never widens: with no Security Role bound, the action is still refused with `notBoundToRole`.
- An action with no FUNCTIONAL_ROLE binding is decided exactly as before.

Drafts take `functionalRoleKeys` per action:
- An unknown key **refuses the save** (`UNKNOWN_FUNCTIONAL_ROLE`), because dropping a narrowing binding would widen the action.
- Publish validation adds the codes `UNKNOWN_FUNCTIONAL_ROLE` and `INACTIVE_FUNCTIONAL_ROLE`.

`listPrincipalWorkflowResponsibilities` entries carry `requiredFunctionalRoles`, `viaFunctionalRoles` and a `source`:
- `WORKFLOW_BINDING_AND_EFFECTIVE_AUTHORITY`;
- `WORKFLOW_BINDING_FUNCTIONAL_ROLE_AND_EFFECTIVE_AUTHORITY`;
- `FUNCTIONAL_ROLE_BINDING_ONLY`, meaning the principal holds a bound Functional Role but has no Security Role binding. These entries always appear under `boundWithoutAuthority`.

**Effective access.** `explainEffectiveAccess` adds `employeeFacts: {functionalRoles:[…], grantsCapabilities:false}`. These facts are read after every decision. The PostgreSQL suite proves that assigning a Functional Role leaves every capability, surface and action decision unchanged.

**Not in scope:** seeding the catalog; any Security Role reclassification; assignee pickers; applying the migration anywhere but local test databases.

## 14. Governed scope values and the SALES_CHANNEL scope (lane GA, migration 1762905600000)

No scope picker takes a typed id. Every scope value Administration stores is checked, server-side and under the governance lock, against ONE tenant-scoped governed source; the pickers draw only what the server serves.

| Scope | Governed value source (this tenant) | Availability |
|---|---|---|
| Security Role `operatingCompany` | `eos_policy.tenant_operating_companies` ACTIVE | supported |
| Security Role `salesChannel` | `eos_policy.tenant_sales_channels` ACTIVE (enum `commercial_sales_channel`) | supported; no value until a channel is activated |
| Security Role `location` | `eos_ops.warehouses` ACTIVE exists | unavailable: no PostgreSQL gate supplies a record's warehouse |
| Security Role `businessUnit` | none (FIN-002 `BUSINESS_UNITS` is a platform constant, no longer offered as governed) | unavailable: no consumer, no tenant-governed source |
| Operational Scope `WAREHOUSE` | `eos_ops.warehouses` ACTIVE | supported |
| Operational Scope `REORDER_QUEUE` | `eos_policy.tenant_operating_company_keys` ACTIVE | supported; the writer now resolves it (formerly migration-only) |

- **Reads.** `listSupportedAssignmentScopes` (Security Roles) and the new Workforce read `listOperationalScopeTargets` (employee.record.read; per type `available`, `reason`, `valueSource`, `values`).
- **Writers refuse** every value not in the source: `SCOPE_VALUE_INVALID` (assignRole); `WAREHOUSE_NOT_FOUND` / `WAREHOUSE_INACTIVE` / `REORDER_QUEUE_NOT_FOUND` / `REORDER_QUEUE_INACTIVE` / `OPERATIONAL_SCOPE_TYPE_INVALID` (assignEmployeeOperationalScope). A foreign tenant's value is indistinguishable from an unknown one.

**SALES_CHANNEL model.** A channel is a scope VALUE on a Security Role assignment, never a Role: `salesLead @ salesChannel=RETAIL`; one manager may hold two scoped rows of the same Role (RETAIL and NATIONAL_ACCOUNTS); nothing derives a channel from a Job Role, a Functional Role or a Role definition.
- `eos_policy.tenant_sales_channels (tenant_id, sales_channel enum, status ACTIVE|INACTIVE, source, established/updated by/at)` starts EMPTY. DELETE, TRUNCATE and identity updates are refused by trigger.
- `setTenantSalesChannelStatus {salesChannel, status, reason}` (admin.securityPolicy.write, governance lock, one audit event, NO_CHANGE writes none). Deactivation is refused (`SALES_CHANNEL_HAS_SCOPED_ASSIGNMENTS`) while any active assignment is scoped to the channel.

**Runtime.** `SCOPE_EVALUABLE_GRANTS` adds `salesChannel × {opportunity.read, salesAgreement.read, salesOrder.read}`, consumed by `getOpportunityDetail / listOpportunities`, `getSalesAgreementDetail / listSalesAgreements`, `getSalesOrderDetail / listSalesOrders` and `getAccountCommercialProjection`.
- The transport hands the reads `scopedHeld`; the commands still take the flat set only, so a scoped holding never authorizes a write. No write key is evaluable at a channel (a create's channel is caller-supplied; the writes are fenced INACTIVE anyway).
- Global first and unchanged. A scoped-only key admits a record only when its STORED channel (an Agreement's is its source Opportunity's, joined in the same statement) is one of the holder's channels. Lists filter in SQL. A record outside the channels, or with no channel, answers `RECORD_NOT_FOUND` exactly like a missing id (Pass 9 S7). Conditioned scoped holdings are not honoured (the kernel cannot evaluate a condition).
- The legacy Firestore resolver and `types/access.ts ScopeType` do not know `salesChannel`; it is a PostgreSQL-only scope.

Nothing is assigned or activated live; the migration is applied to local test databases only.

## 15. Direct Principal exceptions: complete support (lane DX)

**Decision: Option A.** The common engine could consume direct grants with no second evaluator. `resolveOperationalContext` (and `resolveOperationalContextForPrincipal`) now call `capabilityAuthority.resolveOperationalCapabilities`, which treats unexpired `principal_capabilities` rows as a capability SOURCE beside the qualifying global Role grants:

- **One read.** The flat-set statement is one `UNION ALL` over `role_capabilities` (the qualifying Roles) and `principal_capabilities` (this Principal, `expires_at` unset or in the future). A request costs the same number of queries as before.
- **Conditions.** One catalog covers ROLE and PRINCIPAL cells. A key reached only through conditioned grants of either kind is `conditionallyHeld` and is never in the flat set. Entitlements keep the PRINCIPAL grantor.
- **Scope.** A direct grant has no scope model. It never produces a scoped holding, and a scoped direct grant is refused (`DIRECT_GRANT_SCOPE_UNSUPPORTED`).
- **Expiry.** An expired row is not read, so it confers nothing on any gate and is not shown.

**Gates unified.** Each of these sees the direct grant through that one resolution:
- eosOps (`resolveMyCapabilities`, `authorizeOperationalAction` and `authorizeResolvedOperationalAction`);
- `authorizeEntitledResolvedAction`, which re-resolves Role AND direct entitlements;
- the Commercial and CRM kernels (`capabilitiesWithoutUnevaluatedConditions` counts both sources);
- Workforce: the transport; the operator actor, which now uses the same resolution with PostgreSQL conditions; and `withDirectCapabilityGrants`, which never promotes a conditioned key;
- experience surfaces (now PostgreSQL conditions, so a conditioned-only key earns no surface);
- the Administration read gate (`resolvePrincipalEffectiveAccess` also withholds a conditioned direct grant) and the mutation gate (`capabilityKeysFor`, unchanged);
- the workflow effective-authority half, which is capability-only. A direct grant never satisfies a SECURITY_ROLE binding.

**Administration.**
- `grantObjectActionToPrincipal` takes an optional `condition`. It is validated against the CONDITIONABLE_GRANTS allow-list, so no `admin.*` key can carry one, and it is written in the same transaction as the grant.
- `setGrantCondition` and `retireGrantCondition` take `principalId` in place of `roleKey`. Exactly one grantee must be named.
- Every command runs under the governance lock and the `(PRINCIPAL, principal, capability)` cell lock that the never-widen trigger also takes.
- Refusals:
  - no self-grant, self-condition or self-retire (`SELF_ADMINISTRATION`);
  - Owner ruling A at the Principal, now counting conditioned holdings too, checked inside the lock;
  - retire while held (`CONDITION_RETIREMENT_WOULD_WIDEN`);
  - anti-lockout, where a holder counts only if unexpired, UNCONDITIONED and global.
- Each command writes exactly one audit event per effective change and none for a no-op. An expired grant is refreshed and audited once.

**Reads.**
- `explainEffectiveAccess.directGrant` is `{label, source, exceptionReason, expiresAt, grantedBy, grantedAt, condition, enforced:true}`. The `notEnforcedOnRoleOnlyRuntimePaths` flag is gone, because it is no longer true.
- `getObjectActionGrantMatrix.principals[]` adds `grantedAt`, `exceptionReason`, `expiresAt`, `condition` and `enforced`.

**Client.** The Employee page has a **Direct Exceptions** section (`EmployeeDirectExceptions.jsx`). It lists each exception labelled DIRECT EXCEPTION with its source, reason, actor, creation time, expiry, condition and the evaluator's result. From it an administrator can grant (choose an Object action, an optional condition from the server vocabulary, an optional expiry, and a required reason), revoke, and attach, replace or retire a condition. Every mutation re-reads, and every refusal is shown verbatim.

**Behaviour change to note.** `resolveExperienceContext` now composes the PostgreSQL condition provider. Before, a conditioned-only Role grant still earned its surface. It now earns none, which matches the explanation and every other flat gate.

**Proof.** `directExceptionAuthorityPostgres` covers:
- table-driven parity against an equivalent Role grant across 13 gates, with a non-vacuity holder-of-nothing row on each;
- a conditioned grant is never flat;
- an expired grant yields nothing;
- no self-grant;
- no scope;
- Owner ruling A in both orders;
- anti-lockout, both counted and end to end;
- tenant isolation;
- audit exactly once.

**Cell lock at the database (migration 1762992000000).** The trigger `principal_capabilities_cell_lock` runs BEFORE INSERT OR UPDATE on `principal_capabilities`. It takes the same `grant_cell_lock(tenant, 'PRINCIPAL', principal, capability)` as `capability_grant_conditions_never_widen`, and it refuses any change to a row's identity. A raw direct-grant insert that races a condition retire therefore serializes, and the retire is refused (Pass 8 D3 parity). The lock only orders the two writers: the retire's count is sound only at READ COMMITTED, so the retire trigger refuses REPEATABLE READ and SERIALIZABLE (Pass 10 P10-2); this trigger counts nothing and has no snapshot dependency.

**Composition with SALES_CHANNEL (§14).** A direct exception is never scoped, and a `salesChannel` scope is refused by name. For a channel-scoped Role combined with a global direct grant, the result is the union of the two:
- the direct key is decided globally, through the PRINCIPAL grantor;
- the Role's scoped keys stay scoped: RETAIL only, OUTSIDE_ASSIGNMENT_SCOPE elsewhere, SCOPE_CONTEXT_REQUIRED with no context.
