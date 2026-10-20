# Production recovery release R1 (taylor-parts)

**Issued:** 2026-10-20 (America/Phoenix) · **Base:** `origin/main` `2f8be86f064c506e832e48694c8e22115558a24e` · **Lane:** R1 (repo-side, read-only analysis)
**Status:** evidence record + operator recipe. Nothing here deploys, tags, pushes or calls a cloud API. The human operator runs every command below.
**Gate:** `evidence/firebase-replacement-matrix-2026-10-19.md` row R1. This release must be preserved before any Firebase client or server code is deleted (rows X1-X5).

Sources: `evidence/firebase-deployed-functions-and-pcc-risk-2026-10-19.md`; `evidence/firebase-deployed-inventory-20261019/` (`functions-taylor-parts.json`, `comparison-vs-main.txt`, `taylor-parts-firestore.rules`); git history only.

## 1. What is in production

| Surface | Revision (full SHA) | Built from | Source of the claim |
|---|---|---|---|
| Firebase Hosting `https://taylor-parts.web.app` | `4f30ab3ad7c434da0dd8ff043ecd65d0bdef8a72` (2026-08-19 16:55:21 -0700, PR #1338) | `field-ops-app-vite`, `npm run build:firebase` (`vite build --base=/`) | Owner evidence (`/version.json`); commit exists on `main` |
| GitHub Pages `https://taylorservice-spec.github.io/Taylor_Parts/` | `6cac04232c813af7695187ee7a4ced74ecd72760` (2026-09-19 13:51:27 -0700, merge of PR #1955) | `.github/workflows/deploy-field-ops.yml` as it was at that commit: `npm run build`, site = root `index.html` + `field-ops/` + `404.html` | Owner evidence; `docs/deployment/github-pages-promotion-governance-decision.md:40` names `6cac0423` as the last automatic publish |
| Cloud Functions, project `taylor-parts`, `us-central1`, Gen 2, `nodejs22` | **`4f30ab3ad7c434da0dd8ff043ecd65d0bdef8a72`** (see section 3) | `functions/` | export-set match, 84 of 84, zero residual; deploy timing |
| Firestore Rules | `0526140d49ea4add988cd0e655929e75ab216723` (2026-08-06 21:19:37 -0700), 1,718 lines | `firestore.rules` | the live ruleset in the evidence directory is byte-identical to this blob (sha256 below) |

Hosting and Pages are different commits. `checkDeployedVersions.mjs` has reported this disagreement since 2026-09 (`docs/releases/sandbox-release-readiness-2026-09-03.md:278`). Rules are a third revision, older than both: **never redeploy Rules from `4f30ab3a` or `6cac0423`**. Their `firestore.rules` blobs differ from the live ruleset (`4f30ab3a`: sha256 `4605a7f0775986da...`; main: `db665ac77cb43c0c...`).

Rules identity (verified locally, no cloud call):

```
sha256(evidence/firebase-deployed-inventory-20261019/taylor-parts-firestore.rules)
  = ec1f0a9b78d937d1eff1aef6c2588b20a0dc77501b392e560b491e7c13b1ccd1
sha256(git cat-file -p 0526140d49ea4add988cd0e655929e75ab216723:firestore.rules)
  = ec1f0a9b78d937d1eff1aef6c2588b20a0dc77501b392e560b491e7c13b1ccd1      (identical)
```

No Firestore trigger, scheduler, auth trigger or event function is deployed. All 84 production functions are callables.

## 2. Commits and tags

Both commits are present in `main`'s history (`git cat-file -t` returns `commit`; `4f30ab3a` is an ancestor of `origin/main`). Short forms `4f30ab3ad7c4` and `6cac04232c81` resolve to the full SHAs above. No `production-release/*` tag exists yet.

The controller creates the tags after review (this lane did not):

```bash
git tag -a production-release/hosting-4f30ab3ad7c4 4f30ab3ad7c434da0dd8ff043ecd65d0bdef8a72 \
  -m "Production Hosting (taylor-parts.web.app) as served 2026-10-19; npm run build:firebase"
git tag -a production-release/pages-6cac04232c81 6cac04232c813af7695187ee7a4ced74ecd72760 \
  -m "Production GitHub Pages as served 2026-10-19; last automatic push publish (PR #1955)"
# Proposed third tag, same commit as Hosting (the controller decides whether to add it):
git tag -a production-release/functions-4f30ab3ad7c4 4f30ab3ad7c434da0dd8ff043ecd65d0bdef8a72 \
  -m "Production Functions: 84 callables; export set matches exactly (docs/operations/production-recovery-release-r1.md)"
git push origin production-release/hosting-4f30ab3ad7c4 production-release/pages-6cac04232c81
```

## 3. Functions source revision

**Result: `4f30ab3ad7c434da0dd8ff043ecd65d0bdef8a72`, exact export-set match (84 deployed, 84 exported, 0 missing, 0 extra).**

Method (git history + the deployed name list only):
1. Take the 84 `id`s from `functions-taylor-parts.json` (all `callableTrigger`, `nodejs22`, one `codebase: default`).
2. For each first-parent commit that touches `functions/src/index.ts`, parse its `export { ... } from` names (comments stripped; `X as Y` counts as `Y`, the deployed name; there is no `export *` and no other export form) and diff against the 84.
3. The set equals the deployed set exactly on the contiguous range **`5db798dc6c5ff6d565a75daf0b6956f7d2f5cfb7` (2026-08-18 09:01:58 -0700) through `969305e16eb0e21660903c03db58ef4bce42a6c9` (2026-08-19 20:52:33 -0700)**. Edges: `abfd3ee7b` (the previous `index.ts` change) is missing 1 deployed name; `f669fbd57e2af8ed2a5e20f8e3846e0ed18bbd46` (the next change) exports 2 extra.
4. Narrowing inside that range, from the evidence JSON: every function's source upload (`source.storageSource.generation`, microseconds since epoch) falls between 2026-08-19T23:57:42Z and 2026-08-20T00:01:21Z, which is 16:57:42 to 17:01:21 -0700. That is one deploy, 2m21s after `4f30ab3a` was committed (16:55:21 -0700) and almost four hours before the next merge (`98dc59f2`, 20:45). All 84 carry the same `firebase-functions-hash` label (`64cbe8d4eb65923ce4e48981fa29e2389159f39f`). `4f30ab3a` is the first commit after the production release runbook `scripts/_prodRelease.run.sh` (#1337) merged.
5. `functions/` is byte-identical (git tree `92b86129e5597c1f786a4f8211e33a3fa8b91f02`) at `c560f096e` (16:27) and `4f30ab3a`, so any deploy from that 28-minute window ships the same functions source.

Residual uncertainty (stated, not hidden):
- The export set cannot distinguish commits in the 5db798dc6..969305e16 range from function-body changes. About 21 commits touched `functions/src` in that range (for example #1310 blind cycle counts, #1324 admin CRM grants, #1325/#1332/#1334 access changes). Step 4 is the only evidence that selects `4f30ab3a`; it assumes the operator deployed from a checkout of `main` at the tip.
- Conclusive proof would compare the `firebase-functions-hash` (a SHA-1 label of the uploaded source archive) against a rebuild, or download the stored archive (`gcf-v2-sources-664399427363-us-central1/<fn>/function-source.zip`). Both need cloud access or a reproducible zip, so neither was attempted. Operator follow-up if you want certainty before deleting anything.
- Treat `4f30ab3a` as the recovery revision for Functions. If a later check disagrees, the exact-match window above is the fallback bound.

The 42 deployed functions that current `main` no longer exports (sales and opportunities, trucks, transfers, cycle counts, suppliers and parts, `getAvailableEquipment`, `getLocationDisplay`, `listReceivingLocationOptions`, `updateWorkOrderExecutionData`; list in `comparison-vs-main.txt`) all exist at `4f30ab3a`. The 2026-10-19 comparison counted 42 against `main` `77d7745d`; against today's `main` the same diff is 41 missing and 39 extra, because `main` has moved. The recovery revision is the commit, not that diff.

Reproduce the check without any cloud access:

```bash
git cat-file -p 4f30ab3ad7c434da0dd8ff043ecd65d0bdef8a72:functions/src/index.ts \
  | sed -E 's://.*$::' | tr -d '\n' | grep -oE 'export *\{[^}]*\}' \
  | sed -E 's/export *\{//; s/\}//' | tr ',' '\n' | sed -E 's/^ *//; s/ *$//; s/^.* as //' | grep . | LC_ALL=C sort > /tmp/src84.txt
# deployed list: the "id" values in evidence/firebase-deployed-inventory-20261019/functions-taylor-parts.json, LC_ALL=C sorted
diff /tmp/deployed84.txt /tmp/src84.txt && echo EXACT
```

### The 84 production callables

activateSupplier allocateSalesOrder applyPayment approveAccessRequest assignApprovedRole assignTruckDriverCallable cancelCycleCount cancelTransferOrder changeManufacturerStatus changePartStatus changePartSupplierItemStatus changeTruckHomeWarehouseCallable changeTruckStatusCallable completeAssignedJob createCoverageAssignment createCrmActivity createCycleCount createManufacturer createOpportunity createPart createPartSupplierItem createSalesOrder createSalesOrderFromOpportunity createSalesTerritory createSavedDefinitionCallable createServiceForSalesOrder createSupplier createTransferOrder createTruckCallable createWorkOrder deactivateSupplier deactivateTruckCallable deleteSavedDefinitionCallable deleteTruckCreatedInErrorCallable detectInventoryEffects dispatchTransferOrder duplicateSavedDefinitionCallable getAccountPortfolioSummary getAvailableEquipment getCrmActivities getInventoryAnalytics getLocationDisplay getManufacturerCatalog getSalesOrderContext getSavedDefinitionCallable getWorkOrderFieldContext grantRole initiateAdminPasswordReset issueInvoice listAccountInvoiceAr listCoordinatedOperations listOpportunitiesForAccount listOpportunityContext listReceivingLocationOptions listResetEligibleUsers listSalesOrderIndex listSalesOrdersForAccount listSavedDefinitionsCallable reactivateTruckCallable reassignTruckDriverCallable receiveInventoryStock receiveTransferOrder reconcileCycleCount recordInvoiceAdjustment recordRefund rejectAccessRequest renameSavedDefinitionCallable resolveCoverageForContext resolveEffectiveAccessCallable revokeRole runReportDefinitionCallable setPreferredSupplier setUserStatus setWorkOrderPartsPlan submitCycleCount transitionOpportunity transitionSalesOrder transitionWorkOrder unassignTruckDriverCallable updateManufacturer updatePart updatePartSupplierItem updateSupplier updateWorkOrderExecutionData

## 4. Production `config/environments.json` entry

The entry is `id: taylor-parts-production`, `role: production`, `deployment: taylor-parts`, `status: live`; `defaultEnvironmentId` is `taylor-parts-production`, so a bare build resolves to it. It differs by commit, so rebuild from the tagged commit's own file rather than from `main`.

| File blob | Commit |
|---|---|
| `14be4994cf0b9ba58236260e174dab43d5274582` | `4f30ab3a` (Hosting build) |
| `0d0050b2e7f6f2b0952d5bdcacec0d061721d7a3` | `6cac0423` (Pages build) |

Non-secret content (identical `firebase` block at both commits; the `apiKey` is a public Firebase Web identifier by the file's own comment and is intentionally not repeated here):

- `firebase.projectId` `taylor-parts`; `authDomain` `taylor-parts.firebaseapp.com`; `storageBucket` `taylor-parts.firebasestorage.app`; `messagingSenderId` `664399427363`; `appId` `1:664399427363:web:de29dd9ae77bf548907e96`; `functionsRegion` `us-central1`.
- `eosApi` is absent at both commits and is `null` on current `main`: the EOS API refuses production, so the production build is Firebase-backed.
- `surfaces`: `hosting` (`firebase-hosting`, `https://taylor-parts.web.app`, `/version.json`, governed) and `pages` (`github-pages`, `https://taylorservice-spec.github.io/Taylor_Parts/field-ops`, `/version.json`, not governed).
- Readiness flags at `4f30ab3a`: all `false` except `TRUSTED_COMPLETION_ENABLED: true`. At `6cac0423` the entry also carries `productionCapabilityActivations` (25 `report.*` entries) and `privateAiSyntheticOperationalInterpretation: false`.

## 5. Operator recovery (human operator only; placeholders in angle brackets)

Always use a clean checkout of the tag in a new directory. At `4f30ab3a` `.firebaserc` still defaults to `taylor-parts` and the F0 deploy guard (`scripts/firebaseDeployGuard.mjs`) does **not** exist, so a missing `--project` would target production silently. Pass `--project taylor-parts` explicitly and nothing else. Authenticate through your normal operator login; nothing below needs a key in a file.

### 5.1 Hosting (`4f30ab3a`)

```bash
git clone https://github.com/TaylorService-spec/Taylor_Parts.git r1-hosting && cd r1-hosting
git checkout production-release/hosting-4f30ab3ad7c4     # or 4f30ab3ad7c434da0dd8ff043ecd65d0bdef8a72
test "$(git rev-parse HEAD)" = 4f30ab3ad7c434da0dd8ff043ecd65d0bdef8a72
git status --porcelain            # must be empty
cd field-ops-app-vite && npm ci && unset VITE_ENVIRONMENT_ID && npm run build:firebase   # Node 22
cat dist/version.json             # environmentId taylor-parts-production, environmentRole production, base "/", commit starts 4f30ab3a
cd .. && firebase deploy --only hosting --project taylor-parts
```

Leave `VITE_ENVIRONMENT_ID` unset: production is the registry default at this commit, and a non-production id would be refused or mislabel the artifact. `firebase.json` serves `field-ops-app-vite/dist` with a catch-all SPA rewrite and no-cache headers.

### 5.2 Pages (`6cac0423`)

Pages only deploys through the GitHub Actions workflow. The workflow at `6cac0423` is `push`-triggered and has **no `workflow_dispatch`**, and `main`'s workflow is dispatch-only, so the tag cannot be dispatched as it stands. Decision for the controller, not done here: create a recovery branch from `6cac04232c813af7695187ee7a4ced74ecd72760`, bring in `.github/workflows/deploy-field-ops.yml` from `main` (adds `workflow_dispatch` and the typed `PUBLISH PRODUCTION` confirmation), and dispatch that branch. This is a workflow edit and a production publish, so it needs separate authorization. Build commands, as the workflow runs them (Node 22):

```bash
cd field-ops-app-vite && npm ci && npm run build            # base /Taylor_Parts/field-ops/
mkdir -p ../site/field-ops && cp ../index.html ../site/index.html \
  && cp -r dist/. ../site/field-ops/ && cp dist/404.html ../site/404.html
```

A republish also redeploys the root `index.html` prototype ("Parts Control Center"). See the risk classification in `evidence/firebase-deployed-functions-and-pcc-risk-2026-10-19.md`: production Rules deny its `pcc` reads and writes, but it is a public page that loads third-party scripts. Retiring it is an Owner decision after this release is preserved.

### 5.3 Functions (`4f30ab3a`)

```bash
git clone https://github.com/TaylorService-spec/Taylor_Parts.git r1-functions && cd r1-functions
git checkout 4f30ab3ad7c434da0dd8ff043ecd65d0bdef8a72
cd functions && npm ci && npm run build        # Node 22 (package.json engines); tsc -> lib/
# Optional pre-check: node -e "console.log(Object.keys(require('./lib/index.js')).sort().join('\n'))" must list the 84 names.
cd .. && firebase deploy --only functions --project taylor-parts
```

At this commit the exported set equals the deployed set, so an unfiltered functions deploy neither adds nor removes a function. Do not run this from any later commit: `main` exports 41 fewer of these and 39 others, and an unfiltered deploy there is how `interpretWorkOrderReadinessContext` was once pulled in (`.github/workflows/functions-deploy-set-tests.yml`). Run it only under a separate Owner authorization.

### 5.4 Rules (`0526140d`)

Rules are already live and unchanged by anything above. If they ever need restoring, use the `0526140d` blob, not the Hosting or Functions commit: `git cat-file -p 0526140d49ea4add988cd0e655929e75ab216723:firestore.rules`. Rules deploys are Tier 2 and human-operator-only (`docs/Deployment.md` section 4).

## 6. Verification

| Check | Command | Expected |
|---|---|---|
| Hosting identity | `curl -s https://taylor-parts.web.app/version.json` | `commit` begins `4f30ab3a`, `environmentId` `taylor-parts-production`, `environmentRole` `production`, `base` `/` |
| Pages identity | `curl -s https://taylorservice-spec.github.io/Taylor_Parts/field-ops/version.json` | `commit` begins `6cac0423`, same environment fields, `base` `/Taylor_Parts/field-ops/` |
| Drift tool (read-only GETs) | `node scripts/checkDeployedVersions.mjs --env taylor-parts-production --expected <sha>` | per-surface MATCH for the intended revision; the two surfaces legitimately differ |
| Live Rules | fetch the live Firestore ruleset through the Firebase Rules REST API (recipe: `docs/operations/f-rules-1-d2-deployment-handoff.md` section on live-Rules fetch) and `sha256sum` it | `ec1f0a9b78d937d1eff1aef6c2588b20a0dc77501b392e560b491e7c13b1ccd1` |
| Functions estate | `firebase functions:list --project taylor-parts --json` (read-only) | 84 callables, `nodejs22`, no non-callable; names equal section 3 |

`version.json` `commit` is `git rev-parse --short HEAD` at build time, so compare by prefix, and it proves identity of the bundle, not of Functions or Rules. The production release runbook's own verify step prints `version.json` and asks the operator to confirm; it does not compare (`docs/DECISIONS.md`, release-boundary entry). Compare by eye against the table.

## 7. Which workflows can deploy production

Verified on `main` `2f8be86f`:
- **`.github/workflows/deploy-field-ops.yml` is the only workflow that publishes to GitHub Pages.** Its trigger is `workflow_dispatch` only (no `push`, `pull_request`, `schedule`, `workflow_run` or path filter) and it refuses to continue unless the `confirm` input is exactly `PUBLISH PRODUCTION`. Owner ruling Option A, 2026-09-24 (`docs/deployment/github-pages-promotion-governance-decision.md`); the change landed in `1a6aa341` (PR #1962).
- `node scripts/productionPublishTriggerFence.mjs` reports: `154 workflows scanned, 1 publish to GitHub Pages (deploy-field-ops.yml), 0 with an automatic trigger`. The same fence runs on every PR and push to `main` in `governance-guard-enforcement.yml`.
- **No workflow runs `firebase deploy`, installs `firebase-tools` for deployment, or authenticates to Google Cloud.** The only `firebase` invocations in `.github/workflows/` start emulators with the `demo-eos-test` project. `firebase-deploy-guard.yml` is a test of the F0 guard, not a deploy.
- **No automatic production trigger was found.** One historical note: until `1a6aa341`, Pages published on every push to `main` touching `index.html`, `field-ops-app-vite/**` or the workflow (838 of 1,990 merges). `6cac0423` is the last such publish. `config/environments.json` on `main` already says manual-only.
- Not examined: Vercel and Render deployments driven by repository integrations rather than `.github/workflows/`. They are outside this release.

## 8. Not done / follow-ups

- No tags were created or pushed; no workflow, deploy, cloud call or credential was used.
- `scripts/_prodRelease.run.sh` was not read (agent deny list, DECISIONS #128); the Hosting recipe in 5.1 is derived from `package.json`, `vite.config.js`, `firebase.json` and `docs/Deployment.md` at the tagged commit instead.
- Optional certainty step for Functions: operator compares `firebase-functions-hash` `64cbe8d4eb65923ce4e48981fa29e2389159f39f` or downloads one stored source archive and diffs it against `functions/` at `4f30ab3a`.
- Pages recovery needs a controller decision on the recovery-branch approach in 5.2.
