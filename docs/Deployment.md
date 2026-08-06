# Deployment

**Class: AUTHORITATIVE.** Reconciled against repository evidence 2026-08-06 (Program 0 truth pass, base `origin/main` @ `633a335`). Where a fact cannot be established from repository evidence it is marked **UNKNOWN** with the exact read-only evidence needed — it is not guessed.

There are **four** independent deployment surfaces. They are not unified under one command, they do not share a promotion gate, and they are not automatically consistent with each other. Know which one you are touching.

| # | Surface | Trigger | Gated? | Current state |
|---|---|---|---|---|
| 1 | **GitHub Pages** (frontend) | **Automatic** on every push/merge to `main` | **NO** | Live. See the governance gap below. |
| 2 | **Firebase Hosting** (frontend) | Manual `firebase deploy --only hosting` | Yes — Owner-authorized | Live; last recorded release `1785135984867000` (2026-07-27). |
| 3 | **Cloud Functions** | Manual `firebase deploy --only functions:<name>` | Yes — Owner-authorized, per-function | 22 Functions live in `taylor-parts`/`us-central1`. |
| 4 | **Firestore Rules / indexes** | Manual `firebase deploy --only firestore:rules` | Yes — Tier 2, always | Deployed and verified live. **No CI deploys Rules.** |

---

## 1. GitHub Pages — automatic, ungated, and production-capable

`.github/workflows/deploy-field-ops.yml` runs on every push to `main`: builds `field-ops-app-vite`, assembles the root legacy `index.html` plus the Vite `dist/` under `site/field-ops/`, and publishes via GitHub's Pages action.

Live URL: `https://taylorservice-spec.github.io/Taylor_Parts/field-ops/`

**Classification: this surface is PRODUCTION, not preview or demo.** Established from repository evidence:

- `field-ops-app-vite/src/firebase/firebase.js` hardcodes the real client config — `projectId: "taylor-parts"`, the production `authDomain`, and `getFunctions(app, "us-central1")`. There is no build-time environment injection; the Pages workflow passes no `VITE_*` variables and consumes no secrets.
- The emulator branch is gated on `import.meta.env.DEV`, so a production build has no path to it. The Pages build therefore talks to the **production** Firestore, Auth, and Functions.
- `src/config/env.js` blocks writes only under `?env=demo` or the console panic switch. The default (`?env=prod` or no parameter) is **writes enabled**.

Consequently a merge to `main` publishes a fully functional, write-enabled production client with no release candidate, no Owner experience review, and no explicit production authorization.

### Recorded governance gap (open, unremediated)

This conflicts with the approved promotion lifecycle in [`engineering/AI_ENGINEERING_OPERATING_MODEL.md`](engineering/AI_ENGINEERING_OPERATING_MODEL.md) §7 — `SANDBOX → INTEGRATION → RELEASE CANDIDATE → OWNER EXPERIENCE REVIEW → PRODUCTION AUTHORIZED` — and with [`DelegationCharter.md`](DelegationCharter.md) §8.3/§8.7, which reserve production releases to the Owner and require an exact reviewed revision.

It also weakens a premise the default-autonomy model rests on: that repo-only merges are reversible and unreleased. **For the frontend, they are neither.**

**Status:** identified and recorded by the Program 0 truth pass; **no remediation is authorized or performed**. Disabling, restricting, or re-pointing this workflow would itself alter production behavior and is a protected action. A governed target-state promotion model and its implementation/release plan are tracked in [`reviews/eao-program-0-truth-pass.md`](reviews/eao-program-0-truth-pass.md).

**UNKNOWN (external read-only evidence required):** which surface real users actually use — the Pages URL or the Hosting URL — and whether both are in concurrent use. Evidence needed: the Owner's statement of the distributed URL, plus a read-only Hosting release listing (`firebase hosting:releases:list --project taylor-parts`) and a read-only fetch of both URLs' build fingerprints. Until established, **both must be treated as production**.

## 2. Firebase Hosting — manual, gated, and in use

`firebase.json` (repo root, tracked) configures Hosting to serve `field-ops-app-vite/dist` with a SPA catch-all rewrite; `.firebaserc` targets `taylor-parts`. Publishes to `taylor-parts.web.app` / `taylor-parts.firebaseapp.com`.

```bash
cd field-ops-app-vite && npm run build
cd .. && firebase deploy --only hosting     # Owner-authorized, human operator only
```

Hosting deploys are governed and evidenced — see [`operations/inv-convergence-e-c1-hosting-deploy-handoff.md`](operations/inv-convergence-e-c1-hosting-deploy-handoff.md), [`operations/inv-convergence-e-c2-hosting-deploy-handoff.md`](operations/inv-convergence-e-c2-hosting-deploy-handoff.md), and the release pins under [`audits/inv-convergence-e-c2-hosting-deploy/`](audits/inv-convergence-e-c2-hosting-deploy/).

> **Corrected 2026-08-06.** This section previously stated that Hosting was "configured, not yet the active path," that `firebase.json`/`.firebaserc` were "new and untracked in git," and that "nothing indicates a Hosting deploy has been run yet." All three were false: both files are tracked, and Hosting deployments are recorded with release pins and live-parity evidence.

## 3. Cloud Functions — manual, gated, per-function

**22 Functions are live** in `taylor-parts`/`us-central1` (Gen 2, `nodejs20`). Provenance: [`DECISIONS.md`](DECISIONS.md) #35/#36 (Rules + 11 Functions), the read-only [`audits/functions-live-state/`](audits/functions-live-state/) verification, and #63 (W3 receiving, estate 20 → 22, adding `receiveInventoryStock` and `listReceivingLocationOptions`).

**Not deployed:** the Enterprise Access mutation Functions, tracked by open **Issue #226** (Rows 19/20). Any UI copy implying the trusted access backend is generally undeployed should name #226, not the closed Issue #15.

Deploys are per-function, from one pinned reviewed revision, executed by the human operator under a separate Owner authorization, with pre/post estate reconciliation. See [`deployment/`](deployment/) for authorization packages and [`operations/`](operations/) for handoffs.

## 4. Firestore Rules and indexes — manual, Tier 2, no CI

There are **two** rules files that must stay in sync: `firestore.rules` (root, the deploy source) and `field-ops-app-vite/firestore.rules` (client-repo mirror).

**No workflow in `.github/workflows/` runs `firebase deploy`.** A merged rules change has **no effect on the live project** until a human runs:

```bash
firebase deploy --only firestore:rules    # Tier 2, Owner-authorized, human operator only
```

`.github/workflows/firestore-rules-regression.yml` runs the rules regression suite against the **emulator** — it is a gate, not a deploy. Use the `verify-rules-deploy` skill to confirm a rules change is actually live; merged never means live.

> Note: the emulator loads `firestore.rules` from the current working directory's branch. Running it from a stale checkout enforces the wrong rules.

## 5. Sandbox / emulator

`firebase.json` configures the Auth (9099), Firestore (8080), and Functions (5001) emulators. This is the `SANDBOX` environment of the promotion lifecycle: synthetic fixtures, no production credentials, no production writes. See [`DevelopmentSetup.md`](DevelopmentSetup.md), [`governance/execution-environments.md`](governance/execution-environments.md), and `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/`.

## 6. The protected operator boundary

The human operator executes **every** production-credentialed command. An AI agent may prepare, pin, verify, and evidence a deployment; it never runs one. Production authorization is per-action and per-scope — authorization for one deploy never carries to the next. See [`DelegationCharter.md`](DelegationCharter.md) §8.3/§8.7 and [`governance/execution-environments.md`](governance/execution-environments.md).

## Checklist before assuming a change is "live"

| Change | What makes it live |
|---|---|
| Frontend code | **Merged to `main` → already published to GitHub Pages automatically.** Firebase Hosting additionally requires a manual, authorized deploy. |
| `firestore.rules` | Manual `firebase deploy --only firestore:rules`. **Never automatic.** Verify with the `verify-rules-deploy` skill. |
| Cloud Function | Manual, per-function, Owner-authorized deploy from a pinned revision, with estate reconciliation. |
| Firestore indexes | Manual deploy; no CI path. |

## Resolved unknowns — read-only evidence, 2026-08-06

U-1 through U-5 were resolved by a read-only observation run; evidence and hashes at
[`audits/eao-readonly-evidence-20260806/`](audits/eao-readonly-evidence-20260806/).

- **U-1/U-2 — BOTH frontends are live, serve DIFFERENT builds, and BOTH are stale.** GitHub Pages
  serves `index-BsITcohF.js`, built from `6f25e13` (2026-08-06 07:40 UTC) — the last *successful*
  Pages deploy. The workflow is *intended* to track `main` on every merge, but its recent runs show
  **32 success / 4 failure / 4 cancelled**, with the four most recent `main` pushes all failing or
  cancelled on `The job was not acquired by Runner of type hosted` (GitHub runner capacity, not a
  code defect). **The production publish path is ungoverned *and* unreliable, and its failures are
  silent** — a merge that fails to publish produces no release record and no alert. Firebase Hosting serves `index-B7PB5BOc.js`
  and was **last released 2026-08-01 21:15:56** — five days and many merges stale. Only one
  Hosting site and only the `live` channel exist; there is no preview/staging channel.
  **Gating Pages before releasing Hosting would strand every user on a five-day-old build.**
  Neither surface reliably equals `main`; they differ only in degree of staleness.
- **U-3 — no backup or recovery posture exists.** `POINT_IN_TIME_RECOVERY_DISABLED`,
  `DELETE_PROTECTION_DISABLED`, `versionRetentionPeriod: 3600s`, zero backups, zero backup
  schedules. Recoverable history is **one hour**; a deletion or corruption older than that is
  unrecoverable. RTO undefined — no restore path exists.
- **U-4 — live composite indexes captured** as a baseline for future drift comparison.
- **U-5 — 22 Functions live, exactly matching the repository record** (`DECISIONS.md` #63).
  Eight truck-registry callables ARE deployed. **No Enterprise Access mutation callables are
  deployed**, confirming Issue #226 Rows 19/20 remain unexecuted.

## Recorded drift — declared vs live Firestore indexes (2026-08-06)

`firestore.indexes.json` declares **5** composite indexes (`employees` x2, `fieldops_wos` x2, `reorder_requests` x1). The live database has **6** — an additional index on **`fieldops_jobs`** that the repository does not declare.

**This is a latent production risk, not merely a documentation gap.** A repo-driven `firebase deploy --only firestore:indexes` reconciles live state to the declared set, so such a deploy **could delete the live `fieldops_jobs` index**, degrading or breaking whatever query depends on it. Indexes have never been deployed from this repository by any CI path (no workflow references `firebase deploy`), which is why the drift has persisted unnoticed.

It also blocks reproducibility: an environment built from the repository would not have that index, so it could not faithfully represent production behaviour.

### O-4 assessment and disposition (2026-08-06)

**Exact live definition:** `fieldops_jobs` composite, `COLLECTION` scope, `technicianId ASC` + `status ASC` (+ implicit `__name__`), state `READY`, `SPARSE_ALL`.

**Which queries require it: none currently.** The only live query against `fieldops_jobs` is `useAssignedJobs`, which is `where("technicianId", "==", ...)` — a **single-field** equality, satisfied by Firestore's automatic single-field index. No call site anywhere combines `technicianId` with a `status` filter or order. The index was presumably created for a query that no longer exists; provenance is not recoverable from the repository.

**Is the domain still live? Yes.** `fieldops_jobs` is read by `useAssignedJobs`, consumed by `FieldMode.jsx` and `PartsScanner.jsx` — the technician's primary surfaces. The domain is pending W4 convergence onto `fieldops_wos`, not retired.

**Disposition: DECLARE IT (repo-only), retire deliberately with W4.** The index is now declared in `firestore.indexes.json`, so **repo state matches live state and the silent-deletion path is closed**. Declaring costs nothing (the index already exists and is READY) and is strictly safer than leaving live state undeclared. It is *not* asserted to be required — it is preserved because removing it is a separate, deliberate decision that belongs with the W4 domain retirement, not to a side effect of an unrelated index deploy.

**No production index mutation was performed.** Declaring the index in the repository changes no live state; a future `firebase deploy --only firestore:indexes` is now non-destructive with respect to it.

### Fail-closed drift guard

`scripts/indexDriftGuard.mjs` + `scripts/indexDriftGuard.test.mjs` (8 tests) implement the standing rule: **a repo-driven index deployment must never silently delete an undeclared live index.** The guard compares declared vs live, classifies `wouldDelete` (destructive) separately from `wouldCreate` (additive), and **blocks a destructive deploy unless the authorization names every index to be deleted** — there is deliberately no blanket force flag, so the approval cannot be given without knowing what it destroys. `__name__` is normalized away, since Firestore appends it implicitly and including it would make every live index appear undeclared.

## Known unknowns

| # | Unknown | Read-only evidence that would resolve it |
|---|---|---|
| U-6 | ~~Live Firestore Rules text~~ | **RESOLVED 2026-08-06** via the Firebase Rules REST API (read-only, `x-goog-user-project` header). Live release `cloud.firestore` → ruleset `6316db98…`, 2026-08-04T21:32Z. **Code-only content is byte-identical to the repository**; 20 comment lines differ due to UTF-8 double-encoding introduced at deploy time (`Â§` vs `§`). A full-file live-vs-repo hash comparison therefore always mismatches — rules-deploy verification should compare comment-stripped content. |
