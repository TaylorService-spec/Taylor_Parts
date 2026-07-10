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
- **Implementation Plan: Submitted
  (`docs/implementation-plans/employee-foundation.md`), not yet
  approved.** No PR in that plan has Architecture Approval yet -- each
  of the four PRs requires its own approval at merge time, per
  `docs/ai/workflow.md`.

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
Implementation Plan is submitted for review
(`docs/implementation-plans/employee-foundation.md`) -- **not yet
approved to begin Implementation.** Each of the four PRs in that plan
requires its own Architecture Approval at merge time; none has been
implemented.
