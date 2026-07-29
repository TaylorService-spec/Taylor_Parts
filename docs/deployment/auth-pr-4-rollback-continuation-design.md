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

A one-time, governed, credential-free, **journaled crash-safe** **workflow-identity transition**
re-signs the **existing** progression + high-water anchor from the OLD identity to the NEW one:
`authPr4InitProgression.js --mode identity-transition`, bound to **both** the exact
`--oldAuthorizedCommit` (old identity) and `--authorizedCommit` (new GRANTED authorization). It
preserves the state key, `status`, `completed` prefix, and last outcome; bumps the revision
(chained + re-anchored) so older signed states fail closed on **both** the identity binding and
the high-water anchor; and **leaves all retained rollback artifacts untouched** (they are not
identity-bound). It performs **no** Firebase init and **no** network/production access, and fails
closed on stale/forged/mismatched state, anchor mismatch, an init-marker / claim-lock / txn /
reconcile-mutex, a ledger anomaly, a blocking/terminal/in-flight status, or an identical
old/new identity.

**Crash-safety across the two-file (state + anchor) replacement.** The state and anchor are two
independent files, so the transition is **journaled**. Before touching either, it publishes a
**signed intent** (`<progression>.idtxn`, atomic + exclusive, full-or-absent) carrying the
`authorizationId`, old/new identities, predecessor revision/hash, **predecessor state+anchor
digests**, the transition generation, and the **exact authorized target bytes + digests**. It then
writes the state, writes the anchor, verifies both **together** under the new identity, and removes
the intent **last**. While the intent is present the gate refuses every production step
(`assertNoIdentityTransactionIntent`). A crash at any boundary (intent, state, anchor, cleanup)
leaves the intent, and the governed **`--mode identity-transition-recover`** completes it
deterministically: it verifies the signed intent, classifies each on-disk artifact by digest
(`predecessor` | `target` | `foreign`), **rolls forward only an artifact byte-identical to the
recorded predecessor** (never a foreign/substituted one, never inferring from elapsed time),
verifies state + anchor together under the new identity, and only then removes the intent. Any
substituted/foreign/conflicting artifact **blocks** (intent retained) for Owner escalation.
Recovery is idempotent and itself crash-recoverable.

The intent is also **fence-bound**: it records the exact fencing **generation** and **ledger-head
digest** observed when it was published, and both the forward path and recovery revalidate them
after publication and immediately before each state/anchor replacement and the final cleanup. If a
governed reconciliation advances the generation, a stale intent (even with its matching predecessor
artifacts still on disk) is **superseded and blocked** — it can never be replayed to resurrect a
transition the newer generation has fenced out.

**Mutual exclusion with generation advancement (a shared lock, not a presence check).** A single
owner-bound **fence-exclusion lock** (`<progression>.fencelock`) is acquired **atomically** (O_EXCL
hard-link) by BOTH operations that can touch the fencing generation + the transition's protected
state, and **held across each one's whole critical section**:

- **generation advancement** — `reconcile-recover` is the only production path that advances the
  fencing generation (via `claimGeneration`); it acquires the fence lock **before** the generation
  CAS and holds it through the reconciliation-mutex removal;
- **identity transition (+ recovery)** — acquires the fence lock **before** publishing the intent
  and holds it through classification, state replacement, anchor replacement, combined verification,
  and intent cleanup.

Because both acquire the **same** lock atomically, exactly one wins; the loser gets `EEXIST` and
**publishes/mutates nothing**. This closes the reverse race (a generation worker cannot slip a
`gen.N+1` claim in between the transition's checks and writes, and vice-versa) — mutual exclusion by
a single atomically-acquired lock, not a one-sided presence check.

The exclusion is enforced at the **authoritative primitive**, not by caller convention:
`claimGeneration()` (which publishes a `gen.<N>` ledger claim) **requires a held `generation-advance`
fence lock** — it strictly parses and verifies the signed on-disk lock (exact owner token, holder,
and captured generation + ledger-head digest equal to the current validated head) immediately before
publishing, and refuses an absent / malformed / foreign-owned / wrong-holder / wrong-token / stale
lock. There is no lock-free generation publication (a call-graph guard test proves the single
production call site — `reconcile-recover` — threads its held token). The lock is signed with the state
key, released only by its owner token, and **never auto-broken**. A hard crash strands it; the
governed **`fence-inspect` / `fence-recover`** modes clear a crash-left lock — and *only* the lock —
requiring an explicit **owner-stopped attestation** plus a matching **fingerprint** (nothing changed
since inspection), after which the operator runs the appropriate follow-on
(`identity-transition-recover` for a stranded intent; `reconcile-recover` for a stranded
reconciliation). The gate blocks every production step while a fence lock is present.

```bash
node functions/scripts/authPr4InitProgression.js --mode identity-transition \
  --projectId taylor-parts --confirmProduction taylor-parts \
  --authorizedCommit <re-authorized head> --oldAuthorizedCommit <pre-change reviewed head> \
  --executionModeConfirmation <token> --executor <name> \
  --stateKeyFile <protected key> --progressionOut <protected progression> \
  --confirmIdentityTransition transition-workflow-identity
```

If a transition is interrupted (crash / power loss), complete it with the recovery mode (same
inputs, `--mode identity-transition-recover`) before running the continuation:

```bash
node functions/scripts/authPr4InitProgression.js --mode identity-transition-recover \
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
- **Pure (identity-transition crash-safety):** fault injection at **every** write boundary
  (intent create / state write / anchor write / intent cleanup) is recovered via
  `--mode identity-transition-recover` to a consistent new-identity state+anchor — including the
  exact new-state/old-anchor case (shown to fail anchor freshness before recovery); recovery
  refuses with no intent and **blocks** (retains the intent) on a substituted/foreign artifact.
- **Pure (generation fence):** same-generation transition + recovery succeed; an out-of-band
  ledger-head advance versus the signed intent blocks recovery and retains the intent (a stale
  journal + matching predecessors cannot bypass the newer fence).
- **Pure (mutual exclusion):** while the transition **holds the shared `.fencelock`**, a
  `generation-advance` fence-lock acquisition is refused (`EEXIST`) in **every** window —
  pre-publish, state check→write, anchor check→write, and verify→cleanup — and the transition
  completes (intent cleaned up, lock released). The transition owns the shared lock from before
  intent publication through cleanup, so a concurrent generation advance never wins any of those
  windows.
- **Pure (shared fence lock / reverse race):** the generation worker and the identity transition
  acquire ONE lock atomically — exactly one wins and the loser publishes/mutates nothing (both
  directions); a crash-left lock blocks a new transition and is cleared only by governed
  `fence-recover` (owner-stopped attestation + matching fingerprint), after which the transition runs.
- **Auth emulator (end-to-end):** forward 1→5, owner rollback → `suspended`, then continuation
  4 → 3 → 2 → 1 → terminal `rolled_back`; each step restores the exact prior address +
  `emailVerified` and deletes the rollback artifact only after durable progression.
- **Auth emulator (regression — Codex P1):** a signed **PRE-change** suspended state under the OLD
  identity is proven to fail closed on resume, then the governed identity transition re-binds it,
  and the continuation completes 4 → 3 → 2 → 1 to terminal `rolled_back`.
- **Updated:** the two REAL-repo binding tests now assert the correct fail-closed-until-re-authorized
  behavior; the single-persona rollback test now reaches terminal `rolled_back` (empty completed).
