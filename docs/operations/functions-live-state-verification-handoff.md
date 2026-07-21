# Operational Handoff — Production Functions Live-State Verification

**Gate:** Production Functions Live-State and Issue #15 Verification (read-only).
**Standard:** follows `../governance/audit-artifact-standard.md` and `../governance/execution-environments.md`.
**Template:** an instance of `../governance/templates/operational-handoff.md`.

This handoff separates the three environments deliberately:

- **A. Repository analysis (DONE, Windows Claude Code).** Repository Function inventory, Issue #15 acceptance reconstruction, correlation logic, the read-only script, and the DRAFT report — all in this branch. No production access.
- **B. Production verification (TODO, authenticated Cloud Shell operator).** Run the read-only script; produce raw artifacts; scan; checksum.
- **C. Evidence return (TODO, separate governance PR).** Bring the sanitized artifacts back into `docs/audits/functions-live-state/YYYY-MM-DD/` and finalize the report.

```text
# Operational Handoff

## Objective
Verify the CURRENT live state of the deployed Cloud Functions for taylor-parts and correlate it
against the repository export surface and DECISIONS #36, read-only.

## Gate
Production Functions Live-State and Issue #15 Verification. READ-ONLY. No deploy/mutation/invoke.

## Execution Environment
Host:            Google Cloud Shell (or an equivalently authenticated operator environment)
Shell:           bash/Linux
Repository:      a clean checkout of origin/main at the commit named in the DRAFT report
Worktree:        clean checkout
Branch:          main (or a detached checkout at that commit)

## Executor
Cloud Shell operator (holds read-only access to the taylor-parts project).

## Authorization
Owner read-only verification authorization for project taylor-parts. This is NOT a deploy gate.

## Production Classification
read-only (metadata list/describe only).

## Required read-only roles / permissions
At minimum, viewer-level on the project plus:
- Cloud Functions Viewer (roles/cloudfunctions.viewer)
- Cloud Run Viewer (roles/run.viewer)   # Gen2 backing services
- Eventarc Viewer (roles/eventarc.viewer)
- (Cloud Scheduler Viewer only if scheduled Functions exist -- the repository has none)
NO write/admin/secretAccessor role is required or should be used.

## Preconditions
gcloud + firebase CLIs available and authenticated; active project == taylor-parts.

## Exact Commands
export EXPECTED_PROJECT=taylor-parts
bash scripts/audit/verify-production-functions-live-state.sh --confirm-project taylor-parts

## Expected Output
A timestamped directory `functions-live-state-<UTC>/` containing environment.txt,
project-metadata.json, functions-all.json, functions-gen1.json, functions-gen2.json,
function-describes/, cloud-run-services.json, eventarc-triggers.json, scheduler-jobs.json,
verification-summary.json, sensitive-scan.txt, sha256sums.txt. The script aborts (nonzero)
on auth failure or if the active project != taylor-parts.

## Artifact Source
functions-live-state-<UTC>/ in the operator (Cloud Shell) filesystem.

## Artifact Destination
docs/audits/functions-live-state/YYYY-MM-DD/ in the repository, committed via a SEPARATE governance PR.
Use the actual run date for YYYY-MM-DD.

## Integrity Verification
Verify sha256sums.txt in Cloud Shell; re-verify byte-identity (cmp / sha256) after transfer to the
repository. Do NOT edit any captured artifact.

## Sensitive Data Review
Review sensitive-scan.txt (must read "clean"). The describe outputs contain env-var/secret NAMES and
service-account identities but MUST NOT contain secret VALUES. If sensitive-scan flags anything, sanitize
per the audit-artifact standard (document every transformation; preserve the original securely) BEFORE commit.

## Stop Conditions
No credentials -> BLOCKED BY ACCESS. Active project != taylor-parts -> abort. Any command needing more than
read-only -> stop. A secret value in artifacts -> stop, sanitize, document.

## Rollback / Recovery
n/a -- read-only, no writes.

## Prohibited Actions
No deploy/redeploy/remove/update/patch, no IAM binding changes, no secret-value reads, no Function invocation
(no callable call / no curl against endpoints), no Firestore or other production-data reads beyond Function
metadata.

## Completion Report
Return: environment header, active account (masked) + project + region, Gen1/Gen2 counts, the artifact
directory + sha256sums, sensitive-scan result, and "no mutation occurred", to finalize the DRAFT report
in section "Deployed Function Inventory" and the correlation/Issue-#15 sections.
```

## Notes for the returning PR (C)

- Place artifacts under `docs/audits/functions-live-state/YYYY-MM-DD/` exactly as produced (verbatim), with `sha256sums.txt`.
- Update `docs/audits/functions-live-state/functions-live-state-verification-report.md`: change **Verification Status** from `OPERATOR EXECUTION REQUIRED` to `COMPLETE`/`PARTIAL`, fill the **Deployed Function Inventory** and **Repository-to-Production Correlation** from the artifacts, and set the **Issue #15** and **Decision #36** conclusions from verified evidence.
- Do not close Issue #15, change Rules/Functions/config, or authorize F-RULES-1 PR-1 in that PR.
