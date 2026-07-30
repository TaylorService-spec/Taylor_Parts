# PRE-3 — Admin Password Reset: Audit-Coverage Decision Package

> **STATUS: PENDING — NOT AUTHORIZED.**
> This is a **documentation-only** decision package. It makes **no** code, Rules, permission, deployment,
> Firebase, fixture, or email change. It inventories the merged audit coverage, classifies each gap
> (security-required vs intentionally omitted), defines the sanitized event contract, and presents the
> genuine Owner decisions with recommended defaults. Merging this document authorizes **nothing**; a
> later, separately authorized implementation gate (G-PRE3-IMPL) would apply any approved additions.

- **Gate:** PRE-3 (repository/emulator-only prerequisite for AUTH-PROD-1 — the audit-coverage decision)
- **Governing decisions:** [`DECISIONS.md`](../DECISIONS.md) #54/#55/#56; PRE-1 package + G-PRE1-IMPL (merge `79f52d2`)
- **Merged code reconciled:** `main` `79f52d2` — `functions/src/access/adminCredentialCommands.ts`,
  `adminCredentialCallables.ts`, `auditEventWriter.ts`, `types/access.ts` (+ `field-ops-app-vite` mirror)
- **Sibling gates (NOT combined here):** PRE-1/PRE-2/target-parity (merged); AUTH-PROD-1 (D-PROD-1A/B/C, blocked)
- **Preserves:** the PRE-1 `uncertain` `AuditOutcome` + the atomic `reconciliation_required` audit contract — unchanged.

---

## 1. Purpose and boundary

The admin-reset command audits most **initiate/deliver** outcomes but leaves several terminal and access
paths **unaudited**. PRE-3 decides, per path, whether an audit is **security-required** or **intentionally
omitted** (enumeration resistance / noise control), and specifies the sanitized contract for any additions.
PRE-3 changes no behavior; it is the decision + contract that a later G-PRE3-IMPL would implement.

**In scope:** the full audited/unaudited inventory for **both** callables; the security-required vs
omitted classification; the sanitized field/summary/atomicity/replay/retention contract; and the Owner
decisions. **Not in scope / not authorized:** implementing audits; extending the `AuditAction` contract;
any Rules/permission/deployment/Firebase/fixture/email change; PRE-3 implementation; cross-key
reconciliation; AUTH-PROD-1.

---

## 2. Reconciliation — current audit coverage (main `79f52d2`)

### 2.1 `initiateAdminPasswordReset`

| Path | Audited today? | Action / outcome |
| --- | --- | --- |
| actor not authorized (PRE-2 gate) | **Yes** | `initiateAdminPasswordReset` / `denied` (`commands.ts:559`) |
| self-target | **Yes** | `initiateAdminPasswordReset` / `denied` (:563) |
| native send not configured (fail-closed) | **Yes** | `deliverAdminPasswordReset` / `denied` (:567) |
| target eligibility lookup error | **Yes** | `initiateAdminPasswordReset` / `denied` (:576) |
| protected target (final-active-admin) | **Yes** | `initiateAdminPasswordReset` / `denied` (:582) |
| neutral-ineligible target | **Yes** | initiation `applied` + deliver `denied`, category recorded (:587-588) |
| eligible — accepted send | **Yes** | initiation `applied` + deliver `applied` (:608, :636) |
| eligible — not-accepted send | **Yes** | deliver `denied` (:657) |
| eligible — send error (throw) | **Yes** | deliver `denied` (:628) |
| eligible — **uncertain** send | **Yes** | `reconciliation_required` + deliver `uncertain`, **atomic** (PRE-1, :644) |
| **input validation** (blank uid/target/key, bad key pattern, bad mode) | **No** | throws `InvalidInputError` before any audit (:342, :546, :551) |
| **operation-key conflict** (key reused for a different request) | **No** | throws `OperationKeyConflictError` from `claimOrResume` (:441) |
| **malformed op record** | **No** | throws `MalformedOperationError` (:438) |
| **in-progress** (fresh lease) | **No** | throws `OperationInProgressError` (:450) |
| **retry-cooldown** (recent failure) | **No** | throws `RetryCooldownError` (:453) |
| **replay** (completed op) | **No** | returns neutral, side-effect-free (:595) |
| **blocked replay** (reconciliation_required op) | **No** | returns neutral, side-effect-free (:595) — the original uncertain transition was already audited |

### 2.2 `listResetEligibleUsers`

| Path | Audited today? | Notes |
| --- | --- | --- |
| authorization **denied** (non-admin / inactive / disabled / non-reciprocal actor) | **No** | `assertActorAuthorized` throws with no audit |
| authorization **granted** — successful listing (candidate read) | **No** | returns rows; no access event |
| input validation (bad `limit`) | **No** | throws `InvalidInputError` |

There is **no** `AuditAction` for listing today (`types/access.ts` has only `initiateAdminPasswordReset` /
`deliverAdminPasswordReset` / `revokeUserSessions` for this lane); a list-access audit requires an
intentional shared-contract extension (§5, D-PRE3-ACTION).

---

## 3. Classification — security-required vs intentionally omitted

**Security-required (recommend AUDIT):**
- **List authorization denials** — a denied privileged read attempt (who tried to enumerate reset
  candidates) is a security signal; today it is silent. (Initiate already audits its authz denials.)
- **List access grants** — a successful admin enumeration of reset candidates is a governed read worth an
  access event (who listed, when), consistent with auditing the initiate lane.
- **Operation-key conflict** — a key reused for a *different* (actor,target,mode) can indicate client
  misuse or a replay/confusion attack; worth a sanitized audit.
- **Malformed op record** — an integrity anomaly on a governed record; worth a sanitized audit.

**Intentionally omitted (recommend NO audit) — with rationale:**
- **Input-validation rejections** — the caller's own malformed input (blank/short/bad-pattern key, bad
  mode). No security signal, high noise; the callable already returns a sanitized error. *Noise control.*
- **In-progress / retry-cooldown** — benign concurrency/rate-limit outcomes of a legitimate repeat; noisy,
  low value. *Noise control.*
- **Replay of a completed op / blocked replay of a reconciliation_required op** — side-effect-free no-ops;
  the original terminal (completed / uncertain) was already audited. Re-auditing a replay is pure noise
  and could distort counts. *Noise control.*

**Enumeration-resistance invariants (unchanged, must be preserved):**
- The caller-facing response for every neutral-ineligible target stays the identical neutral envelope; the
  distinguishing **category lives only in the server-side audit**, never in caller output.
- Any list audit records **access attribution only** — actor, action, outcome, scope-level target, and
  timestamp — with **no identities and no result count** (D-PRE3-LIST-COUNT default). It never records
  per-target eligibility and never leaks which specific accounts are eligible via inclusion or omission.

---

## 4. Sanitized event contract (for any approved addition)

- **Allowed fields only:** `actorUid`, `action`, `targetType`/`targetId` (or a scope-level target for the
  list access event), a bounded `outcome` (`applied` | `denied`; PRE-1's `uncertain` is reserved for the
  reconciliation transition and is not reused here), `scope`, and timestamp.
- **Result count — NOT the report-only `rowCount` (D-PRE3-LIST-COUNT).** The merged writer restricts
  `rowCount` to `runReportDefinition`/`exportReportDefinition` (`auditEventWriter.ts:293-297`); a list
  access event carrying `rowCount` would **fail runtime validation** the moment a `listResetEligibleUsers`
  action is added. Therefore the list access event **does not use `rowCount`.** Default: **carry no count
  at all** (attribution — who listed, when — is sufficient and simplest, and avoids a shared-contract
  coupling). If the Owner wants a count, it must be a **purpose-specific bounded field** given the full
  contract treatment (both type mirrors + writer validation + comments + consumer safety + tests) — never
  by widening the report-only `rowCount`.
- **Bounded summary:** ≤ `MAX_SUMMARY_LENGTH` (500); no free-form target data. **Prohibited:** email
  addresses, reset links, OOB codes, credentials/API keys, provider bodies, raw Firebase responses,
  per-target eligibility detail in list events, and any unbounded text. The existing secret-pattern
  rejection in the writer still applies.
- **Atomicity:** an audit tied to a **state transition** MUST be staged in the same transaction as the
  transition (via the transaction-aware `stageAuditEvent`), exactly as the PRE-1 `uncertain` path does —
  both commit or neither. A **pure denial/access** audit with **no** state change may use the standalone
  path (`recordStandaloneAuditEvent`), matching the existing initiate-denial audits.
- **Audit-write-failure / durability (D-PRE3-AUDIT-DURABILITY).** For a **security-required access grant**
  (`listResetEligibleUsers` success), the audit is a **precondition of returning data**: resolve
  authorization → resolve the bounded candidate rows → **persist the sanitized access audit** → return the
  rows **only after** the audit commit succeeds. If the audit cannot be committed, **fail closed**: return
  **no** rows and a sanitized error (e.g. an `unavailable` "could not complete the request"), never the
  candidate list. For a **denial** (list authz denial; and the initiate-lane conflict/malformed/authz
  denials), the **denial is authoritative regardless of the audit outcome** — the caller is still denied
  with the existing sanitized error even if the denial audit write fails; the audit failure is surfaced to
  server-side telemetry only (never to the caller, never leaking the reason). A denial must never become
  an allow because its audit failed; an access grant must never leak rows whose access could not be audited.
- **Replay behavior:** audits are append-only/immutable (Spec §14); a replay/no-op path writes **no** new
  audit. Idempotent re-invocations must not multiply audit events.
- **Retention:** unchanged — Audit Events are append-only and immutable; no deletion path. (Distinct from
  the PRE-1 send-dedupe retention, which is governed by D-PRE1-DEDUPE-RETENTION.)
- **Contract preservation:** the PRE-1 `AuditOutcome = "applied" | "denied" | "uncertain"` and the atomic
  `reconciliation_required` + `uncertain` audit are **unchanged** by PRE-3.

---

## 5. Owner decisions (each with a recommended safe default)

| # | Decision | Options | Recommended default |
| --- | --- | --- | --- |
| D-PRE3-LIST-DENY | Audit `listResetEligibleUsers` authorization **denials** | (a) audit; (b) none | **(a)** — a denied privileged read is a security signal (parity with initiate) |
| D-PRE3-LIST-ACCESS | Audit `listResetEligibleUsers` **successful** access | (a) audit an access event (actor + action + outcome + timestamp, no identities, no count); (b) none | **(a)** — governed enumeration should be attributable; strictly non-enumerating fields |
| D-PRE3-LIST-COUNT | Include a result count on the list access event | (a) no count; (b) a **purpose-specific** bounded count field with full contract treatment (mirrors + writer + tests); (c) widen the report-only `rowCount` (rejected — validation coupling) | **(a)** — attribution needs no count; avoids widening the report-only `rowCount` |
| D-PRE3-AUDIT-DURABILITY | Behavior when a required audit write fails | (a) access grant: audit-before-return, fail closed (no rows) on audit failure; denial: denial stays authoritative, audit failure to telemetry only; (b) best-effort audit, return regardless | **(a)** — never leak un-audited access; a denial never becomes an allow |
| D-PRE3-ACTION | Shared-contract change to represent list events | (a) extend `AuditAction` with a bounded `listResetEligibleUsers` action in **both** mirrors + writer allow-list (mirror-integrity tested); (b) reuse an existing action (rejected — none is truthful) | **(a)** — required to audit list events truthfully; mirrors kept byte-identical (as with the PRE-1 `uncertain` outcome) |
| D-PRE3-CONFLICT | Audit operation-key-conflict + malformed-op-record | (a) audit both (sanitized `denied`); (b) none | **(a)** — misuse / integrity signals |
| D-PRE3-VALIDATION | Audit input-validation rejections | (a) audit; (b) none | **(b)** — client input, no security value, high noise |
| D-PRE3-BENIGN | Audit in-progress / retry-cooldown | (a) audit; (b) none | **(b)** — benign concurrency/rate outcomes, noisy |
| D-PRE3-REPLAY | Audit completed-replay / blocked reconciliation-replay | (a) audit; (b) none | **(b)** — side-effect-free no-ops; original terminal already audited |
| D-PRE3-ATOMICITY | How new transition-audits are written | (a) `stageAuditEvent` in the transition's transaction; pure denials/access via standalone | **(a)** — consistent with PRE-1; both-or-neither for transitions |
| D-PRE3-FIELDS | Sanitized field/summary bounds | (a) reuse §4 (bounded outcome/reason, ≤500 summary, no secrets/identities in list) | **(a)** — matches the existing writer contract |

---

## 6. What this package explicitly does NOT authorize

Implementing any audit; extending the `AuditAction` (or any) shared contract; any Rules, permission
activation/grant, deployment, production Firebase access, fixture, or email change; altering the PRE-1
`uncertain`/`reconciliation_required` contract; PRE-3 implementation (G-PRE3-IMPL); cross-key
reconciliation (D-PRE1-XKEY-RECON); or AUTH-PROD-1 execution. `admin.credentialReset.initiate` remains
inactive/ungranted.

---

## 7. Sign-off (to be completed at future gates)

- [ ] Owner decisions §5 ratified (or amended) — _pending_
- [ ] **G-PRE3-IMPL** authorized: implement the approved audits + any `AuditAction` extension + any
  purpose-specific count field, with tests (repository/emulator only) — including **audit-before-return
  fail-closed** for list access (no rows on audit-write failure), **denial-authoritative-on-audit-failure**
  for denials, mirror-integrity, and writer-validation coverage — _pending_
- [ ] Independent Codex review of the implementation — _pending_
- [ ] AUTH-PROD-1 (D-PROD-1A/B/C) — _separate gate; unblocked only after G-PRE3-IMPL lands_

_This package is the documentation deliverable for the PRE-3 audit-coverage decision only. It remains
**PENDING / NOT AUTHORIZED** until the Owner ratifies §5 and separately authorizes implementation._
