# Operator Runbook — Phantom Sales Order Link Repair (X-PHANTOM-SALES-ORDER-LINK-REPAIR)

**Standard:** follows [`../governance/audit-artifact-standard.md`](../governance/audit-artifact-standard.md) and [`../governance/execution-environments.md`](../governance/execution-environments.md).
**Tooling:** `functions/scripts/phantomSalesOrderLinkRepairCli.js` (operator CLI) + `functions/src/repair/phantomSalesOrderLinkRepair.ts` (pure core) + `functions/src/repair/phantomSalesOrderLinkRepairEvidence.ts` (evidence builders).
**Pattern:** mirrors `functions/scripts/salesOrderNumberBackfillCli.js` — `--environment sandbox` required, project resolved from `config/environments.json`, environment refusal BEFORE Firebase initialization, dry-run default, plan artifact content-hash-pinned before `--execute` will bind to it, all-or-nothing Firestore transaction, evidence published atomically. This tool additionally supports `--rollback` (see Section G), since — unlike a number backfill — this repair is meant to be reversible.

> **This runbook authorizes nothing.** The tool described below is repository-complete and inert: importing it performs no Firestore read or write, and running `--execute` or `--rollback` against any real project is a **protected action** requiring separate, explicit Owner authorization naming the exact project and (for execute) the exact plan hash. The presence of a command template in this document never authorizes its execution. **As of this writing, nothing described in this runbook has been executed against any environment.**

---

## A. The situation

Five Work Orders — `wo-c713-1`, `wo-c713-2`, `wo-c713-3`, `wo-c713-4`, `wo-c713-5` — carry `salesOrderId: "so-harbor-c713"`. No Sales Order with that id exists among the live `sales_orders` records. `wo-c713-1`, `-2`, `-4`, `-5` are `COMPLETED` and each consumed `PRT-1002 qtyUsed=1`; `wo-c713-3` is `CANCELLED` with `qtyUsed 0`.

`transitionWorkOrder`'s Sales Order fulfillment write-back (`functions/src/transitionWorkOrder.ts`) gated on `if (soSnap.exists)` and, before the H19 fix (`fix(work-order): make missing-Sales-Order write-back skip observable`, merged), proceeded silently to `Complete` with **no audit record** when the linked Sales Order did not exist. The H19 fix makes that skip observable **going forward** (a `console.error` plus a durable Audit Event, `outcome: "uncertain"`), but it does not touch any already-completed record, and none of these five Work Orders will transition through `Complete` again (four are terminal `COMPLETED`, one is terminal `CANCELLED`) — so H19 alone leaves the historical silence for these five records exactly as it was.

**The defect is fixed going forward — this is closing out historical damage, not compensating for a live bug.** A second, separately-merged lane (the M9/H19 Work Order transition audit trail — see the `transitionWorkOrder` `AuditAction` in `functions/src/types/access.ts`) went further still: every applied `transitionWorkOrder` action, not only `Complete`'s Sales Order write-back skip, now stages its own durable Audit Event. Between that broader instrumentation and the H19 fix specifically, a new Work Order cannot silently reach `Complete` against a phantom `salesOrderId` without leaving a trace today. This matters to whoever authorizes execution: **this repair package does not need to run before the underlying defect is safe** — the defect is already closed. It exists solely to correct the historical record for five specific Work Orders that completed *before* that fix landed, per the Owner ruling below. There is no live-bug urgency driving the authorization decision; it can be scheduled whenever is convenient for an Owner review.

**Owner ruling:** repair, but preserve history. Correct the invalid Sales Order relationship, append an audit event, provide rollback, and produce an exact before/after manifest. **No write until separately authorized.**

## B. What this tool is NOT

It is not a general-purpose Work Order editor, not a Sales Order creation tool, and not a bulk data-repair tool. It does exactly one narrowly-scoped thing: for a **named phantom `salesOrderId`**, it finds every live Work Order carrying that exact value and tombstones the link (Section C) — nothing else about those Work Orders, and nothing about any other Work Order, is ever read as a write target.

## C. The judgement call — three options, one recommendation

`fulfillment/coordinatedVisitReadService.ts` groups Work Orders into one **coordinated visit** ("1 customer, 1 site, 1 install day, N units") purely by an **exact string match** on `salesOrderId` — see `coordinatedVisit.ts`'s own header comment and `functions/scripts/seedSandboxCoordinatedInstall.js`'s design note ("no Job / Visit / WorkOrderGroup authority... coordination has to be an OPERATING EXPERIENCE over the existing model"). `salesOrderId` is the *only* thing that ties these five Work Orders together as one visit in any surface today. Any repair that changes that value on some or all of the five, or changes it inconsistently, **breaks that grouping** for records that genuinely were one coordinated customer visit.

Three materially different repairs were considered:

| Option | Mechanism | Preserves coordinated-visit grouping? | Preserves history? | Consequence |
|---|---|---|---|---|
| **(A) Clear** | Delete `salesOrderId` from all five documents. | **No.** Each Work Order becomes a standalone record; `buildWorkOrderSalesOrderGroups` (`coordinatedVisitReadService.ts`) no longer sees any relationship between them — the "5 units, 1 visit" story is gone from every future read. | Partial — the fact that a link *existed* survives only in the Audit Event, not on the document itself. | Simplest, but destroys a real, useful signal for a real, useful reason (this was genuinely one coordinated install). Not recommended. |
| **(B) Tombstone (recommended)** | `salesOrderId` is left **byte-identical, untouched**. Four new fields are added: `salesOrderLinkStatus: "ORPHANED"`, `salesOrderLinkOrphanedReason` (why), `salesOrderLinkRepairPackageId` (traceability to this package), `salesOrderLinkRepairedAt` (server timestamp). | **Yes, completely** — the grouping key is never written, so `coordinatedVisitReadService.ts` groups these five exactly as it does today. | **Yes, fully** — nothing is deleted; the previously-silent invalidity becomes an explicit, durable, audited fact instead. | Minimal, additive, honest, and reversible (Section G). Does not fabricate anything. The only "cost" is that `salesOrderId` continues to point at a document that doesn't exist — but that is now a documented, intentional, audited state rather than an undocumented bug. |
| **(C) Point at a real Sales Order** | Either (c1) repoint `salesOrderId` at one of the 14 existing live Sales Orders, or (c2) fabricate a brand-new Sales Order document at `so-harbor-c713` (or elsewhere) reconstructed from the five Work Orders' `inventorySnapshot`. | Yes, if all five are repointed to the SAME id. | **No.** (c1) invents a false commercial relationship to an unrelated real order. (c2) invents a provenance (Opportunity → WON → Sales Order, `createServiceForSalesOrder`) that never actually happened — exactly the kind of history-rewrite "preserve history" rules out, even if clearly labeled "reconstructed". | Not recommended. Both variants manufacture a fact that isn't true; (c2) is the least bad of the two but still crosses a line (B) doesn't need to cross. |

**Recommendation: (B) Tombstone.** It is the only option that (1) leaves the coordinated-visit grouping completely undisturbed, (2) fabricates nothing, (3) is fully reversible with a precise precondition (Section G), and (4) turns a previously *silent* data-integrity problem into an *explicit, queryable, audited* one — which is the same principle the H19 fix already applied going forward. `functions/src/repair/phantomSalesOrderLinkRepair.ts`'s header comment carries this same writeup for anyone reading the code directly.

This is a judgement call, not a mechanically-forced answer — the CLI does not silently pick it either: dry-run's `plan-report.md` states the reason on every record, and `--phantom-sales-order-id` / `--reason` are explicit CLI arguments an operator must consciously supply (defaults exist for the documented `so-harbor-c713` case, but nothing is hidden).

## D. Preconditions (all runs, dry-run or protected)

1. Current repository checkout at the approved commit (`git rev-parse HEAD`, recorded as `--commit`).
2. `cd functions && npm ci && npm run build` — the CLI consumes the **compiled** `lib/` core, exactly like every other operator script in `functions/scripts/`.
3. Working tree free of uncommitted changes that could contaminate evidence.
4. Operator authenticated appropriately for the target environment; no credential is ever committed or pasted into evidence.
5. `--project` and an exactly matching `--confirm-project` are both required, validated before any Firebase initialization; `--environment sandbox` is required and is the only accepted value (production is hard-refused — see Section E's guard).
6. `--evidence-dir` outside the repository, a fresh non-existent directory each run — evidence is never overwritten.
7. For any protected step (`--execute` or `--rollback`): Gate below, in writing, first.

## E. Gate — protected execution (documented, NOT executed)

> **This tool being present and passing its offline tests does NOT authorize running it against any real project.** `--execute` and `--rollback` each require a written Owner Production Data Authorization naming the exact project id and (for `--execute`) the exact plan hash to be bound.

### Step 1 — dry-run (read-only; the default)

```
cd functions
npm run build
node scripts/phantomSalesOrderLinkRepairCli.js \
  --project eos-platform-sandbox \
  --confirm-project eos-platform-sandbox \
  --environment sandbox \
  --commit <git rev-parse HEAD> \
  --operator "<name/role>" \
  --evidence-dir <path-outside-repo>/phantom-so-repair-<YYYY-MM-DD>-dry-run
```

`--phantom-sales-order-id` defaults to `so-harbor-c713` and `--reason` defaults to the documented explanation in Section A; both are overridable.

**What this does:** reads every live Work Order whose `salesOrderId` exactly equals `so-harbor-c713` (a bounded `.where("salesOrderId", "==", ...)` query — never a full collection scan). Performs **zero writes**.

**Artifacts written** (published atomically):

| File | Content |
|---|---|
| `plan.json` | The COMPLETE, machine-readable manifest. Every planned change (`assignments[]`) names, per record: `workOrderId`, `salesOrderIdBefore` (== the phantom id), `statusBefore`, `inventorySnapshotBefore` (full array, verbatim), `fingerprint` (pre-state hash used to detect drift at execute), and `proposedChange` (`salesOrderId: "UNCHANGED"`, `salesOrderLinkStatus: "ORPHANED"`, the reason, and the repair-package id). Also lists `alreadyRepaired` (idempotent skip) and `counts`. |
| `plan-report.md` | Human-readable summary, the option analysis pointer (Section C), and the exact `--plan-sha256` value to bind at execute. |
| `checksums.sha256` / a clean secret scan | Same integrity guarantees as `salesOrderNumberBackfillCli.js` — a non-clean scan blocks publication entirely; no partial evidence directory is ever left behind. |

### Step 2 — Owner review (required, manual)

- Confirm every `workOrderId` in `assignments` is expected (should be exactly `wo-c713-1`, `-2`, `-3`, `-4`, `-5` for the documented run).
- Confirm `statusBefore` / `inventorySnapshotBefore` for each record match what is independently known about the situation.
- Confirm the recommendation in Section C (Tombstone) is still the intended repair; if a different repair is wanted, this tool does not perform it — it is scoped to Tombstone only, by design (Section C explains why the other two are not built into this tool).
- Record the plan hash from `plan-report.md` in the Owner authorization.

### Step 3 — execute (protected; requires the plan hash from Step 2)

```
cd functions
npm run build
node scripts/phantomSalesOrderLinkRepairCli.js \
  --project eos-platform-sandbox \
  --confirm-project eos-platform-sandbox \
  --environment sandbox \
  --commit <git rev-parse HEAD> \
  --operator "<name/role>" \
  --evidence-dir <path-outside-repo>/phantom-so-repair-<YYYY-MM-DD>-execute \
  --execute \
  --acknowledge-production-write \
  --plan <path-to-plan.json-from-Step-1> \
  --plan-sha256 <the-exact-hash-the-Owner-authorized>
```

**Safety sequence (all in ONE Firestore transaction — all-or-nothing):**

1. The CLI hashes the exact bytes of `--plan`; a mismatch with `--plan-sha256` refuses before any Firestore connection.
2. It re-parses the plan and confirms `projectId`/`governedCommit` match the invocation.
3. Inside the transaction: it re-confirms the phantom Sales Order **still** does not exist (`PHANTOM_RESOLVED` if it now does — the world changed since the plan was made; rerun with a fresh plan or a different repair, never blindly proceed).
4. Every planned Work Order is re-read and its pre-state fingerprint (over `salesOrderId` + `status` + `inventorySnapshot` + `salesOrderLinkStatus`) recomputed and compared (`STALE_PRESTATE` on any change — most commonly meaning it was already repaired by a prior partial run).
5. Only if every check passes does the transaction stage any write: the four Tombstone fields on each Work Order, PLUS one `repairPhantomSalesOrderLink` Audit Event per Work Order, in the SAME transaction.

**Evidence produced:** `execution-result.json` (every repaired `workOrderId` plus its `postRepairUpdateTimeMillis` — the exact optimistic-concurrency token Section G's rollback binds to) and `execution-report.md`.

## F. What is written, and what never is

| Field | Touched? |
|---|---|
| `salesOrderId` | **Never.** Read for matching only. |
| `status`, `inventorySnapshot`, `qtyUsed`, `completedAt`, any lifecycle field | **Never.** |
| `salesOrderLinkStatus` | Set to `"ORPHANED"`. |
| `salesOrderLinkOrphanedReason` | Set to the `--reason` text. |
| `salesOrderLinkRepairPackageId` | Set to the repair's `--commit` (traceability). |
| `salesOrderLinkRepairedAt` | Set to a server timestamp. |
| `auditEvents` collection | One new immutable document per repaired Work Order (`action: "repairPhantomSalesOrderLink"`). |
| `sales_orders` collection | **Never written.** `so-harbor-c713` is read (existence check) only. |

## G. Rollback

Rollback is a **separate protected mode**, `--rollback`, bound to a specific `execution-result.json` (not to a plan — there is no plan at rollback time, only the record of what execute actually did).

```
cd functions
npm run build
node scripts/phantomSalesOrderLinkRepairCli.js \
  --project eos-platform-sandbox \
  --confirm-project eos-platform-sandbox \
  --environment sandbox \
  --commit <git rev-parse HEAD> \
  --operator "<name/role>" \
  --evidence-dir <path-outside-repo>/phantom-so-repair-<YYYY-MM-DD>-rollback \
  --rollback \
  --acknowledge-production-write \
  --execution-result <path-to-execution-result.json-from-Step-3>
```

**Mechanism:** for every repaired Work Order, `execution-result.json` carries `postRepairUpdateTimeMillis` — the document's Firestore `updateTime` captured **immediately after** the repair's write committed. Rollback clears exactly the four fields the repair wrote (`functions/src/repair/phantomSalesOrderLinkRepair.ts`'s `REPAIR_FIELD_NAMES` — the single list both the repair and the rollback read from, so they can never drift apart) via ONE Firestore `WriteBatch`, with a **per-document `{ lastUpdateTime: postRepairUpdateTimeMillis }` precondition** on every `update()` call in the batch.

**Precondition semantics — refused, never clobbered:** a `WriteBatch.commit()` is atomic across every write it carries. If **any** document in the batch was touched by anything else since the repair (its live `updateTime` no longer matches the precondition), Firestore refuses the **entire batch** — nothing partially rolls back, and the fields that would have been cleared stay exactly as the repair left them. The CLI reports every entry as `skipped` with the refusal reason in `rollback-result.json`; the operator must then decide, record-by-record, whether the intervening change matters before trying again (this tool never overrides a precondition failure).

**Evidence produced:** `rollback-result.json` (`rolledBack[]`, `skipped[]` with reasons) and `rollback-report.md`, each bound (via `boundExecutionEvidenceSha256`) to the exact `execution-result.json` bytes the rollback was run against. Rollback also stages one `rollbackPhantomSalesOrderLinkRepair` Audit Event per rolled-back Work Order, in the same batch as the field clears.

## H. Known gaps / operational notes

- **Scope is the named phantom id, not "any dangling salesOrderId in the collection".** This tool never scans for other phantom references; each phantom id gets its own explicitly-scoped, explicitly-reasoned repair run. If other dangling `salesOrderId` values are later discovered, they get their own `--phantom-sales-order-id` invocation and their own Owner review — never silently swept in.
- **No emulator test included** — offline unit tests (`functions/test/phantomSalesOrderLinkRepair.test.mjs`) cover the pure core and the CLI's I/O boundary (dry-run, execute hash-binding, rollback batching) with fake stores; nothing in this PR touches an emulator.
- **Registration pending** (outside this PR's write scope): this script is not yet wired into `functions/package.json`'s `test:*` scripts, and no CI workflow currently exercises it — the same gap `sales-order-number-backfill-runbook.md` notes for its own tool.
- **This runbook and its tooling authorize nothing.** Nothing described here has been executed against `eos-platform-sandbox` or any other environment as of this writing (see the companion evidence document, `docs/audits/phantom-sales-order-repair/dry-run-evidence-package.md`).
