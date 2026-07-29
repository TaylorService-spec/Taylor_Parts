# AUTH-PR-4 — Governed reverse-order rollback-continuation (design)

> **STATUS: DRAFT — repository + emulator only. Authorizes NO production execution.**
> This PR implements the governed reverse-order rollback-continuation the Owner authorized
> for repository work; it does not run, deploy, or authorize any production Auth mutation, and
> it must not be merged or executed without a separate Owner authorization.

## 1. Why

The single post-forward rollback (`--rollback`) restores the **most recently completed**
persona and drives the progression to the **`suspended`** terminal-for-one-step state, which
**blocks every further step** (`assertProductionAuthorization` refuses on `suspended`). That is
by design: continuing to unwind the remaining identities is a **separate, reviewed** action.

The production sequence is currently `suspended` after the position-5 (`emp-rudy-owner`)
rollback, with **four identities still migrated** (positions 1–4). Restoring them requires a
governed way to **resume** rollback from `suspended`, one identity at a time, **in reverse
order**, to a **terminal** end-state.

## 2. What (state-machine delta)

Two governed files change: `authPr4ProductionGate.js` (the state machine) and
`authPr4RecoveryEmailMigration.js` (the CLI flag). No new artifact types; the existing claim
lock, lease, transition mutex, high-water anchor, init-marker / reconcile-mutex /
generation-ledger gates, and two-phase `claimed → completed|uncertain|recovery_required`
lifecycle are **reused unchanged**.

- **New terminal status `rolled_back`.** Added to `STATES`. Invariant: `rolled_back` requires
  `completed === []` **and** a governed rollback `lastOutcome`. `assertProductionAuthorization`
  refuses **every** step while `rolled_back` (nothing transitions out of the terminal).
- **`suspended` may resume — only under an explicit opt-in.** From `suspended`, a **forward**
  step and a **bare `--rollback`** both stay blocked. A `--rollback --rollbackContinuation`
  invocation is permitted to resume, rolling back the **current most-recently-completed**
  persona. New invariant: `suspended` must have at least one remaining migrated identity
  (empty `completed` is the terminal `rolled_back`, never `suspended`).
- **Predecessor-bound claim.** `acquireAndClaim` takes a `fromStatus` so the `claimed`
  transition commits from the exact predecessor: `eligible` for a forward step or the first
  post-forward rollback, `suspended` for each continuation step. The orphaned-lock and
  claim-commit re-reads validate against `fromStatus`.
- **Terminal on empty.** A rollback completion sets `rolled_back` when `completed` empties,
  otherwise `suspended` (with a `rolled-back-suspended` outcome).

Reverse order is **structural**, not a parameter: the rollback target is always
`completed[completed.length - 1]` (the last element of the in-order prefix), and the operator's
`--employeeId`, if supplied, must equal it. Removing the last element keeps `completed` a valid
in-order prefix, so successive continuation steps walk positions 4 → 3 → 2 → 1.

## 3. Command (one identity per invocation)

Run once per remaining identity, most-recently-completed first (the gate enforces the target):

```bash
node functions/scripts/authPr4RecoveryEmailMigration.js \
  --projectId taylor-parts --confirmProduction taylor-parts \
  --executeProduction --rollback --rollbackContinuation \
  --authorizedCommit <re-authorized head> \
  --executionModeConfirmation <token> --executor <name> \
  --mappingFile <out-of-band mapping> --stateKeyFile <protected key> \
  --progressionFile <protected progression> \
  --capturedStateFile <that persona's signed rollback artifact>
```

## 4. Guarantees (all enforced before / around the single Auth write)

- **One identity per invocation**, targeting the current last-completed persona (reverse order);
  concurrent workers are excluded by the O_EXCL claim lock + bounded lease.
- **Matching signed rollback artifact required** (`--capturedStateFile`); its schema, signature,
  and bound `projectId/employeeId/position/uid/newAlias` are verified.
- **Exact validation**: current account must still hold the migrated alias and be enabled; the
  exact prior address must still be unclaimed; UID unchanged.
- **Exact restore**: the exact prior email **and** the captured prior `emailVerified` boolean.
- **Durable progression after confirmed read-back**: the signed `suspended`/`rolled_back`
  progression + high-water anchor are persisted **before** the artifact is deleted.
- **Artifact deleted only after** a confirmed mutation **and** durable progression; an uncertain
  outcome (write or read-back) **retains** the artifact and records a blocking `uncertain`
  progression (never auto-reverts).
- **Crash-safe / resumable / replay-safe**: the two-phase `claimed` state, high-water anchor
  (older signed states fail closed), and init-marker / reconcile / generation-ledger gates carry
  over unchanged; a crashed step re-enters through the existing recovery paths.
- **Terminal**: after the last identity, `rolled_back` blocks all further steps.

- **No** reset/verification email, **no** `revokeRefreshTokens`/session revocation, **no**
  Firestore / Employee-link / role / claim / `accessVersion` change — identical to the forward
  workflow (Auth `email` + `emailVerified` only).

## 5. Governance impact — re-authorization required (fail-closed until then)

Changing two governed files invalidates the committed **three-file GRANTED binding** (pinned to
the pre-continuation hashes at `reviewedHead dba0e33`): `assertProductionAuthorization` now
**fails closed at the governed-hash boundary** for any `--executeProduction` run, **before any
SDK init**. This is the intended fail-closed behavior and mirrors the `#461 → #462` sequence
(governed-set change → separate re-authorization). This PR **does not** touch
`functions/authpr4/production-authorization.json`; re-binding it to the new governed hashes is a
**separate Owner re-authorization** and is **out of scope** here.

## 6. Tests

- **Pure (gate):** `rolled_back`/`suspended` invariants; `suspended` blocks forward + bare
  rollback; `--rollback --rollbackContinuation` resumes in reverse order and stays `suspended`
  while identities remain; the last identity reaches terminal `rolled_back` which blocks all;
  continuation concurrency (exactly one claims).
- **Pure (CLI):** `parseArgs` recognizes `--rollbackContinuation`; it does not relax the
  production-write block on its own.
- **Auth emulator (end-to-end):** forward 1→5, owner rollback → `suspended`, then continuation
  4 → 3 → 2 → 1 → terminal `rolled_back`; each step restores the exact prior address +
  `emailVerified` and deletes the rollback artifact only after durable progression.
- **Updated:** the two REAL-repo binding tests now assert the correct fail-closed-until-re-authorized
  behavior; the single-persona rollback test now reaches terminal `rolled_back` (empty completed).
