# W1-C19 — Work Order: required registrations

Lane C19 (Work Order object, lifecycle/transition authority, execution data, assignment).
Branch `impl/w1-workorder-authority`.

## Registrations this PR needs: NONE

This change touches no shared file. Specifically it adds:

* no migration (see "Migration" below),
* no new Cloud Function / callable (the changed callable `listWorkOrderConsumptionSources` is
  already exported at `functions/src/index.ts:14`),
* no new Firestore collection, and no change to `firestore.rules`,
* no new capability or permission (no entry needed in `functions/src/access/permissionCatalog.ts`),
* no new entity-registry field (so `field-ops-app-vite/test/entityRegistry.test.mjs`'s field census
  number is unchanged),
* no new test suite registration — `functions/test/*.test.mjs` is picked up by the existing
  functions test invocation, not by `field-ops-app-vite/test/suites.json`.

### Migration: none needed

`functions/migrations/` is unchanged. The Work Order has no Postgres representation at all today
(see the census below), so there was nothing to migrate and no new `eos_ops` table to add. The
reserved id `1759536000000` was NOT used and remains free.

Because no migration was added, none of the shared migration-order / unwind-depth / closed-table-list
test hazards apply to this branch.

## Admin→Objects

No `objectAdministrationProfile` was written. C2's framework (PR #1866) is not on main, and a profile
would be dormant until it merges while failing C2's coverage test if the registry does not list it.

When #1866 merges, the Work Order profile registry line that will be needed is:

```js
  workOrder: () => import("./profiles/workOrderAdministrationProfile.js"),
```

…registered against entity key `workOrder`, whose canonical collection is `fieldops_wos`
(`functions/src/constants/collections.ts:6`) and whose reference field is `woNumber`
(`field-ops-app-vite/src/metadata/definitions/workOrder.js:49`). The profile itself is NOT written
here — writing it now would be speculative architecture against an unmerged framework.

## Findings other lanes / future passes must register (NOT done here)

These are census results, recorded so they are not lost. None is actioned by this PR.

1. **The Work Order carries no `operatingCompanyId`.** `functions/src/ownership/ownershipMatrix.ts:228`
   declares `fieldops_wos` COMPANY-owned with `ownerFields: ["operatingCompanyId"]`, but
   `functions/src/createWorkOrder.ts:81-99` — the only create payload — never writes one, and
   `functions/src/ownership/ownershipBackfillRules.ts:194-245` has no `fieldops_wos` rule. Registering
   a backfill rule requires a governed derivation source first; the only latent one is
   `wo.salesOrderId → sales_orders.operatingCompanyId`, which covers 11 of 30 sandbox Work Orders
   (`functions/src/ownership/ownershipMatrix.ts:234`). It must not be inferred.

2. **`ownershipMatrix.ts` family labels are inverted.** `:205` names the family `workOrder` but points
   at the LEGACY `fieldops_jobs`; `:228` names the family `workOrderLegacy` but points at the
   CANONICAL `fieldops_wos`. Renaming is a shared-registry change, not this lane's.

3. **WO lifecycle capabilities exist in the SQL vocabulary but nothing resolves them.**
   `functions/migrations/1757894400000_operational-capability-vocabulary.sql:94-104` registers
   `workOrder.lifecycle.dispatch` / `.cancel` / `.complete` and
   `inventory.workOrderConsumption.record`, while the commands still enforce hardcoded role strings
   (`functions/src/transitionEngine.ts:128-143`, `functions/src/updateWorkOrderExecutionData.ts:128`).
   That same SQL file already records the gap at `:43-48`. Closing it is a permission-catalog change.
