---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft -- pending review and merge (Task 4 of the Issue #226 governing execution program)
date: 2026-07-15
owner: Claude Code (Inventory/Platform)
related_adrs: [docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md]
depends_on: [docs/specifications/enterprise-access-and-administration-platform.md, docs/assessments/enterprise-access-and-administration-platform.md, docs/implementation-plans/inventory-nav-access-alignment.md]
implements: [docs/specifications/enterprise-access-and-administration-platform.md]
supersedes: []
superseded_by: []
related_pr:
target_release: TBD
---

# Implementation Plan: Enterprise Access & Administration Platform

**Derived from:** the Owner-approved **[ADR-005](../architecture/ADR-005-enterprise-authorization-migration-strategy.md)** (Option D — Hybrid Compatibility Model), the merged **[Specification](../specifications/enterprise-access-and-administration-platform.md)** (contracts only, no implementation authorized), the merged **[Assessment](../assessments/enterprise-access-and-administration-platform.md)** (PR #229, current-state audit), current production behavior, and Issue #100's completed production evidence (`docs/implementation-plans/inventory-nav-access-alignment.md`, all seven PRs merged, PR 1a/2a/3a Rules confirmed live). Tracking issue: **#226**.

**This Implementation Plan authorizes NO implementation.** It orders and bounds the PR sequence the Specification's contracts require; it creates no collection, Rule, Function, index, claim, route, or production-data change itself. Each PR named below requires its own review appropriate to its content (docs-only PRs may merge under standing authority; Rules/Functions/production-adjacent PRs require the Owner's explicit merge go-ahead per the current session's merge-authority decision) plus, where the Specification's §12/§17 boundary applies, its own separate Owner Deployment Authorization before any production activation. Issue #226 stays **OPEN/In Progress** through and beyond this Plan's merge.

Verified against `origin/main` @ `3e1152b97520c462db3f1f3aa9a58fd0d6f2d363`. Path convention: `firestore.rules`, `functions/…`, `docs/…` are repo-root-relative; `src/…` is relative to `field-ops-app-vite/`.

---

## 1. What this Plan fixes vs. what remains a later gate

This Plan fixes: the bounded PR sequence (§3), object/storage ownership (§4), permission catalog ownership (§5), compatibility-mapping ownership (§6), the resolver + precedence implementation shape (§7), the Rules-vs-trusted-Function enforcement split per surface (§8), the `accessVersion`/compact-claims implementation shape (§9), the immutable Audit Event storage/writer shape (§10), Admin portal integration order (§11), prototype reconciliation process (§12), domain migration order (§13), shadow/parity mode mechanics (§14), rollback/break-glass procedure (§15), production deployment/verification sequencing (§16), legacy-role retirement sequencing (§17), and Project/document reconciliation (§18).

This Plan does **not** decide anything the Specification or ADR-005 left open: the full approval matrix beyond §15's principles, the tenant/company model (#140), complex builders, the Access Request UI, impersonation, or the exact retirement date. Those remain separately-authorized future gates.

## 2. Non-negotiable invariants (carried from ADR-005 / Specification, binding on every task below)

- `admin`/`dispatcher`/`technician` behavior stays byte-for-byte compatible until a domain's parity is proven and that domain flips (Spec §18/§19).
- `operationalRoles` never become security Permissions; they surface only as Conditions (Spec §9).
- Claims carry only `companyId`/`platformAdmin`/`companyAdmin`/`accessVersion` — never detailed permissions/Scopes/Conditions (Spec §11).
- Firestore Rules are authoritative for client-direct access; trusted Cloud Functions are authoritative for sensitive/administrative/approval/financial/audited mutations (Spec §12).
- Every enforcement point fails closed on missing/stale/malformed/unavailable access data (Spec §13).
- Every grant/revoke/assignment/enable-disable/approval/rejection emits exactly one immutable Audit Event (Spec §14).
- Trusted-writer activation, Admin-portal mutations, claims changes, access approvals, and production authorization enforcement are **blocked until Issue #15's Cloud Functions are deployed and verified** (ADR-005 §2.6, Spec §17). Architecture, Specification, this Plan, pure-logic modules, and non-authoritative shadow/parity testing may proceed now.
- Issue #100 operational-role behavior and Issue #175 governed-field enforcement are preserved exactly throughout (Spec §7/§9, ADR-005 §2.1/§4).
- No break-glass UI; break-glass stays an operator-script-only, audited procedure (Spec §20).

## 3. Bounded PR sequence (maps to the governing program's Tasks 6-33)

Each row is one or more bounded PRs. "Authority" marks whether it is mergeable under standing docs/UI authority or requires the Owner's explicit go-ahead per this session's merge-authority decision.

| # | PR(s) | Content | Spec §§ | Authority |
|---|---|---|---|---|
| 1 | Permission catalog & governed types (Task 6) | `Permission`/`Role`/`RoleAssignment`/`Scope`/`Condition`/`ApprovalPolicy`/`AccessRequest`/`AuditEvent` type contracts + stable id catalog; no runtime behavior change | §5, §6 | Docs/types-only — self-mergeable |
| 2 | Compatibility mappings + pure resolver (Task 7) | Seeded admin/dispatcher/technician Role→Permission mappings; §8 resolver as a dependency-free pure module; exhaustive unit tests | §7, §8, §9 | App-code, no Rules/Functions/prod — self-mergeable after review |
| 3 | Governed storage & Rules foundation (Task 8) | New collections' Rules (client-write-denied for Role/Permission/assignment/Audit); tenant-seam fields inert; full Rules Regression green | §5, §10, §12, §13 | **Rules — hold for Owner go-ahead** |
| 4 | Shadow/parity mode (Task 9) | Non-authoritative dual-evaluation + comparison harness; parity fixtures for every persona/operational-role combo | §18, §21 P1-P3 | App-code, non-authoritative — self-mergeable after review |
| 5 | Immutable Audit Service (Task 10) | Trusted writer + read model for Audit Events; append-only, secret-free | §5.8, §14 | **Functions — hold for Owner go-ahead**; inert until #15 |
| 6 | accessVersion + compact claims (Task 11) | Claims model, refresh/stale-token fail-closed, rollback, emulator tests; **not activated in production** | §11 | **Functions/claims — hold for Owner go-ahead**; inert until #15 |
| 7 | Trusted-writer commands (Task 12) | `grantRole`/`revokeRole`/`assignApprovedRole`/`setUserStatus`/`approveAccessRequest`/`rejectAccessRequest`; separation-of-duty, idempotency | §15 | **Functions — hold for Owner go-ahead**; merges but stays inactive until #15 deployment is authorized |
| 8 | Operator-script parity (Task 13) | Update Admin-SDK scripts to the same validation/audit/break-glass contract | §17, §20 | **Owner-authorized operator scripts — hold for Owner go-ahead** |
| 9 | Prototype reconciliation record (Task 14) | Adopt/adapt/defer/reject mapping for every prototype area; no mock data or wholesale replacement | §3, §16 (ADR §2.5) | Docs-only — self-mergeable |
| 10 | Admin portal foundation (Task 15) | Administration top-level nav + MVP surfaces (Overview, Users, Roles & Permissions, Permission Preview, Audit History) using existing patterns | §16 | App-code, presentation-only — self-mergeable after review |
| 11 | Read-only Admin MVP (Task 16) | Status/Role display, effective-permission preview, denial explanation, read-only audit history; no client-direct writes | §16 | App-code, read-only — self-mergeable after review |
| 12 | Admin mutation UI (Task 17) | UI calling only trusted-writer contracts; actions visibly unavailable until #15 Functions are deployed+verified | §16 | App-code, but gated inert — self-mergeable; **activation is a separate Owner gate** |
| 13-15 | Domain shadow migration: Customer (18), Inventory (19), Service (20) | Per-domain mapping + parity tests, legacy stays authoritative | §19, §21 | App-code/tests, non-authoritative — self-mergeable after review |
| 16 | Navigation/shared UI (Task 21) | Permission-preview helpers replace scattered UI-only role checks; legacy fallback retained; own display-parity check against the same fixture set (no Rules surface — presentation only, never authoritative per §12) | §12 | App-code, presentation-only — self-mergeable after review |
| 17 | Complete parity review (Task 22) | 100% expected-outcome parity report per persona/action; drift resolved or explicitly deferred | §21 | Docs-only — self-mergeable |
| 18 | Consolidated review package (Task 23) | Owner checkpoint report | — | Docs-only — self-mergeable; checkpoint, not a stop |
| 19 | Production authorization request (Task 24) | Explicit scope-of-deployment request | — | **Owner decision, not a PR** |
| 20 | Deploy trusted backend (Task 25) | Deployment of PR 5/6/7 surfaces only, post-authorization | — | **Production deployment — Owner-executed or Owner-witnessed** |
| 21 | Production foundation verification (Task 26) | Dedicated-fixture verification of trusted commands/claims/audit/break-glass in production | §21 V1 | **Production verification — hold for Owner go-ahead** |
| 22 | Enable admin mutations (Task 27) | Activate PR 12's UI against verified production Functions | §16 | **Production activation — Owner-authorized** |
| 23-25 | Domain enforcement cutovers (Task 28, 1-3): Customer, Inventory, Service | One domain at a time, smallest boundary (Rules and/or trusted-Function flip per §12), immediate rollback on regression | §19, §21 | **Production Rules/enforcement flips — Owner-authorized per domain** |
| 26 | Navigation/shared-UI cutover (Task 28, 4) | Switch coarse UI/nav gating from the legacy mirror to the Permission-engine mirror built in row 16; **not a Rules/enforcement flip** — nav gating stays presentation-only per §12, so this row activates row 16's already-merged helper as the UI's primary source, with the legacy check retained as fallback | §12, §19 | App-code, presentation-only — self-mergeable after the three domain cutovers (23-25) it visually depends on are live |
| 27 | Retirement readiness review (Task 29) | Proof of all 12 ADR-005 §2.7 criteria | §21 | Docs-only — self-mergeable; **Owner confirms retirement timing** |
| 28 | Retire raw role authority (Task 30) | Remove hard-coded role checks outside the compatibility boundary | §7, §21 | **App-code + Rules — Owner-authorized, post-readiness-review** |
| 29 | Full release verification (Task 31) | Complete suite/build/Rules-regression/browser/accessibility/rollback verification | — | Verification only |
| 30 | Document reconciliation (Task 32) | Update current-state docs; no historical-Assessment rewrites | — | Docs-only — self-mergeable |
| 31 | Close Issue #226 (Task 33) | Final closeout, only when every closure criterion is met | — | Issue action, not a PR |

Each PR is independently revertible (Spec §18 rollback invariant); no PR in rows 13-26 activates production enforcement without the specific Owner authorization named in that row (rows 16/26 are the sole exception, since navigation gating is presentation-only and never an enforcement authority per §12).

## 4. Object/storage ownership

| Object (Spec §5) | Collection (proposed) | Owner module |
|---|---|---|
| Permission | `permissions/{permissionId}` (repository-seeded, trusted-writer-only) | `functions/src/access/` (new) |
| Role | `roles/{roleId}` (seed set ships with PR 1; compatibility Roles `systemSeed:true`) | `functions/src/access/` |
| Role assignment | `roleAssignments/{assignmentId}` | `functions/src/access/` (trusted writer, PR 7) |
| Scope | embedded on Role assignment; no standalone collection | `functions/src/access/` |
| Condition | embedded on Role→Permission mapping (repository-declared) | `functions/src/access/` |
| Approval Policy | repository-declared config, not a client-readable collection in MVP | `functions/src/access/` |
| Access Request | `accessRequests/{requestId}` (record contract only; workflow deferred) | `functions/src/access/` |
| Audit Event | `auditEvents/{eventId}` (append-only, trusted-writer-only) | `functions/src/audit/` (new), read model in `src/modules/administration/` |

Client app code (`field-ops-app-vite/src/modules/administration/`, already scaffolded) owns presentation only — it never writes these collections directly (Spec §5 "no client-direct write" invariants, all objects).

## 5. Permission catalog ownership

- The `PermissionId` namespace (Spec §6, `<domain>.<resource>.<action>`) is repository-declared in a single source file (`functions/src/access/permissionCatalog.ts`, mirrored read-only into client code for the Permission Preview surface) — no second source of truth.
- Each governed domain (Customer, Inventory, Service, Admin) owns proposing its own ids in its own domain-migration PR (rows 13-15); Platform/Inventory (this Plan's owner) owns the catalog module's structure and the immutability/deprecation rule (Spec §6) at review time.
- Deprecation is additive only (`deprecated: true` + successor id) — enforced by a unit test diffing the catalog against its previous published version.

## 6. Compatibility mappings

- The three compatibility Roles' Permission sets (PR 2) are derived directly from the Assessment's Inventory domain audit table (§"Rules grants by operational role") and the equivalent Customer/Service current-state matrices, reproducing every existing grant/denial exactly — including the explicit non-grants (no operational role gets Approve/Reject/Cancel/Void; WAREHOUSE_MANAGER has no `reorder_requests` read).
- This mapping is the parity oracle (Spec §7): every subsequent shadow-mode comparison (row 4, 13-15) is scored against it, not against a re-derived interpretation.

## 7. Resolver and precedence

- `functions/src/access/resolveEffectivePermission.ts` (or equivalent client-safe pure module, since Rules `get()` cannot execute an arbitrary function — the same logic is expressed twice: once as a pure TS module for Functions/tests/Admin-portal-preview, once as Rules helper predicates for client-direct enforcement) implements Spec §8 exactly: collect active, `accessVersion`-consistent assignments → union Permission ids → filter by Scope+Condition match → allow iff ≥1 qualifying grant.
- Precedence ordering (`ownAssignment < location < domain < tenant < global`, tie-break by `PermissionId` then `grantedAt`) is used only for audit-log narrowest-basis attribution in MVP (no overrides/deny-permissions exist yet per Spec §8.5).
- The resolver ships with exhaustive allow/deny unit tests per seeded Role (Spec §21 A1) before any Rules/Functions surface consumes it (row 2 precedes rows 3/5/7).

## 8. Rules vs. trusted-Function enforcement split

Directly from Spec §12's table — this Plan assigns each to its PR:

- **Client-direct reads/writes** (reorder queue reads, own-assignment updates, Permission Preview reads): Firestore Rules, authored in row 3, using `get()` on assignments+Role definitions plus `accessVersion` freshness — never a client-side-only check.
- **Sensitive/administrative/approval/financial/audited mutations**: trusted Cloud Functions, rows 5/7, gated on Issue #15 deployment (row 20) before activation.
- **Coarse UI/nav gating**: presentation-only client mirror (row 16), exactly mirroring `navConfig.js`'s existing convention — never treated as an authority in review.

## 9. accessVersion and compact claims

- Claims minted/refreshed only by trusted writers (row 7) on any access change; the four-field cap (Spec §11) is enforced by a unit test asserting no other claim key is ever set.
- Row 6 builds the claims lifecycle (mint, refresh, force-refresh-on-`accessVersion`-bump, stale-token fail-closed comparison) in the emulator only; production activation is explicitly deferred to row 22, post-Issue-#15.
- Rollback: reverting row 6/7 leaves the existing session-based resolution path (`AuthContext`/`resolveEmployeeSession`) untouched and authoritative — claims are additive, never a replacement for the current document read, until a domain explicitly cuts over (rows 23-26).

## 10. Immutable Audit Events

- Row 5 builds the writer (append-only, no update/delete Rules-denied to every principal including admins) and a read model consumed by row 11's Admin Portal Audit History surface.
- Every command in row 7 calls the row-5 writer synchronously with its own mutation (atomic mutation+audit write, Spec §5.8/§14) — no command ships without its Audit Event call in the same PR.

## 11. Admin portal integration order

Foundation (row 10) → read-only MVP (row 11) → mutation UI wired to trusted commands but inert (row 12) → activation only after row 21's production verification (row 22). This mirrors ADR-005 §2.5's MVP boundary exactly: no permission/Role-definition builders, no custom Scope/Condition builders, no direct overrides, no approval-policy editor, no claims administration, no break-glass administration, no bulk migration, no Access Request UI, no AI administration, no impersonation — all remain out of scope for every row in this Plan.

## 12. Prototype reconciliation

- Row 9 is a docs-only adopt/adapt/defer/reject table covering every screen/pattern in the existing Admin prototype (`field-ops-app-vite/src/modules/administration/`, already scaffolded on `main`), each mapped against ADR-005 §2.5/Spec §16.
- Hard rule carried into every subsequent Admin-portal row: no prototype mock data becomes production data; no prototype component replaces `App.jsx`/nav/shared CSS wholesale; no prototype route/gate is weaker than the Permission Preview's real fail-closed behavior; no surface implies a capability (e.g. impersonation, bulk edit) that does not actually work.

## 13. Domain migration order

Customer/Account (row 13) → Inventory/Reorder/Purchasing (row 14) → Service/Work Orders (row 15) → Navigation/shared UI (row 16), per ADR-005 §4/Spec §19's stated order. For the three Rules/Function-authoritative domains (Customer, Inventory, Service): seed mapping → shadow parity (row 4's harness) → (later, post-#15) flip enforcement → verify → proceed; no domain's cutover (rows 23-25) is scheduled before its own shadow parity (rows 13-15) is 100% green. Navigation/shared UI (row 16/26) has no Rules surface to flip (§12) — its own "cutover" (row 26) is switching the UI's presentation mirror to the Permission-engine helper, gated on the three domain cutovers it visually reflects being live, not on a parity-blocked Rules flip of its own.

## 14. Shadow/parity mode

- Row 4 builds one harness, reused by rows 13-15: for a representative fixture set (every persona × operational-role combo × inactive/broken-linkage/governed-field case, extending the existing Issue #100 driver.mjs fixtures rather than duplicating them), evaluate legacy checks and the row-2 resolver side by side, log+compare, enforce nothing, expose no raw ids/tokens/internals in any output.
- A parity mismatch blocks that domain's row 23-26 cutover, not the rest of the program — matching Spec §19's "a failed domain never blocks or silently alters another."

## 15. Rollback and break-glass

- Every row 3/5/6/7/23-26 PR includes a documented, tested rollback runbook (Spec §21 R1) as part of its own PR body, not a separate future task.
- Break-glass (Spec §20): a controlled, Owner-authorized operator Admin-SDK procedure restoring a platform-admin assignment and resetting `accessVersion`, built alongside row 7's writer contracts (same trust class), audited via row 5, exercised (not merely described) during row 21's production foundation verification. No break-glass UI is ever added, in this Plan or after.

## 16. Production deployment and verification

Rows 19-22 implement Spec §21 V1 exactly: explicit Owner authorization naming the exact commit/Functions/Rules/indexes/claims-bootstrap/project (row 19) → deploy only that authorized surface (row 20) → dedicated-fixture, fail-closed-cleanup verification of every §21 Security criterion in production (row 21) → only then enable Admin mutations (row 22). No row 23-26 domain cutover is authorized before row 21 passes.

**Correction (deployment-candidate PR, 2026-07-16):** Row 7's original text ("Trusted-writer commands ... merges but stays inactive until #15 deployment is authorized") scoped only writing and testing the six command FUNCTIONS themselves (`functions/src/access/trustedWriterCommands.ts`) -- it did not explicitly authorize or scope a distinct callable-export/adapter step, so no deployable candidate for row 20 actually existed yet even after row 7 merged. That gap is now resolved: `functions/src/access/accessCommandCallables.ts` provides six thin, independently-reviewed `onCall` adapters (deriving `actorUid` exclusively from authenticated server context, mapping every command error to a safe public `HttpsError`) and `functions/src/index.ts` now exports exactly these six alongside the pre-existing Issue #15 Work Order exports. See `docs/deployment/enterprise-access-deployment-manifest.md` for the exact Section B deployment surface this candidate provides. Per the Owner's own authorization for this candidate: merging this code is not a production action -- it does not advance row 20, activate anything, or substitute for the row 19 Owner production authorization this section still requires.

**Correction (Issue #15 / Row 20 sequencing reconciliation, 2026-07-16):** the Owner's "ROW 19 HELD FOR DEPLOYMENT-CANDIDATE CORRECTION" response also asked for an audited reconciliation of exactly what row 20 would deploy relative to Issue #15. `docs/deployment/enterprise-access-deployment-manifest.md` Section C now records: the six Section B callables are technically deployable independently of Issue #15's three Functions (Firebase's `--only functions:<name>` targeting touches only the named Functions, and the six callables use the Admin SDK exclusively with no dependency on Issue #15's Rules); however, ADR-005 §2.6 and Spec §17 already gate "trusted-writer activation... claims changes, access approvals, and production authorization enforcement" on Issue #15's Cloud Functions being deployed and verified, regardless of that technical independence -- this reconciliation surfaces the fact, it does not relitigate or lift that gate. Row 20 authorization still requires the Owner's own judgment on how row 19/20 interact with Issue #15's still-OPEN status.

## 17. Legacy-role retirement sequencing

Row 27 proves all 12 ADR-005 §2.7 criteria with citations (not assertions); row 28 removes hard-coded role authority only after row 27 passes and the Owner confirms retirement timing if ADR-005 still requires a separate confirmation. Compatibility labels (`admin`/`dispatcher`/`technician` as configurable Role names) may persist for display/migration per ADR-005 §2.7's closing sentence; authentication identity, operational eligibility, and historical audit references are never removed.

## 18. Project/document reconciliation

- Every PR in §3 is added to Taylor Freezer at open time (issue + PR), consistent with this session's established convention.
- Row 30 updates authorized current-state documents only (architecture-implemented status, production-activation record, legacy-role outcome, deferred-scope record, operational support/audit/recovery procedures) — it does not rewrite the Assessment or Specification as if they were current-state reports (Task 32's explicit prohibition, honored here).
- Row 31 closes Issue #226 only when every Task 33 closure criterion is independently true; this Plan does not pre-close it and does not treat any single row's merge as implying closure.

## 19. Expected file scope of this Plan's own PR

Exactly one new file: `docs/implementation-plans/enterprise-access-and-administration-platform.md`. No application code, Rules, indexes, Functions, schemas, routes, deployment, or production-data change. Issue #226 stays OPEN/In Progress.

## 20. Approval

Implementation-Plan-Draft, pending independent review and merge under this session's established docs-only merge authority. Merging this Plan authorizes only the PR sequence and ownership decisions above — it does not itself implement, deploy, or activate anything. Row 1 (Task 6, permission catalog) is the next eligible unit of independent work once this Plan merges. **AI plans; it never grants, revokes, or approves access.**

## 21. Addendum — Governed business Role catalog (Owner direction, Issue #226 comments dated 2026-07-16)

A single additive row, triggered by Owner direction naming eight new governed business Roles (General Employee, Office Manager, Sales Manager, Accounting Manager, Finance Manager, Field Manager, Operations Manager, Owner) after this Plan's original §3 table was written. Not a renumbering of §3 — inserted here as its own bounded unit, same reasoning as Specification §26's own addendum treatment.

| Row | Task | Deliverable | Spec section(s) | Merge posture |
|---|---|---|---|---|
| 1a | Governed business Role catalog | Eight new `Role` objects (`governedBusinessRoles.ts`, both mirrors) with a least-privilege Permission/Scope/Condition matrix (Spec §26.2); permission-catalog gap record (Spec §26.4) for domains with no existing capability id; unit tests proving every cited id is real and every role's shape is internally consistent | §26 | Docs/types-only, inert — self-mergeable after review, same posture as Row 1 |

**Dependency:** builds directly on Row 1's `permissionCatalog.ts`/`types/access.ts` and Row 2's `resolveEffectivePermission.ts` — no change to either. **Inert, same as Row 2's compatibility Roles were at merge time**: no Rule, Function, or claim consumes `governedBusinessRoles.ts`; `AdminRolesPermissions.jsx`'s `ASSIGNABLE_ROLES` continues to derive from `COMPATIBILITY_ROLES` only. Row 7 (trusted-writer Role-assignment commands) is the first row that could ever assign one of these eight Roles to a real principal, and remains its own separate, later Owner gate regardless of this row merging.

**Expected file scope:** `docs/specifications/enterprise-access-and-administration-platform.md` (§26 addendum), this file (§21 addendum), `field-ops-app-vite/src/access/governedBusinessRoles.ts`, `functions/src/access/governedBusinessRoles.ts`, and their test files. No Rules, indexes, Functions behavior, schemas, routes, deployment, or production-data change.
