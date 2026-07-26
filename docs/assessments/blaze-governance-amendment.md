---
artifact_type: assessment
gate: Governance Reconciliation Assessment
status: Draft
date: 2026-07-26
owner: Claude Code
baseline: f38703dca4cc6e07c782b098f2677015d68ce648
related_decisions: [47, 48]
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr: 435
target_release: N/A (governance reconciliation)
---

# Assessment: Blaze Governance Reconciliation (Lane A of Authentication Modernization)

**Status: DRAFT — approved by Owner + ChatGPT (Lane A review, 2026-07-26,
decisions A1–A5). Included in PR-A per decision A3 (consolidated).**

## Executive summary

The Authentication Modernization handoff assumed Firebase Blaze "is now connected" and
asked Lane A to *reverse* a live no-Blaze standing decision. Re-verification of
`origin/main` @ `f38703dca4cc6e07c782b098f2677015d68ce648` (PR-A rebased onto latest main
after PR #434 merged; original report baseline `8043518`) shows the premise understates
reality: **Blaze is already active and 11 Cloud Functions are deployed and verified in
production**, and have been since 2026-07-20. The correct Lane A action is therefore a
**documentation reconciliation** — formally superseding the stale no-Blaze assertions in
the foundational governance docs to match a reality already recorded in the Decisions Log
— not a fresh decision to adopt Blaze. This preserves the Owner's intent (Blaze available;
spend still governed per-feature, **proportionately**) while keeping the record accurate.

This assessment is docs-only. It performs no deployment, Firebase configuration change,
billing change, Rules/Functions change, identity mutation, or GitHub issue mutation.

## Reality basis (already recorded in-repo)

- **`DECISIONS.md` #36 (2026-07-20):** Owner-authorized deploy from `main` @ `3a9c3ff` of
  the repository Firestore Rules + **exactly 11 callable Functions** to
  `taylor-parts`/`us-central1`; corrected production verification passed twice. States
  "Blaze and the required Google Cloud APIs remain active."
- **`DECISIONS.md` #35 (2026-07-20):** "Blaze remains active and deployment-enablement APIs
  remain enabled."
- **`docs/audits/functions-live-state/` (2026-07-21):** read-only production verification by
  an authenticated Cloud Shell operator confirmed the 11 Functions live (v2 / Gen 2 / Node
  20, `us-central1`). Cloud Functions Gen 2 require the Blaze plan.

**Deployed (11):** `createWorkOrder`, `transitionWorkOrder`, `updateWorkOrderExecutionData`,
`resolveEffectiveAccessCallable`, `runReportDefinitionCallable`, and the six
saved-definition callables (`create`/`get`/`list`/`rename`/`duplicate`/`delete`).

**Deliberately NOT deployed:** the six enterprise-access mutation Functions (`grantRole`,
`revokeRole`, `assignApprovedRole`, `setUserStatus`, `approveAccessRequest`,
`rejectAccessRequest`) — marked "ACTIVE (undeployed)" in the live-state audit. No claims
bootstrap, no Admin-mutation activation, no enforcement cutover.

## Issue #15 — complete and closed; enterprise-access remainder is Issue #226 (corrected by DECISIONS #48)

> **Correction (DECISIONS #48, 2026-07-26):** an earlier draft of this section described
> Issue #15 as "partial, not closed." That was wrong and is corrected below. #15 is
> complete and correctly closed; the remaining enterprise-access work is Issue #226.

Issue #15 is narrowly scoped to deploying the **Epic 1 Work Order Engine backend**
(Firestore Rules + the Work Order Functions). That scope is **complete**: `createWorkOrder`,
`transitionWorkOrder`, and `updateWorkOrderExecutionData` are deployed and verified (#36),
and Issue #15 was **closed as COMPLETED on 2026-07-16**. It must **not** be reopened or
re-scoped.

The remaining enterprise-access work — the undeployed access-mutation Functions
(`grantRole`, `revokeRole`, `assignApprovedRole`, `setUserStatus`, `approveAccessRequest`,
`rejectAccessRequest`), claims bootstrap/migration, `accessVersion` behavior, enforcement
cutover, Admin portal, auditing, migration, and production verification — belongs to the
**OPEN Issue #226 (Enterprise Access & Administration Platform)**, not Issue #15. No part
of #226 is remaining #15 scope, and completion of #15 does not authorize any #226
deployment (#226 keeps its own implementation and deployment gates).

## Stale-reference classification (reconciled in PR-A per decision A3)

All directly related Blaze-status references travel in PR-A as one coherent reconciliation.
Edits are narrow and additive: historical statements are preserved where they were true at
the time; stale present-tense statements are annotated or superseded; "Blaze unavailable"
is distinguished from "capability still not implemented or deployed."

| File / location | Stale assertion | PR-A disposition |
|---|---|---|
| `DECISIONS.md` (new #47) | — | New reconciliation entry |
| `DeploymentModeStrategy.md` §9 | "deliberately not adopting Blaze… standing decision" | Additive amendment; original retained as history |
| `DECISIONS.md` #3 | "No-Blaze standing decision… (issue #15, not enabled)" | Left intact (append-only historical); #47 supersedes |
| `DelegationCharter.md` :32 | "the no-Blaze-plan decision" (cited as live) | Annotated: superseded per #47; principle retained |
| `DelegationCharter.md` :69–70 | "within Spark-plan constraints"; "Blaze-blocked remainder" | Annotated superseded; distinguished deploy/wiring vs billing |
| `ROADMAP.md` :51 | Sprint 2.0.3 "blocked on the Firebase Blaze plan upgrade" | Historical narrative preserved + superseded annotation |
| `ROADMAP.md` :53 | Sprint 2.0.4 "Blaze is not being adopted… standing decision" | Historical narrative preserved + superseded annotation |
| `PlatformCapabilityModel.md` :60 | WO creation "currently blocked on a standing Firebase Blaze-plan decision" | Present-tense clause superseded (Functions deployed) |
| `BusinessEntityModel.md` :71, :87 | "Blaze-blocked" backlog note / cross-ref | Reconciled: plan-unblocked; restated as unimplemented capability |
| `CLAUDE_CONTEXT.md` :86 | "Issue #15 … Blaze-blocked" | Annotated: #15 complete/closed per #36; enterprise-access remainder → #226 (#47/#48) |
| `SPRINT_STATUS.md` :100, :191 | "blocked on Blaze… standing decision" | File already globally superseded; #47 pointer added |

**Deferred (NOT in PR-A — outside decision A3's file list):**
`PlatformOperatingModel.md` :62 references "the Blaze-plan standing decision" as precedent.
It is not in A3's enumerated file list, so it is left untouched here to avoid scope
expansion; flag for a later pass if desired.

**Pre-existing `#15` references flagged but NOT changed here** (corrected framing per
DECISIONS #48): several architecture/assessment records use "#15" as the *general
Cloud-Functions-deployment-gate* shorthand — `ADR-005`, `ADR-006`, `ADR-007`,
`docs/architecture/customer-domain-foundation.md`, `docs/assessments/customer-hierarchy.md`,
`docs/assessments/customer-operability-data-ownership-and-analytical-export.md`, and
`docs/assessments/creation-and-page-formatting-consistency.md`. The *substance* they gate
on (enterprise-access / trusted-writer / audit Functions must be deployed and verified
before production) remains valid, but the correct owning issue for that remaining work is
**#226**, not #15 — and any statement that `createWorkOrder`/`transitionWorkOrder` are
"undeployed" is now stale (they are deployed, #36). These records are point-in-time
artifacts owned by other workstreams; their #15→#226 re-attribution and post-#36 staleness
are **flagged for the owning lanes**, not rewritten here, to keep this correction within the
#15/#226 ownership scope and avoid cross-workstream edits.

## Architectural corrections (record across the auth program)

1. **This is not the first Cloud Functions deployment.** Production precedent exists: 11
   deployed Gen 2 / Node 20 Functions, an established deploy-and-verify procedure, a fixed
   region/project (`us-central1`/`taylor-parts`), and existing production audit evidence.
2. **The new admin-reset Function is a new capability on an existing Functions platform,**
   not a greenfield Functions platform.
3. **These access-mutation Functions already exist but are undeployed:** `grantRole`,
   `revokeRole`, `assignApprovedRole`, `setUserStatus`, `approveAccessRequest`,
   `rejectAccessRequest`.
4. **The existing audit writer is the preferred trusted audit path:**
   `functions/src/access/auditEventWriter.ts` — `recordStandaloneAuditEvent` /
   `stageAuditEvent` (the platform's only audit-*write* path, ADR-007). Reuse it unless a
   documented gap makes extension impossible (decision A5).
5. **Password reset must not overload `setUserStatus`** unless the contract actually fits.
   Reuse shared authorization, audit, validation, and deployment patterns, but keep
   password-reset semantics explicit.
6. **Username login and self-service recovery are authentication concerns.** They must
   coordinate with enterprise authorization (ADR-005 / Issue #226) but must **not** become
   dependent on completing the entire Issue #226 migration.

## Spend governance is proportionate (Owner decision A4)

Blaze being active provides no blanket spend authority; every new cost-incurring capability
still requires proportionate governance (business justification, expected usage, cost or
free-tier posture, quota/abuse considerations, least-cost design, Owner approval where
exposure is material, deployment authorization, production monitoring, rollback/disablement
path). But governance is applied **proportionately**: trivial use of already-deployed
infrastructure operating within an approved bounded design does not require a separate full
cost gate.

## Boundaries (this lane)

Docs/governance only. No Functions deployment, no Firebase Console mutation, no billing
mutation, no app code, no Rules change, no GitHub issue closure before #47 merges and the
billing state is independently confirmed.
