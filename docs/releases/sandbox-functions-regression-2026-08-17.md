# Sandbox Functions — stale-checkout regression and recovery (2026-08-17)

A Functions deployment ran from the WRONG commit and rolled part of the sandbox runtime backwards.
This records what happened, what is provably broken, and the exact recovery.

## What happened

| Field | Value |
|---|---|
| Intended promotion SHA | `cd442727103a983ec332fe880b7dcca1019773b5` |
| Operator checkout SHA | `70b314bfb626593248ff514f7e65179f8e6f7d04` |
| Relationship | `70b314bf` is an ANCESTOR of `cd442727` — **71 commits behind** |
| Result | 17 functions updated from the stale source; the rest failed |

The deploy guard passed and the build succeeded, because both are correct *for* `70b314bf` — neither
checks WHICH commit is being promoted. **This was a rollback, not a partial advance.**

## Runtime delta lost by the 17 updated functions

Five commits touched `functions/src` between the two SHAs:

| Commit | Change |
|---|---|
| #1088 `cd442727` | Sales Order allocation derives sellable stock from the governed ledger |
| #1086 `01d477fe` | WO reservation availability sees governed stock |
| #1072 `208cd867` | Transfer/Cycle Count per-environment activation |
| #1071 `2a6bf3fc` | inventoryCatalogAdministrator gains `inventory.catalog.read` |
| #1054 `c7850502` | six operational Roles made assignable |

Files: `fulfillment/allocateSalesOrder.ts`, `fulfillment/fulfillmentAvailability.ts`,
`inventoryService.ts`, `inventoryAnalyticsService.ts`, `types/inventoryTransaction.ts`,
`access/governedBusinessRoles.ts`, `access/trustedWriterCommands.ts`,
`inventoryTransfer/transferCallableWiring.ts`, `cycleCount/cycleCountCallableWiring.ts`.

## Proven live regressions

Not inferred from the diff — reproduced against the live environment.

**1. Sales Order allocation lost the governed-ledger authority (#1088).**
PRT-1001 holds 3 governed ledger units and has NO `stock_locations` row. Verified ALLOCATED/READY
earlier the same day; now:

```
allocateSalesOrder -> readiness "BLOCKED", counts { BACKORDERED: 1 }
```

Real stock is again unsellable — the exact defect #1088 corrected.

**2. Role catalog split-brain (#1071).** For the same principal, at the same moment:

```
resolveEffectiveAccessCallable  (not redeployed)      -> inventory.catalog.read: true
getManufacturerCatalog          (redeployed 70b314bf) -> 403 PERMISSION_DENIED
```

Two functions now disagree about the same Role because they carry different bundles. This is the
same class of divergence #1072 was written to eliminate.

## Live Functions state

All 82 are ACTIVE — no stuck, failed or updating state. Deployment timestamps cluster cleanly:

| Cluster | Count | Meaning |
|---|---|---|
| `2026-08-17T05` | **17** | the stale operator run — REGRESSED |
| `2026-08-17T00–01` | 9 | Transfer/Cycle Count/Receiving — retain #1072 |
| `2026-08-16T21–23` | 21 | earlier promotion work |
| `2026-08-16T04` | 35 | long-standing, predate all five commits above |

The 17 regressed: `allocateSalesOrder`, `createSalesOrder`, `createServiceForSalesOrder`,
`createWorkOrder`, `transitionWorkOrder`, `updateWorkOrderExecutionData`, `detectInventoryEffects`,
`getManufacturerCatalog`, `getLocationDisplay`, `listCoordinatedOperations`, `issueInvoice`,
`createOpportunity`, `transitionOpportunity`, `listOpportunitiesForAccount`,
`listSalesOrdersForAccount`, `deactivateTruckCallable`, `changeTruckHomeWarehouseCallable`.

Note the inversion: the functions whose updates FAILED are the safe ones. The updates that SUCCEEDED
are the damage.

## Classification

**C — materially mixed, corrective deployment required.** Not merely "metadata differs": two
user-visible behaviours are provably wrong, and two functions disagree about the same Role.

## Failure-cause classification for the aborted updates

Evidence supports **transient Google API failure and/or request throttling on bulk Cloud Functions v2
updates**, and rules out two candidates outright:

- NOT authentication/credentials — 17 updates succeeded on the same credential in the same run.
- NOT function-specific configuration — failures were broad, not clustered on particular functions.

Throttling/quota versus a transient API fault cannot be separated from the captured output alone; the
repeated `Failed to make request to cloudfunctions.googleapis.com/v2/...` after a burst of successes
is consistent with either. The practical mitigation is the same: deploy in small batches with pauses
rather than one 82-function request storm. This matches the previously recorded sandbox batch-deploy
flakiness.

## Recovery

Redeploy ALL functions from current `main`, which also completes the original promotion. Current
`main` (`92413e88`) differs from `cd442727` by documentation only — verified, no runtime delta — so
promoting `main` introduces nothing beyond the authorized package.

The recovery command derives function names from `functions/src/index.ts` itself, deploys in batches
of six with a pause between them, and hard-fails if the checkout is not the intended commit.

---

> **RESOLVED (2026-08-17):** both proven regressions are gone. `getManufacturerCatalog` answers 200 for
> `partsManager` again, and the allocation probe returns UNKNOWN for a Part with `stock_locations`
> stock but no governed ledger evidence — proving the ledger authority is restored. Evidence:
> [sandbox-functions-promotion-closeout-2026-08-17.md](./sandbox-functions-promotion-closeout-2026-08-17.md).
