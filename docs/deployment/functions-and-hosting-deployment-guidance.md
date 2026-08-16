# Deployment guidance — Functions batching and Hosting environment identity

Two corrections recorded from the Wave 7 sandbox deployment. Both are lessons paid for in practice,
not theory.

Applies to any Firebase environment. **Production deployment remains separately authorized; nothing
here grants it.**

---

## A. Functions must be deployed in domain batches, not as one estate

**What went wrong.** A single `firebase deploy --only functions` covering the whole estate
transiently fails a *subset* of functions. The failure is not IAM or org policy — a retry of the same
full estate often succeeds — but each full retry redeploys everything, multiplying the window in
which a partially-updated estate is live and making it hard to tell which function actually failed.

**Rule: deploy 5–10 functions per batch, grouped by domain.** After a failed batch, retry **only that
batch**. Never re-run the whole estate to fix one function.

### Batches for the current estate

Function names are the deployed callable names (the `as` alias in `functions/src/index.ts`, which is
what `--only functions:<name>` matches). Verify against the file before deploying — this list is a
snapshot, and the file is the authority.

**1 — access / auth**
```
grantRole,revokeRole,assignApprovedRole,resolveEffectiveAccessCallable
```

**2 — sales: opportunity**
```
createOpportunity,transitionOpportunity,listOpportunityContext,createSalesOrderFromOpportunity
```

**3 — sales: order + fulfillment**
```
createSalesOrder,transitionSalesOrder,getSalesOrderContext,allocateSalesOrder,createServiceForSalesOrder
```

**4 — CRM**
```
createCrmActivity,getCrmActivities,resolveCoverageForContext,createCoverageAssignment,createSalesTerritory
```

**5 — finance**
```
issueInvoice,applyPayment,recordInvoiceAdjustment,recordRefund,listAccountInvoiceAr
```

**6 — service / work orders**
```
createWorkOrder,transitionWorkOrder,updateWorkOrderExecutionData,completeAssignedJob,getWorkOrderFieldContext,setWorkOrderPartsPlan
```

**7 — inventory: part master + catalog**
```
createPart,updatePart,changePartStatus,createManufacturer,updateManufacturer,changeManufacturerStatus,getManufacturerCatalog
```

**8 — inventory: supplier + serialized**
```
createSupplier,updateSupplier,activateSupplier,deactivateSupplier,createPartSupplierItem,updatePartSupplierItem,changePartSupplierItemStatus,setPreferredSupplier,getAvailableEquipment
```

**9 — receiving**
```
receiveInventoryStock,listReceivingLocationOptions
```

**10 — reporting / admin / analytics**
```
runReportDefinitionCallable,getInventoryAnalytics,detectInventoryEffects
```

### Procedure

```bash
# one batch at a time; record the result of each before starting the next
npx firebase deploy --only functions:grantRole,functions:revokeRole,... --project <projectId>
```

1. Record each batch: name, functions, result.
2. On failure, retry **that batch only**. If it fails twice, split it and record which function fails.
3. After the last batch, **verify the final inventory** — list deployed functions and confirm every
   expected name is present at the expected version. A batch that "succeeded" but deployed nothing is
   the failure mode this step exists to catch.

---

## B. Hosting must be deployed through the environment-aware path

**What went wrong.** A raw `npm run build` followed by a blind `firebase deploy --only hosting`
produced an artifact whose own `version.json` misidentified its environment, and shipped it to the
sandbox. Nothing production was touched, but the deployed surface was **lying about which environment
it was** — which defeats the entire point of the version manifest.

The cause: `npm run build:firebase` resolves its environment from `VITE_ENVIRONMENT_ID`, and when that
is unset the registry's `defaultEnvironmentId` applies — **which is production**.

**`scripts/deployHosting.mjs` already exists and already prevents this.** The correct invocation:

```bash
node scripts/deployHosting.mjs --environment platform-sandbox
```

It fails closed: `--environment` is required with no default; the id must exist and be provisioned;
the build runs with `VITE_ENVIRONMENT_ID` set from that same id so the artifact cannot disagree with
the target by construction; and **after** the build it re-reads `dist/version.json` and asserts its
`environmentId` and `role` against the resolved target, aborting *before* any deploy on a mismatch. A
production-role target additionally requires `--allow-production`.

**Do not use** `npm run build` followed by a bare `firebase deploy --only hosting`. Any runbook that
says otherwise is wrong and should be corrected — including one this program previously published.

### Verification after deploy

```bash
curl -s https://<host>/version.json
```

Confirm `commit` is the intended head **and** `environmentId` / `environmentRole` match the target.
Both must be checked: a correct commit with the wrong environment identity is exactly the failure
this guidance exists to prevent.
