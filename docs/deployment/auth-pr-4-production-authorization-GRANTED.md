# AUTH-PR-4 — Production Identity-Mutation Authorization (GRANTED) & Execution Package

> **STATUS: GRANTED (governed decision from #52) — three-file re-binding PROPOSED in this
> DRAFT PR (2026-07-28), not yet finalized.** The governed decision (identities, order,
> exclusions, required behaviour) is recorded append-only in
> [`docs/DECISIONS.md` #52](../DECISIONS.md); the **three-file re-binding** is recorded in
> [`#53`](../DECISIONS.md) and applied to
> [`functions/authpr4/production-authorization.json`](../../functions/authpr4/production-authorization.json)
> in this PR. **Merging does NOT execute the migration.** Execution is a separate, controlled
> step (see §5). This re-authorization PR is DRAFT, subject to independent Codex review before
> any merge. Its CI-enforcement prerequisite is **now satisfied** — see the governance note below.
>
> **RE-BINDING PROPOSED (governed-set expansion).** PR #461 (merged `dba0e33`) added the
> genesis initializer (`functions/scripts/authPr4InitProgression.js`) to the gate's
> `GOVERNED_FILES` and changed `authPr4ProductionGate.js`, so the prior **two**-file binding
> at `reviewedHead c2604df` no longer verified (failed closed). This PR re-binds the
> authorization artifact to the **three**-file governed set at `reviewedHead dba0e33`, with
> all three governed blob hashes recomputed from that reviewed commit. The §1 table below
> reflects the new three-file binding. **Governance history:** PR #461 did **not** receive an
> unconditional Codex PASS — its **post-merge Codex review returned CHANGES REQUIRED** because
> the AUTH-PR-4 security suites (`test:authPr4Init` / `test:authPr4Gate` / `test:authPr4Migration`,
> with Auth-emulator coverage) were **not CI-enforced**. That gap was **subsequently corrected by
> PR #463** (merged `9b912d7`), which runs those suites in CI (`.github/workflows/authpr4-security-tests.yml`,
> gate/migration Auth-emulator layers on `demo-authpr4`).

| | |
|---|---|
| Gate | AUTH-PR-4 **production** recovery-email migration |
| Baseline / reviewed head | `dba0e33bd5f009c4374b8985af3a101d0d1e7777` (merge of PR #461 — governed genesis initializer + expanded 3-file `GOVERNED_FILES`) |
| Governing decision / re-binding | [`DECISIONS.md` #52 (GRANT)](../DECISIONS.md) · [#53 (three-file re-binding)](../DECISIONS.md) |
| Governing design | [`auth-pr-4-production-enablement-design.md`](./auth-pr-4-production-enablement-design.md), [`auth-pr-4-readiness-authorization-package.md`](./auth-pr-4-readiness-authorization-package.md), [`auth-pr-4-operator-workflow.md`](../operations/auth-pr-4-operator-workflow.md) |
| Firebase project | `taylor-parts` |
| Prepared by | Customer / Authentication execution session |

---

## 1. Authorization binding (committed artifact)

| Field | Value |
|---|---|
| `authorizationId` | `AUTHPR4-PROD-MIGRATION-001` |
| `authorizationStatus` | **GRANTED** (carried forward from #52; re-bound to the three-file governed set — see the change-scope note below) |
| `projectId` | `taylor-parts` |
| `reviewedHead` | `dba0e33bd5f009c4374b8985af3a101d0d1e7777` |
| `governedFileHashes` (blob SHA-256) | `authPr4RecoveryEmailMigration.js` = `779410d6…0b37ffd` (unchanged); `authPr4ProductionGate.js` = `ec140a0a…7df81f0` (changed by PR #461); `authPr4InitProgression.js` = `4b77b778…dba425c3` (new governed file) |
| `executionModeToken` | high-entropy `emt-…` (committed, **preserved from #52**; a repository-derived contract value, not a secret — the real controls are GRANTED status + production credentials + private inputs) |
| `executor.name` | `rudy-digiorgio` — the operator's `--executor` must match (**Owner-confirmed**, 2026-07-27) |
| `breakGlassContract` | `{ validityWindowSeconds: 600, requiredConfirmer: "rudy-digiorgio" }` (**Owner-confirmed**, 2026-07-27) |

**Change scope of this re-authorization PR:** the **three** governed workflow files
(`authPr4RecoveryEmailMigration.js`, `authPr4ProductionGate.js`, `authPr4InitProgression.js`)
are **unchanged** by this PR — they are already merged on `main` (PR #461, reviewed at
`bf393ba`, merged `dba0e33`). This PR changes **only** the authorization artifact (rebinding
`reviewedHead` to `dba0e33` and replacing `governedFileHashes` with the three governed blob
hashes recomputed from that commit), plus this runbook, `DECISIONS.md` #53, and a gate test.
The governed decision of #52 (identities, order, exclusions, required behaviour) is unchanged.
Any change to any of the three governed implementation files invalidates the binding
(different hashes) and requires a new Codex review + a re-bound authorization.

> **Named executor / confirmer (Owner-confirmed):** `executor.name = rudy-digiorgio` and
> `requiredConfirmer = rudy-digiorgio` were explicitly confirmed by the Owner on
> 2026-07-27. The operator's `--executor` and the break-glass confirmation's `confirmer`
> must equal these exact values.

## 2. Exact migration order (one identity at a time)

```
1  emp-rudy-driver             (technician, no ops role)        ← first, lowest risk
2  emp-rudy-parts-associate    (dispatcher, PARTS_ASSOCIATE)
3  emp-rudy-warehouse-manager  (dispatcher, WAREHOUSE_MANAGER)
4  emp-rudy-parts-manager      (dispatcher, PARTS_MANAGER)
── GATE: 1–4 PASS + break-glass FRESHLY confirmed recoverable + login-verified ──
5  emp-rudy-owner              (PRIMARY OWNER / admin)          ← last, only after the gate
```

## 3. Exclusions (never migrated)

- `emp-rudy-sales-manager` (no Auth account).
- **All break-glass identities** (untouched safety net).
- **Every identity not explicitly listed** in §2.

## 4. Required behaviour & stop conditions (enforced by the gate)

- Change **only** the Firebase Auth email; new alias `emailVerified=false`.
- Preserve UID and all Employee/User links. Do **not** change password / role /
  operationalRoles / claim / `accessVersion` / Firestore data / account enabled state.
- **No** reset or verification email. **No** explicit `revokeRefreshTokens` or other
  operator-initiated session revocation. A Firebase-triggered session effect is an
  **observed platform effect**, recorded, never an operator action.
- **HALT the entire sequence** on any failed / uncertain / disabled / missing /
  UID-mismatched / collision / integrity / ordering / read-back condition. Primary
  admin remains last; break-glass remains untouched.
- **Rollback (per identity):** restores the exact prior address + exact prior
  `emailVerified`, UID unchanged; rollback confirms read-back, durably records the
  SUSPENDED progression + anchor, and only **then** deletes the rollback artifact.
  On any uncertainty the rollback artifact is **retained** and the sequence stays
  blocking (governed reconciliation).
- **Evidence:** sanitized only (booleans / salted-hash refs / patterns). No real
  address, UID, token, credential, state key, or identity-linked value is committed.

## 5. Execution (LATER — not performed by this PR)

Execution is a separate controlled step **after** this authorization PR passes Codex
review and merges. In order:

1. Obtain the **private alias mapping** and **protected state key** out-of-band
   (never committed).
2. Confirm the **named executor** (`--executor` = the recorded contract value).
3. Initialise the signed genesis **progression state** (out-of-band, one-time) with the
   governed, credential-free initializer
   [`functions/scripts/authPr4InitProgression.js`](../../functions/scripts/authPr4InitProgression.js)
   — it refuses to overwrite, reads the GRANTED authorization + governed hashes at the
   authorized commit, creates the revision-0 eligible/position-1 signed state + anchor
   atomically (`0600`), and verifies both through the gate. **This file is part of the
   governed-file hash binding** (adding it required a re-bound authorization — see §1):

   ```bash
   node functions/scripts/authPr4InitProgression.js \
     --projectId taylor-parts --confirmProduction taylor-parts \
     --authorizedCommit <merged authorization head> \
     --executionModeConfirmation <token> --executor rudy-digiorgio \
     --stateKeyFile /secure/state.key --progressionOut /secure/progression.json
   ```
4. For each persona 1→5, run the workflow **once** with `--executeProduction`,
   `--authorizedCommit <merged authorization head>`, `--executionModeConfirmation
   <token>`, `--executor <name>`, `--mappingFile`, `--stateKeyFile`,
   `--progressionFile`, `--capturedStateOut` (and, for position 5, a fresh
   `--breakGlassConfirmationFile` produced after 1–4 complete and immediately before
   position 5). **Return sanitized evidence after each persona before advancing.**
5. **Any uncertainty halts the full sequence.**

## 6. Explicitly not authorized

Reset/verification emails · explicit session revocation · AUTH-PR-3 deployment ·
email-provider configuration · enumeration-protection changes · Auth project-setting
changes · Firestore mutation · role/claim/permission/`accessVersion` changes ·
Customer/Equipment combined release · Inventory / Equipment / Truck-Inventory work.

## 5a. Genesis reconciliation — governed state machine

The initializer publishes an owner-token `<progression>.init` **marker** before it
writes the signed state or anchor, and removes it only after **both** are fsynced and
independently verified through the gate. If initialization crashes at any boundary, the
marker (and any partial artifact) is left on disk; the production gate refuses **every**
step while a marker is present (`assertNoInitMarker`). The initializer **never**
auto-deletes an ambiguous or foreign marker, and never auto-reconciles during normal
initialization or execution. Reconciliation is a **separate, Owner-directed** step run
through the **same governed, credential-free command** — no ad-hoc `node -e` or manual
file deletion against production execution-control state.

### State machine

Artifacts (all beside `<progression>`): the signed `state` + `anchor`; the init `marker`;
the reconciliation `reconcile` mutex; the **fencing-generation ledger** `gen.<N>`. Runtime
`lock`/`txn` are never created by initialization and are always foreign here.

**The generation ledger is owned and validated by the gate** (`gate.readGenerationLedger`,
the single authority). It is an append-only, **hash-chained**, **contiguous** set of claim
files `gen.<1..K>`; the current generation is `K` (`0` if none). Authority is never a
filename: each claim's **content** is canonically validated (exact fields; embedded
`generation` must equal the filename; canonical `version`/`owner`/UTC `at`), the set must be
contiguous from `1`, and each claim must chain to the previous claim's content digest
(root-anchored at `N=1`). Any malformed, foreign, non-contiguous, reordered, reused, or
chain-broken ledger **fails closed**; so does any **inability to inspect** the ledger
directory (`EACCES`/`EPERM`/`EIO`/etc.) — only an **absent** containing directory (`ENOENT`,
a legitimate clean start) reads as generation `0`. `assertProductionAuthorization` runs this
same validation before any progression claim / Auth access, so a poisoned or unreadable
ledger blocks production, not just reconciliation. Advancing `K→K+1` is a single-winner O_EXCL claim
whose **staging temp lives outside the ledger namespace** (`<progression>.genstage-*`, never
matching `.gen.<N>`), so an in-progress or crash-left publication is never scanned as a
claim. *Residual (documented, out of the governed threat model):* an out-of-band **deletion
of the highest claim** regresses the visible ledger — but the ledger lives in the same
protected directory as the state key (deleting it is a key-level compromise), no governed
command ever deletes a claim, and any in-flight worker whose recorded generation exceeds the
current ledger fails closed at its next revalidation.

| State | On-disk condition | Gate | Legal transitions |
|---|---|---|---|
| `CLEAN` | no marker, no reconcile mutex | allowed | `initialize` → `INITIALIZED`/`INIT_INTERRUPTED` |
| `INITIALIZED` | canonical genesis `state`+`anchor`, no marker | allowed (proceed to execution) | — |
| `INIT_INTERRUPTED` | marker present (± partial state/anchor) | **blocked** | `inspect` (read-only) → `cleanup`/`recover` |
| `RECONCILING` | reconcile mutex present | **blocked** | `cleanup` (owner) or `recover` (stranded) |
| `BLOCKED` | malformed/foreign/anomalous artifact, `lock`/`txn`, invalid genesis, ledger anomaly | **blocked** | Owner escalation only — no automated transition |

**Ownership of destructive transitions (exactly one owner each):**
- **cleanup** acquires the reconcile mutex by **atomic exclusive publication** (write full
  content to a temp file, `fsync`, hard-link into place — EEXIST ⇒ someone else holds it,
  refuse). The published mutex is complete-or-absent, so an in-progress publication can never
  be read as crash residue. The cleanup operates *at* the current generation.
- **recovery** acquires authority by a **single-winner compare-and-swap** on the generation
  ledger: O_EXCL create of `gen.<current+1>`. Exactly one racer wins; a delayed recovery
  bound to an older generation cannot leapfrog or reuse a newer one (the claim already
  exists ⇒ EEXIST ⇒ refuse). Ownership is never a bare pathname check-then-delete.

**Step 1 — inspect (read-only).** Classifies the marker + residue and returns a
sanitized report (booleans/refs + a content **fingerprint**); prints no key, token, or path:

```bash
node functions/scripts/authPr4InitProgression.js --mode reconcile-inspect \
  --projectId taylor-parts --confirmProduction taylor-parts \
  --authorizedCommit <merged authorization head> \
  --executionModeConfirmation <token> --executor rudy-digiorgio \
  --stateKeyFile /secure/state.key --progressionOut /secure/progression.json
```

The marker is validated by the gate's **single canonical validator** — a marker the
governed initializer could not have produced (wrong/extra fields, bad version, non-UTC
timestamp, or a token that is not exactly 32 lowercase hex) is untrusted → `blocked`.

The report's `recommendation` is one of:
- **`marker-only`** — the signed state **and** anchor verify as a canonical revision-0
  eligible/position-1 genesis; only the stray marker must be removed.
- **`clean-reset`** — the state is absent or a clearly-incomplete partial (or a valid
  genesis with no committed anchor); the marker/state/anchor set is safe to remove and re-init.
- **`blocked`** — indeterminate/untrusted: wrong key, foreign/malformed marker, a valid
  **non-genesis** progression, a bad anchor, **or the presence of a runtime claim `lock`
  or transition `txn`** (the genesis initializer never creates those, so their presence is
  foreign/concurrent). **No automatic cleanup** — escalate to the Owner; delete nothing.
  A `clean-reset` **never** targets `lock`/`txn`.

**Step 2 — cleanup (Owner-confirmed, fingerprint-bound, confined, fenced).** It reads the
current generation from the ledger, then **atomically publishes** the reconciliation mutex
(recording that generation). It re-inspects **under the mutex**, requires the exact step-1
fingerprint (refuses if the set changed), `--action` equal to the inspected recommendation,
and the confirmation token. It deletes **only** the genesis-creatable artifacts
(`marker`/`state`/`anchor`), and **before every deletion and before finalization it
revalidates both that it still owns the mutex token AND that the generation has not
advanced**, plus re-verifies each file's current digest against the inspected digest
**immediately before unlink**. On any deletion-phase failure (fenced, digest change, unlink
failure, partial cleanup) it **fails closed**: the reconciliation mutex is **retained** (the
gate refuses every production step, `assertNoReconcileMutex`) and the stranded mutex is
resolved only by the governed **step 3** recovery — never by hand. The mutex is removed on
the happy path only after a final ownership+generation revalidation and only while it still
carries the owner token. A pre-existing mutex refuses a second concurrent cleanup. (A
validation-only refusal — wrong `--action`, stale fingerprint, `blocked` — releases the
mutex so the operator can re-inspect and retry.) It refuses any `blocked` classification:

```bash
node functions/scripts/authPr4InitProgression.js --mode reconcile-cleanup \
  --projectId taylor-parts --confirmProduction taylor-parts \
  --authorizedCommit <merged authorization head> \
  --executionModeConfirmation <token> --executor rudy-digiorgio \
  --stateKeyFile /secure/state.key --progressionOut /secure/progression.json \
  --fingerprint <fingerprint from step 1> \
  --action <marker-only|clean-reset> --confirmReconciliation reconcile-genesis
```

A `clean-reset` deletes in the order **state → anchor → marker** (the marker is removed
**last**): as long as any genesis residue exists, the "reconciliation needed" signal
survives, so a partial `clean-reset` is **self-healing** — re-running step 1 + step 2
finishes it. After a completed `clean-reset`, re-run the genesis initializer (§5.3) to a
clean state.

> **Destructive-boundary guarantee (exactly what is implemented).** The ownership/generation
> revalidation and the target unlink are separate syscalls, so they cannot be made a single
> atomic operation with plain-filesystem primitives. The **hard** guarantee is the **per-target
> digest binding**: immediately before each unlink the cleanup re-hashes the target and refuses
> unless it is **byte-identical** to what step 1 inspected — so a superseded cleanup can, in the
> sub-operation window after its generation check, delete **only the exact artifact it already
> inspected, never a newer or replacement artifact** (a replacement has a different digest and
> aborts the cleanup). Generation fencing is **defense in depth** that stops a superseded
> cleanup at its *next* checkpoint; it is **not** claimed to make every in-flight unlink
> impossible. The **primary operational exclusion** — that a prior cleanup is not running at
> all — is the Owner-stopped attestation required by step 3, not the fencing.

**Step 3 — recover a stranded reconciliation mutex (only if a cleanup crashed).** If a
cleanup process was killed (or aborted on a partial cleanup / unlink failure), the
reconciliation mutex is retained and the gate blocks — and every step-2 cleanup then
refuses ("a reconciliation mutex is already present"). This is the **only** governed way to
clear it.

Recovery does **not** infer that the prior cleanup is dead. **Elapsed time is not proof**
(a paused process, machine suspension, debugger stop, or blocked filesystem can keep a
cleanup live for arbitrarily long), and a **malformed mutex is not proof** either (it may be
foreign, corrupt, or a version skew). Recovery therefore requires **both**:

- an explicit governed attestation that the prior cleanup process/host has stopped —
  `--confirmOwnerStopped prior-cleanup-stopped` — which is a **human/operator judgement**
  the Owner is accountable for; **and**
- **fencing + single-winner acquisition**, not inference. Recovery acquires authority by a
  compare-and-swap advance of the generation ledger (O_EXCL `gen.<current+1>`): exactly one
  recovery wins; a delayed recovery bound to an older generation refuses (the newer claim
  already exists). Holding the new generation, it **re-binds to the exact inspected mutex**
  (re-reads the fingerprint and requires the mutex's content digest to be unchanged) and only
  then removes **that** mutex — never a mutex it did not inspect. A new cleanup cannot begin
  during this critical section: the mutex recovery is about to remove is still present, so a
  cleanup's exclusive publish fails closed. Because a live cleanup revalidates the generation
  before every deletion and finalization (step 2), the advanced generation **supersedes** it
  at its next checkpoint (see the destructive-boundary guarantee above for the exact, honest
  scope). All genesis residue is left intact for a subsequent normal step 1 + step 2. Recovery
  also requires the prior inspect fingerprint (refuses if artifacts changed) and the
  `recover-mutex` confirmation. If a recovery itself crashes after the CAS but before removing
  the mutex, the gate stays blocked (mutex present) and the next attested recovery completes
  it — recovery is itself crash-recoverable:

```bash
node functions/scripts/authPr4InitProgression.js --mode reconcile-recover \
  --projectId taylor-parts --confirmProduction taylor-parts \
  --authorizedCommit <merged authorization head> \
  --executionModeConfirmation <token> --executor rudy-digiorgio \
  --stateKeyFile /secure/state.key --progressionOut /secure/progression.json \
  --fingerprint <fingerprint from step 1> \
  --confirmReconciliation recover-mutex --confirmOwnerStopped prior-cleanup-stopped
```

**Governed evidence for `--confirmOwnerStopped`:** before attesting, confirm out-of-band
that the prior cleanup process is no longer running and its host/session is stopped (e.g.
the terminal/session was terminated, the host was powered off, or process-manager evidence
shows the PID is gone). The fencing generation is the technical safety net if that judgement
is ever wrong; the attestation is the accountable human gate. Any unknown host, unverifiable
owner, malformed publication, clock/fence anomaly, or concurrent change **blocks** — it is
never read as owner death.

The recover report's `residualRecommendation` tells you the next governed step (usually
re-run step 1 + step 2). Record a sanitized reconciliation note (booleans/refs/fingerprint/
generation only) — no key, path, token, or identity value.

## 7. Confirmation (this PR — three-file re-authorization)

No production action occurred in preparing this PR: no Auth mutation, no email, no session
revocation, no deployment, no provider config, no private mapping/state-key/genesis requested
or committed, no dry-run.

**Lineage.** The `PENDING → GRANTED` transition of
[`production-authorization.json`](../../functions/authpr4/production-authorization.json) was
performed historically by PR #460 (merged `70c3989`, [`DECISIONS.md` #52](../DECISIONS.md)),
bound to the **two**-file governed set at `reviewedHead c2604df`. PR #461 (Codex-reviewed at
`bf393ba`, merged `dba0e33`) then added the governed genesis initializer
(`functions/scripts/authPr4InitProgression.js`) and changed `authPr4ProductionGate.js`,
**expanding `GOVERNED_FILES` to three files** — which invalidated the two-file binding
(fails closed), and PR #461 itself left the artifact unchanged/stale by design. **Governance
history:** PR #461 did **not** receive an unconditional Codex PASS — its **post-merge Codex
review returned CHANGES REQUIRED** because the AUTH-PR-4 security suites (`test:authPr4Init` /
`test:authPr4Gate` / `test:authPr4Migration`, with Auth-emulator coverage) were **not
CI-enforced**. That gap was **subsequently corrected by PR #463** (merged `9b912d7`), which runs
those suites in CI.

**What this PR does.** It is the Owner-authorized ([`DECISIONS.md` #53](../DECISIONS.md))
**repository-only three-file re-authorization**: it rebinds the artifact's `reviewedHead` to
`dba0e33` and replaces `governedFileHashes` with the **three** governed blob hashes recomputed
from that commit, preserving `authorizationId`, `authorizationStatus: GRANTED`, `projectId`,
`personaOrder`, `executor.name`, `breakGlassContract`, and `executionModeToken` from #52. The
three governed implementation files are **unchanged** by this PR (already merged via #461); the
only changes are the authorization artifact, this runbook, `DECISIONS.md` #53, and a gate test
proving the artifact verifies against the exact 3-file binding and fails closed for a missing,
substituted, stale, or drifted governed file.

**Merging this PR does not execute the migration** and deploys nothing; execution remains the
separate, later gate defined by #52 and §5. Draft — returned for independent Codex review; not
merged; genesis not created; execution not begun. Preparing this PR does **not** authorize
merging it, creating the state key or genesis, requesting private inputs, or any production/Auth
action.
