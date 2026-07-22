# INV-1 Phase 0 — PR 0.3 Runbook & Governance Validation

**Gate:** INV-1 Phase 0, PR 0.3 (Owner-authorized 2026-07-22; documentation and governance only).
**Baseline:** `origin/main` @ `c975258` (PR 0.1 merged #373 / PR 0.2 merged #374).
**No production operation:** neither script was run against production; no production read, retry, or Gate 0.4 execution occurred. **No code changed** in this PR — documentation and governance files only.

## 1. Files reviewed before editing

The four enterprise-inventory governance docs (assessment/spec/plan + DECISIONS #37), `audit-artifact-standard.md`, `execution-environments.md`, `operational-handoff.md` template, `SYSTEM_AUTHORITIES.md` (actual location: `docs/architecture/`), both PR 0.1/0.2 validation docs, all three operator-tool sources, the compiled detector contract, and the functions-live-state operational handoff (the operations-doc precedent).

## 2. Runbook created

`docs/operations/inventory-effect-recovery-runbook.md` — sections: A purpose/scope (loss classes, component roles, why exact-list); B preconditions; C Gate 0.4(a) read-only detection (documented, not executed; prominently states inspection-only); D Owner review between gates (required review-artifact fields; no automatic audit→retry conversion); E Gate 0.4(b) exact-batch retry (documented, not executed; prominently states no-wildcard); F post-retry verification (no success claims from exit codes alone); G evidence handling (run-ID/output conventions, artifact list, checksums, sensitive scan, archive, import process, no-modification rule, line endings); H rollback/recovery (append-only ledger, no ledger deletion, governed-adjustment boundary, idempotency caveat); I escalation conditions (11 stop-and-escalate triggers); command templates (help, emulator, production audit, exact-WO audit, exact-batch retry, checksum verify, archive) — placeholders only, every production section marked "Requires separate Owner authorization."

## 3. Script/document consistency verification (checked against actual `--help` output and sources)

| Item | Verified |
|---|---|
| Flag names | audit: `--project-id`, `--confirm-project`, `--output-dir`, `--work-order-id` (repeatable), `--page-size`, `--max-work-orders`, `--json`, `--help`; retry: + `--confirm-owner-authorized-retry`, `--input`. Match help output exactly; no undocumented flags documented. |
| Required arguments / project confirmation | Both scripts refuse without `--project-id` + exactly matching `--confirm-project`, validated before Firebase init; no default project. |
| Retry authorization acknowledgement | `--confirm-owner-authorized-retry` required; refusal message verified. |
| Input-file format / supported states | JSON array of `{workOrderId, state}`, states `DISPATCHED\|COMPLETED\|CANCELLED`; extra keys/unsupported states abort pre-execution. |
| Artifact names | audit: run-metadata.json, summary.json, detection-results.jsonl, retry-candidates.json, warnings.json; retry: run-metadata.json, retry-outcomes.json, summary.json; both: sensitive-scan.txt, checksums.sha256 — match sources exactly. |
| Exit codes | audit 0/3/1/2 and retry 0/3/1/2 as documented in each script header; runbook repeats them verbatim and carries the piped-invocation caveat. |
| Defaults / pagination / filters | page size 300 (1..1000), `--max-work-orders` truncation recorded (never silent), exact-filter mode never lists the collection. |
| Stop-on-error / post-check | systemic stop + NOT_ATTEMPTED semantics, business-failure-continues policy, per-pair post-check re-detection — match `runRetryBatch`. |
| Checksum file / sensitive scan | `checksums.sha256` (`<sha256><2 spaces><name>` lines, `sha256sum -c`-compatible); pattern-based sensitive scan writing `sensitive-scan.txt`. |

No flag or behavior is documented that does not exist.

## 4. System-authority registration

`docs/architecture/SYSTEM_AUTHORITIES.md`: 6 rows added after the inventory-ledger row — detection/classification (pure detector, sole authority, no runtime import), production audit execution (read-only operator script, Owner-gated per run, operators never self-authorize), **retry authorization (Owner only)**, retry execution (script → existing `triggerInventoryEffects`; trusted runtime effect authority stays `inventoryService.ts`), sync processed-state/failure evidence (written only by `inventoryService.ts`, never hand-edited), recovery evidence (audit-artifact standard, governed import). The scripts are explicitly not an application runtime authority.

## 5. Implementation-plan status changes

Plan §7b now records: PR 0.1 merged (#373/`0b82009`); PR 0.2 merged (#374/`c975258`); PR 0.3 implemented, pending Owner-reviewed merge; Gate 0.4(a) not authorized — **production findings unknown**; Gate 0.4(b) not authorized — no production recovery performed; and the explicit three-state completion distinction (repository implementation vs production audit vs production recovery) with only the first completable by this PR's merge. Phases 1–8 remain NOT AUTHORIZED.

## 6. DECISIONS.md disposition

**Appended #38** (next valid number after #37; append-only, no prior entry rewritten). Rationale for a new entry rather than relying on #37: #37 recorded adoption of the governance *chain* and deferred Phase 0 wholesale; the house convention records concrete adoption/deployment state changes as their own entries (precedent: #27–#32 recorded each Cancel/Void chain PR). #38 records: tooling adopted as the governed recovery mechanism; production detection separately authorized; retry requires exact Owner-approved pairs; no auto-expansion; no deployed callable/scheduler for Phase 0; scripts operator-invoked only; legacy `purchase_orders` direction and later phases unaffected.

## 7. Remaining production gates

Gate 0.4(a) — read-only production detection (not authorized; findings unknown). Gate 0.4(b) — exact-batch production retry (not authorized; meaningful only after 0.4(a) evidence + Owner review per runbook §D).

## 8. Confirmations

- **No production operation:** nothing executed against production at any point in PR 0.3.
- **No code change:** diff touches only `docs/**` (runbook, SYSTEM_AUTHORITIES, plan §7b, DECISIONS #38, this validation doc). No script, Function, Rules, index, schema, frontend, or CI change; no Customer-owned file touched.
