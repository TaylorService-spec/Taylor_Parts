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

## 2a. Workflow-identity transition — the existing progression must cross the governed-file change

`workflowIdentityHash` is a hash of the governed-file hashes, and the signed progression + anchor
are **bound** to it. Because this PR changes governed files, the existing production suspended
state (signed under the **old** identity) would fail closed after any authorization rebind with
*"Progression bound to a different (stale) workflow identity."* **Re-binding
`production-authorization.json` alone is therefore NOT sufficient** to resume the existing state.

A one-time, governed, credential-free, crash-safe **workflow-identity transition** re-signs the
**existing** progression + high-water anchor from the OLD identity to the NEW one:
`authPr4InitProgression.js --mode identity-transition`, bound to **both** the exact
`--oldAuthorizedCommit` (old identity) and `--authorizedCommit` (new GRANTED authorization). It
preserves the state key, `status`, `completed` prefix, and last outcome; bumps the revision
(chained + re-anchored) so older signed states fail closed on **both** the identity binding and
the high-water anchor; and **leaves all retained rollback artifacts untouched** (they are not
identity-bound). It performs **no** Firebase init and **no** network/production access, and fails
closed on stale/forged/mismatched state, anchor mismatch, an init-marker / claim-lock / txn /
reconcile-mutex, a ledger anomaly, a blocking/terminal/in-flight status, or an identical
old/new identity.

```bash
node functions/scripts/authPr4InitProgression.js --mode identity-transition \
  --projectId taylor-parts --confirmProduction taylor-parts \
  --authorizedCommit <re-authorized head> --oldAuthorizedCommit <pre-change reviewed head> \
  --executionModeConfirmation <token> --executor <name> \
  --stateKeyFile <protected key> --progressionOut <protected progression> \
  --confirmIdentityTransition transition-workflow-identity
```

**Ordered enablement:** (1) merge the separate re-authorization (rebind the artifact to the new
governed hashes), (2) run the identity transition once, (3) run the continuation below. All three
are separately authorized; none is performed or authorized by this PR.

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

Changing governed files invalidates the committed **three-file GRANTED binding** (pinned to the
pre-continuation hashes at `reviewedHead dba0e33`): `assertProductionAuthorization` now **fails
closed at the governed-hash boundary** for any `--executeProduction` run, **before any SDK init**.
This is the intended fail-closed behavior and mirrors the `#461 → #462` sequence (governed-set
change → separate re-authorization). This PR **does not** touch
`functions/authpr4/production-authorization.json`; re-binding it to the new governed hashes is a
**separate Owner re-authorization** and is **out of scope** here.

**Re-binding the artifact alone is not sufficient.** The governed-file change also moves the
**workflow identity** to which the existing signed progression is bound, so even after a rebind
the current suspended state fails closed with *"bound to a different (stale) workflow identity"*
until the **workflow-identity transition** (§2a) re-signs it. Full enablement of the unwind is
therefore three separately-authorized steps: **re-authorization → identity transition →
continuation**.

## 6. Tests

- **Pure (gate):** `rolled_back`/`suspended` invariants; `suspended` blocks forward + bare
  rollback; `--rollback --rollbackContinuation` resumes in reverse order and stays `suspended`
  while identities remain; the last identity reaches terminal `rolled_back` which blocks all;
  continuation concurrency (exactly one claims).
- **Pure (CLI):** `parseArgs` recognizes `--rollbackContinuation`; it does not relax the
  production-write block on its own.
- **Pure (identity transition):** re-signs a suspended state old-identity → new-identity,
  preserving `status`/`completed`/last-outcome and bumping revision; re-run fails closed
  (idempotence); refuses missing confirm, identical old/new identity, a present init-marker, and
  a present claim lock.
- **Auth emulator (end-to-end):** forward 1→5, owner rollback → `suspended`, then continuation
  4 → 3 → 2 → 1 → terminal `rolled_back`; each step restores the exact prior address +
  `emailVerified` and deletes the rollback artifact only after durable progression.
- **Auth emulator (regression — Codex P1):** a signed **PRE-change** suspended state under the OLD
  identity is proven to fail closed on resume, then the governed identity transition re-binds it,
  and the continuation completes 4 → 3 → 2 → 1 to terminal `rolled_back`.
- **Updated:** the two REAL-repo binding tests now assert the correct fail-closed-until-re-authorized
  behavior; the single-persona rollback test now reaches terminal `rolled_back` (empty completed).
