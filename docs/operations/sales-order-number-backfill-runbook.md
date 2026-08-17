# Operator Runbook — Sales Order Number Backfill (X-SALES-ORDER-NUMBER-BACKFILL)

**Standard:** follows [`../governance/audit-artifact-standard.md`](../governance/audit-artifact-standard.md) and [`../governance/execution-environments.md`](../governance/execution-environments.md).
**Tooling:** `functions/scripts/salesOrderNumberBackfillCli.js` (operator CLI) + `functions/src/salesOrder/salesOrderNumberBackfill.ts` (pure core) + `functions/src/salesOrder/salesOrderNumberBackfillEvidence.ts` (evidence builders).
**Reuses (never reimplements):** `formatSalesOrderNumber` from `functions/src/salesOrder/salesOrderNumbering.ts` — the SAME format authority new Sales Orders use at creation. This tool has no second numbering scheme.

> **This runbook authorizes nothing.** The tool described below is repository-complete and inert: importing it performs no Firestore read or write, and running `--execute` against any real project is a **protected action** requiring separate, explicit Owner authorization naming the exact project and plan. The presence of a command template in this document never authorizes its execution.

---

## A. Purpose and scope

Sales Orders created **before** governed numbering existed (`functions/src/salesOrder/salesOrderCallables.ts`, which allocates `salesOrderNumber` transactionally at creation via `allocateSalesOrderNumber`) have no `salesOrderNumber` field. This tool assigns one to every such record, once, without disturbing anything else about the record.

**What this tool is NOT:** it is not a data-repair tool for corrupt Sales Orders, not a renumbering tool (a record with any existing `salesOrderNumber` — even one that looks wrong — is never touched), and not a bulk-edit tool. It does exactly one thing: add a `salesOrderNumber` to a record that has none.

## B. Required properties (each pinned by a test in `functions/test/salesOrderNumberBackfill.test.mjs`)

| Property | How it holds |
|---|---|
| Deterministic | `planBackfill` sorts every unnumbered record by a fixed key `(year, createdAt millis when known, salesOrderId)` before assigning sequence numbers. The same live state always produces the same plan. |
| Idempotent | A record with ANY non-blank `salesOrderNumber` is classified `ALREADY_NUMBERED` and excluded from every plan, forever. Because a fresh plan is generated from live state on every invocation, a rerun after a partial execute naturally completes only what's left. |
| Dry-run capable, dry-run is the DEFAULT | The CLI has no way to write without `--execute` **and** `--acknowledge-production-write` **and** a `--plan`/`--plan-sha256` pin. Omitting a flag cannot produce a write. |
| Collision detecting | Every candidate number is checked against every existing `salesOrderNumber` value read at plan time. A collision is recorded, excluded from assignments, and its presence in a plan makes `--execute` refuse the ENTIRE batch (zero writes) until resolved. |
| Reports affected record count | Every plan and execution result carries `counts`: `total`, `alreadyNumbered` (skips), `toAssign`/`assigned` (creates), `collisions` + `blocked` (failures). `updates` is always `0` and is invariant — this tool never changes an existing number. |
| Preserves recordId | The Firestore document id is never read as an assignment target and never written; only the `salesOrderNumber` field is set on the existing document. No relationship field (`accountId`, `sourceOpportunityId`, fulfillment/invoice links, etc.) is read or touched. |
| Emits auditable migration evidence | `plan.json` / `plan-report.md` (dry-run) and `execution-result.json` / `execution-report.md` (execute), each with a `checksums.sha256` and a clean `sensitive-scan.txt`, published atomically (a run directory only ever appears complete — never partially written). |
| Safe under rerun | `executeBackfill` re-reads live state and the touched counters immediately before writing and fails the WHOLE batch closed on ANY drift (a record already numbered, a counter that moved, a record that vanished) — see Section E. |

## C. Year assignment policy (stated here AND in the code comment at the top of `salesOrderNumberBackfill.ts`)

- When a record's stored `createdAt` is a genuine Firestore `Timestamp`, it is **authoritative**: the year portion of the assigned number is that Timestamp's UTC calendar year. This is the one case where the assigned number's year has real chronological meaning.
- When `createdAt` is missing, `null`, or not a Timestamp, **historical ordering cannot be established from the stored record**. This tool does **not** invent a chronology it has no evidence for. Those records are assigned the sentinel year **`0`** (rendered `SO-0000-######`) — a value that can never collide with a real calendar year and is never presented as meaning "created in year 0". Within that sentinel bucket, records are ordered by Firestore document id only — a stable, fully deterministic tiebreak, **not** a claim about creation order.
- Operators and any downstream reporting should treat `SO-0000-######` numbers as an explicit "historical creation time unknown, recovery-assigned" marker, not as a real year.

## D. Preconditions (all runs, emulator or production)

1. Current repository checkout at the approved commit (record `git rev-parse HEAD` in the run notes).
2. `cd functions && npm ci && npm run build` — the CLI consumes the **compiled** `lib/` core, exactly like every other operator script in `functions/scripts/`.
3. Working tree free of uncommitted changes that could contaminate evidence (`git status` clean, or unrelated changes documented in the run notes).
4. Operator authenticated appropriately for the target environment (production runs happen in the authenticated operator environment per `execution-environments.md` — never from an unauthenticated session; no credential is ever committed or pasted into evidence).
5. Active project verified: the CLI has **no default project**; `--project` and an exactly matching `--confirm-project` are both required, validated before any Firebase initialization.
6. `--evidence-dir` outside the repository (e.g. an OS temp path); a fresh, non-existent directory each run — evidence is never overwritten.
7. **No concurrent Sales Order creation during a batch's dry-run → execute window** (a maintenance window, or at minimum operator-serialized execution). This is not merely a suggestion: the counter-drift check in Section E will correctly *refuse* to write if the counter moved, but a refused execute means the operator must regenerate the plan and try again — plan for a quiet window to avoid repeated refusals on a large backfill.
8. For any production step: Gate below, in writing, first.

## E. Gate — production execution (documented, NOT executed)

> **This tool being present and passing its offline tests does NOT authorize running it against any real project.** Execution requires a written Owner Production Data Authorization naming the exact project id and (for `--execute`) the exact plan hash to be bound.

### Step 1 — dry-run (read-only; the default; may be run freely once project-read access is authorized)

```
cd functions
npm run build
node scripts/salesOrderNumberBackfillCli.js \
  --project <project-id> \
  --confirm-project <project-id> \
  --commit <git rev-parse HEAD> \
  --operator "<name/role>" \
  --evidence-dir <path-outside-repo>/sales-order-number-backfill-<YYYY-MM-DD>-dry-run
```

**What this does:** reads the entire `sales_orders` collection and every counter document a currently-unnumbered record's year would touch. Performs **zero writes** — dry-run has no code path that can write; there is no flag that turns it into one.

**Expected output** (stdout, and mirrored in `plan-report.md`):

```
{
  "ok": true,
  "mode": "dry-run",
  "evidenceDir": "<path>/sales-order-number-backfill-<date>-dry-run"
}
```

**Artifacts written** (published atomically — the directory only ever appears once complete):

| File | Content |
|---|---|
| `plan.json` | The COMPLETE, machine-readable plan — every planned assignment (`salesOrderId`, `year`, `yearPolicy`, `sequence`, `salesOrderNumber`), every collision, every blocked record, the counter snapshot the plan is pinned to, and `counts`. This file IS the execute-binding input (Section F). |
| `plan-report.md` | Human-readable summary table (total / already-numbered / to-assign / collisions / blocked) and an explicit "NOT executable as-is" flag when collisions or blocked records exist. |
| `checksums.sha256` | SHA-256 of every artifact above. |
| `sensitive-scan.txt` | Must read `CLEAN`. A non-clean scan blocks publication entirely (no partial evidence directory is ever left behind). |

### Step 2 — Owner review (required, manual)

Before authorizing execute, the Owner reviews `plan-report.md` and `plan.json`:

- `counts.collisions` and `counts.blocked` **must both be zero**. If either is non-zero, `--execute` will refuse the whole batch — do not attempt it; investigate the collision (an existing `salesOrderNumber` value already occupies the slot the tool would assign — this indicates prior out-of-band data entry that needs its own resolution) and rerun dry-run for a fresh plan afterward.
- Spot-check a sample of `assignments` — especially any with `yearPolicy: "UNKNOWN_SENTINEL"` — to confirm the operator understands which records are getting a real historical year vs. the `SO-0000-######` marker.
- Record the plan hash from `plan-report.md` ("Plan hash (bind this to --plan-sha256 at execute)") in the Owner authorization.

### Step 3 — execute (protected; requires the plan hash from Step 2)

```
cd functions
npm run build
node scripts/salesOrderNumberBackfillCli.js \
  --project <project-id> \
  --confirm-project <project-id> \
  --commit <git rev-parse HEAD> \
  --operator "<name/role>" \
  --evidence-dir <path-outside-repo>/sales-order-number-backfill-<YYYY-MM-DD>-execute \
  --execute \
  --acknowledge-production-write \
  --plan <path-to-plan.json-from-Step-1> \
  --plan-sha256 <the-exact-hash-the-Owner-authorized>
```

**Safety sequence (all pre-checks run BEFORE any write is staged; the whole batch commits in ONE Firestore transaction — all-or-nothing):**

1. The CLI hashes the **exact bytes** of `--plan`; if that doesn't match `--plan-sha256`, it refuses (no writes, no Firestore connection needed to fail this check).
2. It re-parses the plan and confirms its `projectId`/`governedCommit` match the invocation's `--project`/`--commit`.
3. If the plan itself contains any collision or blocked entry, execute refuses outright — a plan is only ever executable when Step 2 confirmed zero of both.
4. Inside the transaction: every touched year's counter is re-read and compared to the value the plan was generated against (`COUNTER_DRIFT` if it moved — e.g. a real Sales Order was created in that year since the dry-run, or a separate backfill run touched it).
5. Every planned record is re-read and its pre-state fingerprint (over `salesOrderNumber` + `createdAt` only) is recomputed and compared (`STALE_PRESTATE` if it changed — most commonly because it was already numbered by an earlier partial run).
6. Only if EVERY check in steps 4–5 passes does the transaction stage any write. `salesOrderNumber` is written exactly as planned; nothing else on the document is touched except `updatedAt`.

**Collisions and failures surface as:** a thrown `SalesOrderBackfillError` with a specific `code` (`COLLISION_DETECTED`, `COUNTER_DRIFT`, `STALE_PRESTATE`, `LIVE_SET_DRIFT`, `PLAN_MISMATCH`, `INVALID_INPUT`) and a human-readable message; the CLI prints `SALES ORDER NUMBER BACKFILL CLI FAILURE: <message>` and exits `2`. **No evidence directory is published on failure** — a partial run leaves no artifact suggesting it succeeded.

**Evidence produced on success:**

| File | Content |
|---|---|
| `execution-result.json` | `assigned` (every `{salesOrderId, salesOrderNumber}` pair actually written) and `counts` (`assigned`, `skippedAlreadyNumbered`). |
| `execution-report.md` | Human-readable summary, including the bound plan hash for cross-reference. |
| `checksums.sha256` / `sensitive-scan.txt` | Same integrity/scan requirements as the dry-run artifacts. |

### Step 4 — rerun for the remainder (if the batch was large or partially blocked)

If the live `sales_orders` collection is large enough that the operator chooses to run the backfill in multiple batches, or a batch was refused (Section E, step 4/5), simply **repeat from Step 1**. `planBackfill` always reads live state fresh: every record already assigned a number in a prior successful execute is classified `ALREADY_NUMBERED` and skipped, so the new plan contains only the genuine remainder. No manual bookkeeping of "what was already done" is required or supported — the tool itself is the source of truth for what's left.

## F. Known gaps / operational notes (state honestly, not glossed over)

- **Batch size:** a single execute stages the whole plan inside one Firestore transaction. Firestore's per-transaction write limit (500) bounds how many records one execute call can assign; for a very large legacy backlog, split by requesting dry-run over a scoped subset in a future revision, or run Step 1–3 repeatedly with the natural post-execute reduction described in Step 4. This tool does not implement automatic chunking.
- **Concurrent writers:** the counter-drift and stale-prestate checks make concurrent activity fail *safely* (zero writes), never *incorrectly* (never a silent double-assignment) — but a busy production window will simply cause repeated refusals rather than progress. Prefer a quiet window (Precondition 7).
- **`SO-0000-######` is a permanent marker**, not a placeholder to be "fixed later" — there is no evidence in the stored record to ever upgrade it to a real year. Any future reporting or UI surface that displays Sales Order numbers should be prepared to render this range and should not assume the year portion of every number is a real calendar year.
- **No emulator test included** — offline unit tests (`functions/test/salesOrderNumberBackfill.test.mjs`) cover the pure core and the CLI's I/O boundary with fake stores; nothing in this PR touches an emulator. If an emulator-backed integration test is later wanted (mirroring `functions/test/warehouseGovernanceMigrationEmulator.test.mjs`), it is not in scope here.
- **Registration pending** (outside this PR's write scope; see the PR handoff): this script is not yet wired into `functions/package.json`'s `test:*` scripts, and no CI workflow currently exercises it. Both are follow-up, separately-scoped changes.
