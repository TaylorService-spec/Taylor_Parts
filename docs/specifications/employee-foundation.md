---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-07-10
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/employee-foundation.md]
implements: []
supersedes: []
superseded_by: []
related_pr:
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
  `operationalRoles` added to session context; one-shot `getDoc()`
  converted to `onSnapshot()`.
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
  email: string | null,
  firstName: string | null,
  lastName: string | null,
  active: boolean,          // Phase 3 implementation of governance's
                             // employmentStatus concept -- see "Design
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

**Design decision -- `active: boolean`, not the full `employmentStatus`
enum.** `docs/BusinessEntityModel.md` Section 8a already states
`employmentStatus` is "Reserved... Not implemented in code in this
phase," and that "an `active` boolean may still exist later as a
convenience/query projection derived from this." Phase 3 implements
`active: boolean` now; the full `employmentStatus` enum
(`ACTIVE`/`ON_LEAVE`/`INACTIVE`/`TERMINATED`/`RETIRED`/`CONTRACTOR`)
remains reserved for a future migration, per governance's own stated
sequencing -- this is not a new decision, it's applying what governance
already specified.

**Design decision -- `email` added to the schema.** Not present in
Section 8a's field table. Required for `provisionEmployeeAccess.js` to
resolve/verify a Firebase Auth user via `getUserByEmail()`, mirroring
`createPartsManagerTestUsers.js`'s existing `{email, displayName}`
shape. Recommend a small follow-up addition to
`BusinessEntityModel.md` Section 8a's field table in the same PR that
implements this collection, keeping governance and schema in sync --
not a separate governance PR, since it's an additive, non-controversial
field, not a re-litigation of the model.

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

Script inputs: `employeeId`, `displayName`, `email`, `securityRole`,
`operationalRoles`, `companyId` (optional, unused this sprint but
accepted for forward compatibility). Never prints or commits
credentials, passwords, or reset links -- same discipline as every
existing Admin SDK script in this repo.

### AuthContext impact

`AuthContext.jsx` grows from `{ user, role, login, logout, loading }`
to `{ user, role, employeeId, displayName, operationalRoles, login,
logout, loading }`. The existing one-shot `getDoc(doc(db,
USERS_COLLECTION, u.uid))` converts to `onSnapshot()`, and a second,
dependent `onSnapshot()` resolves `employees/{employeeId}` once
`employeeId` is known from the `users/{uid}` read -- consistent with
this project's established realtime-over-one-shot standard
(`useFirestoreCollection.js`, and the PRs #73/#74 precedent for
converting exactly this kind of read).

If `users/{uid}.employeeId` is null (no linked Employee -- true for
every existing account until `provisionEmployeeAccess.js` is run
against it), `employeeId`/`displayName`/`operationalRoles` resolve to
`null`/`null`/`[]` respectively. This is the expected state for every
current account immediately after this sprint ships -- no account is
retroactively linked by this sprint (see Migration strategy).

### Firestore Rules impact

New `employees/{employeeId}` match block, both `firestore.rules`
copies:

```
match /employees/{employeeId} {
  allow read: if isAdminOrDispatcher();
  allow create, update: if false;
  allow delete: if false;
}
```

**Design decision -- Admin-SDK-only, no client write path in Phase
3.** Matches the assessment's recommended default and this project's
existing conservative posture (`users/{uid}` has never had a client
write path either). A client-side Employee Administration write path
is explicitly deferred to a future, separately-specified sprint --
choosing this now avoids designing an authorization model for a UI
that doesn't exist yet, consistent with "do not weaken security to
make the UI easier."

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
  `active == true`, optionally `operationalRoles array-contains
  <role>`, optionally `userId != null` (when `requireLinkedUser` is
  set).
- No write functions -- this collection's only writer is
  `provisionEmployeeAccess.js` (Admin SDK), matching how
  `inventory_transactions` is Admin-SDK-only-write with a client-side
  read-only query layer.

`useAssignableEmployees({ requiredOperationalRole, companyId,
requireLinkedUser = true, enabled = true })` -> `{ employees, loading,
error }`:
- `onSnapshot()`-based, not one-shot -- required by this project's
  established standard.
- `companyId` param accepted but not applied to the query this sprint
  (Company doesn't exist as an implemented entity) -- forward-
  compatible signature, inert filter.
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
`{ requiredOperationalRole, companyId, requireLinkedUser,
selectedEmployeeId, onSelect, disabled, label, placeholder }`. Consumes
`useAssignableEmployees()` directly -- no separate data-fetching logic
in the component itself.

Required UX (governance-mandated, restated for implementation
clarity): employee name, operational role, and department/job title
(when available) displayed per option; searchable; loading, empty,
error, and selected states; **no UID visible in the normal UX, no
manual UID text field anywhere in this component.**

`onSelect` payload: `{ employeeId, userId, displayName,
operationalRoles, department }` -- matches
`PROJECT_ARCHITECTURE.md`'s standard assignment value shape exactly,
so a future consumer (the Parts and Purchase Order Assignment Adoption
sprint) can map it directly onto assignment-write fields with no
translation layer.

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
  -- confirm `isAdminOrDispatcher()` read succeeds, technician read
  fails, and every client-side create/update/delete attempt fails
  regardless of role (including admin).
- **Provisioning script**: run `provisionEmployeeAccess.js` against the
  live `taylor-parts` project at least once per provisioning case (new
  Employee without access; grant access to an existing Employee;
  operational-role update; security-role update) and verify the
  resulting documents directly via Firestore reads, not just script
  output.
- **Query service**: seed several Employee records with varying
  `active`/`operationalRoles`/`userId` combinations; verify
  `useAssignableEmployees()` returns exactly the expected subset for
  each filter combination.
- **AuthContext regression**: manually verify sign-in and role-gated
  navigation/access still work correctly for all three existing
  security roles (admin/dispatcher/technician) after the
  one-shot-to-`onSnapshot()` conversion -- this touches code every
  authenticated session depends on, so this is not optional or
  assumed-safe-by-analogy.
- **EmployeeAssignmentPicker**: manual verification against seeded
  data for all required UX states (loading/empty/error/populated/
  selected/searched), confirmed no UID is visible anywhere in the
  normal rendering path.
- **Regression**: `npm run build && npm run lint` clean; confirm no
  existing screen (Parts, Work Orders, Dispatch, etc.) regresses --
  this sprint should be additive-only to every existing surface.

## Risks

- **Admin-SDK-only `employees` write path (Section "Firestore Rules
  impact") means zero Employee records exist in any environment until
  someone manually runs `provisionEmployeeAccess.js`.** This is by
  design, but it means the *next* sprint (Parts/PO adoption) has a
  hard dependency on real provisioning runs having happened first, not
  just code existing -- flag this explicitly in that sprint's own
  testing plan, don't assume it's covered here.
- **AuthContext's realtime conversion is the highest-blast-radius
  single change in this sprint** -- it's the one piece every
  authenticated user's session depends on, unlike the other four
  pieces, which are net-new and additive. Budget proportionally more
  manual regression testing here than elsewhere.
- **`EmployeeAssignmentPicker` verified only in isolation** -- there is
  a real (if small) risk its `onSelect` payload shape or eligibility
  filtering has a mismatch that only surfaces once a real consumer
  wires it up in the next sprint. Acceptable given the assessment's
  own sequencing rationale (no live consumer exists yet to test
  against), but not a zero-risk trade-off.
- **Adding `email` to the Employee schema without a governance-doc
  update landing first** creates a brief window where implementation
  and `BusinessEntityModel.md` Section 8a disagree, if the doc update
  isn't bundled into the same PR as intended. Mitigate by treating the
  small governance addition as part of this sprint's own PR, not a
  follow-up.

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
- [ ] Rules simulator confirms: admin/dispatcher read succeeds,
      technician read fails, all client create/update/delete attempts
      fail for every role.
- [ ] `provisionEmployeeAccess.js` exists and has completed at least
      one real, verified run against the live project for each of the
      four provisioning cases (create without access, grant access,
      operational-role update, security-role update).
- [ ] `functions/scripts/createPartsManagerTestUsers.js` is removed,
      replaced by `provisionEmployeeAccess.js`.
- [ ] `domain/employees.js` + `useAssignableEmployees()` exist, use
      `onSnapshot()`, and return correct filtered results against real
      seeded data for every documented filter combination.
- [ ] `AuthContext` exposes `employeeId`/`displayName`/
      `operationalRoles`, resolved via `onSnapshot()`, with zero
      regression in role-based access for admin/dispatcher/technician.
- [ ] `EmployeeAssignmentPicker` exists, satisfies the required UX
      (name/role/department, searchable, all required states, no UID
      visible, no manual UID field), verified against seeded data.
- [ ] `BusinessEntityModel.md` Section 8a's field table includes
      `email`, landed in the same PR as the schema that adds it.
- [ ] No Non-Goal item (Employee admin UI, HR/scheduling/skills/
      certification/payroll/availability/time-tracking, multi-company
      hierarchy) is present in any form.
- [ ] `npm run build && npm run lint` pass clean.
- [ ] Zero workflow (Parts/PO or otherwise) is wired to consume this
      foundation as part of this sprint -- confirmed by diffing that no
      existing workflow file (`domain/inventoryReorderRequests.js`,
      `PartDetail.jsx`, etc.) changed.

## Recommended implementation sequence

Per the assessment's Section 11 (Migration sequencing), formalized as
PR breakdown (one architectural concern per PR):

1. **PR 1** -- `employees` collection Rules (both copies) +
   `domain/employees.js` + `useAssignableEmployees()` +
   `BusinessEntityModel.md` Section 8a's `email` field addition.
2. **PR 2** -- `provisionEmployeeAccess.js`, with at least one real
   verified provisioning run recorded in the PR description (not just
   code review) before merge; retires
   `createPartsManagerTestUsers.js` in the same PR.
3. **PR 3** -- `AuthContext` changes + `EmployeeAssignmentPicker`,
   verified in isolation.

This is a recommended sequence, not the Implementation Plan itself --
per instruction, no Implementation Plan is produced by this
specification.

## Approval

Pending ChatGPT review and recorded approval before Implementation
begins.
