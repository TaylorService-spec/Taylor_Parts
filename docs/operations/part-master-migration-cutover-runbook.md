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

## 2b. Three governed paths (do not conflate)

| Path | Tool | Data | State touched | Status |
|---|---|---|---|---|
| **(1) Emulator demonstration** | `generatePartMasterMigrationEvidence.js` | synthetic MIGFIX fixture | disposable emulator fixtures only | live; reproduces the historical BLOCKED package; intentionally keeps all seven decisions unresolved |
| **(2) Production-read dry-run preparation** | `runPartMasterProductionDryRun.js` | Owner-approved production-source CSV (custody per the authorization record) | **ZERO writes** — reads `parts`/`part_aliases` from `taylor-parts` only | tooling merged; **execution remains a separate Owner gate** |
| **(3a) CREATE execution (cutover)** | `executePartMasterCreate.js` | approved CSV + approved analysis package | creates `parts/` via the trusted `createPart` command | tooling merged; **EXECUTION remains a separate Owner gate** that captures the C12 rollback point first |
| **(3b) UPDATE / alias / supplier execution** | does not exist yet | approved analysis package | writes via trusted commands | future, separately gated per Decision #42 D-M1/D-M2/D-M4 |

### CREATE importer (path 3a — documented; EXECUTION is a separate gate)

`executePartMasterCreate.js` builds the CREATE plan by re-parsing the Owner-approved source CSV (SHA-256 must equal `--input-sha256`) and cross-checking every derived `partId` against the approved analysis package's `proposedPartId` for that row. It **refuses** when: project ≠ `taylor-parts`; CSV hash ≠ approved hash; the package's `approvedInputSha256` ≠ approved hash; the package contains any non-CREATE row; the package CREATE count ≠ `--expected-count`; a derived `partId` diverges from the package; a built Part fails domain validation; `--commit` ≠ HEAD; `--output-dir` is non-empty; `PART_MASTER_REFERENCE` is enabled; or (`--execute` against production) `--acknowledge-production-write` is absent. Default mode is `--dry-run` (plan only, zero writes). `--execute` creates each Part **only** through the trusted `createPart` command (no raw writes; no alias/supplier-item/quantity/Rules writes), with a deterministic idempotency key `pmcreate-<hash16>-<partId>` so an interrupted run is safe to restart with no duplicate creation. Per-row evidence records SUCCESS / ALREADY_APPLIED / FAILED / NOT_ATTEMPTED; it **stops on the first failure** (never overwrites an existing non-equivalent Part — `createPart` raises `AlreadyExistsError`), which blocks reconciliation until the Owner resolves it. Production execution additionally requires the `inventory.catalog.manage` capability to be **granted**, and the C12 pre-write rollback export to be captured first.

**CREATE-execution capability grant/revoke (Decision #42; Privileged Approval Scope Correction):** the capability is carried by exactly one Role — `INVENTORY_CREATE_EXECUTOR_ROLE` (`inventoryCreateExecutor`, temporary, execution-scoped, **`privileged:false`**, grants only `inventory.catalog.manage`). It is **operational** authority (`docs/governance/privileged-approval-classification.md`): GRANT by ONE authorized Owner/admin + append-only audit — **no second approver required**. Create an audited `roleAssignment` (operator → `inventoryCreateExecutor`, global scope) via the trusted role-assignment path (`functions/src/access/trustedWriterCommands.ts`); confirm the operator now resolves `inventory.catalog.manage` (and nothing else new) before running `--execute`. REVOKE: **immediately after** CREATE execution + reconciliation, set the assignment `status` to revoked through the same audited path; confirm `inventory.catalog.manage` resolves DENY again. Both grant and revoke are append-only audited. (Wiring governed Roles into the trusted grant commands, which currently resolve `roleId` against compatibility Roles only, is a separate change.)

### Production-read dry-run invocation (path 2 — documented, NOT executed)

`runPartMasterProductionDryRun.js` hard-refuses (all reasons reported, nothing written, no connection made) when: project ≠ `taylor-parts` or `--project-id`/`--confirm-project` mismatch; the file's SHA-256 ≠ the Owner-approved `--input-sha256` (any modification voids the authorization); the source CSV is inside the repository or inside the evidence output dir; the output dir already exists non-empty (evidence is never overwritten); `--resolved-decisions` is not exactly the Decision #42 set `D-M1:B,D-M2:B,D-M3:A,D-M4:B,D-M5:B,D-M6:B,D-M7:C`; `--commit` ≠ checked-out HEAD; `--snapshot-date`/`--operator` missing; either explicit acknowledgement (`--acknowledge-dry-run`, `--acknowledge-production-read`) absent; `FIRESTORE_EMULATOR_HOST` is set (emulator/production ambiguity); or `PART_MASTER_REFERENCE` is enabled. It reuses the PR 1.8 analysis core (classification-only) and the Phase 1 readiness authority (C20 evaluates the resolved set; execution-gate approvals C9–C17 stay honestly pending per the per-gate rule), and writes the standard 10-artifact package — the source CSV is never copied into evidence (hash only). Tool-level zero-write enforcement is mandatory and credential-independent; no infrastructure-level read-only IAM is assumed or claimed.

**Cloud Shell operator sequence (execution gate only — the gate pins commit, snapshot date, path, and hash first):**

```
git clone https://github.com/TaylorService-spec/Taylor_Parts.git && cd Taylor_Parts
git checkout <pinned-commit>
cd functions && npm ci && npm run build
sha256sum <approved-csv-path-outside-repo>   # operator independently re-verifies the approved hash
node scripts/runPartMasterProductionDryRun.js \
  --project-id taylor-parts --confirm-project taylor-parts \
  --input <approved-csv-path-outside-repo> \
  --output-dir "$HOME/inv1-prod-dryrun-<runid>" \
  --input-sha256 <approved-sha256> --commit <pinned-commit> \
  --snapshot-date <YYYY-MM-DD> --operator "<approved operator>" \
  --resolved-decisions D-M1:B,D-M2:B,D-M3:A,D-M4:B,D-M5:B,D-M6:B,D-M7:C \
  --acknowledge-dry-run --acknowledge-production-read
sha256sum "$HOME/inv1-prod-dryrun-<runid>"/*   # record; import to the repo via governed PR (evidence-retention policy)
```

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

## 6. Owner cutover decisions — RESOLVED by Decision #42 (DECISIONS.md)

All seven decisions are resolved prospectively; **Decision #42 is the authority.** In future **cutover-qualifying** evidence runs the resolved set is supplied as invocation input, so criterion **C20 may evaluate as PASS** (`evaluateCutoverReadiness` is unchanged — unresolved decisions are an input). The demonstration generator intentionally remains configured with all seven unresolved so it keeps reproducing the original BLOCKED demonstration evidence; the committed Phase 1 package under `docs/audits/inv1-phase1/migration-readiness/` is historically accurate (the seven decisions WERE unresolved at generation time) and must never be regenerated or altered.

| Id | Question | Disposition (Decision #42) |
|---|---|---|
| D-M1 | CREATE and UPDATE in one cutover, or separate gates? | **B** — CREATE first, reconcile, then UPDATE separately |
| D-M2 | Aliases created in the same execution, or a follow-up gate? | **B** — Parts first; aliases in a separate reconciled gate |
| D-M3 | Inactive-target Parts excluded from input, or remediated first? | **A** — excluded until separately remediated via lifecycle governance |
| D-M4 | part_supplier_items relationships deferred, or included? | **B** — deferred to a separate gate |
| D-M5 | Historical identifiers: LEGACY-alias backfill beyond row-declared values? | **B** — no historical rewrite; aliases + PR 1.6/1.7 compatibility resolution |
| D-M6 | PART_MASTER_REFERENCE activation separate from migration execution? | **B** — separate post-reconciliation gate |
| D-M7 | Repository-only client-read Rules: deploy before, during, or after cutover? | **C** — after migration and reconciliation |

**Per-gate readiness rule (Decision #42):** each future execution gate evaluates C1–C20 against that gate's own approved population and scope; a passing CREATE gate approves nothing else — not UPDATE, aliases, supplier items, Rules deployment, resolver wiring, feature activation, or any later population. Every step of the Decision #42 successor sequence requires separate Owner authorization.

## 7. Source-data safety (standing constraints)

Synthetic or Owner-approved sanitized fixtures only until a production-source gate; no production customer/supplier/pricing/quantity/PII data in any committed artifact; no supplier cost data in evidence; no secrets or credentials; sensitive scan must be CLEAN for every committed package; the source CSV itself is never copied into evidence (only its hash).
