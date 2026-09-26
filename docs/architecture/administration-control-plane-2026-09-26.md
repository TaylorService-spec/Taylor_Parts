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
- Input: `{objectKey, actionKey, principalId, reason?}`
- These are governed DIRECT exceptions. The main operational gates do NOT honour direct grants; only the Workforce path does.

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

### Specified, not implemented: `explainEffectiveAccess`

- Input: `{principalId}`. Gate: `admin.principalAccess.read`.
- It needs the pool, and `adminPolicyApi` is repository-only, so it is composed in `adminPolicyHttp`/`server.ts`.
- Behaviour:
  - split `resolvePrincipalContext` so it resolves by principal id (qualifying, non-stale, GLOBAL-scope assignments only; scoped assignments grant nothing);
  - resolve `capabilitiesForRoleKeys`;
  - call the entitlement resolver with `postgresGrantConditionProvider(pool)` (the SAME source the runtime uses);
  - apply the experience-context reader.
- For each capability it returns `{capabilityKey, objectKey, actionKey, via:[{grantor:{kind,roleKey|principalId}, condition|null}], runtime: "ALLOWED"|"CONDITIONAL"|"WITHHELD_FROM_FLAT_KERNELS"|"NOT_ENFORCED_DIRECT"}`.
- Actions that need a record return CONDITIONAL.
- Parity test: for each canonical persona, the capability set must equal `resolveOperationalContext(...).capabilities`.

## 9. Findings recorded by this lane

- **The catalog reconcile adds six pairs that the baseline withholds.** On a baseline-equal tenant, the Sample Company reconcile path ADDS six reorder pairs that the governed baseline withholds:
  - `admin`, `dispatcher`, `partsManager` and `purchasingManager` → `reorder.request.read.queue`. This key is SUPERSEDED and "may never be granted again".
  - `admin` and `dispatcher` → `reorder.request.assign`. This key is operationalRole-conditioned in the legacy catalog.

  This predates the lane: the legacy Role catalog declares these pairs. The PostgreSQL acceptance test pins the six by name, and none of them is an Administration cell. The fix is an Owner decision. One option is to add `reorder.request.read.queue` to the system invariants for every Role.
- **Technician Purchase Order cells.** Treating the withheld technician Purchase Order cells as a system invariant means the catalog reconcile no longer grants `technician → reorder.purchaseOrder.read/.create` in Sample Company fixtures. The legacy catalog declares both. The verifier now reports them as `SYSTEM_INVARIANT`, not `MISSING_GRANT`. The nonprod baseline never held them.
- **Environmental test failures.** Four PostgreSQL down-migration suites fail on the shared local test database with `migration 027 cannot be reversed: eos_ops.parts holds 4 Part Master records`: eosOpsWarehouseBin, truckFleet, employeePrincipalLink and eosOpsEquipmentCustody. The same failure reproduces with this lane's migration removed, so it is pre-existing and environmental.

## 10. Not done in this lane

- The client UI: object×action toggles, the condition editor, and retiring the CRED grid.
- `explainEffectiveAccess` (§8).
- Moving definition, Object and Workflow mutations off the Role-name invariant (§6).
- Principal-scope conditions: the relation supports them, but the API is ROLE-only.
- `exception_reason` / `expires_at` on direct grants.
- Applying migration 1762646400000 anywhere but local test databases.
