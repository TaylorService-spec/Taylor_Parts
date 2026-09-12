# W1-C18 — Administration configuration: drift census, registrations, and what this lane could not do

Branch `impl/w1-admin-configuration`, cut from `33945090d66d2287fe0cdc362c80ad6e4e311067`.

Scope: the Administration surfaces themselves — the object and permission registries, the CRUD
matrix, the policy object registry, and the distance between what Administration **advertises** and
what the backend **actually enforces**. Individual business objects belong to their own lanes; the
Admin→Objects profile framework belongs to lane C2 (PR #1866) and is untouched here.

No migration was added. The pre-allocated id `1759449600000` was **not used** — nothing in this
lane needs a schema change.

---

## 0. The shape of the problem, in one paragraph

**Four tables in this repository answer the same question** — which capability governs each verb on
each business object — and until this branch nothing compared them:

| table | path | consumed by |
|---|---|---|
| `OBJECT_PERMISSIONS` | `field-ops-app-vite/src/access/objectPermissionMap.js:33` | the Administration screens (`AdminObjects.jsx`, `RolePolicyGrid.jsx`, `roleAccessModel.js`, `navConfig.js`) and, transitively, the policy seed |
| `OBJECT_CAPABILITY_MAP` | `functions/scripts/governance/objectCapabilityMap.mjs:39` | `buildContract.mjs`, `buildWorkbookV2.mjs` → every committed artifact under `docs/governance/` |
| `MATRIX_GAP_CAPABILITIES` | `field-ops-app-vite/src/access/policyObjectRegistry.js:123` | `GOVERNABLE_OBJECTS` → `policySeedSnapshot.json` → the tenant policy store |
| a fourth, private copy | `scripts/reconcileCrudMatrix.mjs:100-127` | the reconciliation report only; imported by nothing |

`objectCapabilityMap.mjs:13-16` says in its own header that the fourth copy was consolidated into
it ("scripts/reconcileCrudMatrix.mjs was doing this mapping privately … One table, both
consumers"). **It was not.** The private table is still there, and it had drifted.

---

## 1. Fifteen findings, with evidence

| # | finding | evidence |
|---|---|---|
| 1 | **`inventory.action.create` advertised a Create nothing can perform.** Its only application-layer writer throws unconditionally; the `.add()`-capable store handle was deleted. The catalog still registers the id **active**, and admin/dispatcher still hold it, so nothing in the authorization engine marked it dead. | writer: `field-ops-app-vite/src/domain/inventoryActions.js:47-54`; catalog active: `functions/src/access/permissionCatalog.ts:578-582`; advertised at `objectPermissionMap.js:54-56` (as shipped) |
| 2 | **The two capability maps disagreed about it in the repository as shipped.** `objectCapabilityMap.mjs` already recorded `C: []` for the same object. Both files were committed, both were tested, and neither suite could see the other. | `functions/scripts/governance/objectCapabilityMap.mjs:64` |
| 3 | **A third copy carried the same dead id**, plus `reorder.purchaseOrder.void` in Purchase Orders / Edit — an id that `WORKFLOW_ACTION_CAPABILITIES` explicitly bans from the CRUD matrix. | `scripts/reconcileCrudMatrix.mjs:113-114` (as shipped); ban list `objectPermissionMap.js:123-136` |
| 4 | **`objectCapabilityMap.mjs` attributed a Reorder Request transition to the Purchase Order object.** `reorder.request.postPurchasingUpdate` sat in `Purchase Orders / E`. It is both a banned workflow action and a capability over a *different* record, so one capability had two homes — exactly the defect Owner ruling D-5 (2026-09-08) closed on the client side. | `objectCapabilityMap.mjs:65` (as shipped) |
| 5 | **`Reorder Requests` has no row in `OBJECT_CAPABILITY_MAP` at all.** D-5 split it out as its own canonical Object; `objectPermissionMap.js:79` got the new row, the governance map never did. Every contract row, workbook sheet and precedence-sweep classification generated from that map therefore omits the object, and `reorder.request.create.manual`, `.create.system`, `.read.queue`, `.read.own` are attributed to **no object** in the generated governance artifacts. | `objectPermissionMap.js:73-75` vs `objectCapabilityMap.mjs:39-80` |
| 6 | **Equipment is `rulesOnly` with all four CRUD lists empty, and there is no `equipment_models` row at all.** Authorization lives in `firestore.rules` by role (admin/dispatcher). The metadata definition records this honestly (`readCapability: null`). | `objectPermissionMap.js:92`; `definitions/equipment.js`; confirmed by lane C7 |
| 7 | **Contacts and Customer Locations are `rulesOnly` with no catalog capability.** `firestore.rules` `/locations/{locationId}` validates nothing. | `objectPermissionMap.js:36-37`; C9's handoff §4 |
| 8 | **`employees` has no row in `OBJECT_PERMISSIONS`.** `firestore.rules` `employees/{employeeId}` (lines 476-498) is three role/relationship OR branches and **no capability id**; there is no `employee.*` id in the catalog and `definitions/employee.js` records `readCapability: null`. | C5's handoff §7 |
| 9 | **`stockLocation` is still a registered client entity and still advertises a Read verb — backed by a capability the catalog itself says nothing evaluates.** `MATRIX_GAP_CAPABILITIES.stockLocation` maps `R: ["warehouse.stockLocation.read"]`, whose catalog description reads "LEGACY, RETIRED AUTHORITY … no principal can reach the collection at all; the id is retained only as a historical catalog entry and **nothing evaluates it**." | `policyObjectRegistry.js:125`; `permissionCatalog.ts:596`; `entityRegistry.js:47,79` |
| 10 | **Two objects are `RULE_GOVERNED` on the server and not `rulesOnly` on the client.** `Notifications` — Administration advertises `R: ["reorder.request.read.queue"]`, so the client says it is capability-governed while the governance map maps it to nothing and lists it Rules-governed. `Technician Time / Non-work` — neither table names a capability and no `firestore.rules` collection corresponds to it, so it is UNMODELLED, not Rules-governed. | `objectPermissionMap.js:49,97-98` vs `objectCapabilityMap.mjs:31-33,61,78` |
| 11 | **The policy seed drops `rulesOnly` entirely.** `GOVERNABLE_OBJECTS` carries the marker, and `buildAdminPolicySeedSnapshot.mjs:59-70` does not copy it into `policySeedSnapshot.json`. Inside the tenant policy store a Rules-governed object is **indistinguishable** from an unmodelled one: both are an object with four empty verb lists. | `policyObjectRegistry.js:155`; `scripts/buildAdminPolicySeedSnapshot.mjs:59-70`; verified: no `rulesOnly` key exists anywhere in `policySeedSnapshot.json` |
| 12 | **`admin.credentialReset.initiate` is advertised on `Users / Edit` and has no server implementation at all.** `docs/architecture/capability-graph.json` classifies it `CLIENT_ONLY` with `serverReferenceCount: 0`; its only `functions/src` occurrences are the catalog entry and two comments. It is registered `active: false`, so it also denies for everyone. | `objectPermissionMap.js:100`; graph entry for that id; `permissionCatalog.ts:1053`; `functions/src/access/adminCredentialCommands.ts:29` |
| 13 | **30 of the 58 capability ids the three live tables advertise are registered `active: false`** — they deny for every principal in every environment regardless of the grant. `AdminObjects.jsx:147-151,174` does render these as "inert", which is to the screen's credit; the *census* is in §3 below. Whole objects are inert end to end: Opportunities, Sales Orders, Transfer Orders, Invoices / AR, Payments, Serialized Assets, Sales Agreement. | `permissionCatalog.ts` `active` flags; measured, §3 |
| 14 | **There is no machine-readable list of capabilities a governed server command actually enforces, and one cannot be derived.** Capability ids reach enforcement through module constants and an injected `authorize` seam, and at least six `*Callables.ts` wirings **discard** the id the command passes and resolve their own. `capability-graph.json` records literal-reference evidence and says so itself ("a literal-id scan is evidence of reference, never proof of a callable", `scripts/buildCapabilityGraph.mjs:53-56`). A hard "advertised verb ⇒ enforcing command" gate is therefore **not** buildable today; §5 records what would make it buildable. | `functions/src/inventoryReceiving/receivingCallables.ts:172`; `cycleCount/cycleCountCallables.ts:163,196,227,252`; `inventoryTransfer/transferCallables.ts:136,154,172,190` |
| 15 | **`capability-graph.json` mislabels every active capability.** Its parser tests for a literal `active: true` (`scripts/buildCapabilityGraph.mjs:91`), but the catalog never writes that string — the runtime rule is `active !== false` (`permissionCatalog.ts:1695`, `resolveEffectivePermission.ts:264`). The graph therefore reports `catalogActive: 0 / catalogInactive: 147` when the true split is **38 active / 109 inactive**. This is a semantic defect, not staleness — the file is freshly generated. | `scripts/buildCapabilityGraph.mjs:91`; `functions/src/access/permissionCatalog.ts:1693-1696` |

---

## 2. The full drift census

### 2.1 Every advertised verb with no governed implementation

| capability | advertised at | why nothing implements it | disposition |
|---|---|---|---|
| `inventory.action.create` | `objectPermissionMap.js` Inventory Adjustments / C; `reconcileCrudMatrix.mjs` same row | sole writer `recordInventoryAction()` throws unconditionally (Owner ruling 2026-08-30); the writable store handle was deleted | **REMOVED on this branch**, both places. Guarded by `administrationObjectDrift.test.mjs` |
| `admin.credentialReset.initiate` | `objectPermissionMap.js:100` Users / E | zero `functions/src` references outside the catalog entry; `capability-graph.json` evidence = `CLIENT_ONLY`; registered `active: false` | **NOT removed.** It is inert, so it grants nothing; whether the credential-reset command should carry it is a permission-catalog decision. Recorded, §4 |
| `warehouse.stockLocation.read` | `policyObjectRegistry.js:125` stockLocation / R | catalog entry states "nothing evaluates it"; the collection is unreachable by any principal | **NOT removed** — see §4.3 |
| `reorder.purchaseOrder.void` | `reconcileCrudMatrix.mjs:114` Purchase Orders / E | implemented, but as a TRANSITION; banned from the CRUD matrix by D-5 | **REMOVED** from the private table |
| `reorder.request.postPurchasingUpdate` | `objectCapabilityMap.mjs:65` Purchase Orders / E | implemented, but as a Reorder Request transition on a different object; banned by D-5 | **REMOVED** |

`financialPolicy.profile.configure` is also `CLIENT_ONLY` but is advertised by no CRED table; it is
named here only so the next census does not re-find it.

### 2.2 Every `rulesOnly` object — the Rules-as-authorization standing exposure

Each of these is a business object whose answer to "who may do this" lives in role branches inside
`firestore.rules`, where no capability, no Role definition and no governed command can see it.

| object | collection | client `rulesOnly` | server `RULE_GOVERNED` | capabilities advertised |
|---|---|---|---|---|
| Contacts | `contacts` | yes (`objectPermissionMap.js:36`) | yes (`objectCapabilityMap.mjs:32`) | none |
| Customer Locations | `locations` | yes (`:37`) | yes | none |
| Equipment / Installed Base | `equipment` | yes (`:92`) | yes | none |
| Notifications | — | **no** | **yes** | client advertises `R: ["reorder.request.read.queue"]` — the two tables disagree about the mechanism |
| Technician Time / Non-work | — | **no** | **yes** | none; no corresponding Rules collection exists, so UNMODELLED is the correct classification, not RULE_GOVERNED |

Adjacent, not `rulesOnly` but the same exposure: **Employees** has no row in `OBJECT_PERMISSIONS`
at all while `firestore.rules employees/{employeeId}` decides its access by role and relationship
(finding 8), and **`inventory_actions`** still carries `allow create: if isAdminOrDispatcher()` with
no field validation — now the *only* remaining way to create a document there, since the product's
writer was retired (`domain/inventoryActions.js:31-35`). Both are Tier-2 and outside this lane.

**Count: 5 objects carried as Rules-governed, of which 2 are carried that way by only one of the
two tables. Plus 2 adjacent collections (employees, inventory_actions) where Rules is the whole
authorization story with no capability at all.**

### 2.3 Every disagreement between the two capability maps

Measured after this branch's corrections. `permMap` = `OBJECT_PERMISSIONS`,
`capMap` = `OBJECT_CAPABILITY_MAP`.

| object / verb | only in permMap | only in capMap |
|---|---|---|
| Accounts / E | `customer.governedField.write` | — |
| Opportunities / C | — | `opportunity.write`, `opportunity.createSalesOrder` |
| Sales Orders / C | `opportunity.createSalesOrder` | `salesOrder.write` |
| Sales Orders / E | `salesOrder.fulfill`, `salesOrder.service` | — |
| Work Orders / E | `workOrder.cancel`, `workOrder.parts.plan` | — |
| Work Orders / D | — | `workOrder.cancel` |
| Dispatch Schedule / R | `fulfillment.coordinatedVisit.read` | — |
| Dispatch Schedule / E | — | `workOrder.transition` |
| Parts Catalog / C | — | `inventory.catalog.manage` |
| Parts Catalog / E | `inventory.catalog.activate` | — |
| Inventory Stock / R | `inventory.analytics.read` | `inventory.balance.read` |
| Inventory Stock / E | `inventory.stock.receive` | — |
| Inventory Adjustments / C | `inventory.cycleCount.create` | — |
| Inventory Adjustments / E | `inventory.cycleCount.submit`, `.reconcile`, `.cancel` | — |
| **Reorder Requests (whole object)** | **entire row** | **absent — no row at all** |
| Receiving / C | — | `inventory.stock.receive` |
| Transfer Orders / C | `inventory.transfer.create` | — |
| Transfer Orders / E | `inventory.transfer.dispatch`, `.receive`, `.cancel` | — |
| Notifications / R | `reorder.request.read.queue` | — |
| Users / E | `admin.userStatus.write`, `admin.credentialReset.initiate` | — (deliberate: Owner decision 2026-08-21) |
| Roles / Permissions / E | `admin.roleAssignment.write`, `admin.accessRequest.decide` | — (same decision) |

**Not all of these are defects.** `Users` and `Roles / Permissions` are empty on the governance side
on purpose, and `Contacts` is empty on purpose rather than mapped to `crm.activity.*` — both are
recorded Owner decisions with tests defending them (`semanticMappingGuards.test.mjs`). The rest are
unexplained: nobody wrote down why Administration thinks `salesOrder.fulfill` is an Edit on Sales
Orders and the governance contract does not, and a generated contract that omits it is the artifact
the business reads.

Two disagreements are **structural rather than a matter of degree**:

* **Work Orders / Delete.** `capMap` puts `workOrder.cancel` under D; `permMap` puts it under E.
  `supportsDelete` is derived from `permMap`'s D list (`policyObjectRegistry.js:160`), so the seeded
  policy store says Work Orders cannot be deleted while the governance contract says cancel is the
  delete verb. One of the two is wrong.
* **Reorder Requests.** Absent from `capMap` entirely (finding 5).

### 2.4 Advertised but inert — 30 of 58 ids

Registered `active: false`, so `resolveEffectivePermission` denies unconditionally
(`resolveEffectivePermission.ts:264-265`) unless an environment activation override is present.
Grouped by the object that advertises them:

* **Opportunities** — `opportunity.read`, `opportunity.write`
* **Sales Orders** — `opportunity.createSalesOrder`, `salesOrder.read`, `salesOrder.write`, `salesOrder.fulfill`, `salesOrder.service`
* **Work Orders** — `workOrder.parts.plan`
* **Dispatch Schedule** — `fulfillment.coordinatedVisit.read`
* **Parts Catalog** — `inventory.catalog.read`
* **Inventory Adjustments** — `inventory.cycleCount.create`, `.submit`, `.reconcile`, `.cancel`
* **Inventory Stock** — `inventory.balance.read` (capMap only)
* **Transfer Orders** — `inventory.transfer.create`, `.dispatch`, `.receive`, `.cancel`
* **Serialized Assets** — `inventory.serializedAsset.read`
* **Invoices / AR** — `finance.invoice.issue`, `finance.read`, `finance.adjustment.record`
* **Payments** — `finance.payment.apply`, `finance.read`, `finance.refund.record`
* **Users** — `admin.credentialReset.initiate`
* **Sales Agreement** (gap table) — `salesAgreement.create`, `.read`, `.updateDraft`, `.accept`

Seven objects are inert on **every** advertised verb: Opportunities, Sales Orders, Transfer Orders,
Serialized Assets, Invoices / AR, Payments, Sales Agreement. This is not drift — it is the
transitional state — but it is the honest answer to "how much of what Administration advertises can
actually happen today", and the number is **52%**.

---

## 3. What this lane changed, and why it is the smallest coherent step

### 3.1 Three provably-wrong entries removed

Each removal narrows what Administration advertises. **Nothing was granted, activated or widened.**

1. `field-ops-app-vite/src/access/objectPermissionMap.js` — dropped `inventory.action.create` from
   Inventory Adjustments / Create. Proof: the writer throws.
2. `functions/scripts/governance/objectCapabilityMap.mjs` — emptied Purchase Orders / Edit. Proof:
   the id is on the repository's own ban list and belongs to a different record.
3. `scripts/reconcileCrudMatrix.mjs` — dropped `inventory.action.create` and
   `reorder.purchaseOrder.void`. Same two proofs.

### 3.2 One enforcement test

`functions/test/administrationObjectDrift.test.mjs` — 15 tests, all passing, each one
mutation-tested (see §6). It asserts:

* every capability any of the three live tables advertises is defined in the permission catalog;
* every id on the workflow-action ban list is itself a real catalog id (so the ban cannot rot);
* **no workflow action is advertised as a CRED cell in ANY table** — the client map already proved
  this about itself; this extends the ruling to the governance map, the gap table and the private
  copy in the report script;
* **the retired Inventory Action writer still throws, and no table advertises a Create on it** —
  the one case where "advertised verb, no implementation" is mechanically provable;
* the governance map names no object Administration does not advertise, and exactly one object
  (`Reorder Requests`) goes the other way — pinned by name, so growing the gap fails and closing it
  fails loudly enough to delete the pin;
* the report script's private matrix names no unknown object;
* every `rulesOnly` object advertises **no** capability on any verb (an object cannot be governed
  both ways);
* the `rulesOnly` census is **exactly** the three objects on record — a fourth cannot appear without
  a decision;
* every client `rulesOnly` object is `RULE_GOVERNED` server-side, and the two server-only entries
  are pinned by name;
* every object with no capability on any verb is explained as rules-governed or unmodelled by one of
  the tables — an unexplained ungovernable object fails.

**Why a test and not more edits.** The census above is 21 rows of map disagreement, and most of
those rows are a judgement nobody has written down. Encoding a guess would create the "second
opinion stated as fact" this codebase keeps re-learning. A test that pins what is *decided* and
fails on what is *new* converts the drift from silent to loud without deciding anything.

### 3.3 Regenerated artifacts (mechanical, no hand edits)

* `functions/src/adminPolicy/seed/policySeedSnapshot.json` — one line, via
  `node scripts/buildAdminPolicySeedSnapshot.mjs`. Required: `adminPolicySeedCoverage.test.mjs`
  re-runs the generator and compares.
* `docs/governance/precedence-sweep.json`, `role-capability-contract.json`,
  `workbook-v2/4-role-to-capability.csv` — via the five `scripts/governance/*` builders. Required:
  `functions` `test:governance` ends in `git diff --exit-code -- ../docs/governance`.
* `docs/architecture/capability-graph.json` — see §4.1. **This file is on this lane's
  do-not-edit list.**

---

## 4. RESERVED FILES — what this lane touched, and what it could not

### 4.1 `docs/architecture/capability-graph.json` — TOUCHED, disclose and review

This file is on the lane's do-not-edit list. It is also **generated**
(`node scripts/buildCapabilityGraph.mjs`) by scanning `functions/src` and `field-ops-app-vite/src`
for literal capability ids. Removing `inventory.action.create` from `objectPermissionMap.js`
therefore makes it stale, and `functions/test/capabilityGraphDrift.test.mjs` — which is in
`test:governance` — fails.

The regeneration is **three lines and changes no classification**:

```
         "clientReferences": [
           "field-ops-app-vite/src/access/compatibilityRoles.ts",
           "field-ops-app-vite/src/access/legacyAuthorizationSurface.ts",
-          "field-ops-app-vite/src/access/objectPermissionMap.js",
           "field-ops-app-vite/src/access/parityFixtures.ts"
         ],
         "serverReferenceCount": 3,
-        "clientReferenceCount": 4,
+        "clientReferenceCount": 3,
         "evidence": "SERVER_REFERENCED"
```

No hand edit was made; the generator was run. If this conflicts with a sibling lane, **drop this
file from the merge and re-run `node scripts/buildCapabilityGraph.mjs`** — the result is
deterministic.

### 4.2 Files this lane did NOT edit, and what each still needs

| reserved file | what it still needs | who decides |
|---|---|---|
| `field-ops-app-vite/src/metadata/entityRegistry.js` | retire `stockLocationEntity` (imported at `:47`, listed at `:79`); add a `bin` definition — both requested by lane C3 | Admin metadata owner |
| `field-ops-app-vite/test/suites.json` | nothing from this lane — its test is functions-side precisely because a new client `.test.mjs` must be registered here or in a workflow, and both are reserved | — |
| `.github/workflows/**` | **register `functions/test/administrationObjectDrift.test.mjs`** — see §5.1 | CI owner |
| `functions/src/access/permissionCatalog.ts` | no addition from this lane; three proposals recorded in §5.3 | Owner |
| `firestore.rules` | `inventory_actions` `allow create: if false` (lane C13's Tier-2 request); `employees` and `locations` have no field validation | Owner, Tier-2 |
| `functions/package.json` | **register the new test** — see §5.1 | CI owner |
| `firebase-exit-baseline.json`, `firebase-exit-manifest.json` | unchanged — the guard passes, §6 | — |

### 4.3 Things this lane deliberately did not do

* **Did not add `"Reorder Requests"` to `OBJECT_CAPABILITY_MAP`.** It is the clearest single fix in
  this census and it is an *addition* to a capability map, which this lane is forbidden to make.
  Written up in §5.2; pinned by a test so it cannot be forgotten.
* **Did not remove `stockLocation` from `MATRIX_GAP_CAPABILITIES`.** The capability it advertises is
  dead by the catalog's own words, but removing the mapping alone leaves a retired object seeded
  with no grantable verb — a half-retirement. The whole retirement needs `entityRegistry.js`, which
  is reserved. Ripple if it is done: `policySeedCoverage.json` `capabilityGapsFilled`,
  `adminPolicySeedCoverage.test.mjs:159`, `policyObjectRegistry.test.mjs:99`.
* **Did not add an `Employees` row.** Lane C5 explicitly refused the same decision and named the two
  honest options; this lane agrees with C5's reading and will not choose inside a shared file. §5.2.
* **Did not resolve the 21 map disagreements** in §2.3. Each is a judgement with an owner.
* **Did not touch the Admin→Objects profile framework** (lane C2, PR #1866).
* **Did not build an "advertised verb ⇒ enforcing command" gate.** Finding 14 says why it cannot be
  built honestly today; §5.4 says what would make it possible.

---

## 5. Required registrations and consolidated requests

### 5.1 REQUIRED — register the new test (blocking; it runs nowhere in CI otherwise)

`functions/` has no test manifest and nothing auto-discovers a test file, so an unregistered
functions test is a guard that never runs. Two edits, both in reserved files:

**`functions/package.json`**, append to `test:governance`'s `node --test` list:

```
test/administrationObjectDrift.test.mjs
```

It needs no database and no emulator, and runs in under 100 ms.

**`.github/workflows/eos-admin-policy-tests.yml`** — add the file to the `run:` line at `:219`
alongside the other admin-policy suites, **and** add these to that workflow's
`on.pull_request.paths`, since a change to any of them can break it:

```
field-ops-app-vite/src/access/objectPermissionMap.js
field-ops-app-vite/src/access/policyObjectRegistry.js
field-ops-app-vite/src/domain/inventoryActions.js
functions/scripts/governance/objectCapabilityMap.mjs
scripts/reconcileCrudMatrix.mjs
```

### 5.2 REQUESTED — three registry changes this lane proved but may not make

1. **Add a `Reorder Requests` row to `functions/scripts/governance/objectCapabilityMap.mjs`**,
   mirroring the ids `objectPermissionMap.js:73-75` already advertises:
   `R: ["reorder.request.read.queue", "reorder.request.read.own"]`,
   `C: ["reorder.request.create.manual", "reorder.request.create.system"]`, `E: []`, `D: []`.
   Nothing new is granted — these ids are already advertised, already held and already active. What
   changes is that the generated governance contract stops omitting the object.
   `administrationObjectDrift.test.mjs`'s pin must be deleted in the same change.
2. **Decide `Employees`.** Lane C5's two options, restated: either
   `{ object: "Employees", domain: "Workforce", rulesOnly: "employees", C: [], R: [], E: [], D: [] }`
   — truthful today — or introduce real `employee.*` capability ids first, which is a catalog change
   and a Rules change. C5's position, which this lane shares: the second is the end state, the first
   is the honest interim. Note that option one **grows the `rulesOnly` census to four** and will
   fail this lane's pinned census test, which is the intended behaviour — it forces the decision to
   be visible.
3. **Decide Work Orders / Delete.** `capMap` D vs `permMap` E for `workOrder.cancel` (§2.3). The
   seeded policy store and the governance contract currently disagree about whether the object is
   deletable at all.

### 5.3 PROPOSED capability ids — recorded, not added, not depended on

Carried forward verbatim from sibling lanes so they are in one place. **Nothing in this branch
grants, activates or depends on any of them.**

| object | C | R | E | D | from |
|---|---|---|---|---|---|
| Contacts | `customer.contact.create` | `customer.contact.read` | `customer.contact.update` | — | C9 §4 |
| Customer Locations | `customer.location.create` | `customer.location.read` | `customer.location.update` | — | C9 §4 |
| Equipment / Installed Base | open — `equipmentImportCommand.ts` reuses `equipment.install` for creation and flags "whether Equipment deserves its own create capability is a real question and a separate decision" | | | | C7 §1.4 |

### 5.4 What would make a real enforcement gate possible

Finding 14 says the gate cannot be built from the artifacts that exist. The missing piece is small
and there is already a precedent for it: `functions/src/eosOps/migration/inventoryWriterCapabilityCensus.ts:59`
is a hand-verified `{operationKey, sourceFile, capabilityKey, kind}` table — 18 rows, scoped to
inventory writers, with `kind ∈ CAPABILITY_CATALOG | HARDCODED_ROLE`. **Extending that census to
every governed command** would make "does a governed command implement this advertised verb?" a
lookup, and this lane's test could then assert it. That is a real piece of work with an owner; it is
not a Wave 1 lane's to start.

### 5.5 Consolidated sibling-lane registry requests (read from `origin/impl/w1-*`)

Thirteen sibling handoff files were read. On the registries this lane owns:

| lane | branch | ask | status here |
|---|---|---|---|
| **C13** inventory-action | `impl/w1-inventory-action` | drop `inventory.action.create` from `objectPermissionMap.js:54-56`; notes `reconcileCrudMatrix.mjs:113` needs the same edit | **DONE, both** |
| **C7** equipment | `impl/w1-equipment` | records Equipment `rulesOnly` with four empty lists and no `equipment_models` row; asks only that it not be rediscovered | **RECORDED**, findings 6 and §2.2 |
| **C5** employee-principal | `impl/w1-employee-principal` | `Employees` has no `OBJECT_PERMISSIONS` row; refuses to decide inside a shared file | **RECORDED**, §5.2 item 2. This lane agrees and also declines |
| **C9** account-contact-location | `impl/w1-account-contact-location` | Contacts / Customer Locations `rulesOnly`, no catalog capability; proposes six ids | **RECORDED**, §2.2 and §5.3. Also carries a `policySeedSnapshot.json` location-field-key drift (`addressStreet` vs nested `address.street` vs `addressLine1`) for the seed owner — **not** this lane's, since it is field metadata, not object authority |
| **C3** warehouse-bin | `impl/w1-warehouse-bin` | retire `stockLocation` from `entityRegistry.js`; add a `bin` definition | **BLOCKED** — `entityRegistry.js` is reserved. §4.2, §4.3 |
| **C4** truck-mobile | `impl/w1-truck-mobile` | no `truck` / `mobileLocation` row in `OBJECT_PERMISSIONS`; both reach Admin→Objects as `REGISTRY_ONLY` | **RECORDED** — both are governable objects with no grantable verb, which is the honest state; no change requested |
| **C10** commercial | `impl/w1-commercial` | Sales Agreement covered by the gap table; Sales Territory has no grantable verb | **NO ACTION** — already correct |
| C1, C2, C6, C8, C11, C15 | various | all state "no change required" to these registries | **NO ACTION** |

No sibling asked for anything this lane's edits conflict with. C13's request and this lane's
independent finding are the same edit, made once.

### 5.6 One consequence of the §3.1 corrections, for the governance owner

Emptying `Purchase Orders / E` in the governance map reclassifies two grants in
`docs/governance/precedence-sweep.json`:

```
generalManager    reorder.request.postPurchasingUpdate   CANONICAL_MATRIX -> UNJUSTIFIED
purchasingManager reorder.request.postPurchasingUpdate   CANONICAL_MATRIX -> UNJUSTIFIED
```

**No grant changed.** What changed is that the mis-attribution which had been justifying them is
gone. The correct classification for a workflow action is `WORKFLOW_REQUIRED`, which
`precedenceSweep.mjs:158` reads from the hand-kept `WORKFLOW_GRANTS` table at `:109-114` — and that
table is a record of Owner decisions. Adding two entries to it would be writing down a decision
nobody made, so this lane did not. `UNJUSTIFIED` went from 4 to 6; no test pins the total.

---

## 6. Verification — real output

```
functions: npm ci && npm run build                                     clean (tsc, no output)

node --test test/administrationObjectDrift.test.mjs                    15 tests, 15 pass, 0 fail
node --test test/administrationObjectDrift.test.mjs \
            test/semanticMappingGuards.test.mjs \
            test/workbookReconciliation.test.mjs \
            test/capabilityGraphDrift.test.mjs \
            test/ownerDecisionPrecedence.test.mjs \
            test/generalManagerNoAdmin.test.mjs \
            test/adminPolicySeedCoverage.test.mjs \
            test/adminPolicyReorderSeparation.test.mjs                 63 tests, 63 pass, 0 fail

node --test test/adminPolicySeed.test.mjs                              15 tests, 14 pass, 1 skipped
POLICY_TEST_DATABASE_URL=postgres://…@127.0.0.1:55457/eos \
  node --test --test-concurrency=1 test/adminPolicySeed.test.mjs       15 tests, 15 pass, 0 fail
node --test test/governedBusinessRoles.test.mjs                        1 test, 1 pass

field-ops-app-vite: node --test test/policyObjectRegistry.test.mjs \
    test/entityRegistry.test.mjs test/reorderAuthoritySeparation.test.mjs
                                                                       32 tests, 32 pass, 0 fail

node scripts/firebaseExitGuard.mjs                                     PASS
git diff --check                                                       clean
```

**Mutation-tested.** Every load-bearing assertion was confirmed to fail when its contract is broken,
by temporarily reverting the edit it guards:

| reintroduced | fails |
|---|---|
| `inventory.action.create` in `objectPermissionMap.js` | `no CRED table advertises a Create on Inventory Actions` |
| `reorder.request.postPurchasingUpdate` in `objectCapabilityMap.mjs` | `no workflow action is advertised as a CRED cell in the governance capability map` |
| `reorder.purchaseOrder.void` in `reconcileCrudMatrix.mjs` | `no workflow action appears in the reconciliation script's private matrix` |
| a fourth `rulesOnly` object, advertising a capability | `every rules-governed object advertises no capability on any verb`, `the rules-governed census is exactly the three objects on record`, `every rules-governed object is recorded as RULE_GOVERNED on the governance side too` |
| a `Reorder Requests` row added to `objectCapabilityMap.mjs` | `exactly one object Administration advertises is missing from the governance capability map` |

**Could not run here, stated rather than faked:**

* `functions/test/trustedWriterCommands.test.mjs` — requires live Firestore + Auth emulators. Port
  8080 is occupied by another worktree. Not run.
* Every other Firestore-emulator suite, for the same reason.
* `field-ops-app-vite` vitest suites (`.test.jsx`, including `objectAccessModel.test.jsx`) —
  `field-ops-app-vite/node_modules` is not installed in this worktree and installing it is a shared
  side effect ten concurrent lanes would race on. The three node:test suites that cover the same
  registries were run and pass.

**Pre-existing breakage:** none observed. `semanticMappingGuards` + `workbookReconciliation` were
11/11 before this branch's edits and 11/11 after.
