---
artifact_type: assessment
gate: Governance Reconciliation Assessment
status: Draft
date: 2026-07-26
owner: Claude Code
baseline: f38703dca4cc6e07c782b098f2677015d68ce648
related_decisions: [47]
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

## Issue #15 — partial, not closed (Owner decision A2)

Issue #15 is referenced across `ADR-005`, `ADR-006`, `ADR-007`, and
`docs/architecture/customer-domain-foundation.md` as "production Cloud Functions **deployed
and verified**" — a deploy-and-verify gate, not a billing-availability question. It is
therefore **substantially advanced but not fully resolved**:

- **Completed:** the Work Order Functions deployment lane (`createWorkOrder`,
  `transitionWorkOrder`, `updateWorkOrderExecutionData`, deployed + verified, #36); the
  existing 11-Function production deployment and verification; retirement of
  "Blaze-unavailable" as a general technical blocker.
- **Still open:** the enterprise-access mutation Functions; claims bootstrap/migration
  where applicable; `accessVersion`/enforcement cutover; any other explicit #15
  deployment-and-verification obligations not completed.

**Action (after #47 merges):** update Issue #15 with completed vs remaining scope; re-scope
it (or split the remaining work into a clearly linked replacement issue) with updated
cross-references. **Do NOT blanket-close** #15 or represent the entire authorization
migration as complete; close it only if its remaining scope is moved to an explicit
replacement issue.

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
| `CLAUDE_CONTEXT.md` :86 | "Issue #15 … Blaze-blocked" | Annotated: partial per #36/#47 |
| `SPRINT_STATUS.md` :100, :191 | "blocked on Blaze… standing decision" | File already globally superseded; #47 pointer added |

**Deferred (NOT in PR-A — outside decision A3's file list):**
`PlatformOperatingModel.md` :62 references "the Blaze-plan standing decision" as precedent.
It is not in A3's enumerated file list, so it is left untouched here to avoid scope
expansion; flag for a later pass if desired.

**References that must NOT be changed** (they gate on Functions being *deployed and
verified*, which remains partly true): the #15-gating language in `ADR-005`, `ADR-006`,
`ADR-007`, and `customer-domain-foundation.md` for the **undeployed** enterprise-access
mutation set. These stay valid.

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
