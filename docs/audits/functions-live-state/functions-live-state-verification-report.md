# Production Functions Live-State Verification

# DRAFT — OPERATOR EXECUTION REQUIRED

> This report's repository analysis is complete. The **live-state** sections are unfilled because this
> environment (Windows Claude Code) has **no authenticated production access**. All live-state statuses are
> **CANNOT VERIFY** until an authenticated Cloud Shell operator runs
> `scripts/audit/verify-production-functions-live-state.sh` per
> `../../operations/functions-live-state-verification-handoff.md` and returns evidence in a separate PR.
> No deployed Function state is inferred or asserted here.

## Verification Status

**OPERATOR EXECUTION REQUIRED** (repository analysis complete; production verification pending).

## Scope

- **Verified (repository-side):** the complete Function export surface, `firebase.json`/`functions/package.json`
  configuration, Issue #15 acceptance intent, and the deterministic correlation method to be applied to
  operator evidence.
- **NOT verified (needs operator):** which Functions are actually deployed right now, their live state,
  runtime, region, service account, update time, and Cloud Run/Eventarc backing — i.e. the entire live-state
  side of the correlation, and therefore the final Issue #15 and Decision #36 conclusions.

## Repository Baseline

- `origin/main` commit reviewed: `b31f871475c7421e60182ad54bf2f91e76fdc2f9` (PR #367 roadmap reconciliation is
  **OPEN, not merged** at review time — so the roadmap report is *proposed*, not authoritative).
- Function source root: `functions/` (`firebase.json`: `functions.source = functions`, `codebase = default`).
  Entry: `functions/src/index.ts` → compiled `functions/lib/index.js` (`functions/package.json` `main`).
  Runtime: Node 20 (`engines.node = "20"`); `firebase-functions ^5.1.0` (v2 API → Cloud Functions **Gen 2**).
- Export surface reviewed: `functions/src/index.ts` and each callable entry file.

## Environment Verification

- Execution environment: **not executed in production** (Windows workstation; no gcloud/ADC).
- Authenticated account / project ID / region scope / timestamp: **CANNOT VERIFY** — to be captured by the
  operator script into `environment.txt` / `project-metadata.json`.
- Expected project (from repository governance): `taylor-parts`. Expected region (from callable declarations):
  `us-central1`.

## Repository Function Inventory

All exports are v2 HTTPS **callable** (`onCall`) Functions in region `us-central1`, runtime Node 20, Gen 2,
codebase `default`. No Firestore/Auth/Pub-Sub/scheduled triggers exist in the export surface.

| Function name | Trigger | Source file | Export path | Region | Runtime | Gen | Intended purpose | Repo status |
|---|---|---|---|---|---|---|---|---|
| createWorkOrder | onCall | functions/src/createWorkOrder.ts | index.ts:8 | us-central1 | Node 20 | 2 | Work Order create (trusted) | ACTIVE |
| transitionWorkOrder | onCall | functions/src/transitionWorkOrder.ts | index.ts:9 | us-central1 | Node 20 | 2 | WO lifecycle transition | ACTIVE |
| updateWorkOrderExecutionData | onCall | functions/src/updateWorkOrderExecutionData.ts | index.ts:10 | us-central1 | Node 20 | 2 | WO execution capture (technician) | ACTIVE |
| grantRole | onCall | functions/src/access/accessCommandCallables.ts | index.ts:18 | us-central1 | Node 20 | 2 | Access mutation (grant) | ACTIVE (undeployed per #36) |
| revokeRole | onCall | " | index.ts:19 | us-central1 | Node 20 | 2 | Access mutation (revoke) | ACTIVE (undeployed per #36) |
| assignApprovedRole | onCall | " | index.ts:20 | us-central1 | Node 20 | 2 | Access mutation (assign approved) | ACTIVE (undeployed per #36) |
| setUserStatus | onCall | " | index.ts:21 | us-central1 | Node 20 | 2 | Access mutation (status) | ACTIVE (undeployed per #36) |
| approveAccessRequest | onCall | " | index.ts:22 | us-central1 | Node 20 | 2 | Access approval | ACTIVE (undeployed per #36) |
| rejectAccessRequest | onCall | " | index.ts:23 | us-central1 | Node 20 | 2 | Access rejection | ACTIVE (undeployed per #36) |
| runReportDefinitionCallable | onCall | functions/src/reporting/runReportDefinitionCallable.ts | index.ts:37 | us-central1 | Node 20 | 2 | Trusted report execution | ACTIVE |
| createSavedDefinitionCallable | onCall | functions/src/reporting/savedDefinitionCallables.ts | index.ts:51 | us-central1 | Node 20 | 2 | Saved report def CRUD | ACTIVE |
| getSavedDefinitionCallable | onCall | " | index.ts:52 | us-central1 | Node 20 | 2 | " | ACTIVE |
| listSavedDefinitionsCallable | onCall | " | index.ts:53 | us-central1 | Node 20 | 2 | " | ACTIVE |
| renameSavedDefinitionCallable | onCall | " | index.ts:54 | us-central1 | Node 20 | 2 | " | ACTIVE |
| duplicateSavedDefinitionCallable | onCall | " | index.ts:55 | us-central1 | Node 20 | 2 | " | ACTIVE |
| deleteSavedDefinitionCallable | onCall | " | index.ts:56 | us-central1 | Node 20 | 2 | " (name only; not a mutation verb) | ACTIVE |
| resolveEffectiveAccessCallable | onCall | functions/src/access/effectiveAccessFeedCallable.ts | index.ts:68 | us-central1 | Node 20 | 2 | Trusted effective-access feed (read) | ACTIVE |

**Repository export count: 17 callable Functions** (3 Work Order · 6 access-mutation · 1 report-execution · 6 saved-definition · 1 effective-access). No UNEXPORTED/TEST-ONLY/DEPRECATED entry-point Functions found in `index.ts`. Functions referenced in docs but absent from code: none identified. Functions present in code but absent from docs: none (all appear in DECISIONS/ADR context).

## Deployed Function Inventory

**CANNOT VERIFY (operator execution required).** To be populated from `functions-all.json` / `functions-gen2.json`
/ `function-describes/` produced by the read-only script. Per **DECISIONS #36 (repository record, not a
current-live proof):** the Firestore Rules and **11 Functions** were deployed to `taylor-parts` in `us-central1`
— `resolveEffectiveAccessCallable`, `runReportDefinitionCallable`, the six `*SavedDefinitionCallable`, and the
three Work Order Functions — with **no access-mutation (Row-7) Function deployed**. `firebase functions:list`
at that time showed exactly 11 (v2/Node 20), all unauth-401. Whether those 11 are **still** live now is what
this gate must confirm.

## Repository-to-Production Correlation

Deterministic correlation method (to be applied per Function once operator artifacts exist): compare deployed
`name` ↔ repository export name; `entryPoint`/build metadata ↔ export; `httpsTrigger`/`eventTrigger` ↔ `onCall`;
`environment`/generation ↔ Gen 2; `region` ↔ `us-central1`; `runtime` ↔ Node 20; `serviceAccountEmail`;
`updateTime`. Classify each: MATCHED / DEPLOYED_BUT_NOT_IN_REPOSITORY / IN_REPOSITORY_BUT_NOT_DEPLOYED /
NAME_MISMATCH / TRIGGER_MISMATCH / REGION_MISMATCH / RUNTIME_MISMATCH / GENERATION_MISMATCH /
SOURCE_CORRELATION_UNCLEAR / DISABLED_OR_FAILED / UNKNOWN. **Deployment timestamps alone will not be used to
claim source parity;** where exact source-commit correlation is unavailable, that is stated as
SOURCE_CORRELATION_UNCLEAR.

Expected shape once verified (per #36, pending confirmation): 11 × MATCHED, and the 6 access-mutation Functions
× IN_REPOSITORY_BUT_NOT_DEPLOYED. **Current classification: UNKNOWN / CANNOT VERIFY.**

## Issue #15 Acceptance Review

Issue #15 = production Cloud Functions deployment (Blaze), gating (per ADR-005): trusted-writer activation,
Admin portal mutations, claims changes, access approvals, and production authorization enforcement.

| Acceptance criterion (reconstructed from repository evidence) | Repository evidence | Production evidence required | Current status |
|---|---|---|---|
| Blaze / Functions deployment capability exists | DECISIONS #35/#36 ("Blaze confirmed active"; 11 Functions deployed) | firebase/gcloud functions list | PARTIALLY SATISFIED / CANNOT VERIFY (live) |
| Work Order Functions deployed | #36 lists the 3 WO Functions | functions describe (3 WO) | PARTIALLY SATISFIED / CANNOT VERIFY (live) |
| Report execution + effective-access + saved-def deployed | #36 lists 8 report/access-read Functions | functions describe (8) | PARTIALLY SATISFIED / CANNOT VERIFY (live) |
| Trusted access-mutation writers deployed (grant/revoke/setStatus/approve/reject/assign) | #36: "No Row-7 access-mutation Function was deployed" | functions list (expect ABSENT) | NOT SATISFIED |
| Admin portal mutations / claims / approvals / production enforcement active | ADR-005; Admin UI is inert; mutation Fns undeployed | functions + app state | NOT SATISFIED |
| Rules deployed alongside Functions | #36 (Rules + SHA); DECISIONS #7/#8/#26/#28/#30/#32 | rules deploy record (out of this script's scope) | PARTIALLY SATISFIED / CANNOT VERIFY (live) |

**Overall (repository evidence): PARTIALLY SATISFIED.** The deployment-capability and read/report/WO portion is
recorded deployed; the authoritative access-mutation/enforcement portion is explicitly **not** deployed. The
**live** confirmation of even the deployed 11 is **CANNOT VERIFY** here.

## Decision #36 Reconciliation

- **Supported by (repository record):** #36 records a consolidated deploy of Rules + 11 named Functions
  (`us-central1`, v2/Node 20), unauth-401, verification "passed twice," with the 6 access-mutation Functions
  deliberately excluded. #35 records the earlier rolled-back attempt.
- **What #36 does NOT establish for THIS gate:** the *current* live state (a deploy record is a point-in-time
  event, not proof of present state — per `docs/governance/audit-artifact-standard.md`). Operator `functions
  list`/`describe` is required to confirm the 11 are still present, unchanged (region/runtime/trigger), and that
  no additional or failed Functions exist.
- **Leaves unresolved:** current live state; runtime/region drift; service-account posture; whether the 6
  access-mutation Functions remain absent.

## Enterprise Access Impact

- **Trusted mutation Function availability:** per #36, the 6 access-mutation callables are **exported but
  undeployed** → Admin portal mutation activation remains **BLOCKED** and legacy `users/{uid}.role` enforcement
  remains the domain authority. (To be confirmed live.)
- **Effective-access feed:** recorded deployed (read-only) → the trusted read path exists; enforcement cutover
  still gated on the mutation Functions + Owner authorization.
- **Roadmap status:** no change is asserted from this gate until live-state is verified; the reconciliation
  report (PR #367, proposed) already flags this.

## F-RULES-1 Impact

Dependency-only: F-RULES-1 hardening is Rules-based and does **not** require these Functions (its cross-doc
cascade could later move to trusted Functions post-#15 per its spec, but PR-1/PR-3 do not). **This gate does not
authorize F-RULES-1 PR-1.**

## Orphaned, Missing, or Stale Resources

**CANNOT VERIFY (operator required).** To be filled from artifacts: deployed-only Functions (none expected);
repository-only Functions (expect the 6 access-mutation, per #36); failed/disabled Functions; stale runtimes;
unexpected regions; SOURCE_CORRELATION_UNCLEAR entries.

## Security Observations

Metadata only, once available: service-account identity per Function, ingress/auth posture (expect unauth-401),
env-var/secret **names** (never values). No secrets/tokens/PII/production document data are read by this gate.

## Roadmap Corrections

None asserted by this DRAFT (live-state unverified). If operator evidence confirms #36's 11 Functions live, the
single supported correction is that the stale roadmap's "no production Functions are currently confirmed" is
false — already captured by the PR #367 reconciliation banner/report. No roadmap rewrite here.

## Recommended Issue #15 Disposition

**CANNOT DECIDE (pending operator live-state).** Provisional recommendation *if* the 11 Functions are confirmed
live and the 6 mutation Functions confirmed absent: **SPLIT REMAINING WORK** — treat the deployment-capability +
report/WO/effective-access portion as satisfied, and track the remaining **trusted access-mutation deployment +
enforcement activation** (grant/revoke/setStatus/approve/reject/assign + Admin mutation UI) as the open
remainder (couples Enterprise Access cutover). Do not CLOSE #15 on repository evidence alone.

## Remediation Candidates (listed, NOT implemented)

- Deploy the 6 access-mutation Functions + activate Admin mutation UI (separate Owner + deploy gate).
- Any runtime/region drift or DISABLED_OR_FAILED Function found by the operator run.
- Undocumented deployed Functions (if any) → reconcile into docs.
- Service-account posture review if describe reveals non-default accounts.
- Establish a recurring live-state verification cadence (this script + handoff).

## Open Questions

- **OQ-1:** Are the 11 Functions from #36 still live now (state/region/runtime unchanged)?
- **OQ-2:** Are the 6 access-mutation Functions still absent?
- **OQ-3:** Any Function deployed outside the repository export surface?
- **OQ-4:** Does exact source-commit correlation exist in describe metadata, or is it SOURCE_CORRELATION_UNCLEAR?
- **OQ-5:** Final Issue #15 disposition (SPLIT vs KEEP OPEN) once OQ-1/OQ-2 are answered.
