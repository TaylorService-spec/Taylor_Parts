# AUTH-PR-4 — Governed operator workflow (build/test gate)

> **STATUS (2026-07-28): authorization GRANTED, but AUTH-PR-4 has NOT executed and remains
> operationally blocked.** Plain `--execute` / `--rollback` against `taylor-parts` are
> **unconditionally refused** by the script. The **production-enablement** path
> (`--executeProduction`, the [`authPr4ProductionGate`](../../functions/scripts/authPr4ProductionGate.js))
> is **conditional and fails closed**. The recorded Owner authorization now **exists and is
> GRANTED**: [`functions/authpr4/production-authorization.json`](../../functions/authpr4/production-authorization.json)
> is `GRANTED` and its **three-file governed binding verifies** (DECISIONS #52 + #53 + #54, `reviewedHead
> bc0fda57` — the PR #467 merge; security suites CI-enforced). **Even so, nothing runs:** no genesis/progression state,
> protected state key, or private operational inputs (alias mapping) exist, so a production
> `--executeProduction` run still **fails closed** at the progression/genesis boundary before any SDK
> init. Execution remains blocked until the **separate, not-yet-granted Gate A** (protected genesis
> preparation) **and Gate B** (one-persona-at-a-time execution) Owner authorizations are given **and**
> the protected inputs are supplied out-of-band. **Merge/GRANTED status does not itself execute
> anything.** This document authorizes no production action.

## Production-enablement path (`--executeProduction`) — design §5

A production-project write is permitted **only** through `--executeProduction`,
which routes the run through the [`authPr4ProductionGate`](../../functions/scripts/authPr4ProductionGate.js).
It **requires a clean git checkout** and **fails closed in non-git contexts**. Before
any SDK init, the gate independently verifies, and **fails closed** on any of:

- **Repository-governed authorization artifact** — authority comes from the committed,
  git-tracked [`functions/authpr4/production-authorization.json`](../../functions/authpr4/production-authorization.json),
  read **from git at `--authorizedCommit`** (never an operator-authored path). Its
  status must be **`GRANTED`** (the committed artifact **is now `GRANTED`** and its
  three-file governed binding verifies at `reviewedHead bc0fda57`); strict schema (no unknown
  fields); project, exact ordered persona allowlist, reviewed head, and **blob-based**
  governed-file SHA-256 hashes must match; the operator's `--executionModeConfirmation` and
  `--executor` must equal the repository-recorded values ("nonempty" is not authorization). A
  modified/untracked/external/PENDING/stale-hash artifact, wrong path, unknown field, or hash
  drift → refuse. (A `GRANTED` artifact is necessary but **not** sufficient to run: the
  progression/genesis, break-glass, and private-input gates below still apply.)
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

`--executeProduction` against the **production project** now passes the `GRANTED`
authorization gate but still **fails closed** with no genesis/progression state, protected
state key, or private inputs present — so no production write occurs until the separate Gate A
+ Gate B authorizations and protected inputs are supplied. Against a **non-production/emulator**
project it is the "production-shaped" path exercised by tests. No CI/emulator test targets the
real `taylor-parts` project.

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
| Production-write block | Plain `--execute`/`--rollback` against `taylor-parts` **throws** (dry-run-only against production, execute-only against non-production). A production write is possible **only** via `--executeProduction` + the fail-closed `authPr4ProductionGate` (design §5, section above). The recorded authorization is now `GRANTED` and verifies, but the gate still fails closed without a genesis/progression state and the protected private inputs, so no production write runs until the separate Gate A + Gate B authorizations and inputs are supplied. |
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

### Reverse-order rollback-continuation (unwind)

A single `--rollback` restores the most-recently-completed persona and drives the progression
to **`suspended`**, which blocks every further step by design. To unwind the remaining migrated
identities, a governed **reverse-order rollback-continuation** resumes from `suspended` under the
explicit `--rollback --rollbackContinuation` opt-in — one identity per invocation, always the
current last-completed persona (reverse order), through to the **terminal `rolled_back`** state
(`completed === []`). It reuses the same claim/lease/anchor/two-phase machinery; a matching
signed rollback artifact is required per identity; the exact prior address + `emailVerified` are
restored; the artifact is deleted only after a confirmed mutation **and** durable progression;
uncertain outcomes retain the artifact and fail closed. See
[`auth-pr-4-rollback-continuation-design.md`](../deployment/auth-pr-4-rollback-continuation-design.md).

**Governance / enablement (three separately-authorized steps).** Changing governed files invalidates
the committed authorization binding **and** moves the workflow identity the existing signed
progression is bound to. Re-binding `production-authorization.json` **alone is not sufficient**: the
existing suspended state fails closed with *"bound to a different (stale) workflow identity"* until a
one-time governed **workflow-identity transition** (`authPr4InitProgression.js --mode
identity-transition`, credential-free, no SDK/network) re-signs it to the new identity. The
transition is **journaled and crash-safe**: it publishes a signed `.idtxn` intent before touching
state/anchor and removes it only after both verify under the new identity; an interrupted transition
is completed deterministically by `--mode identity-transition-recover` (rolls forward from the intent;
blocks on any substituted/foreign artifact). The transition and the generation-ledger advancement
(`reconcile-recover`) are **mutually exclusive** via a single owner-bound `.fencelock` both acquire
atomically and hold across their critical sections; a crash-left fence lock is cleared only by the
governed `--mode fence-inspect` + `--mode fence-recover` (owner-stopped attestation + fingerprint).
Full unwind =
**re-authorization → identity transition → continuation**, each separately authorized. This PR is
repo + emulator only and performs/authorizes none of them.

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
These examples perform writes **only** against a non-production project. A production
`--executeProduction` path now exists and passes the `GRANTED` authorization gate, but it
still **fails closed** and performs no write without a genesis/progression state and the
protected private inputs — none of which exist in the repository.

## Authorization boundaries of the execution gates

The GRANTED authorization + merged code do **not** by themselves execute anything. Two
separate, not-yet-granted Owner gates (**Gate A** — protected genesis preparation; **Gate B** —
one-persona-at-a-time execution), each narrowly scoped, gate what follows.

**1. Authorized only if Gate A and the narrowly scoped Gate B are later granted (and the
protected out-of-band inputs are supplied):**
- protected state-key / genesis-progression creation under **Gate A**;
- out-of-band **use** of the protected private alias/UID input under **Gate B** (see the
  use-vs-commitment note below);
- the single authorized persona's Firebase Auth **recovery/auth-email mutation** (that persona only);
- `emailVerified=false` on the new alias;
- **UID read-back verification** (the Auth UID must be unchanged);
- sanitized evidence emission and governed rollback handling.

**2. NOT authorized by Gate A or Gate B — each requires separate later authority, or remains
prohibited:**
- any reset or verification email delivery;
- explicit `revokeRefreshTokens` / operator-initiated session revocation (an *automatic*
  Firebase session effect from the email change is an observed platform effect, never an
  operator action);
- AUTH-PR-3 deployment;
- email-provider or Auth-project configuration / project-setting change;
- Firestore / Employee↔User-link / role / claim / `accessVersion` mutation;
- **committing** private emails, UIDs, alias mappings, state keys, credentials, or rollback
  data to the repository.

**Use vs. commitment:** a later Gate B permits the operator to **use** the private base inbox,
persona alias mapping, and UIDs **out-of-band** (never printed, never committed). It never
permits **committing** those values — or any key, credential, or rollback artifact — into the
repository. That prohibition is absolute and independent of any gate.
