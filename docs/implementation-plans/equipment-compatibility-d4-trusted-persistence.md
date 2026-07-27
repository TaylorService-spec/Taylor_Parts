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

Documentation-only authorization package for the D4 gate defined verbatim in
`docs/architecture/equipment-part-compatibility.md` §10:

> **D4 — Trusted persistence:** repositories, trusted commands, permission catalog entries, audit,
> Rules/index proposal; emulator only.

It **implements nothing**: no code, no permission-catalog entry, no Firestore Rules, no Cloud
Function, no index, no Firebase or production access. Every proposed permission stays **inactive**
(`active:false`) and **ungranted**; every role mapping is a **future #226 proposal**, not created in
D4. Builds on merged **D0 (#449 / DECISIONS #51), D1 (#450), D2 (#454), D3 (#456, `c0d4fe8`)**.

**Explicit gate separation** (architecture §10):

| Gate | Scope | Environment | This package |
|---|---|---|---|
| **D4** | repositories, trusted commands, permission-catalog *entries* (inactive), audit, Rules **proposal** (client-closed), emulator tests | **emulator only** | designed here (PENDING) |
| **D5** | read model / read service, derived projections, and the exact query shapes + compound indexes those queries need | repo → emulator | **separate gate; out of scope** |
| **D10** | production Rules / index / Functions **deployment** + verification | production | **separate gate; requires its own repository-defined production deployment + verification authorization** |
| **D11** | production data / dry-run-reviewed **import execution**, one bounded batch, reconciliation + rollback | production | **separate gate; out of scope** |

D4 never deploys and never touches production — `merged ≠ deployed` (`docs/Deployment.md`:
`firestore.rules` and `firestore.indexes` are "not deployed by any CI workflow … no effect on the
live project until manually deployed").

---

## 1. Reused PATTERNS — a SEPARATE Equipment command orchestrator (not the access orchestrator)

The existing access-mutation orchestrator `runAccessMutationCommand` in
`functions/src/access/trustedWriterCommands.ts` is **specialized for authorization changes**: it reads
and increments `users/{uid}.accessVersion` and synchronizes Auth custom claims. Equipment
compatibility persistence must **not** touch `accessVersion` or Auth claims, so D4 does **not** reuse
that orchestrator and does **not** add commands to the access-mutation surface.

Instead, D4 specifies a **separate Equipment command orchestrator** (emulator-only, Admin-SDK,
server-only) that **reuses the proven patterns** without the identity side effects:

| Reused pattern | Source precedent (on-main) | Equipment orchestrator |
|---|---|---|
| authenticated actor identity | `accessCommandCallables.ts` (`actorUid` from `request.auth.uid` only) | same — actor from auth context only |
| effective-permission resolution | `resolveEffectivePermission.ts` (pure, fail-closed) | same resolver; **no accessVersion mutation** |
| durable idempotency | audit-doc-id existence as "alreadyApplied" | a **separate operation record** keyed by `idempotencyKey` (§2) |
| expected-version handling | `runAccessMutationCommand` read-increment-in-txn | applied to the **compatibility record's own `version`** (D2), never `accessVersion` |
| transaction boundaries | write + audit in one `db.runTransaction` | same atomic boundary (record + operation + audit) |
| sanitized audit | `auditEventWriter.ts` | same writer (§2–§3) |
| safe callable errors | `mapCommandError` → `HttpsError` | same typed-error → safe-`HttpsError` mapping |

**D4 decision:** Equipment compatibility is mutated **only** through this separate orchestrator and its
callables — reusing actor/permission/idempotency/version/transaction/audit/error patterns, and
changing **no** `accessVersion` and **no** Auth claim.

---

## 2. Reused audit sink + a separate append-only operation record

- **Audit writer (reused unchanged):** `functions/src/access/auditEventWriter.ts` → collection
  `auditEvents`. `stageAuditEvent` / `stageAuditEventWithId` stage a create onto the **same
  transaction** as the business mutation (atomic); **no update/delete** by design (append-only). The
  event schema is `{ at, actorUid, action, targetType, targetId, outcome: "applied" | "denied",
  summary, scope?, approverUid?, … }`, with `action` enforced against the strict `AUDIT_ACTIONS`
  registry and `summary` guarded by `SECRET_LIKE_PATTERN` + `MAX_SUMMARY_LENGTH = 500` and **no
  free-form `details`/`notes` map**.
- **The writer's `outcome` field supports only `applied` or `denied`** and therefore cannot itself
  represent a durable *initiation* event; the writer also does not accept `idempotencyKey`,
  `expectedVersion`, or `resultVersion` fields.

**Chosen governed approach for command/version state — approach (b): a separate operation record.**
D4 adds a governed, **client-closed, append-only** operation ledger (proposed collection
`equipment_compatibility_operations`) that holds command/version state — `idempotencyKey` (the doc id),
`actorUid`, a bounded command fingerprint (action + target opaque id + tuple hash), `expectedVersion`,
`resultVersion`, lifecycle `status` (`initiated` → `applied` | `denied`), and timestamps. This keeps
the shared `auditEventWriter.ts` **schema unchanged** (no unsupported fields are claimed to exist on
it) and stores idempotency + expected/result version durably in the operation record, while audit
events carry only approved bounded facts. Raw evidence, serial lists, source contents, credentials, and
unbounded notes remain **prohibited** from both the operation record and the audit events.

---

## 3. Audit lifecycle — five SEPARATE append-only events, each at its boundary

Each event is a distinct, durably-written, append-only record at the appropriate boundary — initiation
and final outcome are **never** one event:

| Lifecycle event | Where durably written | New `AUDIT_ACTIONS` entry (proposed) | `outcome` |
|---|---|---|---|
| **command initiation** | operation record created with `status:initiated` (append-only) at command entry, **before** the mutation attempt | *(operation ledger; not an `auditEvents` action)* | n/a |
| **applied / denied outcome** | one `auditEvents` write at the commit / deny boundary | `equipmentCompatibilityCommand` | `applied` \| `denied` |
| **surfaced conflict** | one `auditEvents` write when a relationship enters/holds `CONFLICT` | `equipmentCompatibilityConflict` | `applied` |
| **verification change** | one `auditEvents` write on a `verificationStatus` transition | `equipmentCompatibilityVerification` | `applied` \| `denied` |
| **correction** | one `auditEvents` write on a governed correction | `equipmentCompatibilityCorrection` | `applied` \| `denied` |

The operation record's terminal `status` (`applied`/`denied`) and the `auditEvents` outcome event are
written in the **same transaction** as the record mutation, so initiation is durable independently of
the terminal outcome. **No `rebuildCompatibilityProjection` action exists in D4** — projection audit
actions are deferred with the projection work (§7).

**Sanitized payload contract (mandatory):** `targetType` ∈ the four authorities; `targetId` is the
**opaque id only** (`equipmentModelId` canonical / `compatibilityId` = `cmp_…` / `sourceId` = `src_…`);
`summary` is a bounded, secret-scanned reason phrase (≤500). Command/version/idempotency state lives in
the operation record, not the audit event. **Never** raw source contents, serial values/lists,
credentials, private identifiers, or unbounded notes.

---

## 4. Permission reconciliation (§8; registered INACTIVE only, PENDING #226)

- **Catalog:** `functions/src/access/permissionCatalog.ts` (mirror `field-ops-app-vite/src/access/permissionCatalog.ts`)
  — frozen `PERMISSION_CATALOG` of `{ id, description, resource, action, active? }`; ids validated by
  `PERMISSION_ID_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/` (dotted lower-camel; colons
  unused). **`active: false` = registered-but-not-grantable (hard DENY).**
- **Resolver:** `functions/src/access/resolveEffectivePermission.ts` — pure, fail-closed; `active:false`
  → DENY `inactivePermission`; `operationalRoles` / `employmentStatus` enter only via `ConditionContext`.

The five proposed capabilities satisfy `PERMISSION_ID_PATTERN` and, **if** catalogued in D4, are
registered **`active:false` only** (a hard DENY that grants nothing); D4 **does not activate them and
adds no role grant**:

| Capability (`id`) | `resource` | `action` | Purpose |
|---|---|---|---|
| `equipment.compatibility.view` | `equipment.compatibility` | `view` | future read-service read (D5) — **no client read exists in D4** |
| `equipment.compatibility.import` | `equipment.compatibility` | `import` | trusted-command write |
| `equipment.compatibility.verify` | `equipment.compatibility` | `verify` | trusted-command write |
| `equipment.compatibility.correct` | `equipment.compatibility` | `correct` | trusted-command write |
| `equipment.model.manage` | `equipment.model` | `manage` | trusted-command write |

Activation and any grant are the separate **#226** security gate. Production catalog state remains
**deny-by-default**.

---

## 5. Role posture in D4 — no roles created; technician denied

**D4 creates no roles and grants nothing.** Dedicated verifier, corrector, model-steward, and importer
roles are **not authorized** and must not be created in D4. `PARTS_MANAGER` and `WAREHOUSE_MANAGER`
remain **operationalRoles**, not new security roles.

- **Positive emulator command tests** exercise authorized paths via an **injected, emulator-only
  permission-resolution fixture** (a test double for `resolveEffectivePermission`), never by creating a
  real role or grant. Production catalog/resolver state stays deny-by-default.
- **Technician posture (preserved):** bare technician → **denied**; technician **with** an operational
  role → **still denied** broad client compatibility reads; any future work-order-scoped technician
  view is **deferred to a separate gate** with its own authorization model.
- **No client reads in D4 at all** (§7): the `view` capability maps to no client Rules path here; the
  read population (admin / dispatcher / active PARTS_MANAGER / active WAREHOUSE_MANAGER, architecture
  §8) is a **future read-service (D5) proposal**, wired only after that gate's authorization model and
  query contract are approved.

A future least-privilege role mapping (for #226 to consider at D5+) is recorded in the architecture
§8; it is **not** part of D4.

---

## 6. Exact D4 emulator-only persistence scope

Implemented against the **Firestore emulator only**, in reviewable repository artifacts:

1. **Repositories** — typed adapters for the four authorities delegating ALL validation/identity to the
   merged D1/D2 pure contracts (`validateEquipmentModel`, `validateEquipmentModelAlias`,
   `validateCompatibility`, `validateCompatibilitySource`, `buildCompatibilityId` /
   `buildCompatibilityUniquenessKey`, `recordFingerprint`). No re-implemented identity.
2. **Trusted commands** (separate Equipment orchestrator, §1): import/upsert models, aliases,
   relationships, evidence; verify; correct. **No projection-rebuild command in D4** (§7).
3. **Idempotency** — deterministic `idempotencyKey` = the operation-record doc id; existence = a no-op
   "already applied"; a reused key with a different command fingerprint fails closed; a `denied`
   operation never becomes `applied`. Exact-equivalent replay = no-op success; non-equivalent = fail
   closed (D2/D3 collision contract, now transactional).
4. **Expected-version handling** — optimistic concurrency on the **compatibility record's own `version`**
   (D2): read-check-increment inside the transaction; mismatch fails closed. Never `accessVersion`.
5. **Referential-integrity checks** — every `partId` / `equipmentModelId` / `compatibilityId` resolves
   against the authoritative collections **in-transaction**; aliases cannot create models; sources
   cannot create relationships; unresolved → deny (D3 resolution contract, at write time).
6. **Append-only audit + operation record** — every command writes the §3 events in the same transaction.
7. **Rules proposal (client-closed) + NO compound indexes** — a proposed `firestore.rules` block that
   **denies all direct client reads and writes** to the four authorities and the operation ledger (§7).
   **No compound indexes are proposed or required for D4**: the trusted commands use point access by
   document id; derived projections and the compound indexes their query shapes need are **deferred to
   D5** (§7).
8. **Emulator tests** — §9.

**Not in D4:** production deploy (D10); real file reading / import execution (D11); read service,
projections, or client reads (D5); UI (D6); installed-asset linkage (D7); Truck Inventory; any
downstream consumer.

---

## 7. Client-closed collections; projections + indexes deferred

Firestore Rules **cannot invoke** the server-side #226 effective-permission resolver, so D4 does not
attempt governed client reads. The D4 Rules proposal **denies all direct client reads and writes** to
all four authorities and the operation ledger:

- `equipment_models`
- `equipment_model_aliases`
- `equipment_part_compatibility`
- `equipment_compatibility_sources`
- `equipment_compatibility_operations` (operation ledger)

i.e. `allow read, write: if false;` for each — matching the on-main precedent for `roleAssignments` /
`auditEvents` (`allow read, write: if false;`) and the Work-Order collection ("all writes go through
the … Cloud Functions … clients are read-only here"). Trusted **emulator** commands use Admin-SDK
access (which bypasses Rules). **Opening any governed client read belongs to a later read-service /
projection gate (D5)** after its authorization model and query contract are approved.

**Derived projections and compound indexes are deferred to D5.** D4 documents that **no compound
indexes are presently proposed or required** for its trusted point-access command tests.

---

## 8. Collection schemas, versioning, immutable provenance, conflict visibility, rollback (DESIGN ONLY)

Schemas are the architecture §4 document contracts (unchanged; D4 persists, does not redesign):

- **`equipment_models`** — stable `equipmentModelId` (canonical `manufacturer--model`, D1), identity +
  status + `version` + audit stamps.
- **`equipment_model_aliases`** — deterministic key from source scope + normalized alias; resolves to
  exactly one `equipmentModelId`; alias conflicts fail closed for review (D1 `detectModelAliasConflicts`).
- **`equipment_part_compatibility`** — `compatibilityId` (deterministic opaque hash of the versioned
  normalized uniqueness tuple, D2), `uniquenessKey`, relationship fields, `applicability`,
  `verificationStatus`, `version`, audit stamps.
- **`equipment_compatibility_sources`** — immutable evidence; independent `sourceId`; multiple per relationship.
- **`equipment_compatibility_operations`** — append-only command/idempotency/version ledger (§2), client-closed.

**Versioning:** each record carries a monotonic integer `version` (D2); mutations use expected-version
optimistic concurrency (§6.4). The uniqueness tuple is itself versioned (`TUPLE_VERSION`, D2).

**Immutable provenance:** evidence is append-only and immutable — a changed observed claim or
capture-provenance field is a new record / collision, never an in-place edit (D2
`detectCompatibilitySourceCollisions`; `sourceId` excludes claim/capture fields precisely so a changed
claim cannot masquerade as a replay). Verification is a governed decision **on the relationship**.

**Conflict visibility:** contradictory evidence yields a visible `CONFLICT`, never silently merged,
discarded, or auto-verified (D2 `analyzeCompatibilityEvidenceByRelationship`; precedence only annotates
the strongest authority per side). Reseller / Work-Order evidence stays non-authoritative.

**Rollback / recovery posture:** D4 is emulator-only → rollback is **revert-by-gate** (revert the PR;
no data effect). The production data path (D11) is where the write-ahead manifest + reconciliation +
no-partial-apply + never-delete-pre-existing-Part/Equipment posture applies (architecture §9/§10); D4
designs the commands idempotent + transactional so a D11 batch can be replayed/rolled back deterministically.

---

## 9. Emulator verification plan (D4)

All D4 verification runs against the **Firestore emulator** with **zero production access**:

- **Rules tests** (emulator): direct client **reads and writes** to all four authorities and the
  operation ledger are **denied** for every principal (signed-out / technician / admin / dispatcher /
  operational-role holders alike) — D4 exposes no governed client read.
- **Trusted-command tests** (emulator; mirroring the emulator pattern of
  `functions/test/accessCommandCallables.test.js`), authorizing paths via an **injected permission-
  resolution fixture** (§5): per-capability permission enforcement; separate durable **initiation** vs
  terminal **outcome** events (§3); idempotent replay (equivalent = no-op, non-equivalent = fail closed,
  denied-operation-stays-denied); expected-version concurrency on the record `version` (mismatch
  denied); referential integrity (unresolved ref denied); conflict surfacing (contradiction →
  `CONFLICT`, never auto-verify) with its own audit event; append-only immutability of evidence and of
  the operation ledger; and **sanitized / secret-free audit output** (`SECRET_LIKE_PATTERN`, ≤500,
  opaque ids only).
- **No production writes; proposal-before-deploy.** The client-closed Rules proposal is reviewed as a
  repository artifact; **no compound index is proposed** (deferred to D5). Production deployment is the
  separate **D10** gate, which **requires its own repository-defined production deployment and
  verification authorization** (no automatic linkage to any prior deployment gate). Precedent for the
  repository/emulator → separate-production-gate split: `docs/Deployment.md` (rules/indexes
  manual-deploy, not in CI, `merged ≠ deployed`); the F-RULES-1 rules-deployment gates
  (`docs/audits/f-rules-1/…`); the INV-CONVERGENCE-E C1/C2 Hosting deploy handoffs.

---

## 10. Recommended safe defaults + the single remaining Owner decision

After reconciliation, this package **recommends** the safe defaults below; nothing beyond them is
proposed:

- Separate Equipment command orchestrator (no `accessVersion`/claims mutation) — §1.
- Reuse the audit writer unchanged; add a separate append-only operation record; five distinct
  lifecycle events; no projection audit action — §2–§3.
- Register the five capabilities `active:false` only (or defer catalog entry to #226); **no activation,
  no role grants, no new roles**; technician denied; positive tests via an injected fixture — §4–§5.
- Client-closed Rules for all four authorities + the operation ledger; **no compound indexes**;
  projections + indexes deferred to D5 — §6–§7.
- D10 (production deployment) and D11 (production import) remain separate gates, each with its own
  repository-defined authorization — §0.

**The single genuine Owner decision:** **approve or reject the corrected D4 boundary above.** No
provider, deployment, production-data, import-execution, permission-activation, role-grant, projection,
or index decision is requested here — those live in #226 / D5 / D10 / D11.

---

## 11. What this package explicitly does NOT do

No D4 code; no permission-catalog change; no permission activation or role grant; no Rules/Functions/
index implementation or deployment; no Firebase or production access; no real file reading or import
execution; no read service, projection, or client read; no UI or consumer wiring; no installed-asset
linkage; no Truck Inventory; no Customer/Auth work. Documentation only, PENDING Owner approval,
returned for Codex review before merge.
