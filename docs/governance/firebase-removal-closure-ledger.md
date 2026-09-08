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
| Direct client governed business **reads** | **0** |
| Direct client governed business **writes** | **1 surface** — equipment create/update, blocked and reported |
| `firestoreListSource` callers | **0** (file deleted) |
| `useFirestoreCollection` callers | **0** (file deleted) |

**Rules closure: NOT READY.** One business-data write path survives. It is measured, its exact
retired authority is recorded, and it is blocked on an authorization decision rather than on
engineering — see the blocked section.

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
| `auth/employeeSession.js` | `getDoc`, `onSnapshot` | `users/{own uid}`, `employees/{own employeeId}` | **B** session / operational identity | Resolves the SIGNED-IN principal's OWN employee record via `users/{uid}.employeeId`. Self-scoped by construction — not a directory read, and cannot become one. |
| `firebase/firebase.js` | — | — | **E** technical | SDK initialisation. |
| `lib/firebaseSafe.js` | `addDoc`, `setDoc`, `updateDoc`, `deleteDoc` | — | **E** technical wrapper | The demo/panic write gate. It performs no read and names no collection; it wraps whatever it is handed. Its ONLY remaining business client is the equipment store below. |
| `firebase/collectionStore.js` | `getDocs`, `makeCollectionStore` | parameterised | **E** technical wrapper — **but see below** | Generic transport. NOT infrastructure by virtue of being generic: it is a write path, and it retains exactly one business client. |
| `domain/equipmentRepository.js` | `makeCollectionStore` | `equipment` | **NOT PERMITTED — blocked** | The one surviving governed business write. See below. |

Files that merely MENTION Firestore or the store in prose — `domain/accounts.js`,
`domain/equipment.js`, `domain/inventoryActions.js`, `domain/inventoryReorderRequests.js`,
`metadata/definitions/{account,inventoryAction,location}.js` — carry zero live references and are
not counted. Verified by grep for live imports and calls, not by eye.

---

## The one blocked write

| | |
|---|---|
| **Surface** | `domain/equipmentRepository.js` → `createEquipment` / `updateEquipment`, live from `EquipmentDetail.jsx` |
| **Collection** | `equipment` |
| **Retired CREATE authority** | `isAdminOrDispatcher()` **AND** `equipmentCreateShapeValid(...)` **AND** `equipmentLocationBelongsToAccount(...)` — a **cross-document** referential check |
| **Retired UPDATE authority** | `isAdminOrDispatcher()` **AND** `affectedKeys().hasOnly(equipmentEditableKeys())` **AND** name validity **AND** optional-field validity **AND** `equipmentTransitionAllowed(storedStatus, nextStatus)` — a status **state machine** — **AND** `updatedAt is number` |
| **Existing capability** | **None.** `service.equipment.read` exists; there is no `service.equipment.create` or `.update`. |
| **Why it is not migrated** | The conditional authorization covers actions whose retired rule is "exactly `isAdminOrDispatcher` with no narrower record/field restriction". Equipment fails that test on both actions, and by a wide margin. Migrating on an assumed parity would move a cross-document check and a transition engine into a command without a ruling on either. |

Two consequences, stated so neither is a surprise:

- `firebase/collectionStore.js` and `lib/firebaseSafe.js` survive **because of this one surface**.
  They are otherwise unreferenced by business code and go with it.
- The staged restrictive `firestore.rules` cannot be deployed until this closes: it would break
  equipment creation and editing.

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
