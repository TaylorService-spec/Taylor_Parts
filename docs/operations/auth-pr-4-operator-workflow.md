# AUTH-PR-4 — Governed operator workflow (build/test gate)

> **STATUS: repository build + emulator/non-production test ONLY.** Plain
> `--execute` / `--rollback` against `taylor-parts` are **unconditionally refused**
> by the script. The **production-enablement** path (`--executeProduction`, the
> [`authPr4ProductionGate`](../../functions/scripts/authPr4ProductionGate.js)) is
> **conditional and fails closed**: it permits a production write only under a
> complete, valid, **recorded Owner authorization** — which **does not exist**, so
> production stays blocked. Recording that authorization + naming an executor +
> supplying private operational inputs is a **separate, not-yet-granted** Owner gate
> (see [`docs/deployment/auth-pr-4-production-enablement-design.md`](../deployment/auth-pr-4-production-enablement-design.md)).
> This document authorizes no production action.

## Production-enablement path (`--executeProduction`) — design §5

A production-project write is permitted **only** through `--executeProduction`,
which routes the run through the [`authPr4ProductionGate`](../../functions/scripts/authPr4ProductionGate.js).
It **requires a clean git checkout** and **fails closed in non-git contexts**. Before
any SDK init, the gate independently verifies, and **fails closed** on any of:

- **Repository-governed authorization artifact** — authority comes from the committed,
  git-tracked [`functions/authpr4/production-authorization.json`](../../functions/authpr4/production-authorization.json),
  read **from git at `--authorizedCommit`** (never an operator-authored path). Its
  status must be **`GRANTED`** (the committed artifact is **`PENDING`**, so production
  is blocked); strict schema (no unknown fields); project, exact ordered persona
  allowlist, reviewed head, and **blob-based** governed-file SHA-256 hashes must match;
  the operator's `--executionModeConfirmation` and `--executor` must equal the
  repository-recorded values ("nonempty" is not authorization). A modified/untracked/
  external/PENDING artifact, wrong path, unknown field, or hash drift → refuse.
- **Governed-file identity** — deterministic blob-based SHA-256 of the workflow + gate at
  the authorized commit must equal HEAD's (no post-review drift) and the working tree
  must be clean; a user-supplied `--authorizedCommit` is never sufficient by itself.
- **Attempt-bound progression state machine** (`--progressionFile`, signed): monotonic
  revision + previous-state-hash chain + a signed high-water **anchor** (detects
  restoration of an older signed state → refuse) + an **exclusive O_EXCL claim lock**
  with a bounded lease (concurrent claims refused; stale takeover is explicit and
  preserves prior-attempt evidence, moving to `recovery_required`). Only the exact next
  persona proceeds; **completion is recorded only by the owning attempt**; 1–4 durable
  before 5.
- **Crash-safe two-phase lifecycle** — a `claimed`/pending attempt is persisted **before**
  the Auth call; a durable outcome is recorded after; any uncertainty (write/read-back
  failure, or a completion-persistence failure) leaves `claimed`/`uncertain`/
  `recovery_required` — **blocking all later personas, never auto-reverting to eligible**
  — and retains the exact rollback artifact. Governed reconciliation is
  **production-disabled** in this PR.
- **Break-glass** (position 5): a signed `--breakGlassConfirmationFile` created after 1–4
  complete, **time-valid**, and bound to the exact progression state + the authorization
  contract's `requiredConfirmer` (early/expired/mismatched/reused/wrong-confirmer → refuse).

`--executeProduction` against the **production project** stays blocked absent a real
`GRANTED` authorization; against a **non-production/emulator** project it is the
"production-shaped" path exercised by tests. No CI/emulator test targets the real
`taylor-parts` project.

## What it is

[`functions/scripts/authPr4RecoveryEmailMigration.js`](../../functions/scripts/authPr4RecoveryEmailMigration.js)
— a single, guard-railed operator command that migrates **one** test persona's
Firebase Auth recovery/auth email to an Owner-supplied Gmail `+alias`, one
identity at a time, with exact rollback. It implements the "governed operator
workflow" the readiness package §4 (Execution model) requires.

It only ever calls `auth.getUser` / `auth.getUserByEmail` (reads) and a single
`auth.updateUser({ email, emailVerified })` (the migration write). It **never**
calls `sendPasswordResetEmail`, `generatePasswordResetLink`, or
`revokeRefreshTokens`, and never touches Firestore, roles, claims, `accessVersion`,
passwords, or UIDs.

## Guards (all enforced before any SDK write)

| Guard | Behavior |
|---|---|
| Dry-run default | No write unless `--execute` (forward) or `--rollback` is passed. |
| Exact project guard | `--projectId` required; `taylor-parts` additionally requires matching `--confirmProduction taylor-parts`. |
| Production-write block | Plain `--execute`/`--rollback` against `taylor-parts` **throws** (dry-run-only against production, execute-only against non-production). A production write is possible **only** via `--executeProduction` + the fail-closed `authPr4ProductionGate` (design §5, section above), which stays blocked absent a recorded Owner authorization. |
| Ordered-persona guard | Target must equal the persona at `--position` in the fixed order; excluded personas (`emp-rudy-sales-manager`, break-glass) rejected; `emp-rudy-owner` (last) requires `--breakGlassVerified` + `--confirmLowerRiskComplete`. |
| Protected out-of-band input | Persona→`{uid,newAlias}` is read from `--mappingFile`; rollback-state integrity uses a separate protected `--stateKeyFile` containing at least 32 random bytes. Neither is committed. |
| One at a time | Exactly one persona per invocation. |
| Fail closed | Disabled / missing / UID-mismatch / alias-collision → **halt** (never skip, never enable). |
| Exact rollback | Before mutation, the workflow writes a strict, signed `0600` rollback artifact to the explicitly supplied `--capturedStateOut`. It binds project, persona, position, UID, and migrated alias; rollback revalidates the signature, mapping, current alias, account state, and prior-address availability before restoring the exact prior address + boolean. |
| Sanitized evidence | Booleans / patterns / per-run random-salted opaque references only — never an address, alias tag, UID, or address-linked prior-verified value. The salt is not persisted. |
| Secret lifecycle | Dry runs create no rollback state. Only a failure **proven to be pre-mutation** (before `updateUser` is invoked) removes the artifact. **Once a mutation is attempted, any uncertain outcome — including a read-back (`getUser`) failure after a successful `updateUser` — RETAINS** the signed artifact and prints an uncertain-outcome warning telling the operator to preserve it; a successful mutation also retains it. Only a **confirmed successful rollback** (or explicit operator closure after the reviewed verification/rollback window) deletes it. A read-back failure never destroys recovery state. |

Migration order (readiness §4): `emp-rudy-driver` (1) → `emp-rudy-parts-associate`
(2) → `emp-rudy-warehouse-manager` (3) → `emp-rudy-parts-manager` (4) →
`emp-rudy-owner` (5, primary admin, last).

## Running the tests

Pure-helper layer (no emulator — guards, plans, sanitization):

```bash
cd functions && npm run test:authPr4Migration
```

Pure + Auth-emulator layer (forward execute, exact rollback, disabled/collision
halts, dry-run no-write — all against a `demo-*` non-production project):

```bash
cd functions && firebase emulators:exec --only auth --project demo-authpr4 "node test/authPr4RecoveryEmailMigration.test.mjs"
```

## Example (dry-run plan, emulator project — no write)

```bash
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  node functions/scripts/authPr4RecoveryEmailMigration.js \
  --projectId demo-authpr4 --employeeId emp-rudy-driver --position 1 \
  --mappingFile /secure/out-of-band/mapping.json
```

`--execute` additionally requires `--stateKeyFile /secure/key` and
`--capturedStateOut /secure/driver.rollback.json`. Rollback requires the same
mapping and key files plus `--capturedStateFile /secure/driver.rollback.json`.
It performs writes **only** against a non-production project. There is no runnable
production path in this build.

## Not authorized by this build

Production execution · Firebase Auth email/identity mutation · reset/verification
email delivery · explicit session revocation · AUTH-PR-3 deployment · email-provider
configuration · Firestore/role/claim/`accessVersion` mutation · use or commitment of
real emails, UIDs, tokens, passwords, or credentials. Enabling production execution
is a separate PR under a separate Owner authorization (readiness §11).
