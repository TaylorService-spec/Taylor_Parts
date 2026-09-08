# Firebase Removal — Closure Ledger

Every remaining client Firebase use, classified. **Firebase authenticates. EOS authorizes.**

The closure targets are: direct client governed business reads **0**, direct client governed
business writes **0**, Firebase/Firestore EOS authorization decisions **0**. Anything Firebase still
does must be classifiable as Firebase Auth, session/token plumbing, accessVersion/invalidation
plumbing, or another explicitly non-business technical use.

Measured at the head of `feat/rules-out-of-firebase`.

## Firestore-based EOS authorization decisions: 0

`firestore.rules` is 136 lines and contains **no** EOS Role names, no capability names, no workforce
Role logic, no operating-company logic, no technician-assignment logic, no ownership logic and no
user-governance decisions. What survives is `isSignedIn()`, the `users/{uid}` own-document read the
capability feed's `accessVersion` subscription needs, and the PARTS_MANAGER picker clause;
everything else is `allow read, write: if false`.

**It is SOURCE ONLY and must not be deployed.** Direct callers still exist for the work-order
family, so deploying deny-all now would break surviving paths.

## Direct client Firestore WRITE CALLS: **0**

Measured: zero `writeBatch` / `runTransaction` / `setDoc` / `updateDoc` / `addDoc` / `deleteDoc`
call sites in `src/` outside the two infrastructure wrappers.

The last two were `jobActions.js`'s `assignJob` and `updateJobStatus`, and they were **deleted, not
migrated** — measured 2026-09-07 as having no importer anywhere. Minting permanent trusted-command
authority, and the capability grants that go with it, for a surface nothing calls would create
authority for dead product. Their transitions are recorded in `workflow-action-census.md`.

Every business write now goes through a trusted command: `createReorderRequest`,
`recordReorderPurchaseOrder`, `cancelReorderRequest`, `voidPurchaseOrder`, `importContacts`.

**One store-mediated write remains.** `createTechnician` writes `fieldops_technicians` through
`techniciansStore` (which is why it does not appear in the call-site count above — the wrapper does).
It is blocked on a capability that does not exist; see proposal 4 in
`capability-parity-proposals.md`. The retired rule's `status == 'available'` constraint is part of
that authority and must move with it.

## Direct client governed business READS

### The work-order family — the SEAM EXISTS; five consumers not yet wired

**The authority problem is solved.** `functions/src/workOrder/scopedWorkOrderReadService.ts` is
built, tested (20 tests) and CI-covered, with four capabilities ruled and granted:

| Capability | Holders (asked of the resolver) |
|---|---|
| `workOrder.read` | admin, dispatcher, owner |
| `workOrder.assigned.read` | admin, owner, technician |
| `service.technician.read` | admin, dispatcher, owner |
| `service.technician.self.read` | admin, owner, technician |

Global is resolved **before** self, and that ordering is load-bearing: admin derives the whole
catalogue and therefore holds the self capabilities too, so checking self first would scope an
administrator to a technician identity they do not have and return nothing, silently.

The metadata `workOrder` list and its count are migrated. These consumers still read directly
and are the remaining wiring work — the seam already carries a registered mode for each:

| File | Reads | Seam mode that replaces it |
|---|---|---|
| `domain/accountWorkOrders.js` | `fieldops_wos` | `accountOpen`, `accountRecent`, `accountScheduled` |
| `hooks/usePartWorkOrderDemand.js` | `fieldops_wos` | `openDemand` + `countScopedWorkOrders` |
| `hooks/useWorkOrder.js` | `fieldops_wos` (by id) | `readScopedWorkOrderById` |
| `hooks/useWorkOrderSearch.js` | `fieldops_wos` | `search` |
| `hooks/useEquipment.js` | `fieldops_wos` only — its equipment read is migrated | `byEquipment` |

`domain/jobActions.js` is NOT in this list any more: it no longer imports Firestore at all.

`hooks/useAssignedJobs.js` is also not: it reads **`fieldops_jobs`**, the legacy jobs surface, not
`fieldops_wos`. That was measured, not assumed — the ruling listed it among the work-order
consumers, and it is not one. It belongs to the jobs lane, whose remaining question is whether that
object should exist at all beside `fieldops_wos`; see `workflow-action-census.md`.

**`metadata/firestoreListSource.js` is DELETED.** Zero callers proven first, the `CLIENT_DIRECT`
branch removed from both dispatchers, and three obsolete mocks removed with their suites rewritten —
the routing tests now assert the opposite property, that a `CLIENT_DIRECT` definition fails closed
rather than being quietly served through the callable path.

`hooks/useListViewChrome.js`'s Firestore aggregate branch is now unreachable for the same reason:
every list, work orders included, counts through a trusted callable. It is removed when the last
consumer above is wired.

### `fieldops_technicians` — capability ruled, but blocked on a MEASURED realtime dependency

`service.technician.read` and `service.technician.self.read` are minted and granted, so the
authority is no longer the blocker. **A realtime dependency is**, and it was found by measuring
rather than assumed away:

`useCurrentTechnician` subscribes to `fieldops_technicians/{id}`, and
`TechnicianDashboard.jsx` renders `technician.status` as a live status pill. The writer that flips
that status **cross-session** is a dispatcher assigning work — a different person, in a different
session, on a different screen. A one-shot read would silently drop an update the technician
currently receives without acting.

Per the ruling's "measure, don't guess": this is returned as an **explicit parity blocker**, not
absorbed. The smallest non-Firestore mechanism (the module-scoped change signal built for the
reorder queue) cannot help — it does not cross sessions.

**It resolves on its own**, and here is the measured reason: the cross-session writer was
`jobActions.assignJob`, which has now been **deleted as dead code**. The only remaining writer of
technician status is the trusted `completeAssignedJob` callable, which a technician invokes from
their own session — where a post-action refresh is exact parity. The dependency should be
re-measured against live behaviour before these two files are migrated, rather than declared gone
on the strength of this reasoning alone.

| Surface | Collection |
|---|---|
| `hooks/useCurrentTechnician.js` | `fieldops_technicians`, `users/{uid}` |
| `modules/operations/Operations.jsx` | `fieldops_technicians` |

## Not business data — explicitly classified

| Files | Reads | Classification |
|---|---|---|
| `access/useGovernedCapabilities.js` + 6 sibling `use*Capabilit*.js` | `users/{uid}` | **accessVersion / invalidation plumbing.** The capability feed subscribes to its own principal's document to learn when access changed. This is the one client read `firestore.rules` still grants, and it is why. |
| `metadata/definitions/accountPageComponents.js` | `users/{uid}` | Same feed. |
| `auth/employeeSession.js` | `users/{uid}`, `employees/{own employeeId}` | **Session / operational-identity plumbing.** Resolves the SIGNED-IN PRINCIPAL'S OWN employee record via `users/{uid}.employeeId`. Self-scoped by construction — it is not a directory read and cannot become one. |
| `firebase/firebase.js` | — | SDK initialisation. |
| `lib/firebaseSafe.js` | — | The demo/panic write gate. |
| `firebase/collectionStore.js`, `hooks/useFirestoreCollection.js` | generic | Infrastructure. Reachable only through the paths above; they hold no collection of their own. |

## Migrated in this workstream

**Reads.** 17 metadata list entities plus the CRM, equipment, parts, inventory, reorder, purchase
order, truck, warehouse, employee and location read families — all through
`functions/src/access/governedReadRegistry.ts` and `readGovernedList` / `countGovernedList`.

**Writes.** `cancelReorderRequest`, `voidPurchaseOrder`, `importContacts` — client transactions and
batches **deleted**, not disabled.

**Deleted outright.** The `stockLocation` metadata definition and its index list: retired product
(Decision #160 / ADR-014), measured unreachable, removed rather than kept alive to hold Firestore
access open.

## Behaviour changes recorded rather than absorbed

Every `onSnapshot` replaced by a one-shot governed read is listed here, because a governed callable
cannot stream and "migration-complete" is not "behaviour-complete".

| Path | Why one-shot is honest here |
|---|---|
| `useLocation` | Record page; re-reads on navigation and retry, rendered no live badge. |
| `useLocationsForAccounts` | Duplicate-customer check over a candidate set assembled moments earlier; re-runs when that set changes. |
| `useAssignableEmployees` | Assignment picker; re-read whenever its inputs change. |
| `useEquipment` (equipment record) | Record page, as `useLocation`. |
| Reorder queue | **NOT absorbed** — a module-scoped change signal was built so cross-component refresh survived without Firestore. |

## Related

- `metadata-governed-read-migration.md` — the read surfaces and the one blocked entity.
- `workflow-action-census.md` — the write side, measurement only.
- `capability-parity-proposals.md` — how a capability blocker is brought to a ruling.
