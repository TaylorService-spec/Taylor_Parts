# Firebase Removal — Closure Ledger

Every remaining client Firebase use, classified file by file. **Firebase authenticates. EOS
authorizes.**

Closure targets: direct client governed business reads **0**, direct client governed business
writes **0**, Firestore-based EOS authorization decisions **0**. Anything Firebase still does must
be classifiable as Firebase Auth, token/session plumbing, `accessVersion` invalidation, the
explicitly retained picker, or another non-business technical mechanism.

Measured repository-wide at the head of `feat/rules-out-of-firebase` — by OPERATION, not by import
count, because an import count is what hid two whole categories of write the first time.

---

## Scoreboard

Three boundaries, measured **separately**. Collapsing them into one number is how a gap hides:
each is a different way Firebase could still be deciding something, and closing two of them
says nothing about the third.

| Boundary | Measure | Status |
|---|---|---|
| **A. Firestore Rule authority** | business authorization decisions in `firestore.rules` | **0** |
| **B. Client Firestore business data** | direct governed reads / writes from the browser | **0** / **0** |
| **C. Legacy `users/{uid}.role` authority** | server-side authorization consumers | **0** |

| Supporting | Status |
|---|---|
| `firestoreListSource` callers | **0** (file deleted) |
| `useFirestoreCollection` callers | **0** (file deleted) |
| `collectionStore` / `firebaseSafe` callers | **0** (both files deleted) |

**Rules closure: READY.** Every governed business read and every governed business write goes
through a trusted seam, the shared client transports are deleted rather than dormant, and no
server-side authorization is decided by the legacy role. The staged `firestore.rules` is still
NOT DEPLOYED — that is a separate authorized action.

### The count is now a test, not a claim

It was wrong twice, in the same direction, for the same reason: something was left out of the
count as infrastructure or as out-of-scope, and the exclusion was never written where the next
reader would find it. First `collectionStore` hid eleven writes; then this ledger said the
repository was at zero reads while four unmigrated files — `services/workOrderService.ts`,
`services/operationsQueries.ts` and the two analytics services — were serving Dispatch, FieldMode,
PartsList and Transfers.

So the census is executable. `field-ops-app-vite/test/clientFirestoreCensus.test.jsx` walks every
file under `src/`, enumerates each surviving Firestore reader **with the reason it survives**, and
fails by name on a new one. It also fails when an allowlisted file stops reading Firestore, so an
exception cannot outlive its reason. Verified by introducing a real leak and watching it fail.

---

## Every surviving client Firestore operation

| File | Operations | Collections | Class | Why it remains |
|---|---|---|---|---|
| `access/useGovernedCapabilities.js` | `onSnapshot` | `users/{own uid}` | **C** accessVersion invalidation | The capability feed subscribes to its OWN principal's document to learn when access changed. This is the one client read `firestore.rules` still grants, and it is why. |
| `access/useEquipmentInstallCapability.js` | `onSnapshot` | `users/{own uid}` | **C** | Same feed. |
| `access/useOpportunityCapabilities.js` | `onSnapshot` | `users/{own uid}` | **C** | Same feed. |
| `access/useReportCapabilities.js` | `onSnapshot` | `users/{own uid}` | **C** | Same feed. |
| `access/useSalesOrderCapabilities.js` | `onSnapshot` | `users/{own uid}` | **C** | Same feed. |
| `access/useSerializedAssetAcquireCapability.js` | `onSnapshot` | `users/{own uid}` | **C** | Same feed. |
| `access/useWorkOrderPartsPlanCapability.js` | `onSnapshot` | `users/{own uid}` | **C** | Same feed. |
| `metadata/definitions/accountPageComponents.js` | `onSnapshot` | `users/{own uid}` | **C** | Same feed. |
| `firebase/firebase.js` | — | — | **E** technical | SDK initialisation. |

**`lib/firebaseSafe.js` and `firebase/collectionStore.js` are DELETED.** They were the shared
client write transport, and their last business client — equipment — moved to a trusted command.
Deleted rather than retained: a generic direct-Firestore write path with no caller is precisely
what a later "just this once" change reaches for.

Files that merely MENTION Firestore or the store in prose — `domain/accounts.js`,
`domain/equipment.js`, `domain/inventoryActions.js`, `domain/inventoryReorderRequests.js`,
`metadata/definitions/{account,inventoryAction,location}.js` — carry zero live references and are
not counted. Verified by grep for live imports and calls, not by eye.

---

## The last blocked write — CLOSED

| | |
|---|---|
| **Surface** | `domain/equipmentRepository.js` → `createEquipment` / `updateEquipment`, live from `EquipmentDetail.jsx` |
| **Collection** | `equipment` |
| **Retired CREATE authority** | `isAdminOrDispatcher()` **AND** `equipmentCreateShapeValid(...)` **AND** `equipmentLocationBelongsToAccount(...)` — a **cross-document** referential check |
| **Retired UPDATE authority** | `isAdminOrDispatcher()` **AND** `affectedKeys().hasOnly(equipmentEditableKeys())` **AND** name validity **AND** optional-field validity **AND** `equipmentTransitionAllowed(storedStatus, nextStatus)` — a status **state machine** — **AND** `updatedAt is number` |
| **Existing capability** | **None.** `service.equipment.read` exists; there is no `service.equipment.create` or `.update`. |
| **Resolution** | **MIGRATED** under the 2026-09-07 ruling. `service.equipment.create` and `service.equipment.update` minted as TWO capabilities, never one generic `equipment.write`: the two actions are gated by materially different contracts. No `service.equipment.delete` — the rule is `allow delete: if false` for everyone including admin, because Service History is derived from Work Orders that reference the record. |

**The invariant that made this the hardest one.** `affectedKeys().hasOnly(editableKeys)` restricts
the CHANGED KEYS, not the document's key set. A record may legitimately carry audit, lifecycle or
lineage fields stamped by a trusted writer, and requiring the resulting document to contain only
editable keys would make every such record permanently uneditable. The command therefore computes
`stored + bounded patch = candidate`, validates the changed-key set, the resulting VALUES and the
transition — and never reconstructs a document from a client schema or strips unknown fields. Two
regression proofs pin it: an ordinary name edit on a record carrying a trusted audit field succeeds
with the trusted field untouched, and an attempt to change that field is refused.

**Retire and reactivate were NOT wired.** They are trusted lifecycle actions, currently unavailable,
and the ordinary update refuses both transitions in the words the surface already uses. Building
them to finish Firebase removal is exactly what the ruling forbade.

---

## The final read cutover — the four files the earlier census missed

None was ever in an earlier directive's scope, which is exactly why they survived: each pass
measured what it had been asked to change. They are migrated here.

### `services/workOrderService.ts`

| Read | Now | Preserved |
|---|---|---|
| `getDoc(fieldops_wos/{id})` | `readScopedWorkOrderById` | Three outcomes stay three: record / confirmed absence (`null`) / **DENIED throws**. A refusal must not arrive as an absence — that is a claim about the business made out of a permission decision. |
| `onSnapshot(collection(fieldops_wos))` | `readAllScopedWorkOrders({ mode: "all" })` under automatic governed refresh | The COMPLETE population, paged to exhaustion. The operations boards count and bucket what they are handed; a page would turn every board total into a number about a page. Global authority required, resolved server-side — a technician on this path is scoped to their own assignments, not served an unscoped board. |
| `onSnapshot(where assignedTechId == id)` | `readScopedWorkOrders({ mode: "assigned" })` under the same refresh | Bounded at 100, exactly as the listener was. |

The callback/unsubscribe API is unchanged, so no consumer was rewritten to stop talking to
Firestore.

**The `assigned` mode's technicianId is a business input, never authority.** It names *whose*
assignments are wanted. A principal scoped to their own is REFUSED when they name somebody else —
refused rather than silently intersected into an empty page, because an empty list reads as "you
have no work". A principal may name another technician only by already holding `workOrder.read`.
Global authority resolves before assigned, so an administrator is never scoped to a technician
identity they do not have.

### The two analytics services

No analytics backdoor around Work Order governance: every Work Order input comes through the same
scoped seam the operational surfaces use. `operationsIntelligenceService` had its own private
collection scan; it now composes the same reader as its sibling, which is what a composite layer
should have been doing.

`getTechnicianExecutionStats` keeps both populations and lets the server pick: a global reader may
compute stats for the technician they name, a technician only for themselves. **Formulas were not
touched.** `getInventoryConsumptionSnapshot` and `getTechnicianVolumeBreakdown` keep
COMPLETE-population semantics by paging to exhaustion — the pure aggregation stayed exactly where
it was rather than being moved server-side, because moving it would have been a redesign of the
metric wearing a transport migration's clothes.

### `services/operationsQueries.ts`

The generic `listCollection(name)` escape hatch is gone. **Each resource keeps its own authority** —
there is deliberately no operations-wide read capability, because one capability spanning eight
resources would grant the Suppliers workspace to anyone who could see a warehouse.

| Collection | Source id | Capability |
|---|---|---|
| `warehouses` | `warehouseDirectory` / `metadataWarehouses` | `warehouse.record.read` (existing) |
| `suppliers` | `supplierDirectory` / `metadataSuppliers` | `supplier.record.read` (existing) |
| `supplier_catalog` | `supplierCatalogDirectory` | `supplier.catalog.read` (existing) |
| `transfer_orders` | `transferOrderDirectory` / `metadataTransferOrders` | `warehouse.transferOrder.read` (existing) |
| `inventory_transactions` | `inventoryTransactionLedger` | `inventory.transaction.read` (existing) |
| `reorder_requests` | `reorderRequestsQueue` | `reorder.request.read.queue` (existing) |
| `reorder_purchase_orders` | `purchaseOrdersByIds` / `purchaseOrderDirectory` | `reorder.purchaseOrder.read` (existing) |
| `purchase_orders` (dormant Epic-5) | `legacyPurchaseOrders` | **`supplier.purchaseOrder.read` — MINTED** |

**Bounded list vs complete aggregate, preserved.** List surfaces take one page plus an honest
`truncated` flag, observed from the server's own one-more-than-the-page probe rather than inferred
from a length. Netting consumers — available stock, reconciliation positions, consumption totals,
the operational overview — take the complete population. `readAllGoverned` **fails rather than
truncating**, so a complete-population read cannot degrade quietly into a partial one.

**Why the complete-population sources are ordered by document id.** `orderBy` silently excludes
documents missing the ordered field. The inventory ledger is the proof: LEGACY documents carry
`timestamp`, OPERATIONAL documents carry `recordedAt`, and no document carries both — which is why
that collection was previously judged impossible to cursor-page at all. Every document has an id.

**The transfer-order id contract survives**: `{ docId, data }`, storage id kept out of the data so
nothing downstream can merge a stored `id` over the real one. What changed, recorded rather than
glossed: a conflicting stored id can no longer *reach* the client to be compared, because the
governed seam builds every record as `{ ...data, id }` with the storage id last. Enforcement moved
earlier rather than disappearing.

### Product debt, recorded rather than fixed in passing

`purchase_orders` is the dormant Epic-5 collection: its only writer is a demo seed script, and the
live purchase orders are `reorder_purchase_orders`. The Operations overview's
`openProcurementCount` still counts the dormant one. That fact is **preserved**, not quietly
corrected — repointing a metric at a different collection is a correctness change with an owner
and a visible number attached, not a side effect of moving a read off Firestore.

### Timestamps: the failure this migration would otherwise have shipped

A Firestore `Timestamp` crossing a callable is plain JSON with no methods. Six call sites read
`value?.toMillis?.()` or `value.toDate()` on Work Order and ledger timestamps, and every one would
have silently degraded — `lastUpdated` to "never updated", Avg Job Duration to N/A, Completed
Today to empty, the age-windowed inventory metrics to counting nothing. All now go through
`domain/timestampMillis.js`'s `toMillis()`, which reads every shape. Same class as the F0
regression that reported a 54-year-old work order; caught by measurement, not by a failing test.

---

## Session identity moved server-side

`auth/employeeSession.js` read `users/{uid}` and then `employees/{employeeId}` — the second
admitted by a Rules clause letting any authenticated user read the Employee document matching
their own `employeeId`. **That clause is not coming back.** A self-read predicate over a business
collection is still Firestore deciding who may read a business record.

`resolveCurrentEmployeeSession` requires **authentication and no capability**. It is not
`workforce.directory.read` — that capability reads other people, and requiring it here would mean
a technician could not learn their own name. It is not a standing Employee read, not
Role-configurable, not field security. The caller sends **nothing**: no uid, no employeeId, no
role, no operationalRoles, no employmentStatus. There is no payload.

The three linkage states are preserved because they mean different things: **no employeeId** is a
valid migration state; a **broken link** keeps the employeeId visible and grants no operational
identity, with a warning naming only the id; a **resolved** link returns the identity. Reciprocity
is checked where the record carries it — a document naming a different principal grants nothing —
while a record with no `userId` is the un-migrated shape and still resolves, because absence is
not contradiction.

`role` is still carried for the client's nav gating and display, **and it is not authorization**.
`functions/test/legacyRoleIsNotAuthority.test.mjs` pins that honestly: it does not claim zero
consumers — `adminCredentialCallables.ts` still resolves the legacy administrator for the
credential-reset surface — it holds an ALLOWLIST with a reason per entry, fails on a new consumer,
fails on a stale entry, and forbids the governed machinery from consulting the field at all.

---
## Boundary C — the last server-side legacy authority

Two decisions came out of `users/{uid}.role === "admin"` in the credential-reset surface, and
both were Firebase data answering an EOS question:

| Decision | Was | Is |
|---|---|---|
| May this ACTOR reset somebody's credentials? | `users/{actorUid}.role === "admin"` | the governed capability **`admin.credentialReset.initiate`**, resolved server-side through `resolveEffectiveAccess` |
| Is the TARGET an administrator worth protecting from losing the last recoverable account? | `users/{targetUid}.role === "admin"` | an **ACTIVE `roleAssignment` with `roleId: "admin"`** naming that principal |

**No capability was invented and none was activated.** `admin.credentialReset.initiate` already
existed in the catalog as the declared future contract. It remains `active: false`, and it is
excluded even from per-environment *sandbox* activation — so the credential-reset command now
fails closed in **every** environment. That is the intended state, not a regression: activation
is a separate production/security gate.

**The legacy check was replaced, not joined.** There is no OR between the old authority and the
new one, and no fallback on error — an OR between an old authority and a new one is the old
authority with extra steps, and a fallback is the old authority waiting for an error to
reinstate it. A fully-linked, ACTIVE, enabled actor whose user document says `role: "admin"` is
now REFUSED, proved against the real adapter in `adminCredentialActorFacts.test.mjs`.

**The target protection fails safe in every direction.** The judgement was split out of the
Firestore adapter into a pure `resolveFinalActiveAdmin`, because that is the half that can be
wrong in a way no emulator round trip would reveal:

| Situation | Result | Why |
|---|---|---|
| the assignment query cannot run | **PROTECT** | refusing a legitimate reset is recoverable; resetting the last administrator is not |
| a malformed `principalUid` beside an admin target | **PROTECT** | the unreadable entry might BE the target, so it cannot be counted as somebody else |
| two active assignments naming the same person | **PROTECT** | one administrator, not two — counting rows would clear the protection on the last account |
| the target holds no admin assignment | no protection | absence is absence; none is invented |

**One more transport removed on the way.** The eligible-user list projection carried the legacy
`role` as a display column that no component rendered. A legacy role string travelling to the
browser inside an *admin* surface's list is precisely the shape somebody later gates on, so it
is gone. The session projection is the single place that transports the field, and that
statement is now true rather than nearly true.

### The proof changed shape with the fact

`legacyRoleIsNotAuthority.test.mjs` used to hold an ALLOWLIST, because zero was not honest while
the credential surface still consumed the field. It now asserts **0 authorization consumers**
outright, plus: the field is READ in exactly one place, that place only transports it, the
credential surface authorizes on the capability, and target admin status comes from role
assignments. The transport site is named separately and held to a stricter contract than an
exception — it may not compare the value to anything.

---
## What this workstream migrated

**Reads.** 17 metadata list entities; the CRM, equipment, parts, inventory, reorder, purchase
order, truck, warehouse, employee, location and technician read families; and the scoped
work-order seam — all through `governedReadRegistry.ts` / `readGovernedList` / `countGovernedList`,
or, for work orders, `scopedWorkOrderReadService.ts`.

**Writes.** `createReorderRequest`, `recordReorderPurchaseOrder`, `cancelReorderRequest`,
`voidPurchaseOrder`, `importContacts`, `createTechnician`, the six CRM record commands, and the
five reorder transitions. Client transactions and batches **deleted**, not disabled.

**Deleted outright.** `metadata/firestoreListSource.js`, `hooks/useFirestoreCollection.js`,
`hooks/useAssignedJobs.js`, the `stockLocation` definition, three of four `jobActions` exports, and
four now-unreferenced collection stores. Nothing was kept as a dormant alternative path.

---

## Capabilities minted in this workstream

Each on measured parity with the rule it replaces; dispatcher explicit, admin and owner derived
through the existing composition, no other Role.

| Capability | Replaces |
|---|---|
| `crm.contact.create` | `contacts` create |
| `crm.contact.update` | `contacts` update |
| `crm.location.create` / `.update` | `locations` create / update |
| `supplier.record.read` | `suppliers` read |
| `supplier.catalog.read` | `supplier_catalog` read |
| `workOrder.read` | `fieldops_wos` global read branch |
| `workOrder.assigned.read` | `fieldops_wos` assigned-technician branch |
| `service.technician.read` | `fieldops_technicians` global read branch |
| `service.technician.self.read` | `fieldops_technicians` own-record branch |
| `service.technician.create` | `fieldops_technicians` create, incl. its `status == 'available'` constraint |
| `service.equipment.create` | `equipment` create, incl. its cross-document location-ownership proof |
| `service.equipment.update` | `equipment` ordinary edit, incl. its changed-key allowlist and ACTIVE↔INACTIVE guard |
| `supplier.purchaseOrder.read` | the dormant Epic-5 `purchase_orders` read. Minted under conditional authorization: the retired predicate was EXACTLY `isAdminOrDispatcher()` — no self scope, no warehouse scope, no field restriction, no narrower record predicate. Deliberately NOT `reorder.purchaseOrder.read`, which governs the LIVE reorder purchase orders; merging them would have silently widened what that capability grants. |

The Account governed-commercial-field split reuses the existing `customer.governedField.write`
rather than minting anything: it is the retired rule's `isAdmin()` branch expressed as authority.

---

## Behaviour changes recorded rather than absorbed

Every `onSnapshot` replaced by a non-streaming read, because a governed callable cannot push and
"migration-complete" is not "behaviour-complete".

| Path | New behaviour | Why it is honest |
|---|---|---|
| **Work orders — both subscriptions** | **Automatic governed refresh, bounded ≤ 5s** | Same mechanism, same honesty: a Firestore push became a poll. The dispatch and technician boards keep moving without a reload, and an update that arrived in milliseconds now arrives within five seconds. Suspended while the tab is hidden; immediate re-read on visibility and focus. The global one reads a COMPLETE population and FAILS rather than truncating, because the boards net over it. |
| **Technician directory** | **Automatic governed refresh, bounded ≤ 5s** | The one real realtime requirement: a dispatcher's board must show a technician becoming AVAILABLE without a reload. NOT described as parity — an update that arrived in milliseconds now arrives within five seconds. Interval suspends while hidden; immediate refetch on visibility, focus and same-session mutation; a failed refresh keeps the last good directory rather than reading as "no technicians". |
| `useLocation`, `useEquipment` (record) | One-shot | Record pages; re-read on navigation and retry, rendered no live badge. |
| `useLocationsForAccounts` | One-shot | Duplicate-customer check over a candidate set assembled moments earlier. |
| `useAssignableEmployees` | One-shot | Assignment picker; re-read whenever its inputs change. |
| `useCurrentTechnician` | One-shot + `retry()` | Measured: the only live mutation of an existing technician is `completeAssignedJob`, invoked by that technician in their own session. The cross-session writer died with `assignJob`. |
| `useWorkOrder`, `useWorkOrderSearch`, `usePartWorkOrderDemand`, `accountWorkOrders` | One-shot | Record page, debounced search, a bounded demand scan, and an account timeline. |
| Reorder queue | **Signal, not one-shot** | A module-scoped change signal was built so cross-component refresh survived without Firestore. It moved again when the writes became commands, into `announce()`. |

---

## Related

- `workflow-action-census.md` — the business actions, measurement only.
- `capability-parity-proposals.md` — how a capability blocker is brought to a ruling.
- `metadata-governed-read-migration.md` — the read surfaces.
