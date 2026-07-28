# AUTH-PR-4 — Production Identity-Mutation Authorization (GRANTED) & Execution Package

> **STATUS: GRANTED by the Owner (2026-07-27)** — but see the re-authorization note.
> Recorded append-only in [`docs/DECISIONS.md` #52](../DECISIONS.md) and enabled in
> [`functions/authpr4/production-authorization.json`](../../functions/authpr4/production-authorization.json)
> (`PENDING → GRANTED`). **Merging does NOT execute the migration.** Execution is a
> separate, controlled step (see §5). Subject to Codex review before merge.
>
> **⚠ RE-AUTHORIZATION REQUIRED (governed-set expansion).** The genesis initializer
> (`functions/scripts/authPr4InitProgression.js`) was added to the gate's
> `GOVERNED_FILES` binding (Owner-decided). The governed set is now **three** files,
> so the authorization artifact recorded here — bound to the **two**-file set at
> `reviewedHead c2604df` — **no longer verifies (fails closed)**. Production execution
> is blocked until a **new** Owner authorization PR re-binds the artifact to this
> correction's merged head + the **three**-file `governedFileHashes`. The §1 table
> below still shows the prior two-file binding; it is superseded by that re-grant.

| | |
|---|---|
| Gate | AUTH-PR-4 **production** recovery-email migration |
| Baseline / reviewed head | `c2604dff3fcbcd3f9442648484e6d407b67444ef` (merged enablement gate, PR #457) |
| Governing design | [`auth-pr-4-production-enablement-design.md`](./auth-pr-4-production-enablement-design.md), [`auth-pr-4-readiness-authorization-package.md`](./auth-pr-4-readiness-authorization-package.md), [`auth-pr-4-operator-workflow.md`](../operations/auth-pr-4-operator-workflow.md) |
| Firebase project | `taylor-parts` |
| Prepared by | Customer / Authentication execution session |

---

## 1. Authorization binding (committed artifact)

| Field | Value |
|---|---|
| `authorizationId` | `AUTHPR4-PROD-MIGRATION-001` |
| `authorizationStatus` | **GRANTED** (the previously PENDING placeholder artifact is fully populated and its status set to GRANTED; see the change-scope note below) |
| `projectId` | `taylor-parts` |
| `reviewedHead` | `c2604dff3fcbcd3f9442648484e6d407b67444ef` |
| `governedFileHashes` (blob SHA-256) | `authPr4RecoveryEmailMigration.js` = `779410d6…0b37ffd`; `authPr4ProductionGate.js` = `0609613c…c4b0b8af` |
| `executionModeToken` | high-entropy `emt-…` (committed; a repository-derived contract value, not a secret — the real controls are GRANTED status + production credentials + private inputs) |
| `executor.name` | `rudy-digiorgio` — the operator's `--executor` must match (**Owner-confirmed**, 2026-07-27) |
| `breakGlassContract` | `{ validityWindowSeconds: 600, requiredConfirmer: "rudy-digiorgio" }` (**Owner-confirmed**, 2026-07-27) |

**Change scope of this authorization PR:** the two governed workflow **implementation**
files (`authPr4RecoveryEmailMigration.js`, `authPr4ProductionGate.js`) are **unchanged**
— the authorization binds to their exact reviewed blob-SHA-256 hashes, so no workflow-code
re-review is needed. The previously **PENDING placeholder** artifact is **fully populated
and its status changed to GRANTED** (`authorizationId`, `reviewedHead`, both governed-file
hashes, `executionModeToken`, `executor.name`, and `requiredConfirmer` populated from their
placeholders). Any change to the governed implementation files invalidates the binding
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

## 5a. Genesis reconciliation (crash-left init marker) — governed commands

The initializer publishes an owner-token `<progression>.init` **marker** before it
writes the signed state or anchor, and removes it only after **both** are fsynced and
independently verified through the gate. If initialization crashes at any boundary, the
marker (and any partial artifact) is left on disk; the production gate refuses **every**
step while a marker is present (`assertNoInitMarker`). The initializer **never**
auto-deletes an ambiguous or foreign marker, and never auto-reconciles during normal
initialization or execution. Reconciliation is a **separate, Owner-directed** step run
through the **same governed, credential-free command** — no ad-hoc `node -e` or manual
file deletion against production execution-control state.

**Step 1 — inspect (read-only).** Classifies the marker + residue and returns a
sanitized report (booleans/refs + a content **fingerprint**); prints no key, token, or path:

```bash
node functions/scripts/authPr4InitProgression.js --mode reconcile-inspect \
  --projectId taylor-parts --confirmProduction taylor-parts \
  --authorizedCommit <merged authorization head> \
  --executionModeConfirmation <token> --executor rudy-digiorgio \
  --stateKeyFile /secure/state.key --progressionOut /secure/progression.json
```

The report's `recommendation` is one of:
- **`marker-only`** — the signed state **and** anchor verify as a canonical revision-0
  eligible/position-1 genesis; only the stray marker must be removed.
- **`clean-reset`** — the state is absent or a clearly-incomplete partial (or a valid
  genesis with no committed anchor); the whole residue set is safe to remove and re-init.
- **`blocked`** — indeterminate/untrusted (wrong key, foreign/tampered marker, a valid
  **non-genesis** progression, or a bad anchor). **No automatic cleanup** — escalate to
  the Owner; do not delete anything.

**Step 2 — cleanup (Owner-confirmed, fingerprint-bound, confined).** Runs only after an
inspect, re-verifies, requires the exact fingerprint from step 1 (refuses if the artifact
set changed since inspection), requires `--action` to equal the inspected recommendation,
requires the explicit confirmation token, and deletes **only** the exact derived artifact
paths (`state`/`anchor`/`marker`/`lock`/`txn`). It refuses any `blocked` classification:

```bash
node functions/scripts/authPr4InitProgression.js --mode reconcile-cleanup \
  --projectId taylor-parts --confirmProduction taylor-parts \
  --authorizedCommit <merged authorization head> \
  --executionModeConfirmation <token> --executor rudy-digiorgio \
  --stateKeyFile /secure/state.key --progressionOut /secure/progression.json \
  --fingerprint <fingerprint from step 1> \
  --action <marker-only|clean-reset> --confirmReconciliation reconcile-genesis
```

After a `clean-reset`, re-run the genesis initializer (§5.3) to a clean state. Record a
sanitized reconciliation note (booleans/refs/fingerprint only) — no key, path, token, or
identity value.

## 7. Confirmation (this PR)

No production action occurred in preparing this PR: no Auth mutation, no email, no
session revocation, no deployment, no provider config, no private mapping/state-key
requested or committed, **no re-grant of the authorization artifact**.

**What this PR changes vs. what PR #460 did.** The `PENDING → GRANTED` transition of
[`production-authorization.json`](../../functions/authpr4/production-authorization.json)
was performed **historically by PR #460** (merged `70c3989`, [`DECISIONS.md` #52](../DECISIONS.md)),
which populated the placeholder and bound it to the **two**-file governed set at
`reviewedHead c2604df`. **This PR (the genesis-initializer correction)** does something
different: it adds the governed, credential-free initializer
[`functions/scripts/authPr4InitProgression.js`](../../functions/scripts/authPr4InitProgression.js)
and **expands the gate's `GOVERNED_FILES` to three files**. That expansion **invalidates
the existing two-file authorization (fails closed)** — `governedFileHashes` no longer
covers the governed set. This PR **leaves `production-authorization.json` unchanged**
(now stale) and **does NOT re-grant**. Production execution stays blocked until a
**separate** Owner authorization PR re-binds the artifact to this correction's merged head
and the **three**-file `governedFileHashes` (see the ⚠ re-authorization note at the top and
§1). The §1 table and §1 change-scope note describe the historical two-file binding and are
superseded by that forthcoming re-grant. Draft — returned for Codex review; not merged;
genesis not created; execution not begun.
