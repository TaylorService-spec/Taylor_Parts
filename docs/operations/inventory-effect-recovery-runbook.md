# Operator Runbook — Work Order Inventory-Effect Recovery (INV-1 Phase 0)

**Gate context:** INV-1 Phase 0, PR 0.3 (docs/governance only).
**Standard:** follows [`../governance/audit-artifact-standard.md`](../governance/audit-artifact-standard.md) and [`../governance/execution-environments.md`](../governance/execution-environments.md).
**Governing chain:** `docs/implementation-plans/enterprise-inventory-architecture.md` Phase 0 (§7b), adopted per `docs/DECISIONS.md` #37; tooling adopted per #38.
**Authority map:** `docs/architecture/SYSTEM_AUTHORITIES.md` (inventory-effect recovery rows).

> **This runbook authorizes nothing.** Every production step below is gated:
> **Gate 0.4(a)** — read-only production detection — requires its own explicit Owner authorization.
> **Gate 0.4(b)** — production retry — requires an Owner Production Data Authorization naming the **exact** `{workOrderId, state}` batch.
> The presence of a command template in this document never authorizes its execution.

---

## A. Purpose and scope

Work Order inventory effects run **post-commit**: `transitionWorkOrder` commits the Work Order transition first, then calls `triggerInventoryEffects(workOrderId, state)` (DISPATCHED→reserve, COMPLETED→consume+finalize, CANCELLED→release). Two loss classes exist (finding **INV-1, High**):

- **RECORDED_FAILURE** — the trigger ran and failed; `inventory_sync_status.failures[state]` exists with `retryNeeded: true`. Nothing in the runtime ever reads or re-drives it.
- **SILENT_MISS** — the trigger never ran (crash between commit and trigger, or the failure record itself failed); **no marker exists at all**. Only comparing Work Order lifecycle evidence against `inventory_sync_status` finds it.

Roles of the Phase 0 components:

| Component | Role | Authority |
|---|---|---|
| `functions/src/inventoryEffectDetection.ts` (PR 0.1) | Pure classifier: PROCESSED / RECORDED_FAILURE / SILENT_MISS / NOT_EXPECTED, with reason codes, retry candidacy, and review flags. No I/O of any kind. | Sole classification authority — scripts never re-implement detection |
| `functions/scripts/auditInventoryEffects.js` (PR 0.2) | READ-ONLY scan + evidence artifact | Gate 0.4(a) tool |
| `functions/scripts/retryInventoryEffects.js` (PR 0.2) | Exact-batch re-drive of the **existing** idempotent `triggerInventoryEffects` path | Gate 0.4(b) tool |

**Why retries stay exact-list and Owner-authorized:** a retry writes real, append-only ledger entries. The detector cannot judge whether a retry *should* happen (a stale silent miss on a long-closed Work Order may be better corrected by a governed adjustment than a late reservation). The Owner reviews each candidate and approves an exact list; the retry script structurally refuses everything else — no wildcard mode exists.

## B. Preconditions (all runs, emulator or production)

1. Current repository checkout at the approved commit (record `git rev-parse HEAD` in the run notes; the scripts embed `scriptVersion: inv1-phase0-pr02`).
2. `cd functions && npm ci && npm run build` — the scripts consume the **compiled** `lib/` detector and effect path.
3. Working tree free of uncommitted changes that could contaminate evidence (`git status` clean, or unrelated changes documented in the run notes).
4. Operator authenticated appropriately for the target environment (production runs happen in the authenticated operator environment per `execution-environments.md` — never from an unauthenticated session; no credential is ever committed or pasted into evidence).
5. Active project verified: the scripts have **no default project**; `--project-id` and an exactly matching `--confirm-project` are both required, validated **before** Firebase initialization.
6. Output directory **outside the repository** (e.g. an OS temp path) unless a governed evidence import is the explicit purpose of the run.
7. For any production step: the specific Owner gate below, in writing, first.

## C. Gate 0.4(a) — read-only production detection (documented, NOT executed)

> **Gate 0.4(a) authorizes read-only production inspection only. It does not authorize retry.**
> **Requires separate Owner authorization** naming the target project and run scope before execution.

1. **Approval:** obtain the explicit Owner authorization (project, scope, date).
2. **Run** (template — placeholders in `<>`):

   ```
   cd functions
   npm run build
   node scripts/auditInventoryEffects.js \
     --project-id taylor-parts \
     --confirm-project taylor-parts \
     --output-dir <path-outside-repo>/inventory-effects-<YYYY-MM-DD>
   ```

   Optional scoping: `--work-order-id <WO-id>` (repeatable; exact-filter mode never lists the collection), `--page-size <1..1000>` (default 300), `--max-work-orders <n>` (hard cap; truncation is recorded in the artifact, never silent), `--json` (terminal summary JSON).
3. **Exit codes:** `0` = audit complete, no retry candidates; `3` = audit complete, ≥1 retry candidate; `1` = invalid invocation (nothing ran); `2` = technical failure. Invoke directly (not through a pipeline) when the exit code gates a decision — a piped invocation reports the last pipeline element's exit code.
4. **Artifacts** (written to `--output-dir` only; the run never writes Firestore): `run-metadata.json` (project, mode, filters, scan scope, truncation flag, script version, complete read-only Firestore method surface), `summary.json` (counts by classification and by state), `detection-results.jsonl` (one detection outcome per Work Order), `retry-candidates.json`, `warnings.json` (flagged items + invalid records), `sensitive-scan.txt`, `checksums.sha256`.
5. **Verify checksums** (section “Command examples”) and confirm `sensitive-scan.txt` reads `CLEAN` before the artifact leaves the operator environment.
6. **Interpretation:**
   - **PROCESSED** — canonical marker present; no action.
   - **RECORDED_FAILURE** — trigger ran and failed (`retryNeeded: true`); retry candidate.
   - **SILENT_MISS** — lifecycle evidence with no marker; retry candidate, always operator-review-required.
   - **NOT_EXPECTED** — no lifecycle evidence for that effect; no action (under degraded status evidence these carry a review flag — treat as “could not tell”, not “definitely fine”).
   - **Warning-bearing / malformed evidence** (`warnings.json`) — do **not** convert to retry input; investigate first (Section I).

## D. Owner review between gates (required, manual)

**No automatic conversion from audit output to retry input is permitted.** `retry-candidates.json` is review *input*, never retry input. For each candidate the operator prepares a review artifact (one row per pair) containing:

| Field | Content |
|---|---|
| Work Order ID / state | exact pair |
| Classification + reason code | from the audit artifact |
| Supporting evidence | the item's evidence block (markers, lifecycle source, finalized flag, snapshot count) |
| Retry eligibility | clean RECORDED_FAILURE / SILENT_MISS only; anything flagged is ineligible pending investigation |
| Business-risk note | e.g. Work Order age, customer impact, availability position for the part(s) |
| Expected inventory effect | RESERVE / CONSUME_AND_FINALIZE / RELEASE and the quantities implied by the Work Order snapshot |
| Known retry risks | e.g. reserve may legitimately fail on insufficient availability; late effects on long-terminal Work Orders |
| Operator recommendation | retry / investigate / correct-by-governed-adjustment |

The Owner's Gate 0.4(b) authorization must name the exact approved pairs (and only those).

## E. Gate 0.4(b) — exact-batch production retry (documented, NOT executed)

> **NO WILDCARD RETRY, RETRY-ALL, OR AUTOMATIC CANDIDATE EXPANSION IS PERMITTED.**
> **Requires a separate, explicit Owner Production Data Authorization** naming the exact `{workOrderId, state}` list, the commit, and the project.

1. **Input file:** create the batch file containing exactly the Owner-approved pairs — nothing else — and treat it as immutable once approved:

   ```json
   [
     { "workOrderId": "<WO-id>", "state": "DISPATCHED" }
   ]
   ```

   Supported states: `DISPATCHED` | `COMPLETED` | `CANCELLED`. Any other key, state, or shape aborts the run before any execution. Record the file's SHA-256 in the authorization (the script independently records it in `run-metadata.json` as `inputBatchSha256`).
2. **Run** (template):

   ```
   cd functions
   npm run build
   node scripts/retryInventoryEffects.js \
     --project-id taylor-parts \
     --confirm-project taylor-parts \
     --confirm-owner-authorized-retry \
     --input <approved-batch>.json \
     --output-dir <path-outside-repo>/inventory-effects-retry-<YYYY-MM-DD>
   ```

   `--confirm-owner-authorized-retry` is the operator's acknowledgement that the Gate 0.4(b) authorization exists for this exact batch; the script refuses to run without it (and without the matching project confirmation).
3. **Preflight (automatic, per pair):** the script re-reads the Work Order + sync evidence and re-runs the detector. It **refuses**: `REFUSED_ALREADY_PROCESSED`, `REFUSED_NOT_EXPECTED`, `REFUSED_WORK_ORDER_NOT_FOUND`, `REFUSED_INVALID_EVIDENCE`, `REFUSED_FLAGGED_EVIDENCE` (any detection warning). Only clean RECORDED_FAILURE / SILENT_MISS pairs execute.
4. **Execution:** the existing idempotent `triggerInventoryEffects` runs **exactly once** per approved pair. Nothing is reimplemented; no guard is bypassed.
5. **Stop conditions:** an unexpected systemic error (SDK/infrastructure exception) records `SYSTEMIC_ERROR_STOP` and **stops the batch immediately**; remaining pairs record `NOT_ATTEMPTED_AFTER_SYSTEMIC_STOP`. Expected **business failures** (`BUSINESS_FAILURE_RECORDED`, e.g. “Insufficient available quantity…”) are recorded distinctly with the recorded error message and the batch **continues**. Errors are never suppressed. Note: a failed retry re-records a `failures[state]` entry — that is the existing path's own bookkeeping, not new mutation added by the tool.
6. **Exit codes:** `0` = every attempted pair `RESOLVED_PROCESSED`; `3` = completed with refusals / business failures / unresolved items; `1` = invalid invocation (nothing ran); `2` = systemic stop or technical failure.

## F. Post-retry verification (required)

1. The script's built-in **post-check** re-reads evidence and re-runs the detector per pair, recording the final classification (`RESOLVED_PROCESSED` / `BUSINESS_FAILURE_RECORDED` / `UNRESOLVED_REVIEW_REQUIRED`) in `retry-outcomes.json`.
2. Independently **re-run the read-only audit** (Section C — the Gate 0.4(a) authorization should cover this re-detection pass) and confirm the approved pairs no longer appear as candidates.
3. Where appropriate, verify the ledger result itself (e.g. the expected `inventory_transactions` entries for the Work Order) through an authorized read path.
4. Preserve pre-run and post-run artifacts (Section G).
5. Review every non-`RESOLVED_PROCESSED` outcome (Section I).
6. **Never claim success from a process exit code alone** — the evidence artifacts and the re-audit are the record.

## G. Evidence handling (per `audit-artifact-standard.md`)

- **Run ID convention:** `inventory-effects[-retry]-<YYYY-MM-DD>` (add `-2`, `-3` for same-day reruns).
- **Output location:** operator-specified `--output-dir` outside the repository; artifacts enter the repo only through a governed evidence-import PR into `docs/audits/inventory-effects/<run-id>/`.
- **Artifact list:** audit — `run-metadata.json`, `summary.json`, `detection-results.jsonl`, `retry-candidates.json`, `warnings.json`, `sensitive-scan.txt`, `checksums.sha256`; retry — `run-metadata.json`, `retry-outcomes.json`, `summary.json`, `sensitive-scan.txt`, `checksums.sha256`.
- **Checksum verification** before and after any transfer between environments (command below); byte-identity across the transfer is the requirement.
- **Sensitive scan** must read `CLEAN` (the script pre-scans; the import PR re-reviews per the standard).
- **Archive packaging:** package the run directory as a single archive for transfer; verify `checksums.sha256` after unpacking.
- **Evidence files are never modified** after generation — corrections are new runs. Preserve line endings on import (`.gitattributes` in the evidence directory when needed, per the functions-live-state precedent).

## H. Rollback and recovery

- The **scripts** are additive tooling: reverting their PRs removes them cleanly.
- **Ledger effects are append-only and not casually reversible.** A retry is **never** “rolled back” by deleting or editing `inventory_transactions` records — history is never rewritten (ADR-003; `inventory_actions`' own rule: correcting a mistake means recording another action).
- An **incorrect production effect** requires a separately governed adjustment/correction process with its own Owner authorization — out of Phase 0 scope.
- **Idempotency protects against duplicate processing only while canonical processed-state evidence is intact** (`processedStates[state] === true`). Do not manually edit `inventory_sync_status` — destroying the marker would re-arm the trigger for a state that already applied.

## I. Escalation conditions — stop and escalate to the Owner when

1. Project confirmation mismatches (or any prompt to bypass it).
2. Evidence is malformed (`REFUSED_INVALID_EVIDENCE`, `PROCESSED_MARKER_MALFORMED`, `FAILURE_ENTRY_MALFORMED`, invalid records in `warnings.json`).
3. Warning-bearing evidence appears on a pair someone wants retried (`REFUSED_FLAGGED_EVIDENCE`).
4. A requested state is unsupported, or a pair is `REFUSED_ALREADY_PROCESSED` / `REFUSED_NOT_EXPECTED` yet someone expects it to run.
5. A retry post-checks `UNRESOLVED_REVIEW_REQUIRED`.
6. The same pair records a business failure twice (availability or data problem needing its own governed fix).
7. `SYSTEMIC_ERROR_STOP` occurs.
8. Ledger and sync evidence conflict (e.g. `FINALIZED_WITHOUT_PROCESSED_MARKER`, `PROCESSED_AND_FAILURE_CONFLICT`).
9. The batch someone asks to run differs in any way from the Owner-approved list.

## Command examples (placeholders; production sections require separate Owner authorization)

```bash
# Help output (safe anywhere)
node scripts/auditInventoryEffects.js --help
node scripts/retryInventoryEffects.js --help

# Emulator / local validation (no production credentials involved)
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/auditInventoryEffects.js \
  --project-id demo-inv1 --confirm-project demo-inv1 --output-dir /tmp/inv1-audit
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/retryInventoryEffects.js \
  --project-id demo-inv1 --confirm-project demo-inv1 \
  --confirm-owner-authorized-retry --input batch.json --output-dir /tmp/inv1-retry

# Read-only production audit -- Requires separate Owner authorization (Gate 0.4a)
node scripts/auditInventoryEffects.js --project-id taylor-parts \
  --confirm-project taylor-parts --output-dir <outside-repo>/inventory-effects-<date>

# Exact Work Order audit -- Requires separate Owner authorization (Gate 0.4a)
node scripts/auditInventoryEffects.js --project-id taylor-parts \
  --confirm-project taylor-parts --work-order-id <WO-id> \
  --output-dir <outside-repo>/inventory-effects-<date>

# Exact-batch retry -- Requires separate Owner authorization (Gate 0.4b)
node scripts/retryInventoryEffects.js --project-id taylor-parts \
  --confirm-project taylor-parts --confirm-owner-authorized-retry \
  --input <approved-batch>.json --output-dir <outside-repo>/inventory-effects-retry-<date>

# Checksum verification (from inside a run directory)
sha256sum -c checksums.sha256

# Archive packaging for transfer
tar -czf inventory-effects-<date>.tar.gz -C <outside-repo> inventory-effects-<date>
```

No live credentials or secrets appear in this document or in any artifact; the scripts' sensitive scan enforces this on every run.
