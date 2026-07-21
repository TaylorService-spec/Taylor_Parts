# Operational Handoff Template

**Status:** Normative template. Copy the block below for any operational handoff between the Cloud Shell operator, Windows Claude Code, and CI.
**Related:** [../execution-environments.md](../execution-environments.md) · [../audit-artifact-standard.md](../audit-artifact-standard.md)

## How to use

Copy the fenced template, fill every field, and delete the guidance in parentheses. A blank field is a stop condition — do not proceed on assumptions. The template suits three shapes of work:

- **Cloud Shell operator commands** (production reads/writes/deploys, evidence generation);
- **Windows Claude Code repository work** (edits, tests, branches, commits, PRs);
- **deploy and non-deploy operations** alike.

Never embed real secrets, credentials, or environment-specific tokens in a handoff.

## Template

```text
# Operational Handoff

## Objective
(One sentence: what this handoff accomplishes.)

## Gate
(Which governance gate this belongs to; e.g. F-RULES-1 PR-1, production Rules deploy. Merge auth is never deploy auth.)

## Execution Environment
Host:            (Windows workstation | Google Cloud Shell | CI | other)
Shell:           (Git Bash/MINGW64 | bash/Linux | PowerShell | Actions runner)
Repository:      (e.g. D:/Taylor_Parts, ~/Taylor_Parts, actions/checkout)
Worktree:        (path, or "primary checkout — do not modify")
Branch:          (branch name)

## Executor
(Who runs this: Cloud Shell operator | Windows Claude Code | CI. One actor.)

## Authorization
(Explicit authorization reference: Owner read auth / merge auth / deploy auth. "None required (Tier 1)" if applicable.)

## Production Classification
(none | read-only | write | deploy. If write/deploy, name the separate gate.)

## Preconditions
(What must be true first: baseline SHA, prior gate merged, artifact present, audit GO, etc.)

## Exact Commands
(Copy-paste commands. Production commands MUST include the explicit --projectId and, for production,
--confirmProduction. Do not include secrets.)

## Expected Output
(What success looks like: exit code, decision, banner text, file written.)

## Artifact Source
(Where the produced artifact lives after execution, in the EXECUTOR's environment.)

## Artifact Destination
(Where it must end up, e.g. docs/audits/<id>/... in the repository, or "n/a".)

## Integrity Verification
(byte-identity / cmp / SHA-256 requirement across any environment transfer; "n/a" if none.)

## Sensitive Data Review
(Required scan for credentials/PII before commit; expected result: identifiers/classifications only.)

## Stop Conditions
(When to halt and report instead of proceeding: artifact missing, decision mismatch, dirty checkout,
credentials unavailable, environments disagree, unexpected surfaces changed.)

## Rollback / Recovery
(For writes/deploys: captured pre-change state (e.g. pre-deploy Rules SHA), rollback command, verification.
"n/a — read-only/non-mutating" otherwise.)

## Prohibited Actions
(What must NOT happen: no writes, no deploy, no modifying the dirty primary checkout, no relabeling a NO-GO
as GO, no editing generated evidence, no sourcing credentials, no cross-environment path assumptions.)

## Completion Report
(What the executor returns: environment header, exact commands run, outcome/decision, artifact path + checksum,
confirmation of no unauthorized side effects, and the recommended next gate.)
```

## Filled example (read-only production audit request)

```text
# Operational Handoff

## Objective
Run the F-RULES-1 read-only production compatibility audit and produce the evidence artifact.

## Gate
F-RULES-1 PR-0 production compatibility gate. Read authorization only.

## Execution Environment
Host:            Google Cloud Shell
Shell:           bash/Linux
Repository:      ~/Taylor_Parts (at merged origin/main)
Worktree:        clean checkout of origin/main
Branch:          main (or a detached checkout at the merged commit)

## Executor
Cloud Shell operator.

## Authorization
Owner read-only production authorization for project taylor-parts.

## Production Classification
read-only.

## Preconditions
Audit tooling merged to main (functions/scripts/auditLegacyJobTechnicianData.js); npm ci in functions;
local audit tests green.

## Exact Commands
cd functions
node scripts/auditLegacyJobTechnicianData.js \
  --projectId taylor-parts \
  --confirmProduction taylor-parts \
  --output ~/legacy-audit-result.json

## Expected Output
Banner "READ-ONLY AUDIT -- NO WRITES", "Target project: taylor-parts"; a GO or NO-GO decision;
exit 0 (GO) / 3 (NO-GO) / 2 (technical failure). JSON written to the --output path.

## Artifact Source
~/legacy-audit-result.json (Cloud Shell filesystem).

## Artifact Destination
docs/audits/f-rules-1/production-legacy-job-technician-audit.json (repository, committed by Windows Claude Code).

## Integrity Verification
Byte-identity (cmp) + SHA-256 recorded when transferring the file to the Windows repository worktree.

## Sensitive Data Review
Scan the JSON before commit; expect Firestore document IDs and counts only — no names/phones/emails/credentials.

## Stop Conditions
Missing credentials -> BLOCKED BY ACCESS. Decision mismatch vs any pasted summary -> stop, report field diff.
NO-GO -> preserve artifact, do not correct, request remediation follow-up.

## Rollback / Recovery
n/a — read-only, no writes.

## Prohibited Actions
No writes, no deploy, no data correction, no relabeling NO-GO as GO, no editing the artifact.

## Completion Report
Environment header, exact command, decision + per-collection counts, artifact path + SHA-256, "no writes occurred",
recommended next gate.
```
