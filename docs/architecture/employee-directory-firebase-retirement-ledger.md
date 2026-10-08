# Employee Directory: Firebase Retirement Ledger

Status: RECORDED 2026-10-08 (UI corrections final integration gate). Ledger only. It records what still reads
the Firestore `employees` collection for **names**, who consumes it, and the governed EOS read that replaces each.
It changes no frozen Financials logic, adds no Firebase dependency, and grants nothing.

Governing rulings: Firebase is retirement-only (FIREBASE -> EOS, never the reverse); the PostgreSQL Employee
directory and `user_role_assignments` are the sole workforce authorities; the Principal-to-Employee link stays
`admin.principalAccess.read` (Owner ruling B).

## The Firestore sources

| Source | File | What it reads |
| --- | --- | --- |
| `useEmployeeDirectory` | `field-ops-app-vite/src/hooks/useEmployeeDirectory.js` | Live Firestore listener on `employees`. Returns `byEmployeeId` (Firestore Employee doc id -> name) and `byUserId` (Firebase uid -> name). |
| `useAssignableEmployees` | `field-ops-app-vite/src/hooks/useAssignableEmployees.js` | Firestore `employees` filtered by `operationalRoles` and a linked Firebase user. This is the default `useEmployees` source of `EmployeeAssignmentPicker`. |
| `crmActivityCallableClient` | `field-ops-app-vite/src/services/crmActivityCallableClient.js` | The Firebase callables `getCrmActivities` and `createCrmActivity`. Activities store the acting Firebase uid as `createdByUid`. |

These files are already in `docs/architecture/firebase-exit-baseline.json`. The ratchet forbids new consumers of
the Firestore and callable classes, and this branch adds none (`scripts/firebaseExitGuard.mjs`: no new
business-runtime dependency).

## Retired on this branch (`lane/eos-consolidated-ui-corrections`)

| Page | Before | Now (governed) |
| --- | --- | --- |
| Opportunity detail and list owner and accountable | `useEmployeeDirectory` | `useGovernedEmployeeDirectory({ employeeIds })`, which calls `resolveEmployeeDisplayNames` for exactly the ids on the rendered records |
| Sales Order, Sales Agreement, Account (detail, list, Opportunities and Sales Orders sections) owner and accountable | `useEmployeeDirectory` | same: `resolveEmployeeDisplayNames` for the record's own ids (regression test: `test/governedOwnerNames.test.jsx`) |
| Sales Agreement acceptance actor | `useEmployeeDirectory` `byUserId` | `resolvePrincipalDisplayNames` with `principalIds` (`acceptedByPrincipalId`), or `actorSubjects` for legacy records |
| Account detail and Activity & Notes actors | `useEmployeeDirectory` `byUserId` | `resolvePrincipalDisplayNames` with `actorSubjects` (`createdByUid`) |
| Account owner picker (`AccountForm`) | `EmployeeAssignmentPicker` + `useAssignableEmployees` (Firestore, uid pair) | shared `Autocomplete` over `searchAccountOwnerCandidates`: 2+ characters, ACTIVE or CONTRACTOR Employees of the tenant, producing the `EOS_CRM` owner. The CRM write already takes the Employee id only and re-validates it. |
| Opportunity owner select (`OwnerSelect.jsx`) | free-text Employee id | typeahead over the EOS roster (`listEmployees`); a refused roster falls back to the bounded id field |

Proof: the Account, Opportunity and Sales Order pages make 0 Firestore `Listen` requests to `employees`; before
this branch they made 2.

## Remaining dependencies

### Financials: FROZEN, migrate with the Financials read move (not reopened here)

| File | Use | Ids it resolves | Replacement |
| --- | --- | --- | --- |
| `src/modules/financials/FinancialsInvoiceDetail.jsx:52` | `byEmployeeId`: credited salesperson | Employee ids carried on Firebase sandbox invoice data | `useGovernedEmployeeDirectory().byEmployeeId` (same shape, from `listEmployees`) |
| `src/modules/financials/FinancialsAccountsReceivable.jsx:61` | `byEmployeeId`: `creditedSalespersonId` | same | same |
| `src/modules/financials/FinancialsEmployeePerformance.jsx:68` | `byEmployeeId`: salesperson rollup keys | same | same |

These pages read money from Firebase sandbox-only data, so the Employee ids they name come from that data.
Swapping only the name source would resolve sandbox ids against the PostgreSQL directory, which is a parity change
inside frozen Financials logic. Exit condition: when the Financials reads move to the PG finance authority, swap
the hook in the same change. It is a one-line swap with identical return shape.

### Parts / Purchasing: legacy reorder actors

| File | Use | Ids it resolves | Replacement |
| --- | --- | --- | --- |
| `src/modules/inventory/PartsList.jsx:388` | `byUserId`: assignee of the "Assigned Work" oversight table (`resolveAssigneeDisplay`) | Firebase uids on legacy `reorder_requests` | `resolvePrincipalDisplayNames({ actorSubjects })` for legacy uids; `listReorderAssignmentTargets` / `listEmployees` for EOS assignee Employee ids |
| `src/modules/inventory/PartDetail.jsx:1256` | `byUserId`: inventory action actors (`InventoryActionsPanel`) | Firebase uids on legacy inventory actions | `resolvePrincipalDisplayNames({ actorSubjects })`; EOS ledger rows use `principalIds` |
| `src/modules/inventory/PartDetail.jsx:1392` | `byUserId`: reorder request actors (assigned, last update, ordered, received, cancelled, voided) | Firebase uids and Employee ids on legacy reorder requests | `resolvePrincipalDisplayNames` for actors; `useGovernedEmployeeDirectory().byEmployeeId` for `assignedEmployeeId` |
| `src/modules/purchasing/PurchaseOrders.jsx:110` | `byUserId`: `orderedByUserId` | Firebase uids on legacy purchase orders | `resolvePrincipalDisplayNames({ actorSubjects })` |

`resolvePrincipalDisplayNames` and `resolveEmployeeDisplayNames` currently admit callers holding a customer, opportunity, sales agreement, sales
order or work order read (`ACTOR_DISPLAY_READ_CAPABILITIES`). Parts and Purchasing callers would need the Reorder
and inventory read capabilities added to that gate. That widens a read, so it needs a ruling: it is code, not a
grant, but it changes who may name actors. This is the one open decision in this ledger.

Assignment pickers on these pages already use the governed `useReorderAssignmentTargets`
(`listReorderAssignmentTargets`): `PartDetail.jsx:468`, `ManagerQueuePanel.jsx:76` (PartsManagerHome).

### Shared default

`EmployeeAssignmentPicker`'s default `useEmployees = useAssignableEmployees` now has **zero production
consumers**. Both remaining call sites inject the governed `useReorderAssignmentTargets` (PartDetail,
ManagerQueuePanel). AccountForm no longer uses the picker. Exit:
make the `useEmployees` prop required and delete `useAssignableEmployees` together with its baseline entry. The
ratchet allows the baseline to shrink.

### CRM activity transport

`crmActivityCallableClient` (Firebase callables) remains the Activity & Notes read and write. Its actor names
already resolve through EOS (`actorSubjects`). Exit: an EOS CRM activity route with `principal_id` actors. Then
the page passes `principalIds`, and the callable client leaves the baseline.

## Replacement APIs (all existing, all governed)

| API | Route | Gate | Answers |
| --- | --- | --- | --- |
| `listEmployees` (EMP-RT-01) | `/workforce/employees` | `employee.record.read` plus operating-company reach (admin, generalManager, owner only) | Employee id, name, employment status, operating company |
| `resolveEmployeeDisplayNames` | `/operations/workspace` | one of `ACTOR_DISPLAY_READ_CAPABILITIES` (customer / opportunity / sales agreement / sales order / work order read), flat or scoped | `{key, displayName}` for the asked Employee ids of the caller's tenant, every status; at most 100 |
| `searchAccountOwnerCandidates` | `/operations/workspace` | `customer.record.create` or `customer.record.update` (the capabilities under which the CRM write accepts an owner) | at most 25 `{employeeId, displayName}`, ACTIVE or CONTRACTOR, name match on 2 to 100 characters |
| `resolvePrincipalDisplayNames` | `/operations/workspace` | one of `ACTOR_DISPLAY_READ_CAPABILITIES`, flat or scoped | `{key, displayName}` for the asked keys only, ACTIVE members of the caller's tenant |
| `listReorderAssignmentTargets` | `/operations/inventory` | the Reorder request assign capability | assignable Parts Employees |

## Nonprod acceptance requirements (not provable locally)

1. **Sales Order owner name.** No live Sales Order exists in the local governed harness. In nonprod, open a Sales Order
   as a seller (`retailSales` / National Accounts) and as `salesManager`. Owner and Accountable must show the
   Employee's name. 0 Firestore `Listen` requests to `employees`. An owner outside the seller's operating-company reach
   shows "reference unavailable", never the id. Component regression: `test/governedOwnerNames.test.jsx`.
2. **Activity & Notes actor.** A note written through the Firebase callable shows the author's name (via
   `actorSubjects`) for a Dispatcher and a seller. `listTenantPrincipals` stays FORBIDDEN for both.
3. **Account owner change.** A seller changes an Account owner. The picker lists only ACTIVE and CONTRACTOR Employees,
   and the saved owner reads back by name.
