# INV-1 Phase 0 — PR 0.2 Operator Tooling Validation

**Gate:** INV-1 Phase 0, PR 0.2 (Owner-authorized 2026-07-22; script-based form previously approved).
**Governing chain:** `docs/implementation-plans/enterprise-inventory-architecture.md` Phase 0 / §7b, adopted per `docs/DECISIONS.md` #37.
**Production-use prohibition:** merging this PR authorizes NOTHING against production. Read-only production detection is **Gate 0.4(a)**; production retries are **Gate 0.4(b)** and require an Owner Production Data Authorization naming the exact `{workOrderId, state}` batch. Nothing in this PR was run against production; no retry was executed outside the local emulator.

## 1. Audit script contract — `functions/scripts/auditInventoryEffects.js`

READ-ONLY. Scans `fieldops_wos` (deterministic `__name__`-ordered pagination or exact `--work-order-id` filter), reads the matching `inventory_sync_status` doc per Work Order, projects both into the merged PR 0.1 pure detector's plain-data inputs, and aggregates classifications. Detection logic is never duplicated — the compiled `lib/inventoryEffectDetection` module is the sole classifier.

- **Required flags:** `--project-id <id>`, `--confirm-project <id>` (must match exactly; checked before `initializeApp()`), `--output-dir <path>`.
- **Optional:** `--work-order-id` (repeatable), `--page-size` (1..1000, default 300), `--max-work-orders` (cap; truncation is recorded, never silent), `--json`, `--help`.
- **No default project exists**; production never runs implicitly. `FIRESTORE_EMULATOR_HOST` enables credential-free local runs.
- **Read-only proof:** exported `FIRESTORE_METHODS_USED` names the complete (read-only) Firestore surface; a source-scan test asserts no write API (`set/add/update/delete/runTransaction/BulkWriter/FieldValue`) appears in the script.
- **Exit codes:** 0 = no retry candidates; 3 = retry candidates found; 1 = invalid invocation; 2 = technical failure.

## 2. Retry script contract — `functions/scripts/retryInventoryEffects.js`

CONTROLLED mutation, exclusively through the existing idempotent `triggerInventoryEffects(workOrderId, state)` (compiled `lib/inventoryService`) — reserve/release/consume/finalize and the processed-state guards are the existing path's; nothing is reimplemented or bypassed. (The existing path itself records a `failures[state]` entry when a retry fails — pre-existing behavior, not new writing.)

- **Explicit input only:** `--input <file>` — JSON array of `{ "workOrderId", "state" }`, states restricted to `DISPATCHED|COMPLETED|CANCELLED`. **No wildcard mode exists** (no retry-all / all-failed / all-silent; no expansion from audit output); a test asserts no wildcard flag appears in the CLI surface.
- **Required flags:** `--project-id`, matching `--confirm-project`, **`--confirm-owner-authorized-retry`** (explicit acknowledgement of an Owner Production Data Authorization for the exact batch — refused without it), `--input`, `--output-dir`.
- **Input hygiene:** malformed entries, unsupported states, and unexpected keys abort before any execution; duplicates are deterministically de-duplicated and reported; the raw batch file's SHA-256 is recorded.
- **Preflight (per pair):** re-read WO + sync evidence → run the PR 0.1 detector → refuse `REFUSED_ALREADY_PROCESSED`, `REFUSED_NOT_EXPECTED`, `REFUSED_WORK_ORDER_NOT_FOUND`, `REFUSED_INVALID_EVIDENCE`, and `REFUSED_FLAGGED_EVIDENCE` (any detection warning = investigate first, fail-safe). Only `RECORDED_FAILURE` / `SILENT_MISS` with clean evidence proceed.
- **Execution:** existing path invoked **exactly once** per approved pair.
- **Post-check:** re-read + re-detect → `RESOLVED_PROCESSED`, `BUSINESS_FAILURE_RECORDED` (expected business failure, e.g. insufficient availability — recorded distinctly with the recorded error message; batch **continues**), or `UNRESOLVED_REVIEW_REQUIRED`. Documented policy: unexpected systemic errors (`SYSTEMIC_ERROR_STOP`) **stop the batch immediately**; remaining pairs record `NOT_ATTEMPTED_AFTER_SYSTEMIC_STOP`. Errors are never suppressed.
- **Exit codes:** 0 = all pairs `RESOLVED_PROCESSED`; 3 = completed with refusals/business failures/unresolved; 1 = invalid invocation; 2 = systemic stop/technical failure.

## 3. Evidence artifacts (both scripts; `docs/governance/audit-artifact-standard.md`)

Written only to the operator-specified `--output-dir` (never into the repo implicitly, never to Firestore). Canonical key-sorted JSON (byte-deterministic for identical logical content). Audit: `run-metadata.json` (project, mode, filters, scan scope, truncation, script version, Firestore method surface, timestamp), `summary.json` (counts by classification and by state), `detection-results.jsonl`, `retry-candidates.json`, `warnings.json`. Retry: `run-metadata.json` (incl. input batch SHA-256 + authorization-acknowledged), `retry-outcomes.json` (preflight/execution/post-check per pair), `summary.json`. Both: `sensitive-scan.txt` (pattern scan for key/token shapes) + `checksums.sha256` (per-file SHA-256, test-verified against actual bytes). No secrets, tokens, or credentials are emitted.

## 4. Shared helpers — `functions/scripts/inventoryEffectOperatorShared.js`

Phase-0-focused only: CLI parsing, project confirmation, canonical JSON, SHA-256, artifact writing + sensitive scan, batch normalization. Pure/local-filesystem; no Firebase import; fully unit-tested.

## 5. Tests and results

`functions/test/inventoryEffectOperatorTools.test.js` — **25 pass / 0 fail** (`npm run test:inventoryEffectOperatorTools`; node --test, dependency-injected fakes, no emulator/network/credentials). Coverage per the authorization checklist: project-confirmation refusals (missing + mismatched, both scripts); owner-acknowledgement refusal; malformed input/unsupported state/duplicate handling; PROCESSED/NOT_EXPECTED/missing-WO/flagged-evidence refusals with **zero** trigger calls; exactly-once execution per approved pair; business-failure-vs-systemic distinction (continue vs stop); post-check classification; no-expansion-beyond-list; deterministic outputs; read-only proof (fake reader Proxy throws on any non-read member + source scans); checksum verification; sensitive-scan detection; help-text safety content.

**Emulator end-to-end (local `demo-inv1`, no credentials):** seeded a dispatched WO with snapshot and no sync doc → audit reported 1 SILENT_MISS / 1 retry candidate + artifacts (sensitive scan CLEAN) → retry batch of that exact pair → `RESOLVED_PROCESSED: 1`, a real `RESERVED` ledger entry (TST-1001, qty 2) written by the existing path, processed marker set → re-audit: **0 SILENT_MISS, 0 retry candidates**. Emulator torn down by exact PID; debug logs removed.

**Regression:** detector 38/38; transitionEngine 24/24; `tsc` build clean; `git diff --check` clean. (workOrderEngineFunctions 29/29 runs in CI on this PR.)

## 6. Known limitations

1. Exit codes of piped invocations reflect the last pipeline element (standard shell behavior) — the runbook (PR 0.3) should instruct direct invocation when the exit code gates a decision.
2. The audit's full-scan mode reads every `fieldops_wos` document (paginated); on very large datasets an operator should use `--max-work-orders`/filters — cost visibility, not correctness.
3. `REFUSED_FLAGGED_EVIDENCE` intentionally blocks retries on any detection warning; genuinely retry-worthy flagged items require investigation and (if appropriate) data correction under separate governance first.
4. The retry script cannot make a business failure succeed (e.g. genuine insufficient availability persists) — it records it distinctly for operator escalation.

## 7. Boundaries

- **PR 0.3 (not started):** operator runbook (detect → review → authorize → retry → re-detect), SYSTEM_AUTHORITIES registration, Phase 0 closeout docs.
- **Gate 0.4(a) (not authorized):** first read-only production detection run + committed evidence artifact.
- **Gate 0.4(b) (not authorized):** production retries; requires the exact Owner-approved pair list; the `--confirm-owner-authorized-retry` acknowledgement maps to that authorization.
