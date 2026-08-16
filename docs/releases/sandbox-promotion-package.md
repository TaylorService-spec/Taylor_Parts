# Consolidated sandbox promotion package

**Status: DERIVED AND PRE-VALIDATED IN REPO. NOT DEPLOYED.**
The build session's tool policy denies `firebase deploy` (re-tested this session, third occurrence).
Every repo-side prerequisite and verification below has been completed and is evidenced; the
deployment itself must be executed by the operator.

## Pinned truth

| | |
| --- | --- |
| Target commit (`origin/main`) | `7b3d8206` |
| Live sandbox before promotion | `b09f3a13` · `environmentId: platform-sandbox` · `environmentRole: sandbox` (read from `/version.json`) |
| Delta | 18+ commits, 234+ files |

## A. Firestore Rules — APPROVED, pre-validated

Diff from the live baseline is **exactly one additive block**, nothing else:

```
match /cycle_counts/{cycleCountId} { allow read, write: if false; }
```

- **+10 lines, 0 removals.** No existing rule weakened; a brand-new collection gets an explicit deny.
- Root and `field-ops-app-vite/firestore.rules` verified **byte-identical**.
- **Rules regression: 720 passed / 0 failed across 19 suites** (emulator).

```bash
npx firebase deploy --only firestore:rules --project eos-platform-sandbox
```

Verify afterwards with the repo's own mechanism — never from the command's exit status.

## B. Firestore indexes — 1 new

`serialized_assets(partId ASC, currentLocationId ASC, inventoryState ASC)` — required by Cycle Count's
SERIAL enumeration. Declared count moves 7 → 8. It is listed in `PENDING_DEPLOY_INDEX_KEYS` in
`scripts/indexDriftGuard.test.mjs`; **remove that key only after the deploy actually succeeds.**

```bash
npx firebase deploy --only firestore:indexes --project eos-platform-sandbox
```

## C. Functions — 12 new callables, none removed

Derived from `functions/src/index.ts` at both commits (82 exports on main vs 70 live). Deploy in
**small domain batches**; retry only a failed batch.

**Batch 1 — CRM / commercial reads**
```
listOpportunitiesForAccount,listSalesOrdersForAccount
```
**Batch 2 — coordinated ops + equipment reads**
```
listCoordinatedOperations,getLocationDisplay
```
**Batch 3 — inventory transfers**
```
createTransferOrder,dispatchTransferOrder,receiveTransferOrder,cancelTransferOrder
```
**Batch 4 — cycle counts**
```
createCycleCount,submitCycleCount,reconcileCycleCount,cancelCycleCount
```

Runtime is **Node 22** (`functions/package.json` `engines.node`). It takes effect on this deploy —
verify the reported runtime in the function inventory afterwards and flag anything still on Node 20.

## D. Hosting — environment-aware path only

```bash
node scripts/deployHosting.mjs --environment platform-sandbox
```

**Pre-validated:** building with `VITE_ENVIRONMENT_ID=platform-sandbox` produces
`{ commit: 7b3d8206, environmentId: platform-sandbox, environmentRole: sandbox }`. Never use a bare
`npm run build` + blind hosting deploy — that is what previously shipped a production-identified
artifact.

## E. Capability activation — DONE IN REPO

Activated for `platform-sandbox` only, shipping with the Hosting build:
`fulfillment.coordinatedVisit.read`, `inventory.serializedAsset.read`,
`inventory.location.display.read`, `inventory.transfer.*` (4), `inventory.cycleCount.*` (4).
Sandbox override set moves 16 → 27. Production carries no override key (asserted).

## F. Role assignments — the remaining human step

**Correction to an earlier claim in this program:** the `roleAssignments` bootstrap is **not**
circular. `functions/scripts/operatorAccessCommand.js` uses the Admin SDK directly via Application
Default Credentials — it does not depend on a deployed callable, which is precisely why it exists.

It requires, per invocation: `--projectId eos-platform-sandbox`, `--command grantRole`,
`--principalUid <persona uid>`, `--roleId <role>`, a caller-supplied `--idempotencyKey`, and
`--ownerAuthorization "I CONFIRM OWNER AUTHORIZATION FOR THIS ACCESS CHANGE"` (a deliberate
human-confirmation gate, not a secret). Roles available: `inventoryCatalogAdministrator`,
`workOrderPartsPlanner`, `crmActivityContributor`. Grants bump `accessVersion` and sync claims;
revoke by setting the assignment inactive.

**Not run here.** Grants before the Functions/Hosting deltas ship would leave the environment
half-configured and unverifiable.

## G. Seed data

Not yet assessed against the live environment — requires reading sandbox data, which is downstream of
the deployment.

## Ordering

Rules → indexes → Functions (batched) → Hosting → grants → E2E. The index must precede or accompany
Hosting.
