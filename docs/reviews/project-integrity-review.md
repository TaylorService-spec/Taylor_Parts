# Project Integrity Review

Issued: 2026-07-15 09:13:01 -07:00 (America/Phoenix)  
Baseline: `origin/main` at `0c939d72b2cef618aef3c3cf835d2e826d910414`

## Purpose

This is the durable charter for a recurring, read-only review of project status, architectural drift, production parity, remaining business objects, and whole-code quality. GitHub, merged repository documents, CI, and confirmed deployment state remain authoritative; session summaries are evidence to verify, not authority by themselves.

## Current checkpoint

### Healthy

- Governance is generally proceeding through Assessment, ADR, Specification, Implementation Plan, bounded implementation, independent review, and clean merge.
- Customer and Inventory ownership is now clearer: Equipment and Installed Assets is tracked by Issue #232; Enterprise Access and Administration is tracked by Issue #226.
- Independent review and stronger automated tests are finding genuine defects before release.
- Firestore Rules regression, emulator provenance, access-control tests, and browser verification provide substantially better safety than earlier project stages.
- Current `main` and its automatic frontend deployment checks were green at this checkpoint.

### Needs attention

- Production is not uniformly current: the frontend is deployed, trusted Cloud Functions remain blocked by Issue #15, and not every merged Rules change has confirmed-live evidence.
- Issue #100 was closed while the PR #236/#237 Employee assignment-candidate Rules still lacked deployment and confirmed-live evidence. This needs a dedicated open production follow-up or an explicit reopening.
- Equipment E1 boundary review found additional malformed-input risks that should be tracked before edit/move consumers depend on them.
- `ROADMAP.md` and `SPRINT_STATUS.md` lag current GitHub and merged-PR reality.
- Parallel-session reports have occasionally contained stale heads, incorrect verification claims, or staged-versus-committed confusion. Exact-head independent verification remains mandatory.
- The repository root may contain unrelated work. Recurring reviews must use a clean dedicated worktree at the exact fetched `origin/main` head and must not modify or clean foreign worktrees.

## Remaining primary objects and processes

1. Enterprise Access and Administration: trusted writers, operator parity, Admin portal, shadow migrations, production activation, domain cutovers, raw-role retirement, and release verification.
2. Equipment and Installed Assets: Rules/indexes, registration, create/detail/edit/move/lifecycle, Customer/Location/Work Order integration, service history, technician experience, authorization cutover, and production verification.
3. Work Order backend: production deployment and verification of trusted creation and lifecycle Functions under Issue #15.
4. Account commercial and financial forecasting: remaining Issue #175 work.
5. Truck Parts Sale-to-Invoice: Specification and implementation after the Issue #182 Assessment and Owner decisions.
6. Cross-domain operating chain: Customer -> Location -> Equipment -> Work Order -> Dispatch/Technician -> Parts consumption -> Replenishment/Purchasing -> Invoice/financial reporting.

## Recurring review procedure

Each run is read-only and begins by recording the Phoenix timestamp and exact fetched `origin/main` commit.

1. Re-read `AGENTS.md`; fetch remote state; do not rely on the local checkout as the review base.
2. Inspect open issues, Draft/open PRs, checks, merge state, and Taylor Freezer tracking. Report missing items.
3. Compare current state with the prior review and report deltas rather than repeating project history.
4. Confirm frontend deployment, deployed Firestore Rules identity, deployed Functions status, and known production-verification gaps without performing production writes or deployments.
5. Check architectural drift against governing Assessments, ADRs, Specifications, and Implementation Plans.
6. Identify findings left only in chat/PR comments that require a tracked issue.
7. Review active high-risk PRs touching Rules, Functions, claims, trusted writers, authorization enforcement, indexes, or production tooling. Do not merge them.
8. Report business-process coverage and the next blocked or missing link in the end-to-end operating chain.
9. Report documentation drift in `ROADMAP.md`, `SPRINT_STATUS.md`, and other global status documents; do not edit them during the recurring review.
10. Produce a concise status report with: baseline, changes since prior run, what is going well, what is not, drift verdict, production parity, active risks, remaining objects/processes, and recommended next actions.

## Delivery format

Each completed run is delivered from one verified set of facts in three readable forms:

1. A concise Markdown report in the Codex task.
2. An HTML email with a plain-text fallback, sent to the Owner after the review completes.
3. A self-contained HTML dashboard saved as both a timestamped archive and `latest.html` under the Owner's local `Documents/Taylor Parts Reviews` reporting directory.

The email and dashboard must show the exact head and Phoenix timestamp prominently, use accessible status colors plus text labels, remain readable on a phone, and link directly to the relevant GitHub issues, pull requests, repository, and project. A failed or incomplete review sends an explicit failure notification rather than presenting unverified conclusions as current status.

The local HTML dashboard is an operational review artifact, not part of the Field Ops application. A permanently hosted dashboard requires its own tracked, reviewed, read-only implementation and deployment decision.

## Whole-code review checkpoint

The broad release-integrity review should use a frozen exact head and a clean worktree. It should include all unit/lint/type/build checks, Rules and Functions tests, every browser `verify-*` command with deterministic reseeding, dependency and secret scanning, and independent reviews of:

1. Authentication, authorization, claims, Rules, and trusted writers.
2. Customer, Contact, Location, and commercial data.
3. Work Orders, dispatch, lifecycle, and technician scope.
4. Inventory, purchasing, receiving, and audit trails.
5. Equipment ownership and installed-asset workflows.
6. Shared UI, navigation, accessibility, and responsive behavior.
7. CI, deployment, rollback, scripts, and production parity.

The review itself produces findings and child issues, not one giant correction PR. Security-sensitive corrections remain separately reviewed. Run an immediate targeted review of active high-risk PRs, and run the full frozen-head review at Enterprise Access Row 18 before production activation or permission cutover.

## Safety boundary

The recurring review is authorized for read-only inspection, generation of its local report artifacts, and delivery of its review email only. It does not authorize repository edits, merges, deployments, production mutations, credential disclosure, status changes, branch cleanup, or implementation work. Any such action requires its applicable existing authorization gate.
