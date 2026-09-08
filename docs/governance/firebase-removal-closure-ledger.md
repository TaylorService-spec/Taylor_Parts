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

| Target | Status |
|---|---|
| Firestore-based EOS authorization decisions | **0** |
| Direct client governed business **writes** | **0** |
| Direct client governed business **reads** | **14 call sites, 4 files — NOT ZERO** |
| `firestoreListSource` callers | **0** (file deleted) |
| `useFirestoreCollection` callers | **0** (file deleted) |
| `collectionStore` / `firebaseSafe` callers | **0** (both files deleted) |

**Rules closure: NOT READY — and an earlier revision of this ledger said READY, which was wrong.**
The write side is closed and the shared client write transport is deleted. The read side is closed
**for the families this workstream migrated**, and that result was generalized to "repository-wide
0" without measuring four files that were never in its scope. Re-measured by CALL SITE:

| File | Sites | Collections | Live consumers |
|---|---|---|---|
| `services/workOrderService.ts` | 3 | `fieldops_wos` | Dispatch, DispatcherBoard, Jobs, ControlTower, FieldMode, TechnicianDashboard, ScanWorkspace |
| `services/operationsQueries.ts` | 6 | `warehouses`, `transfer_orders`, `suppliers`, `supplier_catalog`, `purchase_orders`, `inventory_transactions`, `reorder_requests`, `reorder_purchase_orders` | PartDetail, PartsList, Transfers, Receiving, CycleCounts, AdminWarehouseRacking, Operations |
| `analytics/executionAnalyticsService.ts` | 4 | `fieldops_wos` (two are unbounded collection scans) | Operations, PerformanceSnapshot |
| `analytics/operationsIntelligenceService.ts` | 1 | `fieldops_wos` (unbounded scan) | via `executionAnalyticsService` |

None is dormant. Deploying the staged Rules today would dark those screens.

A fifteenth read is `auth/employeeSession.js`'s `employees/{own employeeId}`. It is genuinely
self-scoped, but the surviving picker grant does not cover it — a principal who is not a
PARTS_MANAGER assignment candidate would be denied their own employee record, which is what resolves
operational identity at session bootstrap. Either the grant widens to "own linked employee record"
or that read moves behind a governed callable; **that is a decision, not a cleanup.**

The staged `firestore.rules` is NOT DEPLOYED, and this is now why as well as when.

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
| `auth/employeeSession.js` | `getDoc` ×2 | `users/{own uid}`, `employees/{own employeeId}` | **B** session / operational identity — **not covered by the staged Rules** | Resolves the SIGNED-IN principal's OWN employee record via `users/{uid}.employeeId`. Self-scoped by construction and cannot become a directory read — but the picker grant does not admit it, so it is a closure blocker rather than a clean survivor. |
| `services/workOrderService.ts` | `getDoc`, `onSnapshot` ×2 | `fieldops_wos` | **A** governed business read — **UNMIGRATED** | Never in this workstream's scope. The scoped work-order seam exists server-side and is the destination. |
| `services/operationsQueries.ts` | `getDocs` ×6 | eight collections, see above | **A** governed business read — **UNMIGRATED** | Never in scope. Several are whole-collection reads with client-side paging. |
| `analytics/executionAnalyticsService.ts` | `getDoc`, `getDocs` ×3 | `fieldops_wos` | **A** governed business read — **UNMIGRATED** | Two are unbounded collection scans, gated only by a comment saying admin/dispatcher only. |
| `analytics/operationsIntelligenceService.ts` | `getDocs` | `fieldops_wos` | **A** governed business read — **UNMIGRATED** | Unbounded collection scan. |
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

The Account governed-commercial-field split reuses the existing `customer.governedField.write`
rather than minting anything: it is the retired rule's `isAdmin()` branch expressed as authority.

---

## Behaviour changes recorded rather than absorbed

Every `onSnapshot` replaced by a non-streaming read, because a governed callable cannot push and
"migration-complete" is not "behaviour-complete".

| Path | New behaviour | Why it is honest |
|---|---|---|
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
