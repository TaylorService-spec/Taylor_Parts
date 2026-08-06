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

## Known unknowns

| # | Unknown | Read-only evidence that would resolve it |
|---|---|---|
| U-1 | Which frontend surface real users use (Pages vs Hosting), and whether both are live concurrently. | Owner statement of the distributed URL + `firebase hosting:releases:list` + read-only fetch of both URLs. |
| U-2 | Whether the currently-published Pages build matches the current `main` build fingerprint. | Read-only fetch of the Pages asset manifest vs a local `npm run build` at the same SHA. |
| U-3 | Whether any Firestore backup/PITR configuration exists on `taylor-parts`. | `gcloud firestore databases describe` (read-only). No repository evidence of any backup posture exists. |
| U-4 | Live index state vs `firestore.indexes.json`. | `firebase firestore:indexes --project taylor-parts` (read-only). |
