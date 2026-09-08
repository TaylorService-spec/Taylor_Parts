# EOS Administration — Policy & Workflow Reconciliation

Status: Phase A reconciliation for the Administration / policy / workflow foundation (Owner directive, 2026-09-08)
Scope: Objects, Roles & Permissions, Users, Workflows — the authority model, not a Firebase migration
Branch: `feature/eos-admin-policy-workflows`, cut from `origin/main` @ `5ddb9e4a`

**This document measures what exists before anything is moved.** No redesign by assumption. Every
count below was produced by running the code or reading the file, not by recollection.

Related and deliberately NOT superseded: [`ADR-005`](ADR-005-enterprise-authorization-migration-strategy.md)
(Hybrid Compatibility Model), [`ADR-012`](ADR-012-persona-authority-composition-and-scope.md) (persona,
authority composition, scope), [`SYSTEM_AUTHORITIES.md`](SYSTEM_AUTHORITIES.md) (canonical ownership).

---

## 0. The one-sentence problem

Today **code is the customer's policy**. The target is **code is how policy is enforced, and the EOS
database is what the customer's policy says** — with Firebase reduced to identity and Firestore
excluded entirely from policy persistence.

```
  Authentication provider  ->  identity only
  EOS                      ->  authorization, object/field CRED, role assignment,
                               workflows, policy enforcement, audit
  EOS PostgreSQL / DAL     ->  all persisted policy/configuration
```

---

## 1. Current source of truth, measured

| Concern | Where it lives today | Form | Configurable by a customer? |
|---|---|---|---|
| Capability vocabulary | `functions/src/access/permissionCatalog.ts` | 147 frozen TS objects, 86 distinct resources | **No** — code |
| Compatibility Roles | `functions/src/access/compatibilityRoles.ts` | 3 Roles (`admin`, `dispatcher`, `technician`) | **No** — code |
| Governed business Roles | `functions/src/access/governedBusinessRoles.ts` | 43 Roles, 1,673 lines | **No** — code |
| Role → permission binding | the same two files (`Role.permissions: PermissionId[]`) | flat id lists + `conditionsByPermission` / `scopesByPermission` side maps | **No** — code |
| Object × CRED matrix | `field-ops-app-vite/src/access/objectPermissionMap.js` | 106 lines, hand-maintained Object → capability-ids per verb | **No** — code, and **client-side** |
| Object/field metadata | `field-ops-app-vite/src/metadata/definitions/*.js` | 29 entities, 394 field definitions | **No** — code, and **client-side** |
| Role assignment | Firestore `roleAssignments/{id}` | documents, written by `trustedWriterCommands.ts` | data, but in **Firestore** |
| Access version | Firestore `users/{uid}.accessVersion` | a number on the user document | data, but in **Firestore** |
| Effective permission | `functions/src/access/resolveEffectivePermission.ts` (323 lines) | pure resolver over the above | engine |
| Effective access feed | `functions/src/access/effectiveAccessFeed.ts` | merges `{...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES}` | engine |
| Audit | `functions/src/access/auditEventWriter.ts` + `AuditAction` union in `functions/src/types/access.ts` | append-only Firestore events, ~70 declared actions | data, but in **Firestore** |
| Parts/Purchasing lifecycle | `field-ops-app-vite/src/domain/constants.js` `REORDER_REQUEST_STATUS` + `functions/src/reorderRequest/reorderCommands.ts` | 10 states; transitions split between client writes and trusted commands | **No** — code |
| Work Order lifecycle | `field-ops-app-vite/src/domain/workOrderWorkflow.js` mirroring `functions/src/transitionEngine.ts` | 11 states, 11 actions, `ACTION_PERMISSIONS` keyed by **legacy role strings** | **No** — code |
| Sales lifecycle | `opportunity/opportunityLifecycle.ts`, `salesAgreement/salesAgreementLifecycle.ts`, `salesOrder/salesOrderLifecycle.ts` | three chained state machines | **No** — code |
| **Policy persistence** | — | **does not exist** | — |

### 1.1 The finding that shapes everything else

**There is no PostgreSQL, no DAL, and no migration tooling anywhere in this repository.** Measured:
no `pg`, `postgres`, `knex`, `kysely`, `drizzle-orm`, `prisma`, `typeorm`, `sequelize` or `slonik`
in any `package.json`; zero source files mentioning Postgres; no `migrations/`, `db/` or `database/`
directory.

Per the directive's own instruction, this is recorded as **NAMED DECISION D-1** (§8) rather than
silently resolved, and the work proceeds storage-independently behind a repository/DAL port.

### 1.2 The second finding

`readGovernedList` — the governed read path — resolves capabilities against `COMPATIBILITY_ROLES`
only (`admin`, `dispatcher`, `technician`). **A governed business Role reaches no governed read
source at all**, whatever its 1,673 lines of permission lists say. This was measured on the #1821
branch and is true on `main` as well. It is recorded here because it means the 43 governed Roles are
today *declarations*, not live authority — which materially lowers the risk of moving them, and
raises the priority of the resolver work in Phase C.

---

## 2. Desired source of truth

| Concern | Target home |
|---|---|
| Object + field definitions (system) | seeded from the repository metadata registry, stored in EOS DB, protected |
| Object + field definitions (custom) | EOS DB, Admin-created, governed lifecycle |
| Object CRED per Role | EOS DB (`role_object_permissions`) |
| Field CRED per Role | EOS DB (`role_field_permission_overrides`) — **overrides only**, inheritance is computed |
| Roles | EOS DB (`roles`), with protected system Roles |
| Role assignment | EOS DB (`user_role_assignments`) |
| Access version | EOS DB (`principal_access_versions`) — **not** `users/{uid}.accessVersion` |
| Workflow definitions | EOS DB (`workflows` / `workflow_versions` / `workflow_steps` / `workflow_actions` / `workflow_role_bindings`) |
| Workflow instances | EOS DB (`workflow_instances` / `workflow_instance_events`) |
| Policy audit | EOS DB (`audit_events`) |
| Capability vocabulary | **stays in code** — see §3 |
| Enforcement engine | **stays in code** — see §3 |

---

## 3. Classification of every censused item

The directive's five buckets, applied. **This is the part that decides what moves.**

### ENGINE INVARIANT — stays in code, Admin cannot configure it away

| Item | Why |
|---|---|
| `resolveEffectivePermission.ts` resolution order and fail-closed posture | the enforcement algorithm, not a policy value |
| `Scope` / `ScopeType` matching semantics | platform-wide meaning of a scope |
| `Condition` evaluation (`ConditionKind` kinds) | declarative predicate evaluation, never arbitrary code |
| Unknown / malformed permission ⇒ DENY | fail-closed invariant |
| `PermissionDefinition.active === false` ⇒ hard DENY | security-review gate |
| Multi-role union is **additive** | Owner ruling, kept |
| Object doorway cannot be bypassed by a field grant | new invariant, §5 |
| Workflow authority ⊥ data authority (neither implies the other) | Owner ruling |
| Transition validity computed from **stored** current state | anti-forgery |
| Tenant derived server-side, never from the client | tenancy invariant |
| Audit emission on every policy mutation | cannot be configured off |
| `auditEventWriter.ts` append-only behaviour | integrity |

### BOOTSTRAP POLICY — seeded into the DB, protected, editable only under guard

| Item | Why |
|---|---|
| The 147-entry capability catalog | the *vocabulary* a customer's policy is written in. Customers configure which Roles hold which capabilities; they do not invent capability ids, because an id with no enforcement point is a lie. Seeded as reference data. |
| System Objects and their system fields (29 entities / 394 fields) | the shipped business model |
| A protected `admin` Role that cannot be left unable to administer | recovery invariant, §6 |
| The three seeded workflow definitions (§7) | shipped lifecycles, versioned; a tenant may version them forward |
| `objectPermissionMap.js`'s Object→capability mapping | only a person can say `salesOrder.fulfill` is an *Edit*. Seeded, not derived, not customer-authored. |

### TENANT-CONFIGURABLE POLICY — moves to the EOS database

| Item |
|---|
| Roles (beyond the protected system set) and their names/descriptions |
| Object CRED per Role |
| Field CRED overrides per Role |
| Custom Object fields and their definitions |
| Role assignments to users |
| Workflow versions, steps, actions and Role bindings a tenant adds or edits |

### TRANSITIONAL FIRESTORE PLUMBING — read during migration, then retired

| Item | Retirement condition |
|---|---|
| `roleAssignments/{id}` documents | superseded by `user_role_assignments`; dual-read until cutover |
| `users/{uid}.accessVersion` | superseded by `principal_access_versions` |
| `employees.assignedWarehouseIds` | R-29/R-32's open reconciliation; also named in `SYSTEM_AUTHORITIES.md` |
| `users/{uid}.role` legacy string | already display-only; must never become a Role store |
| Firestore audit events | dual-write until `audit_events` is authoritative |

### DEAD / RETIRED — delete rather than adapt

| Item | Evidence |
|---|---|
| `RoleObjectGrid` cells being permanently inert | the grid exists to render a matrix that code owns; once policy is data, the read-only-ness is a *policy* decision, not a structural one |
| `ACTION_PERMISSIONS` keyed by legacy role strings (`workOrderWorkflow.js` / `transitionEngine.ts`) | replaced by workflow Role bindings; the dual client/server mirror exists only because policy is code |

### NEEDS OWNER DECISION

See §8.

---

## 4. Reusable code — what this work builds ON, not beside

The directive forbids a second field-metadata model and a second compatibility-role layer. Measured,
these are the pieces that carry forward unchanged:

- **`functions/src/types/access.ts`** — `Permission`, `Role`, `RoleAssignment`, `Scope`, `Condition`,
  `AuditAction`. The domain contracts already match the target model closely. `Role.permissions`
  stays `PermissionId[]`; Object/Field CRED is an **additional** projection, not a replacement.
- **`resolveEffectivePermission.ts`** — kept as the capability-level resolver. The new Object/Field
  CRED resolver sits *above* it and defers to it for capability questions.
- **The metadata registry** (`entityDefinition.js`, 29 entities / 394 fields) — the canonical
  **design-time** object model, and the seed for system Objects and system fields. `FIELD_TYPE`,
  `FIELD_OPERATOR`, `CARDINALITY` are reused verbatim as the type vocabulary. **No second field
  model is created.**
- **`objectPermissionMap.js`** — the Object×CRED→capability mapping, promoted from a client-side
  constant to seeded reference data.
- **`auditEventWriter.ts`** and the `AuditAction` union — extended with policy-mutation actions,
  never forked into a parallel audit system.
- **The three lifecycle modules** — measured as the workflow oracles in §7, not reinvented.

### 4.1 The metadata reconciliation, precisely

The repository metadata model is **design-time, repo-declared, client-side, and complete for
presentation**. The policy model needs **run-time, tenant-owned, server-side** facts the metadata
model does not carry. Measured gap:

| Required by the directive | Present in `makeFieldDefinition` | Action |
|---|---|---|
| id, objectId, label, description, data type | `id`, `entityId`, `label`, `description`, `type` | reuse |
| sortable, reportable | `sortable`, `reportable` | reuse |
| searchable | `filterable` (+ `operators`) | reuse, renamed at the boundary only |
| relationship / reference | `referenceTo`, `makeRelationshipDefinition` | reuse |
| validation / allowed values | `enumValues` / `enumLabels` only | **extend** — general validation is new |
| key | — (`id` doubles as the key) | **extend** — a custom field needs a stable storage key distinct from its display id |
| required / optional | — | **extend** |
| default where legitimate | — | **extend** |
| sensitivity / classification | `readCapability` is adjacent, not the same | **extend** |
| system vs custom | — | **extend** |
| lifecycle state | — | **extend** |
| createdBy / createdAt / updatedBy / updatedAt | — | **extend** |

Conclusion: **one field model, two layers.** The metadata registry keeps describing shipped fields;
the policy store adds the governance attributes and owns custom fields. The policy store's
`ObjectField` is a superset that *cites* the metadata registry for system fields rather than copying
their presentation facts.

---

## 5. The CRED model, and the invariant that makes it safe

Object CRED and Field CRED as the Owner defined them, plus **inheritance by default, overrides
persisted**:

```
  effective field permission =
      explicit field override, when one exists
      otherwise the Object's permission
```

**THE DOORWAY INVARIANT.** A field grant must not open an object the Role cannot read:

```
  Customer.Read            = false
  Customer.Name.Read       = true      -> the Role still reads NO Customer records
```

Field permissions narrow *within* an already-granted object; they never widen into one. A future
governed minimal projection, if wanted, is an explicit separate mechanism — never a side effect of
inheritance. This is an engine invariant (§3) and is proved in Phase G.

**Multi-role union stays additive.** No primary role, no replacement semantics, no mutual exclusion.
Effective access is the union over qualifying active assignments, subject to scope, conditions and
platform invariants.

---

## 6. Recovery / bootstrap — what already exists

Documented rather than reinvented, per the directive. Measured in `AuditAction`:

- `bootstrapCertificationAuthority` — the first role assignment in an otherwise-empty
  non-production world, where no actor or approver can exist yet.
- `completeCertificationAuthorityGenesis` — the runtime-administration half of that genesis.
- `breakGlassRestore` — an existing declared recovery action.

These are **engine invariants**, non-production-scoped where their names say so, and this work adds
no new backdoor. The new requirement is narrower and is enforced in Phase D: ordinary Admin
configuration must not be able to remove the platform's ability to administer itself — a protected
system Role, and a refusal to remove the last administering assignment.

---

## 7. The three workflows, measured

Definitions describe **existing** behaviour first. Nothing is activated because a definition exists.

### 7.1 Parts / Purchasing — `REORDER_REQUEST_STATUS`, 10 states

```
  PENDING_REVIEW            -> APPROVED | REJECTED
  READY_FOR_PARTS_MANAGER   -> ASSIGNED_TO_PARTS_ASSOCIATE | CANCELLED
  ASSIGNED_TO_PARTS_ASSOCIATE -> PURCHASING_IN_PROGRESS | CANCELLED
  PURCHASING_IN_PROGRESS    -> ORDERED | CANCELLED
  ORDERED                   -> RECEIVED | VOIDED
  RECEIVED / REJECTED / CANCELLED / VOIDED  terminal
```

`CANCELLED` is reachable from any pre-`ORDERED` active status; `VOIDED` only from `ORDERED`, and it
never touches the original purchase-order document (an append-only void record is written instead).

### 7.2 Technician / Work Order — `WORK_ORDER_TRANSITIONS`, 11 states, 11 actions

The canonical table, mirrored client (`workOrderWorkflow.js`) and server (`transitionEngine.ts`).
`SCHEDULED -> READY_TO_DISPATCH` (Unschedule) is the single reverse edge. `ACTION_PERMISSIONS` binds
each action to legacy role strings plus a `requiresOwnAssignment` flag — **this binding is what
becomes a workflow Role binding.** Historical `fieldops_jobs` behaviour is deliberately not revived.

### 7.3 Sales — three chained machines

```
  Opportunity     IDENTIFIED -> QUALIFYING -> SOLUTION -> QUOTING -> CUSTOMER_REVIEW -> DECISION
                  LOST from any open stage; WON only from DECISION; closed accepts nothing further
  SalesAgreement  DRAFT -> ACCEPTED | DECLINED
  SalesOrder      CONFIRMED -> IN_FULFILLMENT -> FULFILLED -> CLOSED ; CANCELLED
```

Sales is therefore **three workflows**, not one — measured, not assumed. Modelling it as a single
machine would have invented transitions that no code performs.

---

## 8. Named decisions for the Owner

**D-1 — PostgreSQL driver and migration tooling is a new architectural dependency.**
There is no Postgres, DAL or migration tooling in this repository, and no precedent for choosing
one. This tranche therefore builds the domain model and a repository/DAL **port**, ships a
reference in-memory adapter for tests, and writes the schema as reviewable SQL DDL — but does not
select a driver, add a dependency, or run a migration. Falling back to Firestore is explicitly
refused. **Owner decides the driver/migration technology and the hosting posture.**

**D-2 — Object CRED for a Role must not silently contradict the capability catalog.**
Two grammars now describe the same authority: 147 capability ids, and Object×CRED. The seeded
mapping (`objectPermissionMap.js`) reconciles them for shipped objects, but a tenant that grants
`Sales Orders.Edit` where no capability governs that verb has expressed an intent the engine cannot
enforce. This tranche stores CRED as the authority and treats the capability mapping as the
enforcement projection, refusing a grant with no enforcement point. **Owner confirms that a CRED
cell with no governing capability is a refusal rather than a silent no-op.**

**D-3 — `warehouseManager` transfer-order scope (carried from #1821).**
Named in that PR and unresolved: the canonical Detailed CRUD matrix grants a global transfer-order
read; the retired Rules gave only the assigned-site population. Recorded here because the CRED model
is where that disagreement will land permanently.

**D-4 — Governed business Roles do not currently reach governed read sources (§1.2).**
Fixing it changes live authority for 43 Roles at once. It is not fixed in this tranche.

---

## 9. Exact migration path

1. **Foundation (this tranche)** — domain contracts, DAL port, in-memory adapter, SQL DDL,
   Object/Field CRED resolver, admin mutation services, seeded workflow definitions, proofs.
2. **Owner decides D-1** — driver and migration tooling.
3. **Postgres adapter** — implement the port; run the DDL as the first migration.
4. **Seed** — capability catalog, system Objects/fields from the metadata registry, protected system
   Roles, the three workflow v1 definitions.
5. **Dual-read** — resolver reads policy from the DB, falling back to the code declarations while the
   two are proved equivalent by a parity harness (the shape `shadowParityHarness.ts` already uses).
6. **Cutover** — DB becomes authoritative; code declarations become the seed only.
7. **Retire** — `roleAssignments/{id}`, `users/{uid}.accessVersion`, and the legacy role strings in
   the two workflow mirrors.

Each step after 1 is separately authorized. **No step in this tranche touches production,
Certification, Firestore Rules, or any deployment.**
