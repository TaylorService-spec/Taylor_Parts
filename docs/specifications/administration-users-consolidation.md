---
artifact_type: specification
gate: Implementation Specification
status: Implemented
date: 2026-09-05
owner: Claude Code
related_adrs: []
depends_on:
  - docs/specifications/employee-foundation.md
  - docs/specifications/enterprise-access-and-administration-platform.md
  - docs/specifications/admin-password-reset-ui.md
implements: []
supersedes: []
superseded_by: []
target_release: Administration Users Consolidation
---

# Administration → Users: consolidation, User Detail, and the shared Change History

## What this is

Administration used to carry **two** people destinations:

| Destination | What it was |
|---|---|
| **Employees** (`/administration`, the domain index) | The governed employee directory — a metadata list over `employees`, with no record page and deliberately inert rows. |
| **Users** (`/administration/users`) | A governance status page: two permanently-disabled Enable/Disable buttons with no particular user selected, plus a password-reset surface that had to fetch its own candidate list to find a target. |

Neither was somewhere an administrator could go to find a person and then see or change anything
about them. This consolidates them into **one** destination — **Administration → Users** — and adds
the record page, the edit flow, and the record-history pattern that were missing.

## The consolidation is PRESENTATIONAL. The authorities are unchanged.

This is the load-bearing sentence of the whole change, and every file in it repeats some version of
it. What did **not** happen:

| Concern | Authority, unchanged |
|---|---|
| Workforce identity | `employees/{employeeId}` — the authoritative workforce record. Still the only people register. |
| Application/access identity | `users/{uid}` + Firebase Auth. Still separate, still client-unreadable except for a self-read. |
| Operational eligibility | `employees.operationalRoles[]` — eligibility markers consumed as **Conditions** by `firestore.rules`' `isActiveOperationalRole()`. Never a permission. |
| Security role | `employees.securityRole` remains a **denormalized, read-only mirror** of `users/{uid}.role`. Governed Role authority stays with `grantRole` / `assignApprovedRole`. |
| Account enable/disable | The `setUserStatus` trusted command (`functions/src/access/trustedWriterCommands.ts`), unchanged. |
| Password reset | The AUTH-PR-3 governed callable and its client seam, unchanged — moved, not reimplemented. |
| Firestore Rules | **Not touched.** `employees` stays `allow create, update, delete: if false`; `auditEvents` stays client-read-denied. |

## The product decisions this records

1. **Employees and Users are consolidated in the UI under "Users."** One nav item, one directory,
   one place to look a person up.
2. **Employee remains the workforce identity underneath**, and is what the Users directory reads.
3. **User access remains a separate governed concept underneath.** The page is one; the authorities
   are not.
4. **User Detail is the operational profile** — who this person is, what they do, who they report
   to, whether they are active, and what access they hold.
5. **A record is READ-ONLY by default.** A row click opens the record to read.
6. **Edit User is deliberate** — a button, or the directory's explicit Edit action. Clicking a row
   never makes a field editable.
7. **Operational Roles and Security Role are independent.** Neither is derived from the other, in
   either direction, anywhere.
8. **Employment Status and EOS Account Status are independent.** Terminating employment switches no
   account off; disabling an account rewrites no employment record.
9. **Password reset belongs to User Detail → EOS Access & Security**, where the target is the
   record rather than a row picked from a list the surface had to fetch.
10. **Change History is a shared EOS record-detail pattern**, not a Users feature.
11. **Change History supports Field filtering and column sorting**, with the filter options derived
    from the actual history rather than declared.

## Navigation and routes

```
Administration
  Overview
  Users                ← the one people destination
  Roles & Permissions
  Objects
  Permission Preview
  …
```

The `employees` nav item is **removed**, not hidden — a hidden item still generates a route, and a
hidden "Employees" route rendering the Users directory is the two-directories state this exists to
end. `EmployeesList.jsx` is deleted; `AdminUsers.jsx` is the directory.

Retired URLs redirect, because "Employees" held the domain **index** path and both addresses are
bookmarked:

| Retired | Redirects to |
|---|---|
| `/administration` | `/administration/users` |
| `/administration/employees` | `/administration/users` |

Both are static segments (and an index), so React Router ranks them above the dynamic
`:employeeId` sibling and neither can ever be read as a record id.

New route: **`/administration/users/:employeeId`** — the User Detail record page, gated by
`isDomainVisible()` so a role with no Administration access never mounts the page or its
subscription. `?edit=1` opens it with the editor already open, which is where the directory's Edit
action lands.

## The Users directory

Columns: **User · Employment Status · Operational Roles · EOS Access · Security Role · Actions.**

- The rows come from the existing `employee.index` metadata declaration on the standard list
  runtime — the same client-direct read, sort and 50-row page the retired screen used. **No second
  read path was added.**
- **EOS Access says "Account linked" / "No account", not "Enabled" / "Disabled."** Whether an
  account is enabled is Firebase Auth state, and no governed read exposes another user's to this
  client. Deriving it from employment status would render a CONTRACTOR who legitimately holds
  access as switched off. The column is composed by post-processing the `userId` cell — the
  metadata layer accepts no custom renderer by design, and names this as what a caller does
  instead — so a raw uid never reaches a reader.
- **Security Role is labelled as the mirror it is**, in the surface's own copy.
- The **count is withheld while pages remain**, and no aggregate query was added to rescue the
  partial case.
- **No create action.** A person enters EOS through `functions/scripts/provisionEmployeeAccess.js`,
  which links a human to application access reciprocally. Creating one is an onboarding procedure,
  not a screen.

## User Detail

Sections, in order, ending with the history:

1. **Identity & contact** — names, business Employee ID, work email, work/mobile phone, address.
2. **Employment** — employment status, job title, operating company, hire/separation date, and
   **Manager as a navigable link** to that person's own User Detail.
3. **Operational assignment** — the operational roles, stated as eligibility rather than access.
4. **EOS access & security** — account linkage, account status, security role, and the two
   administrative actions.
5. **Change History** — at the bottom, always.

### `employeeNumber` is not `employeeId`

`employeeId` is the Firestore document id; the employee specification's own Data model calls it
"technical, immutable — never a name." Taylor's human-facing Employee ID had **no home in this
schema**, so a new nullable `employeeNumber` field was added and is labelled "Employee ID" in the
UI. The technical id stays internal and is never presented as a business identifier.

`employeeNumber` is deliberately **not** promoted to the entity's governed reference: it is
optional, unenforced, and absent on every record provisioned before it existed.

### What the page will not claim

- **Account status** renders "Not available", with the reason stated — no governed read of another
  user's Auth state exists.
- **No Last Sign-In / Account Created / Last Access Change rows.** All three are Auth or
  users-document facts with no read path here; rows showing "Unknown" would describe a loading
  problem rather than the truth.
- **No warehouse or territory rows.** `assignedWarehouseIds` is real and stored but there is no
  governed read that turns those ids into warehouse NAMES, and coverage is assigned to a territory
  rather than stored on a person. Both are recorded as gaps rather than rendered as raw ids.

## Edit User

One trusted command — `updateEmployeeProfile` — writes the profile. It re-authorizes server-side on
the new `admin.employeeProfile.write` capability, validates every field, and writes **one Audit
Event per changed field** in the same transaction as the document write.

**It refuses three things by name**, and the refusals are the point:

| Refused | Why |
|---|---|
| `securityRole` / `role` | A mirror. Writing it changes nobody's access and makes the directory disagree with the access model while looking authoritative. |
| `userId` | The governed Employee↔User linkage, written only by the reciprocal provisioning path. |
| account status | Firebase Auth state owned by `setUserStatus`, which also bumps `accessVersion` and resyncs claims. |

An input key outside the editable set is **rejected by name**, never ignored — a silent no-op would
leave an administrator believing a security change landed.

A save that changes nothing writes nothing (`unchanged`), and only the **changed** keys are written,
so a concurrent edit to a field this user never touched survives. Idempotency is deterministic on
the caller's key, the same mechanism the other trusted-writer commands use.

### Fields added to the Employee record

All nullable, all backward compatible, none backfilled: `employeeNumber`, `middleName`,
`preferredName`, `workEmail`, `workPhone`, `mobilePhone`, `address{street,unit,city,state,postalCode}`,
`jobTitle`, `managerEmployeeId`, `operatingCompanyId`, `hireDate`, `separationDate`. Existing
records legitimately have none of them and render honest absences.

`managerEmployeeId` is **relational**: the command validates the referenced employee exists and
refuses a self-manager; the page renders the manager as a name and a link.

`operatingCompanyId` resolves through the existing governed operating-company authority
(`domain/operatingCompanyAuthority.js` and its Functions mirror) — no duplicate master data.

## Change History (shared)

`shared/ui/ChangeHistory.jsx` + `domain/changeHistory.js` are **record-agnostic**: Customers,
Equipment, Parts, Work Orders, Purchase Orders and the Financials records mount the same component
over the same normalized row shape. Nothing in either file mentions an employee.

- Rows come from **stored, audited events** through the trusted `listRecordChangeHistory` callable.
  There is no prop through which a caller could hand it a client-computed diff.
- Default sort **Date/Time descending**. Columns: Date/Time · Field/Event · Previous · New ·
  Changed By, every one sortable (first click ascending, then toggling), with `aria-sort` on the
  header and a real `<button>` inside it.
- **Field filter options are DERIVED from the rows**, never declared — a hard-coded employee field
  list inside a shared component offers Equipment filters that can only return nothing. Changed By
  and a date range are offered on the same basis.
- An unreadable history is stated as **unavailable**, never rendered as an empty one.
- The projection is an **allow-list**: scope, `accessVersionAfter` and `approverUid` stay
  server-side, so a field added to the Audit Event contract later cannot leak by default.

## Backend surface added

| File | What it is |
|---|---|
| `functions/src/access/employeeProfileCommands.ts` | The trusted Employee profile writer. |
| `functions/src/access/recordChangeHistoryReadService.ts` | The record-scoped, capability-gated history read. |
| `functions/src/access/administrationUsersCallables.ts` | Thin `onCall` adapters; `actorUid` from the authenticated context only. |
| `functions/src/access/auditEventWriter.ts` | Extended, **not** duplicated: `updateEmployeeProfile` on the action union + runtime list, three field-change facts under a closed-carrier rule, and `listAuditEventsForRecord`. |
| `functions/src/access/permissionCatalog.ts` | `admin.employeeProfile.write`, registered active. |
| `firestore.indexes.json` | One composite: `auditEvents` (targetType ASC, targetId ASC, at DESC) — declared, not deployed. |

### The field-change facts, and the denial case

A field-change Audit Event carries `fieldKey`, `previousValue` and `newValue`. Only an action in
`FIELD_CHANGE_ACTIONS` may carry them (unconditional), and an **applied** one must (conditional on
outcome). That condition is load-bearing: a *denied* attempt changed no field, and requiring the
facts unconditionally made every denial event fail validation — meaning a refused attempt to change
somebody's employment record could not be recorded at all.

### Testability seam

`auditEventDocRef`, `stageAuditEvent`, `stageAuditEventWithId`, `recordStandaloneAuditEvent` and
`listAuditEventsForRecord` now take an **optional** Firestore, defaulting to the ambient one, so
every existing call site is unchanged. It exists because a command staging writes onto a
caller-supplied transaction is otherwise untestable without an emulator, and an emulator-gated test
is one that does not run in the suite people actually run.

## Fail-closed today, and exactly why

Everything below is built, tested and merged, and **denies in every environment right now**:

| Action | Blocker |
|---|---|
| Edit User (save) | `admin.employeeProfile.write` resolves through `roleAssignments`, and **no principal holds a `roleAssignments` document in any environment**. `bootstrapCompatibilityAdmin` exists but is not exported/callable. The capability itself is registered active and is held by the `admin` compatibility Role by derivation — no grant was invented. |
| Enable / Disable Account | The same standing blocker, on `admin.userStatus.write`. Both actions render `variant="protected"` with the reason attached to the control. |
| Change History | The same blocker on `audit.event.read`, plus: the callable is not deployed. The section renders its honest unavailable state. |
| Password reset | `admin.credentialReset.initiate` is registered `active: false`. The whole surface stays hidden, and — unlike the retired page — there is no candidate-list read left to suppress. |

Additionally, the account's **enabled/disabled state cannot be read** by this client at all. Both
Enable and Disable are therefore offered (each naming the state it sets) rather than one contextual
action; `setUserStatus` takes an explicit status rather than toggling, so this is the command's own
shape rather than a workaround.

## Open decisions this change deliberately did not make

1. **`employmentType`** was not added. `employmentStatus` already carries `CONTRACTOR`, and a
   second employment-type vocabulary alongside it would create two answers to "is this person a
   contractor". Naming the relationship between the two is a product decision.
2. **`departmentId` / `locationId` (branch)** were not added. Both were reserved-and-unused in the
   employee specification, and there is no governed department or employee-location catalog to
   reference. Adding them as free strings would create duplicate master data.
3. **A per-change `reason` note.** The Audit Event contract has no field that can carry one for a
   field-change action, and widening the immutable trail's contract to add free text is a
   governance change rather than a side effect of an edit form. Change History renders its optional
   Reason column empty for this record type until that contract exists.

## Tests

| Suite | Layer |
|---|---|
| `field-ops-app-vite/test/employeeProfileDomain.test.mjs` | Pure profile view/diff/validation + the independence rules. |
| `field-ops-app-vite/test/changeHistoryModel.test.mjs` | The record-agnostic filter/sort model. |
| `field-ops-app-vite/test/administrationUsersSurfaces.test.jsx` | The rendered directory, record page, edit flow and history. |
| `functions/test/employeeProfileCommands.test.mjs` | Refusals, authorization, per-field audit, no-op, idempotency, manager validation — no emulator. |
| `functions/test/recordChangeHistoryRead.test.mjs` | Scoping, the projection allow-list, actor resolution. |
| `.github/workflows/administration-users-tests.yml` | Registers all five in CI. |

Existing suites updated rather than deleted: `administrationPortalNav`, `navPlaceholderHonesty`,
`financialsNavStructure`, `subnavRouteDispatch`, `adminUsersReset`, `compositionConformance`,
`listsP2Compose`, `listsP2Tranche2`, `listsP2VisualContract`. In each case the assertion was
**inverted or re-pointed with the reason recorded**, never dropped — most notably the Lists P2
Tranche 2 no-record-route rule, whose Owner ruling required a record page to be a separate product
decision. That decision is this document.
