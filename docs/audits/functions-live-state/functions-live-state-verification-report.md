# Production Functions Live-State Verification

**Verification Status: COMPLETE**

> Live-state verified by an authenticated Cloud Shell operator (read-only) on **20260721T225517Z**. The immutable
> evidence is preserved verbatim under `2026-07-21/` in this directory; its embedded `sha256sums.txt` was
> re-verified in-repo (all files OK) and `sensitive-scan.txt` is clean. No production resource was deployed,
> invoked, or changed.

## Verification Status

COMPLETE. Repository analysis (Windows) + read-only production verification (Cloud Shell operator) + verbatim
evidence preservation (this PR) are all done.

## Scope

Verified: the deployed Cloud Functions inventory for `taylor-parts`/`us-central1` and its correlation against the
17 repository exports. Not in scope (unchanged): Function behavior/invocation, IAM policy changes, secret values,
Rules deploy state (a separate record), and any remediation.

## Repository Baseline

- `origin/main` reviewed: `8da66ffc09baf9e89411ce5e8efed9966bdadaa2` (PR #367 roadmap reconciliation + PR #368
  verification-prep both merged).
- Function source root `functions/`; entry `functions/src/index.ts`; runtime Node 20; `firebase-functions ^5.1.0`
  (v2 → Cloud Functions Gen 2). Export surface reviewed = 17 callables (see inventory).

## Environment Verification

- Execution environment: authenticated Google Cloud Shell operator (read-only), NOT the Windows workstation.
- Project ID: **taylor-parts** (`verification-summary.json`, `project-metadata.json`).
- Region scope: **us-central1**.
- readOnly: **true**. Operator execution timestamp: **20260721T225517Z**.
- Deployed Function service account (all 11): `664399427363-compute@developer.gserviceaccount.com` (the default
  Compute Engine service account) — see Security Observations.

## Repository Function Inventory

17 v2 HTTPS **callable** (`onCall`) exports, region `us-central1`, Node 20, Gen 2, codebase `default`. No
Firestore/Auth/Pub-Sub/scheduled triggers.

| Function | Trigger | Source | Export | Repo status |
|---|---|---|---|---|
| createWorkOrder | onCall | createWorkOrder.ts | index.ts:8 | ACTIVE |
| transitionWorkOrder | onCall | transitionWorkOrder.ts | index.ts:9 | ACTIVE |
| updateWorkOrderExecutionData | onCall | updateWorkOrderExecutionData.ts | index.ts:10 | ACTIVE |
| grantRole | onCall | access/accessCommandCallables.ts | index.ts:18 | ACTIVE (undeployed) |
| revokeRole | onCall | " | index.ts:19 | ACTIVE (undeployed) |
| assignApprovedRole | onCall | " | index.ts:20 | ACTIVE (undeployed) |
| setUserStatus | onCall | " | index.ts:21 | ACTIVE (undeployed) |
| approveAccessRequest | onCall | " | index.ts:22 | ACTIVE (undeployed) |
| rejectAccessRequest | onCall | " | index.ts:23 | ACTIVE (undeployed) |
| runReportDefinitionCallable | onCall | reporting/runReportDefinitionCallable.ts | index.ts:37 | ACTIVE |
| createSavedDefinitionCallable | onCall | reporting/savedDefinitionCallables.ts | index.ts:51 | ACTIVE |
| getSavedDefinitionCallable | onCall | " | index.ts:52 | ACTIVE |
| listSavedDefinitionsCallable | onCall | " | index.ts:53 | ACTIVE |
| renameSavedDefinitionCallable | onCall | " | index.ts:54 | ACTIVE |
| duplicateSavedDefinitionCallable | onCall | " | index.ts:55 | ACTIVE |
| deleteSavedDefinitionCallable | onCall | " | index.ts:56 | ACTIVE |
| resolveEffectiveAccessCallable | onCall | access/effectiveAccessFeedCallable.ts | index.ts:68 | ACTIVE |

**Repository export count: 17.**

## Deployed Function Inventory

**Verified live: 11 Functions**, all `environment: GEN_2`, `runtime: nodejs20`, `state: ACTIVE`, region
`us-central1`, service account `664399427363-compute@developer.gserviceaccount.com`, `entryPoint` == Function
name, deployment labels `deployment-tool: cli-firebase` / `firebase-functions-hash: 9a780b25…`. Deployed
~`2026-07-21T05:0x`Z (per describe `updateTime`), confirmed live at the `225517Z` verification run.

- createWorkOrder · transitionWorkOrder · updateWorkOrderExecutionData
- runReportDefinitionCallable
- createSavedDefinitionCallable · getSavedDefinitionCallable · listSavedDefinitionsCallable ·
  renameSavedDefinitionCallable · duplicateSavedDefinitionCallable · deleteSavedDefinitionCallable
- resolveEffectiveAccessCallable

**Counts:** Gen 1 = **0** (`functions-gen1.json` = `[]`); Gen 2 = **11**. Cloud Run backing services: present
(Gen 2 is Cloud-Run-backed). Eventarc triggers: **0** (`[]`). Scheduler jobs: **0** (`[]`, expected — no
scheduled Functions in the repo). No deployed-only / orphaned Function found.

## Repository-to-Production Correlation

17 exports correlated against verified live state:

| # | Function | Repo export | Deployed | Trigger | Gen | Region | Runtime | State | Classification |
|---|---|---|---|---|---|---|---|---|---|
| 1 | createWorkOrder | ✓ | ✓ | callable | 2 | us-central1 | nodejs20 | ACTIVE | MATCHED |
| 2 | transitionWorkOrder | ✓ | ✓ | callable | 2 | us-central1 | nodejs20 | ACTIVE | MATCHED |
| 3 | updateWorkOrderExecutionData | ✓ | ✓ | callable | 2 | us-central1 | nodejs20 | ACTIVE | MATCHED |
| 4 | runReportDefinitionCallable | ✓ | ✓ | callable | 2 | us-central1 | nodejs20 | ACTIVE | MATCHED |
| 5 | createSavedDefinitionCallable | ✓ | ✓ | callable | 2 | us-central1 | nodejs20 | ACTIVE | MATCHED |
| 6 | getSavedDefinitionCallable | ✓ | ✓ | callable | 2 | us-central1 | nodejs20 | ACTIVE | MATCHED |
| 7 | listSavedDefinitionsCallable | ✓ | ✓ | callable | 2 | us-central1 | nodejs20 | ACTIVE | MATCHED |
| 8 | renameSavedDefinitionCallable | ✓ | ✓ | callable | 2 | us-central1 | nodejs20 | ACTIVE | MATCHED |
| 9 | duplicateSavedDefinitionCallable | ✓ | ✓ | callable | 2 | us-central1 | nodejs20 | ACTIVE | MATCHED |
| 10 | deleteSavedDefinitionCallable | ✓ | ✓ | callable | 2 | us-central1 | nodejs20 | ACTIVE | MATCHED |
| 11 | resolveEffectiveAccessCallable | ✓ | ✓ | callable | 2 | us-central1 | nodejs20 | ACTIVE | MATCHED |
| 12 | grantRole | ✓ | ✗ | — | — | — | — | — | IN_REPOSITORY_BUT_NOT_DEPLOYED |
| 13 | revokeRole | ✓ | ✗ | — | — | — | — | — | IN_REPOSITORY_BUT_NOT_DEPLOYED |
| 14 | assignApprovedRole | ✓ | ✗ | — | — | — | — | — | IN_REPOSITORY_BUT_NOT_DEPLOYED |
| 15 | setUserStatus | ✓ | ✗ | — | — | — | — | — | IN_REPOSITORY_BUT_NOT_DEPLOYED |
| 16 | approveAccessRequest | ✓ | ✗ | — | — | — | — | — | IN_REPOSITORY_BUT_NOT_DEPLOYED |
| 17 | rejectAccessRequest | ✓ | ✗ | — | — | — | — | — | IN_REPOSITORY_BUT_NOT_DEPLOYED |

**Totals: 11 MATCHED · 6 IN_REPOSITORY_BUT_NOT_DEPLOYED · 0 DEPLOYED_BUT_NOT_IN_REPOSITORY · 0
NAME/TRIGGER/REGION/RUNTIME/GENERATION_MISMATCH · 0 DISABLED_OR_FAILED.**

**Source correlation:** describe metadata carries a `firebase-functions-hash` label (`9a780b25…`) and a source-zip
`generation`, but **not a git commit** — so exact deployed-source-commit parity is **SOURCE_CORRELATION_UNCLEAR**
(limited to available deployment metadata). Name/trigger/generation/region/runtime parity is MATCHED for all 11;
deployment timestamps alone were not used to claim source parity.

## Issue #15 Acceptance Review

| Acceptance criterion | Repository evidence | Production evidence | Status |
|---|---|---|---|
| Functions deployment platform operational (Blaze) | DECISIONS #35/#36 | 11 GEN_2 Functions live, ACTIVE | SATISFIED |
| Work Order trusted Functions deployed | #36 | createWorkOrder/transition/updateExecutionData live | SATISFIED |
| Report execution deployed | #36 | runReportDefinitionCallable live | SATISFIED |
| Saved-definition Functions deployed | #36 | 6 saved-def callables live | SATISFIED |
| Effective-access resolution deployed | #36 | resolveEffectiveAccessCallable live | SATISFIED |
| Trusted access-mutation writers deployed | #36 excluded them | 6 grant/revoke/assign/setStatus/approve/reject ABSENT | NOT SATISFIED |
| Admin mutation / claims / approvals / production enforcement active | ADR-005 | mutation Fns absent; Admin UI inert | NOT SATISFIED |

**Overall: PARTIALLY SATISFIED** — the deployment platform and the WO/report/effective-access portion are
verified operational; the trusted access-mutation/enforcement portion is verified **not** deployed.

## Decision #36 Reconciliation

- Decision #36 was a valid **point-in-time deployment record** (Rules + 11 Functions; 6 mutation Functions
  excluded).
- Current live-state evidence **corroborates** it: exactly the 11 named Functions are live (GEN_2, us-central1,
  ACTIVE), and the 6 access-mutation Functions remain **absent** — matching #36 precisely.
- Exact deployed **source-commit** parity remains limited to available deployment metadata (label hash + source
  generation), not a git SHA (SOURCE_CORRELATION_UNCLEAR).
- Decision #36 is left **unchanged** (not rewritten); this reconciliation is recorded here per the audit-artifact
  standard. No new DECISIONS.md entry is required by repository convention for a corroboration.

## Enterprise Access Impact

- The 6 access-mutation callables are **verified undeployed** → **Admin mutation activation remains BLOCKED**;
  trusted access administration is incomplete; domain enforcement continues through the **legacy compatibility
  path** (`users/{uid}.role`) — no evidence here changes that.
- The trusted read-only effective-access feed **is live**, so the read side of the model is deployed; enforcement
  cutover still requires the mutation Functions + a separate Owner authorization.

## F-RULES-1 Impact

Dependency-only: F-RULES-1 Rules hardening does not require these Functions. **This gate does not authorize
F-RULES-1 PR-1.**

## Orphaned, Missing, or Stale Resources

- Deployed-only / orphaned Functions: **none**.
- Repository-only (expected, undeployed): the **6 access-mutation Functions**.
- Failed/disabled: **none** (all 11 `state: ACTIVE`).
- Stale runtimes: none flagged (`nodejs20`, current). Unexpected regions: none (all `us-central1`).
- Gen mismatch: none (repo is Gen 2; deployed are GEN_2).

## Security Observations

Metadata only (no secrets/tokens/PII/production data; `sensitive-scan.txt` = clean):
- All 11 Functions run as the **default Compute Engine service account**
  (`664399427363-compute@developer.gserviceaccount.com`) rather than a dedicated least-privilege service account —
  a common hardening candidate, not a defect (listed under Remediation Candidates).
- Deployment labels indicate `cli-firebase` tooling; source stored in `gcf-artifacts` Artifact Registry.

## Evidence Path & Integrity

- Immutable evidence: `docs/audits/functions-live-state/2026-07-21/` (25 files, imported verbatim; a `-text`
  `.gitattributes` prevents any line-ending conversion).
- Checksums: `sha256sums.txt` re-verified in-repo — **all files OK**. External archive sidecar
  `functions-live-state-20260721T225517Z.tar.gz.sha256` verified OK before extraction.
- Sensitive scan: **clean**.
- No-mutation declaration: no deploy/redeploy/invoke/update/delete/IAM/secret/config command was run; verification
  was read-only list/describe metadata only.

## Recommended Issue #15 Disposition

**SPLIT REMAINING WORK** (do not auto-close). Owner chooses:
- **A.** Split the remaining items into a follow-on issue (deploy the 6 access-mutation Functions + activate
  Admin mutation/enforcement), then close the satisfied original platform/deployment portion; **or**
- **B.** Keep Issue #15 open with **narrowed** remaining acceptance criteria (the 6 mutation Functions + Admin
  mutation activation + enforcement cutover).

Satisfied scope: production Functions platform operational; Work Order trusted Functions deployed; Report Creator
execution deployed; saved-definition Functions deployed; effective-access resolution deployed.
Remaining scope: grantRole / revokeRole / assignApprovedRole / setUserStatus / approveAccessRequest /
rejectAccessRequest not deployed; Admin mutation activation blocked; trusted access administration incomplete;
domain enforcement remains on the legacy compatibility path.

## Remediation Candidates (listed, NOT implemented)

- Deploy the 6 access-mutation Functions + activate Admin mutation UI (separate Owner + deploy gate).
- Consider a dedicated least-privilege service account for these Functions (currently default Compute SA).
- Establish a source-commit correlation practice (e.g. record the deployed git SHA in deploy metadata/labels) to
  remove SOURCE_CORRELATION_UNCLEAR on future runs.
- Adopt a recurring read-only live-state verification cadence (this script + handoff).

## Roadmap Corrections (evidence-supported)

- Production Cloud Functions are **confirmed** (11 live, GEN_2, us-central1) — the stale roadmap's "no production
  Functions are currently confirmed" is superseded (already banner-corrected via PR #367's reconciliation).
- Enterprise Access **mutation Functions remain undeployed**.
- **Issue #15 is PARTIALLY SATISFIED, not complete.**
No full roadmap rewrite; no priority change; no new work authorized.

## Open Questions

- **OQ-1:** Owner selection of Issue #15 disposition path A vs B.
- **OQ-2:** Should deploy metadata capture the git commit for future source-commit parity?
- **OQ-3:** Timing of the access-mutation Function deployment + enforcement cutover (couples Enterprise Access;
  separate Owner + deploy gate).
