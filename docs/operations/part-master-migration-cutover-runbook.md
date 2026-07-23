# Part Master Migration — Cutover Readiness & Plan (INV-1 Phase 1 PR 1.10)

**Status:** PREPARATION ONLY. Nothing in this document authorizes execution. Migration writes, backfills, Rules/frontend deployment, and `PART_MASTER_REFERENCE` activation each remain separately Owner-gated. The PR 1.8 analyzer has **no write mode**; no write tooling exists in the repository.

Governing artifacts: ADR-008 (Accepted), Decisions #37/#38/#40, `docs/implementation-plans/inv1-phase1-part-master.md`, `docs/operations/inventory-effect-recovery-runbook.md` (operator-evidence conventions), SYSTEM_AUTHORITIES.md.

---

## 1. Approved source CSV schema

One header row, RFC-4180 quoting, UTF-8. Parsed by `functions/src/partMaster/csvMigrationAnalysis.ts` (single authority).

| Column | Required | Meaning |
|---|---|---|
| `internalPartNumber` | YES | Business identifier; normalized via the PR 1.1 `INTERNAL_PN` authority (uppercase, collapsed whitespace, `A-Z 0-9 . _ / # -`). For CREATE rows it becomes the canonical `partId` (sku-grandfathering, ADR-008 O-2). |
| `name` | YES | Display name (≤200 chars). |
| `controlType` | YES | `STANDARD \| SERIALIZED \| LOT \| SERIALIZED_LOT` (field only; behavior is Phase 6). |
| `stockingClass` | YES | `STOCKED \| NON_STOCK \| SERVICE \| KIT`. |
| `stockingUnit` | YES | Governed unit code (PR 1.1/1.5 authority). |
| `partId` | no | Explicit canonical id; mismatch with a resolved existing identity is a `IMMUTABLE_ID_MUTATION` conflict. |
| `description`, `category` | no | Descriptive only. |
| `legacySku` | no | Would create/verify a `LEGACY` alias; ownership by another Part is a conflict. |
| `qty*` (any) | no | **Informational-only. Ignored by analysis and excluded from any write plan — stock truth stays the inventory ledger.** |

Classifications: `CREATE` / `UPDATE` / `NO_CHANGE` / `CONFLICT` / `INVALID` with 14 stable reason codes (13 demonstrable; `AMBIGUOUS_CREATE_VS_UPDATE` is an unreachable defensive guard under the current resolution order — retained as defense-in-depth).

## 2. Evidence generation (repeatable, emulator-only)

```
cd functions && npm run build
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/generatePartMasterMigrationEvidence.js
```

The generator **refuses to run** without `FIRESTORE_EMULATOR_HOST` and refuses if `GOOGLE_APPLICATION_CREDENTIALS` is configured — production access is structurally impossible. It seeds disposable synthetic `MIGFIX-*` state through the governed trusted commands (fixed idempotency keys — reruns replay), executes `analyzePartMasterCsv.js` (dry-run, its only mode), and writes the 10-file package to `docs/audits/inv1-phase1/migration-readiness/`: `run-metadata.json`, `summary.json`, `row-results.json`, `conflicts.csv`, `invalid-rows.csv`, `cutover-readiness.json`, `cutover-readiness-report.md`, `operator-attestation.md`, `sensitive-scan.txt`, `checksums.sha256`. Output is deterministic except timestamp fields (`generatedAt`, attestation date) — asserted by `functions/test/migrationEvidence.test.mjs`.

A **cutover-qualifying** run differs only in input: the Owner-approved production-source CSV (separately gated, incl. any production reads) replaces the synthetic fixture, and its package must PASS every criterion below.

## 3. Cutover entry criteria (all must hold before execution is even proposed)

Computed by `functions/src/partMaster/cutoverReadiness.ts` (`evaluateCutoverReadiness`, C1–C20): zero INVALID rows; zero duplicate partIds / normalized IPNs; zero ambiguous or multi-match rows; zero alias conflicts; all units recognized; inactive-target conflicts resolved; immutable-id mutations absent; supplier-item inconsistencies reviewed; Owner approval of the exact CREATE and UPDATE populations; approved rollback point, reconciliation method, production operator, and maintenance window (or explicit waiver); `PART_MASTER_REFERENCE` verified OFF; repository-vs-production Rules state confirmed; no quantity/availability recalculation in scope; no historical Work Order rewrite in scope; **every D-M decision (§6) resolved**. Any failure ⇒ **BLOCKED**.

## 4. Cutover exit criteria (define "done" for the future execution gate)

- Post-write reconciliation report: written record counts exactly equal the approved CREATE/UPDATE populations; zero unexplained residue; re-running the analyzer over the same input against post-cutover state yields `NO_CHANGE` for every previously-CREATE/UPDATE row and zero new conflicts.
- Every write carries the house audit trail (trusted-command audit events, deterministic idempotency keys derived from the approved input hash + row identity).
- Zero writes outside `parts` / `part_aliases` (and `part_supplier_items` only if D-M4 resolves to "included").
- Ledger, quantities, reservations, availability, reorder data, and historical Work Orders byte-untouched.
- Evidence package (same 10-artifact shape) committed with checksums; Owner sign-off recorded in DECISIONS.md.

## 5. Cutover plan (documented, NOT executed)

1. **Pre-cutover backup/export:** Firestore export (or emulator-verified equivalent) of `parts`, `part_aliases`, `part_supplier_items` recorded by path + hash; this is the approved rollback point (C12).
2. **Approved input hash:** the exact SHA-256 of the Owner-approved CSV is pinned in the authorizing gate; the executor verifies it before any write (mismatch = hard stop).
3. **Roles:** named production operator + independent reviewer, both Owner-approved (C14); operator follows the Cloud Shell handoff conventions of the Phase 0 production-detection precedent (canonical LF git-blob hashes).
4. **Dry-run verification:** a fresh dry-run against production-state reads must reproduce the approved package byte-for-byte (except timestamps) immediately before execution.
5. **Approval thresholds:** the authorizing gate pins exact expected counts (CREATE=n, UPDATE=m, NO_CHANGE=k, CONFLICT=0, INVALID=0); any deviation at execution time = hard stop.
6. **Write tooling (future, separate PR + gate):** a write-enabled importer does not exist and must be delivered by its own reviewed PR; it must reuse the trusted commands (never raw writes), consume only an analysis package, and refuse inputs whose hash differs from the approved one.
7. **Idempotency:** every write keyed deterministically (input hash + row identity) so a rerun after partial failure replays completed rows and continues — never duplicates.
8. **Partial failure:** stop-on-first-unexpected-error; completed rows stand (idempotent); the operator re-runs after diagnosis; no compensating deletes without a new gate.
9. **Audit:** all writes emit the standard Part Master audit events; the execution evidence package records the audit-event count reconciliation.
10. **Post-write reconciliation:** per §4; report committed as evidence.
11. **Rollback triggers:** count deviation, unexpected conflict class, audit mismatch, reconciliation residue, or any write outside the approved collections.
12. **Rollback procedure:** restore from the §5.1 export (Owner-gated); Part Master collections are tenant-inert and client-write-closed, so restore risk is isolated; the ledger is untouched by construction.
13. **Production verification:** post-cutover spot reads + full reconciliation before the gate closes.
14. **Flag sequencing:** `PART_MASTER_REFERENCE` stays OFF through cutover; activation (if D-M6 = separate) is its own later gate with its own parity evidence.
15. **Quantity separation:** quantity/availability migration is **out of scope permanently for this plan**; any future quantity work is a distinct Owner-gated program against the ledger, never this CSV path.

## 6. Unresolved Owner decisions (each BLOCKS cutover — C20)

| Id | Question |
|---|---|
| D-M1 | CREATE and UPDATE in one cutover, or separate gates? |
| D-M2 | Aliases created in the same execution, or a follow-up gate? |
| D-M3 | Inactive-target Parts excluded from input, or remediated first? |
| D-M4 | part_supplier_items relationships deferred, or included? |
| D-M5 | Historical identifiers: LEGACY-alias backfill beyond row-declared values? |
| D-M6 | PART_MASTER_REFERENCE activation separate from migration execution? (recommended: yes) |
| D-M7 | Repository-only client-read Rules: deploy before, during, or after cutover? |

## 7. Source-data safety (standing constraints)

Synthetic or Owner-approved sanitized fixtures only until a production-source gate; no production customer/supplier/pricing/quantity/PII data in any committed artifact; no supplier cost data in evidence; no secrets or credentials; sensitive scan must be CLEAN for every committed package; the source CSV itself is never copied into evidence (only its hash).
