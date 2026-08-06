---
artifact_type: operations
gate: Authorization-cutover rollback procedure (ADR-005 §2.7 criterion 11)
status: Active — procedure defined; no cutover has been performed
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
base_commit: 61150b7
scope: Procedure only. Executing any step requires its own Owner authorization; every Rules deploy is Tier 2.
---

# Authorization-Cutover Rollback

ADR-005 §2.7 criterion 11 requires that rollback be **tested and documented** before legacy-role retirement. Rollback for deployments generally is mature in this repository; rollback for an **authorization model cutover** was undefined. This closes that gap.

Applies to Issue #226 Rows 23–26 (`#265`–`#268`) — each moves one domain from legacy `users/{uid}.role` authority to the governed Permission engine.

---

## 1. Why an authorization rollback is not an ordinary rollback

A normal deploy rollback restores code. An authorization rollback restores **who could do what** — and must also answer what happened *while the wrong answer was live*. Three properties make it distinct:

1. **It is a Rules deploy** — Tier 2, human-operator-executed, never automatic.
2. **It has an interim-decision problem.** Between cutover and rollback, requests were allowed or denied under the new model. A rollback restores the old model but does **not** undo those decisions. Wrongly-*allowed* writes persist and must be found; wrongly-*denied* requests were merely failures and need no reconciliation.
3. **It is asymmetric.** A cutover that is too *restrictive* degrades service (visible, urgent, low integrity risk). A cutover that is too *permissive* is an access-control incident (often silent, high integrity risk). The response differs — see §5.

## 2. Preconditions — captured BEFORE any cutover

A cutover may not proceed unless all six exist:

| # | Precondition | Artifact |
|---|---|---|
| P1 | Exact pre-cutover Rules revision pinned, with its SHA-256 | repo SHA + `sha256sum firestore.rules` |
| P2 | Live pre-cutover Rules text captured from production | evidence set (see the U-6 caveat below) |
| P3 | Corpus baseline for the domain | `legacyAuthorizationSurface.ts` entry for each collection in scope |
| P4 | Parity suite green at the cutover revision | `access-catalog-unit-tests.yml` + `legacy-authorization-surface-gate.yml` |
| P5 | Rules regression suite green | `firestore-rules-regression.yml` |
| P6 | Named rollback authorizer and operator | recorded in the cutover's authorization package |

> **P2 caveat.** Capturing live Rules text is currently **blocked on tooling** — `firebase firestore:rules:get` is absent from CLI 15.22.4 and `gcloud firebaserules` is not a valid command group (see `docs/audits/eao-readonly-evidence-20260806/`). Until resolved, P2 is satisfied via the Firebase Console Rules tab, saved as text into the cutover's evidence set. **A cutover must not proceed without P2 by some route** — without the pre-state you cannot prove what you restored to.

## 3. Rollback triggers

Execute rollback when any is observed after a cutover:

- **T1** a principal who could perform an operation before the cutover can no longer perform it, and that is not an intended narrowing recorded in the cutover package;
- **T2** a principal can perform an operation they could **not** perform before (**treat as an access-control incident** — §5);
- **T3** the parity suite or surface drift gate fails post-merge;
- **T4** an operational workflow is blocked with no governed workaround;
- **T5** the cutover's own acceptance verification cannot be completed.

## 4. Procedure

1. **Stop forward work** on the affected domain. Do not attempt a fix-forward Rules edit under incident conditions — one authorization change at a time, always from a reviewed revision.
2. **Record the observation**: trigger, time (UTC), affected collections and principals, and how it was detected.
3. **Obtain rollback authorization.** Tier 2. Rollback is a Rules deploy and is never self-authorized, including during an incident.
4. **Verify the rollback target** is exactly P1: check out the pinned revision, confirm `sha256sum firestore.rules` matches, and confirm the two Rules copies are byte-identical (the surface gate's D4 assertion).
5. **Human operator deploys** `firebase deploy --only firestore:rules` from that exact revision. Capture command output.
6. **Verify restoration** — live Rules match P2's captured pre-state; the rules regression suite passes against the restored revision; a representative allowed and a representative denied operation from the domain's parity fixtures behave as they did pre-cutover.
7. **Revert the corpus** in the same change: restore the domain's `legacyAuthorizationSurface.ts` entry so the drift gate matches the restored Rules. *The gate will fail until this is done — that is intended, and is the mechanism that keeps the corpus honest.*
8. **Reconcile interim decisions** — §5.
9. **Record** in `DECISIONS.md`, import evidence under `docs/audits/` per `governance/audit-artifact-standard.md`, and reopen the row's issue with the trigger and findings.

## 5. Interim-decision reconciliation

Rollback restores the rules, not the consequences.

**If the cutover was too restrictive (T1/T4):** requests failed. Nothing was written that should not have been. Confirm no retry logic created duplicates, and reconciliation is complete.

**If the cutover was too permissive (T2) — this is an access-control incident:**

1. Determine the exposure window: cutover deploy time → rollback verification time.
2. Identify which operations the new model allowed that the old model denied — computable from the domain's parity fixtures plus the corpus entry, not by guesswork.
3. Search the append-only audit trail (`auditEvents`) and the affected collections for writes in that window matching those operations.
4. **Any wrongly-permitted write is escalated to the Owner immediately.** Do not self-authorize remediation of production data; a corrective write is a separate protected action.
5. Record the finding even when the search returns nothing — a clean result is evidence, and the absence of that record is indistinguishable from not having looked.

## 6. Testing this procedure (criterion 11's "tested")

Criterion 11 requires the rollback be tested, not merely written. It is satisfied by a **sandbox rehearsal**, not a production drill:

1. In the emulator, apply a candidate cutover to the domain's Rules.
2. Run the domain's parity fixtures; confirm the intended decisions.
3. Apply this procedure's §4 restoration steps against the emulator.
4. Confirm the restored state matches the pre-cutover behaviour fixture-for-fixture, and that the drift gate returns to green after step 7.
5. Import the rehearsal evidence with the cutover's authorization package.

**No production rollback drill is authorized or required.** Rehearsing in the emulator is the correct environment per `governance/execution-environments.md`; production is never the exploratory test environment.

## 7. What this procedure does not authorize

No Rules deploy, cutover, retirement, grant, migration, or production data change. Every step that touches production is separately Owner-authorized and human-operator-executed. This document is the procedure that must exist *before* those authorizations can be responsibly granted.
