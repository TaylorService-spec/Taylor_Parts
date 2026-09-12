# Firestore Rules + browser direct-Firebase business-authority census

**Lane** P2-B2 (Taylor EOS overnight program, Wave 2). **Evidence only — nothing in this lane
changes behaviour, deploys, or contacts production.**

**Measured against** worktree `night/p2b2-rules-browser`, based on integrated head `d104cf49`
(all 32 Wave-1 lanes merged). `firestore.rules` = 1876 lines.

**The binding rule under audit.** Firestore Rules must never serve as authorization, permissions,
workflow, ownership, approval, routing, visibility, or business configuration. Authorization belongs
in governed EOS server commands backed by `eos_policy` capabilities. Rules may only be a last-line
deny fence.

**Verdict in one line.** Rules is not a deny fence today. It is the *only* authority for 9 business
collections' writes and for a 9-transition procurement workflow, and it is the *sole* live
enforcement for 4 object types (Accounts, Locations, Contacts, Equipment) that have no server
command in their path at all.

---

## 0. Two-copy drift answer

`firestore.rules` and `field-ops-app-vite/firestore.rules` are **byte-identical**
(`md5 e10bc046d30e337ef8e95f3d5f96ee0f`, 1876 lines each). Only the root copy is deployed —
`firebase.json` `firestore.rules` names it and there is no `field-ops-app-vite/firebase.json`.

The mirror is **not** dead-and-misleading: `functions/test/legacyAuthorizationSurface.test.mjs`
test **D4** asserts the two files are byte-identical, so drift fails CI. The duplicate is a
deliberately-gated mirror, not rot. No drift finding.

---

## 1. Prohibited predicates, by category

Categories: **AUTHZ** authorization · **PERM** permissions · **WF** workflow · **OWN** ownership ·
**APPR** approval · **ROUTE** routing · **VIS** visibility · **BIZCFG** business configuration.

### 1.1 The predicate helpers themselves (the root of everything below)

| file:line | helper | category | note |
|---|---|---|---|
| `firestore.rules:22` | `isAdminOrDispatcher()` | AUTHZ, PERM | reads `users/{uid}.role`; the legacy role field is the authorization root |
| `firestore.rules:32` | `isAdmin()` | AUTHZ, PERM | admin-only governed-field gate on `accounts` |
| `firestore.rules:36` | `isTechnician()` | AUTHZ | |
| `firestore.rules:40` | `isOwnTechnician(technicianId)` | OWN, VIS | |
| `firestore.rules:88` | `reciprocallyLinkedEmployee()` | AUTHZ, OWN | reciprocal `users`↔`employees` link |
| `firestore.rules:112` | `isActiveOperationalRole(role)` | AUTHZ, PERM, BIZCFG | encodes *employment status* + *operational-role membership* as a permission |
| `firestore.rules:139` | `isAssignedToWarehouse(warehouseId)` | ROUTE, VIS, OWN | per-warehouse assignment scoping |
| `firestore.rules:160` | `canSubmitManualZeroHistoryQuantity()` | PERM, BIZCFG | a *named business capability* implemented in the Rules DSL |
| `firestore.rules:222`, `:275` | `hasCanonicalReorderRequestKeys()` / `...CreationBaseline()` | BIZCFG | 35-key document contract + full initial-state vocabulary. **DORMANT** (`reorder_requests` create is `if false`) but still the file's most precise statement of a business object's shape |
| `firestore.rules:323` | `callerTechnicianId()` | OWN, VIS | |
| `firestore.rules:329` | `isValidJobTransition(from,to)` | **WF** | a state machine in Rules |
| `firestore.rules:343` | `isTechnicianJobTransition(from,to)` | **WF**, OWN | |
| `firestore.rules:346` | `isTechnicianStatus(s)` | BIZCFG | status vocabulary |
| `firestore.rules:349` | `jobStatusOnlyChange()` | WF | field-level transition allowlist |
| `firestore.rules:1290`,`:1294`,`:1298`,`:1306`,`:1314` | `accountPaymentTermsValid` / `accountTaxStatusValid` / `...FieldsValid` / `...FieldsUnchanged` / `...CreateBaseline` | BIZCFG, PERM | commercial-terms enum + a *who-may-edit-which-field* rule |
| `firestore.rules:1371`,`:1396` | `equipmentWritableKeys()` / `equipmentEditableKeys()` | BIZCFG | field-level create/edit allowlists |
| `firestore.rules:1403`,`:1419` | `equipmentStatusValid()` / `equipmentTransitionAllowed()` | BIZCFG, **WF** | equipment lifecycle state machine |
| `firestore.rules:1438` | `equipmentLocationBelongsToAccount()` | BIZCFG | cross-document referential business invariant |
| `firestore.rules:1449`,`:1481`,`:1488` | `equipmentOptionalFieldsValid` / `equipmentNameValid` / `equipmentCreateShapeValid` | BIZCFG | field typing + a 200-char business limit |

### 1.2 Per-collection prohibited predicates

**AUTHORIZATION / PERMISSIONS** — a role predicate standing in for a capability:

| file:line | collection | predicate |
|---|---|---|
| `:360` | `fieldops_jobs` | `isAdminOrDispatcher()` read |
| `:366`, `:381` | `fieldops_jobs` | `isAdminOrDispatcher()` create/update |
| `:401`, `:407`, `:418` | `fieldops_technicians` | `isAdminOrDispatcher()` read/create/update |
| `:491` | `employees` | `isAdminOrDispatcher()` directory read + `isActiveOperationalRole("PARTS_MANAGER")` candidate read |
| `:507` | `fieldops_wos` | `isAdminOrDispatcher() \|\| isTechnician()` read |
| `:531` | `inventory_transactions` | `isAdminOrDispatcher() \|\| isActiveOperationalRole("PARTS_MANAGER") \|\| ...("WAREHOUSE_MANAGER")` |
| `:648` | `reorder_requests` | 6-branch read gate mixing roles, status and ownership |
| `:1056` | `reorder_purchase_orders` | `isAdminOrDispatcher() \|\| isActiveOperationalRole("PARTS_ASSOCIATE")` |
| `:1101`, `:1108` | `reorder_purchase_order_voids` | role read + role create |
| `:1155`, `:1156` | `inventory_actions` | role read + role create |
| `:1177` | `warehouses` | role read |
| `:1200` | `transfer_orders` | role read |
| `:1230`, `:1235` | `mobile_locations`, `trucks` | role read |
| `:1256`, `:1261`, `:1266` | `suppliers`, `supplier_catalog`, `purchase_orders` | role read |
| `:1320`, `:1332`, `:1335` | `accounts` | role read/create/update, **plus an `isAdmin()` field-level permission** |
| `:1342`, `:1343` | `locations` | role read + role create/update |
| `:1506`, `:1508`, `:1542` | `equipment` | role read/create/update |
| `:1556`, `:1557` | `contacts` | role read + role create/update |
| **`:1632`** | **`parts`** | **`isAdminOrDispatcher() \|\| isActiveOperationalRole("PARTS_MANAGER") \|\| ...("WAREHOUSE_MANAGER")`** — LEAD VERIFIED. The Part Master read is gated by role predicates, not a capability. The block's own comment (`:1606-1609`) states the rule being broken: *"operational roles … represent work eligibility, NOT security permission, and must never grant access via raw role checks here"* — and then two lines later grants access via raw role checks. |

**WORKFLOW** — a state machine in Rules:

| file:line | collection | what |
|---|---|---|
| `:329-344` | `fieldops_jobs` | `isValidJobTransition` (`open→assigned→in_progress→complete`, `assigned→open`), `isTechnicianJobTransition` (`assigned→in_progress` only), `jobStatusOnlyChange` — **LEAD VERIFIED**. A client-writable lifecycle expressed entirely in Rules, on the compat representation. Canonical `fieldops_wos` is correctly `if false` at `:509`. |
| `:366-367` | `fieldops_jobs` | create must start `status=='open' && technicianId==null` — an initial-state business rule |
| `:381-393` | `fieldops_jobs` | `resource.data.status != 'complete'` terminality |
| `:407-408` | `fieldops_technicians` | create must start `status=='available'` |
| `:763-1001` | `reorder_requests` | **the whole procurement workflow**: 7 OR'd transition branches, each pinning a from-status, a to-status, an actor, a set of stamped fields and an `affectedKeys()` allowlist (Approve/Reject `:764-775`, Assign `:776-789`, Start Purchasing `:790-805`, Post Purchasing Update `:806-823`, Mark Received `:846-871`, Cancel `:894-919`, Void `:948-996`), then five shared field pins (`:997-1001`) that hold `partId`/`urgency`/`recommendedQty`/`requestedBy`/`createdAt` immutable across every branch |
| `:1419-1425` | `equipment` | `equipmentTransitionAllowed` — `ACTIVE↔INACTIVE`, `RETIRED` terminal |
| `:1542-1543` | `equipment` | `affectedKeys().hasOnly(equipmentEditableKeys())` edit allowlist |

**APPROVAL:**

| file:line | collection | what |
|---|---|---|
| `:764-775` | `reorder_requests` | the Approve/Reject decision itself: `reviewDecision == "APPROVED"` → `READY_FOR_PARTS_MANAGER`, or `"REJECTED"` with a mandatory non-empty `reviewNotes` (`:775`) |
| `:1335-1337` | `accounts` | `isAdmin()`-gated write of the two governed Commercial Profile fields — an approval-grade field permission |

**OWNERSHIP:**

| file:line | collection | what |
|---|---|---|
| `:363-364` | `fieldops_jobs` | `resource.data.technicianId == callerTechnicianId()` |
| `:386-387` | `fieldops_jobs` | same, on the technician start-work update |
| `:403-404` | `fieldops_technicians` | `techId == callerTechnicianId()` |
| `:508` | `fieldops_wos` | `isOwnTechnician(resource.data.assignedTechId)` |
| `:492` | `employees` | `userData().employeeId == employeeId` self-read |
| `:656`, `:661` | `reorder_requests` | `reviewedBy == request.auth.uid` / `assignedBy == request.auth.uid` (`:656`), `assignedToUserId == request.auth.uid` (`:661`) |
| `:793`, `:809`, `:849`, `:951` | `reorder_requests` | `request.auth.uid == resource.data.assignedToUserId` — assignee-only transitions |
| `:1103`, `:1109` | `reorder_purchase_order_voids` | assignee binding via a cross-collection `get()` |

**ROUTING:**

| file:line | collection | what |
|---|---|---|
| `:776-789` | `reorder_requests` | Assign writes `currentOwner == "PARTS_ASSOCIATE"` (`:779`), `assignedToUserId` (`:780-781`) and `assignedBy == request.auth.uid` (`:782`) — Rules decides who the work goes to next |
| `:766-768` | `reorder_requests` | Approve routes `currentOwner` to `"PARTS_MANAGER"` |
| `:1177`, `:1200-1202` | `warehouses`, `transfer_orders` | `isAssignedToWarehouse(...)` routes reads by warehouse assignment |

**VISIBILITY:**

| file:line | collection | what |
|---|---|---|
| `:363`, `:401-404` | `fieldops_jobs`, `fieldops_technicians` | **LEAD VERIFIED** — `callerTechnicianId()` expresses *who may see whose work* |
| `:648-661` | `reorder_requests` | a 6-branch, **status-conditioned** read gate: a PARTS_MANAGER sees a request only while it is in `READY_FOR_PARTS_MANAGER` / `ASSIGNED_TO_PARTS_ASSOCIATE` / `PURCHASING_IN_PROGRESS`, or if they personally reviewed/assigned it. Visibility is a function of workflow state. |
| `:491-496` | `employees` | three distinct visibility populations (directory / self / PARTS_ASSOCIATE-candidate) |
| `:1155` | `inventory_actions` | WAREHOUSE_MANAGER read branch |
| `:1201-1202` | `transfer_orders` | from/to-warehouse visibility |

**BUSINESS CONFIGURATION:** see §5.

---

## 2. Every collection with a live client write path

A "live client write path" = an `allow create` / `update` / `delete` that is not `if false`.
**Nine collections.** Every one of them is a business write.

| # | collection | live writes | rule lines | business write? | client writer in the app |
|---|---|---|---|---|---|
| 1 | `fieldops_jobs` | create, update | `:366`, `:381` | **YES** — job lifecycle | `domain/jobActions.js` `createJob` / `updateJobStatus` / `assignJob` |
| 2 | `fieldops_technicians` | create, update | `:407`, `:418` | **YES** — the **only reference entity a browser may mutate** | `domain/jobActions.js:41` `createTechnician`, called from `modules/technicians/Technicians.jsx:58`; also mutated inside `assignJob`'s transaction |
| 3 | `reorder_requests` | update (create is `if false`) | `:763` | **YES** — 7 procurement transitions | `domain/inventoryReorderRequests.js` `reviewReorderRequest` `:198`, `assignReorderRequest` `:227`, `startPurchasing` `:251`, `updatePurchasingProgress` `:271`, `receiveReorderRequest` `:296`, `cancelReorderRequest` `:337` |
| 4 | `reorder_purchase_order_voids` | create | `:1108` | **YES** — voids a purchase order | `domain/reorderPurchaseOrders.js:176` `voidPurchaseOrder` (`runTransaction`) |
| 5 | `inventory_actions` | create | **`:1156`** | **YES** — attributable inventory history | **NONE.** `domain/inventoryActions.js` `recordInventoryAction()` is retired and throws; the store handle was deleted. **LEAD VERIFIED: the Rules line is the only remaining way to create a document in this collection.** No field validation whatsoever, and no `createdBy == request.auth.uid` binding — yet `createdBy` is a declared field (`metadata/definitions/inventoryAction.js:178`) rendered as attributable history by **two** panels: `modules/inventory/PartDetail.jsx:1229` and `modules/inventoryRole/WarehouseManagerHome.jsx:90`. Any admin/dispatcher can forge an entry attributed to anyone. |
| 6 | `accounts` | create, update | `:1332`, `:1335` | **YES** — customer master + commercial terms | `domain/accounts.js:78/:82` via `accountsStore` |
| 7 | `locations` | create, update | `:1343` | **YES** — customer location master | `domain/locations.js:18/:22` |
| 8 | `equipment` | create, update | `:1508`, `:1542` | **YES** — installed-base master | `domain/equipmentRepository.js:23/:27` |
| 9 | `contacts` | create, update | `:1557` | **YES** — contact master | `domain/contacts.js:28/:40`, **plus a bulk `writeBatch`** at `domain/contactImport.js` (CSV import, up to `MAX_IMPORT_ROWS` contacts in one atomic client batch, stamping a **client-supplied** `createdBy` from `auth.currentUser?.uid`) |

Every other match block is `if false` on all three write verbs, or fully closed. `reorder_purchase_orders`
create was retired to `recordReorderPurchaseOrder` (`:1078` now `if false`) — the one genuine convergence
win in the file.

**Delete is closed everywhere.** No collection permits a client delete — and that matters more than
it looks: `makeCollectionStore` exposes a live `.remove()` → `safeDeleteDoc` handle on all seven of
its collections, and `.remove()` has **no call site anywhere in the app**. The only thing standing
between that handle and a delete is `allow delete: if false`. Same for `.list()`, an unfiltered
whole-collection enumerate, also uncalled.

**Rules-permitted client-writable collections: 9. Collections an app writer actually reaches: 8** —
`inventory_actions` is the difference (§6 #4).

---

## 3. Browser direct-Firestore authoritative business reads

An **authoritative** read is one whose value decides something: it gates an action, computes a
business quantity, establishes identity/permission, or is read-then-written back. A **display-only**
read is rendered and nothing more.

### 3.0 The access layers

| layer | file | what it is |
|---|---|---|
| SDK singleton | `field-ops-app-vite/src/firebase/firebase.js:36` | `export const db = getFirestore(app)` — every access below resolves through this handle |
| write gate | `field-ops-app-vite/src/lib/firebaseSafe.js:10,18,26,34` | `safeAddDoc` / `safeSetDoc` / `safeUpdateDoc` / `safeDeleteDoc`. A demo/panic **environment kill switch**, not an authorization gate. **Reads are entirely ungated.** `safeSetDoc` has zero call sites. |
| collection store | `field-ops-app-vite/src/firebase/collectionStore.js:53` | `makeCollectionStore(name)` → `.list()` `:65`, `.add()` `:88`, `.update()` `:93`, `.remove()` `:98` |
| generic realtime hook | `field-ops-app-vite/src/hooks/useFirestoreCollection.js:29-33` | `onSnapshot(collection(db, path))` — an **unfiltered whole-collection listener**; every call site passes `fieldops_technicians` |
| metadata list runtime | `field-ops-app-vite/src/metadata/firestoreListSource.js:73` | descriptor-driven `getDocs(query(collection(db, descriptor.collection), …))` for every `readVia: "CLIENT_DIRECT"` entity |
| list count | `field-ops-app-vite/src/hooks/useListViewChrome.js:99-107` | `getCountFromServer` over `entity.collection` |

**Seven `makeCollectionStore` handles**, each a live client-direct-writable capability:
`jobsStore` (`collectionStore.js:103`, `fieldops_jobs`), `techniciansStore` (`:104`,
`fieldops_technicians`), `accountsStore` (`domain/accounts.js:53`), `locationsStore`
(`domain/locations.js:16`), `contactsStore` (`domain/contacts.js:12`), `reorderRequestsStore`
(`domain/inventoryReorderRequests.js:56`), `equipmentStore` (`domain/equipmentRepository.js:21`).
`.list()` and `.remove()` have **no call sites anywhere** — two live-but-unused enumeration and
deletion capabilities on seven business collections. (`.remove()` is harmless today only because
Rules denies delete everywhere; it is exactly the kind of latent handle §6 is about.)

**Entities routed to the generic metadata list runtime** (`readVia: "CLIENT_DIRECT"`):
`accounts`, `contacts`, `locations`, `employees`, `equipment`, `parts`, `inventory_actions`,
`inventory_transactions`, `reorder_requests`, `reorder_purchase_orders`,
`reorder_purchase_order_voids`, `purchase_orders`, `supplier_catalog`, `suppliers`, `warehouses`,
`transfer_orders`, `trucks`, `mobile_locations`, `stock_locations`, `fieldops_wos` — **20
collections reachable by an arbitrary descriptor-driven query and a `getCountFromServer`
aggregate from the browser.** Only `firestore.rules` decides which of those descriptors resolve.

### 3.1 Authoritative — identity and permission (the highest grade)

| file:line | collection | why authoritative |
|---|---|---|
| `auth/employeeSession.js:50` | `users/{uid}` | reads `role` (`:52`) and `employeeId` (`:53`); `auth/AuthContext.jsx:94` does `setRole(session.role); setEmployeeId(session.employeeId);`. **This is the browser deriving its own authorization**, from the same `users/{uid}.role` field `firestore.rules`' `userData().role` reads. |
| `auth/employeeSession.js:68` | `employees/{employeeId}` | self-read supplying `operationalRoles` + `employmentStatus` (`:76`) — the same two fields `isActiveOperationalRole()` evaluates |
| `access/useGovernedCapabilities.js:33`, `useReportCapabilities.js:40`, `useOpportunityCapabilities.js:32`, `useSalesOrderCapabilities.js:30`, `useEquipmentInstallCapability.js:32`, `useSerializedAssetAcquireCapability.js:34`, `useWorkOrderPartsPlanCapability.js:29`, `metadata/definitions/accountPageComponents.js:665` | `users/{uid}.accessVersion` | **The one pattern this codebase gets right.** The direct read supplies only a freshness token; the grant comes from the trusted `resolveEffectiveAccessCallable` feed and is fail-closed until the resolved version matches the observed one (`accountPageComponents.js:681-684`). Consumed e.g. at `modules/equipment/AvailableEquipment.jsx:97`, which decides whether the Install action renders. **This is the template the other 8 collections should follow.** |
| `hooks/useCurrentTechnician.js:66` | `users/{uid}.technicianId` | the scope key for `services/workOrderService.ts:126` `subscribeAssignedWorkOrders` |
| `hooks/useCurrentTechnician.js:98` | `fieldops_technicians/{id}` | the technician's own operational record |
| `domain/employees.js:16,24-35` via `hooks/useAssignableEmployees.js:72` | `employees` (filtered `employmentStatus=="ACTIVE"`, `operationalRoles array-contains`, `userId != null`) | produces the **assignment candidate set**, then applies a *further client-side eligibility filter* (`useAssignableEmployees.js:81` `applyPartsAssociateSecurityRoleEligibility`). The selection becomes a write: `modules/inventory/PartDetail.jsx:412` `assignReorderRequest(request.id, { assignedToUserId })`. |
| `domain/employees.js:51` via `hooks/useEmployeeDirectory.js:44` | `employees` (**unfiltered whole-directory listener**) | classified display-only (uid→name), but it is an unfiltered read of the workforce directory whose only bound is `firestore.rules:491` |

### 3.2 Authoritative — read-then-write (the read is an input to a business write)

| file:line | collection | why |
|---|---|---|
| `domain/jobActions.js:55` → `:77`,`:80` | `fieldops_jobs`, `fieldops_technicians` | `runTransaction` reads job + technician, decides via `canTransitionJob()` (`:67`) and `techSnap.data().status !== TECH_STATUS.AVAILABLE` (`:96`), then writes both |
| `domain/jobActions.js:106` → `:116`,`:121` | same | `assignJob` |
| `domain/inventoryReorderRequests.js:350` → `:361` | `reorder_requests` | reads status, checks `isCancellableReorderRequestStatus` (`:357`), writes `CANCELLED` |
| `domain/reorderPurchaseOrders.js:191` → `:225`,`:234` | `reorder_purchase_order_voids`, `reorder_requests` | reads the request + PO, then writes the void record and the VOIDED transition |
| `domain/contactImport.js:35,38,40,55` | `contacts` | bulk `writeBatch` create with client-asserted provenance |
| `hooks/useEquipment.js:166` (`useEquipmentDoc`) | `equipment` | `modules/equipment/EquipmentDetail.jsx:89-90` passes the read document straight back as the optimistic-concurrency baseline: `updateEquipment(equipmentId, changed, { before })` |
| `hooks/useAccountPicker.js:38-40` | `accounts` | the picked customer is submitted on install (`AvailableEquipment.jsx:101`) |
| `hooks/useLocationsForAccount.js:60-61` | `locations` | `modules/equipment/EquipmentRegister.jsx:103` `createEquipment({ ...values, accountId }, { location })` |
| `services/truckRegistryQueries.js:41` | `trucks` | supplies `expectedVersion` for optimistic concurrency on every truck command (`truckRegistryCommandClient.js:55-65`) |
| `services/truckRegistryCommandClient.js:72` | `warehouses` | home-warehouse pick list; the file states the trusted service re-checks it (`:67-70`) — the correct posture |

### 3.3 Authoritative — computed business quantities

| file:line | collection | computed value |
|---|---|---|
| `analytics/executionAnalyticsService.ts:218` | `fieldops_wos` — **unbounded whole-collection `getDocs`** | `entry.totalQuantityUsed += quantity` (`:224`), `mostConsumedPartId` (`:236`). **The file's own comment (`:246-250`) says it relies on the "same ADMIN/DISPATCHER-ONLY read-access restriction" — i.e. it names Rules as its access control.** |
| `analytics/executionAnalyticsService.ts:251` | `fieldops_wos` — **unbounded whole-collection `getDocs`** | per-technician `activeCount` / `completedCount` (`:261-263`) |
| `analytics/executionAnalyticsService.ts:89`,`:137` | `fieldops_wos` | `totalPartsUsed` (`:99`), `totalWorkOrdersCompleted` / `totalPartsConsumed` / `averageCompletionTimeMs` (`:141-146`) |
| `services/operationsQueries.ts:84-86` `listCollection()` → `fetchInventoryTransactions` (`:172`) | `inventory_transactions` — **unbounded whole-collection `getDocs`** | the module's own comment (`:110-113`): the Operations dashboard *"NETS these into availableStock, reconciliation positions and consumption totals"*. **This is the stock ledger, netted client-side.** |
| `services/operationsQueries.ts` → `fetchWarehouses` (`:173`), `fetchSupplierCatalog` (`:176`) | `warehouses`, `supplier_catalog` | dashboard positions and procurement pricing |
| `services/operationsQueries.ts:236-237`,`:245-247` | `reorder_requests` (`status in [ORDERED,RECEIVED,VOIDED]`), `reorder_purchase_orders` | `buildPurchaseOrdersView` (`:255`) → `isReceiptCandidate` / `receiptSource` (`:231-232`) — a **receipt-eligibility decision** |
| `hooks/usePartWorkOrderDemand.js:57`,`:60` | `fieldops_wos` (open statuses, `limit(300)`) + `getCountFromServer` | **part demand** — the quantity a reorder is argued from — plus an honest `scannedCount` / `totalOpenWorkOrders` disclosure (`:68`,`:71`) |
| `domain/accountWorkOrders.js:58-59` | `fieldops_wos` `getCountFromServer` | the Open Work Orders KPI (`domain/accountHealthStrip.js:10`) |
| `domain/accountWorkOrders.js:130-132` | `fieldops_wos` (`status=="SCHEDULED"`, `limit(200)`) | the **PAST_DUE** business signal (`domain/workOrderAttentionProjection.js`) |
| `services/workOrderService.ts:93` | `fieldops_wos` — **unfiltered whole-collection listener** | Control Tower + `domain/technicianRecommendationEngine.ts:6`, a computed recommendation |
| `services/workOrderService.ts:126-127` | `fieldops_wos` (`assignedTechId ==`, `limit(100)`) | the technician's entire work list, and which transitions are offered |
| `hooks/useWorkOrder.js:44-45` | `fieldops_wos` (doc) | `status` selects the legal transition actions rendered |
| `hooks/useFirestoreCollection.js:29-33` (10 call sites) | `fieldops_technicians` — **unfiltered whole-collection listener** | feeds `technicianRecommendationEngine` and `assignJob` |
| `services/partMasterQueries.js:53` | `parts` — **whole collection** | the Part Master catalogue. Header `:29-40` names the decision-bearing consumers: `modules/scan/LookupScan` (*"a scanner that cannot find part 51 reports the part does not exist"*), `receiving/ReceiveAgainstPurchaseOrder`, `workOrders/WorkOrderPartsPlanEditor` — part pickers feeding governed writes. |
| `hooks/useSerialTrackedParts.js:62-64` | `parts` (`controlType ==`, `limit(500)`) | header `:1-6`: *"the list IS the input to a governed write"* (`AcquireExistingUnit.jsx:125`) |
| `hooks/useWholeUnitParts.js:40` | `parts` (`wholeUnit == true`) | `countAvailableByLine` — a computed **availability** quantity (`AvailableEquipment.jsx:92-94`) |
| `hooks/useReorderRequests.js:38,80,120,181,208,259,432` | `reorder_requests` | the `status` / `assignedToUserId` / `reviewDecision` read here is exactly what selects each workflow action button — every one of which is a client write (`PartDetail.jsx:227,263,295,412,487,568,921`) |
| `hooks/useReorderPurchaseOrders.js:34-35`, `hooks/usePurchaseOrdersByIds.js:49-50`, `hooks/useReorderPurchaseOrderVoids.js:32-33` | `reorder_purchase_orders`, `reorder_purchase_order_voids` | PO existence/status gates Void and Mark Received |
| `hooks/useInventoryActions.js:28` | `inventory_actions` | renders `createdBy` / `createdAt` / `quantityDelta` as an attributable record a human acts on (see §6 #4) |

### 3.4 Display-only (representative)

`hooks/useAccountNames.js:83`, `hooks/useLocationReferenceResolver.js:83`,
`hooks/useAccountReferenceResolver.js`, `services/truckRegistryQueries.js:35,57`,
`hooks/useAccountSearch.js:42`, `hooks/useWorkOrderSearch.js:40`, `hooks/useAccount.js:64`,
`hooks/useLocation.js:41`, `hooks/useContactsForAccount.js:39`, `hooks/useEquipment.js:41,79`,
`hooks/useInstalledEquipmentPage.js:51,66`, `modules/operations/Operations.jsx:98`,
`services/operationsQueries.ts` `fetchTransferOrders`/`fetchSuppliers`/`fetchPurchaseOrders`/
`fetchReorderRequests`/`fetchReorderPurchaseOrders` (`:174,175,177,190,191` — the last two are a
shadow-parity diagnostic), `metadata/firestoreListSource.js:73` list rendering,
`hooks/useListViewChrome.js:99` row-count badges.

### 3.5 Authorization decided in the browser

These are business authorizations evaluated client-side from client-read documents. Each has a Rules
counterpart; **none has a server counterpart**:

* `domain/reorderPurchaseOrders.js:218` — `if (reorderRequest.assignedToUserId !== (auth.currentUser?.uid ?? null)) throw new Error("Only the assigned Parts Associate can void this Purchase Order.")`. An **ownership gate in the browser**, mirroring `firestore.rules:951` (and `:1109`).
* `domain/jobActions.js:67`,`:96` — transition legality and technician availability, mirroring `firestore.rules:329-344`.
* `domain/inventoryReorderRequests.js:357` — cancellable-status check, mirroring `firestore.rules:894-897`.
* `hooks/useAssignableEmployees.js:52-57,81` — `role !== ROLES.TECHNICIAN` eligibility filtering over the `employees` snapshot.
* `domain/jobActions.js:44,88` — `if (!auth.currentUser) throw new Error("Unauthenticated write attempt blocked")`.

### 3.6 Client-supplied provenance

`auth.currentUser?.uid` is stamped **by the browser** into: `domain/contacts.js:30,44` and
`domain/contactImport.js:34` (`createdBy`/`updatedBy`); `domain/inventoryReorderRequests.js:213,238,254,278,299,362`
(`reviewedBy`, `assignedBy`, `purchasingStartedBy`, `lastPurchasingUpdateBy`, `receivedBy`,
`cancelledBy`); `domain/reorderPurchaseOrders.js:223,231` (`voidedBy`). `contactImport.js:24-27` says
so outright: *"CLIENT-SUPPLIED CLAIMS, not server-authoritative provenance."*

Rules pins most of these to `request.auth.uid` (e.g. `:782`, `:794`, `:810`, `:850`, `:899`, `:952`, `:1121`)
— **so for the reorder collections, Firestore Rules is the only thing making the audit trail true.**
The exception is `contacts`, where Rules validates nothing at all, and `inventory_actions`, where
Rules validates nothing at all (§6 #4 and #6).

## 4. Rules ↔ `permissionCatalog.ts`: duplicated names and disagreements

### 4.1 Names that appear in both

| name | in `firestore.rules` | in the governed layer |
|---|---|---|
| `admin`, `dispatcher`, `technician` | `userRole()` string comparisons (`:23`, `:33`, `:37`) | `compatibilityRoles.ts` `ADMIN_ROLE` (`:245`), `DISPATCHER_ROLE` (`:264`), technician role |
| `PARTS_MANAGER`, `PARTS_ASSOCIATE`, `WAREHOUSE_MANAGER` | `isActiveOperationalRole("…")` literals | `employeeProfileCommands.ts:131-140` `OPERATIONAL_ROLE_VALUES` |
| `"ACTIVE"` employment | `:117`, `:145` | `employeeProfileCommands.ts` `EMPLOYMENT_STATUS_VALUES` |
| reorder statuses | `:764-996` | `adminPolicy/workflowSeeds.ts:120-121`, `reorderCommands.ts:197` |
| `paymentTerms` / `taxStatus` enums | `:1292`, `:1296` | `field-ops-app-vite/src/domain/constants.js` `PAYMENT_TERMS` / `TAX_STATUS` — **the Rules comment at `:1285-1288` admits the duplication: "there is no shared source between JS and the Rules DSL; keep them in sync."** |

### 4.2 Where they disagree — Rules is the real authority for that path

| # | disagreement | evidence |
|---|---|---|
| **D-a** | **Operational-role vocabulary is 8 values server-side, 3 in Rules.** `OPERATIONAL_ROLE_VALUES` = `PARTS_MANAGER, PARTS_ASSOCIATE, TECHNICIAN, WAREHOUSE_MANAGER, WAREHOUSE_ASSOCIATE, SERVICE_MANAGER, SALES_MANAGER, SALES_ASSOCIATE`. Rules recognises only the first, second and fourth. The other five grant nothing, anywhere, because Rules is what is actually evaluated. | `functions/src/access/employeeProfileCommands.ts:131-140` vs `firestore.rules` (`isActiveOperationalRole` literals) |
| **D-b** | **Role-key casing disagrees between the two workflow definitions.** The Admin workflow seed names roles `"partsManager"` / `"partsAssociate"` (camelCase Role ids); Rules matches `"PARTS_MANAGER"` / `"PARTS_ASSOCIATE"` (Employee `operationalRoles` values). They are different namespaces describing the same transition. | `functions/src/adminPolicy/workflowSeeds.ts:130-144` vs `firestore.rules:778`, `:792` |
| **D-c** | **Nine reorder capabilities are registered but nothing enforces them.** `reorder.request.approve / .reject / .assign / .startPurchasing / .postPurchasingUpdate / .markReceived / .cancel`, `reorder.purchaseOrder.void` exist in the catalog. `functions/src/reorderRequest/reorderCallables.ts` exports exactly **three** callables: `createReorderRequest`, `recordReorderPurchaseOrder`, `listReorderWarehouseOptions`. Every other transition is a client-direct `reorderRequestsStore.update()` authorized only by `firestore.rules:763`. | `permissionCatalog.ts:475-537` vs `reorderCallables.ts:211/311/410` vs `domain/inventoryReorderRequests.js:198-350` |
| **D-d** | **`inventory.action.create` is registered and describes a path the product has retired.** Its description reads *"Create an inventory_actions record — admin/dispatcher only today."* The only creator is `firestore.rules:1156`. | `permissionCatalog.ts:578` vs `domain/inventoryActions.js` (throws) |
| **D-e** | **Four object types have no capability at all on the write verbs.** `locations`, `contacts`, `equipment`, `fieldops_jobs`, `fieldops_technicians`, `parts`, `warehouses`, `transfer_orders`, `mobile_locations`, `trucks`, `suppliers`, `supplier_catalog`, `purchase_orders`, `employees` are all recorded with `permissions: []` in the legacy-surface corpus — an explicit, self-declared coverage gap. For the four *writable* ones this means Rules is the entire authorization model. | `functions/src/access/legacyAuthorizationSurface.ts` (per-entry `permissions: []`) |
| **D-f** | **`customer.record.create` / `.update` / `.governedField.write` exist but nothing in the browser calls a server command for them.** There is no `createAccount` / `updateAccount` callable in `functions/src/index.ts`; the only server-side account creation is `accountImportCommand.ts` (data-import only) and `crm/customerRepository.ts` (inbound-work only). The everyday Create/Edit Customer path is client-direct. | `permissionCatalog.ts:67-92` vs `functions/src/index.ts` vs `domain/accounts.js:78` |
| **D-g** | **Administration's `rulesOnly` census is 3, the governance map's is 5, and the seed carries neither.** Client `objectPermissionMap.js` marks **3** objects `rulesOnly` (Contacts `:36`, Customer Locations `:37`, Equipment/Installed Base `:92`). Server `RULE_GOVERNED_OBJECTS` lists **5** — those three plus `Notifications` and `Technician Time / Non-work`. `scripts/buildAdminPolicySeedSnapshot.mjs:59-70` copies no `rulesOnly` key, and **`grep -rn rulesOnly --include=*.json` returns nothing** — in the tenant policy store a Rules-governed object is indistinguishable from an unmodelled one (both are four empty verb lists). **CORRECTION TO THE LEAD:** the lead said "Administration carries 5 objects as `rulesOnly`". It carries **3**; **5** is the server `RULE_GOVERNED_OBJECTS` count. The seed-drop half of the lead is confirmed exactly. | `field-ops-app-vite/src/access/objectPermissionMap.js:36,37,92`; `functions/scripts/governance/objectCapabilityMap.mjs:31-35`; `scripts/buildAdminPolicySeedSnapshot.mjs:59-70` |
| **D-h** | **The convergence gate under-counts the Rules surface by ~63%.** `legacyAuthorizationSurface.ts` tracks only `LEGACY_ROLE_HELPERS = [isAdminOrDispatcher, isAdmin, isTechnician]` — **43** enforced call sites, which I re-derived independently and which matches the corpus entries exactly. It tracks **none** of `isActiveOperationalRole` (16 enforced sites), `isAssignedToWarehouse` (3), `callerTechnicianId` (6), `isOwnTechnician` (1) — **26 further authorization sites**, total real surface **69**. The gate can therefore reach zero while every operational-role, warehouse-scope and own-technician authorization decision remains in Rules. | my parse of `firestore.rules` vs `legacyAuthorizationSurface.ts` + `functions/test/legacyAuthorizationSurface.test.mjs` D3 |
| **D-i** *(minor, prose only)* | The corpus header comment says the surface shrank "47 → **44**". The entries sum to **43**, and the D3 test compares corpus-total to parsed-total rather than to a literal, so nothing is broken — but the written number is off by one. | `legacyAuthorizationSurface.ts:63-74` vs the entry data |
| **D-j** | **The server shares the same legacy root.** `functions/src/callerContext.ts:19` resolves the caller's role from `users/{uid}.role` — the identical field `userData().role` reads. Where a Function does authorize, it is often authorizing off the same legacy field Rules does, so "move it to the server" does not by itself move it to a capability. | `functions/src/callerContext.ts:11-19` |

---

## 5. Business values encoded in Rules

Quoted verbatim.

**Commercial terms** (`:1292`, `:1296`):
```
data.get('paymentTerms', null) in ['COD', 'NET_30', 'NET_60', 'NET_90']
data.get('taxStatus', null) in ['UNKNOWN', 'TAXABLE', 'EXEMPT', 'RESELLER']
```
Rules also encodes the *default*: `accountGovernedCreateBaseline` (`:1314-1317`) treats absent
`taxStatus` as equivalent to `'UNKNOWN'`, and a dispatcher may create only at that baseline.

**Equipment lifecycle** (`:1404`, `:1422-1424`):
```
status == "ACTIVE" || status == "INACTIVE" || status == "RETIRED"
(after == before || (before == "ACTIVE" && after == "INACTIVE") || (before == "INACTIVE" && after == "ACTIVE"))
```

**Equipment field policy** (`:1372-1377`, `:1397-1400`, `:1485`):
```
["accountId","locationId","name","status","manufacturer","model","serialNumber","assetTag",
 "installedDate","warrantyExpiresDate","notes","createdAt","updatedAt"]
["name","manufacturer","model","serialNumber","assetTag","installedDate","warrantyExpiresDate","notes","status","updatedAt"]
name.size() <= 200
```
A **200-character business limit on an equipment name** lives in the deny fence.

**Equipment referential invariant** (`:1441-1442`):
```
get(/databases/$(database)/documents/locations/$(data.locationId)).data.accountId == data.accountId
```

**Job lifecycle** (`:330-333`, `:344`):
```
(from == 'open' && to == 'assigned') || (from == 'assigned' && (to == 'in_progress' || to == 'open'))
  || (from == 'in_progress' && to == 'complete')
from == 'assigned' && to == 'in_progress'
```

**Technician status vocabulary** (`:347`):
```
s in ['available', 'on_job', 'off_shift']
```

**Reorder-request status vocabulary** (scattered through `:650-996`): `PENDING_REVIEW`,
`READY_FOR_PARTS_MANAGER`, `ASSIGNED_TO_PARTS_ASSOCIATE`, `PURCHASING_IN_PROGRESS`, `ORDERED`,
`RECEIVED`, `REJECTED`, `CANCELLED`, `VOIDED`. Review decisions `APPROVED` / `REJECTED`.
Owner vocabulary `INVENTORY` (`:277`) / `PARTS_MANAGER` (`:766`) / `PARTS_ASSOCIATE` (`:780`).

**Mandatory-narrative business rules:**
```
:775   request.resource.data.reviewNotes is string && request.resource.data.reviewNotes.size() > 0   // rejection requires a reason
:902   request.resource.data.cancellationReason.matches('.*\\S.*')                                    // cancellation requires a non-blank reason
:955   request.resource.data.voidReason.matches('.*\\S.*')                                            // a void requires a non-blank reason
:1122  request.resource.data.reason is string && request.resource.data.reason.matches('.*\\S.*')
```

**The 35-key Reorder Request document contract** (`:222-266`) and its full 30-field initial-state
baseline (`:275-311`) — the most detailed business-object definition in the repository, sitting in a
Rules file. **DORMANT** (`allow create: if false` at `:706`), by the file's own admission at `:169-180`.

**Employment gate** (`:117`, `:145`): `employee.employmentStatus == "ACTIVE"`. The governed
vocabulary has five values (`ACTIVE, INACTIVE, TERMINATED, RETIRED, CONTRACTOR`); Rules denies four
of them every operational grant, including `CONTRACTOR`. That is a *staffing policy decision*
expressed as a rules literal.

**Not found:** no dollar limit, no numeric business threshold, no hardcoded company/tenant id.
`operatingCompanyId` is referenced only in field-name lists (`:254`) and commentary (`:698`, `:1067`),
never compared to a literal. The only numeric literals in the whole file are `size() > 0` and
`size() <= 200`.

---

## 6. TOP 10 BY RETIREMENT RISK

*"If `firestore.rules` were deleted tomorrow (replaced by `allow read, write: if request.auth != null`),
which business write silently opens because nothing server-side checks it?"* Ranked by blast radius ×
absence of a server check. **The missing server check is named in every row.**

---

**#1 — `reorder_requests`: seven procurement workflow transitions, no server command.**
`firestore.rules:763-1001` is the **entire** enforcement of Approve, Reject, Assign, Start Purchasing,
Post Purchasing Update, Mark Received, Cancel and Void. It pins the from-status, the to-status, the
actor identity, the stamped-by/stamped-at fields and an `affectedKeys()` allowlist on each.
**Missing server check:** there is no `approveReorderRequest`, `rejectReorderRequest`,
`assignReorderRequest`, `startPurchasing`, `postPurchasingUpdate`, `markReorderRequestReceived`,
`cancelReorderRequest` or `voidReorderPurchaseOrder` callable. `functions/src/reorderRequest/reorderCallables.ts`
exports exactly `createReorderRequest`, `recordReorderPurchaseOrder`, `listReorderWarehouseOptions`.
The capability ids `reorder.request.approve/.reject/.assign/.startPurchasing/.postPurchasingUpdate/.markReceived/.cancel`
and `reorder.purchaseOrder.void` are registered in `permissionCatalog.ts` and resolved by nothing.
**On deletion:** any authenticated user can drive any reorder request to any status, forge
`reviewedBy`/`assignedBy`/`receivedBy`, skip approval entirely, or self-assign and self-receive. No
server code would notice.

**#2 — `equipment`: create and update with a full validation and lifecycle contract, no server command.**
`firestore.rules:1508-1547` is the sole enforcement of the create shape (13-key allowlist, mandatory
`status == "ACTIVE"`, name validity, 200-char limit), the edit allowlist, the `ACTIVE↔INACTIVE`
transition graph, and the cross-document invariant that the equipment's `locationId` belongs to its
`accountId`.
**Missing server check:** no equipment create/update callable exists. `functions/src/index.ts` exports
none; `createEquipmentFromImport` (`dataImport/firestoreDataImportAdapters.ts:43`) covers the bulk
import path only. There is no `equipment.record.create`/`.update` capability in `permissionCatalog.ts`
at all — only `equipment.install`, `equipment.model.manage` and `equipment.compatibility.*`.
**On deletion:** any authenticated user creates installed-base assets with arbitrary keys, arbitrary
status (including `RETIRED` at birth), a name of any length, and a `locationId` belonging to a
different customer. The referential invariant has no second home.

**#3 — `accounts`: the Commercial Profile field permission, no server writer.**
`firestore.rules:1332-1337` is the only place that says a **dispatcher may not set `paymentTerms`,
and may not move `taxStatus` off `UNKNOWN`** — `isAdmin() || accountGovernedFieldsUnchanged()`. The
rule's own comment (`:1329-1331`) says *"Enforced HERE, in Rules, never by UI hiding. INTERIM path:
PR 3b converts this to the trusted audited server-side writer"* — **PR 3b has not landed in this
tree.**
**Missing server check:** no `updateAccount` / `setAccountCommercialProfile` callable. The capability
`customer.governedField.write` (`permissionCatalog.ts:85`) is registered and enforced nowhere.
`domain/accounts.js:82` writes the document directly.
**On deletion:** any authenticated user sets `NET_90` terms and `EXEMPT` tax status on any customer.
This is the single highest-value *field* in the census: it directly determines invoicing and tax.

**#4 — `inventory_actions`: a forgeable attributable-history record with zero field validation.**
`firestore.rules:1156` — `allow create: if isAdminOrDispatcher();` — with no `keys()` check, no type
check, and **no `createdBy == request.auth.uid` binding**, on a collection two panels render as an
attributable ledger (`PartDetail.jsx:1229`, `WarehouseManagerHome.jsx:90`, fields `createdBy`,
`createdAt`, `quantityDelta`, `transactionType`, `reason`).
**Missing server check:** none exists and none is planned — `domain/inventoryActions.js` retired the
writer and throws. `inventory.action.create` is a registered capability with no enforcement point.
**On deletion:** any authenticated user writes inventory-movement history attributed to any other
person, with any quantity, on any part. *Today, even with Rules intact, an admin or dispatcher can
already do exactly that* — this is the one entry that is a live exposure, not only a retirement risk.

**#5 — `fieldops_technicians`: the only client-mutable reference entity.**
`firestore.rules:407-419` — create gated on `status == 'available'`, update gated on
`isAdminOrDispatcher() && isTechnicianStatus(...)`. **LEAD VERIFIED.** Written from
`domain/jobActions.js:41` (`createTechnician`, via `modules/technicians/Technicians.jsx:58`) and
mutated inside `assignJob`'s transaction.
**Missing server check:** no technician-record callable exists; `permissions: []` in the legacy
corpus. `completeAssignedJob.ts` is Admin-SDK and writes `status: available` on completion, but it
authorizes *its own* write only — it validates nothing about a direct client write.
**On deletion:** any authenticated user creates a technician record or flips any technician's status,
corrupting dispatch availability for everyone. A reference entity is exactly what must never be
client-writable.

**#6 — `contacts`: single write *and a bulk batch*, no server command.**
`firestore.rules:1557` — `allow create, update: if isAdminOrDispatcher();`, no field validation.
`domain/contactImport.js` commits an entire CSV import as one client `writeBatch`, stamping a
**client-supplied** `createdBy` from `auth.currentUser?.uid` (the file says so itself:
*"CLIENT-SUPPLIED CLAIMS, not server-authoritative provenance"*).
**Missing server check:** no contact callable; `permissions: []`. `crm/customerRepository.ts:221`
`createContact` exists but serves the inbound-work path only, not the UI.
**On deletion:** any authenticated user bulk-writes contacts against any account, with forged
provenance. The batch shape makes the blast radius per request up to `MAX_IMPORT_ROWS`.

**#7 — `fieldops_jobs`: a client-writable lifecycle with no server transition engine.**
`firestore.rules:366-393` plus the `:329-349` helpers. **LEAD VERIFIED** — the canonical
`fieldops_wos` is correctly `if false` (`:509`) and its transitions run through
`transitionWorkOrder`, but the compat `fieldops_jobs` representation keeps its whole state machine
in Rules.
**Missing server check:** `transitionEngine.ts` / `transitionWorkOrder.ts` govern `fieldops_wos`
**only**; there is no equivalent for `fieldops_jobs`. `permissions: []`.
**On deletion:** any authenticated user creates a pre-assigned or pre-completed job, reverses a
completed job, or completes a job without going through `completeAssignedJob`. Ranked below #1-#6
only because `fieldops_jobs` is the legacy representation — but `Dispatch.jsx` still reads it and
`Technicians.jsx`/`Jobs` still write it, so it is live.

**#8 — `locations`: bare role gate, zero validation, and a load-bearing invariant elsewhere.**
`firestore.rules:1343` — `allow create, update: if isAdminOrDispatcher();`. Validates nothing.
**Missing server check:** no location callable; `permissions: []`;
`crm/customerRepository.ts:276` `createAccountLocation` serves inbound-work only.
**Sharpened risk:** `equipmentLocationBelongsToAccount()` (`:1438-1443`) *reads* `locations.accountId`
to validate equipment. A writer who can freely edit `locations.accountId` can retroactively invalidate
every equipment record that passed that check. The two rules are coupled and neither has a server home.
**On deletion:** any authenticated user reparents any customer location to any account.

**#9 — `reorder_purchase_order_voids`: the most intricate invariant in the file, enforced nowhere else.**
`firestore.rules:1108-1128` is a 20-condition create: assignee binding, PO existence + status proof
via `get()`, a 6-key exact shape, and a four-way `getAfter()` cross-document pin that the paired
`reorder_requests` VOIDED transition lands in the *same* commit with a matching reason. The mirror
half lives at `:948-996`.
**Missing server check:** no void callable. `reorder.purchaseOrder.void` is registered
(`permissionCatalog.ts:535`) and enforced nowhere. `domain/reorderPurchaseOrders.js:176`
`voidPurchaseOrder` is a **client** `runTransaction` — atomicity is Firestore's, but the
*correctness* of the pairing is 100% the Rules'.
**On deletion:** any authenticated user writes a void record with no matching request transition, or
voids a request with no void record — the two halves silently decouple, and the ORDERED→VOIDED
invariant the code explicitly relies on evaporates. Note the contrast: the *Record PO* half of this
same pattern was correctly moved into `recordReorderPurchaseOrder`'s Admin-SDK transaction
(`:823-834` documents the move); the Void half was not.

**#10 — `parts` read, and every `isActiveOperationalRole` read gate.**
`firestore.rules:1632-1635` — **LEAD VERIFIED.** Part Master read gated by role predicates, against
the block's own stated prohibition (`:1606-1609`).
**Missing server check:** `services/partMasterQueries.js:53` reads the whole `parts` collection
client-direct. There is no `parts.read` capability and no trusted Part list read for this surface
(`getManufacturerCatalog` and `scannerPartLookup` cover adjacent, narrower cases).
**On deletion:** every authenticated principal — including a bare technician and an INACTIVE or
TERMINATED employee — reads the complete Part Master. Ranked #10 because it is a *read*, not a
write; but it is the highest-volume confidentiality exposure in the file, and it carries the same
shape for `inventory_transactions` (`:531`), `employees` (`:491`), `warehouses` (`:1177`),
`transfer_orders` (`:1200`), `suppliers`/`supplier_catalog`/`purchase_orders` (`:1256`-`:1266`),
`mobile_locations`/`trucks` (`:1230`,`:1235`) and `reorder_requests` (`:648`).

**The sharpest evidence that Rules *is* the read authority** is that the client code says so.
`field-ops-app-vite/src/analytics/executionAnalyticsService.ts:246-250` documents its own unbounded
whole-collection `fieldops_wos` scan as carrying the *"same ADMIN/DISPATCHER-ONLY read-access
restriction as `getInventoryConsumptionSnapshot()`, same reason"* — a restriction that exists in
exactly one place, `firestore.rules:507`. Likewise `services/operationsQueries.ts:84-86` reads the
whole `inventory_transactions` stock ledger and nets it client-side into *"availableStock,
reconciliation positions and consumption totals"* (`:110-113`), bounded only by `firestore.rules:531`.
Twenty collections are reachable from the browser's descriptor-driven metadata list runtime (§3.0);
Rules is the only thing that decides which of those descriptors resolve.

### What is *not* at retirement risk (the convergence wins)

`reorder_requests` **create** (`:706`) and `reorder_purchase_orders` **create** (`:1078`) are
`if false`, and their authority genuinely moved into `createReorderRequest` /
`recordReorderPurchaseOrder` with capability checks and an Admin-SDK transaction. `fieldops_wos`
(`:509`) never had a client write. Job *completion* is `completeAssignedJob`-only by construction
(`:343-344` permits the technician only `assigned → in_progress`). These are the proof the pattern
works; the ten above are what has not been done yet.

---

## 7. Relationship to PR #1821

PR **#1821** — *"Take authorization out of Firebase Rules and into the governed layer"* — is **not
part of Wave 1 and is not in this tree**. `gh` is unauthenticated in this environment, so **its
content is UNPROVEN** and nothing here assumes it.

What *is* provable locally:

* `docs/DECISIONS.md:6422` (Owner ruling #179, 2026-09-10): *"PR #1821 is a separate strategic
  program and is not merged or cherry-picked here."*
* `docs/architecture/eos-admin-policy-workflow-reconciliation.md:311`: *"PR #1821 is not modified by
  this workstream."*
* The same reconciliation doc (`:63-67`) reports that on the #1821 branch, `readGovernedList`
  resolves capabilities against `COMPATIBILITY_ROLES` (`admin`/`dispatcher`/`technician`) only, so
  *"a governed business Role reaches no governed read source at all"*. **I verified that
  `readGovernedList` does not exist anywhere in this tree** — that finding is scoped to #1821's
  branch and is UNPROVEN here.

**Overlap assessment.** By title and by the two Owner-ruling references above, #1821 addresses the
same problem this census measures, and would plausibly overlap §6 items #1, #3 and #10 (the
reorder workflow, the Commercial Profile field permission, and the operational-role read gates),
since those are the file's largest legacy-role concentrations. It is **unlikely to cover** §6 #4
(`inventory_actions` — a product-retired write path that only Rules keeps open) or the §4 D-h
under-counting finding, because both are structural gaps in the *measurement*, not in the Rules
text. **Treat all of this as a hypothesis until #1821 is actually read.**

---

## 8. UNPROVEN / not verified

1. **PR #1821's content.** `gh auth` is not configured; the PR was never fetched. Everything in §7
   beyond the three quoted local references is inference from the title.
2. **Deployed-vs-committed Rules parity.** This census measures the committed `firestore.rules`.
   Whether the live project's deployed ruleset matches it was **not** checked — no production
   contact was permitted. The repo carries a `verify-rules-deploy` skill precisely because this has
   drifted before. Several block comments (e.g. `parts` at `:1629-1631`) explicitly say the change
   *"is NOT deployed here."*
3. **Firestore-emulator rule behaviour.** Emulator suites hang in this environment (port 8080 is an
   unrelated `uvicorn`; the Admin SDK retries to deadline), so no rule was executed. All §1/§2
   claims are from reading the rules text, not from observed evaluation.
4. **Exhaustiveness of §3.** The read census covers every module importing `firebase/firestore`
   directly under `field-ops-app-vite/src` (51 files) plus the `collectionStore`,
   `useFirestoreCollection` and `firestoreListSource` abstractions and their call sites. It was
   produced by a delegated sweep and then spot-verified by hand against the source at four
   high-impact points — `analytics/executionAnalyticsService.ts:218,251` (unbounded whole-collection
   `fieldops_wos` scans), `services/operationsQueries.ts:84-86,172` (unbounded whole-collection
   `inventory_transactions` read), `domain/reorderPurchaseOrders.js:218` (client-side ownership
   gate), `hooks/useFirestoreCollection.js:29-33` (unfiltered listener) — all four confirmed exactly
   as reported. Each *authoritative* classification names its consuming decision; the *display-only*
   classifications are the weaker half, since not every transitive consumer of every hook was traced.
5. **`employmentStatus` vocabulary drift.** `adminCredentialCommands.ts:183` names
   `ON_LEAVE / INACTIVE / TERMINATED` while `employeeProfileCommands.ts:125-129` defines
   `ACTIVE, INACTIVE, TERMINATED, RETIRED, CONTRACTOR`. `ON_LEAVE` appears in a comment only —
   whether it is a real historical value in production data is **unverified**.

---

## 9. Corrections to the leads this lane was given

| lead | outcome |
|---|---|
| `firestore.rules:1632` gates `parts` by role predicates | **CONFIRMED**, and sharpened: the block's own comment at `:1606-1609` states the prohibition it then violates |
| `fieldops_technicians` client-writable at `:407-408` / `:418-419` | **CONFIRMED** exactly; writer is `domain/jobActions.js:41` via `modules/technicians/Technicians.jsx:58`, plus `assignJob`'s transaction |
| legacy `fieldops_jobs` lifecycle in Rules `:329-344`; `fieldops_wos` `if false` at `:506-510` | **CONFIRMED** exactly |
| `:363` / `:406-409` express visibility via `callerTechnicianId()` | **CONFIRMED** |
| `:1156` is the only remaining write path into `inventory_actions`, no field validation, no `createdBy` binding | **CONFIRMED** exactly, and strengthened: `domain/inventoryActions.js` *says so itself* and names it a Tier-2 change deliberately not attempted |
| Administration carries **5** objects as `rulesOnly`; the seed drops `rulesOnly` | **PARTIALLY CORRECTED.** Administration carries **3** (`objectPermissionMap.js:36,37,92`). **5** is the server-side `RULE_GOVERNED_OBJECTS` count (`objectCapabilityMap.mjs:31-35`), which adds `Notifications` and `Technician Time / Non-work`. The seed-drop half is **CONFIRMED** — `rulesOnly` appears in no JSON in the repo. |
| two `firestore.rules` copies; verify byte-identity | **CONFIRMED identical**, and the identity is CI-enforced by `legacyAuthorizationSurface.test.mjs` D4. No drift; the mirror is not dead. |
