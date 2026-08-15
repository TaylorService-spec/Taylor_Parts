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
| Merge SHA | *(filled at merge — see reconciliation at package close)* |
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

-->

## Consolidated deploy requirements

Filled in as rows accumulate; this is the checklist a single authorized deployment executes.

| Area | Required |
| --- | --- |
| Functions | *(pending)* |
| Hosting | *(pending)* |
| Rules | *(pending)* |
| Indexes / config | *(pending)* |
| Capabilities / grants | *(pending)* |
| Readiness flags | *(pending)* |
| Seed / migration steps | *(pending)* |
| Smoke tests | *(pending)* |
| E2E tests | *(pending)* |

## Boundaries

- **No production deployment** is in scope for this manifest under any circumstance.
- A **Firestore Rules deployment is a protected boundary** (Tier 2,
  [`docs/DelegationCharter.md`](../DelegationCharter.md)) and is not authorized by the
  existence of a row here. Rules changes may be *prepared and tested* in a PR; deploying
  them requires separate authorization. See the `verify-rules-deploy` skill.
- The **pooled sandbox deployment itself** is a separate authorization. Rows accumulate
  until that authorization is given.
