---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: 2026-07-10
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release: Phase 3 -- Platform Assignment Foundation
---

# Assessment Report: Employee Foundation (Phase 3)

**Business Request:** Build the Employee data foundation, Employee/User
linking, a reusable Employee query service, and the
EmployeeAssignmentPicker foundation -- the five prerequisites Phase 3
requires before the Parts and Purchase Order Assignment Adoption sprint
(or any other domain's assignment adoption) can begin. Governance for
this already exists and is merged (PR #79 -- `docs/PROJECT_ARCHITECTURE.md`'s
Person Assignment Platform Service Standard, `docs/BusinessEntityModel.md`
Section 8a). This assessment is about building it, not deciding whether to.

## Scope of this assessment

Covers: existing user model, `users/{uid}` schema, AuthContext, Employee
collection requirements, Employee/User relationship, provisioning
strategy, Firestore Rules implications, the Employee query service,
EmployeeAssignmentPicker foundation, legacy compatibility, and migration
sequencing -- all scoped to the Phase 3 foundation itself. Does NOT
cover Parts/Purchase Order adoption (separate, later sprint, already
specified in a prior Sprint Specification) or Employee Administration
UI (explicitly out of scope per governance). No implementation plan is
produced here -- assessment only, per instruction.

## 1. Current user model

`users/{uid}` (`field-ops-app-vite/src/domain/constants.js`'s
`USERS_COLLECTION = "users"`), verified current schema in practice:
- `role`: `"admin" | "dispatcher" | "technician"` -- read by
  `AuthContext.jsx` (`field-ops-app-vite/src/auth/AuthContext.jsx`,
  lines 22-24), one-shot `getDoc()` on every auth-state change.
- `technicianId`: optional, set only by
  `functions/scripts/assignTechnicianToUser.js`, read by
  `hooks/useCurrentTechnician.js`.

There is no "Users" page (`navConfig.js`'s `users` subnav item has no
`legacyKey` and renders `PlaceholderPage`) and no "Employee-like"
collection exists today -- `employees` is referenced only as a
**deferred** row in `docs/BusinessEntityModel.md` Section 9's Firestore
collection table, and as Section 8a's fully-specified but unimplemented
conceptual design (merged in PR #79). Confirmed zero `employees`
collection references anywhere in `field-ops-app-vite/src` (grepped
this session).

## 2. Current users/{uid} schema

Covered above (role, optional technicianId). Firestore rule (both
`firestore.rules` copies, confirmed identical): `allow read: if
isSignedIn() && request.auth.uid == userId; allow write: if false` --
unconditional, no admin exception. This is the single hardest
constraint on everything below: no client, in any role, can ever write
`users/{uid}`.

## 3. Existing AuthContext

`AuthContext.jsx` currently exposes exactly `{ user, role, login,
logout, loading }` -- confirmed via direct read, zero `employeeId`/
`operationalRoles` references anywhere in the file. `user` is the raw
Firebase Auth object; `role` is fetched via a one-shot `getDoc()`, not
`onSnapshot()`.

## 4. Employee collection requirements

Already fully specified in governance (`docs/BusinessEntityModel.md`
Section 8a) -- this assessment does not re-derive it, just confirms
what's approved and what remains an implementation decision:

**Approved, from governance:**
```
employees/{employeeId}
  employeeId          -- doc ID, technical, immutable, never a name
  displayName          -- proposed
  firstName/lastName   -- proposed
  employmentStatus      -- reserved: ACTIVE/ON_LEAVE/INACTIVE/TERMINATED/RETIRED/CONTRACTOR
  operationalRoles[]    -- proposed
  companyId             -- future (Company doesn't exist yet)
  departmentId           -- future
  locationId             -- future
  userId (nullable)      -- proposed, link to users/{uid}
  createdAt/updatedAt    -- proposed
```

**Not yet decided (implementation-level, this sprint's job):**
- Whether `employmentStatus` ships in Phase 3 or a simpler `active:
  boolean` ships first with `employmentStatus` deferred to a later
  pass -- governance explicitly allows either.
- Whether `email` is a field on Employee (used by the existing test-
  account scripts' Auth-user creation) -- not listed in Section 8a's
  field table, needs an explicit decision (recommend: yes, mirrors
  `createPartsManagerTestUsers.js`'s existing `{email, displayName}`
  shape and is needed to `getUserByEmail()` during provisioning).

## 5. Employee ↔ User relationship

Governance-approved direction (Section 8a, `PROJECT_ARCHITECTURE.md`'s
Person Assignment Platform Service Standard): `employees/{employeeId}.userId`
and `users/{uid}.employeeId` as a two-way pointer pair, matching the
relationship diagram already in `docs/BusinessEntityModel.md` Section 8
(`Employee ── 0/1:1 ── User`).

**Existing precedent for this exact pattern:**
`functions/scripts/assignTechnicianToUser.js` already does a one-way
version of this (`users/{uid}.technicianId` -> `fieldops_technicians/{id}`,
verified both docs exist before merge-writing, no reverse pointer on
the Technician doc). Phase 3's Employee/User link needs to be
**two-way** (unlike the Technician precedent), since
`EmployeeAssignmentPicker` needs to read Employee-side data
(`operationalRoles`, `active`) without a second lookup through `users`
(which it can't read broadly anyway -- self-read only).

**Consequence for provisioning:** because `users/{uid}` write is
unconditionally `false` for every client role, the two-way link can
only ever be established by an Admin SDK process.

## 6. Provisioning strategy

**Cannot be a client-side flow for the `users/{uid}` half** --
architecturally forced, not a preference. Two real options for the tool
itself:

- **Option A (recommended): a single general script**,
  `functions/scripts/provisionEmployeeAccess.js`. Inputs: `employeeId`,
  `displayName`, `email`, `securityRole`, `operationalRoles`,
  `companyId` (optional). Creates or locates the Firebase Auth user,
  writes `employees/{employeeId}`, writes `users/{uid}`, sets the
  two-way link. This directly replaces both `assignTechnicianToUser.js`
  (technician-linking use case) and the ad hoc
  `createPartsManagerTestUsers.js` (test-account provisioning use case)
  with one reusable tool.
- **Option B: keep them separate** (a narrow "create Employee only"
  script plus a narrow "link existing Employee to existing Auth user"
  script). More steps per provisioning event, smaller individual
  scripts. Not recommended -- this project's existing precedent
  (`assignTechnicianToUser.js`) is already a single combined script.

Either option is Admin SDK, manual, local-only -- **not a Cloud
Function**, matching every existing provisioning script in this repo
and avoiding any Blaze-plan dependency.

`functions/scripts/createPartsManagerTestUsers.js` (currently
untracked, uses `.claude/skills/admin-check`'s `lib.js`): should be
**replaced** by `provisionEmployeeAccess.js` once it exists, not
adapted in place. It has no PR history (never committed), so replacing
it has zero migration cost.

## 7. Firestore Rules implications

New `employees/{employeeId}` match block required -- does not exist
today. Minimum shape, per `docs/PROJECT_ARCHITECTURE.md`'s standard and
this project's existing `isAdminOrDispatcher()` helper pattern:
- `allow read: if isAdminOrDispatcher();` -- assignment-eligible
  Employee records need to be readable by anyone who can make an
  assignment.
- `allow create, update: if false;` for now, OR gated to an explicit
  Employee Administration write path -- **this is a real open decision,
  not resolved by governance**. Without *some* client write path, every
  Employee record must be created via Admin SDK script only (a valid,
  conservative starting posture, consistent with "do not weaken
  security to make the UI easier," but should be a stated choice).
- `allow delete: if false;` unconditionally -- Employee records must
  never be deleted (governance: employment status, not deletion, is
  how a departure is recorded).

`users/{userId}` rule: **zero change** -- already the correct,
preserved posture per governance.

Both `firestore.rules` copies must gain the identical new block --
currently confirmed byte-identical, that invariant must be re-verified
after this change.

## 8. Employee query service

`domain/employees.js` (read-only) and `useAssignableEmployees()` hook
-- both net-new, no existing equivalent to extend. Design, consistent
with this project's established patterns:
- Must use `onSnapshot()`, not one-shot `getDocs()`/`list()` -- a hard
  project convention (`useFirestoreCollection.js`'s own header comment
  documents *why*: a one-shot read caused a real, already-fixed bug in
  the Reorder Request notification system, PRs #73/#74).
- Query shape: `where("active", "==", true)` (or the `employmentStatus`
  equivalent once that's decided per Section 4)
  `.where("operationalRoles", "array-contains", requiredOperationalRole)`
  -- both are simple `==`/`array-contains` filters, so no composite
  Firestore index is needed even combined with an optional
  `requireLinkedUser` filter (`where("userId", "!=", null)`, though
  `!=` queries have their own indexing rules worth confirming against
  the specific combination used).
- `useAssignableEmployees({ requiredOperationalRole, companyId,
  requireLinkedUser = true, enabled = true })` -> `{ employees, loading,
  error }`, consistent with this project's other `use*(...)` hook
  signatures (`useReorderRequestsAssignedTo`, `useFirestoreCollection`).

## 9. EmployeeAssignmentPicker foundation

Net-new component, `src/components/assignment/EmployeeAssignmentPicker.jsx`
(exact path TBD against actual project conventions -- an implementation-
time call, not an architecture one). Consumes `useAssignableEmployees()`
directly. Required UX per governance: name + operational role +
department/job title display, searchable, loading/empty/error/selected
states, **no UID visible, no manual UID text field**. `onSelect`
payload: `{ employeeId, userId, displayName, operationalRoles,
department }` -- exactly matches the shape `PROJECT_ARCHITECTURE.md`'s
standard already specifies for "the assignment value shape."

This is Phase 3's only new UI surface -- and it has **zero consumers in
Phase 3 itself**. Its first real caller is the Parts and Purchase Order
Assignment Adoption sprint's `ReorderRequestAssignment` replacement
(already specified in that sprint's approved Sprint Specification).
Phase 3 should build and manually verify this component in isolation
since there's no real call site to test it against until the next
sprint.

## 10. Legacy compatibility

Not directly applicable to Phase 3 itself -- Phase 3 creates net-new
collections/fields, it doesn't touch or migrate any existing
`reorder_requests`/`reorder_purchase_orders` data. The legacy-
compatibility work (3-tier display fallback, preserved
`assignedToUserId`-only records) is scoped to the *next* sprint (Parts
and Purchase Order Assignment Adoption), already specified. Phase 3's
only legacy-adjacent concern: the existing `fieldops_technicians`
collection and `assignTechnicianToUser.js` script remain completely
untouched, unmigrated, per governance's explicit instruction.

## 11. Migration sequencing

No data migration in Phase 3. Sequencing is about *build order within
Phase 3*, since these five pieces have real dependencies on each other:

1. `employees/{employeeId}` Firestore rules (Section 7) -- must exist
   before anything can write or read the collection safely, even for
   manual testing.
2. `domain/employees.js` + `useAssignableEmployees()` (Section 8) --
   can be built and verified against manually-seeded Employee docs
   once (1) exists, independent of provisioning tooling.
3. `provisionEmployeeAccess.js` (Section 6) -- can be built in parallel
   with (2), but needs (1)'s rules finalized to know what it's writing
   into.
4. `AuthContext` changes -- depends on at least one real Employee/User
   link existing (via (3), run at least once) to verify against, so
   this is naturally last among the data-layer pieces.
5. `EmployeeAssignmentPicker` (Section 9) -- depends on (2) existing;
   can be built and manually verified in parallel with/after (4), since
   it doesn't depend on `AuthContext`'s own changes, only on the query
   hook.

Recommended PR breakdown (one architectural concern per PR, per
`docs/ai/workflow.md`):
- PR 1: `employees` collection rules + `domain/employees.js` +
  `useAssignableEmployees()`.
- PR 2: `provisionEmployeeAccess.js` (Admin SDK script, run manually --
  needs at least one real provisioning run verified against the live
  project before this is considered done, same as every prior Admin SDK
  script in this repo).
- PR 3: `AuthContext` changes + `EmployeeAssignmentPicker`.

This is a recommended build sequence only -- not an Implementation
Plan; per instruction, no implementation plan is produced by this
assessment.

## Risks

- **The `employees` create/update rule decision (Section 7) is the
  single highest-consequence open decision in this assessment** --
  shipping it as `allow create, update: if false` (Admin-SDK-only) is
  safe but means there is *no* path to an Employee Administration UI
  later without a second rules change; shipping it with a client write
  path now means designing that authorization model as part of Phase 3
  rather than deferring it.
- **AuthContext's one-shot-to-realtime conversion is a behavior change
  to code every authenticated user's session already depends on** --
  low risk technically (this project has converted exactly this
  pattern before, PRs #73/#74, without incident) but deserves explicit
  manual regression testing across all three roles (admin/dispatcher/
  technician) before merge.
- **`EmployeeAssignmentPicker` ships with zero real consumers in Phase
  3** -- verification is necessarily synthetic (seeded test data, no
  live workflow exercising it) until the next sprint adopts it.

## Open architectural questions

1. Ship `employmentStatus` (full enum) in Phase 3, or start with a
   simpler `active: boolean` and defer the enum to a later pass?
   Governance permits either.
2. Does `employees/{employeeId}` get a client-side create/update path
   in Phase 3 (with what authorization model), or stay Admin-SDK-only
   until an explicit future Employee Administration sprint?
3. Should `email` be added to Section 8a's Employee field list now
   (needed for provisioning, not currently in governance's table), or
   handled as an implementation detail not requiring a governance
   update?
4. Should `AuthContext`'s one-shot -> `onSnapshot()` conversion be in
   scope for Phase 3 (this assessment recommends yes, for consistency),
   or treated as a separate, unrelated refactor to defer?

## Recommended implementation phases

Not an Implementation Plan (out of scope for this assessment) -- but
the natural phase boundary, for whoever writes the Sprint Specification
next: Phase 3 (this assessment's scope) delivers the foundation with
zero live consumers; the Parts and Purchase Order Assignment Adoption
sprint (already specified separately) is the first real adopter. No
further phase should begin until Phase 3's Architecture Review resolves
the four open questions above.

---
Not implemented -- assessment only, per instruction. No code, rules, or
scripts written. Awaiting Architecture Review before a Sprint
Specification is written.
