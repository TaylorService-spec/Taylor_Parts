# F1 — Technician Customer Identity: Authority Investigation

**Status:** INVESTIGATION COMPLETE · **GENUINE AUTHORITY GAP PROVEN** · no Rules, capability or
authority changed · dependent display work stopped; all other F1 work continued

**Question:** can a technician resolve a governed Work Order's `customerId` to a
customer/account display name using authority the repository *already* establishes?

**Answer: no.** Every existing path is closed, and no repository document determines an
alternative. This is the narrow case the Owner reserved for return.

---

## 1. What the technician *can* read

`firestore.rules` — technicians hold a real, scoped read on their own Work Orders:

```
match /fieldops_wos/{woId} {
  allow read: if isAdminOrDispatcher()
    || (isTechnician() && isOwnTechnician(resource.data.assignedTechId));
  allow create, update, delete: if false;
}
```

So the following are legitimately available and are what F1's Current Job is built from:
`woNumber`, `status`, `priority`, `severity`, `type`, **`customerId`**, **`locationId`**,
`complaint`, `diagnosis`, `resolution`, `inventorySnapshot`, `executionLog`, and every
lifecycle timestamp.

The **references** are readable. The **referents** are not.

## 2. Every path that is closed

| Path | Evidence | Result |
|---|---|---|
| Read `accounts` directly | `firestore.rules:1304` — `allow read: if isAdminOrDispatcher()` | **denied** |
| Read `locations` directly | `firestore.rules:1326` — `allow read: if isAdminOrDispatcher()` | **denied** |
| Read `equipment` directly | `firestore.rules:1490` — `allow read: if isAdminOrDispatcher()` | **denied** |
| Hold a customer read capability | `TECHNICIAN_ROLE.permissions` (`access/compatibilityRoles.ts`) lists 13 permissions; **`account.record.read` is not among them** | **not granted** |
| Governed server projection | No callable in `functions/src` returns customer/account display data; the four technician-reachable callables are `transitionWorkOrder`, `updateWorkOrderExecutionData`, `completeAssignedJob`, `createWorkOrder` — none projects customer identity | **does not exist** |
| Denormalised name on the Work Order | `types/workOrder.ts` carries `customerId`/`locationId` only, by design | **absent, and correctly so** |
| An existing governed display-name pattern | `actorDisplayName` / `useEmployeeDirectory` resolve **employee** identity, not customer | **not applicable** |
| Repository documentation that settles it | `EPIC-6-Technician-Execution-Workspace.md` §6.3 says the detail view shows *"status, priority, customer, planned parts"* but never states how `customerId` resolves, and authorises no read. `ADR-009` governs write paths and IAM, not this. No ADR, spec or DECISION addresses technician customer visibility. | **undetermined** |

## 3. Why this is a genuine authority question, not a UI one

Closing the gap requires **one** of the following, and each is an Owner-controlled decision:

1. **Widen `accounts` (and likely `locations`) Rules** so an assigned technician may read the
   referenced records — a real security-boundary change.
2. **Grant the technician Role a customer read capability** (`account.record.read` or a
   narrower new one) — a capability grant.
3. **Introduce a trusted server read** — a callable projecting a minimal customer/location
   display for a Work Order the caller is assigned to. New server read authority.
4. **Denormalise `customerName` onto the Work Order** — explicitly rejected by the Owner:
   it creates a second canonical representation of customer identity.

None is available under existing authority, so none was taken.

## 4. What F1 does instead — honest, not silent

`domain/fieldCurrentJob.js` reports customer identity as an explicit state and never guesses:

| State | Meaning |
|---|---|
| `RESOLVED` | a resolver was injected and returned a usable name |
| `NOT_AUTHORIZED` | the Work Order references a customer this viewer may not read |
| `ABSENT` | the Work Order carries no customer reference at all — a data gap, not a denial |
| `UNRESOLVED` | a reference exists and a resolver ran, but produced nothing usable |

Guarantees, each unit-tested:

- **A denial is never rendered as absence.** With no resolver the state is `NOT_AUTHORIZED`,
  never `ABSENT` — "you may not see this" and "there is nothing here" are operationally
  different and the screen says which.
- **No fabricated label.** A resolver returning `null`/`""`/whitespace/a non-string yields
  `UNRESOLVED`, never a placeholder name.
- **The raw id is never shown as a name.** Asserted directly.
- **It is surfaced, not hidden.** The unavailability appears in the Current Job *Attention*
  list, so the technician knows the information is missing rather than inferring it.

The seam is a single injected `customerResolver`. When an authorised path exists it is passed
in at one call site in `FieldMode.jsx`; nothing else on the screen changes.

## 5. Options, with consequences

| # | Option | Exposure | Notes |
|---|---|---|---|
| **1** | Trusted server read: a callable returning a **minimal** display projection (customer name, site/location label) for a Work Order the caller is assigned to | **Narrowest.** Exposes only the two labels, only for the caller's own assigned Work Orders, and only through a server that re-checks assignment | No Rules change. Consistent with ADR-009's "trusted backend service" posture and with how every other governed write already works. Costs one new callable. |
| 2 | Widen `accounts`/`locations` Rules to assigned technicians | **Broadest.** A technician gains read on the *whole* customer record — commercial profile, payment terms, tax status — not just a name. Scoping "only accounts I have a Work Order for" in Rules requires a `get()` per document, which is expensive and fragile | Not recommended: it grants far more than the requirement, and the governed commercial fields are exactly what `accounts` Rules were hardened to protect. |
| 3 | Grant the technician Role `account.record.read` | Broad — the same over-exposure as (2), expressed as a capability | Also entrains the reporting/permission surface. |
| 4 | Denormalise `customerName` onto the Work Order | Low exposure, high architectural cost | **Explicitly rejected by the Owner** — a second canonical representation of customer identity. Not proposed. |

**Recommendation: Option 1.** It satisfies the F1 experience requirement with the least data
exposed, changes no Rules and no capability grant, keeps canonical Customer/Account ownership
untouched, and matches the existing trusted-service architecture. The Work Order continues to
carry `customerId` only.

## 6. What was NOT stopped

Per the Owner's autonomy correction, only the dependent display work paused. Everything else in
F1 shipped: the field shell, Technician Home, the Current Job operating composition
(Context → State → Attention → Readiness → Next Best Action), consumption of the shared
WO Parts Readiness projection, the governed next-action seam, and the responsive field
presentation.
