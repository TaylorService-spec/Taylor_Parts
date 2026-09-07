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

## Direct client governed business WRITES: 0 outside the blocked family

| Path | Status |
|---|---|
| `domain/jobActions.js` (2 × `runTransaction`) | **BLOCKED** — the work-order family. Requires the server-derived technician/self-scope seam. |

Every other business write goes through a trusted command: `createReorderRequest`,
`recordReorderPurchaseOrder`, `cancelReorderRequest`, `voidPurchaseOrder`, `importContacts`.

## Direct client governed business READS

### Blocked by ruling — the work-order family

Kept client-direct **on purpose**. Forcing them through a global governed read would either widen
the read (a technician seeing every work order) or narrow it (a dispatcher losing rows). The
authority is not global, and the migration must not weaken it to finish.

| File | Reads |
|---|---|
| `domain/accountWorkOrders.js` | `fieldops_wos` |
| `domain/jobActions.js` | `fieldops_jobs`, `fieldops_technicians` |
| `hooks/useAssignedJobs.js` | `fieldops_jobs` |
| `hooks/usePartWorkOrderDemand.js` | `fieldops_wos` |
| `hooks/useWorkOrder.js` | `fieldops_wos` |
| `hooks/useWorkOrderSearch.js` | `fieldops_wos` |
| `hooks/useEquipment.js` | `fieldops_wos` only — its equipment read is migrated |

Two more survive **because** of this, and go the day it does:

| File | Why it survives |
|---|---|
| `metadata/firestoreListSource.js` | `workOrder` is now its ONLY caller. Not dormant scaffolding — a live path for one entity. |
| `hooks/useListViewChrome.js` | Its `getCountFromServer` branch now serves only `workOrder`; every other list counts through `countGovernedList`. |

### Blocked on a capability that does not exist

| Surface | Collection | Needed |
|---|---|---|
| `hooks/useCurrentTechnician.js` | `fieldops_technicians` | No `technician.*` read capability exists in `permissionCatalog.ts`. |
| `modules/operations/Operations.jsx` | `fieldops_technicians` | As above. |

Same class as the three capabilities resolved on 2026-09-07 and handled the same way: measured,
recorded, **not** minted. Minting a capability and granting it to a Role is an
authorization-definition decision. A parity table in the shape
`capability-parity-proposals.md` uses can be produced on request.

Note that `fieldops_technicians` is also read by `jobActions.js`, which is blocked independently.

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
