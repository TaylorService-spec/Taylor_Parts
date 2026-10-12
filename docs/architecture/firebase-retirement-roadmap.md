# Remaining Firebase Retirement Roadmap

State at main `acc65f2e`, 2026-10-11:

- **82** Firebase Functions exports;
- an exit baseline of **275** entries (216 files);
- the Business Capability Equivalence Gate, specified in
  [firebase-capability-equivalence-gate.md](firebase-capability-equivalence-gate.md).

From now on, a cluster retires only when every operation in it is retirement-complete under that gate.
The rule is: **do not remove functionality to meet a dependency-count target.**

## 1. What remains

### Baseline (`firebase-exit-baseline.json`)

| Side | Category | Entries |
|---|---|---|
| Frontend | firestore_client | 19 |
| Frontend | firebase_functions_client | 22 |
| Frontend | firebase_auth (identity) | 2 |
| Server | firebase_admin_firestore | 166 |
| Server | firebase_functions_server | 61 |
| Server | firebase_auth (identity) | 3 |
| Server | firebase_admin_app (identity) | 2 |

The largest server Firestore groups are:

| Group | Files |
|---|---|
| top-level `functions/src` | 11 |
| access | 10 |
| cycleCount | 10 |
| partMaster | 10 |
| inventoryLocation | 9 |
| inventoryReceiving | 9 |
| equipmentCompatibility | 8 |
| finance | 8 |
| inventoryTransfer | 8 |

### Exports by domain

"Live" means a browser module still calls the export through `httpsCallable`.

| Domain | Exports | Live Firebase caller | EOS replacement | Blocking gap |
|---|---|---|---|---|
| Work Order core | createWorkOrder, transitionWorkOrder, setWorkOrderPartsPlan | none | `/operations/work-orders` | `transitionWorkOrder` is used by the held Scheduling gate; `createWorkOrderRecord` is imported by `createServiceForSalesOrder` |
| WO field context | getWorkOrderFieldContext | none | `readWorkOrderFieldContext` | **Gate B evidence only** (see §2) |
| WO readiness / AI | getWorkOrderReadinessContext, interpretWorkOrderReadinessContext | none | readiness partial; **AI none** | Stock-balance dimension UNAVAILABLE; AI capability needs a ruling; sandbox exclusion-list coupling |
| Legacy job completion | completeAssignedJob | orphan module | none | Needs a ruling that legacy `fieldops_jobs` is retired |
| Inventory analytics/effects | detectInventoryEffects, getInventoryAnalytics | none | analytics partial (different capability) | Authority differs; effects has no EOS counterpart |
| Account | getAccountPortfolioSummary | none (UNAVAILABLE) | **none** | An existing business gap. Build it; don't retire into it. |
| Scheduling | 7 | none | yes | HELD on `schedulingFunctionalGate.mjs` |
| Part master reads | searchProductReferences, getManufacturerCatalog | catalog **live** | search: EOS commercial | Manufacturer catalog client not cut over |
| Manufacturer writes | 3 | **live** | `manufacturerAuthority.ts` | Client not cut over |
| Commercial | listCoordinatedOperations, allocateSalesOrder, createServiceForSalesOrder | none | coordinated ops yes | The allocate/service boundary writes nothing |
| Finance | 6 | reads **live** | settlements/obligations only | No EOS refund or adjustment operation |
| Coverage | 3 | none | **none** | No EOS territory/coverage authority |
| Access | 13 | several **live** | role assignment in PostgreSQL | Live callers; no request-side UI |
| Reporting | 7 | **live** | none | Saved definitions HELD |
| Receiving, returns, bins, balance | 16 | **live** scanner set | partial | Scanner workflow retirement excluded |
| CRM activity | 2 | **live** | none | |
| Performance | 6 | reads **live** | none | No goal-creation UI |
| Data import | 4 | **live** | none | |

## 2. The next candidate: F5, `getWorkOrderFieldContext`

This is the smallest cluster in which no business capability is lost. It is one export. Removing it
also removes its two baseline entries (275 → 273).

| Gate | Status | Evidence |
|---|---|---|
| A, functional | VERIFIED | EOS `readWorkOrderFieldContext` (`eosOps/workOrderFieldContext.ts`; `workOrderOperations.ts:111`) keeps the RESOLVED/ABSENT/UNRESOLVED customer and site states. It returns a superset. `workOrderFieldContextPostgres` passed 7/7 when executed on 2026-10-11. |
| B, employee accessibility | **PARTIAL** | `useWorkOrderFieldContext.js` calls the EOS route; FieldMode, TechnicianWorkOrderDetail and TechnicianWorkOrderCard use it. The existing UI tests are source-regex checks (`customerIdentitySurfaces.test.mjs`) or mock the hook (`fieldDispatchSafeCopySweep.test.jsx`). **No screen test renders the real EOS shape, and no live technician run is recorded.** |
| C, authority | VERIFIED | `workOrder.record.read` per-record entitlement, technician narrowed to own assignment. Executed negatives: another technician FORBIDDEN, no capability CAPABILITY_MISSING, guessed id FORBIDDEN, extra input refused. Office read access is a governed widening. |
| D, persistence and integration | VERIFIED | Read-only over `eos_ops` Work Order, `eos_crm` accounts/locations and the PostgreSQL Catalog; no downstream writes. Also covered by `serviceTechnicianJourneyPostgres` (11/11 executed). |
| E, regression | VERIFIED | Positive and negative PostgreSQL tests, executed. The client test asserts the browser no longer names the Firebase callable. |
| audit | VERIFIED | Read; neither version audits reads. |

**Decision: no F5 draft PR yet.** Under the gate, F5 would be blocked on Gate B. It becomes ready when
both of these exist:

1. **A screen-level test** of a technician surface (for example `TechnicianWorkOrderDetail`) that
   drives `useWorkOrderFieldContext` with the **real** `readWorkOrderFieldContext` result and refusal
   shapes. This is a code change and needs no authorization beyond a PR.
2. **A recorded read-only live run.** A technician persona, through the EOS persona session harness,
   reads the field context of a Work Order assigned to it on nonprod. A second technician is refused.
   This also confirms that the technician `RECORD_ASSIGNMENT` condition and the Employee link are
   present on nonprod. It is read-only, but it is a credentialed call to the deployed environment, so
   it needs operator authorization.

When both are in place, the F5 PR will:

- delete `functions/src/getWorkOrderFieldContext.ts`, `functions/test/workOrderFieldContext.test.mjs`
  and `.github/workflows/work-order-field-context-tests.yml`;
- drop the `functions/package.json` script;
- fix the stale `FieldMode.jsx:41` comment;
- amend ledger row 34;
- shrink the baseline (275 → 273);
- regenerate the capability graph;
- add a **GATED REPLACED** record to the equivalence manifest.

The deployed sandbox copy is in no named `--force` batch, so it stays DEPLOYED_NOT_CALLED until the
bounded deletion window.

Other ranked candidates are **not safe yet**:

| Candidate | Reason |
|---|---|
| `getPartBalances` | It composes on-order figures that `readInventoryOnHand` does not provide. |
| Readiness / AI | Blocked as listed in §1. |
| Analytics / effects | Authority differs, and effects has no counterpart. |

## 3. Remediation before (or instead of) more retirement

The retrospective found that the replacements for already-retired operations have real gaps.
Closing them is worth more than the next count reduction. In order:

1. **CAT-1 / CAT-2: client contract defects.** Fix the Part Master outcome mapper and the identifier
   list adapter so they read the real EOS shapes. Map the EOS error codes and the `replayed` flag. Add
   contract tests against the real `catalogHttp` results. These are defects, not rulings.
2. **WOL-2: offline labor idempotency.** Use one key for the online and the queued send, and make the
   intent id unique per press.
3. **Owner decisions** (listed in the retrospective):
   - AUD-1, denial auditing;
   - ALS-1, scanner supersession;
   - WOL-3/4, labor changes;
   - PA-1, Parts Associate put-away;
   - CAT-3, the `inventory.catalog.activate` holder;
   - SUP-1, part-supplier terms;
   - SUP-2/3, supplier maintenance.
4. **Scanner harness migration.** Move scenarios 6, 7 and the scenario-12 put-away refusal to the EOS
   placement route. Also migrate or retire the other harness calls to callables retired in `5d6a84ac`
   (equipment/location reads, transfer, cycle count, `listMyReceivableTransfers`) and
   `runSandboxBinMoveScenarios.mjs`'s `relocateStock`.
5. **Live Gate-B evidence** for the ten UNVERIFIED historical records, starting with `recordPutAway`
   and `lookupScannedPart`, which miss nothing else.
6. **Dead code and stale metadata:**
   - `recordPutAwayCallable`;
   - `partAliasCallableClient.resolveScannedIdentifier`;
   - `catalogWriterState.ts:220`;
   - the `part.js` readModel / representation / `blockedBy`;
   - the `catalogMasterKernel` header;
   - `workOrderFieldParityMatrix.ts:283`.

## 4. Audit backlog: pre-gate retirements outside the 2026-10-11 scope

The gate's historical baseline is the 22 operations the Owner named. Earlier retirements are not in
it, and the gate makes no equivalence claim about them:

- **`5d6a84ac` (2026-10-01)** retired 18 inventory callables alongside `recordPutAway`:
  - acquireSerializedAsset;
  - cancelCycleCountLine, cancelCycleCountSheet, closeCycleCountSheet, createCycleCountSheet,
    getCycleCountAssignedMobileLocation, getCycleCountSheet, listCycleCountSheets,
    openCycleCountLine, reconcileCycleCountLine, submitCycleCountLine;
  - cancelTransferOrder, createTransferOrder, dispatchTransferOrder, receiveTransferOrder,
    listMyReceivableTransfers;
  - listStockMovementLocations;
  - relocateStock.
- **`dd0ccf4a` (2026-10-01)** retired 11 truck callables plus `listWorkOrderConsumptionSources` and
  `updateWorkOrderExecutionData`.
- **`5a8fcef7` (2026-10-01)** retired 5 equipment callables.
- **Earlier waves** took the estate from 187 exports to 138.

Several of these names are still used by the sandbox scanner harness (§3 item 4). Auditing them under
the same 15-point method is recommended before scanner workflow retirement.

## 5. Unchanged constraints

- No Firebase deployment and no Cloud Function deletion outside a separately authorized, bounded
  window. The F0 guard enforces target-bound production confirmations.
- No new Firebase dependencies. The exit ratchet and shim boundary still apply.
- Identity (Firebase Auth) is retired last, as a separate program.
