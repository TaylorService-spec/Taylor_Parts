---
artifact_type: specification
gate: Sprint Specification
status: Approved
date: 2026-07-10
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/employee-foundation.md]
implements: []
supersedes: []
superseded_by: []
related_pr: 81
target_release: Phase 3 -- Platform Assignment Foundation
---

# Sprint Specification: Employee Foundation (Phase 3)

**Architecture Review:** `docs/assessments/employee-foundation.md` --
Architecture Assessment Approved, 2026-07-10.

## Executive summary

Builds the Employee data foundation as a **reusable platform
capability** (per the approved assessment's Executive Summary and
`docs/PROJECT_ARCHITECTURE.md`'s Person Assignment Platform Service
Standard): the `employees/{employeeId}` collection and its Firestore
Rules, the Employee/User two-way link, a reusable Employee query
service, an `AuthContext` extension to carry normalized session
identity, and the `EmployeeAssignmentPicker` component. This sprint has
**zero live consumers** by design -- the Parts and Purchase Order
Assignment Adoption sprint (already specified separately) is the first
domain to adopt it, and every future domain (Dispatch, Warehouse,
Service, Sales, Procurement, Receiving) is expected to reuse this same
foundation rather than build its own.

## Sprint objective

Ship a verified, independently-testable Employee Foundation that later
sprints can adopt without further foundational work -- collection,
rules, query service, session context, and picker all exist and work
against real (manually seeded) data, with no workflow wired to them
yet.

## Scope

- `employees/{employeeId}` Firestore collection and its Rules (both
  `firestore.rules` copies).
- `functions/scripts/provisionEmployeeAccess.js` -- the Admin SDK
  provisioning script establishing the two-way Employee/User link.
- `domain/employees.js` -- read-only Employee query service.
- `useAssignableEmployees()` hook.
- `AuthContext.jsx` extension: `employeeId`, `displayName`,
  `operationalRoles` added to session context, resolved via an
  additional one-shot read alongside the existing `users/{uid}` read --
  the existing one-shot `getDoc()` mechanism itself is preserved
  unchanged (see "AuthContext impact" below).
- `EmployeeAssignmentPicker` component, verified in isolation.
- Replacement of `functions/scripts/createPartsManagerTestUsers.js`
  with `provisionEmployeeAccess.js` (per the assessment's Section 6
  recommendation -- the old script is untracked, no PR history, zero
  migration cost to retire).

## Explicitly out of scope

Restated from the assessment's Non-Goals, binding for this sprint:

- Employee administration UI (any screen to create/edit Employee
  records beyond the Admin SDK script)
- HR integration
- Scheduling
- Skills
- Certifications
- Payroll
- Availability
- Time tracking
- Multi-company hierarchy implementation (`companyId`/`departmentId`/
  `locationId` stay Future/Reserved fields, unused)
- Any workflow adoption (Parts/Purchase Order or otherwise) -- this
  sprint builds the foundation only, per the assessment's Phase
  Completion Criteria explicitly excluding adoption from this phase
- `fieldops_technicians` migration or renaming
- Any Cloud Function deployment (Blaze-plan dependent work stays out
  of scope, matching every prior sprint in this initiative)
- Any change to `reorder_requests`, `reorder_purchase_orders`,
  `inventory_transactions`, or `inventory_actions`

## Technical design

### Data model

`employees/{employeeId}`:

```
{
  employeeId: string,       // doc ID, technical, immutable -- never a name
  displayName: string,
  firstName: string | null,
  lastName: string | null,
  employmentStatus: string, // ACTIVE | ON_LEAVE | INACTIVE | TERMINATED
                             // | RETIRED | CONTRACTOR -- see "Design
                             // decision" below
  operationalRoles: string[],
  companyId: string | null,   // Future -- reserved, unused this sprint
  departmentId: string | null, // Future -- reserved, unused this sprint
  locationId: string | null,   // Future -- reserved, unused this sprint
  userId: string | null,      // nullable link to users/{uid}
  createdAt: number,
  updatedAt: number,
}
```

**Design decision -- `employmentStatus` is the authoritative business
lifecycle state, not an `active` boolean.** Per ChatGPT's review:
`employmentStatus` (`ACTIVE`/`ON_LEAVE`/`INACTIVE`/`TERMINATED`/
`RETIRED`/`CONTRACTOR`) ships as the real field in Phase 3 -- `active`
is not introduced as the authoritative field and is not part of the
initial schema at all. For Phase 3 assignment eligibility, an Employee
is eligible only when `employmentStatus == "ACTIVE"`. A future `active`
query projection may be considered later, but only if a demonstrated
query or performance requirement justifies it -- not built speculatively
now.

**Design decision -- no `email` field on Employee.** Employee owns
workforce identity; Firebase Authentication owns the credential/account
email. `email` is not part of the Employee schema in Phase 3. See
"Provisioning contract" below for how `provisionEmployeeAccess.js`
still accepts an email as an *execution input* (to locate/create the
Firebase Auth account) without persisting it to the Employee record. An
Employee *work-contact* email may be considered later, but only once a
real business requirement establishes it as Employee data -- not
assumed now. No `BusinessEntityModel.md` change is proposed by this
sprint.

`users/{uid}`: unchanged. Gains no new fields from this sprint at the
schema level -- `employeeId` was already named as the link field in
governance; this sprint is what actually starts writing it, via
`provisionEmployeeAccess.js` only.

### Employee/User linkage

Two-way pointer pair, per governance: `employees/{employeeId}.userId`
<-> `users/{uid}.employeeId`. Established exclusively by
`provisionEmployeeAccess.js` (Admin SDK, manual, local, run against the
live project) -- there is no client-side path to this write, because
`users/{uid}` write is unconditionally `false` for every role,
including admin. `provisionEmployeeAccess.js` covers the four
provisioning cases the assessment identified:

1. Create Employee without access (`userId: null`).
2. Grant application access (create/locate Firebase Auth user, write
   `users/{uid}`, set both sides of the link).
3. Update `operationalRoles` (Employee-side only, no `users/{uid}`
   write, no security-role change).
4. Update security `role` (`users/{uid}` only, no Employee-side write).

**Provisioning contract.** Script inputs: `employeeId`, `displayName`,
`email`, `securityRole`, `operationalRoles`. Per ChatGPT's review, no
`companyId` input in Phase 3 -- a tenancy/security-relevant parameter
must either be fully implemented and enforced, or be absent, never
accepted-and-ignored. `companyId` is added only in a future
multi-company sprint, once Company exists as an implemented entity,
Employee company ownership is authoritative, Firestore Rules enforce
the boundary, queries actually apply it, and tests prove cross-company
isolation. `email` is an **execution input only** -- used to call
`auth.getUserByEmail()`/ `auth.createUser()` to locate or create the
Firebase Auth account -- and
is never written to `employees/{employeeId}` or persisted anywhere
beyond that Auth-side lookup. This preserves the authority split:
Firebase Authentication owns the credential/account email; Employee
owns workforce identity and never duplicates it. Never prints or
commits credentials, passwords, or reset links -- same discipline as
every existing Admin SDK script in this repo.

### AuthContext impact (current Employee session resolution)

`AuthContext.jsx` grows from `{ user, role, login, logout, loading }`
to `{ user, role, employeeId, displayName, operationalRoles, login,
logout, loading }`. Per ChatGPT's review, this sprint **preserves the
existing auth-state-driven one-shot `getDoc(doc(db, USERS_COLLECTION,
u.uid))` read** -- it is not converted to `onSnapshot()` in Phase 3.
`role` and `employeeId` continue to be read from that same one-shot
`users/{uid}` document read, unchanged in mechanism from today.

Resolving the linked Employee record is an *additional* one-shot
`getDoc(doc(db, EMPLOYEES_COLLECTION, employeeId))`, performed only
when `employeeId` is non-null, added to the same `onAuthStateChanged`
callback that already runs the `users/{uid}` read -- the smallest
change consistent with the existing code structure, not a new
subscription model. This exposes the Employee identity fields
(`displayName`, `operationalRoles`) future consumers need, without
altering how `role`/`employeeId` themselves are loaded. This read is
authorized by the Firestore Rules self-read path (see "Firestore Rules
impact" below) -- a technician's `AuthContext` can resolve their own
linked Employee record without being granted any broader directory
access, which the admin/dispatcher-only read alone could not have
supported.

**Missing `employeeId` is a valid, expected state, not an error.** If
`users/{uid}.employeeId` is null (true for every existing account until
`provisionEmployeeAccess.js` is run against it),
`employeeId`/`displayName`/`operationalRoles` resolve to `null`/`null`/
`[]` respectively, and no Employee-side read is attempted. This is the
expected state for every current account immediately after this sprint
ships -- no account is retroactively linked by this sprint (see
Migration strategy).

**Newly provisioned linkage requires a fresh session to resolve.**
Because both reads are one-shot, tied to `onAuthStateChanged` firing
(sign-in, not a live subscription), an account that gets
`provisionEmployeeAccess.js`-linked *while already signed in* will not
see `employeeId`/`displayName`/`operationalRoles` populate until that
session signs out and back in. This is a deliberate, documented
limitation of the smallest-change approach chosen here, not an
oversight -- a realtime User/access-identity subscription (which would
resolve this) is explicitly deferred to a separate, future sprint, per
ChatGPT's review: that change affects every authenticated session
platform-wide and is not required to establish the Employee Foundation
itself. The Notification Panel's prior `onSnapshot()` conversion
(PRs #73/#74) is not cited as sufficient justification for this
different decision -- authentication/session-identity resolution and a
notification read carry different risk profiles, and are evaluated
independently.

### Firestore Rules impact

New `employees/{employeeId}` match block, both `firestore.rules`
copies. Per ChatGPT's review, the read rule supports **two read paths**,
not one -- AuthContext must resolve the signed-in user's own linked
Employee for every security role, including technician, which
admin/dispatcher-only read cannot support.

**A. Assignment-directory read** -- admin/dispatcher may read
assignment-eligible Employee records, as already established for every
other Reorder-Request-adjacent collection.

**B. Current-Employee self-read** -- any authenticated User may read
only the one Employee document whose `employeeId` equals
`users/{request.auth.uid}.employeeId`. A technician must not gain
broad directory access -- only their own linked record, if any. A
missing `users/{uid}.employeeId` remains a valid migration state and
must grant access to no Employee record at all (not a wildcard, not a
default).

Conceptual rule shape (exact syntax remains implementation-time work):

```
match /employees/{employeeId} {
  allow read: if isAdminOrDispatcher()
    || (
      isSignedIn()
      && get(
        /databases/$(database)/documents/users/$(request.auth.uid)
      ).data.employeeId == employeeId
    );
  allow create, update, delete: if false;
}
```

Architectural contract approved:

- No authenticated client may create, update, or delete Employee
  records, in any role, including admin -- matches this project's
  existing conservative posture (`users/{uid}` has never had a client
  write path either).
- Employee/User linkage is established exclusively through trusted
  Admin SDK tooling (`provisionEmployeeAccess.js`).
- `users/{uid}` client `write: if false` remains unchanged.
- Employee Administration UI remains explicitly out of scope -- a
  client-side Employee write path is deferred to a future,
  separately-specified sprint, avoiding designing an authorization
  model for a UI that doesn't exist yet, consistent with "do not
  weaken security to make the UI easier."
- A technician (or any role) must never be able to read another
  Employee's record via the self-read path -- the `get()` comparison
  binds the read strictly to the caller's own `employeeId`, not a
  broader match.
- Rule `get()`/cross-document read call usage must be checked against
  Firestore's per-request rule evaluation limits during implementation
  -- this self-read path adds one `get()` call to every Employee read
  attempt (directory reads already pay this cost via
  `isAdminOrDispatcher()`; self-reads pay it for the first time on this
  collection), not assumed free.

`users/{userId}` rule: **zero change** -- `allow read: if isSignedIn()
&& request.auth.uid == userId; allow write: if false` stays exactly as
it is.

No other collection's rules change. Both `firestore.rules` copies must
remain byte-identical after this change (currently confirmed
identical) -- verified via `diff` as part of this sprint's validation,
not assumed.

### Employee query service

`domain/employees.js` (read-only):
- Exports a query-building function reading `employees`, filtered by
  `employmentStatus == "ACTIVE"` (the Phase 3 assignment-eligibility
  rule -- see "Data model" above), optionally `operationalRoles
  array-contains <role>`, optionally `userId != null` (when
  `requireLinkedUser` is set).
- No write functions -- this collection's only writer is
  `provisionEmployeeAccess.js` (Admin SDK), matching how
  `inventory_transactions` is Admin-SDK-only-write with a client-side
  read-only query layer.

`useAssignableEmployees({ requiredOperationalRole, requireLinkedUser =
true, enabled = true })` -> `{ employees, loading, error }`:
- `onSnapshot()`-based, not one-shot -- required by this project's
  established standard.
- No `companyId` parameter in Phase 3. Per ChatGPT's review, a
  tenancy/security-relevant filter must be fully implemented and
  enforced or entirely absent -- accepting a `companyId` param and
  silently ignoring it would be worse than not having it. Added only
  in a future multi-company sprint under the conditions stated in
  "Employee/User linkage" above.
- No composite Firestore index required for the `==`/`array-contains`
  combination used (confirmed against this project's existing
  `useReorderRequestsAssignedTo()` precedent, which already combines
  two `==` filters with no index); the `!=` filter for
  `requireLinkedUser` needs its own indexing behavior confirmed during
  implementation, not assumed clean by analogy.

### EmployeeAssignmentPicker

`EmployeeAssignmentPicker.jsx` (exact directory TBD at implementation
time -- `field-ops-app-vite/src/shared/` vs. a new `assignment/`
subfolder is a naming call, not an architecture one). Props:
`{ requiredOperationalRole, requireLinkedUser, selectedEmployeeId,
onSelect, disabled, label, placeholder }`. No `companyId` prop in Phase
3, for the same reason `useAssignableEmployees()` has none -- see
"Employee query service" above. Eligibility is entirely inherited from
`useAssignableEmployees()` -- the picker applies no separate filtering
logic of its own, so an Employee only ever appears as selectable when
`employmentStatus == "ACTIVE"` and (when `requireLinkedUser` is set)
has a non-null `userId`. Consumes `useAssignableEmployees()` directly
-- no separate data-fetching logic in the component itself.

**Required UX -- Phase 3 schema only.** Per ChatGPT's review, option
display uses only fields that actually exist in the Phase 3 Employee
schema: `displayName` and `operationalRoles`. No `department`/job-title
display -- neither field exists in the Phase 3 schema, and requiring
one would mean displaying data the platform doesn't actually have.
Otherwise: searchable; loading, empty, error, and selected states;
**no UID visible in the normal UX, no manual UID text field anywhere
in this component.** Organizational context (department, location, job
title) may be added to the picker once those fields exist as real,
governed Employee data -- not before.

`onSelect` payload: `{ employeeId, userId, displayName,
operationalRoles }` -- no `department`, matching the Phase 3 schema
exactly. This still matches `PROJECT_ARCHITECTURE.md`'s standard
assignment value shape for every field that exists today, so a future
consumer (the Parts and Purchase Order Assignment Adoption sprint) can
map it directly onto assignment-write fields with no translation
layer; the payload grows to include `department`/similar only once
those fields are real.

**Verification without a live consumer:** since this sprint has zero
workflow adoption, the picker is manually verified against seeded test
Employee data (created via `provisionEmployeeAccess.js` runs) in a
throwaway harness or an existing screen temporarily wired for manual
testing and then unwired -- not left half-integrated into any real
workflow.

## Migration strategy

No data migration in this sprint. No existing `users/{uid}` document
is retroactively linked to an Employee record -- every account's
`employeeId` remains null until an explicit `provisionEmployeeAccess.js`
run links it, one account at a time, the same manual process
`assignTechnicianToUser.js` already established for the
technician-linking case. This is intentional, not a gap: retroactively
inferring Employee identity from existing `users/{uid}` documents would
require guessing `displayName`/`operationalRoles` from data that
doesn't currently exist (`users/{uid}` has no name field today), which
the assessment already flagged as not safely inferable.

`fieldops_technicians` and its existing linkage pattern
(`users/{uid}.technicianId`) are completely unaffected -- no migration,
no schema change, no re-pointing to Employee.

## Testing strategy

- **Rules simulator**: exercise the new `employees/{employeeId}` rule
  against both read paths, required per ChatGPT's review:
  - Admin directory read succeeds.
  - Dispatcher directory read succeeds.
  - Technician self-read (own linked `employeeId`) succeeds.
  - Technician read of another Employee's record is denied.
  - A User with no `users/{uid}.employeeId` is denied every Employee
    read (not granted a default/wildcard).
  - Mismatched User/Employee linkage (a forged or stale `employeeId`
    that doesn't match the caller's own `users/{uid}.employeeId`) is
    denied.
  - Every client-side create/update/delete attempt fails regardless of
    role, including admin.
  - Confirm the added `get()` call for the self-read path stays within
    Firestore's per-request rule evaluation limits -- checked during
    implementation, not assumed.
- **Provisioning script**: exercise `provisionEmployeeAccess.js` for
  each provisioning case (new Employee without access; grant access to
  an existing Employee; operational-role update; security-role update)
  in an emulator or other approved non-production environment where
  possible, verifying the resulting documents directly via Firestore
  reads, not just script output. See "Acceptance criteria" below for
  how this relates to merge and to any live-project run.
- **Query service**: seed several Employee records with varying
  `employmentStatus`/`operationalRoles`/`userId` combinations; verify
  `useAssignableEmployees()` returns exactly the expected subset for
  each filter combination (including that `ON_LEAVE`/`INACTIVE`/
  `TERMINATED`/`RETIRED`/`CONTRACTOR` Employees are correctly excluded,
  not just that `ACTIVE` ones are included).
- **AuthContext regression**: manually verify sign-in and role-gated
  navigation/access still work correctly for all three existing
  security roles (admin/dispatcher/technician), confirming the
  preserved one-shot `users/{uid}` read behavior is unchanged and the
  additional Employee-side read doesn't introduce a regression -- this
  touches code every authenticated session depends on, so this is not
  optional or assumed-safe-by-analogy even though the read mechanism
  itself isn't changing.
- **Sign-out/sign-in linkage behavior**: manually verify that an
  account provisioned with a new Employee link *while already signed
  in* does not see `employeeId`/`displayName`/`operationalRoles`
  populate until a fresh sign-in -- confirming the documented
  limitation behaves as specified, not silently differently.
- **EmployeeAssignmentPicker**: manual verification against seeded
  data for all required UX states (loading/empty/error/populated/
  selected/searched), confirmed no UID is visible anywhere in the
  normal rendering path.
- **Regression**: `npm run build && npm run lint` clean; confirm no
  existing screen (Parts, Work Orders, Dispatch, etc.) regresses --
  this sprint should be additive-only to every existing surface.

## Risks

- **The Employee self-read rule is a new rule shape for this
  collection** -- a `get()`-based cross-document comparison gating a
  *read*, not just pinning a write, is precedented elsewhere in this
  repo (`reorder_purchase_orders`' create rule) but is new for a
  read-authorization decision. Budget explicit rules-simulator coverage
  for all six required cases (Section "Testing strategy"), not just
  the straightforward admin/dispatcher path.
- **Admin-SDK-only `employees` write path (Section "Firestore Rules
  impact") means zero Employee records exist in any environment until
  someone manually runs `provisionEmployeeAccess.js`.** This is by
  design, but it means the *next* sprint (Parts/PO adoption) has a
  hard dependency on real provisioning runs having happened first, not
  just code existing -- flag this explicitly in that sprint's own
  testing plan, don't assume it's covered here.
- **AuthContext is still the one piece every authenticated user's
  session depends on**, even with the one-shot read mechanism
  preserved unchanged -- adding the Employee-side read still touches
  code every session runs through. Budget proportionally more manual
  regression testing here than elsewhere, even though this sprint
  deliberately avoids the larger realtime-conversion risk by not
  changing the existing read mechanism.
- **Sign-out/sign-in-to-resolve-new-linkage is a real, user-visible
  limitation, not just an implementation footnote.** A Parts Manager
  provisioned mid-session won't see their own Employee identity resolve
  until they sign out and back in -- this needs to be communicated to
  whoever runs `provisionEmployeeAccess.js` operationally, not just
  documented here.
- **`EmployeeAssignmentPicker` verified only in isolation** -- there is
  a real (if small) risk its `onSelect` payload shape or eligibility
  filtering has a mismatch that only surfaces once a real consumer
  wires it up in the next sprint. Acceptable given the assessment's
  own sequencing rationale (no live consumer exists yet to test
  against), but not a zero-risk trade-off.
- **A future decision to add an Employee work-contact email would need
  its own governance update first** -- not a risk to this sprint (no
  `email` field is introduced), but worth flagging so a later sprint
  doesn't add the field to the schema without updating
  `BusinessEntityModel.md` Section 8a first, the same discipline this
  sprint follows by explicitly not adding it without that update.

## Dependencies

- `docs/assessments/employee-foundation.md` (Architecture Assessment
  Approved) -- this specification implements it directly.
- `docs/PROJECT_ARCHITECTURE.md`'s Person Assignment Platform Service
  Standard and `docs/BusinessEntityModel.md` Section 8a (PR #79,
  merged) -- the governance this sprint builds against.
- No dependency on the Parts and Purchase Order Assignment Adoption
  sprint's specification -- that sprint depends on this one, not the
  reverse.
- No dependency on Firebase Blaze plan, Cloud Functions deployment, or
  any other currently-blocked platform capability.

## Acceptance criteria

- [ ] `employees/{employeeId}` collection and Rules exist in both
      `firestore.rules` copies, confirmed byte-identical via `diff`.
- [ ] Rules simulator confirms all six required cases: admin directory
      read succeeds; dispatcher directory read succeeds; technician
      self-read of their own linked Employee succeeds; technician read
      of another Employee is denied; a User with no `employeeId` is
      denied every Employee read; mismatched User/Employee linkage is
      denied. All client create/update/delete attempts fail for every
      role, including admin.
- [ ] No `companyId` parameter exists on `useAssignableEmployees()`,
      `EmployeeAssignmentPicker`, the query service, or
      `provisionEmployeeAccess.js`'s inputs.
- [ ] `provisionEmployeeAccess.js` exists and has been exercised for
      all four provisioning cases (create without access, grant access,
      operational-role update, security-role update) in an emulator or
      other approved non-production environment. **Merge approval does
      not itself authorize any production data mutation.** A controlled
      initial live-project provisioning run is a separately, explicitly
      authorized operational step by the project owner, which may occur
      after this PR merges -- it is not a merge blocker, and is never
      run automatically. No secret, password, or reset link is ever
      stored or committed at any point.
- [ ] `functions/scripts/createPartsManagerTestUsers.js` is removed,
      replaced by `provisionEmployeeAccess.js`.
- [ ] `domain/employees.js` + `useAssignableEmployees()` exist, use
      `onSnapshot()`, and return correct filtered results against real
      seeded data for every documented filter combination, including
      correct exclusion of non-`ACTIVE` `employmentStatus` values.
- [ ] `AuthContext` exposes `employeeId`/`displayName`/
      `operationalRoles`; the existing one-shot `users/{uid}` read
      mechanism is unchanged; zero regression in role-based access for
      admin/dispatcher/technician; the sign-out/sign-in-to-resolve-new-
      linkage behavior is verified and documented.
- [ ] `EmployeeAssignmentPicker` exists, satisfies the required UX
      (name/operational role, searchable, all required states, no UID
      visible, no manual UID field, no `department`/job-title display
      or `companyId` prop), verified against seeded data, with
      eligibility correctly limited to `employmentStatus == "ACTIVE"`.
- [ ] No `email` field exists anywhere on `employees/{employeeId}`; no
      `BusinessEntityModel.md` change is made by this sprint.
- [ ] No Non-Goal item (Employee admin UI, HR/scheduling/skills/
      certification/payroll/availability/time-tracking, multi-company
      hierarchy) is present in any form.
- [ ] `npm run build && npm run lint` pass clean.
- [ ] Zero workflow (Parts/PO or otherwise) is wired to consume this
      foundation as part of this sprint -- confirmed by diffing that no
      existing workflow file (`domain/inventoryReorderRequests.js`,
      `PartDetail.jsx`, etc.) changed.

## Recommended implementation sequence

Per ChatGPT's review, AuthContext resolution and EmployeeAssignmentPicker
are separate architectural concerns and are not bundled into one PR.
Revised to four PRs:

1. **PR 1 -- Employee Data and Read Foundation.** `employees/{employeeId}`
   Rules (both `firestore.rules` copies) implementing both the
   assignment-directory read and the current-Employee self-read paths,
   `domain/employees.js`, `useAssignableEmployees()` (no `companyId`
   param), the `employmentStatus` contract (`ACTIVE`-only eligibility),
   and the full rules-simulator test suite specified in "Testing
   strategy" (all six read-path cases, not just the directory path).
2. **PR 2 -- Trusted Employee/User Provisioning.**
   `provisionEmployeeAccess.js`, establishing the Employee/User
   bidirectional link; retires
   `functions/scripts/createPartsManagerTestUsers.js` in the same PR
   (untracked, no PR history, zero migration cost).
3. **PR 3 -- Current Employee Session Resolution.** `AuthContext`'s
   additional Employee-side read, preserving the existing one-shot
   `users/{uid}` role-loading mechanism unchanged, with migration-safe
   missing-link handling and authentication regression testing.
4. **PR 4 -- EmployeeAssignmentPicker Foundation.** The reusable
   component, verified via an isolated test/demo harness -- no
   production workflow adoption in this PR.

One architectural concern per PR, matching `docs/ai/workflow.md`. This
is a recommended sequence, not the Implementation Plan itself -- per
instruction, no Implementation Plan is produced by this specification.

## Approval

**Approved by ChatGPT, 2026-07-10.** See
`docs/reviews/employee-foundation-architecture-review.md` for the
review record. Implementation proceeds per
`docs/implementation-plans/employee-foundation.md`.
