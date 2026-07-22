---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-07-22
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/technician-self-write.md, docs/specifications/f-rules-1-legacy-job-technician-rules-contract.md, docs/audits/f-rules-1/read-scoping-validation.md]
implements: []
supersedes: []
superseded_by: []
related_pr: TBD
related_issue: F-RULES-1 (final deferred gap — technician self-write)
target_release: TBD
---

# Technician Self-Write — Specification

> Grounded in `origin/main` @ `cc94b9c`. Structure and naming follow the deployed, production-verified `updateWorkOrderExecutionData` callable (`functions/src/updateWorkOrderExecutionData.ts`), the `getCallerContext` resolver (`functions/src/callerContext.ts`), the `auditEvents` writer (`functions/src/access/auditEventWriter.ts`), and the `idempotencyKey` convention (`functions/src/access/accessCommandCallables.ts`). No code, Rules, or config is changed by this gate.

## 1. Primary surface — `completeAssignedJob` (trusted callable)

Closes the F-RULES-1 deferred gap by relocating the client-side completion cascade in `jobActions.js#updateJobStatus(COMPLETE)` into a trusted Function. After this exists, a technician holds **no** write grant on `fieldops_technicians`.

Conceptual name `updateTechnicianProfile` from the gate is retained only for the **future** profile surface (§9); the field-accurate name for the required capability is a verb-noun completion callable. Final name subject to Owner confirmation.

### A. Authentication
- `onCall`, region `us-central1` (match existing callables). Reject when `!request.auth` → `HttpsError('unauthenticated')`.
- Caller uid is taken **only** from `request.auth.uid`. No caller-supplied uid is honored.

### B. Authorization
- `getCallerContext(request.auth.uid)` must yield `role === 'technician'`. `admin`/`dispatcher` are **rejected** here (they complete jobs through their own admin/dispatcher path; this callable is the technician path) → `HttpsError('permission-denied')`. *(Owner decision O-2: whether a/d may also call this callable; default = technician-only, mirroring `updateWorkOrderExecutionData`.)*
- `operationalRoles` are **never** consulted for authorization.
- Compatibility-role behavior documented: authorization is the `users/{uid}.role` compatibility field, identical to the deployed WO-engine callables. Future effective-access integration is **planned, not activated** (§ Assessment 7).

### C. Identity resolution
- Resolve `caller.technicianId` from `getCallerContext`. If absent → `HttpsError('failed-precondition', 'no technicianId mapping')` (fail closed).
- The Function **never** accepts a `technicianId` in the input; it uses only the resolved value.
- Malformed/duplicate/inconsistent mapping (e.g. the job's `technicianId` does not equal the caller's, or the technician doc referenced by the job is missing) → deny inside the transaction (`permission-denied` / `failed-precondition`), never a partial write.

### D. Input contract
- Allowlisted input: `{ jobId: string (required), idempotencyKey: string (required) }`. **No other field is accepted**; unknown fields are rejected → `HttpsError('invalid-argument')`.
- No status, technicianId, or profile field is accepted from the client — the transition target (`complete`) and the technician status target (`available`) are **server-fixed constants**.
- Empty/missing `jobId` or `idempotencyKey` → `invalid-argument`.

### E. Transaction semantics
- Single `runTransaction` performing read-verify-write:
  1. read `fieldops_jobs/{jobId}`; must exist; `status === 'in_progress'`; `technicianId === caller.technicianId` (ownership).
  2. read `fieldops_technicians/{caller.technicianId}`; must exist.
  3. write `job.status = 'complete'`; write `technician.status = 'available'`.
- Both writes commit atomically or neither does. Cross-document atomicity is guaranteed by the single transaction (current Firestore semantics permit two-doc transactions). Invalid transition (`status !== 'in_progress'`) → `failed-precondition` (mirrors `canTransitionJob`).

### F. Idempotency
- Client supplies `idempotencyKey` (existing convention). Replay of the **same** key for the **same** `jobId` after success is a **no-op success** (returns the prior result), not a second cascade.
- The same key reused for a **different** request → `HttpsError('already-exists', 'idempotency key already used')`.
- A completed job re-completed with a **new** key is a `failed-precondition` (job is terminal), not a duplicate.
- Idempotency record location and dedup follow the `accessCommandCallables` precedent (a keyed record checked before the mutating transaction). No-op replays are **not** re-audited (audit dedup on `idempotencyKey`).

### G. Audit
Append-only `auditEvents` write within the flow (Admin SDK), consistent with `auditEventWriter.ts`:
- `actor` (caller uid), `targetTechnicianId`, `jobId`, `action` (a new `AuditAction` value, e.g. `completeAssignedJob` — **requires adding one entry to the `AUDIT_ACTIONS` union in `functions/src/types/access.ts` + its runtime mirror**; noted as an implementation task), `changedFields` (`job.status`, `technician.status`), before/after status values (enums, not sensitive), `idempotencyKey`, `timestamp`, `outcome` (success/failure), `failureReason` on failure.
- No secrets, tokens, or PII beyond the technician id and enum statuses are stored.

### H. Error codes (stable)
`unauthenticated` · `permission-denied` (not a technician / not owner) · `failed-precondition` (no technicianId mapping / job not `in_progress` / job terminal) · `not-found` (job or technician doc missing) · `invalid-argument` (bad/unknown input) · `already-exists` (idempotency key reused for a different request) · `internal` (unexpected). Messages describe the condition without leaking other users' data.

### I. Rate / abuse controls
- Completion is a low-frequency, ownership-bounded action; **no dedicated rate limiter is required now.** App Check and per-caller rate limiting are **documented as deferred** (revisit if the surface widens to profile self-service, §9). The `idempotencyKey` already prevents accidental double-submits.

## 2. Rules target-state matrix (applied later, in PR-C — not this gate)

| Collection / op | Current (`cc94b9c`) | Target after trusted path | Effect |
|---|---|---|---|
| `fieldops_technicians` read | a/d all; technician own (scoped) | **unchanged** | read-scoping preserved |
| `fieldops_technicians` create | a/d only | **unchanged** | |
| `fieldops_technicians` update | a/d **or** technician-own-`status` (interim) | **a/d only** — technician branch **removed** | closes the deferred gap; technician holds no `fieldops_technicians` write |
| `fieldops_technicians` delete | `if false` | **unchanged** | |
| `fieldops_jobs` update (technician branch) | own job, status-only, `assigned→in_progress` **or** `in_progress→complete` | own job, status-only, **`assigned→in_progress` only** | completion is now Function-only (Admin SDK); direct-client completion denied |
| `fieldops_jobs` update (a/d branch) | valid a/d transitions | **unchanged** | dispatcher assign/manage preserved |
| `users/{uid}` | `write: if false` | **unchanged** | already maximally locked |

The trusted Function uses the Admin SDK and **bypasses** client Rules by design. No broad self-update rule is introduced. Any *future* self-editable preference field would be **explicitly allowlisted** (and preferably still routed through the Function), never covered by a blanket rule.

## 3. Contract-test transition (DEFERRED → ENFORCED) — the important nuance

Moving completion to the Function **changes the Rules contract for the completion transition**, which the emulator suite (direct REST writes, no Functions) observes:

- **`technician cannot update own technician record (no self-write)`** — `HARDENING/DEFERRED` → **`ENFORCED`** (technician direct `fieldops_technicians` write now denied). *This is the gap closure.*
- **`assigned technician can complete own job (in_progress→complete)`** — currently a **COMPAT `ALLOW`** direct-write assertion. Because direct-client completion is now denied, this assertion must be **re-expressed**: the technician's *capability* to complete is preserved **via the Function** (covered by Function/emulator tests, §Test-Plan), while the *direct-write* transition becomes **`ENFORCED` DENY** ("technician cannot directly complete a job; completion is Function-only"). 
  - **Consequence:** the gate's expectation that "all 13 COMPAT assertions remain passing unchanged" is **not exactly** met — one COMPAT assertion changes shape (direct-write completion moves from ALLOW to a DENY under the strict contract, with the feature preserved through the Function). **Owner decision O-3** must accept this contract re-expression. Net counts after PR-C: COMPAT 12 (completion-by-direct-write removed) + ENFORCED 18 (16 prior + self-write + direct-complete-denied) + DEFERRED 0 — *exact numbers to be finalized in PR-C; the material point is DEFERRED reaches 0 and the suite becomes strict-eligible.*
- With **DEFERRED = 0**, the suite becomes eligible for **strict CI registration** (`F_RULES_1_STRICT=1`) and addition to `rulesRegressionRunner.mjs SUITES` — performed in **PR-C**, raising `EXPECTED_TOTAL` accordingly.

## 4. UX contract (technician-facing; scope = completion + access-safe states)

Field Mode's existing "Complete Job" action changes from a client transaction to a Function call. Required states:
- **Editable/actionable:** the "Complete Job" button for the caller's own `in_progress` job (unchanged surface).
- **Read-only:** all technician-record fields (`name`, `phone`, `status`) remain non-editable (no profile-edit UI is introduced).
- **Saving:** button enters a pending/disabled state while the callable is in flight; duplicate submit prevented (reuse of the in-flight `idempotencyKey`).
- **Success:** job leaves the active slot; technician returns to `available`; list refreshes (existing `onSnapshot` reflects the server write).
- **Failure:** surface the `HttpsError` code as a friendly message — not-owner / not-in-progress / no-mapping / conflict / transient — with a **Retry** that reuses the same `idempotencyKey` (safe replay).
- **Stale-data conflict:** if the job is no longer `in_progress` (completed elsewhere), show a non-alarming "already completed / no longer active" state, not an error toast.
- **Missing technician mapping:** reuse the fail-closed "account not linked to a technician profile" state already added in the read-scoping slice.
- **Suspended/inactive:** if a future access-status check denies, show an "account not active" message (consistent with the employee-session `employmentStatus` pattern). Not wired now; documented.
- **Audit/privacy notice:** none required (only the technician's own action and enum statuses are recorded).

Field Mode is **not** otherwise redesigned.

## 5. Decision recommendation (for a future DECISIONS.md #38 — record only on Owner approval)

> **38. Technician self-write closed via a trusted completion callable (F-RULES-1 final gap)** — Adopt **Option B**: a technician-only `onCall` Function performs the legacy job completion cascade (`fieldops_jobs.status=complete` + `fieldops_technicians.status=available`) atomically with the Admin SDK; Rules then deny all technician writes to `fieldops_technicians` and restrict the direct-client jobs transition to `assigned→in_progress`. Source-of-truth unchanged (`users/{uid}` identity/access, Admin-SDK-only; `fieldops_technicians` operational profile). The six Enterprise Access mutation Functions are unrelated and not prerequisites; this Function may deploy independently. Implementation and deployment remain separately gated (PR-A/B/C, Gates D1–D3). *Alternatives rejected:* direct client write (leaves the write surface), approval workflow (overkill for a routine completion), hybrid (no safe self-editable field exists). *Strategic alternative deferred (O-1):* migrating Field Mode onto the deployed WO engine.

This gate does **not** append the entry; it presents it for approval.

## 6. Owner decisions required
- **O-1:** Close the gap with `completeAssignedJob` (recommended), **or** pursue the larger WO-engine migration that retires the legacy collections?
- **O-2:** Technician-only caller (default), or also allow admin/dispatcher to call the completion callable?
- **O-3:** Accept the contract re-expression in §3 (direct-write completion → Function-only; one COMPAT assertion changes shape)?
- **O-4:** Confirm the final Function name (`completeAssignedJob` proposed).
- **O-5:** Approve adding a `completeAssignedJob` value to the `AuditAction` union (audit taxonomy change).
