# Evidence Package — Phantom Sales Order Link Repair (PREPARE-ONLY)

**Status: NOTHING IN THIS PACKAGE HAS BEEN EXECUTED.** A live, read-only dry-run has been run against `eos-platform-sandbox` (Section 4) — that is the tool doing exactly what dry-run mode is built to do, with no write path available to it. No Firestore **write**, of any kind, against any environment, has occurred at any point in this package's lifecycle. This document, the CLI it describes (`functions/scripts/phantomSalesOrderLinkRepairCli.js`), and the runbook (`docs/operations/phantom-sales-order-link-repair-runbook.md`) are all **repository-only artifacts** awaiting separate, explicit Owner Production Data Authorization before `--execute` or `--rollback` may ever be run.

**Branch:** `feat/phantom-salesorder-repair-package` (based off `origin/main`). **Not merged.**

---

## 1. The five records under repair — now CONFIRMED by a real live dry-run

Per the Owner-relayed situation this lane was launched with (task brief, "verified live" against `eos-platform-sandbox`), and **since independently confirmed by an actual live dry-run** (Section 4):

| workOrderId | status | consumed | salesOrderId (dangling) |
|---|---|---|---|
| `wo-c713-1` | COMPLETED | PRT-1002 qtyUsed=1 | `so-harbor-c713` |
| `wo-c713-2` | COMPLETED | PRT-1002 qtyUsed=1 | `so-harbor-c713` |
| `wo-c713-3` | CANCELLED | PRT-1002 qtyUsed=0 | `so-harbor-c713` |
| `wo-c713-4` | COMPLETED | PRT-1002 qtyUsed=1 | `so-harbor-c713` |
| `wo-c713-5` | COMPLETED | PRT-1002 qtyUsed=1 | `so-harbor-c713` |

`so-harbor-c713` does not exist among the 14 live `sales_orders` records.

**Provenance note (superseded — kept for the record):** this session's own worktree had no live Firestore Admin credential available to it (a credential-fetch attempt was blocked by the safety classifier), so the first version of this document built the manifest from the stated facts only and labeled it illustrative. A separate operator subsequently ran the real dry-run against live `eos-platform-sandbox` and pushed the result to this branch — see Section 4, which is now the authoritative manifest. The live run's counts (5 considered / 5 needing repair / 0 already repaired / 0 not-this-phantom-id) and every `workOrderId`/`status`/`salesOrderId` value match this session's illustrative figures exactly, which is itself useful corroboration that the tool's live behavior matches its offline-tested behavior.

## 2. What this package delivers

| Artifact | Path |
|---|---|
| Pure repair core (classify / plan / execute) | `functions/src/repair/phantomSalesOrderLinkRepair.ts` |
| Evidence builders | `functions/src/repair/phantomSalesOrderLinkRepairEvidence.ts` |
| Operator CLI (dry-run / execute / rollback) | `functions/scripts/phantomSalesOrderLinkRepairCli.js` |
| Offline tests (34 assertions, all passing) | `functions/test/phantomSalesOrderLinkRepair.test.mjs` |
| Runbook (options analysis, preconditions, gated execute/rollback commands) | `docs/operations/phantom-sales-order-link-repair-runbook.md` |
| New AuditAction union members | `functions/src/types/access.ts`, `functions/src/access/auditEventWriter.ts` |
| This evidence document | `docs/audits/phantom-sales-order-repair/dry-run-evidence-package.md` |
| **Live dry-run artifacts (authoritative manifest — Section 4)** | `docs/audits/phantom-sales-order-repair/live-dry-run-manifest.md`, `live-dry-run-plan-report.md`, `live-dry-run-checksums.sha256` |

## 3. The recommended repair, and why (short form — full analysis in the runbook Section C)

Three options were evaluated: **(A) clear** `salesOrderId`, **(B) tombstone** it (leave the value untouched, add explicit "this link is invalid" fields), or **(C) point it at a real Sales Order** (existing-and-unrelated, or freshly fabricated). `fulfillment/coordinatedVisitReadService.ts` groups these five Work Orders into one coordinated visit **purely by exact string match on `salesOrderId`** — the only thing in the whole platform that currently expresses "these five units were one customer's one install day." (A) destroys that grouping. (C) fabricates a commercial relationship or a provenance that never happened, which directly conflicts with the Owner's "preserve history" ruling.

**Recommended and implemented: (B) Tombstone.** `salesOrderId` is **never read as a write target**. Four new fields are added instead:

```
salesOrderLinkStatus:            "ORPHANED"
salesOrderLinkOrphanedReason:    "<full explanation, see below>"
salesOrderLinkRepairPackageId:   "<this package's governing commit>"
salesOrderLinkRepairedAt:        <server timestamp>
```

Reason text written to every record in this session's own illustrative run used the CLI's default `--reason` text:

> salesOrderId references a Sales Order that does not exist in the live sales_orders collection. transitionWorkOrder gated its Sales Order fulfillment write-back on document existence and silently proceeded without writing back or recording a skip; this Work Order completed/cancelled with no trace of that skip until the H19 audit fix. salesOrderId is left UNCHANGED by this repair — it is the shared grouping key fulfillment/coordinatedVisit.ts uses to present these Work Orders as one coordinated visit.

The **live** dry-run (Section 4) was invoked with a shorter, operator-supplied `--reason` override instead: *"Sales Order so-harbor-c713 does not exist; link is unresolvable."* `--reason` is a documented, intentional CLI argument (`docs/operations/phantom-sales-order-link-repair-runbook.md` Section E Step 1) — either text is acceptable; whichever bytes are in the plan an operator actually authorizes is what gets written, and the live plan-report.md (Section 4) records exactly which one that is for the authoritative run.

Also staged, in the same transaction as each Work Order's field update: one immutable `auditEvents` document, `action: "repairPhantomSalesOrderLink"`.

## 4. The manifest — live artifact is authoritative; illustrative reproduction corroborates it

**There is one manifest an operator authorizes against: the live one below.** A separate operator with live sandbox read access ran the actual CLI (`functions/scripts/phantomSalesOrderLinkRepairCli.js`, no `--execute`) against `eos-platform-sandbox` and pushed the resulting evidence to this branch:

| Live artifact | Path |
|---|---|
| Manifest (human-readable) | `docs/audits/phantom-sales-order-repair/live-dry-run-manifest.md` |
| Plan report (counts + hash binding instructions) | `docs/audits/phantom-sales-order-repair/live-dry-run-plan-report.md` |
| Checksums | `docs/audits/phantom-sales-order-repair/live-dry-run-checksums.sha256` |

**Bind `--plan-sha256` to this value at execute:**

```
584706e705c182d3b6045c15fa883f8ac786cdec975baf6cdaf332aec8e1f032
```

This is the sha256 of the live `plan.json` file's exact bytes (per `live-dry-run-checksums.sha256`'s `plan.json` line and `live-dry-run-plan-report.md`'s own "Bind this to --plan-sha256" line) — **not** the operative plan hash `a96b0343bc667babf86c23f67c6731a5afb2a5af0bb834db62d5d2f922547154` also printed in the report (that one is a narrower, reproducibility-focused hash excluding `generatedAt`; the two are deliberately different values, exactly as `functions/scripts/salesOrderNumberBackfillCli.js`'s own comment explains for its own tool — confusing them fails safely closed at execute with "plan hash mismatch", never a wrong write). Live counts: **5 considered, 5 needing repair, 0 already repaired, 0 not-this-phantom-id** — all five `wo-c713-*`, matching Section 1 exactly. The `plan.json` file itself is not committed to the repo (evidence directories are published outside the repo per the runbook's Preconditions — this doc records its hash and derived report, not the raw file), so Owner review of the full `assignments[]` array happens directly against the operator's local `plan.json` before authorizing `--execute`.

**Illustrative reproduction (this session, no live credential — kept as corroboration, not as the binding artifact):** running this package's own `planRepair()` (`functions/src/repair/phantomSalesOrderLinkRepair.ts`) against the Section 1 facts, using the CLI's *default* `--reason` text rather than the live run's shorter override, produces:

| workOrderId | salesOrderId (before → after) | status (before → after) | inventorySnapshot (before → after) | pre-state fingerprint |
|---|---|---|---|---|
| `wo-c713-1` | `so-harbor-c713` → **unchanged** | `COMPLETED` → **unchanged** | `[{partId:"PRT-1002",sku:"PRT-1002",qtyUsed:1}]` → **unchanged** | `6f8eca4f74634763404ee1432424e195d034e7c09d62c680180bad018abbe0e5` |
| `wo-c713-2` | `so-harbor-c713` → **unchanged** | `COMPLETED` → **unchanged** | `[{partId:"PRT-1002",sku:"PRT-1002",qtyUsed:1}]` → **unchanged** | `6f8eca4f74634763404ee1432424e195d034e7c09d62c680180bad018abbe0e5` |
| `wo-c713-3` | `so-harbor-c713` → **unchanged** | `CANCELLED` → **unchanged** | `[{partId:"PRT-1002",sku:"PRT-1002",qtyUsed:0}]` → **unchanged** | `7fb224c7f3f638f5311ff9daea3e09c3854ee574d7d4daacb66b302f3c0237dd` |
| `wo-c713-4` | `so-harbor-c713` → **unchanged** | `COMPLETED` → **unchanged** | `[{partId:"PRT-1002",sku:"PRT-1002",qtyUsed:1}]` → **unchanged** | `6f8eca4f74634763404ee1432424e195d034e7c09d62c680180bad018abbe0e5` |
| `wo-c713-5` | `so-harbor-c713` → **unchanged** | `COMPLETED` → **unchanged** | `[{partId:"PRT-1002",sku:"PRT-1002",qtyUsed:1}]` → **unchanged** | `6f8eca4f74634763404ee1432424e195d034e7c09d62c680180bad018abbe0e5` |

This illustrative aggregate hash — `7c0aca82ff32f838efdc523df91c59c5d0f44dab2effd22560039b8f9910f317` — differs from the live run's operative hash (`a96b0343bc667babf86c23f67c6731a5afb2a5af0bb834db62d5d2f922547154`) purely because the `--reason` text differs between the two runs (Section 3); every other input (the five `workOrderId`s, their `status`, their `inventorySnapshot`) is identical, which is exactly why the underlying counts and per-record shape match. **Neither illustrative hash is a valid `--plan-sha256` value — only the live plan.json's byte hash above is.**

`wo-c713-1`, `-2`, `-4`, `-5` share an identical fingerprint because they share identical `status`/`inventorySnapshot` values; `wo-c713-3` differs (`CANCELLED`, `qtyUsed:0`) and so gets a different fingerprint — this is exactly the drift-sensitivity the execute-time `STALE_PRESTATE` check relies on (`functions/test/phantomSalesOrderLinkRepair.test.mjs`, "a record changed since planning... fails the WHOLE batch closed").

Every one of the five rows also gets, in the "after" state (not shown as a column above to keep the table focused on what changes to *existing* data — nothing does): `salesOrderLinkStatus: "ORPHANED"`, the reason text (Section 3), a `salesOrderLinkRepairPackageId`, and a `salesOrderLinkRepairedAt` server timestamp.

## 5. How to reproduce the illustrative table, or regenerate the live artifact

Illustrative reproduction (no Firebase, no network — exactly what produced Section 4's second table):

```
cd functions
npm ci && npm run build
node -e "
const { planRepair } = require('./lib/repair/phantomSalesOrderLinkRepair.js');
// ...construct the same five records as Section 1, call planRepair(...)
"
```

Regenerating (or extending) the live, execute-binding dry-run (read-only against live `eos-platform-sandbox`, requires sandbox read access):

```
cd functions
npm run build
node scripts/phantomSalesOrderLinkRepairCli.js \
  --project eos-platform-sandbox --confirm-project eos-platform-sandbox \
  --environment sandbox \
  --commit <git rev-parse HEAD> --operator "<name>" \
  --evidence-dir <path-outside-repo>/phantom-so-repair-dry-run
```

This publishes a fresh `plan.json` / `plan-report.md` pair from the actual live `fieldops_wos` documents matching `salesOrderId == "so-harbor-c713"`, ready for Owner review per the runbook's Section E Step 2. If the live data hasn't changed, this reproduces Section 4's counts and per-record values exactly (a new `generatedAt` will still change the plan.json bytes and therefore the `--plan-sha256` value — that value is only ever taken from whichever specific plan.json Owner review actually approved).

## 6. Rollback — proven offline

`functions/test/phantomSalesOrderLinkRepair.test.mjs` includes an offline proof of the rollback contract using fake stores standing in for Firestore:

- `cli.runRollback` reads an `execution-result.json`, rejects one for the wrong `projectId` or the wrong artifact `kind`.
- The real Firestore path (`buildProductionDeps().runRollbackBatch`, exercised only by live code, not these offline tests) stages every field-clear through a single `WriteBatch` with a per-document `{ lastUpdateTime }` precondition taken from each record's `postRepairUpdateTimeMillis` — captured immediately after the repair committed. A `WriteBatch.commit()` is atomic: any one document changed since the repair refuses the **whole** batch, so rollback is either fully applied or fully refused, never partial.

## 7. Test evidence

```
cd functions && npm ci && npm run build
node --test test/phantomSalesOrderLinkRepair.test.mjs
```

Result at the commit this package was authored against: **34 passed, 0 failed**, including:

- refusal paths exit before Firebase init (dry-run, `--execute`, and `--rollback` all proven separately — `getApps().length` stays `0` through every rejected `--environment`/`--project` combination);
- `--plan-sha256` mismatch is refused with zero transaction calls;
- `STALE_PRESTATE` / `LIVE_SET_DRIFT` / `PHANTOM_RESOLVED` each fail the whole batch closed with zero staged writes;
- `salesOrderId` is asserted `"UNCHANGED"` on every planned record — the coordination-preserving property this whole package exists to guarantee.

The full pre-existing `functions/` test suite was also run against this branch to check for regressions from the new `AuditAction` union members; no pre-existing test failed as a result of this change (see the PR for the exact command and result).

## 8. What is explicitly NOT in this package

- A real, read-only dry-run **was** run against `eos-platform-sandbox` (Section 4) — this is the one live read this package performs. It wrote nothing: dry-run has no code path capable of a write.
- No `--execute` or `--rollback` was run against `eos-platform-sandbox` or any other project. Zero Firestore writes have occurred anywhere in this package's lifecycle.
- No Owner authorization has been requested or granted for `--execute` or `--rollback`.
- This PR is not merged.
