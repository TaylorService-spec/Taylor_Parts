# Operational Handoff — INV-1 Gate 0.4(a) Production Inventory-Effect Detection (Read-Only)

**Gate:** INV-1 Phase 0, Gate 0.4(a) — Owner-authorized 2026-07-22 (read-only production detection only; Gate 0.4(b) retry remains unauthorized).
**Standard:** follows [`../governance/audit-artifact-standard.md`](../governance/audit-artifact-standard.md) and [`../governance/execution-environments.md`](../governance/execution-environments.md).
**Template:** an instance of [`../governance/templates/operational-handoff.md`](../governance/templates/operational-handoff.md).
**Runbook:** [`inventory-effect-recovery-runbook.md`](inventory-effect-recovery-runbook.md) §B–§C (this handoff pins the run-specific values).

This handoff separates the environments deliberately (functions-live-state precedent):

- **A. Repository preparation (DONE, Windows Claude Code).** Tooling merged (PRs #373/#374/#376), pre-run verification complete, script hashes pinned below. A single credential-boundary probe from the repository environment failed as designed ("Could not load the default credentials") — no production connection was made.
- **B. Production detection (TODO, authenticated Cloud Shell operator).** Run the read-only audit; verify; package.
- **C. Evidence return (TODO, separate governed PR).** Import artifacts to `docs/audits/inventory-effects/<RUN_DATE>/` and finalize the production detection report.

```text
# Operational Handoff

## Objective
Run the first read-only production inventory-effect detection audit for taylor-parts and
produce the governed evidence artifact (Gate 0.4a).

## Gate
INV-1 Phase 0, Gate 0.4(a). Read authorization only. Gate 0.4(b) (retry) is NOT authorized;
retryInventoryEffects.js must not be executed.

## Execution Environment
Host:            Google Cloud Shell (authenticated operator environment)
Shell:           bash/Linux
Repository:      ~/Taylor_Parts (fresh clone or fetch)
Worktree:        clean detached checkout of origin/main @ 0d1ff0fb26a5ac16ffd0ce3c26550f45a8a54faf
Branch:          detached at the pinned commit (no branch edits)

## Executor
Cloud Shell operator (Owner-authenticated). One actor.

## Authorization
Owner Gate 0.4(a) authorization of 2026-07-22: read-only production detection, evidence
creation/verification/packaging only.

## Production Classification
read-only. (The audit script performs zero Firestore writes; its complete Firestore method
surface is exported as FIRESTORE_METHODS_USED and recorded in run-metadata.json.)

## Preconditions
1. origin/main contains PRs #373/#374/#376 (detection engine, operator tooling, runbook).
2. Checkout is clean and detached at 0d1ff0fb26a5ac16ffd0ce3c26550f45a8a54faf.
3. Script integrity — SHA-256 must match exactly (stop on mismatch):
   59e2edeb41234c6b066cb605d04a0437729d7be7c25ffc480478441c01df1538  functions/scripts/auditInventoryEffects.js
   ea6e8e66f5978b35e691e66aacdbf9b1c39fc29ede4f1997b0e1790753656919  functions/scripts/inventoryEffectOperatorShared.js
   e7e7275ce61dff16e60dbc088651e968080d15e37943642b409c53a55c5bf084  functions/src/inventoryEffectDetection.ts
4. Identity/project verification (record outputs):
   gcloud auth list
   gcloud config get-value project        # must be taylor-parts; stop otherwise
5. FIRESTORE_EMULATOR_HOST must be unset:  [ -z "$FIRESTORE_EMULATOR_HOST" ] && echo OK
6. Node 20+ available; record node --version && npm --version.
   (Repository reference run used Node v22.19.0 / npm 10.9.3 / firebase-admin ^12.7.0.)

## Exact Commands
RUN_ID="inventory-effects-production-detection-$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$HOME/$RUN_ID"                       # OUTSIDE the repository — never a repo path
cd ~/Taylor_Parts
git fetch origin && git checkout --detach 0d1ff0fb26a5ac16ffd0ce3c26550f45a8a54faf
sha256sum -c <<'EOF'
59e2edeb41234c6b066cb605d04a0437729d7be7c25ffc480478441c01df1538  functions/scripts/auditInventoryEffects.js
ea6e8e66f5978b35e691e66aacdbf9b1c39fc29ede4f1997b0e1790753656919  functions/scripts/inventoryEffectOperatorShared.js
e7e7275ce61dff16e60dbc088651e968080d15e37943642b409c53a55c5bf084  functions/src/inventoryEffectDetection.ts
EOF
cd functions && npm ci && npm run build
date -u +%Y-%m-%dT%H:%M:%SZ               # record start time
node scripts/auditInventoryEffects.js \
  --project-id taylor-parts \
  --confirm-project taylor-parts \
  --output-dir "$OUT"
echo "exit=$?"                            # record — direct invocation, no pipeline
date -u +%Y-%m-%dT%H:%M:%SZ               # record end time
cd "$OUT" && sha256sum -c checksums.sha256 && cat sensitive-scan.txt
cd ~ && tar -czf "$RUN_ID.tar.gz" "$RUN_ID"
sha256sum "$RUN_ID.tar.gz" > "$RUN_ID.tar.gz.sha256" && sha256sum -c "$RUN_ID.tar.gz.sha256"

## Expected Output
- Terminal banner "READ_ONLY_AUDIT -- zero Firestore writes"; project taylor-parts, NO emulator tag.
- Exit code 0 (no retry candidates) or 3 (candidates found) — both are successful audits.
  1 = invalid invocation (nothing ran); 2 = technical failure — report, do not improvise.
- Artifacts in $OUT: run-metadata.json, summary.json, detection-results.jsonl,
  retry-candidates.json, warnings.json, sensitive-scan.txt, checksums.sha256.
- checksums verify OK for every file; sensitive-scan.txt reads CLEAN (or every finding documented).
- Terminal totals: scanned Work Orders, PROCESSED / RECORDED_FAILURE / SILENT_MISS /
  NOT_EXPECTED, retry candidates, flagged items, invalid records.

## Artifact Source
$HOME/<RUN_ID>/ plus $HOME/<RUN_ID>.tar.gz and .tar.gz.sha256 in Cloud Shell.

## Artifact Destination
docs/audits/inventory-effects/<RUN_DATE>/ via a separate governed evidence-import PR
(suggested branch governance/inventory-effects-production-detection-evidence). Never
imported directly into main; the import PR carries a -text .gitattributes rule to
prevent line-ending conversion.

## Integrity Verification
External archive SHA-256 verified in Cloud Shell before transfer AND after transfer to the
repository environment; embedded checksums.sha256 re-verified after extraction; evidence
files byte-identical end to end — never edited, reserialized, renamed, or re-generated.

## Sensitive Data Review
sensitive-scan.txt must be reviewed (script pre-scans for key/token shapes). Project IDs /
document IDs are permitted classifications per the audit standard; private keys, tokens,
service-account material, or credentials are stop conditions. Evidence files are never
modified to remove findings — a finding stops the import instead.

## Stop Conditions
Active project != taylor-parts; script SHA-256 mismatch; dirty/wrong-commit checkout;
FIRESTORE_EMULATOR_HOST set; exit code 1 or 2; checksum verification failure; sensitive
finding; any indication of an attempted mutation; any prompt to run retryInventoryEffects.js.

## Rollback / Recovery
n/a — read-only/non-mutating. No production document is created, updated, or deleted.

## Prohibited Actions
No retry of any kind (Gate 0.4b unauthorized); retryInventoryEffects.js must not be executed;
no production writes; no ledger/inventory_sync_status/Work Order mutation; no Function, Rules,
or index deploy; no IAM change; no credential creation/rotation/download; no undocumented
flags; no editing of generated evidence; no repository modification from the operator run.

## Completion Report
Return: identity outputs (gcloud auth list / project), commit + script-hash verification
results, exact command, start/end UTC times, exit code, terminal totals (scanned count and
all classification/candidate/warning/invalid totals), artifact list, checksum result,
sensitive-scan result, archive name + external SHA-256, explicit no-mutation confirmation,
and transfer status. The evidence-import PR and the production detection report (including
the A / B / C recovery determination) are prepared afterward in the repository environment.
```

## After the operator run (repository environment, separate governed PR)

1. Transfer both the `.tar.gz` and its `.sha256` sidecar; re-verify the external checksum; extract; re-verify `checksums.sha256`.
2. Import to `docs/audits/inventory-effects/<RUN_DATE>/` with `.gitattributes` (`* -text`) on the evidence directory.
3. Finalize the production detection report with the required determination — **A. NO RECOVERY REQUIRED**, **B. OWNER REVIEW REQUIRED** (candidates exist; no retry authorized), or **C. INVESTIGATION REQUIRED** (malformed/warning-bearing evidence) — plus the full §14 field list from the Gate 0.4(a) authorization. The report must not state that Gate 0.4(b) is approved.
4. Update the implementation plan §7b production-audit state. Owner reviews and merges the evidence PR.
