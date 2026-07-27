---
artifact_type: implementation-authorization-package
status: PENDING — documentation only; authorizes no implementation, permission grant, Rules/Functions/index, or production access
gate: D4 (Trusted persistence) — Part–Equipment Compatibility
date: 2026-07-27
baseline: c0d4fe800c751a168bd5431aebbf9c6b50e675ec
workstream: Inventory → Equipment integration
related:
  - docs/architecture/equipment-part-compatibility.md
  - docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md
  - docs/architecture/ADR-006-equipment-and-installed-asset-management.md
  - docs/architecture/SYSTEM_AUTHORITIES.md
  - docs/DECISIONS.md (#51 D-COMPAT-1..7)
  - functions/src/access/permissionCatalog.ts
  - functions/src/access/resolveEffectivePermission.ts
  - functions/src/access/trustedWriterCommands.ts
  - functions/src/access/accessCommandCallables.ts
  - functions/src/access/auditEventWriter.ts
  - functions/src/access/governedBusinessRoles.ts
  - firestore.rules
  - docs/Deployment.md
---

# D4 — Trusted persistence authorization package (Part–Equipment Compatibility)

## 0. Gate, status, and hard boundary

This is a **documentation-only authorization package** for the D4 gate defined verbatim in
`docs/architecture/equipment-part-compatibility.md` §10:

> **D4 — Trusted persistence:** repositories, trusted commands, permission catalog entries, audit,
> Rules/index proposal; emulator only.

It **implements nothing**: no code, no permission-catalog entry, no Firestore Rules, no Cloud
Function, no index, no Firebase or production access. Every new permission and role grant below is
**PENDING** under the Issue #226 security gate (architecture §8: "Permission IDs and role grants
require a separate #226-aligned security gate. This document does not grant them."). Builds on merged
**D0 (#449 / DECISIONS #51), D1 (#450), D2 (#454), D3 (#456, `c0d4fe8`)**.

**Explicit gate separation** (architecture §10):

| Gate | Scope | Environment | This package |
|---|---|---|---|
| **D4** | repositories, trusted commands, permission-catalog *entries* (inactive), audit, Rules/index **proposal**, emulator tests | **emulator only** | designed here (PENDING) |
| **D10** | production Rules, indexes, Functions **deployment** + verification | production | **separate gate; out of scope** |
| **D11** | production data / dry-run-reviewed **import execution**, one bounded batch, reconciliation + rollback | production | **separate gate; out of scope** |

D4 produces reviewable repository/emulator artifacts and a **proposal** for Rules/indexes. It never
deploys and never touches production — `merged ≠ deployed` (`docs/Deployment.md`: `firestore.rules`
and `firestore.indexes` are "not deployed by any CI workflow … no effect on the live project until
manually deployed").

---

## 1. Reused authority — trusted writer & callable context (do NOT reinvent)

All findings below are verified present on the D4 baseline (`origin/main` @ `c0d4fe8`). The repository
already governs trusted writes through a single, audited, claims-enforced Admin-SDK callable surface
(Issue #226 / ADR-005); D4 **adds new commands on this same surface** — no new service account, no new
authorization model.

- **Command module:** `functions/src/access/trustedWriterCommands.ts` — governed mutation commands
  (`grantRole`, `revokeRole`, `assignApprovedRole`, `setUserStatus`, `approveAccessRequest`,
  `rejectAccessRequest`) sharing one orchestrator `runAccessMutationCommand(...)`. Each returns
  `CommandOutcome { status: "applied" | "alreadyApplied" | "denied"; auditEventId; ... }`.
- **Callable adapters (deployment surface):** `functions/src/access/accessCommandCallables.ts` — thin
  `onCall` (`firebase-functions/v2/https`, `us-central1`) wrappers that (1) derive `actorUid`
  **only** from `request.auth.uid` (never `request.data`), (2) require `request.auth`, (3) map a typed
  error taxonomy to safe `HttpsError`s. A second instance of the identical pattern exists for the
  report creator (`functions/src/reporting/savedDefinitionCommands.ts` / `…Callables.ts`).
- **Permission enforcement:** commands authorize via the pure resolver (§4), never raw role strings:
  `verifyActorPermission → resolvePrincipalPermission → resolveEffectivePermission`, reading active
  `roleAssignments` and the authoritative `users/{uid}.accessVersion`. Privileged grants require a
  **second distinct approver** (`verifyApproverIsPrivileged`).

**D4 decision:** the four compatibility authorities are mutated **only** through new trusted callable
commands on this existing surface, inheriting its actor/claims/idempotency/version/audit machinery.

---

## 2. Reused authority — append-only audit sink & writer (do NOT reinvent)

- **Writer:** `functions/src/access/auditEventWriter.ts` → collection `auditEvents`. `stageAuditEvent`
  / `stageAuditEventWithId` stage exactly one create onto the **same transaction/batch** as the
  business mutation (atomic write+audit); `recordStandaloneAuditEvent` records denials. **No
  update/delete function exists by design** — append-only, immutable.
- **Event shape:** `{ at, actorUid, action, targetType, targetId, outcome: "applied" | "denied",
  summary, scope?, approverUid?, accessVersionAfter?, … }`.
- **Strict action registry:** the runtime allowlist `AUDIT_ACTIONS` (mirrors the `AuditAction` union)
  is enforced in `assertValid` — an `action` must be in the list, not merely a string. Adding an
  action is a governed edit to that registry.
- **Sanitization already enforced by the writer:** `SECRET_LIKE_PATTERN` rejects any `summary` that
  looks like a bearer/JWT/`sk_`/password token; `MAX_SUMMARY_LENGTH = 500`; dropped-field ids must
  match a dotted `FIELD_ID_SHAPE_PATTERN` (never row data); there is **no free-form `details`/`notes`
  map**. This is exactly the architecture §8 rule ("Do not audit raw source contents, serial lists,
  credentials, or unbounded notes").

**D4 decision:** reuse this writer unchanged; add new **action strings** to the existing registry
(§3). No documented incompatibility requires a new sink.

---

## 3. Sanitized D4 audit events (new registry actions; outcome via existing `outcome` field)

The existing model records **one event per command** with `action` (a camelCase verb) plus a separate
`outcome ∈ {applied, denied}` field. The seven audited moments the architecture §8 requires map onto
that model as follows (proposed additions to `AUDIT_ACTIONS`, camelCase to match `grantRole` /
`runReportDefinition`):

| Architecture-required moment | Proposed `action` | `outcome` |
|---|---|---|
| initiation / applied / denied (import/upsert) | `importCompatibility` | `applied` on commit; `denied` on any rejection (auth/permission/validation/referential/version/idempotency) |
| verification change | `verifyCompatibility` | `applied` / `denied` |
| correction | `correctCompatibility` | `applied` / `denied` |
| conflict | `flagCompatibilityConflict` | `applied` (records a relationship entering/holding `CONFLICT`) |
| model / alias management | `manageEquipmentModel` | `applied` / `denied` |
| projection rebuild | `rebuildCompatibilityProjection` | `applied` / `denied` |

("initiation/applied/denied" are the existing `outcome` dimension of a single command event — the
writer already emits a `denied` event for rejected attempts and an `applied` event on commit, so no
separate initiation action is needed.)

**Sanitized payload contract (mandatory):** `targetType` ∈ the four authorities; `targetId` is the
**opaque id only** (`equipmentModelId` canonical / `compatibilityId` = `cmp_…` / `sourceId` = `src_…`);
`summary` is a bounded, secret-scanned reason phrase (≤500, `SECRET_LIKE_PATTERN`-checked); plus
`idempotencyKey`, `expectedVersion`/`resultVersion`, and actor identity. **Never** raw source
contents, serial values/lists, credentials, private identifiers, or unbounded notes — enforced by the
writer above and consistent with the merged D2/D3 sanitization contracts (`{package,line,code}` refs,
opaque ids, bounded counts).

---

## 4. Permission reconciliation (§8; PENDING under #226)

- **Catalog:** `functions/src/access/permissionCatalog.ts` (byte-mirrored at
  `field-ops-app-vite/src/access/permissionCatalog.ts`) — a single frozen `PERMISSION_CATALOG` of
  `{ id, description, resource, action, active? }`; ids validated by
  `PERMISSION_ID_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/` (dotted lower-camel
  `domain.resource.action`, colons NOT used). `active: false` = **registered-but-not-grantable (hard
  DENY)**. Helpers: `findPermission`, `requirePermission`, `isValidPermissionId`, `isActivePermission`.
- **Resolver:** `functions/src/access/resolveEffectivePermission.ts` — pure, fail-closed. Unknown id →
  DENY `unknownPermission`; `active:false` → DENY `inactivePermission`; else per active assignment it
  checks `status==="active"`, `accessVersionAtGrant ≤ currentAccessVersion`, role-holds-permission,
  scope match (narrowest wins: `ownAssignment < location < domain < tenant < global`), and
  `Conditions`. `operationalRoles` / `employmentStatus` enter **only** via `ConditionContext`
  (`operationalRoleActive`, `employmentActive`) — never as standalone permissions.

The five proposed capabilities already satisfy `PERMISSION_ID_PATTERN` and are adopted as-named:

| Proposed capability (`id`) | `resource` | `action` | Mutation surface |
|---|---|---|---|
| `equipment.compatibility.view` | `equipment.compatibility` | `view` | read (D5) |
| `equipment.compatibility.import` | `equipment.compatibility` | `import` | trusted write |
| `equipment.compatibility.verify` | `equipment.compatibility` | `verify` | trusted write |
| `equipment.compatibility.correct` | `equipment.compatibility` | `correct` | trusted write |
| `equipment.model.manage` | `equipment.model` | `manage` | trusted write |

**Reuse of the repo's own PENDING mechanism:** D4 may register all five in the catalog with
`active: false` (catalogued, shape-valid, but a hard DENY that grants nothing) until the #226 gate
flips them active — OR defer catalog entry entirely to #226 (Owner decision, §10). Either way, **no
role carries them** until #226 approval.

---

## 5. Least-privilege role mappings (PROPOSED; every grant PENDING under #226)

Roles live in `functions/src/access/governedBusinessRoles.ts` / `compatibilityRoles.ts` as
`{ id, permissions: PermissionId[], conditionsByPermission?, privileged? }`. Note that
`PARTS_MANAGER` / `WAREHOUSE_MANAGER` are **operationalRoles**, not security roles — they gate a
security role's grants through `operationalRoleActive` conditions (the Issue #100 precedent), matching
the architecture §8 read population (admin, dispatcher, active PARTS_MANAGER, active WAREHOUSE_MANAGER;
technician has no broad read).

| Capability | Proposed carriage (PENDING #226) | Least-privilege rationale |
|---|---|---|
| `equipment.compatibility.view` | admin, dispatcher; + `technician` **conditioned** on `operationalRoleActive(PARTS_MANAGER)` / `(WAREHOUSE_MANAGER)` | reproduces the governed Parts-read population via the existing condition mechanism; bare technician grants nothing |
| `equipment.compatibility.import` | one execution-scoped, non-privileged importer role assigned per run + revoked after (the `inventoryCreateExecutor` / `ASSIGNABLE_ROLES` precedent), + admin | avoids a standing broad write grant |
| `equipment.compatibility.verify` | dedicated verifier role + admin | verification is a governed decision, separated from import |
| `equipment.compatibility.correct` | dedicated corrector role + admin | corrections separated from import/verify |
| `equipment.model.manage` | dedicated model-steward role + admin | model identity authority, separate from relationships |

A scoped technician **work-order-tied** read/projection (architecture §8) is deferred to a later gate
(D5+), must fail closed, and is **not** part of D4. Every mapping above is PROPOSED and **granted to
no one** until #226.

---

## 6. Exact D4 emulator-only persistence scope

Implemented against the **Firestore emulator only**, in reviewable repository artifacts:

1. **Repositories** — typed read/write adapters for the four authorities delegating ALL
   validation/identity to the merged D1/D2 pure contracts (`validateEquipmentModel`,
   `validateEquipmentModelAlias`, `validateCompatibility`, `validateCompatibilitySource`,
   `buildCompatibilityId`/`buildCompatibilityUniquenessKey`, `recordFingerprint`). No re-implemented identity.
2. **Trusted commands** — new callables on the existing surface: import/upsert models, aliases,
   relationships, evidence; verify; correct; projection rebuild.
3. **Idempotency** — deterministic idempotency key = the audit/record doc id; existence of the audit
   doc is the single "alreadyApplied" source of truth; a reused key with a different
   action/target/fingerprint fails closed; a `denied` key can never become `applied`
   (`assertSameCommandFingerprint` precedent). Exact-equivalent replay = no-op success; non-equivalent
   = fail closed (the D2/D3 collision contract, now transactional).
4. **Expected-version handling** — optimistic concurrency on each record's own `version` (D2 field):
   read-then-check-then-increment **inside the transaction** (the `runAccessMutationCommand`
   read-increment pattern, applied to the compatibility record's `version` instead of `accessVersion`).
   A mismatch fails closed (no lost update). *(Note: existing report commands use auto-ids with no
   expectedVersion; compatibility ADDS expectedVersion because D2 defines a record `version`.)*
5. **Referential-integrity checks** — every `partId` / `equipmentModelId` / `compatibilityId` resolves
   against the authoritative collections **in-transaction**; aliases cannot create models; sources
   cannot create relationships; unresolved → deny (the D3 resolution contract, enforced at write time).
6. **Append-only audit** — every command stages a §3 event on the same transaction via the existing writer.
7. **Rules/index PROPOSAL** — a proposed `firestore.rules` block (§7) and a proposed
   `firestore.indexes.json` addition for the bounded bidirectional queries. **Proposal only**,
   reviewed in-repo; deployed only at D10.
8. **Emulator tests** — §9.

**Not in D4:** production deploy (D10); real file reading / import execution (D11); read service/UI
(D5/D6); installed-asset linkage (D7); Truck Inventory; any downstream consumer.

---

## 7. Direct-client-write denial preserved (all four authorities)

`firestore.rules` denies direct client writes to governed collections today via `allow read, write:
if false;` (e.g. `roleAssignments`, `accessRequests`, `auditEvents`) and the Work-Order precedent
`fieldops_wos` (`allow create, update, delete: if false;` — "All writes go through the … Cloud
Functions … clients are read-only here, unconditionally"). Mutation is possible **only** through the
trusted callables (Admin SDK bypasses Rules; Rules cannot check a live `roleAssignment`/`accessVersion`
or atomically pair a mutation with an audit event — hence enforcement lives in the callable).

The proposed Rules block sets, for all four authorities —
`equipment_models`, `equipment_model_aliases`, `equipment_part_compatibility`,
`equipment_compatibility_sources` — `allow write: if false;` (trusted-writer only) and scopes reads to
the §5 population. Any derived projection also denies direct writes.

---

## 8. Collection schemas, versioning, immutable provenance, conflict visibility, rollback (DESIGN ONLY)

Schemas are the architecture §4 document contracts (unchanged; D4 persists, does not redesign):

- **`equipment_models`** — stable `equipmentModelId` (canonical `manufacturer--model`, D1), identity +
  status + `version` + audit stamps. Trusted-writer only.
- **`equipment_model_aliases`** — deterministic key from source scope + normalized alias; resolves to
  exactly one `equipmentModelId`; alias conflicts fail closed for review (D1 `detectModelAliasConflicts`).
- **`equipment_part_compatibility`** — `compatibilityId` (deterministic opaque hash of the versioned
  normalized uniqueness tuple, D2), `uniquenessKey`, relationship fields, `applicability`,
  `verificationStatus`, `version`, audit stamps.
- **`equipment_compatibility_sources`** — immutable evidence; independent `sourceId`; multiple per relationship.

**Versioning:** each record carries a monotonic integer `version` (D2); mutations use expected-version
optimistic concurrency (§6.4). The uniqueness tuple is itself versioned (`TUPLE_VERSION`, D2) so
identity is stable and re-derivable.

**Immutable provenance:** evidence is append-only and immutable — a changed observed claim or
capture-provenance field is a new record / collision, never an in-place edit (D2
`detectCompatibilitySourceCollisions`; `sourceId` excludes claim/capture fields precisely so a changed
claim cannot masquerade as a replay). Verification is a governed decision **on the relationship**;
evidence is never rewritten.

**Conflict visibility:** contradictory evidence yields a visible `CONFLICT` and is never silently
merged, discarded, or auto-verified (D2 `analyzeCompatibilityEvidenceByRelationship`; precedence only
annotates the strongest authority per side). Reseller / Work-Order evidence stays non-authoritative
and cannot establish verified compatibility.

**Rollback / recovery posture:** D4 is emulator-only → rollback is **revert-by-gate** (revert the PR;
no data effect), the standing pre-deployment convention. The production data path (D11) is where the
write-ahead manifest + reconciliation + no-partial-apply + never-delete-pre-existing-Part/Equipment
posture applies (architecture §9/§10); D4 designs the commands idempotent + transactional so a D11
batch can be replayed/rolled back deterministically.

---

## 9. Emulator verification plan (D4)

All D4 verification runs against the **Firestore emulator** with **zero production access**:

- **Rules tests** (emulator): direct client writes to all four collections **denied**; reads allowed
  only for the §5 population; unauthenticated/suspended/malformed/stale principals fail closed.
- **Trusted-command tests** (emulator, mirroring `functions/test/accessCommandCallables.test.js`'s
  emulator pattern): per-capability permission enforcement; idempotent replay (equivalent = no-op,
  non-equivalent = fail closed, denied-key-stays-denied); expected-version concurrency (mismatch
  denied); referential integrity (unresolved ref denied); conflict surfacing (contradiction →
  `CONFLICT`, never auto-verify); append-only immutability of evidence; and **sanitized / secret-free
  audit output** (`SECRET_LIKE_PATTERN`, ≤500, opaque ids only).
- **No production writes; proposal-before-deploy:** the Rules/index proposal is reviewed as repository
  artifacts; deployment is the separate **D10** gate. Precedent: `docs/Deployment.md` (rules/indexes
  manual-deploy, not in CI, `merged ≠ deployed`); the F-RULES-1 rules-deployment gates
  (`docs/audits/f-rules-1/…`); the INV-CONVERGENCE-E C1/C2 Hosting deploy handoffs (repo →
  emulator/preflight → separate authorize→deploy→verify gate); and the enterprise-access "Row 22
  activation gate / nothing active in production" pattern (ADR-005 / enterprise-access plan).

---

## 10. Genuine Owner decisions remaining (after repository reconciliation)

Everything reconcilable from existing on-main patterns has been reconciled (trusted-writer surface,
audit writer + registry + sanitization, permission catalog + resolver + naming, read population,
`active:false` PENDING mechanism, idempotency/version/provenance/conflict from D1–D3). The decisions
that genuinely require the Owner:

1. **#226 permission approval** — ratify the five capability IDs and their least-privilege role
   carriage (§4–§5) under the #226 security gate. Until then nothing is catalogued-active or granted.
2. **Catalog-entry timing** — register the five as `active:false` in the catalog **now** (D4, reusing
   the repo's registered-but-DENY mechanism) vs. defer all catalog entry to the #226 gate.
3. **Role granularity** — confirm distinct `verify` vs `correct` roles (proposed) vs a single steward;
   and per-run execution-scoped `import` role (proposed, `inventoryCreateExecutor` precedent) vs a
   standing importer role.
4. **Audit registry additions** — approve the six new `AUDIT_ACTIONS` (§3) and the sanitized payload
   contract (opaque ids + bounded secret-scanned reason only).
5. **Projection posture** — include a derived read projection in D4 (with `sourceCompatibilityId` +
   projection version + reconciliation, write-denied) vs. defer all projections to D5+ (architecture §3
   allows deferral until measured need).
6. **Index-proposal scope** — confirm the compound-index set to propose (affects D10 cost/shape), with
   no production query telemetry yet.
7. **Cross-gate deployment dependency (D10, informational)** — D4's *production activation* rides the
   same #226 / Issue #15 Cloud Functions deployment + activation gate ("Row 22") that currently gates
   the access-command callables (present-in-repo, inert until deployed). D4 itself (emulator) is
   independent; confirm D4 targets that same surface and inherits the D10 dependency.

No provider, deployment, production-data, or import-execution decision is requested — those are D10/D11.

---

## 11. What this package explicitly does NOT do

No D4 code; no permission-catalog change; no Rules/Functions/index implementation or deployment; no
Firebase or production access; no real file reading or import execution; no UI or consumer wiring; no
installed-asset linkage; no Truck Inventory. Documentation only, PENDING Owner + #226 approval,
returned for Codex review before merge.
