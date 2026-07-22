---
artifact_type: assessment
gate: Design / Decision Analysis
status: Approved
date: 2026-07-22
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/f-rules-1-legacy-job-technician-rules-assessment.md, docs/specifications/f-rules-1-legacy-job-technician-rules-contract.md, docs/audits/f-rules-1/read-scoping-validation.md, docs/audits/functions-live-state/functions-live-state-verification-report.md]
implements: []
supersedes: []
superseded_by: []
related_pr: TBD
related_issue: F-RULES-1 (review-derived workstream; final deferred gap — technician self-write)
target_release: TBD
---

# Technician Self-Write — Assessment & Decision Analysis

> **Provenance.** Repository-grounded. Every current-state claim is grounded in `origin/main` at `cc94b9c` (merge of PR #375, technician read-scoping) and the merged Functions live-state evidence under `docs/audits/functions-live-state/`. Hypothetical fields named in the authorizing gate that are **not** present in the schema are called out as such. Items that cannot be grounded are marked **Unresolved**.

## 1. Problem statement

F-RULES-1 has one remaining `DEFERRED` contract gap: **"technician cannot update own technician record (no self-write)."** PR-2 left an interim rule permitting a technician to write **only** their own `fieldops_technicians/{id}.status` (enum-guarded, `hasOnly(['status'])`). That interim write exists for exactly one reason, grounded in code:

- [`field-ops-app-vite/src/domain/jobActions.js`](../../field-ops-app-vite/src/domain/jobActions.js) `updateJobStatus(job, COMPLETE)` runs a client `runTransaction` that writes **both** `fieldops_jobs/{jobId}.status = complete` **and** `fieldops_technicians/{technicianId}.status = available`. Field Mode calls this when a technician completes their own job. The technician therefore must currently be allowed to write their own technician doc's `status`.

To move the contract assertion from `DEFERRED` to `ENFORCED`, that client-side cross-document write must be removed — which requires a **trusted mutation path** (Admin SDK) so the cascade no longer depends on a technician-held write grant.

## 2. Grounding corrections to the gate's framing

The authorizing gate describes a broad "technician self-service profile update" problem and a `users/{uid}`↔`fieldops_technicians` synchronization concern. The repository does not match that framing, and the design must be honest about it:

| Gate premise | Actual repository state | Consequence for this design |
|---|---|---|
| Cross-doc sync between `users/{uid}` and `fieldops_technicians` | `users/{uid}` is **client-immutable** (`allow write: if false`) and is only **read** for identity resolution; it is **never** written by a technician. The real cross-document pair is `fieldops_jobs` ↔ `fieldops_technicians` (the completion cascade). | The design governs `fieldops_technicians` writes and the jobs↔technicians cascade. `users/{uid}` needs no new protection — it is already maximally locked. |
| Duplicated display/contact fields to normalize | **No field is duplicated** between the two docs. `users/{uid}` = `{role, employeeId, technicianId}`; `fieldops_technicians` = `{name, phone, status, createdAt}`. They share no attribute, only the immutable `technicianId` pointer. | There is no "source-of-truth for a duplicated field" problem to solve. §4 records this explicitly. |
| Technician profile self-service (phone, territory, skills, truck, certifications, notification prefs…) | **None of these fields exist**, and **no profile-edit UI exists** (Field Mode only performs job-status actions). The only technician-facing write today is the completion cascade's `status`. | The concrete gap is a **lifecycle status write**, not attribute self-service. Profile self-service is specified as a *future, currently-empty* surface (§5, §6), introducing no new field now. |
| `accessVersion` / `securityRole` / `operationalRoles` on the user | These live on `employees/{employeeId}` (and `RoleAssignment`), not on `users/{uid}`. `operationalRoles` are work-eligibility only, never authorization (per the F-RULES-1 contract). | Category-D security fields are enumerated against the **actual** documents (§3). |

**Net:** the gap is narrow and lifecycle-shaped. The design closes it by relocating one client cross-doc write into a trusted Function, and specifies (but does not build) a governed vehicle for any *future* profile self-service.

## 3. Field-classification matrix (grounded in actual schema)

Categories: **A** self-editable · **B** requestable/approval-controlled · **C** server/operationally-controlled · **D** security-controlled · **E** immutable identity/system.

### `users/{uid}` — Rules: `read if own uid`, `write: if false` (Admin-SDK/console only)

| Field | Present? | Category | Rationale |
|---|---|---|---|
| `uid` (doc id) | yes | **E** | Firebase Auth uid; the document key. |
| `role` | yes | **D** | Compatibility authorization source (`admin`\|`dispatcher`\|`technician`). Client-immutable today. |
| `technicianId` | yes | **D** | Identity **mapping** to `fieldops_technicians`. Immutable from client; set only by `assignTechnicianToUser.js` (Admin SDK). Trusting a caller-supplied value would be a privilege-escalation vector. |
| `employeeId` | yes | **D** | Mapping to Enterprise/Inventory `employees/{id}` (operationalRoles/employmentStatus). Client-immutable. |

Every `users/{uid}` field is already D/E and already denied to all clients. **No change to `users/{uid}` protection is required or proposed.**

### `fieldops_technicians/{technicianId}` — Rules: read scoped (a/d all; technician own); create a/d-only; update currently a/d **or technician-own-`status`** (the interim grant to remove)

| Field | Present? | Category | Rationale |
|---|---|---|---|
| `technicianId` (doc id) | yes | **E** | Document key; equals `users/{uid}.technicianId`. Never rewritten. |
| `createdAt` | yes (on create) | **E** | System timestamp. |
| `status` | yes | **C** | `available`\|`on_job`\|`off_shift`. Changes **only as a consequence** of a lifecycle action (assign → `on_job`; complete → `available`). Not a free-form self-set value → server/operationally controlled. **This is the field behind the deferred gap.** |
| `name` | yes | **B** (future) | Display identity. Admin/dispatcher-managed today (`createTechnician`). Any future technician edit is a governed/approval-eligible change, not a silent self-write. |
| `phone` | yes | **A-eligible** (future) | Contact attribute; the only plausible genuinely self-editable field. **Not** self-editable today. If self-service is ever wanted, it routes through the trusted Function (§6), not a direct write. |

**Fields the gate named that do not exist:** territory, schedule, certifications, skills, truck assignment, home location, service area, routing state, operational capacity, dispatch availability, inventory ownership, work-order linkage, permissions, access status, accessVersion, tenant/company scope, suspension state (on these docs), approval authority, audit metadata (on these docs). They are out of scope by absence; if introduced later they inherit these category rules.

## 4. Source-of-truth decision

- **Identity/access source of truth:** `users/{uid}` — owns `role`, `technicianId`, `employeeId`; Admin-SDK-only; client-immutable. **Unchanged.**
- **Operational profile source of truth:** `fieldops_technicians/{technicianId}` — owns `name`, `phone`, `status`.
- **`technicianId` mapping:** immutable from the client; the trusted Function resolves it from `users/{request.auth.uid}` and **never** accepts a caller-supplied `technicianId`.
- **Duplicated fields:** **none.** No replication, no replication direction, no reconciliation strategy required — the two documents share no attribute.
- **The real cross-document consistency unit:** `fieldops_jobs/{jobId}.status` + `fieldops_technicians/{technicianId}.status` during the completion cascade. This must be **atomic** (single transaction) and must not be achievable by a client holding a technician-scoped write. Partial failure is **not** allowed (both writes commit or neither).
- **Bidirectional client writes:** none exist and none are introduced. All governed mutation is one-directional through the trusted Function.

## 5. Mutation options assessed

| Criterion | A. Direct client write + Rules | B. Single trusted callable *(approved — Owner O-1)* | C. Trusted callable + approval workflow | D. Hybrid (safe prefs direct + Function governed) |
|---|---|---|---|---|
| Security | Weak — keeps a technician write surface on `fieldops_technicians`; Rules cannot express "status changes only via a valid job completion" | Strong — technician holds **no** write grant on `fieldops_technicians`; Admin SDK performs the cascade | Strong (same) plus dual-control | Mixed — reintroduces a (narrow) direct-write surface |
| Cross-doc consistency | Cannot guarantee atomic jobs↔technicians under client Rules the way a server transaction can, once the technician grant is removed | Atomic server `runTransaction` | Atomic | Atomic for the governed half only |
| Auditability | None (no server hook) | `auditEvents` write in the same flow | Same + approval trail | Partial (direct-write half unaudited) |
| Idempotency | N/A | `idempotencyKey` convention (existing) | Same | Only governed half |
| Failure handling | Client-transaction retry only | HttpsError codes + transaction rollback | Same | Split |
| Complexity | Lowest but wrong | Low — mirrors deployed `updateWorkOrderExecutionData` | Higher (workflow) | Highest (two paths) |
| Migration impact | None but leaves gap open | Field Mode calls a callable instead of a client transaction | Same + approval UI | Two migrations |
| Current-role compat | Preserves feature but not the security goal | Preserves the technician **capability** (complete my job) via the Function; changes the **mechanism** (see §7 note) | Same | Same |
| Future Enterprise-Access compat | — | Function can later consult effective-access without a redesign | Same | Same |
| Deploy requirement | None | One new Function deploy gate | Same | Same |
| Testability | Rules-only | Function unit + emulator + Rules contract | Same + workflow | Most surface |
| Rollback | — | Revert Function + Rules; feature reverts to interim | Same | Two rollbacks |

**Decision (Owner-approved O-1): Option B — a single dedicated trusted callable (`completeAssignedJob`) that performs the technician-initiated legacy job completion cascade atomically**, after which Rules deny **all** technician writes to `fieldops_technicians`. This is the minimal, honest closure of the deferred gap and directly mirrors the already-deployed, production-proven `updateWorkOrderExecutionData` pattern. Option C's approval workflow is reserved for *category-B* profile changes (e.g. `name`), which are not wired; Option D's direct-write half has no genuinely-safe self-editable field to carry today.

### Strategic alternative (surfaced for the Owner, not recommended for this gap)
The Work Order Engine (`fieldops_wos` + the **deployed** `transitionWorkOrder`) already has a server-only completion path with **no** client cascade. Migrating Field Mode off the legacy `fieldops_jobs`/`fieldops_technicians` collections onto the WO engine would close this gap with **zero new Functions** — but is a substantially larger frontend migration and a strategic collections decision beyond F-RULES-1's scope. **Owner decision O-1** (§12) records this fork. Option B does not preclude a later WO migration.

## 6. Trusted-path surfaces (what Option B actually builds)

Two logically distinct pieces, both routing through the trusted-Function pattern; only the first closes the deferred assertion:

1. **Lifecycle completion (required, wired):** a callable — repo-conventional name **`completeAssignedJob`** (verb-noun, matching `transitionWorkOrder`) — that a technician calls to complete their own assigned job. It performs `job.status = complete` + `technician.status = available` atomically with the Admin SDK. Full contract in the Specification.
2. **Profile self-service (future, currently empty):** the gate's conceptual `updateTechnicianProfile`. Specified with an **empty self-editable allowlist today** (no field is self-editable yet); it becomes the governed vehicle if/when a business need admits `phone` (category A) or a `name` change request (category B). Building it is **not** required to close F-RULES-1 and is **not** in the recommended implementation scope; it is specified so the pattern is pre-decided.

## 7. Enterprise Access relationship

- The six exported-but-**undeployed** access-mutation Functions (`grantRole`, `revokeRole`, `assignApprovedRole`, `setUserStatus`, `approveAccessRequest`, `rejectAccessRequest`) are **role/access administration** (Issue #226). They are **unrelated** to technician job-completion and are **not prerequisites**.
- **Current authorization source:** the compatibility `role` field via the Function's `getCallerContext` (`role === 'technician'`), exactly as the deployed `updateWorkOrderExecutionData` already authorizes. No effective-access dependency.
- **Future integration point:** the Function may later consult `resolveEffectiveAccessCallable` / effective-access without redesign; **planned, not activated.**
- **Can `completeAssignedJob` deploy before Enterprise Access mutations?** **Yes** — it depends only on the already-deployed compatibility model and Admin SDK. Admin Portal activation does **not** depend on this work, and this work does not depend on it.
- **Principle upheld:** technician job completion is not blocked by unrelated Enterprise Access administration deployment.

## 8. Issue #15 disposition

Issue #15 (Work Order Engine v1.2) delivered and **deployed** `createWorkOrder` / `transitionWorkOrder` / `updateWorkOrderExecutionData` (verified live, 3 of 11). The legacy `fieldops_jobs`/`fieldops_technicians` completion cascade is a **separate, older** surface not covered by Issue #15's WO-engine callables. **Recommendation:** do **not** widen Issue #15; track the `completeAssignedJob` callable under the **F-RULES-1** workstream as its final closure item (PR-A). If the Owner chooses the strategic WO-migration alternative (O-1) instead, that is a new, larger issue — not an Issue #15 expansion. Issue #15 needs no split for this gap.

## 9. DECISIONS.md disposition

Owner decisions O-1…O-5 were **approved** in the PR #377 review (2026-07-22). The decision is recorded as **`docs/DECISIONS.md` #39** — *not* #38, which is now occupied by the merged INV-1 Phase 0 recovery-tooling decision (PR #376). The entry records the dedicated `completeAssignedJob` callable, technician-only authorization, UID-resolved identity, atomic cascade, direct-completion denial with `assigned→in_progress` retained, idempotency, append-only audit, the non-prerequisite status of Enterprise Access mutations, and that implementation/deployment remain separately gated.

## 10. F-RULES-1 completion path

1. **This gate:** design + spec + plan (governance only). ← you are here
2. **PR-A:** implement `completeAssignedJob` + Function/emulator tests (export only; not deployed).
3. **PR-B:** migrate Field Mode's completion action to call the Function; UX states.
4. **PR-C:** tighten Rules (deny technician `fieldops_technicians` writes; restrict the direct-client jobs transition to `assigned→in_progress`); flip the deferred assertion to `ENFORCED`; register the contract suite in **strict** CI.
5. **Gate D1/D2/D3 (separate Owner deploy gates):** deploy Function → deploy hardened Rules → production smoke.

Only after PR-C + D1/D2/D3 is F-RULES-1 **complete**. This gate authorizes none of it.
