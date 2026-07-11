---
artifact_type: architecture-review
gate: Architecture Review
status: Approved
date: 2026-07-10
owner: ChatGPT
related_adrs: []
depends_on: [docs/assessments/employee-foundation.md, docs/specifications/employee-foundation.md]
implements: []
supersedes: []
superseded_by: []
related_pr: 81
target_release: Phase 3 -- Platform Assignment Foundation
---

# Architecture Review: Employee Foundation (Phase 3)

**Assessment Report reviewed:** `docs/assessments/employee-foundation.md`
**Specification reviewed:** `docs/specifications/employee-foundation.md`

Concise review record -- does not duplicate the full assessment or
specification content. See those artifacts for complete detail.

## Status summary

- **Repository Assessment: Approved.**
- **Sprint Specification: Approved**, after two rounds of requested
  changes (see "Approved architectural decisions" below for what
  changed between rounds).
- **Implementation Plan: Approved and complete** — all four
  implementation PRs merged (`docs/implementation-plans/employee-foundation.md`).
- **PR 1 -- Employee Data and Read Foundation: MERGED.** PR #82,
  merge commit `c33af513d1c708a1fd95f27dd7d1ecca25f99f9f`, merged
  2026-07-10. Architecture verified against the approved specification
  -- `employees/{employeeId}` Rules (both copies, dual read path),
  `domain/employees.js`, `useAssignableEmployees()`, the
  `employmentStatus` contract, and a permanent Firestore Rules
  emulator test (10/10 assertions passing, zero new npm dependencies)
  all landed exactly as specified. **No architectural drift** --
  nothing outside PR 1's approved scope was touched (no
  `provisionEmployeeAccess.js`, no `AuthContext` change, no picker, no
  workflow adoption). Phase 3 implementation is progressing as
  planned; ready to begin PR 2.
- **PR 2 -- Trusted Employee/User Provisioning: MERGED.** PR #83,
  merge commit `b09111e66aaab25eb54b9e13991fa54a2134a671`, merged
  2026-07-10. Architecture verified against the approved specification
  -- `provisionEmployeeAccess.js`'s five-phase validate-before-mutate
  flow, the atomic Firestore transaction with in-transaction
  re-validation, the governance-approved operational-role allowlist,
  the required `--projectId`/`--confirmProduction` production-target
  gate, and fully passwordless account creation (no credential of any
  kind generated, printed, returned, stored, or committed) all landed
  exactly as specified, after two rounds of requested changes (atomic
  linking/pre-mutation validation/project gate/role validation in the
  first round; removal of temporary-password terminal output in the
  second). **No architectural drift** -- nothing outside PR 2's
  approved scope was touched (no `AuthContext` change, no picker, no
  workflow adoption). No production provisioning run was performed at
  any point. Phase 3 implementation is progressing as planned; ready
  to begin PR 3.
- **PR 3 -- Current Employee Session Resolution: MERGED.** PR #84,
  merge commit `ec5a7fe94144cac81ff2f51a9e4ac3f3282ff3cc`, merged
  2026-07-10. Architecture verified against the approved specification
  -- `AuthContext` now exposes `employeeId`/`displayName`/
  `operationalRoles`, the existing one-shot `users/{uid}` read
  mechanism is unchanged (no `onSnapshot()` conversion), missing
  `employeeId` resolves as a valid migration state, a broken Employee
  link retains `employeeId` for diagnosis while granting no display
  name or operational roles, prior session identity is cleared
  immediately (including `loading` returning to `true`) before a newly
  authenticated user resolves, and resolution failures clear
  normalized identity and end loading without ever granting a fallback
  role -- all landed exactly as specified, after one round of requested
  changes (session-identity clearing + explicit error handling). **No
  architectural drift** -- nothing outside PR 3's approved scope was
  touched (no `onSnapshot()` conversion, no emulator wiring in
  `firebase.js`, no picker, no Rules or workflow change). Phase 3
  implementation is progressing as planned; ready to begin PR 4.
- **PR 4 -- EmployeeAssignmentPicker Foundation: MERGED.** PR #85, merge commit `f4cc67e8eeb53255d209df00a6a413a523424b7b`, merged 2026-07-10 (after this review's original approval text below was written, which said "remains not started" and withheld advance approval for it — corrected here rather than silently left stale; see `docs/DECISIONS.md`). `shared/assignment/EmployeeAssignmentPicker.jsx` + `filterEmployeesBySearch()`, `.fo-employee-picker*` CSS mirroring the existing `.fo-global-search*` pattern, zero production consumers (not wired into any workflow). Two review rounds before merge (deterministic focus/keyboard/ARIA handling; an ArrowDown/ArrowUp landing-behavior fix). **No architectural drift** — nothing outside PR 4's approved scope was touched. **All four Employee Foundation implementation PRs are now merged** — the initiative's implementation is complete; only workflow adoption (Parts/Purchase Order Assignment, separately not-yet-scoped per this plan's own "Explicitly out of scope") remains.

## Classification

Platform Service (Person Assignment Platform Service Standard,
`docs/PROJECT_ARCHITECTURE.md`) and Business Object (Employee,
`docs/BusinessEntityModel.md` Section 8a) -- both already classified in
governance merged prior to this initiative (PR #79). This review does
not reclassify anything.

## Governance impact

None beyond what's already merged. No `BusinessEntityModel.md`,
`PlatformCapabilityModel.md`, or `GuidingPrinciples.md` change is
proposed by the approved specification -- notably, the `email` field
addition originally proposed in the first specification draft was
removed in revision, so no governance-doc change accompanies this
initiative.

## Approved architectural decisions

- `employmentStatus` (`ACTIVE`/`ON_LEAVE`/`INACTIVE`/`TERMINATED`/
  `RETIRED`/`CONTRACTOR`) is the authoritative Employee lifecycle
  field. No `active` boolean introduced. `ACTIVE`-only assignment
  eligibility for Phase 3.
- No `email` field on `employees/{employeeId}`. Firebase Authentication
  owns credential/account email; Employee owns workforce identity.
  `email` is a `provisionEmployeeAccess.js` execution input only, never
  persisted to Employee.
- `employees/{employeeId}` Firestore Rules support two read paths:
  admin/dispatcher assignment-directory read, and a current-Employee
  self-read (any authenticated User may read only their own linked
  Employee via `users/{uid}.employeeId`). No client create/update/
  delete under any role.
- No `companyId` parameter on the query service, `useAssignableEmployees()`,
  `EmployeeAssignmentPicker`, or `provisionEmployeeAccess.js` -- a
  tenancy-relevant filter must be fully enforced or entirely absent,
  never accepted-and-ignored. `companyId`/`departmentId`/`locationId`
  remain Future/Reserved fields on the Employee document schema itself
  (unchanged from governance).
- `EmployeeAssignmentPicker` displays and returns only `displayName`
  and `operationalRoles` -- no `department`/job title, which don't
  exist in the Phase 3 schema.
- `AuthContext`'s existing one-shot `users/{uid}` role-loading read is
  preserved unchanged. Employee resolution is an additional one-shot
  read, not a realtime conversion. A realtime User/access-identity
  subscription is explicitly deferred to a separate future sprint.
  Sign-out/sign-in is required to resolve a linkage established
  mid-session.
- Four separate PRs, not three -- AuthContext resolution and
  EmployeeAssignmentPicker are distinct architectural concerns.
- No live-project provisioning run is a merge requirement for PR 2.
  Merge approval authorizes code only; a live-project run is a
  separately, explicitly project-owner-authorized operational step.

## Explicitly out of scope

Everything the specification's "Explicitly out of scope" section
states, unchanged: Employee administration UI, HR integration,
scheduling, skills, certifications, payroll, availability, time
tracking, multi-company hierarchy implementation, any workflow
adoption (Parts/Purchase Order or otherwise), `fieldops_technicians`
migration, Cloud Function deployment.

## Approval

**Specification approved to proceed to Implementation Plan, 2026-07-10.**
**Implementation Plan approved to begin Implementation, 2026-07-10.**
**PR 1 (PR #82) Architecture Approved and merged, 2026-07-10.**
**PR 2 (PR #83) Architecture Approved and merged, 2026-07-10.**
**PR 3 (PR #84) Architecture Approved and merged, 2026-07-10.**
**PR 4 (PR #85) Architecture Approved and merged, 2026-07-10** (its
own separate approval, obtained at its own merge time, exactly as
this section originally required — not an advance extension of the
approval recorded above). Each PR's Owner Merge Authorization was
recorded separately from its Architecture Approval, per
`docs/ai/workflow.md`'s two-gate merge sequence.

**This review, and the Assessment/Specification/Implementation Plan
it covers, were only committed to `main` after all four
implementation PRs already merged** (this PR, #81, sat open through
that entire span) — a documentation-lag gap worth naming plainly
rather than leaving implicit: the governance record is accurate as of
this correction, but was not contemporaneous with the code it
describes.
