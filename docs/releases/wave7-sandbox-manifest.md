# Wave 7 — Sandbox deployment manifest

**Purpose:** the running ledger of work **merged to `main` but not yet deployed to the
`platform-sandbox` environment** for the Wave 7 execution package (Parts / Work Orders /
Sales Orders / Serialized Assets).

**This artifact does not deploy anything.** It records what a *pooled* sandbox deployment
would have to promote, so that one consolidated, authorized deployment can replace a stream
of per-PR deployments. Adding a row here changes no infrastructure.

**Scope:** supersedes nothing. The Wave 6 package is already deployed and is *not* tracked
here. This manifest starts empty at the Wave 6 deployed baseline and accumulates forward.

## Baseline

| Field | Value |
| --- | --- |
| Deployed sandbox baseline (Wave 6) | `23fd569209c946c3025bb6812185167f1b432964` (`#998`) |
| Environment | `platform-sandbox` → Firebase project `eos-platform-sandbox` |
| Environment registry (authoritative) | [`config/environments.json`](../../config/environments.json) |
| Deployed-vs-expected check | `node scripts/checkDeployedVersions.mjs` |

`config/environments.json` remains the **single source of truth** for environment identity,
readiness flags, and capability activation. This manifest references it; it never duplicates it.

## Status vocabulary

Rows use the promotion lifecycle established in
[`docs/engineering/AI_ENGINEERING_OPERATING_MODEL.md`](../engineering/AI_ENGINEERING_OPERATING_MODEL.md) §8
and mirrored in [`ACTIVE_WORKSTREAMS.md`](../engineering/ACTIVE_WORKSTREAMS.md):

`DESIGNED` → `SANDBOX BUILD` → `SANDBOX VERIFIED` → `INTEGRATION` → `RELEASE CANDIDATE` →
`OWNER REVIEW` → `PRODUCTION AUTHORIZED` → `OPERATIONALLY VERIFIED` → `RETIRED`

A merged PR that has not been deployed to sandbox is `SANDBOX BUILD`. It only becomes
`SANDBOX VERIFIED` after the pooled deployment **and** the recorded validation actually runs.

**Merged is not deployed. Deployed is not verified.**

## Pending sandbox merges

### PR #1000 — Part Master governed write: sandbox activation readiness

| Field | Value |
| --- | --- |
| Merge SHA | `825567c6f469c608384aecdd34a16617952bc1a1` |
| Lifecycle stage | SANDBOX BUILD |
| Functions impact | **Deploy required.** `createPart`, `updatePart`, `changePartStatus` are exported (`functions/src/index.ts:206-209`) but have never been deployed to `eos-platform-sandbox`. No new callable is added by this PR. |
| Hosting impact | **Rebuild + release required.** `PART_MASTER_WRITE_READY` is a build-time constant injected from `config/environments.json`; the currently-served bundle was built with `false`. |
| Rules impact | **NONE.** `parts`/`manufacturers` stay `read, write: if false`; all writes go through the trusted callables via Admin SDK. |
| Indexes / config impact | `config/environments.json` — `platform-sandbox.readiness.PART_MASTER_WRITE_READY` `false → true`. No index change. |
| Readiness flags required | `PART_MASTER_WRITE_READY=true` for `platform-sandbox` only (already set in-repo by this PR; takes effect at the Hosting rebuild). |
| Capability activation / grants | **No activation override needed** — `inventory.catalog.manage` / `.activate` are not `active:false`, so they are outside the spine-override mechanism. **A grant IS required:** assign the newly-defined `inventoryCatalogAdministrator` Role to a sandbox **test** persona via the governed `roleAssignments` path (bumps `accessVersion`, syncs claims). This is the protected grant action; not performed. |
| Smoke / E2E validation required | As authorized catalog-admin test persona: create a synthetic Part; update it; change status (activate/deactivate). As a persona **without** the Role: all three denied. Replay the same idempotency key → no duplicate. Validation failures surface honestly. Confirm a `.manage`-only principal cannot change status. Confirm the workspace no longer renders write-disabled. |
| Rollback notes | Fully reversible, no data migration. Revoke the roleAssignment (capability lost immediately on `accessVersion` bump) → set `PART_MASTER_WRITE_READY` back to `false` + rebuild → redeploy the prior Functions estate (additive; removing the three callables is optional). Any Parts created during validation are synthetic sandbox data. |
| Deployment status | PENDING |

### PR #1001 — WO Parts Planning operational UI

| Field | Value |
| --- | --- |
| Merge SHA | `7679ceb7db935f6c5d1db78b2082fe46b13e7fa2` |
| Lifecycle stage | SANDBOX BUILD |
| Functions impact | **Deploy required.** `setWorkOrderPartsPlan` is exported (`functions/src/index.ts:16`) but has never been deployed. No backend change in this PR — the command, its capability registration and its producer tests are untouched. |
| Hosting impact | **Rebuild + release required** — this is a frontend-only change. |
| Rules impact | **NONE.** The plan lives on `fieldops_wos.inventorySnapshot`, already readable by admin/dispatcher/own-technician (`firestore.rules`); client writes remain `if false` and all writes go through the trusted command. |
| Indexes / config impact | NONE. |
| Readiness flags required | NONE — deliberately no client readiness flag. The capability itself is the single gate. |
| Capability activation / grants | **Both required.** `workOrder.parts.plan` is registered `active: false` and granted to no Role. It is NOT in the sandbox `capabilityActivationOverrides` spine list, so it needs (a) activation for `platform-sandbox` and (b) a Role grant to a sandbox test persona. Until both, every save honestly reports denied. |
| Smoke / E2E validation required | As an authorized dispatcher: open a live Work Order, add a part from the catalog, set a quantity, save, confirm the persisted plan re-renders from the document. Change a quantity; remove an unused part. Confirm a part with `qtyUsed > 0` cannot be removed. Confirm a COMPLETED/CLOSED/CANCELLED WO offers no edit. Confirm a WO whose snapshot has a legacy row with no `partId` refuses editing with the stated reason (data-loss guard). As an unauthorized persona: confirm denial, not a blank section. |
| Rollback notes | Frontend-only; revert the Hosting release. No data migration. Any plans saved during validation are ordinary `qtyPlanned` values the command already governs and can be re-planned or cleared. Deactivating the capability re-closes the surface immediately. |
| Deployment status | PENDING |


<!-- Row template — copy per merged PR:

### PR #NNN — <capability / workstream>

| Field | Value |
| --- | --- |
| Merge SHA | `<full sha>` |
| Lifecycle stage | SANDBOX BUILD |
| Functions impact | <new/changed callables, or NONE> |
| Hosting impact | <frontend rebuild required?, or NONE> |
| Rules impact | <firestore.rules change + whether deploy is runtime-required, or NONE> |
| Indexes / config impact | <firestore.indexes.json, config/environments.json, or NONE> |
| Readiness flags required | <FLAG_NAME=true for platform-sandbox, or NONE> |
| Capability activation / grants | <capability ids needing activation override + Role grants, or NONE> |
| Smoke / E2E validation required | <what must be exercised post-deploy to reach SANDBOX VERIFIED> |
| Rollback notes | <what reverting costs; any one-way steps> |
| Deployment status | PENDING |

### PR #1002 — Sales Order operational actions

| Field | Value |
| --- | --- |
| Merge SHA | `1b837e97c71c0a91a4fc477d2b0eb3138b8991e1` |
| Lifecycle stage | SANDBOX BUILD |
| Functions impact | **Deploy required.** `transitionSalesOrder`, `allocateSalesOrder`, `createServiceForSalesOrder` are exported but never deployed. No backend change in this PR. |
| Hosting impact | **Rebuild + release required** — frontend-only change. |
| Rules impact | **NONE.** All four commands are trusted callables using the Admin SDK; `sales_orders` client access is unchanged. |
| Indexes / config impact | NONE. |
| Readiness flags required | NONE. |
| Capability activation / grants | **Activation already in place** — `salesOrder.write`, `salesOrder.fulfill`, `salesOrder.service` are already in `platform-sandbox`'s `capabilityActivationOverrides`. **Role grants still required:** activation is not authorization, so a sandbox test persona needs a Role carrying these ids. |
| Smoke / E2E validation required | Advance and Cancel a Sales Order through its lifecycle; allocate; create service work and confirm the resulting Work Order appears in the lineage section. Confirm an action invalid for the current state is not offered. **Idempotency:** retry a failed Advance and confirm it does not apply twice; then confirm a transition on a DIFFERENT Sales Order is not swallowed as a replay. Unauthorized persona: denied, not blank. Confirm no pricing/discount/tax/quote field is rendered or editable anywhere on the surface. |
| Rollback notes | Frontend-only; revert the Hosting release. Lifecycle transitions performed during validation are real state changes on synthetic sandbox Sales Orders — CANCEL in particular is not reversible through the UI, so validate on throwaway records. Revoking the Role grants re-closes the surface immediately. |
| Deployment status | PENDING |

### PR #1003 — Part → Work Order Demand projection

| Field | Value |
| --- | --- |
| Merge SHA | `397e7c46aeebe90c5c502d1df731cb385c1bad2c` |
| Lifecycle stage | SANDBOX BUILD |
| Functions impact | **NONE.** Pure client-side projection over the existing `fieldops_wos` authority. No callable added or changed. |
| Hosting impact | **Rebuild + release required** — frontend-only change. |
| Rules impact | **NONE.** `fieldops_wos` is already readable by admin/dispatcher (and own-technician); no rule changed. |
| Indexes / config impact | **INDEX DEPLOY REQUIRED.** New composite index `fieldops_wos(status ASC, createdAt DESC)` in `firestore.indexes.json`. Without it the demand query fails at runtime, so the index must be deployed **before or with** the Hosting release. `firebase deploy --only firestore:indexes`. |
| Readiness flags required | NONE. |
| Capability activation / grants | NONE — reuses the existing `fieldops_wos` read grant. No new capability. |
| Smoke / E2E validation required | Open a Part that several open Work Orders plan. Confirm one row per Work Order with planned/used quantities matching those Work Orders, and that navigation reaches `/service/work-orders/:id`. Confirm a COMPLETED/CANCELLED Work Order does not appear as demand. Confirm a Part with no demand shows the empty state, not an error. Confirm the "showing the most recent N of M" disclosure appears only when the 300-row cap is actually hit. As a technician/unauthorized persona: denied state, not a blank card. Confirm no raw Firebase UID renders. |
| Rollback notes | Frontend-only; revert the Hosting release. The index is additive and harmless if left in place. Read-only feature: no data is written, so nothing to undo. |
| Deployment status | PENDING |

### PR #1004 — Serialized Asset registry: identity contract + governed read (Item 5, slice A)

| Field | Value |
| --- | --- |
| Merge SHA | `da6276ce48dc54801b6db9618d73fe2a12c82d06` |
| Lifecycle stage | SANDBOX BUILD |
| Functions impact | **New callable `getAvailableEquipment`** (exported, never deployed). Deploy required before it can be exercised. |
| Hosting impact | **NONE** — this slice ships no UI. |
| Rules impact | **NONE, and none is required.** `serialized_assets` has no `match` block and `firestore.rules` contains no `{document=**}` wildcard, so the collection is denied by default. Verified by inspection; the rules diff on this branch is empty. Reads go only through the trusted callable via Admin SDK. |
| Indexes / config impact | NONE in this slice. §L's registry indexes (by `partId` / `currentLocationId` / `inventoryState` / `currentEquipmentId`) are only needed once a list/query read exists; this slice reads by id. |
| Readiness flags required | NONE. |
| Capability activation / grants | New capability `inventory.serializedAsset.read`, registered `active: false`, granted to **no** Role and added to **no** environment activation override — deliberately stricter than `salesOrder.read` / `inventory.catalog.read` were at introduction. Exercising it later needs BOTH activation and a grant. Emulator tests prove admin, dispatcher and technician are all denied today, in every project including sandbox. |
| Smoke / E2E validation required | **Nothing to exercise until a writer exists.** The registry has no write path in this slice, so `serialized_assets` will be empty and the callable correctly returns `not-found`. Post-deploy validation is limited to: callable resolves; unauthenticated is rejected; an authorized-looking persona is still denied (no grant). Full validation belongs with slice B (the write/registration path). |
| Rollback notes | Fully reversible. No document is ever written by this slice, so there is no data to undo; no migration, no backfill. Removing the callable and the catalog entry restores the prior state exactly. |
| Deployment status | PENDING |

### PR #1006 — SERIAL receiving intake → Serialized Asset activation (Item 5, slice B)

| Field | Value |
| --- | --- |
| Merge SHA | `d745da560f14d59e020e7ecaf26bacad9905d17a` |
| Lifecycle stage | SANDBOX BUILD |
| Functions impact | **Changed behavior in an existing callable.** `receiveInventoryStock` now accepts `SERIAL` in addition to `NONE`. No new callable. Requires the Functions deploy already pooled for this package. |
| Hosting impact | **NONE** — no UI in this slice. |
| Rules impact | **NONE.** `serialized_assets` still has no `match` block and remains default-denied; writes occur only inside the trusted command via Admin SDK. `receiving_orders` rules are unchanged. |
| Indexes / config impact | NONE. The command reads serialized assets by deterministic document id, not by query. |
| Readiness flags required | NONE. |
| Capability activation / grants | **No new capability.** SERIAL intake rides the existing `inventory.stock.receive`, already granted to `{admin, dispatcher, owner}`. Note the consequence: once deployed, any principal who can already receive stock can receive SERIAL stock — that is the authorized scope, not an expansion of who may receive. |
| Smoke / E2E validation required | Receive a SERIAL-tracked Part (`controlType: SERIALIZED`) with one serial per unit; confirm one `serialized_assets` document per unit at the put-away location in state `RECEIVED` with `currentEquipmentId: null`, and one ledger event per unit with `quantity: 1` and its `serialNo`. Retry the identical request → replay, with no second asset and no second ledger effect. Re-present an already-received serial for the same Part → whole receipt refused. Same serial on a DIFFERENT Part → allowed. Receive a `STANDARD` Part → unchanged single bulk ledger event and no asset. Receive a `LOT` Part → refused. |
| Rollback notes | **Not a pure code rollback once exercised.** Reverting the code restores NONE-only receiving, but any `serialized_assets` documents and per-serial ledger events created during validation REMAIN — the ledger is append-only and completed business history is immutable by design (Specification §L). In sandbox those are synthetic records and can be left in place or cleared as sandbox data; there is no migration to undo, and no production data is involved. |
| Deployment status | PENDING |

### PR #1008 — SERIAL receiving: unblock the callable + client request boundary

| Field | Value |
| --- | --- |
| Merge SHA | *(filled at merge)* |
| Lifecycle stage | SANDBOX BUILD |
| Functions impact | **Defect fix to `receiveInventoryStock`.** No new callable. Rides the pooled Functions deploy. |
| Hosting impact | **Rebuild required** — the client transport also stripped the field. |
| Rules impact | **NONE.** |
| Indexes / config impact | NONE. |
| Readiness flags required | NONE for this fix. Note `RECEIVING_TRANSPORT_READY` is `true` for `platform-sandbox` already. |
| Capability activation / grants | NONE — rides the existing `inventory.stock.receive`, already granted to `{admin, dispatcher, owner}`. |
| Smoke / E2E validation required | Submit a SERIAL receipt **through the callable** (not just the command): confirm it is accepted rather than rejected as an unknown field, and that assets + per-unit ledger events are created. Confirm a NONE receipt still sends no `serialNumbers` key and still succeeds. Confirm a malformed serial list is refused at the boundary. |
| Rollback notes | Pure code; revert restores the (broken) NONE-only boundary. Same append-only caveat as #1006 applies to anything already received. |
| Deployment status | PENDING |

-->

## Consolidated deploy requirements

Filled in as rows accumulate; this is the checklist a single authorized deployment executes.

Five PRs (#1000–#1004) merged after the baseline. Order matters in one place only: the
**index must be deployed before or with the Hosting release**, or the Part → Work Order Demand
query fails at runtime.

| Area | Required |
| --- | --- |
| Functions | Deploy `createPart`, `updatePart`, `changePartStatus` (#1000); `setWorkOrderPartsPlan` (#1001); `transitionSalesOrder`, `allocateSalesOrder`, `createServiceForSalesOrder` (#1002); `getAvailableEquipment` (#1004). All were already exported and have never been deployed. **Plus a behavior change to the existing `receiveInventoryStock` (#1006): it now accepts SERIAL as well as NONE.** |
| Hosting | One rebuild + release covering #1000–#1003. Required for #1000 specifically because `PART_MASTER_WRITE_READY` is a **build-time** constant — the currently-served bundle was built with `false`. |
| Rules | **NONE.** No PR in this package changes `firestore.rules`. No protected Rules deployment is created or required. |
| Indexes / config | **One index:** `fieldops_wos(status ASC, createdAt DESC)` (#1003) — `firebase deploy --only firestore:indexes`, **before or with** Hosting. Config: `platform-sandbox.readiness.PART_MASTER_WRITE_READY` is already `true` in-repo and takes effect at the rebuild. |
| Capabilities / grants | **Activation needed:** `workOrder.parts.plan` (#1001) is `active:false` and not in the sandbox spine override. `inventory.serializedAsset.read` (#1004) is `active:false` with no override — leave it inactive; it has no writer yet. Already active: `salesOrder.write` / `.fulfill` / `.service`. **Grants needed (all to sandbox TEST personas, never production):** `inventoryCatalogAdministrator` for #1000; a Role carrying `workOrder.parts.plan` for #1001; a Role carrying the three sales capabilities for #1002. `inventory.catalog.manage`/`.activate` need no activation (they are not `active:false`). |
| Readiness flags | `PART_MASTER_WRITE_READY=true` for `platform-sandbox` only — already committed; production/integration/emulator remain `false` and a test asserts no production-role environment enables it. |
| Seed / migration steps | **NONE.** No migration, backfill or seed in this package. #1004 writes no document at all. |
| Smoke tests | Per-PR smoke lists are in each row above. Minimum sequence: Part create/update/status → plan parts on a live Work Order → view that demand from the Part → advance/allocate/create-service on a Sales Order. |
| E2E tests | The cross-item chain this package makes possible end to end: **plan parts on a Work Order (#1001) → see that Work Order as demand on the Part (#1003) → act on the originating Sales Order (#1002)**, with Part Master writes (#1000) supplying the catalog records the plan selects from. |

### Post-deployment bookkeeping (do not skip)

`scripts/indexDriftGuard.test.mjs` carries `PENDING_DEPLOY_INDEX_KEYS`. Once the index above is
actually deployed, **remove its key from that list** — that is what restores the guard's
declared-equals-live assertion. Leaving it listed would let a genuinely undeclared index hide.

## Boundaries

- **No production deployment** is in scope for this manifest under any circumstance.
- A **Firestore Rules deployment is a protected boundary** (Tier 2,
  [`docs/DelegationCharter.md`](../DelegationCharter.md)) and is not authorized by the
  existence of a row here. Rules changes may be *prepared and tested* in a PR; deploying
  them requires separate authorization. See the `verify-rules-deploy` skill.
- The **pooled sandbox deployment itself** is a separate authorization. Rows accumulate
  until that authorization is given.
