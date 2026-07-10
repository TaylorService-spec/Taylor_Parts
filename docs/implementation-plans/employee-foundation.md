---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
date: 2026-07-10
owner: Claude Code
related_adrs: []
depends_on: [docs/specifications/employee-foundation.md]
implements: [docs/specifications/employee-foundation.md]
supersedes: []
superseded_by: []
related_pr:
target_release: Phase 3 -- Platform Assignment Foundation
---

# Implementation Plan: Employee Foundation (Phase 3)

**Sprint Specification:** `docs/specifications/employee-foundation.md`
-- Approved, 2026-07-10.

Four PRs, one architectural concern each, in dependency order. No PR in
this plan is implemented, merged, or run against production by this
document itself -- each requires its own Codex review (where
warranted) and ChatGPT's Architecture Approval before merge, per
`docs/ai/workflow.md`. **This plan is planning only -- no application
code, Firestore Rules, or provisioning has been run.**

## PR breakdown

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|
| 1 | Employee Data and Read Foundation | `employees` collection, Rules (dual read path), query service | None | Not started |
| 2 | Trusted Employee/User Provisioning | Admin SDK provisioning script, bidirectional link | PR 1 | Not started |
| 3 | Current Employee Session Resolution | `AuthContext` Employee resolution | PR 1, PR 2 | Not started |
| 4 | EmployeeAssignmentPicker Foundation | Reusable picker component | PR 1 | Not started |

PR 3 depends on PR 2 for meaningful testing (needs at least one real
provisioned link to verify resolution against), though its code does
not directly depend on PR 2's files. PR 4 depends only on PR 1 (the
query service), not on PR 2 or PR 3, and could technically run in
parallel with either -- sequenced after them here only to match the
specification's stated order, not because of a hard dependency.

---

## PR 1 -- Employee Data and Read Foundation

### Objective
Establish the `employees/{employeeId}` collection with its Firestore
Rules (both read paths) and a reusable, read-only query service --
the foundation every later PR in this plan depends on.

### Dependencies
None. First PR in the sequence.

### Expected files
- `firestore.rules` (root)
- `field-ops-app-vite/firestore.rules`
- `field-ops-app-vite/src/domain/employees.js` (new)
- `field-ops-app-vite/src/hooks/useAssignableEmployees.js` (new)
- Rules emulator test file(s) (location TBD at implementation time --
  this repo has no existing Firestore Rules test suite to extend; see
  Risk below)
- Query-service test file(s), consistent with this project's existing
  test conventions (verified against real/emulated data per the
  specification's Testing strategy, not necessarily a formal unit-test
  framework if none is already established here)

### Collections affected
`employees` (new). No other collection touched.

### Rules impact
New `employees/{employeeId}` match block, both `firestore.rules`
copies, per the specification's "Firestore Rules impact" section:
- `allow read: if isAdminOrDispatcher() || (isSignedIn() &&
  get(/databases/$(database)/documents/users/$(request.auth.uid)).data.employeeId
  == employeeId);`
- `allow create, update, delete: if false;`
Both copies must remain byte-identical after the change (`diff`-verified).

### Data impact
None -- no data written by this PR. Collection exists with rules only;
no documents created until PR 2's provisioning script runs.

### Test requirements
Per the specification's Testing strategy, all six rules-simulator
cases: admin directory read succeeds; dispatcher directory read
succeeds; technician self-read of own linked Employee succeeds;
technician read of another Employee denied; User with no `employeeId`
denied every Employee read; mismatched User/Employee linkage denied.
Plus: every client create/update/delete attempt fails for every role
including admin; the added self-read `get()` call is confirmed within
Firestore's per-request rule evaluation limits. Query-service tests:
seed varying `employmentStatus`/`operationalRoles`/`userId`
combinations, confirm `useAssignableEmployees()` returns exactly the
expected subset per filter combination, confirm non-`ACTIVE`
`employmentStatus` values are correctly excluded.

### Required indexes
Repository verification required at implementation time, not assumed
from this plan: the specification notes the `==`/`array-contains`
combination needs no composite index (by analogy to
`useReorderRequestsAssignedTo()`'s precedent), but the `!=` filter
used when `requireLinkedUser` is set has its own indexing behavior
that must be confirmed against the live Firestore console or emulator
during this PR, not assumed clean by analogy. If an index is required,
add it to `firestore.indexes.json` (if this repo uses one) as part of
this PR, not a follow-up.

### Acceptance criteria
- [ ] `employees/{employeeId}` Rules exist in both `firestore.rules`
      copies, confirmed byte-identical via `diff`.
- [ ] All six rules-simulator cases pass (see "Test requirements").
- [ ] `domain/employees.js` exports a read-only query-building function
      with no write functions.
- [ ] `useAssignableEmployees({ requiredOperationalRole,
      requireLinkedUser = true, enabled = true })` returns `{
      employees, loading, error }`, `onSnapshot()`-based, no `companyId`
      parameter.
- [ ] Query-service tests pass against seeded data for every documented
      filter combination.
- [ ] `npm run build && npm run lint` pass clean.

### Rollback approach
Additive only -- no existing collection, rule, or field is modified.
Reverting this PR removes the new rule block and the two new files;
since no data was written (empty collection), there is nothing to
migrate back. Firestore Rules rollback follows this project's standing
practice: redeploy the prior rules version via
`firebase deploy --only firestore:rules` if a post-deploy issue is
found.

### Risks
- **No existing Firestore Rules test suite in this repo to extend** --
  this PR either establishes the first one or performs manual
  simulator verification as a one-time pre-merge pass, consistent with
  how prior sprints' rules changes were verified (per the open
  question already flagged in `docs/ai/README.md`'s review history).
  This plan does not resolve that process question; it's inherited,
  not decided here.
- **New rule shape (self-read `get()` gating a read, not just pinning
  a write)** -- first instance of this pattern for a read
  authorization decision in this repo; higher review scrutiny
  warranted than a typical additive rules change.

### Stop condition
Stop and return to ChatGPT's Architecture Approval if: the `!=` index
requirement forces a schema or query-shape change not anticipated in
the specification, or if rules-simulator testing reveals the self-read
`get()` pattern cannot cleanly deny the "mismatched linkage" case as
specified.

### Required ChatGPT review point
Architecture Approval before merge -- this PR is not Codex-optional
given it's a Firestore Rules change (per `docs/ai/workflow.md`'s Codex
guidance, Firestore Rules changes are exactly the category where an
independent engineering review is recommended, though not mandatory).

---

## PR 2 -- Trusted Employee/User Provisioning

### Objective
Build the Admin SDK script that establishes the Employee/User
bidirectional link -- the only path by which `employees.userId` and
`users.employeeId` are ever written, since both are Admin-SDK-only per
PR 1's rules.

### Dependencies
PR 1 (the `employees` collection and its rules must exist to write
into).

### Expected files
- `functions/scripts/provisionEmployeeAccess.js` (new)
- Removal of `functions/scripts/createPartsManagerTestUsers.js`
  (untracked, never committed -- see "Disposition" below)

### Collections affected
`employees` (create/update, Admin SDK), `users` (update `employeeId`,
Admin SDK) -- the only two collections this script ever touches.

### Rules impact
None -- Admin SDK bypasses Firestore Rules entirely by design. This PR
does not modify `firestore.rules`.

### Data impact
Writes real `employees/{employeeId}` documents and updates real
`users/{uid}.employeeId` values when run. **No live-project run is
required for this PR to merge** -- see Acceptance criteria.

### Test requirements
Exercise all four provisioning cases in an emulator or other approved
non-production environment: create Employee without access; grant
application access (locate/create Firebase Auth user, write both
sides of the link); update `operationalRoles`; update security `role`.
Verify resulting documents directly via Firestore reads in that
environment, not just script console output.

**Conflict detection**: verify the script's behavior when
`employeeId` already exists (must not silently overwrite an existing
Employee's `operationalRoles`/`displayName` without an explicit
update intent) and when the target email already has a Firebase Auth
account (must locate and link the existing account, not create a
duplicate -- mirrors `createPartsManagerTestUsers.js`'s existing
`getUserByEmail()`-first pattern).

**Idempotency**: running the script twice with identical inputs must
not create a second Employee, a second Auth user, or corrupt the
existing link -- verify explicitly, not assumed from the conflict-
detection behavior.

### Acceptance criteria
- [ ] `provisionEmployeeAccess.js` exists, accepts `employeeId`,
      `displayName`, `email`, `securityRole`, `operationalRoles` --
      no `companyId` input.
- [ ] `email` is used only to call `getUserByEmail()`/`createUser()` --
      never written to `employees/{employeeId}`.
- [ ] All four provisioning cases verified in an emulator or approved
      non-production environment, with resulting documents confirmed
      via direct reads.
- [ ] Conflict detection and idempotency verified explicitly (see "Test
      requirements").
- [ ] Never prints, logs, or commits a password, credential, or reset
      link.
- [ ] `functions/scripts/createPartsManagerTestUsers.js` is removed in
      this PR.
- [ ] **No live-project (production) provisioning run occurs as part of
      merging this PR.** Merge approval authorizes the code only. A
      controlled initial live-project run is a separate, explicitly
      authorized operational step taken by the project owner after
      merge, not a merge requirement -- consistent with the
      specification's "Merge approval does not itself authorize
      production data mutation."

### Disposition of `createPartsManagerTestUsers.js`
Removed, not adapted -- it is untracked (never committed, zero PR
history, zero migration cost), and its purpose is fully superseded by
`provisionEmployeeAccess.js`'s general-purpose provisioning. No
redirect, alias, or compatibility shim is created for it.

### Rollback approach
The script itself is a local, manual tool -- reverting this PR removes
it from the repository but does not undo any provisioning already
performed (Employee/User links already established remain established,
matching this project's stated "no historical backfill/rewrite"
posture generally). If a specific provisioning run is found to be
wrong, correct it with a new, explicit Admin SDK operation (e.g. a
follow-up run correcting `operationalRoles`) -- do not attempt to
silently "undo" a link via code changes alone.

### Risks
- **This is the highest-privilege PR in this plan** -- an Admin SDK
  script bypasses every Firestore Rule this project has. Review should
  weight this accordingly, independent of its otherwise-small code
  footprint.
- **Idempotency/conflict-detection bugs here are the kind that
  silently corrupt the Employee/User link** -- a bad re-run could
  overwrite `operationalRoles` or mis-link a `userId`. Test requirement
  above is not optional.

### Stop condition
Stop and return to ChatGPT's Architecture Approval if: idempotency or
conflict-detection testing reveals a scenario the specification didn't
anticipate (e.g. an `employeeId` collision with a different intended
Employee), or if any live-project run is requested before this PR
itself has merged and been through its own review.

### Required ChatGPT review point
Architecture Approval before merge. Recommend Codex review given this
PR's Admin SDK/security-sensitive nature (per `docs/ai/workflow.md`'s
Codex guidance), though not mandatory.

---

## PR 3 -- Current Employee Session Resolution

### Objective
Extend `AuthContext` to resolve the signed-in user's linked Employee
identity, while preserving the existing one-shot `users/{uid}`
role-loading mechanism exactly as it is today.

### Dependencies
PR 1 (the `employees` collection, rules, and self-read path must exist
to read from). PR 2 is not a strict code dependency, but meaningful
testing requires at least one real provisioned link (from PR 2) to
verify resolution against.

### Expected files
- `field-ops-app-vite/src/auth/AuthContext.jsx`

### Collections affected
Read-only: `users` (existing read, unchanged mechanism) and
`employees` (new additional read, via the self-read rule path from
PR 1). No writes from this PR.

### Rules impact
None -- consumes the self-read path PR 1 already established. This PR
does not modify `firestore.rules`.

### Data impact
None -- read-only change.

### Test requirements
Manual regression across all three existing security roles
(admin/dispatcher/technician): sign-in and role-gated navigation/access
continue to work unchanged. Explicit verification of:
- **Missing-link behavior**: an account with `users/{uid}.employeeId ==
  null` resolves `employeeId`/`displayName`/`operationalRoles` to
  `null`/`null`/`[]` without error, and attempts no Employee-side read.
- **Sign-out/sign-in requirement**: an account provisioned with a new
  Employee link while already signed in does not see the new identity
  fields populate until it signs out and back in -- confirm this
  documented limitation behaves exactly as specified, not silently
  differently (e.g. not partially updating, not erroring).
- **Cleanup/race-condition handling**: confirm the additional
  Employee-side `getDoc()` call is properly scoped to the
  `onAuthStateChanged` callback's lifecycle (no stale read applied
  after a sign-out fires mid-flight, no unhandled promise rejection if
  the Employee read fails while the User read succeeded).

### Acceptance criteria
- [ ] `AuthContext` exposes `{ user, role, employeeId, displayName,
      operationalRoles, login, logout, loading }`.
- [ ] The existing one-shot `getDoc(doc(db, USERS_COLLECTION, u.uid))`
      read mechanism is unchanged -- confirmed by diff, not just by
      description.
- [ ] Zero regression in role-gated access/navigation for
      admin/dispatcher/technician, manually verified.
- [ ] Missing-`employeeId` state handled without error.
- [ ] Sign-out/sign-in-to-resolve-new-linkage behavior verified against
      a real PR-2-provisioned account.
- [ ] No unhandled race condition between the `users/{uid}` read and
      the dependent `employees/{employeeId}` read.
- [ ] `npm run build && npm run lint` pass clean.

### Rollback approach
Single-file change to `AuthContext.jsx`. Reverting restores the prior
`{ user, role, login, logout, loading }` shape exactly -- no data
migration involved, since this PR only reads.

### Risks
- **Highest-blast-radius single change in this plan** -- touches code
  every authenticated session depends on, even though the read
  mechanism itself isn't changing. Budget proportionally more manual
  regression testing than PR 1, 2, or 4.
- **Sign-out/sign-in limitation is user-visible and easy to forget to
  communicate operationally** -- whoever runs PR 2's script needs to
  know a freshly-linked user must re-authenticate to see their
  Employee identity resolve.

### Stop condition
Stop and return to ChatGPT's Architecture Approval if: manual
regression testing reveals any change in role-gated access behavior
for any existing role, or if the additional read introduces a
noticeable sign-in latency regression not anticipated in the
specification.

### Required ChatGPT review point
Architecture Approval before merge, given the blast radius noted
above.

---

## PR 4 -- EmployeeAssignmentPicker Foundation

### Objective
Build the reusable `EmployeeAssignmentPicker` component, verified in
isolation, with zero production workflow adoption.

### Dependencies
PR 1 (`useAssignableEmployees()` must exist to consume). Not dependent
on PR 2 or PR 3's code, though manual verification benefits from PR
2's seeded test data existing.

### Expected files
- `EmployeeAssignmentPicker.jsx` (exact directory TBD at
  implementation time, per the specification -- `shared/` vs. a new
  `assignment/` subfolder)
- A throwaway harness or temporarily-wired existing screen used for
  manual verification, explicitly unwired again before this PR merges
  (per the specification's "Verification without a live consumer")

### Collections affected
Read-only, via `useAssignableEmployees()` -- no new collection access
beyond what PR 1 already established.

### Rules impact
None. This PR does not modify `firestore.rules`.

### Data impact
None -- UI component only.

### Test requirements
Manual verification against seeded Employee data (from PR 2's
non-production testing) for every required UX state: loading, empty,
error, populated, selected, searched. Confirm no UID is visible
anywhere in the normal rendering path. Confirm eligibility is
correctly limited to `employmentStatus == "ACTIVE"` (and, when
`requireLinkedUser` is set, non-null `userId`) -- entirely inherited
from `useAssignableEmployees()`, no separate filtering logic in the
component itself.

### Acceptance criteria
- [ ] `EmployeeAssignmentPicker` accepts `{ requiredOperationalRole,
      requireLinkedUser, selectedEmployeeId, onSelect, disabled, label,
      placeholder }` -- no `companyId` prop.
- [ ] Option display shows only `displayName` and `operationalRoles`
      -- no `department`, job title, or any field not in the Phase 3
      Employee schema.
- [ ] `onSelect` payload is exactly `{ employeeId, userId, displayName,
      operationalRoles }`.
- [ ] No UID visible anywhere in the normal UX; no manual UID text
      field exists in this component.
- [ ] All required states (loading/empty/error/populated/selected/
      searched) verified against seeded data.
- [ ] Any manual test harness or temporary wiring used for verification
      is removed before merge -- confirmed by diff showing zero
      production workflow file changed.
- [ ] `npm run build && npm run lint` pass clean.

### Rollback approach
Net-new component with no consumers -- reverting this PR has zero
downstream impact on any existing screen.

### Risks
- **Verified only in isolation** -- a real (if small) risk its
  `onSelect` payload shape or eligibility filtering has a mismatch
  that only surfaces once the Parts and Purchase Order Assignment
  Adoption sprint wires it up as a real consumer. Acceptable per the
  specification's own sequencing rationale, not a zero-risk trade-off.

### Stop condition
Stop and return to ChatGPT's Architecture Approval if: manual
verification reveals the required UX cannot be satisfied with only
`displayName`/`operationalRoles` (e.g. genuine ambiguity between two
same-named Employees with no other displayed field to disambiguate) --
that would be a real gap in the Phase 3 schema, not just an
implementation detail, and needs architecture-level resolution, not a
silent field addition.

### Required ChatGPT review point
Architecture Approval before merge. Codex review optional (routine UI
component using established patterns, per `docs/ai/workflow.md`'s
guidance that Codex is not required for low-risk implementation using
established patterns).

---

## Overall stop condition

This plan's scope ends at PR 4. No workflow (Parts/Purchase Order or
otherwise) is wired to consume this foundation by any PR in this plan
-- that is explicitly the next, separately-specified sprint's work, not
this one's. Do not begin that adoption work until all four PRs above
have merged and this plan is marked complete.
