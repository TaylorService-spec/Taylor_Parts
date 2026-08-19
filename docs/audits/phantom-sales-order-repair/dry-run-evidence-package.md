# Evidence Package — Phantom Sales Order Link Repair (PREPARE-ONLY)

**Status: NOTHING IN THIS PACKAGE HAS BEEN EXECUTED.** No Firestore write, of any kind, against any environment, was performed while building this package. This document, the CLI it describes (`functions/scripts/phantomSalesOrderLinkRepairCli.js`), and the runbook (`docs/operations/phantom-sales-order-link-repair-runbook.md`) are all **repository-only artifacts** awaiting separate, explicit Owner Production Data Authorization before `--execute` or `--rollback` may ever be run.

**Branch:** `feat/phantom-salesorder-repair-package` (based off `origin/main`). **Not merged.**

---

## 1. The five records under repair

Per the Owner-relayed situation this lane was launched with (task brief, "verified live" against `eos-platform-sandbox`):

| workOrderId | status | consumed | salesOrderId (dangling) |
|---|---|---|---|
| `wo-c713-1` | COMPLETED | PRT-1002 qtyUsed=1 | `so-harbor-c713` |
| `wo-c713-2` | COMPLETED | PRT-1002 qtyUsed=1 | `so-harbor-c713` |
| `wo-c713-3` | CANCELLED | PRT-1002 qtyUsed=0 | `so-harbor-c713` |
| `wo-c713-4` | COMPLETED | PRT-1002 qtyUsed=1 | `so-harbor-c713` |
| `wo-c713-5` | COMPLETED | PRT-1002 qtyUsed=1 | `so-harbor-c713` |

`so-harbor-c713` does not exist among the 14 live `sales_orders` records.

**Provenance note (read this before trusting the manifest in Section 3):** this session did not re-query `eos-platform-sandbox` directly — the isolated worktree environment this package was built in has no live Firestore Admin credential available to it, and this task's own boundary is PREPARE-ONLY / read-only-at-most. The table above and the manifest below are built from the facts the launching task stated as independently verified. **Section 2, Step 1** (dry-run) is exactly the tool that re-confirms these facts against live data the moment an operator with sandbox read access runs it — that run has not happened yet either. Nothing below should be treated as a substitute for actually running Step 1.

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

## 3. The recommended repair, and why (short form — full analysis in the runbook Section C)

Three options were evaluated: **(A) clear** `salesOrderId`, **(B) tombstone** it (leave the value untouched, add explicit "this link is invalid" fields), or **(C) point it at a real Sales Order** (existing-and-unrelated, or freshly fabricated). `fulfillment/coordinatedVisitReadService.ts` groups these five Work Orders into one coordinated visit **purely by exact string match on `salesOrderId`** — the only thing in the whole platform that currently expresses "these five units were one customer's one install day." (A) destroys that grouping. (C) fabricates a commercial relationship or a provenance that never happened, which directly conflicts with the Owner's "preserve history" ruling.

**Recommended and implemented: (B) Tombstone.** `salesOrderId` is **never read as a write target**. Four new fields are added instead:

```
salesOrderLinkStatus:            "ORPHANED"
salesOrderLinkOrphanedReason:    "<full explanation, see below>"
salesOrderLinkRepairPackageId:   "<this package's governing commit>"
salesOrderLinkRepairedAt:        <server timestamp>
```

Reason text written to every record:

> salesOrderId references a Sales Order that does not exist in the live sales_orders collection. transitionWorkOrder gated its Sales Order fulfillment write-back on document existence and silently proceeded without writing back or recording a skip; this Work Order completed/cancelled with no trace of that skip until the H19 audit fix. salesOrderId is left UNCHANGED by this repair — it is the shared grouping key fulfillment/coordinatedVisit.ts uses to present these Work Orders as one coordinated visit.

Also staged, in the same transaction as each Work Order's field update: one immutable `auditEvents` document, `action: "repairPhantomSalesOrderLink"`.

## 4. Illustrative before/after manifest

The table below was produced by running this package's own `planRepair()` (`functions/src/repair/phantomSalesOrderLinkRepair.ts`) against the Section 1 facts — i.e. the fingerprints shown are the **actual, reproducible output of the shipped code**, not hand-computed or invented. They are **illustrative**, not an executable plan: no `--plan-sha256` in this document authorizes anything, because no real dry-run against live Firestore has produced a `plan.json` yet (Section 1's provenance note). Anyone can reproduce this exact output by running the command in Section 5.

| workOrderId | salesOrderId (before → after) | status (before → after) | inventorySnapshot (before → after) | pre-state fingerprint |
|---|---|---|---|---|
| `wo-c713-1` | `so-harbor-c713` → **unchanged** | `COMPLETED` → **unchanged** | `[{partId:"PRT-1002",sku:"PRT-1002",qtyUsed:1}]` → **unchanged** | `6f8eca4f74634763404ee1432424e195d034e7c09d62c680180bad018abbe0e5` |
| `wo-c713-2` | `so-harbor-c713` → **unchanged** | `COMPLETED` → **unchanged** | `[{partId:"PRT-1002",sku:"PRT-1002",qtyUsed:1}]` → **unchanged** | `6f8eca4f74634763404ee1432424e195d034e7c09d62c680180bad018abbe0e5` |
| `wo-c713-3` | `so-harbor-c713` → **unchanged** | `CANCELLED` → **unchanged** | `[{partId:"PRT-1002",sku:"PRT-1002",qtyUsed:0}]` → **unchanged** | `7fb224c7f3f638f5311ff9daea3e09c3854ee574d7d4daacb66b302f3c0237dd` |
| `wo-c713-4` | `so-harbor-c713` → **unchanged** | `COMPLETED` → **unchanged** | `[{partId:"PRT-1002",sku:"PRT-1002",qtyUsed:1}]` → **unchanged** | `6f8eca4f74634763404ee1432424e195d034e7c09d62c680180bad018abbe0e5` |
| `wo-c713-5` | `so-harbor-c713` → **unchanged** | `COMPLETED` → **unchanged** | `[{partId:"PRT-1002",sku:"PRT-1002",qtyUsed:1}]` → **unchanged** | `6f8eca4f74634763404ee1432424e195d034e7c09d62c680180bad018abbe0e5` |

Every one of the five rows also gets, in the "after" state (not shown as a column above to keep the table focused on what changes to *existing* data — nothing does): `salesOrderLinkStatus: "ORPHANED"`, the reason text from Section 3, a `salesOrderLinkRepairPackageId`, and a `salesOrderLinkRepairedAt` server timestamp.

`wo-c713-1`, `-2`, `-4`, `-5` share an identical fingerprint because they share identical `status`/`inventorySnapshot` values under the current facts; `wo-c713-3` differs (`CANCELLED`, `qtyUsed:0`) and so gets a different fingerprint — this is exactly the drift-sensitivity the execute-time `STALE_PRESTATE` check relies on (`functions/test/phantomSalesOrderLinkRepair.test.mjs`, "a record changed since planning... fails the WHOLE batch closed").

**Aggregate plan hash for this illustrative input:** `7c0aca82ff32f838efdc523df91c59c5d0f44dab2effd22560039b8f9910f317` (this is the *operative* content hash carried inside `plan.json` — NOT the `--plan-sha256` binding value, which is the sha256 of the published `plan.json` file's exact bytes; see the runbook and `functions/scripts/salesOrderNumberBackfillCli.js`'s own comment on why these two are deliberately different values).

## 5. How to reproduce Section 4, or generate the real thing

Illustrative reproduction (no Firebase, no network — exactly what produced Section 4):

```
cd functions
npm ci && npm run build
node -e "
const { planRepair } = require('./lib/repair/phantomSalesOrderLinkRepair.js');
// ...construct the same five records as Section 1, call planRepair(...)
"
```

The **real, execute-binding** dry-run (read-only against live `eos-platform-sandbox`, requires sandbox read access this session did not have):

```
cd functions
npm run build
node scripts/phantomSalesOrderLinkRepairCli.js \
  --project eos-platform-sandbox --confirm-project eos-platform-sandbox \
  --environment sandbox \
  --commit <git rev-parse HEAD> --operator "<name>" \
  --evidence-dir <path-outside-repo>/phantom-so-repair-dry-run
```

This publishes a real `plan.json` / `plan-report.md` pair from the actual live `fieldops_wos` documents matching `salesOrderId == "so-harbor-c713"` — the authoritative version of Section 4, ready for Owner review per the runbook's Section E Step 2.

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

- No `--execute` or `--rollback` was run against `eos-platform-sandbox` or any other project.
- No `plan.json` was generated from live data (Section 4 is illustrative only — see its provenance note).
- No Owner authorization has been requested or granted for execute.
- This PR is not merged.
