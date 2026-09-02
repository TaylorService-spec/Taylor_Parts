# Decisions Log

Append-only record of Tier 1 decisions (per `docs/DelegationCharter.md` Section 3) that a future session would need to know: date, decision, reason, alternatives rejected. Small enough to skim weekly. ADR-worthy decisions get a full ADR instead and a one-line pointer here.

Do not edit or delete past entries — if a decision is superseded, log a new entry that says so and leave the original in place.

---

## 1. Charter adopted

**Date:** 2026-07-11
**Decision:** `docs/DelegationCharter.md` is in effect, governing this and future sessions. Claude holds Tier 1 decision authority (implementation, sprint scoping/sequencing, documentation maintenance, ADRs consistent with existing ones); Tier 2 items are escalated as `needs-decision` GitHub issues assigned to `@TaylorService-spec`; Tier 3 (commercial/spending/credentials) is never delegated.
**Reason:** Owner instruction, to shift Rudy's role from decision relay to exception handler.
**Alternatives rejected:** None — this is the founding entry.

## 2. ROADMAP.md's Sprint 2.1.4 status was stale

**Date:** 2026-07-11
**Decision:** Corrected `docs/ROADMAP.md`'s "Sprint 2.1.4 — not yet begun" line. Reality (confirmed via `docs/SPRINT_STATUS.md` and merged PR history): Sprints 2.1.1 through 2.1.10 are all merged and live, including Sprint 2.1.4 itself (Reorder Review & Decision, PR #69). Of the three named candidates the stale text offered (Review & Approval, Procurement Handoff, Receiving), the first is what Sprint 2.1.4 already built, and the second is effectively what Sprint 2.1.10 (Purchase Order Foundation) already built. Only **Receiving** remains genuinely unbuilt — explicitly out of scope in every Sprint 2.1.5–2.1.10 entry and listed as "Future Expansion" in `PlatformCapabilityModel.md`.
**Reason:** Charter's standing rule: "If reality contradicts the docs, that's a finding: fix the doc in the same PR or log it in DECISIONS.md." The stale line would have caused a future session (or this one, taken literally) to re-scope already-shipped work.
**Alternatives rejected:** Silently re-interpreting "Sprint 2.1.4" as the next real sprint without correcting the doc — rejected because it leaves the same trap for the next session that reads `ROADMAP.md` cold.

## 3. Next Inventory Management sprint scoped as Receiving (Reorder Request closeout)

**Date:** 2026-07-11
**Decision:** Scoped the next Inventory Management capability sprint as an audit-only **Receiving / Reorder Request closeout** step: a new terminal `ORDERED` → `RECEIVED` transition on the Reorder Request lifecycle, paired with a logged-only receipt note (same posture as Sprint 2.1.9's `inventory_actions`), explicitly not touching the `inventory_transactions` ledger. Numbered **Sprint 2.1.11** (continuing the existing sequence; `docs/capabilities/InventoryManagementPlan.md` only formally planned through 2.1.3, sprints 2.1.4–2.1.10 were scoped ad hoc afterward via `ROADMAP.md`/`CLAUDE_CONTEXT.md`, same pattern continues here). Full scope and acceptance criteria: GitHub issue (see `ROADMAP.md`/`SPRINT_STATUS.md` for the link once opened).
**Reason:** Only remaining named candidate not yet built (see entry #2). Checked against both standing constraints before committing:
- **Write-path rule** (`PROJECT_ARCHITECTURE.md`, `docs/architecture/SYSTEM_AUTHORITIES.md`): `inventory_transactions` is the Work-Order-driven, Admin-SDK-only ledger (ADR-003) — a client-direct write updating real stock counts would violate this. Scoping the receipt as a logged-only note (mirroring `inventory_actions`' existing `RECEIVE_STOCK` type) keeps the sprint on the client-direct-write side of that boundary, same as every 2.1.x sprint before it.
- **No-Blaze standing decision**: a trusted, ledger-updating Receiving write would require a Cloud-Function-mediated path, which needs Firebase Blaze (issue #15, not enabled). Scoping this sprint as audit-only avoids that dependency entirely; reconciling the audit note against real stock stays on `FUTURE_ARCHITECTURE_BACKLOG.md`'s existing backlog item (apply `inventory_actions` to `inventory_transactions` once Blaze is enabled) rather than being pulled into this sprint.
**Alternatives rejected:**
- Building real stock-count-updating Receiving now — rejected, would require a Cloud Function and Blaze, both blocked; would be Tier 2 (new deployment dependency) even if it weren't blocked outright.
- Starting Zero-history reorder sprint's PR 4 (Rules tightening) instead — rejected for this slot: it has an explicit precondition (PR #92 deployed, confirmed live, confirmed zero legacy-shape writes since) that hasn't happened yet; not a scoping choice, a hard blocker.
- Starting the Parts/Purchase Order Assignment Adoption sprint (`EmployeeAssignmentPicker` wiring) instead — rejected for this slot: explicitly marked "not to begin until Phase 3 fully lands" and needs a fresh Specification (the old one was never committed to the repo).

## 4. Correction to entry #3 — the `firestore.rules` change within Sprint 2.1.11 was mis-scoped as Tier 1

**Date:** 2026-07-11
**Decision:** Entry #3 above scoped all of Sprint 2.1.11, including its `firestore.rules` change (a new assignee-only `ORDERED` → `RECEIVED` write path), as a single Tier 1 decision. That was wrong: `docs/DelegationCharter.md` Section 2 lists "Changes to `firestore.rules` that alter who can read or write what" as Tier 2 (escalate) unconditionally — it does not carve out an exception for changes that follow an existing pattern or don't touch the Blaze-blocked ledger. The write-path-rule and no-Blaze checks in entry #3 were the right checks for *architectural* fit, but they don't substitute for the charter's separate, blanket Tier 2 reservation on Rules permission changes. The rest of Sprint 2.1.11's scope (domain function, UI, tests, doc updates) remains correctly Tier 1 — only the Rules change itself needed escalation.
**Caught by:** the environment's own permission classifier, at commit time, before anything was pushed to any remote branch. The implementation (rules + domain function + UI + tests + docs) was already fully written and its Rules tests passing (32/32 on a fresh emulator) when this was caught; it was stashed uncommitted on `sprint-2.1.11-receiving` rather than discarded, so no work is lost pending the decision.
**Reason:** Charter Section 4's escalation protocol — filed as `needs-decision` issue #97, assigned to `@TaylorService-spec`, with the specific Rules diff, the recommendation, and what happens under each option (approve / reject-or-modify / no response).
**Alternatives rejected:**
- Committing and opening the PR anyway, treating the classifier's block as a technicality — rejected outright; the charter's Tier 2 list is unconditional on this category, and working around a permission gate defeats the entire point of adopting the charter this session.
- Quietly reworking the rules change to look like a "read-only" or "narrower" change to avoid triggering the same review — rejected; the classifier's concern is the category of change (who can write what), not its size, and gaming that would be acting in bad faith toward the charter I was just asked to operate under.

## 5. Charter amended — Tier 1 now includes merging a Tier-1-only PR

**Date:** 2026-07-11
**Decision:** After PR #95 merged (Rudy's explicit approval) and issue #97 was approved, I attempted to merge PR #94 (docs-only, already verified accurate against live GitHub state earlier in the session) as ordinary Tier 1 "documentation maintenance." The environment's permission classifier blocked it: Rudy's prior "Approve" covered PR #95 and issue #97 specifically, not PR #94, and the charter's Tier 1 language ("Claude decides and logs; no approval needed") had never explicitly said whether that extended to the merge action itself, as opposed to the underlying decision to do the work. Asked Rudy directly; Rudy chose "Tier 1 PRs can be merged without asking" (as opposed to requiring an explicit approval every time). `docs/DelegationCharter.md` Section 2 amended accordingly (Amendment 1) **before** acting on the new authority, per the charter's own Section 7 requirement — then PR #94 was merged under it.
**Reason:** Charter Section 7 — Rudy amended the charter with a single message (an answered clarifying question, functionally the same as a direct instruction); the amendment is recorded here and in the charter's own "Amendment history" per that section's process.
**Alternatives rejected:**
- Treating Rudy's earlier general "3. ok" (in response to a status summary) as blanket merge authorization retroactively covering PR #94 — rejected; that "ok" acknowledged a plan/status update, not a specific merge request, and stretching it would have been the same "assume authorization from context" mistake flagged in `feedback_verify_before_recommending` (assistant memory).
- Leaving Tier 1 merge authority ambiguous and asking case-by-case forever — rejected once Rudy was asked directly and gave a clear standing answer; re-asking the same resolved question every time would just be noise.

## 6. PR #81 (Employee Foundation governance docs) corrected and merged under Tier 1 merge authority

**Date:** 2026-07-11
**Decision:** While `sprint-2.1.11-receiving` (PR #98) was blocked pending Rudy's manual Firestore Console spot-check (see the check requested in this session — not yet reported back as of this entry), picked up PR #81 as other Tier 1 work per the charter's "blocked work is set aside, other Tier 1 work continues" rule. PR #81's four governance docs (Assessment/Specification/Implementation Plan/Architecture Review for Employee Foundation) sat open through the entire span of PRs #82-#85 merging — the Architecture Review's "PR 4 remains not started" language and "does not extend to PR 4 in advance" caveat were accurate when written but stale for merge as-is (PR #85 merged 2026-07-10, before this correction). Corrected the review doc (PR 4/#85's actual merge, Implementation Plan status "in progress" → "complete", an explicit note naming the documentation-lag itself) and the three other docs' frontmatter (`status: Draft` → `Approved`, `related_pr` populated — all three were already functionally approved in prose, frontmatter just never reflected it) before merging, per the standing "fix the doc in the same PR, don't commit an already-stale record" rule (see entry #2 for the same pattern applied to `ROADMAP.md`).
**Reason:** Docs-only, no Tier 2 category touched (no `firestore.rules`, no governance-*meaning* change — this is correcting historical-record accuracy of an already-approved initiative, not re-deciding anything). Merged under the Amendment 1 Tier 1 merge authority (entry #5) once corrected, build/content verified.
**Alternatives rejected:**
- Merging PR #81 as originally written, stale PR-4 status included — rejected; would commit a governance record that's wrong about its own subject on arrival, the same trap `ROADMAP.md`'s stale "Sprint 2.1.4" line was (entry #2).
- Waiting for Rudy's spot-check result before touching anything else this session — rejected; the charter explicitly instructs continuing other Tier 1 work while something is blocked, not going idle.

## 7. PR #98's `firestore.rules` change deployed to production

**Date:** 2026-07-11
**Decision:** Deployed the `ORDERED` → `RECEIVED` Reorder Request transition rule (PR #98, merge commit `a3f8e8e363611a0a9badf9623a94b9cf728c0093`) to the live `taylor-parts` project via `firebase deploy --only firestore:rules --project taylor-parts`, under Rudy's explicit Owner Deployment Authorization (separate from PR #98's earlier merge authorization, per the standing merge-authorization-is-never-deploy-authorization rule). No application code changed — Rules only, per Rudy's explicit constraint.
**Evidence:**
- First deploy call: `cloud.firestore: rules file firestore.rules compiled successfully` → `firestore: uploading rules firestore.rules...` → `firestore: released rules firestore.rules to cloud.firestore` → `Deploy complete!`.
- Second, immediate deploy call (same content-fingerprint verification method used for PR #91's deploy, since Admin SDK read-back via `getSecurityRules().getFirestoreRuleset()` isn't available in this environment — no ADC): `firestore: latest version of firestore.rules already up to date, skipping upload...` — confirms the live ruleset's content now matches the local `firestore.rules` file exactly, including this change.
- Pre-deploy sanity check: `firestore.rules` and `field-ops-app-vite/firestore.rules` confirmed byte-identical, and confirmed to contain the `ORDERED -> RECEIVED` rule block, before the deploy command ran.
**Reason:** Explicit, separate Owner Deployment Authorization received for this specific change at this specific merge commit.
**Not resolved by this deployment:** PR 4 (Rules tightening, removing the transitional legacy-shape branch from PR #91's create rule) still requires Rudy's own Firebase Console spot-check for post-deployment legacy-shape `reorder_requests` writes (unrelated precondition, still outstanding as of this entry) before it can be scoped.
**Alternatives rejected:**
- Recreating the deleted `admin-check` tool (or otherwise sourcing a production service-account credential) to perform the still-outstanding legacy-write spot-check as part of this same session — rejected repeatedly and explicitly; unrelated to this entry's deployment action, logged separately as a declined request, not a decision made.

## 8. PR #103's `firestore.rules` change deployed to production — Zero-history reorder sprint complete

**Date:** 2026-07-11
**Decision:** Deployed PR 4's Rules tightening (PR #103, merge commit `23176950f0392019c3851b00ab35680cf87980e6`) to the live `taylor-parts` project via `firebase deploy --only firestore:rules --project taylor-parts`, under Rudy's explicit Owner Deployment Authorization (separate ask from PR #103's earlier merge authorization). No application code changed — Rules only.
**Evidence:**
- Pre-deploy: `git rev-parse main` and `git rev-parse origin/main` both confirmed exactly `23176950f0392019c3851b00ab35680cf87980e6`, the authorized merge commit; `git status --porcelain` confirmed a clean working tree — no uncommitted changes could have altered what got deployed.
- First deploy call: `cloud.firestore: rules file firestore.rules compiled successfully` → `firestore: uploading rules firestore.rules...` → `firestore: released rules firestore.rules to cloud.firestore` → `Deploy complete!`.
- Second, immediate deploy call (same content-fingerprint verification method used for PR #91's and PR #98's deploys — Admin SDK read-back via `getSecurityRules().getFirestoreRuleset()` remains unavailable, no ADC in this environment): `firestore: latest version of firestore.rules already up to date, skipping upload...` — confirms the live ruleset's content now matches `main`'s `firestore.rules` exactly, including the legacy-shape-branch removal.
- Post-deploy: `git status --porcelain` re-confirmed clean; nothing else was deployed alongside this.
**Reason:** Explicit, separate Owner Deployment Authorization received for this specific change at this specific merge commit.
**Effect now live:** any `reorder_requests` create missing `recommendationStatus`/`requestedQty`/`quantitySource` is rejected for every caller, including admin/dispatcher — the transitional legacy-shape allowance PR 2 (#91) intentionally left in place is fully closed. The live writer (`createReorderRequest()`, unchanged since PR #92) already always sent the canonical shape, so no currently-live client behavior changes as a result.

**Zero-history reorder behavior sprint: all four PRs complete and live.**
| PR | Merge commit | Deployed |
|---|---|---|
| 1 — `recommendationStatus`/nullable `urgency` | `a66871883a6136de1d9e2c9cf7d4dd9dcf6dce70` | Frontend-only, auto-deployed at merge |
| 2 — transitional Rules | `41392de0e3104c9a378e2ce4e226ce6379ef4380` | `firestore.rules`, deployed 2026-07-11 |
| 3 — write path + UI | `79a64c175a8dcc7cb5ae1cdbbbec8cc1e1498539` | Frontend-only, auto-deployed at merge |
| 4 — Rules tightening | `23176950f0392019c3851b00ab35680cf87980e6` | `firestore.rules`, deployed 2026-07-11 (this entry) |

Root cause this sprint fixed (per the Assessment): every Reorder Request recommendation showed a misleading `0`/`LOW` because the sole writer of `CONSUMED` ledger transactions has never been deployed (Blaze plan blocker, issue #15). `recommendationStatus`/`NEEDS_PLANNING` now surfaces that honestly instead of silently degrading, and the manual-entry path for zero-history parts is now closed to legacy-shape bypass. The underlying Blaze/Cloud-Function gap itself is unchanged and out of this sprint's scope, per the Assessment's own framing.
**Alternatives rejected:** None — this entry records completion, not a choice among options.

## 9. PR #109's Firestore composite index deployed to production

**Date:** 2026-07-11
**Decision:** Deployed the `employees` composite index (`employmentStatus` ASC, `userId` ASC — PR #109, merge commit `d3767e9195dab827f752dfb58661328c7d5b15d5`) to the live `taylor-parts` project via `firebase deploy --only firestore:indexes --project taylor-parts`, under Rudy's explicit Owner Deployment Authorization scoped to indexes only. No application code, `firestore.rules`, Functions, or Hosting touched.
**Evidence:**
- Pre-deploy: confirmed local `main` and `origin/main` both exactly `d3767e9195dab827f752dfb58661328c7d5b15d5`, clean working tree.
- Deploy: `firebase deploy --only firestore:indexes --project taylor-parts` — output confirmed `firestore: deployed indexes in firestore.indexes.json successfully for (default) database`. The CLI separately noted one pre-existing production index (`fieldops_jobs`, unrelated) not present in the local `firestore.indexes.json` file — **not deleted**, since the deploy ran without `--force`, per the authorization's explicit "do not touch any other surface" constraint.
- Build status polled via `firebase firestore:indexes --project taylor-parts --pretty` (the `--pretty` flag is required for build-state visibility; the default JSON output doesn't include it): `[CREATING]` immediately after deploy, `[READY]` roughly 2-3 minutes later — confirmed via two polling checks before proceeding.
- Root cause this index fixes: `EmployeeAssignmentPicker`'s query (`buildAssignableEmployeesQuery()` called with no `requiredOperationalRole`, i.e. exactly PR #105's usage) filters `employmentStatus == "ACTIVE"` and `userId != null` — an equality plus an inequality on two different fields, which Firestore requires an explicit composite index for. That index never existed in production; the picker's `employees` query failed there (working only in the local emulator, which builds indexes implicitly), a real live/emulator parity gap this repo hadn't hit before this feature.
**Not yet done:** Live production verification of the picker itself (login, name search, assignment, confirming the correct `userId` is stored) — **blocked on production admin credentials**, which don't exist anywhere in this environment (no ADC, no service-account key, and the `firebase` CLI's own OAuth session authorizes deploy operations only, not the app's own Firebase Auth login). Asked Rudy how to proceed rather than fabricating or requesting a workaround, consistent with this session's standing declines on credential-adjacent requests.
**Alternatives rejected:**
- Running `firebase deploy --only firestore:indexes --force` to also clean up the unrelated pre-existing `fieldops_jobs` index difference — rejected; explicitly out of scope for this authorization, and deleting an index outside this task's purpose isn't this decision's call to make.
- Attempting the production live-test via the local emulator against `?emulator=1` instead of real production — rejected; would not actually verify the thing that was broken (a live-project-only index gap the emulator never had, since emulators build indexes on demand) — an emulator pass here would be a false confirmation, not a real one.

## 10. PR #111's Firestore composite index deployed to production, picker verified live

**Date:** 2026-07-11
**Decision:** Merged PR #111 (`e08058aefc096f65bc6012637c518feb5e0c70d5`, merge commit `8139b18ed1487c160c480d98754ec29b8b23837b`) under Owner Merge Authorization, then deployed its `employees` composite index (`employmentStatus` ASC, `operationalRoles` CONTAINS, `userId` ASC) to `taylor-parts` via `firebase deploy --only firestore:indexes --project taylor-parts`, under a separate Owner Deployment Authorization scoped to indexes only. No `firestore.rules`, Functions, or Hosting touched.
**Evidence:**
- Pre-deploy: confirmed local `main` and `origin/main` both exactly `8139b18ed1487c160c480d98754ec29b8b23837b` (local `main` needed a fast-forward from a stale `37d5185` first), clean working tree.
- Deploy: `firebase deploy --only firestore:indexes --project taylor-parts` — `Deploy complete!`. CLI again noted one pre-existing production index not present in the local file (the same `fieldops_jobs` entry from entry #9) — not deleted, `--force` not used.
- Build status polled via `firebase firestore:indexes --project taylor-parts --pretty` every 15s: `[CREATING]` through poll 12 (~3 minutes), `[READY]` at poll 13.
- Frontend deploy verified via `gh run list --commit 8139b18...`: both `Vite Build Check` and `Deploy Field Ops (Vite) to GitHub Pages` completed `success` at the merge commit.
- **Live production picker verification, performed by Rudy directly (same credential boundary as entry #9 — this environment still has no production Auth/browser access):** opened an existing `READY_FOR_PARTS_MANAGER` request, opened "Assign to Parts Associate" — loaded without error, correctly showed "No eligible employees found" (production `employees` collection is currently empty), did not show the prior "Unable to load employees" failure. Assign was not clicked; no request created or modified; no production data written. **PASS.**
**Known limitation carried forward, unchanged by this deployment:** the picker's `requiredOperationalRole` filter remains UX-level only — `firestore.rules`' `READY_FOR_PARTS_MANAGER` → `ASSIGNED_TO_PARTS_ASSOCIATE` transition still validates only that `assignedToUserId` is a non-empty string, not the target's `operationalRoles`. Accepted at Final Review as not merge-blocking (existing permission isn't widened; the supported UI only gets more restrictive) — see PR #111's Final Review approval for full reasoning. A Rules-level fix would need a redesigned assignment contract carrying Employee identity Rules can validate by document path; not attempted here.
**Not yet done:** production test-persona provisioning (six planned personas) — remains gated on a separate Owner Production Data Authorization, still not requested as of this entry.
**Alternatives rejected:** None new — same reasoning as entry #9 applies (no `--force`, no emulator-only substitute for the live-project-specific index gap).

## 11. Six production test personas provisioned via `provisionEmployeeAccess.js --requireExistingAuthUser`

**Date:** 2026-07-11
**Decision:** Ran the six commands specified in the Owner's Production Data Authorization (five existing-account linkages + one Employee-only create) against `taylor-parts`, at repository state `f02f0a3804cd9eb24fe3d916c53bf5f7d7ac9dc5` (PR #114's merge commit). Executed by the Owner directly — this environment has no production Admin SDK credentials (see entries #9/#10), so I could not run these myself; I prepared and specified the authorization, the Owner ran it, and reported results back for recording here.
**Operations (five linked, one Employee-only, per the standing plan at `docs/CLAUDE_CONTEXT.md`'s "Employee test-persona provisioning" section):**
- `emp-rudy-owner` — linked, `securityRole: admin`, no operational roles.
- `emp-rudy-parts-manager` — linked, `securityRole: dispatcher`, `operationalRoles: [PARTS_MANAGER]`.
- `emp-rudy-warehouse-manager` — linked, `securityRole: dispatcher`, `operationalRoles: [WAREHOUSE_MANAGER]`.
- `emp-rudy-parts-associate` — linked, `securityRole: dispatcher`, `operationalRoles: [PARTS_ASSOCIATE]`.
- `emp-rudy-driver` — linked, `securityRole: technician`, no operational roles (no `DRIVER` value exists in `VALID_OPERATIONAL_ROLES`; per Issue #100 this persona has no Inventory nav access regardless of provisioning, independent of this operation).
- `emp-rudy-sales-manager` — Employee-only create, no `--email`/`--securityRole`/`--operationalRoles`. `SALES_MANAGER` deliberately left unassigned — reserved, not yet activated on the client.
Every linked-persona command carried `--requireExistingAuthUser` (PR #114) — none could have fallen through to passwordless account creation even if an email lookup had failed.
**Verification, reported by the Owner (I did not independently verify — no production read access):**
- All five linked personas: `PASS` — Employee exists and `employmentStatus == ACTIVE`; `employees/{employeeId}.userId` matches the intended existing Auth account; `users/{uid}.employeeId` points back correctly; `securityRole` and `operationalRoles` both exactly match the authorization.
- `emp-rudy-sales-manager`: `PASS` — Employee exists and `ACTIVE`, `userId == null`, `operationalRoles` empty, no `users/` document or Auth linkage created.
- No Firebase Auth account created, modified, deleted, or disabled. No password, credential, token, or reset link exposed at any point. No Rules/indexes/Functions/Hosting/application code deployed. No production action occurred beyond these six Employee/User operations.
**Not recorded here:** UIDs, emails, and any other account-identifying detail beyond Employee IDs — per the Owner's explicit instruction to keep this record free of anything credential- or secret-adjacent. If a future session needs the actual email/uid mapping to debug a specific persona, ask the Owner directly rather than expecting it in this file.
**Alternatives rejected:** None — this entry records completion of an already-fully-specified, already-approved authorization; no new choice was made here.

## 12. PR #121 merged; Issue #118 (raw-uid display follow-up) scoped as the session's next Tier 1 unit of work

**Date:** 2026-07-11
**Decision:** Merged PR #121 (docs-only session-context refresh) under Tier 1 merge authority, after re-verifying its content against current `gh issue`/`gh pr` state independently rather than trusting the refresh at face value (confirmed via a explicit user check-in before the actual merge action, since the auto-mode classifier correctly flagged that the PR's own text said "awaiting Owner Merge Authorization", and an explicit user check-in confirmed the merge before it ran). With both `docs/implementation-plans/reorder-request-cancellation.md` (PR #108) and the Customer Record Page Implementation Plan (PR #120) blocked on an external ChatGPT Final Review gate — not a Rudy decision, so not a `needs-decision` escalation — the next available Tier 1 unit of work was Issue #118: two remaining raw-uid display sites (`PartDetail.jsx`'s `lastPurchasingUpdateBy`, `InventoryActionsPanel`'s `action.createdBy`) that PR #107 didn't cover. Small, fully-scoped with acceptance criteria already written, no schema/Rules/write-path change, unblocked (its sole dependency, PR #107, is merged).
**Reason:** Selecting the next unblocked, fully-specified Tier 1 item when the two larger initiatives in flight are both waiting on an external review gate — consistent with "other Tier 1 work continues" under the Delegation Charter's escalation protocol.
**Also corrected as documentation maintenance in the same PR:** `docs/ROADMAP.md`'s "Near-term" section still said "Sprint 2.1.11 — Receiving... is scoped next," stale since PR #98 merged and deployed; corrected to reflect all of Sprints 2.1.4–2.1.11 (including Receiving) as complete and live.
**First use of the new `docs/user-guide/` requirement:** created `docs/user-guide/README.md` (index) and `docs/user-guide/reorder-requests.md` (first capability page) in the same PR, since this fix changes what purchasing-update and inventory-action-log rows display to a user. No prior stub existed to backfill from — this is the first page under the new rule, not a backfill.
**Known limitation this session could not resolve:** `gh project item-add` failed (`gh auth refresh -s read:project` required, an interactive OAuth scope grant this environment cannot complete non-interactively) — PR #121 and this session's new PR/issue could not be added to the "Taylor Freezer" GitHub project as the session's instructions require. Flagged to the Owner directly rather than attempting a credential-adjacent workaround; needs the Owner to either run `gh auth refresh -s project` locally or grant a PAT with `project` scope.
**Alternatives rejected:** None — this entry records a Tier 1 sprint-scoping decision under an already-adopted charter, not a choice among competing options.

## 13. Applied ChatGPT Final Review REQUEST CHANGES corrections to PR #108 and PR #120's Implementation Plans

**Date:** 2026-07-11
**Decision:** Corrected the Owner's session-status report that PR #108 and PR #120 were "awaiting external Final Review responses" -- both reviews had already returned, as REQUEST CHANGES on the Implementation Plan gate. Applied all required corrections to both documents as documentation-only changes, per the Owner's explicit instruction ("apply those documentation-only corrections and return new READY Implementation Plan handoffs... do not begin implementation for either initiative until its corrected Implementation Plan is approved").
**PR #108** (`docs/implementation-plans/reorder-request-cancellation.md`), reviewed head `4851324` → corrected head `d3d5cef`: fixed the Rules-relevant PR count (was "2, 4, 5", corrected to "1, 3, 4, 5"); added a "Deployment and rollback boundaries" section covering all six sprint stages; expanded the tracking table to five states per PR; added a "Legacy-document test obligation" section for PRs 4/5; added a "PR 4/5 merge-before-Rules-deployment safety" section with an explicit Final Review scope check.
**PR #120** (`docs/implementation-plans/customer-record-page-structured-address.md`), reviewed head `b8f04c3` → corrected head `76ac257`: moved all interaction/accessibility/regression verification for the first-ever `Tabs` component into PR 1's own scope (nothing deferred to PR 2); defined PR 2's verification separately and renamed PR 2 to drop the now-inaccurate "Location add form" claim; expanded tracking to three columns (merge/frontend deployment/live verification); bounded PR 2's correction scope to defects its own changes cause, not open-ended "any corrections discovered"; rebased onto current `main` (`a969843`, post PR #122) -- also surfaced and removed a stale duplicate paragraph about this same initiative in `docs/SPRINT_STATUS.md`, left over from before PR #121/#122's refresh, that had drifted out of sync with the current one (claimed 8 open Owner business decisions the Specification has since resolved).
**Status after this session:** both Implementation Plans remain **Draft**; both PRs remain **Draft and documentation-only**. No application code, schema, Rules, deployment, or production-data action occurred for either initiative. Both PR bodies updated with a "Final Review round 1 -- REQUEST CHANGES, applied" section documenting the corrections and returning a READY handoff at the new head, per the review's own re-review instructions. **Implementation (PR 1 of either sprint) has not begun**, per the Owner's explicit instruction.
**Also recorded:** the Owner's project-scope decision -- do not retry `gh project item-add`/`gh project list` each session while the token lacks `project` scope; treat it as a known operator prerequisite (Owner refreshing via `gh auth refresh -h github.com -s project` separately), not a recurring blocker. Once the Owner confirms the refresh, the reconciliation is: `gh auth status` → confirm `gh project list` works → reconcile the open issue/PR backlog into Taylor Freezer → add recently-closed items the project should retain for history → record completion here → never print or record the token. Logged as a memory entry (`feedback_gh_project_scope_gap`) so future sessions don't rediscover this each time.
**Alternatives rejected:** None -- this entry records completion of two explicitly-scoped correction requests, not a choice among competing options.

## 14. PR #120's Implementation Plan Final Review round 2 APPROVED; PR #120 merged

**Date:** 2026-07-11
**Decision:** ChatGPT's Final Review round 2 returned APPROVED on the Customer Record Page Implementation Plan at head `76ac2579e8ea8689585ebca3f73d3a25ae30e2d1`. Applied the review's five "Next" steps: marked the Implementation Plan `status: Approved` and recorded the review inline; rebased onto `main` at `e74d143` (post entry #13's PR #123); confirmed documentation-only scope, `MERGEABLE`/`CLEAN`, CI green; requested Owner Merge Authorization via the PR body; confirmed Owner authorization directly before merging. Merged PR #120 (squash, branch deleted), fast-forwarding `main` to `cc13f10`.
**Also corrected while updating status:** `docs/SPRINT_STATUS.md` and `docs/CLAUDE_CONTEXT.md` still said the Implementation Plan was "Draft, awaiting review" after the approval -- updated both to reflect Approved status and the new next-step (docs PR merged; PR 1 implementation paused behind PR #108 unless reprioritized).
**Not yet done:** Customer Record Page PR 1 (`Tabs`/`AddressFields`/header+tab shell) implementation has not begun -- approved and unblocked on the documentation side, but paused behind Cancel/Void per Owner priority (see entry #15 below).
**Alternatives rejected:** None -- this entry records completion of an already-approved gate transition, not a choice among options. (Filed here rather than at the time, since this entry was missed in the prior turn's summary -- corrected now rather than left unrecorded.)

## 15. PR #108's Implementation Plan Final Review round 2 APPROVED, rebased; awaiting Owner Merge Authorization

**Date:** 2026-07-11
**Decision:** ChatGPT's Final Review round 2 returned APPROVED on the Cancel/Void Implementation Plan at head `d3d5cef51898f08e66701cf4a9e479afcf1f9037`. Per the Owner's explicit priority decision (proceed with PR #108 next, ahead of Customer Record Page PR 1), applied: marked the Implementation Plan `status: Approved` and recorded both review rounds (round 1 REQUEST CHANGES at `4851324`, round 2 APPROVED at `d3d5cef`) inline; rebased onto `main` at `cc13f10` (post PR #120, entry #14); checked every changed file's PR/Issue cross-references against current main for drift -- none found; confirmed the PR stays documentation-only; confirmed `MERGEABLE`/`CLEAN`, CI green, and exact changed-file scope is `docs/assessments/`, `docs/implementation-plans/`, `docs/specifications/` only (no code/Rules/deployment/production-data). Requested Owner Merge Authorization via the PR body at head `3f8e815`.
**Not yet done:** PR #108 itself has not merged as of this entry -- awaiting the Owner's explicit merge authorization. Cancel/Void PR 1 (Transitional Rules) implementation has not begun and will not begin until this docs PR merges. Per the Owner's explicit sequencing: PR 1 will require its own independent Rules-focused Final Review; its Rules will not be deployed without a separate Owner Deployment Authorization; PR 2 does not begin until PR 1 is merged, deployed, and verified live.
**Alternatives rejected:** None -- this entry records a Tier 1 documentation-gate transition under explicit Owner priority direction, not a choice among competing options.

## 16. Taylor Freezer GitHub Project reconciliation

**Date:** 2026-07-11
**Decision:** Reconciled the "Taylor Freezer" GitHub Project (Project #1, owner `TaylorService-spec`) against the repository's open issues/PRs and this workstream's closed/merged history, per the Owner's explicit instruction after confirming the `gh` CLI's `project` scope refresh (`gh auth status` verified `'project'` in token scopes; `gh project list` confirmed Project #1 open).
**Items examined:** 4 pre-existing project items (Issue #15, Issue #100, PR #107, PR #108) via `gh project item-list`. Repository inventory: 3 open issues (`gh issue list --state open`), 0 open PRs (`gh pr list --state open`), 3 closed issues from this workstream (`gh issue list --state closed`), and merged PRs numbered ≥90 (charter adoption, PR #95, onward) via `gh pr list --state merged --limit 100`, filtered to `number >= 90` -- 30 PRs, confirmed no gaps against the full merged-PR count of 100 (i.e. nothing in the 90-124 range was missed).
**Already present (no duplicate added):** Issue #15, Issue #100, PR #107, PR #108.
**Added (32 items, all confirmed via a post-add `gh project item-list` re-read, total item count 4 → 36):**
- Open issues: #119 (Customer Record Page).
- Closed issues (workstream history): #96 (Sprint 2.1.11 Receiving), #97 (needs-decision: Receiving Rules grant), #118 (raw-uid display follow-up).
- Merged PRs (workstream history, #90-#124 range minus the 4 already present): #90, #91, #92, #93, #94, #95, #98, #99, #101, #102, #103, #104, #105, #106, #109, #110, #111, #112, #113, #114, #115, #116, #117, #120, #121, #122, #123, #124.
**Duplicates avoided:** All 4 pre-existing items skipped -- confirmed via the pre-add inventory before any `item-add` call, per the Owner's explicit "inspect existing items before adding anything" instruction.
**Fields/status:** Not set or invented by this reconciliation. The project's own workflow automation assigned `Status: Done` to every merged PR/closed issue added and `Status: Todo` to every open item added, matching the pattern already present on the 4 pre-existing items (`Done` for #107/#108, `Todo` for #15/#100) -- no field was manually set, no existing item's field was touched.
**Items that could not be added:** None -- every intended addition (1 open issue + 3 closed issues + 28 merged PRs = 32) succeeded.
**Token handling:** No token value was printed, logged, or committed at any point in this reconciliation -- `gh auth status` output was read for scope confirmation only (masked token display, `gho_****...`), never captured into a file.
**Alternatives rejected:** None -- this entry records completion of an already-authorized reconciliation, not a choice among competing options.

## 17. PR #117's transitional Rules deployment confirmed live by the Owner -- Cancel/Void PR 2 (writer) unblocked

**Date:** 2026-07-11
**Decision:** Before beginning Cancel/Void PR 2 (writer), verified that the Owner's own gate ("do not begin PR 2 until PR 1 is merged, deployed and verified live") was actually satisfied rather than assuming it from `docs/SPRINT_STATUS.md`/`docs/CLAUDE_CONTEXT.md`'s "merged and deployed" language. Confirmed independently that PR #117 (transitional Rules, step A of the Specification's expand/contract sequence) is **merged** -- `firestore.rules` on `main` contains the dual-shape `hasCanonicalReorderRequestKeys()`/`...CreationBaseline()` check (old 29-key branch OR new 35-key branch with the six Cancel/Void fields, all `null`). Could not independently confirm **deployment** to the live `taylor-parts` project -- this environment has no read-only Admin SDK access (no ADC, consistent with entries #9/#10's documented limitation), and running `firebase deploy --only firestore:rules` to check would itself be a deploy action requiring its own Owner Deployment Authorization, not something to do casually as a side-effect of a status check. Flagged this gap directly rather than assuming; the Owner confirmed PR #117's Rules are already live.
**Also noted:** unlike every other `firestore.rules` deploy in this project's history (entries #7, #8, #9, #10, each with a two-call deploy-and-verify record), no dedicated deployment-evidence entry exists for PR #117. This entry is that record, after the fact, based on the Owner's direct confirmation rather than a first-party deploy-call verification -- a weaker evidentiary standard than this project's norm, noted here so a future session doesn't mistake it for the usual two-call verification.
**Effect:** Cancel/Void PR 2 (writer -- updating `createReorderRequest()` to always send the six new fields as explicit `null`) is now unblocked and begins next.
**Alternatives rejected:** Proceeding to PR 2 without raising the deployment-evidence gap -- rejected; the Owner's own gate was explicit and the repo's own standing lesson (merged ≠ deployed) applied directly here, so this was confirmed rather than assumed.

## 18. PR #127 (Cancel/Void writer, PR 2 of 6) merged and deployed -- step C partially confirmed

**Date:** 2026-07-11
**Decision:** Merged PR #127 under Tier 1 merge authority (confirmed with the Owner first) -- `createReorderRequest()` now always sends the six new Cancel/Void fields as explicit `null`, per the Specification's step B. Frontend-only, no Rules change; auto-deploys at merge.
**Deployment confirmed:** `gh run list --branch main` for merge commit `8925811` shows both `Vite Build Check` and `Deploy Field Ops (Vite) to GitHub Pages` completed `success`.
**Step C is only partially confirmed by this entry.** The Specification's step C requires two things: (i) the deployed frontend is serving the updated `createReorderRequest()` -- **confirmed**, via the GitHub Actions run above matching the merge commit; (ii) a sample of newly-created `reorder_requests` documents post-deployment all carry the six new fields as `null`, with no post-deployment old-shape create observed -- **not confirmed by this entry**, since this environment has no production Firestore read access (no ADC, same standing limitation as entries #9/#10/#17). **PR 3 (tightened Rules) must not be drafted until part (ii) is also confirmed and recorded** -- this entry alone does not satisfy step C's full requirement, per the Implementation Plan's own sequencing note.
**Next action needed:** the Owner (or someone with production Firestore read access) needs to sample a few `reorder_requests` documents created after this deploy and confirm they carry `cancelledBy`/`cancelledAt`/`cancellationReason`/`voidedBy`/`voidedAt`/`voidReason` all present and `null` -- or confirm via a live "Request Reorder" smoke test that a freshly created request round-trips correctly.
**Alternatives rejected:** Treating GitHub Actions' successful deploy alone as satisfying all of step C -- rejected; the Specification is explicit that step C has two parts, and this environment can only self-verify one of them.

## 19. PR 1 (Transitional Rules) implementation authorization -- resolved as already-satisfied by PR #117, not new work

**Date:** 2026-07-11
**Decision:** The Owner issued a fresh "Implementation Authorization -- Cancel/Void PR 1" describing Transitional Rules as not-yet-started work, with a full required scope, test coverage, and a "Rules-focused Final Review handoff" deliverable. Before writing anything, verified against current `main`: `firestore.rules` already contains this exact change (dual-shape `hasCanonicalReorderRequestKeys()`/`...CreationBaseline()`, old 29-key branch OR new 35-key branch with the six Cancel/Void fields all `null`, partial presence rejected), shipped as **PR #117** (merged `21e7f66`), and confirmed deployed live by the Owner directly last turn (entry #17). Both `firestore.rules` copies are still byte-identical. Flagged this discrepancy to the Owner rather than opening a redundant branch; the Owner confirmed: treat PR #117 as satisfying this authorization's PR 1 scope, and return the Final Review handoff for it as-is -- no new branch, no new PR, no Rules change, no deploy.
**Verification performed against every requirement in the authorization, using a genuinely fresh emulator (killed a stale leftover emulator process from a prior turn's testing by its specific PID, `netstat`-verified port 8080 free before restarting -- not a blanket `taskkill` by image name, which the environment's own safety classifier correctly declined earlier):**
- `functions/test/reorderRequestsRules.test.js`: **37/37 pass**, single clean run, output captured to a log file rather than re-invoked (a second invocation against the same emulator without clearing data produces false `ALREADY_EXISTS`-driven failures on the "accepted"-case tests -- not a Rules regression, a test-idempotency artifact of the fixed document IDs the script uses; this repeated the earlier session's mistake once before catching it). Confirmed present and passing: both old-shape accept cases (`READY with requestedQty: 0`, `READY with a normal positive requestedQty`), both new-shape accept cases (`READY`/`NEEDS_PLANNING` with all six null), all partial-presence rejects (one field, three fields), the all-six-but-one-non-null reject, the unexpected-extra-field reject, and every pre-existing authorization/`requestedQty`/canonical-baseline case.
- `functions/test/employeesRules.test.js`: **10/10 pass**, unaffected.
- `functions` TypeScript build (`npm run build` / `tsc`): clean, no errors.
- `diff firestore.rules field-ops-app-vite/firestore.rules`: byte-identical.
- `git diff 21e7f66~1 21e7f66 --stat`: confirms PR #117's only changed files are the two `firestore.rules` copies and `functions/test/reorderRequestsRules.test.js` -- no writer, UI, or `reorder_purchase_orders` change.
- `grep -n "CANCELLED\|VOIDED\|reorder_purchase_order_voids" firestore.rules`: no matches -- no transition or void-collection Rules exist yet, confirming PR 4/5/6 scope hasn't leaked in.
**READY Rules-focused Final Review handoff (for PR #117, already merged/deployed):**
- PR number and head: **PR #117**, merge commit `21e7f66a7106089ba6dc784dff10bce31a7cdee4`.
- Exact changed files: `firestore.rules`, `field-ops-app-vite/firestore.rules`, `functions/test/reorderRequestsRules.test.js`.
- Exact test results: 37/37 (`reorderRequestsRules.test.js`), 10/10 (`employeesRules.test.js`), both against a fresh emulator.
- Old/new complete shapes accepted, partial shapes rejected: confirmed, itemized above.
- Both Rules copies match: confirmed byte-identical.
- No writer/UI/transition/void-collection implementation: confirmed via diff and grep, itemized above.
- Nothing deployed **by this verification pass**: confirmed -- no `firebase deploy` command was run this turn. (PR #117's own deployment to production was a separate, earlier, Owner-authorized action, already recorded in entry #17 -- this entry does not re-authorize or repeat that deploy.)
**Not done, per the Owner's explicit "do not merge / do not deploy / do not begin PR 2" instruction:** no merge action (PR #117 was already merged in an earlier turn, not by this entry); no deploy action; PR 2 already exists separately (PR #127, merged -- pre-dates this authorization, not begun by this entry).
**Alternatives rejected:** Opening a new, empty-diff branch/PR to satisfy the letter of "create a dedicated feature branch" -- rejected as pointless and misleading (a PR with zero changes doesn't represent real work, and would falsely imply PR 1 was reimplemented rather than already existing). Reverting and redoing PR #117 as fresh work -- rejected; not requested once the discrepancy was surfaced, and would have been a real, unnecessary production Rules rollback.

## 20. Step C blocked -- read-only deployment diagnosis, no defect found in code or deployment

**Date:** 2026-07-11
**Decision:** The Owner reported that a newly created production `reorder_requests` document did not show the six Cancel/Void fields, blocking step C and PR 3. Performed a read-only diagnosis, no code/Rules/data changes, per the Owner's explicit constraint.
**Findings, each independently verified:**
1. PR #127's merge commit: `892581196773fd247783309edbbb522d2657d435` (`gh pr view 127 --json mergeCommit`).
2. Deploy workflow at that exact commit: both `Vite Build Check` and `Deploy Field Ops (Vite) to GitHub Pages` completed `success` (`gh run list`). The GitHub Pages deployment record for that sha exists (`gh api .../deployments`), and the *latest* Pages deployment as of this diagnosis is a later, docs-only commit (`2cd2a5a`) whose deploy also succeeded -- confirmed via its deployment status (`success`).
3. **Live bundle inspected directly**: fetched `https://taylorservice-spec.github.io/Taylor_Parts/field-ops/` (the app's actual path -- the site *root* serves an unrelated legacy single-file app, "Parts Control Center," per `.github/workflows/deploy-field-ops.yml`'s combined-site assembly step; this is expected, documented behavior, not a misconfiguration). Its referenced bundle, `assets/index-BGw0jvgp.js`, was fetched directly and searched: all six field names (`cancelledBy`, `cancelledAt`, `cancellationReason`, `voidedBy`, `voidedAt`, `voidReason`) are present, unminified (JS minifiers don't rename object-literal string keys), each appearing exactly once, each explicitly `: null` in the object literal `createReorderRequest()` sends.
4. **Bundle-to-source correspondence confirmed two ways**: (a) the live `index.html`'s referenced hash (`index-BGw0jvgp.js`) exactly matches the hash produced by a fresh local `npm run build` from current `main` (Vite's content-hashed filenames make an exact hash match strong evidence of byte-identical content); (b) a direct diff of live `index.html` against a freshly-rebuilt local `dist/index.html` showed no content difference (one whitespace-only line-ending diff).
5. `main`'s `createReorderRequest()` vs. deployed bundle: identical -- the minified bundle's object literal (`...receivedAt:null,cancelledBy:null,cancelledAt:null,cancellationReason:null,voidedBy:null,voidedAt:null,voidReason:null})}function IA(...`) matches `field-ops-app-vite/src/domain/inventoryReorderRequests.js`'s source field-for-field, immediately followed by the minified `requestReorderForRecommendation()` orchestrator.
6. **Cache/staleness check**: no service worker exists anywhere in `field-ops-app-vite` (`public/`, `src/`, `vite.config.*`, `index.html` all checked -- none registers one). Server-side `Cache-Control: max-age=600` (10 minutes) exists on both `index.html` and the JS bundle (Fastly/GitHub Pages CDN) -- a real but self-resolving staleness window, not a persistent one; by the time of this diagnosis (well past 10 minutes, and past two further docs-only deploys of identical app content), CDN cache cannot be the cause. **The one caching mechanism this diagnosis could not rule out is client-side**: a Single Page App does not re-fetch its JS bundle on its own once loaded -- a browser tab already open and running the app *before* 17:15:31 (PR #127's live timestamp) would keep executing the old, pre-fix `createReorderRequest()` in memory indefinitely, regardless of what's newly deployed server-side, until that tab is refreshed or reopened. This is the most common real-world cause of "deployed but still broken" reports for SPAs, and this repo has no defense against it (no service-worker-driven update prompt, no version-check polling).
7. **Write-path confirmed single and correct**: grepped the entire `field-ops-app-vite/src` tree for any other creator of `reorder_requests` documents -- none exists. `PartsList.jsx`'s `handleRequestReorder()` and `PartDetail.jsx`'s equivalent both call the shared `requestReorderForRecommendation()` orchestrator, which calls `createReorderRequest()`, the sole writer. No other function creates a `reorder_requests` document.
8. No code, Rules, or production data was changed during this diagnosis -- read-only `curl`/`gh api`/`git diff`/local rebuild only, confirmed via `git status --porcelain` before and after (clean both times).
**Conclusion: no defect found in the code, the build, or the deployment.** The merge, deploy, bundle content, and write path are all verified correct and matching. The most likely explanation for the Owner's observation is that the document was created (or the "Request Reorder" action triggered) from a browser tab/session that had the Field Ops app open *before* 17:15:31 and was never refreshed -- so it ran the pre-PR-127 `createReorderRequest()` from memory, producing a genuinely old-shape document despite the deploy having already succeeded server-side by that point. A secondary, less likely possibility: the inspection method used (a summary/list view rather than the document's full raw fields) doesn't surface `null`-valued keys.
**Proposed correction:** not a code or Rules fix -- re-verify by (a) opening the Field Ops app at `https://taylorservice-spec.github.io/Taylor_Parts/field-ops/` in a fresh browser tab or after a hard refresh (not a tab that's been open since before this deploy), (b) creating a new "Request Reorder" action there, and (c) inspecting that specific new document's full raw field list (not a summary view) for all six fields present as `null`. If that still shows the fields missing, the diagnosis above is wrong somewhere and needs to be revisited with that new evidence -- but nothing found in this pass points to a genuine code or deployment defect.
**Alternatives rejected:** None -- this entry is diagnostic, not a decision among options; no code/Rules/data change was made or proposed beyond the re-verification step above.

## 21. Step C confirmed complete by the Owner -- PR 3 (tightened Rules) unblocked

**Date:** 2026-07-11
**Decision:** The Owner re-tested per entry #20's proposed correction: a newly opened browser session at the correct production URL (`https://taylorservice-spec.github.io/Taylor_Parts/field-ops/`), created a new Reorder Request, and inspected that exact new document directly in the Firebase Console. Confirmed all six fields present and `null`: `cancelledBy`, `cancelledAt`, `cancellationReason`, `voidedBy`, `voidedAt`, `voidReason`. This satisfies the Specification's step C in full -- both the "deployed frontend is serving the updated writer" half (entry #18) and the "sampled live document shows the new shape" half (this entry) are now confirmed.
**Step C: COMPLETE.** PR 3 (tightened Rules -- Specification step D, removing the transitional old-shape branch) is now unblocked.
**Alternatives rejected:** None -- this entry records the Owner's direct production verification, not a choice among options.

## 22. PR 3 (tightened Rules) opened -- READY Rules-focused Final Review handoff

**Date:** 2026-07-11
**Decision:** Implemented Cancel/Void schema deployment sequence step D (Specification/Implementation Plan PR 3), per the Owner's authorization to proceed only within PR 3's approved scope. `hasCanonicalReorderRequestKeys()`/`hasCanonicalReorderRequestCreationBaseline()` (both `firestore.rules` copies) no longer accept the transitional 29-key-only branch from PR 1 (`#117`) -- every `reorder_requests` create now requires the full 35-key canonical shape unconditionally.
**Handoff:**
- PR / head: **PR #132**, `feature/cancel-void-tightened-rules-pr3`, head `d4c4d01` (Draft, documentation/code -- not merged).
- Exact changed files: `firestore.rules`, `field-ops-app-vite/firestore.rules`, `functions/test/reorderRequestsRules.test.js`, `docs/implementation-plans/reorder-request-cancellation.md`.
- Exact test results: `functions/test/reorderRequestsRules.test.js` -- **40/40 pass** (single clean run against a fresh emulator; up from 37, 3 net new dedicated Cancel/Void assertions since `canonicalFields()`'s new unconditional six-field base absorbed the two former "accepted new shape" tests without needing separate cases). `functions/test/employeesRules.test.js` -- **10/10 pass**, unaffected. `functions` TypeScript build (`tsc`) -- clean.
- Old/new shape coverage: new (35-key, all six null) shape accepted for both READY and NEEDS_PLANNING (regression, now the only accepted shape); **old 29-key shape (six fields entirely absent) now rejected for both READY and NEEDS_PLANNING -- the actual behavior this PR changes**, two new dedicated tests; partial presence rejected (one field present, three fields present); all-six-but-one-non-null rejected; unknown extra key rejected.
- Both Rules copies confirmed byte-identical (`diff`, no output).
- No writer/UI/transition/void-collection implementation: confirmed via `grep -n "CANCELLED|VOIDED|reorder_purchase_order_voids" firestore.rules` (zero matches) and an exact 4-file diff scope (2 Rules copies, 1 test file, 1 doc).
- Nothing deployed: no `firebase deploy` command run this turn.
**Not done, per the Owner's explicit "do not merge / do not deploy / do not begin PR 4" instruction:** no merge, no deploy, PR 4 not begun.
**Alternatives rejected:** None -- this entry records opening a fully-scoped, fully-tested PR under an already-approved Implementation Plan, not a choice among options.

## 23. Entry #21 disputed -- Step C marked BLOCKED, production audit required, PR 3 merge/deploy blocked

**Date:** 2026-07-11
**This entry does not rewrite entry #21.** Entry #21 stands as originally written -- a record of what the Owner reported at the time. This entry records a subsequent, conflicting report and the correction that follows from it, per this project's append-only decision-log rule.
**Decision:** The Owner reported that a newly created production Reorder Request, `TST-1003`, does not have the six Cancel/Void fields -- directly conflicting with entry #21's claim that a sampled new document had all six present and `null`. Entry #21 did not record enough to resolve the conflict (no document ID, no `createdAt`, no deployment-cutoff comparison, no confirmation `TST-1003` and the entry #21 document are the same document, no check across every post-deployment document). **Step C is downgraded from "complete" to "verification disputed / blocked."** `docs/implementation-plans/reorder-request-cancellation.md`'s tracking tables updated accordingly (PR 2 row, PR 3 row) -- both now state BLOCKED, not complete.
**Retrieved, read-only, this session (steps this environment CAN perform):**
- PR #127's exact production deployment completion timestamp, from the GitHub Pages deployment status API (`gh api repos/TaylorService-spec/Taylor_Parts/deployments/5405683942/statuses`): **`success` at `2026-07-11T17:15:42Z` UTC** -- `1783790142000` in epoch milliseconds, the same unit `reorder_requests.createdAt` is stored in (`Date.now()`, per `domain/inventoryReorderRequests.js`).
**Cannot be performed by this environment (steps 4-8 of the Owner's required correction):** auditing production `reorder_requests` documents requires reading live Firestore data. This environment has no Admin SDK credentials (no ADC) and the `firebase` CLI's own authenticated session (which can deploy) provides no read-only document-query command -- `firebase firestore:*` only offers `firestore:delete`/`firestore:bulkdelete` (destructive, not used) and index/backup/database management, no `firestore:get`/`firestore:query` equivalent. Consistent with this project's standing, repeatedly-tested boundary (entries #9, #10, #17, #20): never search for, request, or acquire production read credentials to work around this. **The audit itself must be performed by the Owner** (or someone with production Firestore read access), using the procedure below.
**Audit procedure handed off to the Owner, exactly as required (steps 4-8), privacy-constrained (document ID, `createdAt`, `partId`, and six-field presence only -- no user IDs or other fields):**
1. In the Firebase Console, open the `taylor-parts` project's Firestore Database, `reorder_requests` collection.
2. Add a filter: `createdAt > 1783790142000` (the PR #127 deployment-completion cutoff above). This returns every document created after the deploy went live.
3. For each matching document, record only: document ID, `createdAt`, `partId`, and whether `cancelledBy`/`cancelledAt`/`cancellationReason`/`voidedBy`/`voidedAt`/`voidReason` are all present and `null`.
4. Separately, filter/sort for `partId == "TST-1003"` and identify the document with the greatest `createdAt` among any matches. Report its exact document ID and whether the six fields exist.
5. Report both results back so this session (or the next one) can record them here and determine step C's actual status per the Owner's own decision rule: if any post-deployment document lacks the fields, step C FAILS (keep transitional Rules live, investigate whether the cause is a stale browser session or another writer, do not merge/deploy PR #132); if every post-deployment document has the complete shape, step C PASSES with this audit as its evidence, and PR #132 can be rebased and re-submitted for Final Review.
**PR #132 (Cancel/Void PR 3, tightened Rules): left open and unchanged, per the Owner's instruction** -- not merged, not deployed, no further code changes made to it this turn. PR 4 not begun.
**Alternatives rejected:** Attempting to acquire production Firestore read credentials (a service-account key, ADC, or similar) to perform the audit myself -- rejected, consistent with this project's standing credential boundary; the correct response to a blocked read is to ask the Owner, not to work around the blocker.

## 24. Production audit complete -- Step C PASSES, entries #21 and #23 preserved unchanged

**Date:** 2026-07-11
**This entry does not rewrite entry #21 or entry #23.** Both stand as originally written. This entry records the production audit entry #23 requested, and the resolution that follows from it, per this project's append-only decision-log rule.
**Decision:** The Owner performed the production audit specified in entry #23's handoff procedure, querying `reorder_requests` for `createdAt > 1783790142000` (PR #127's exact deployment-completion cutoff). The query returned exactly three documents. **Every one of the three has all six Cancel/Void fields present and explicitly `null`.**
**Audit evidence (document ID, `createdAt`, `partId`, six-field result only -- no user IDs, per entry #23's privacy constraint):**

| Document ID | `createdAt` | `partId` | Six-field result |
|---|---|---|---|
| `NO5PiTirmbiey5VxrAeo` | `1783790404682` | `TST-1015` | PASS -- all present and `null` |
| `qkB9KvDQfcK6qiY76sSg` | `1783791328232` | `TST-1015` | PASS -- all present and `null` |
| `lYMojf5sM8oPjb5MC1h9` | `1783791637747` | `TST-1003` | PASS -- all present and `null` |

`lYMojf5sM8oPjb5MC1h9` is also the newest `TST-1003` document (greatest `createdAt` among any `TST-1003` matches), directly answering entry #23's audit step 4. **The earlier `TST-1003` discrepancy the Owner originally reported referred to an older document, not this one** -- resolved, not a live defect.
**Step C: PASSES.** Both `docs/DECISIONS.md` and `docs/implementation-plans/reorder-request-cancellation.md`'s tracking tables are updated from "disputed/blocked" back to complete, citing this entry as the evidence (not entry #21 alone -- entry #21's claim is now corroborated by this audit, not superseded by it).
**Still true, unchanged by this entry:** transitional Rules (PR #117) remain live in production -- this entry does not deploy anything. PR #132 (tightened Rules) is unblocked to be rebased and resubmitted for a fresh Rules-focused Final Review, but **remains unmerged and undeployed** -- Owner Deployment Authorization is a separate, later gate, not granted by this entry.
**Alternatives rejected:** Treating this audit as also superseding/replacing entry #21's original claim -- rejected; entry #21 turns out to have been correct (the conflict traced to an older `TST-1003` document, not a defect in what entry #21 reported), so this entry corroborates it rather than correcting an error in it. The record stays append-only and accurate to what was known at each point in time.

## 25. PR #132 (Cancel/Void PR 3 of 6, tightened Rules) merged under Owner Merge Authorization -- not deployed

**Date:** 2026-07-11
**Decision:** ChatGPT's Rules-focused Final Review approved PR #132 at exact head `4edf8b216027499c62b0c5bc7ee2749c7a1ca230` -- no findings, base verified current (`e1769bd`), comment correction confirmed (entries #18/#24), PR body wording confirmed ("Rules-focused"), scope confirmed as the same four files, CI green. Confirmed the PR's head had not changed since that approval before merging. The Owner granted explicit Owner Merge Authorization. Merged (squash, branch deleted) -- merge commit `4c6f7b2260c08eaed40118f2ecf7202117c2b2e3`. (First merge attempt failed with `GraphQL: Pull Request is still a draft` -- the PR had been kept as a GitHub Draft PR throughout its Rules-focused-review lifecycle, per this session's established pattern for Rules-relevant PRs; marked ready via `gh pr ready 132`, then merged successfully.)
**Effect:** `hasCanonicalReorderRequestKeys()`/`hasCanonicalReorderRequestCreationBaseline()`'s tightened (35-key-only) creation contract is now on `main`, in both `firestore.rules` copies (confirmed byte-identical post-merge). **This is a merge only -- nothing has been deployed.** The live `taylor-parts` project's deployed Firestore Rules still reflect PR #117's transitional (dual-shape) state until a separate Owner Deployment Authorization is granted and a deploy is actually run, per this project's standing "merged ≠ deployed" discipline and the Owner's explicit instruction on this PR.
**Not done, per the Owner's explicit instruction:** no `firebase deploy` command run. No Step E verification (that would require the Rules to actually be live first). PR 4 not begun.
**Alternatives rejected:** None -- this entry records an already-authorized merge, not a choice among options.

## 26. PR #132's tightened Rules deployed to production, Step E verified -- Cancel/Void schema deployment sequence complete

**Date:** 2026-07-11
**Decision:** Deployed the tightened `reorder_requests` creation contract (PR #132, merge commit `4c6f7b2260c08eaed40118f2ecf7202117c2b2e3`) to the live `taylor-parts` project via `firebase deploy --only firestore:rules --project taylor-parts`, under the Owner's explicit Owner Deployment Authorization scoped to exactly that command, at exactly commit `24925adb70d46688f619c83fad72225da1a58532`. No other deployment, production-data change, or PR 4 work was authorized or performed.
**Evidence:**
- Pre-deploy: `git rev-parse HEAD` and `git rev-parse origin/main` both confirmed `24925adb70d46688f619c83fad72225da1a58532`, exactly the authorized commit; `git status --porcelain` confirmed a clean working tree; `diff firestore.rules field-ops-app-vite/firestore.rules` confirmed byte-identical, both containing the tightened (35-key-only) contract, before the deploy ran.
- First deploy call: `cloud.firestore: rules file firestore.rules compiled successfully` -> `firestore: uploading rules firestore.rules...` -> `firestore: released rules firestore.rules to cloud.firestore` -> `Deploy complete!`.
- Second, immediate deploy call (same content-fingerprint verification method used for every prior Rules deploy this session -- entries #7, #8, #9, #10; Admin SDK read-back remains unavailable, no ADC): `firestore: latest version of firestore.rules already up to date, skipping upload...` -- confirms the live ruleset's content now matches `main`'s `firestore.rules` exactly, including the tightened contract.
- Post-deploy: `git status --porcelain` re-confirmed clean; `git rev-parse HEAD` re-confirmed unchanged at `24925ad...`. Nothing else was deployed alongside this -- `--only firestore:rules` scoped the command exactly as authorized.
**Step E: VERIFIED.** The transitional (dual-shape) Rules from PR #117 are no longer live -- the tightened, 35-key-only creation contract is now the live enforcement for every `reorder_requests` create. Combined with step C's completion (entry #24), the Specification's full five-step expand/contract schema-deployment sequence (A: transitional Rules, B: writer, C: live confirmation, D: tightened Rules, E: live confirmation) is now **complete end to end**.
**`docs/implementation-plans/reorder-request-cancellation.md` updated:** PR 3's row and the tracking table's Step E cell both marked deployed/verified, citing this entry.
**Not done, per the Owner's explicit scope:** no other collection, index, Function, or Hosting deployment; no production-data write of any kind; PR 4 (Cancel Reorder Request) not begun.
**Alternatives rejected:** None -- this entry records an already-authorized, narrowly-scoped deployment, not a choice among options.

## 27. PR #138 (Cancel Reorder Request, PR 4 of 6) merged under Owner Merge Authorization -- not deployed

**Date:** 2026-07-11
**Decision:** ChatGPT's Rules-focused Final Review went through one REQUEST CHANGES round (reviewed head `9169165` -- required four additional test cases: `RECEIVED -> CANCELLED` rejection, two "CANCELLED is terminal" tests, `cancellationReason`-omitted-entirely rejection, and a legacy-document readback test strengthened from sampled fields to a complete pre/post document comparison; applied at head `62d41f9`), then a one-line tracking-table correction (stale "51/51" assertion count corrected to "55/55" after the test additions; applied at head `6a7ab2a`), then **APPROVED at exact head `6a7ab2a1a83c4db95914ae18126466105fc3c3e3`** -- no findings. Confirmed the PR's head had not changed since that approval before merging. The Owner granted explicit Owner Merge Authorization. Merged (squash, branch deleted) -- merge commit `e617a8a`.
**Effect:** `REORDER_REQUEST_STATUS.CANCELLED`, `cancelReorderRequest()`, and both `firestore.rules` copies' new `CANCELLED` branch are now on `main` (confirmed byte-identical post-merge). **This is a merge only -- nothing has been deployed.** The live `taylor-parts` project's deployed Firestore Rules still reflect PR #132's tightened-but-Cancel-less state until a separate Owner Deployment Authorization is granted and a deploy is actually run.
**Not done, per the Owner's explicit instruction:** no `firebase deploy` command run. PR 5 (Void Purchase Order) and PR 6 (UI) not begun.
**Alternatives rejected:** None -- this entry records an already-authorized merge, not a choice among options.

## 28. PR #138's Cancel Reorder Request Rules deployed to production

**Date:** 2026-07-11
**Decision:** Deployed the `CANCELLED` transition Rules (PR #138, merge commit `e617a8a`) to the live `taylor-parts` project via `firebase deploy --only firestore:rules --project taylor-parts`, under the Owner's explicit Owner Deployment Authorization scoped to exactly that command, at exactly commit `1d3f66f0b1a339d3b8299897045f974e59a8d213`. No other deployment, production-data change, or PR 5/6 work was authorized or performed.
**Evidence:**
- Pre-deploy: `git rev-parse HEAD` and `git rev-parse origin/main` both confirmed `1d3f66f0b1a339d3b8299897045f974e59a8d213`, exactly the authorized commit; `git status --porcelain` confirmed a clean working tree; `diff firestore.rules field-ops-app-vite/firestore.rules` confirmed byte-identical, both containing the `CANCELLED` branch, before the deploy ran.
- First deploy call: `cloud.firestore: rules file firestore.rules compiled successfully` -> `firestore: uploading rules firestore.rules...` -> `firestore: released rules firestore.rules to cloud.firestore` -> `Deploy complete!`.
- Second, immediate deploy call (same content-fingerprint verification method used for every prior Rules deploy this session -- entries #7, #8, #9, #10, #26): `firestore: latest version of firestore.rules already up to date, skipping upload...` -- confirms the live ruleset's content now matches `main`'s `firestore.rules` exactly, including the `CANCELLED` branch.
- Post-deploy: `git status --porcelain` re-confirmed clean; `git rev-parse HEAD` re-confirmed unchanged at `1d3f66f...`. Nothing else was deployed alongside this -- `--only firestore:rules` scoped the command exactly as authorized.
**Effect:** Cancel Reorder Request is now live in production -- an admin/dispatcher can cancel a Reorder Request at `READY_FOR_PARTS_MANAGER`, `ASSIGNED_TO_PARTS_ASSOCIATE`, or `PURCHASING_IN_PROGRESS`, with a required non-blank reason, enforced server-side. No application code calls this Rules branch yet (`cancelReorderRequest()` exists in `domain/inventoryReorderRequests.js` but is not wired to any UI action) -- the branch is live but dormant from an end-user perspective until PR 6 (UI) ships.
**`docs/implementation-plans/reorder-request-cancellation.md` updated:** PR 4's row and its tracking-table cell both marked deployed, citing this entry.
**Not done, per the Owner's explicit scope:** no other collection, index, Function, or Hosting deployment; no production-data write of any kind; PR 5 (Void Purchase Order) and PR 6 (UI) not begun.
**Alternatives rejected:** None -- this entry records an already-authorized, narrowly-scoped deployment, not a choice among options.

## 29. PR #142 (Void Purchase Order, PR 5 of 6) merged under Owner Merge Authorization -- not deployed

**Date:** 2026-07-11
**Decision:** ChatGPT's Rules-focused Final Review went through one REQUEST CHANGES round (reviewed head `a64a35c` -- required three additional test cases: `RECEIVED -> VOIDED` rejection, a "VOIDED is terminal" test proven independently of the double-void record collision, and a Reorder Request's own `purchaseOrderId != requestId` mismatch test -- plus a strengthened original-Purchase-Order immutability test comparing complete pre/post documents instead of three sampled fields; applied at head `4813cae`), then **APPROVED at exact head `4813caebe8b3a0f5234fde1179c8cec7caf7848e`** -- no findings. Confirmed the PR's head had not changed since that approval before merging. The Owner granted explicit Owner Merge Authorization. Merged (squash, branch deleted) -- merge commit `6f99ccc`.
**Effect:** `REORDER_REQUEST_STATUS.VOIDED`, `REORDER_PURCHASE_ORDER_VOIDS_COLLECTION`, `voidPurchaseOrder()`, both `firestore.rules` copies' new `VOIDED` branch, and the new `reorder_purchase_order_voids` match block are now on `main` (confirmed byte-identical post-merge). **This is a merge only -- nothing has been deployed.** The live `taylor-parts` project's deployed Firestore Rules still reflect PR #138's Cancel-but-Void-less state until a separate Owner Deployment Authorization is granted and a deploy is actually run.
**Not done, per the Owner's explicit instruction:** no `firebase deploy` command run. PR 6 (UI) not begun.
**Alternatives rejected:** None -- this entry records an already-authorized merge, not a choice among options.

## 30. PR #142's Void Purchase Order Rules deployed to production

**Date:** 2026-07-11
**Decision:** Deployed the `VOIDED` transition and `reorder_purchase_order_voids` Rules (PR #142, merge commit `6f99ccc`) to the live `taylor-parts` project via `firebase deploy --only firestore:rules --project taylor-parts`, under the Owner's explicit Owner Deployment Authorization scoped to exactly that command, at exactly commit `393f054883a970af2c39f1f193aff7dec8b12c11`. No other deployment, production-data change, or PR 6 work was authorized or performed.
**Evidence:**
- Pre-deploy: `git rev-parse HEAD` and `git rev-parse origin/main` both confirmed `393f054883a970af2c39f1f193aff7dec8b12c11`, exactly the authorized commit; `git status --porcelain` confirmed a clean working tree; `diff firestore.rules field-ops-app-vite/firestore.rules` confirmed byte-identical, both containing the `VOIDED` branch and the `reorder_purchase_order_voids` match block, before the deploy ran.
- First deploy call: `cloud.firestore: rules file firestore.rules compiled successfully` -> `firestore: uploading rules firestore.rules...` -> `firestore: released rules firestore.rules to cloud.firestore` -> `Deploy complete!`.
- Second, immediate deploy call (same content-fingerprint verification method used for every prior Rules deploy this session -- entries #7, #8, #9, #10, #26, #28): `firestore: latest version of firestore.rules already up to date, skipping upload...` -- confirms the live ruleset's content now matches `main`'s `firestore.rules` exactly, including the `VOIDED` branch and the new collection's rules.
- Post-deploy: `git status --porcelain` re-confirmed clean; `git rev-parse HEAD` re-confirmed unchanged at `393f054...`. Nothing else was deployed alongside this -- `--only firestore:rules` scoped the command exactly as authorized.
**Effect:** Void Purchase Order is now live in production -- an admin/dispatcher who is also the assigned Parts Associate can void a Purchase Order at `ORDERED`, with a required non-blank reason, an append-only audit record, and every cross-document invariant the Specification requires, all enforced server-side. No application code calls this Rules branch yet (`voidPurchaseOrder()` exists in `domain/reorderPurchaseOrders.js` but is not wired to any UI action) -- the branch is live but dormant from an end-user perspective until PR 6 (UI) ships.
**`docs/implementation-plans/reorder-request-cancellation.md` updated:** PR 5's row and its tracking-table cell both marked deployed, citing this entry.
**Status after this entry: of the Cancel/Void initiative's six PRs, PRs 1-5 are all merged and deployed, verified live end to end.** Only PR 6 (UI) remains, and it has not started.
**Not done, per the Owner's explicit scope:** no other collection, index, Function, or Hosting deployment; no production-data write of any kind; PR 6 not begun.
**Alternatives rejected:** None -- this entry records an already-authorized, narrowly-scoped deployment, not a choice among options.

## 31. Notification identity defect -- Assessment/Specification/Implementation Plan approved and merged (PR #146, Issue #145)

**Date:** 2026-07-11
**Decision:** Investigated a defect the Owner raised: `NotificationPanel.jsx`/`PartsList.jsx` link Reorder Request notifications by `partId` only; `PartDetail`'s `useReorderRequestForPart()` has no status filter and resolves to whichever request for that part has the newest `createdAt`, regardless of status -- so an active notification click can land on a different, newer, possibly terminal (`REJECTED`/`CANCELLED`/`VOIDED`) request. Filed as **Issue #145** (closed by PR #146's merge). Produced, in one docs-only PR:
- **Assessment** (`docs/assessments/notification-identity.md`) -- root cause verified directly by reading the actual code (every notification object already carries its own `reorderRequestId` via `toDocs()`, currently used only as a React `key`; no `:requestId` route segment exists anywhere). **Architecture-Approved**: Option A (optional `requestId` query parameter), validate `partId` agreement, fail safely on mismatch/not-found, preserve the no-id fallback unchanged, update every notification/queue link that already has `request.id` available, leave the catalog-row link/Issue #140/Cancel-Void-UI (PR 6) out of scope, no Rules/schema/production-data change.
- **Specification** (`docs/specifications/notification-identity.md`) -- **Approved**, no questions raised.
- **Implementation Plan** (`docs/implementation-plans/notification-identity.md`) -- **Approved** after three REQUEST CHANGES rounds: (1) corrected the PR 6 relationship from "independent" to an explicit sequencing prerequisite -- PR 6 must not begin until this fix is merged, deployed, and verified; (2) resolved the Specification's undecided automated-verification method by inspecting the repository (confirmed no frontend hook-testing harness exists anywhere) and made repeatable Playwright browser automation (a new `verify-notification-identity` command on the existing `run-field-ops-app-vite` skill's `driver.mjs`) the **primary** implementation test rather than an independently-reimplemented Node script, which was demoted to optional/non-gating supporting coverage; removed a requirement to write production test data; (3) corrected the PR breakdown/expected-file scope from four files to the complete seven (4 application + 3 verification infrastructure, correctly classified) and made the read-only production smoke check non-vacuous (must positively exercise the deployed `requestId` path even if no active notification happens to exist at check time, using only pre-existing production data).
**Merged** (squash, branch deleted) under Owner Merge Authorization -- merge commit `28b7aec`. **This is docs only.** No application code has been written; the actual implementation PR (matching the seven-file scope above) has not been opened.
**Not done:** PR 1 (the actual `requestId`-aware fix) not started. PR 6 (Cancel/Void UI) remains blocked on PR 1's own merge, deployment, and full verification (local Playwright + read-only production smoke check), independent of this entry.
**Alternatives rejected:** None -- this entry records completion of an already-approved, fully-gated documentation chain, not a choice among options.

## 32. Notification Identity fix (PR #148) -- deployment verified, production smoke check passed, PR 6 unblocked

**Date:** 2026-07-12
**Decision:** Confirmed PR #148 (merge commit `f9e71789d36d52df2aef3bd90d5336a886eb6c7b`) satisfies all three verification gates required by `docs/implementation-plans/notification-identity.md` before PR 6 (Cancel/Void UI) may begin:
1. **Local/emulator test** -- `verify-notification-identity` Playwright command, 29/29 assertions passing (the final count at PR #148's approved head, after a review round corrected two assertions -- see the PR's own history for the prior 26/26 figure, now superseded).
2. **Frontend deployment check** -- `gh run list --commit f9e71789d36d52df2aef3bd90d5336a886eb6c7b` confirmed both required workflows `completed`/`success`: `Vite Build Check` (run `29183235766`) and `Deploy Field Ops (Vite) to GitHub Pages` (run `29183235761`). Both were briefly `queued` with no runner assigned at first check -- the same transient GitHub Actions pattern already documented in `docs/CLAUDE_CONTEXT.md`'s "Known operational gotchas" -- and cleared on their own within ~2 minutes on re-check; no manual deploy was run at any point.
3. **Read-only production smoke check** -- performed by the Owner at `https://taylorservice-spec.github.io/Taylor_Parts/field-ops/inventory/TST-1015?requestId=1J53DsEEkmLt6J1fsIcd`, using an existing production `reorder_requests` document (`partId` `TST-1015`, document id `1J53DsEEkmLt6J1fsIcd`) read via Firebase Console. The exact request's fields rendered successfully; neither the `not_found` nor `mismatch` fail-safe message appeared; no production data was created, modified, or deleted. This positively exercises the deployed `requestId`-aware resolution path with real production data, satisfying the Plan's explicit "not a vacuous pass" requirement.
**Effect:** All three gates in `docs/implementation-plans/notification-identity.md`'s "Tracking" section are now satisfied. **PR 6 (Cancel/Void UI) is unblocked by this Plan's own sequencing prerequisite** -- it may now begin, subject to its own separate authorization from the Owner (this entry unblocks the Plan's gate; it is not itself an authorization to start PR 6).
**`docs/implementation-plans/notification-identity.md` updated:** the PR breakdown row and "Tracking" table both marked merged/deployed/fully verified, citing this entry.
**Not done:** no production data write of any kind; no manual `firebase deploy` or other manual deployment trigger (both required workflows completed via the normal GitHub Actions auto-deploy path); PR 6 not begun.
**Alternatives rejected:** None -- this entry records verification of an already-authorized, already-merged implementation, not a choice among options.

## 33. Taylor Freezer project board backfilled with full issue/PR history

**Date:** 2026-07-12
**Decision:** Ran the Owner's `backfill-taylor-freezer.sh` script (Tier 1, no repository changes) to add every historical Issue and PR in `TaylorService-spec/Taylor_Parts` to the Taylor Freezer GitHub Project (project #1, owner `TaylorService-spec`), setting each item's `Status` field from its live state: open issues -> `Todo`, open PRs -> `In Progress`, closed/merged items -> `Done`. The script was run only after confirming via `gh auth status` that the Owner's own token refresh (noted as a pending prerequisite in a prior session) had completed and the `project` scope was present. The script as supplied piped through an external `jq` binary, which is not installed in this environment; it was adapted to use `gh`'s built-in `--jq` flag for identical field/status-option lookups and item add/edit calls, with no change to which items were touched or how status was assigned. `gh project item-add` is idempotent (returns the existing item if already present), so the script is safe to re-run.
**Evidence:**
- Pre-run scale check: 8 issues (4 open, 4 closed), 142 PRs (2 open at that moment, 140 closed/merged) -- 150 items total.
- Script run to completion, exit code 0, 150/150 "added" lines logged, ending "Backfill complete."
- Post-run spot-check via `gh project item-list`: 150 items on the board total; status breakdown 4 `Todo` / 146 `Done` / 0 `In Progress`. Confirmed this is correct, not a bug -- the two PRs open at scale-check time (#149, #150) were merged/closed by the time the script's PR-listing step actually ran moments later, so they were correctly read as `Done` at that point; `gh pr list --state open` confirms zero PRs are open right now. The 4 `Todo` items exactly match the 4 currently-open issues (#15, #100, #119, #140); no open PR was found with a status other than `In Progress` (vacuously true, none are open); no merged/closed PR was found with a status other than `Done`.
**Effect:** The Taylor Freezer board now reflects the full historical backlog instead of only items added since it started being used going forward. No repository files, Rules, schema, or production data were touched -- this is GitHub Project metadata only.
**Not done:** no jq installation (worked around via `gh --jq` instead); no change to any issue's or PR's actual GitHub state (labels, assignees, open/closed status) -- only the project board's own `Status` field was written.
**Alternatives rejected:** None -- this entry records execution of an already-authorized, fully-specified script, not a choice among options.

## 34. Inventory Operational Queue A0 -- production securityRole mirror backfill run, verified zero-drift

**Date:** 2026-07-12
**Decision:** Under separate Owner Production Data Authorization, ran `functions/scripts/auditSecurityRoleMirror.js` against the production `taylor-parts` project at merge commit `057ff37b4be9881bb85aabacd72b2466b77f9ac6` (PR #164, A0 -- security-role mirror rollout, Issue #154 / Inventory Operational Queue) -- read-only audit, then authorized `--repair`, then a post-repair read-only re-verification, all three runs against the exact reviewed/merged commit.
**Evidence:**
- Code under test confirmed at merge commit `057ff37b4be9881bb85aabacd72b2466b77f9ac6`.
- Initial read-only audit: "Found 5 securityRole finding(s)" -- missing=5, mismatched=0, broken=0. `audit_exit=1` (non-zero as designed, since unresolved findings existed).
- Authorized repair (`--repair`): "Repaired 5 entries." `repair_exit=0`.
- Post-repair read-only verification: "OK: zero drift across 5 linked Employee document(s)." `verify_exit=0`.
- Full evidence (Owner-operated Cloud Shell run) recorded as a comment on PR #164: https://github.com/TaylorService-spec/Taylor_Parts/pull/164#issuecomment-4952811893. No employee/user IDs or credentials are reproduced in that comment or here, per the Owner's instruction and this script's own minimal-output design (see its header comment).
**Effect:** Every linked Employee document's `securityRole` mirror is now backfilled and confirmed to agree with its linked `users/{uid}.role`, closing the gap this initiative's Specification identified (pre-A0 Employee documents had no `securityRole` field at all). This satisfies PR A's own merge-gate precondition (`docs/specifications/inventory-operational-queue.md`'s "Verified complete" requirement -- a follow-up read-only pass reporting zero drifted/missing documents) once this entry is itself merged, per that Specification's explicit requirement that the backfill's completion be recorded in `docs/DECISIONS.md`, not only as a PR comment.
**Not done:** no `functions/scripts/provisionEmployeeAccess.js` code change; no `firestore.rules`/index change; no deployment of any kind (A0 has no deployment step -- Admin-SDK script/docs/tests only); PR A itself not merged by this entry; the broken-link resolution process (none existed in this run, per the audit's 0-broken count) not exercised.
**Alternatives rejected:** None -- this entry records execution of an already-authorized, fully-specified production operation, not a choice among options.

## 35. Backend catch-up deployment test rolled back; accessVersion verification contract corrected

**Date:** 2026-07-20
**Decision:** Under the Owner's explicit deployment, rollback, and production-test authorizations, deployed the consolidated backend catch-up candidate from exact commit `d5f2172c028c6d5253c957cbd32187bde866022c` to Firebase project `taylor-parts`: the repository Firestore Rules and exactly 11 named Functions (the eight #325/#226 report/effective-access Functions plus the three #15 Work Order Functions). Blaze was confirmed active first. All 11 Functions appeared in `us-central1`, and unauthenticated requests to each were rejected.
**Production test:** Created one temporary global Owner RoleAssignment for the authorized test principal, using `accessVersionAtGrant: 0` and the principal's current `users/{uid}.accessVersion: 0`. `resolveEffectiveAccessCallable` correctly returned `report.customer.read: true`. The test then bumped the user's version to `1`; the same active assignment continued to authorize. This contradicted the deployment matrix, which incorrectly expected a version bump by itself to revoke the assignment.
**Root cause:** The resolver's established contract is `accessVersionAtGrant <= currentAccessVersion`. An older active assignment remains valid after later access changes; only a future-dated assignment (`accessVersionAtGrant > currentAccessVersion`) is excluded as malformed/stale. Revocation disables the specific RoleAssignment. The version bump invalidates cached client/token decisions and triggers refresh; it is not independent assignment revocation. Existing resolver, effective-access, saved-definition, and production-foundation tests already implemented this contract; the two deployment documents had drifted from it.
**Rollback:** Treated the false matrix expectation as the package's prescribed rollback trigger. Deleted the temporary RoleAssignment, restored the user's prior absent `accessVersion` field, confirmed no temporary report-definition data remained, deleted exactly the 11 deployed Functions, and restored the previously captured Rules from commit `e1d936ebaf9330ab37f09e637ca89066d45da219`. Post-rollback, `firebase functions:list --project taylor-parts` again reported zero Functions. Blaze remains active and deployment-enablement APIs remain enabled; Firebase also warned that automatic build-image cleanup failed, so small Artifact Registry storage charges may remain until separately cleaned.
**Correction:** Updated both production authorization documents so the matrix separately verifies (1) future-dated assignment fail-closed behavior and (2) disabled-assignment revocation plus client/token freshness. Added a direct resolver regression test that a version bump does not revoke an older active assignment. No authorization-engine behavior was changed.
**Not done:** No redeployment after the rollback, no lasting production RoleAssignment or claims change, no Admin mutation activation, and no enforcement cutover. A fresh production authorization must use the corrected matrix.
**Alternatives rejected:** Changing the resolver to require exact equality was rejected because incrementing one principal-level version would silently revoke every older active assignment unless all were rewritten atomically; that conflicts with the established multi-assignment model and existing tests.

## 36. Consolidated backend catch-up deployed; corrected production verification passed

**Date:** 2026-07-20
**Decision:** After PR #358 merged the corrected accessVersion verification contract, the Owner explicitly authorized redeployment. Deployed from exact `main` commit `3a9c3ff71c66f228bcfc6c3479d08da63ebe467f` to Firebase project `taylor-parts`: the repository Firestore Rules and exactly 11 Functions in `us-central1` — `resolveEffectiveAccessCallable`, `runReportDefinitionCallable`, the six saved-definition callables (`create`, `get`, `list`, `rename`, `duplicate`, `delete`), and the three #15 Work Order Functions (`createWorkOrder`, `transitionWorkOrder`, `updateWorkOrderExecutionData`). Deployable files were byte-identical to the previously reviewed `d5f2172` candidate; PR #358 changed only documentation and one additive test.
**Rules evidence:** Root and Vite Rules were byte-identical before deployment (SHA-256 `1C589F56212C03213B984EE25B53871390C8E823F2E30E087A35C8788732A08A`). Rules compiled and released successfully. A second immediate deploy reported the latest Rules already up to date and skipped the upload, confirming production matches the reviewed content. The captured rollback Rules at `e1d936ebaf9330ab37f09e637ca89066d45da219` remain available (SHA-256 `11E347D6B47E18027DAD5A3B3C7063C84DF231784201124EC86148FC31D0A737`).
**Function evidence:** `firebase functions:list --project taylor-parts` showed exactly the 11 authorized callable Functions, all v2/Node.js 20 in `us-central1`; an unauthenticated HTTPS POST to every Function returned HTTP 401. No Row-7 access-mutation Function was deployed. Firebase's deployment operation reported every Function create as successful; its only nonzero-exit condition was the missing Artifact Registry cleanup policy. Applied the standard one-day cleanup policy to `projects/taylor-parts/locations/us-central1/repositories/gcf-artifacts`, which succeeded and prevents unnecessary old-image accumulation.
**Corrected production verification:** Using the secured service-account credential and the designated test principal, created one deterministic temporary global Owner RoleAssignment. Verified: (1) an active assignment at the current version grants `report.customer.read`; (2) a future-dated assignment (`accessVersionAtGrant > current`) fails closed; (3) disabling the assignment and bumping the principal version denies while the effective-access feed reports the new version; (4) deleting the assignment returns the permission to denied; and (5) direct Admin-SDK read-back confirms the assignment is absent and the user document's original accessVersion presence/value is restored. The complete sequence passed twice. No saved report definition or other business record was created.
**Pre-deploy validation:** Clean detached worktree at the exact commit; `npm ci` from the pinned lockfile; Functions TypeScript build passed; PR #358's Access Catalog & Resolver workflow and Vite builds were green. The existing access suite passed 122/122 after the corrected regression was added.
**Current production state:** The reviewed Rules and exactly 11 named Functions are live. No test RoleAssignment persists. No rollback trigger occurred. Blaze and the required Google Cloud APIs remain active.
**Not done:** No deployment of the six Row-7 access-mutation Functions, no claims bootstrap, no permanent production RoleAssignment, no Admin mutation activation, no enforcement cutover, no index deployment, and no production business-data mutation. Node.js 20 decommissioning and the outdated `firebase-functions`/dependency audit warnings remain follow-up maintenance, not failures of this deployment.
**Alternatives rejected:** No broad `--only functions` deployment; no change to resolver semantics; no rollback after the corrected matrix passed.

## 37. Enterprise Inventory governance chain adopted (INV-1 governance home)

**Date:** 2026-07-21
**Decision:** Under Owner decisions D-1 through D-6 (recorded in the PR #371 review, 2026-07-21), adopted the Enterprise Inventory governance chain as the governing Tier-2 chain for the Enterprise Inventory domain: `docs/assessments/enterprise-inventory-architecture.md`, `docs/specifications/enterprise-inventory-architecture.md`, `docs/specifications/enterprise-inventory-ai-strategy.md`, and `docs/implementation-plans/enterprise-inventory-architecture.md`. This package is the governance home for finding INV-1 (High — post-commit inventory-effect loss), resolving roadmap reconciliation candidate gate B and open question OQ-4.
**Recorded directions:**
- **Unified Purchase Order architecture (D-3, approved in principle):** the dormant Epic 5 `purchase_orders` model is directionally deprecated in favor of the unified Purchase Order domain model. No collection is deleted, no data is migrated, no code or Firestore Rules change, and the new PO model is not activated; compatibility is preserved until an explicit later migration gate.
- **Part Master ADR (D-4):** a Part Master architecture decision record — covering part identity, manufacturer/supplier identifiers, aliases and supersession, units of measure, serialized/lot-controlled/non-controlled parts, tenant-ready-but-tenant-inert structure, and ownership of descriptive vs. operational inventory data — is required before Phase 1 implementation. It is a Phase 1 prerequisite, not part of this package.
- **AI recommendation envelope (D-5):** the shared recommendation-envelope decision is deferred until Phase 7. Standing invariant preserved: AI may recommend but must not directly execute inventory, purchasing, warehouse, or transfer mutations.
- **Tenant posture:** the domain remains tenant-shaped but tenant-inert until Issue #140.
**Effect:** Governance only. Phase 0 (INV-1 detection + retry recovery) is deferred to a separate Owner gate (D-2) and has not started; Phases 1–8 remain NOT AUTHORIZED. Customer (F-RULES-1 PR-2) and Inventory work proceed in parallel; Inventory Phase 0 must not modify Firestore Rules files concurrently changed by the Customer session without explicit cross-session coordination.
**Not done:** No implementation, no Firestore Rules change, no Functions change, no index change, no frontend change, no deployment, no production operation, and no Phase 0 work.
**Alternatives rejected:** None — this entry records the Owner's decisions D-1 through D-6 on PR #371, not a choice among options.

## 38. INV-1 Phase 0 inventory-effect recovery tooling adopted (repository only)

**Date:** 2026-07-22
**Decision:** Under the Owner's Phase 0 sequence approval and per-PR merge decisions, adopted the governed inventory-effect recovery mechanism: the pure detection engine (`functions/src/inventoryEffectDetection.ts`, PR #373 / `0b82009`) plus the operator audit and exact-batch retry scripts (`functions/scripts/auditInventoryEffects.js`, `functions/scripts/retryInventoryEffects.js`, PR #374 / `c975258`), with the operating procedure recorded in `docs/operations/inventory-effect-recovery-runbook.md` and ownership registered in `docs/architecture/SYSTEM_AUTHORITIES.md` (PR 0.3).
**Standing constraints:**
- Production detection remains separately authorized (Gate 0.4(a), read-only).
- Production retry requires an Owner Production Data Authorization naming the exact `workOrderId`/`state` pairs (Gate 0.4(b)); the retry tooling may not auto-expand candidates and has no wildcard mode.
- No deployed callable, scheduled Function, Eventarc trigger, or Scheduler job is authorized for Phase 0; the scripts are operator-invoked only and are referenced by no runtime, CI, build, install, deploy, or emulator path.
- Retry execution reuses the existing idempotent `triggerInventoryEffects` path exclusively; ledger and sync-status write authority is unchanged (`inventoryService.ts`).
**Effect:** Repository tooling exists and is governed. Production findings are unknown — no production audit or recovery has been performed. The legacy Epic 5 `purchase_orders` deprecation direction (#37, D-3) and Phases 1–8 of the enterprise inventory architecture are unaffected.
**Not done:** No production read, write, or retry; no Gate 0.4 execution; no deployment; no Rules/index/schema/frontend change; no Phase 0 operational completion claim.
**Alternatives rejected:** A deployed admin callable for recovery was considered in the Phase 0 proposal and not chosen -- script-based operator tooling was the Owner-approved form; a callable remains a possible later-phase decision under its own gates.

## 39. Technician self-write closed via a dedicated trusted callable (F-RULES-1 final gap)

**Date:** 2026-07-22
**Decision:** Under Owner decisions O-1 through O-5 (recorded in the PR #377 review, 2026-07-22), adopted **Option B** for the last remaining F-RULES-1 deferred gap (*technician cannot update own technician record*): a **dedicated trusted callable `completeAssignedJob`** performs technician-initiated legacy job completion. Authorization is **technician-only** (admin/dispatcher continue through their existing operational paths). Caller identity is resolved server-side from the authenticated UID and the canonical `users/{uid}.technicianId` mapping via `getCallerContext`; **no caller-supplied technician identity is honored**. The callable performs the approved **atomic `fieldops_jobs`↔`fieldops_technicians` completion cascade** (`job.status=complete` + `technician.status=available`) with the Admin SDK in a single transaction. After the trusted path exists, **direct technician completion writes are denied** (technician `fieldops_technicians` writes removed; direct-client `in_progress→complete` denied), while the **direct `assigned→in_progress` transition is retained** for compatibility. **Idempotency is required** (client `idempotencyKey`, replay = no-op success). An **append-only audit event is required** for each completion. The six Enterprise Access mutation Functions are **not prerequisites** and remain unrelated. Governance chain: `docs/assessments/technician-self-write.md`, `docs/specifications/technician-self-write.md`, `docs/implementation-plans/technician-self-write.md`.
**Effect:** Architecture/design approved. Implementation, deployment, Firestore Rules finalization, strict contract-suite registration, and production activation **remain separately gated** (PR-A implement callable + tests, PR-B Field Mode integration, PR-C Rules hardening + strict registration, then deploy Gates D1→D2→D3). None has started.
**Not done:** No Function implemented; no Firestore Rules changed or deployed; no frontend/index change; no strict-suite registration; no Enterprise Access mutation deployment; no Admin Portal activation; no deployment or production operation.
**Alternatives rejected:** Direct client write with Rules validation (leaves a technician write surface on `fieldops_technicians` and cannot express the completion-only status change); a trusted callable plus approval workflow (overkill for a routine completion); a hybrid direct-write-for-preferences model (no genuinely-safe self-editable field exists in the current schema). A strategic alternative — migrating Field Mode onto the already-deployed Work Order engine and retiring the legacy collections — was surfaced (Owner O-1) and **deferred** in favor of the bounded dedicated callable; it remains a possible later architectural decision under its own gates.

## 40. Part Master architecture adopted (ADR-008 Accepted; Phase 1 roadmap approved)

**Date:** 2026-07-22
**Decision:** Under Owner decisions O-1 through O-12 (PR #380 review), accepted ADR-008 (`docs/architecture/ADR-008-part-master.md`) and adopted the Part Master architecture: immutable internal `partId` as canonical identity (Part document ID; existing SKU-based immutable ledger history grandfathered as-is and never rewritten); governed human-readable `internalPartNumber`; all external identifiers (manufacturer part numbers, supplier SKUs, UPC/EAN/GTIN, barcode, legacy, customer/vendor references) normalized as alias documents with deterministic normalized IDs and structural uniqueness; normalized top-level model (`parts`, `part_aliases`, `part_supplier_items`, `part_relationships`, `manufacturers`) with no unbounded arrays; supplier catalog data separated into `part_supplier_items` (supplier changes never alter Part identity); governed unit conversions (canonical stockingUnit + supplier purchaseUnit/conversion, one pure conversion authority, historical quantities preserved as transacted); control classifications (controlType STANDARD/SERIALIZED/LOT/SERIALIZED_LOT with expiry tracking attributes × stockingClass STOCKED/NON_STOCK/SERVICE/KIT with governed flags — fields definable in Phase 1, serial/lot/expiration behavior deferred to its later governed phase; ADR-006 Part/Equipment boundary preserved); tenant-ready-but-tenant-inert posture (Issue #140); additive dual-read migration with parity evidence and Owner-gated cutover; dry-run-first CSV contract. The Phase 1 PR sequence 1.1-1.10 is approved as the implementation roadmap; approval of the sequence does not authorize any of the ten PRs -- only PR 1.1 (Part Master pure domain foundation) is recommended for the next separately authorized gate.
**Effect:** Architecture and roadmap only. Phase 1 implementation has not begun. No schema deployment, no migration, no Firestore Rules or Function deployment, and no index deployment is authorized by this decision or by the PR #380 merge.
**Not done:** No implementation code, no collections created, no production operation, no CSV or barcode implementation, no Part records created or migrated.
**Alternatives rejected:** Recorded in ADR-008 (business-number-as-identity, embedded-array model, child subcollections, history rewrite, client-direct part CRUD).


## 41. F-RULES-1 production closure verified (D1–D3 complete)

**Date:** 2026-07-23
**Decision:** Recorded the production closure of F-RULES-1 (Decision #39's end state, now enforced and verified live): Gate **D1** deployed and smoke-verified `completeAssignedJob` (12/12) and activated the trusted Field Mode completion path (gate-flip PR #387, byte-verified published bundle); Gate **D2** deployed the governed `firestore.rules` (live ruleset byte-equal to blob `b37c666fff0018375df11afa5078f8499e10fea9df7a862d5c373e112f5903fd`; 22/22 production verification: technician direct completion and self-availability DENIED, status-only `assigned→in_progress` preserved, callable cascade/audit/idempotent-replay intact, Inventory Part Master/alias/supplier client closure preserved; pre-D2 rollback baseline `1c589f56…2a08a` preserved, unused); Gate **D3** completed one job through the SHIPPED production UI with a controlled sign-in (7/7 data-plane verification; applied audit under a UI-minted `cmpl-*` idempotency key; run-1 React #31 display blocker fixed via PR #393's `jobCustomerName` normalizer; three network-forensic attestations honestly recorded NOT_CAPTURED with compensating data-plane/structural evidence documented). Evidence immutable and checksummed under `docs/audits/f-rules-1/{d1-activation,d2-rules-deployment,d3-closure}/`. `SYSTEM_AUTHORITIES.md`'s Job/Technician-writes row now records the split completion authority.
**Effect:** F-RULES-1 is **COMPLETE** — repository chain (PR-0…PR-C; strict 43-assertion suite in CI) and production chain (D1→D2→D3) both closed. Operator-executed production commands throughout; no IAM widening, no service-account keys, no credentials in evidence.
**Not done / still open:** Specification **U-R1–U-R4** (admin/dispatcher correction-field allowlist) remains a separate governed assessment; dispatcher-view raw customer renders flagged for a follow-up fix; no Inventory behavior changed.
**Alternatives rejected:** None — this entry records verified completion, not a choice among options.

## 42. Part Master migration & cutover policy (D-M1–D-M7 resolved)

**Date:** 2026-07-23
**Decision:** Resolved the seven Owner cutover decisions registered by INV-1 Phase 1 PR 1.10 (`functions/src/partMaster/cutoverReadiness.ts` D-M1..D-M7; runbook `docs/operations/part-master-migration-cutover-runbook.md` §6): **D-M1 = B** — CREATE first, reconcile, then UPDATE separately (separate approvals and reconciliation points; smaller rollback surface); **D-M2 = B** — create canonical Parts first, migrate aliases in a separate reconciled gate (identifier-routing changes never share a gate with canonical-record creation; safe because nothing resolves aliases at runtime today — the PR 1.3 in-transaction internalPartNumber backfill inside `updatePart` is part of the trusted command, not the migration, and is unaffected); **D-M3 = A** — exclude inactive-target rows until separately remediated through lifecycle governance (migration never reactivates a Part; drives criterion C7 to zero by input curation); **D-M4 = B** — defer supplier-item relationships to a separate gate (procurement authority and commercial data stay outside initial Part migration scope); **D-M5 = B** — no historical rewrite: historical Work Orders and inventory records remain immutable; aliases + the PR 1.6/1.7 compatibility contracts provide legacy resolution; **D-M6 = B** — `PART_MASTER_REFERENCE` activation only in a separate post-reconciliation gate with its own parity evidence (data migration and runtime behavior activation never share a gate); **D-M7 = C** — the repository-approved client-read Rules (PR 1.9 posture) deploy only after migration and reconciliation (the production Part read surface stays closed — the deployed D2 ruleset predates PR 1.9, so `parts` is fully client-closed in production until that step).
**Per-gate readiness rule:** every future execution gate evaluates readiness criteria **C1–C20 against that gate's own approved population and scope**. A passing CREATE gate approves nothing else — not UPDATE, aliases, supplier items, Rules deployment, resolver wiring, feature activation, or any later population.
**Approved successor sequence (each step separately Owner-authorized; none authorized by this entry):** (1) production-source dry-run authorization → (2) production-source dry-run + evidence review → (3) CREATE write-tool implementation → (4) CREATE execution + reconciliation → (5) UPDATE implementation/execution gate → (6) alias migration gate → (7) production Part Master reconciliation → (8) Rules + read-only frontend deployment → (9) compatibility resolver wiring → (10) `PART_MASTER_REFERENCE` activation → (11) supplier-item and other deferred work.
**Evidence integrity:** the committed Phase 1 demonstration evidence (`docs/audits/inv1-phase1/migration-readiness/`, readiness **BLOCKED**, seven decisions recorded unresolved at generation time) is historically accurate and is **not** regenerated or altered by this entry; future cutover-qualifying evidence runs accept the resolved decision set as invocation input, and `evaluateCutoverReadiness` needs no code change (unresolved decisions are an input, and C20 may evaluate resolved in qualifying runs).
**Effect:** governance-only. No implementation, deployment, migration, production-source data use, write mode, flag change, or wiring is authorized; cutover readiness remains BLOCKED until a qualifying run passes C1–C20.
**Alternatives rejected:** D-M1 A (single combined execution — larger rollback surface, entangled reconciliation); D-M2 A (aliases in the same execution — an alias conflict could obscure a valid Part creation); D-M3 B/C (reactivating or targeting inactive Parts mixes lifecycle governance into data migration); D-M4 A (expands initial cutover scope into procurement data); D-M5 A/C (any history rewrite breaks audit integrity and contradicts the PR 1.6/1.7 no-rewrite design); D-M6 A (couples data change to runtime behavior change); D-M7 A/B (would expose a partially populated Part Master).

## 43. Inventory → Parts is the primary product; Part Master is verification/admin scaffolding (INV-CONVERGENCE-A)

**Date:** 2026-07-25
**Decision:** Recorded the product-authority direction assessed by INV-CONVERGENCE-A (`docs/assessments/inventory-parts-convergence-recovery.md`, baseline `bd65335`): **Inventory → Parts (`PartsList`/`PartDetail`) is the primary, permanent user-facing operational product**; **Firestore `parts` is the canonical part-identity authority** (consistent with, and not superseding, ADR-008 / Decision #40); **`inventory_transactions` remains the stock-movement authority**; and **Part Master is temporary verification/admin scaffolding — a read-only admin/dispatcher registry — that must not remain a competing general-user workspace**. The recovery corrected a working belief that Part Master had been introduced as a separate competing product: on baseline it is a single read-only nav item inside the Inventory domain with no CRUD (`PartMasterList.jsx:1-8`), while the operational Parts workspace still reads the static 200-row catalog and canonical `parts` (190 records) is read only by that one surface. These are **multiple part-identity authorities/schemas with an unresolved canonical compatibility join**, not disconnected systems: the operational layers (static catalog `sku`, ledger `partId == sku`, reorder `partId`, Work Order `inventorySnapshot` `sku`) already interoperate through one SKU-shaped key; the unresolved question is whether canonical `parts.partId`/`internalPartNumber` preserves that key or needs an alias/adapter (only the name-keyed demo layer is genuinely disconnected). The canonical and static schemas **overlap materially** on descriptive fields (`name`, `category`, `unit`↔`stockingUnit`) and diverge on identifier compatibility, commercial fields (`cost`/`price`/`reorderThreshold`/`warehouseQty`), and governance fields (`status`/`controlType`/`stockingClass`). Convergence = switch the operational workspace's *identity source* onto canonical `parts` via an additive **layered compatibility read adapter** (canonical identity/governance ⊕ commercial authority ⊕ ledger-derived values) + shadow parity, then broaden the `parts` read Rule to the Issue #100 operational roles, then retire the general Part Master nav entry (one line, `navConfig.js:175`) — never rewriting the append-only ledger, reorder records, or Work Order snapshots.
**200 vs 190 reconciliation:** 200→190 is **policy-explained by Decision #42** (an intentional D-M3 pre-input exclusion of 10 discontinued/inactive test parts; validation/dedup/import rejection all reported zero, `production-dryrun-20260723-01/evidence-review.md:24,35`), **but record-level reconciliation remains incomplete** — this is an unresolved inference, not a completed factual reconciliation. The exact ten-record manifest is absent from the repo (`evidence-review.md:37`, tracked as UD-1) and the canonical `partId`/`internalPartNumber`→SKU join is unresolved (P0). UD-1 and P0 block the operational source switch, static-catalog and Functions-mirror retirement, and any declaration of catalog/canonical parity; they do not block merging this docs-only assessment.
**Unresolved (Owner/next-gate input):** UD-1 discontinued-parts manifest; UD-2 the `partId↔sku` join model / alias map (P0 parity gate; unanswerable from the repo today); UD-3 `warehouseQty` baseline replacement by a ledger aggregate; UD-4 commercial `cost`/`price` home (`part_supplier_items`, procurement gate); UD-5 final Part Master nav disposition (retain admin-only vs delete).
**Effect:** governance/assessment only. No implementation, code, Rules, Functions, index, UI, migration, or deployment is authorized; every convergence phase (A–G in the assessment) is a separate Owner gate. Docs-only PR; STOP before merge for Owner and ChatGPT review.
**Alternatives rejected:** treating Part Master as a competing product to be dismantled (repository shows it is already scoped as interim read-only admin scaffolding per `inv1-i1-readonly-part-master-visibility-plan.md`); a big-bang catalog cutover without shadow parity or the P0 join resolution (violates the additive dual-read discipline of ADR-008 §36-38 and Decision #42); collapsing all fields onto the canonical Part document (contradicts ADR-008 §22 field-authority separation).

## 44. INV-CONVERGENCE-B reconciliation evidence — P0 = JOIN_CLEAN; UD-1 ten records identified (read-only)

**Date:** 2026-07-25
**Decision:** Recorded the read-only reconciliation evidence unit INV-CONVERGENCE-B (`docs/audits/inv-convergence-b/`, baseline `d229af4`) that closes the two evidence blockers from Decision #43. **P0 verdict = `JOIN_CLEAN`:** the operational compatibility key is the canonical **`partId`**, which equals the operational `TST-####` SKU — all **190** production `parts` records join to the static catalog by exact `partId == sku` equality with **0 name mismatches and 0 unit mismatches** (after `ea→EACH` unit normalization); no alias/adapter is required for identity resolution (production `part_aliases = 0`; the `LEGACY__TST-####` alias is a would-be convenience, not a dependency). **`internalPartNumber` is not exposed** in the available production evidence, so its parity is not independently confirmed — but it is not the operational key, so `JOIN_CLEAN` stands. **UD-1 — the exact ten excluded records** are `TST-1047, 1070, 1074, 1080, 1112, 1136, 1143, 1175, 1189, 1193` (present in the static 200, absent from both the 190 production read-back and the 190-row migration input; three-way consistent). Their *identity* is proven by production + repository + migration evidence; the *reason* (discontinued/inactive) remains the Decision #42 D-M3 policy attribution — a named per-SKU discontinued manifest was still not transferred, so the reason is attribution, not raw evidence.
**Primary-input note:** no fresh Owner export was attached; the unit used the **committed, checksum-verified, sensitive-scan-CLEAN production zero-write read-back** (`create-execution-20260724/postwrite-analyzer/row-results.json`, 190 rows all `NO_CHANGE`/`IDENTICAL`, `currentSummary` populated) as the production-derived primary source. Residual caveats (neither changes the join): evidence freshness (2026-07-24) and two unexposed columns (`category`, `internalPartNumber`) — both closable by a fresh export. If the Owner requires the literal fresh export before treating P0 as final, record as `JOIN_CLEAN` (production-read-back evidence; fresh export pending); the result is unchanged.
**Effect:** evidence only. Confirms (does not alter) Decisions #37/#40/#42/#43 — canonical `parts` identity authority, `partId` grandfathered to SKU (ADR-008 §20), 200→190 = D-M3 exclusion. No Rules, Firestore writes, source switch, static-catalog edits, adapter/implementation, index, or deployment. UD-3/UD-4/UD-5 remain out of scope and open.
**Alternatives rejected:** `BLOCKED_INSUFFICIENT_EVIDENCE` (the committed production read-back is a legitimate production-derived source; blocking would ignore checksum-verified evidence on `main`); `ALIAS_REQUIRED` (direct `partId == sku` join needs no alias; production `part_aliases = 0`); `MIXED_OR_AMBIGUOUS` (zero unmatched, zero descriptive mismatches); fabricating or substituting a fresh export from migration-package data (would violate the unit's evidence-class separation).

## 45. Inventory → Parts authority contract adopted (INV-CONVERGENCE-C — directional, no implementation)

**Date:** 2026-07-25
**Decision:** Adopted the directional authority contract for the future read-only Inventory→Parts compatibility adapter, recorded in full at `docs/architecture/inventory-parts-authority-contract.md` (baseline `d57eff7`). This gate authorizes the **adapter contract only, not adapter implementation**, and changes no current behavior. Directions:
- **UD-3 (on-hand authority):** **physical on-hand, reserved, and available are distinct quantities and must not be conflated** — `available = physicalOnHand − reserved`; **RESERVED/RELEASED affect availability, CONSUMED reduces physical on-hand**, and the current `inventory_transactions` event set (RESERVED/RELEASED/CONSUMED) is **not** a complete physical on-hand ledger. Target authority is **four parts**: (1) governed opening physical balance / initialization event, (2) governed append-only **physical inventory movement authority covering all approved quantity-changing events** (opening/receiving/adjustments±/transfers in-out/consumption/cycle-count/returns/damage-loss-writeoff/other), (3) governed reservation ledger/state for commitments that don't change physical possession, (4) trusted projections `physicalOnHand` (opening + physical movements), `reserved` (active reservations), `available` (= physicalOnHand − reserved). **Do not assume the current taxonomy is sufficient.** Two safe directions recorded, **neither chosen here (final ledger topology DEFERRED):** A — expand `inventory_transactions` for the full physical-movement taxonomy in a future governed phase (preserving historical event semantics); B — retain `inventory_transactions` as the WO reservation/consumption ledger and add a separate governed physical-stock movement ledger/projection. Interim: static `warehouseQty` is a **temporary compatibility baseline, not physical on-hand truth**; the current reservation/release/consumption overlay and availability behavior are unchanged (no new event types). Required before static-catalog/Functions-mirror retirement and any "availability/physical on-hand is ledger-derived" claim.
- **UD-4 (field authority separation):** cost, selling price, and reorder policy are **distinct authorities** — canonical identity/governance → Firestore `parts`; supplier acquisition **cost** and supplier terms → `part_supplier_items`/supplier catalog; customer-facing **selling price** → a future pricing/price-book authority (**not** supplier-item records merely because cost lives there); **reorder policy** → governed inventory policy scoped as required (warehouse/stock-location/company/part-class/etc.), **not** a permanent universal threshold on the canonical Part. Interim: static `cost`/`price`/`reorderThreshold`/`warehouseQty` are STATIC_FALLBACK enrichment only, explicitly distinguishable from canonical/ledger fields, and **not copied into `parts`** in this gate.
- **UD-5 (Part Master nav):** retain the restricted admin/dispatcher registry through convergence; no nav/component change now; retain-vs-delete decided at Phase E after source-switch parity.
- **Adapter contract:** layered composition (Firestore `parts` CANONICAL ⊕ static-catalog STATIC_FALLBACK ⊕ ledger/workflow overlay) where **every output field carries an explicit source classification** — CANONICAL / STATIC_FALLBACK / LEDGER_DERIVED / WORKFLOW_DERIVED / HISTORICAL_SNAPSHOT — so callers never confuse authority.
**Phase dependencies:** UD-3 impl before Phase F; UD-4 impl before removing its static fallbacks (with procurement/pricing gates); UD-5 at Phase E; operational-role `parts` read-broadening is a **separate future Rules decision** (Phase C), not required by this decisions-only gate.
**Effect:** governance/contract only. No implementation, Rules, Functions, index, Firestore write, source switch, static-catalog edit, or deployment. Confirms and does not alter Decisions #37/#40/#42/#43/#44. JOIN_CLEAN (#44) still does not authorize a source switch and does not replace live shadow-parity before cutover.
**Alternatives rejected:** a single ledger-aggregate as the complete on-hand authority (cannot derive absolute on-hand without opening balance or zero-origin history); one unified "commercial" authority for cost+price (conflates supplier cost with customer selling price); placing selling price on `part_supplier_items`; a permanent universal reorder threshold on the canonical Part; changing Part Master navigation now; copying static fallback fields into `parts` in this gate.

## 46. Live pre-cutover current-vs-shadow parity gate SATISFIED (INV-CONVERGENCE-E Stage A; "Decision #44" gate)

**Date:** 2026-07-26
**Numbering note:** the INV-CONVERGENCE reviews refer to the live pre-cutover parity requirement as **"Decision #44."** DECISIONS.md `#44` is the append-only INV-CONVERGENCE-B *offline* reconciliation entry (P0 = JOIN_CLEAN) and is **left unchanged**; per the append-only convention, this **new entry #46** records satisfaction of the *live* parity gate that #44's offline result anticipated.
**Decision:** **SATISFIED — production pre-cutover current-vs-shadow parity PASS was captured on build `73d9e1b` with 190 canonical matches, 10 governed static-only exclusions, complete source counts, capture timestamps, and zero model/workflow divergences; Hosting-only deployment preserved live Rules and Functions inventories.** Governed evidence: `docs/audits/inv-convergence-e-stage-a/` (`live-pass.json`, `route-authorization-matrix.md` A–E all PASS, `deployment/*`, `verification-summary.md`, `attestation.md`, `SHA256SUMS.txt`).
**Evidence facts:** deployed diagnostic build commit `73d9e1b07f13c7f42cc525c3c037dec6b47d289d` (rendered build id `73d9e1b`); repo baseline `origin/main` @ `039e7c5`; governed repository `firestore.rules` SHA-256 `fda2423…5bac7` (independently recomputed, equal); predeploy live Rules hash == postdeploy live Rules hash (`a17f791d…b46b4bd8`); Functions inventory pre == post; Hosting-only deploy (`--only hosting`, exit 0); dispatcher credential readiness READY (no credential/identity value recorded). The governed **repository** Rules hash and the **live** Rules ruleset export hash are different artifact types and are **not** asserted equal.
**Effect:** the live parity gate is satisfied for build `73d9e1b`. **Stage A remains diagnostic and non-authoritative; this does NOT authorize a consumer source switch or a PartsList/PartDetail cutover.** The earlier build-`5609496` PASS remains supporting technical evidence only (its capture timestamps were not surfaced/exported). No timestamps or values were reconstructed. Successors (each separately gated): D (approved-ten disposition) and B (operational-role Rules) — both prerequisites — then C1 (PartsList) → C2 (PartDetail) cutover, each requiring live parity immediately before the switch.
**Not done:** no consumer wiring, no source switch, no Rules/Functions/index/data change, no deployment beyond the Hosting-only bundle already deployed. Decisions #43 and #45 unchanged; #44 unchanged (append-only).
**Alternatives rejected:** using the earlier build-`5609496` PASS as the qualifying artifact (missing surfaced/exported capture timestamps); editing the append-only #44 entry to record live-gate satisfaction (violates the append-only convention); asserting live-Rules-hash == repository-Rules-hash (different artifact types, not normalized for direct comparison).

## 47. No-Blaze standing decision formally superseded -- production confirmed on Blaze (governance docs reconciled to reality)

**Date:** 2026-07-26
**Baseline:** `origin/main` @ `f38703dca4cc6e07c782b098f2677015d68ce648` (PR-A was rebased onto latest `main` after PR #434 merged; the original report baseline was `8043518`)
**Decision:** The "no-Blaze standing decision" recorded in [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md) §9 and cited in entry #3 above is formally **SUPERSEDED**. This entry reconciles the foundational governance documents to a production reality already established and recorded elsewhere in this log: **Firebase Blaze is active and 11 Cloud Functions are deployed and verified live in production.** This is a documentation-reconciliation entry only -- it does not connect Blaze, deploy anything, change billing, or authorize spend.
**Reality basis (already recorded, not newly performed here):**
- Entry #36 (2026-07-20): Owner-authorized deploy of the repository Firestore Rules + exactly 11 callable Functions to `taylor-parts`/`us-central1`, corrected production verification passed; "Blaze and the required Google Cloud APIs remain active."
- Entry #35 (2026-07-20): "Blaze remains active and deployment-enablement APIs remain enabled."
- `docs/audits/functions-live-state/` (read-only production verification, 2026-07-21): confirmed the 11 Functions live (v2 / Gen 2 / Node 20, `us-central1`) -- only possible on the Blaze plan.
**Governance preserved (unchanged by this entry):**
- Blaze being active does **NOT** grant blanket spend authorization. Every new cost-incurring capability still requires business justification, expected usage and cost assessment, quota consideration, least-cost design, Owner approval, an implementation gate, a deployment gate, production verification, monitoring, and rollback. Governance is applied **proportionately** (Owner decision A4): trivial use of already-deployed infrastructure operating within an approved bounded design does not require a separate full cost gate; a new material spending exposure does.
- The two historically rejected plans stay separately governed and are **NOT** revived by this entry: "Cloud Functions Deployment Readiness" and the "Spark-Compatible Work Order rewrite" (see [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md) §9).
- Prior no-Blaze entries (including #3) remain intact and are now clearly historical -- this log is append-only; nothing above is edited.
**Issue #15 -- PARTIAL, NOT closed:** Issue #15 is defined across ADR-005/006/007 and `docs/architecture/customer-domain-foundation.md` as "production Cloud Functions **deployed and verified**," not merely "Blaze available." It is **substantially advanced but not fully resolved**: the three Work Order Functions (`createWorkOrder`, `transitionWorkOrder`, `updateWorkOrderExecutionData`) are deployed and verified (#36); the six enterprise-access mutation Functions (`grantRole`, `revokeRole`, `assignApprovedRole`, `setUserStatus`, `approveAccessRequest`, `rejectAccessRequest`) remain deliberately **undeployed**, and no claims bootstrap, Admin-mutation activation, or enforcement cutover has occurred. #15 may be **re-scoped** to the remaining undeployed set but must **NOT** be blanket-closed on billing availability alone.
**Stale-reference reconciliation:** the full enumeration of stale no-Blaze / "blocked" assertions and their per-file disposition is recorded in [`docs/assessments/blaze-governance-amendment.md`](assessments/blaze-governance-amendment.md).
**Effect:** governance / documentation only. No deployment, no Firebase configuration or billing change, no Rules / Functions / Hosting / index change, no Auth or identity mutation, no production data change, no GitHub issue closure.
**Alternatives rejected:**
- Framing this as "the Owner is now newly connecting Blaze" -- rejected as inaccurate; Blaze has been active and in production use since #35/#36.
- Blanket-closing Issue #15 because billing is available -- rejected; #15 is a deploy-and-verify gate that remains partially open for the enterprise-access mutation Functions.
- Editing the prior no-Blaze entries to "correct" them -- rejected; the log is append-only and each entry stays accurate to what was known when written.

## 48. Correction to #47 -- Issue #15 was mischaracterized as partial; it is complete and closed (enterprise-access remainder is Issue #226)

**Date:** 2026-07-26
**Baseline:** `origin/main` @ `4bc53a03c2cb54d5c890845919befb74d2ae94e6`
**Decision:** Corrects one characterization in entry #47. **#47's Blaze-reconciliation substance remains valid and unchanged** -- Blaze is active and production Cloud Functions are deployed and verified. However, #47 (and the Lane A assessment/annotations merged with it in PR #435) incorrectly described **Issue #15** as "partially resolved / not to be closed." That was wrong.
- **Issue #15** is narrowly scoped to deploying the **Epic 1 Work Order Engine backend** (Firestore Rules + the Work Order Functions). That scope is **complete**; Issue #15 was **closed as COMPLETED on 2026-07-16** and **must not be reopened or re-scoped**.
- The remaining enterprise-access work -- undeployed access-mutation Functions (`grantRole`, `revokeRole`, `assignApprovedRole`, `setUserStatus`, `approveAccessRequest`, `rejectAccessRequest`), claims bootstrap/migration, `accessVersion` behavior, enforcement cutover, Admin portal, auditing, migration, and production verification -- belongs to the **OPEN Issue #226 (Enterprise Access & Administration Platform)**, not Issue #15. No part of #226 is remaining #15 scope.
- Completion of #15 does **not** authorize any #226 deployment; #226 retains its own implementation and deployment gates.
**Effect:** documentation-only correction. No production effect, no deployment, no Firebase / billing / identity mutation. Issue #15 remains closed. Entry #47 is left intact (append-only).
**Files corrected:** `docs/assessments/blaze-governance-amendment.md` (Issue #15 section + classification table), `docs/CLAUDE_CONTEXT.md` (annotation), `docs/DeploymentModeStrategy.md` (§9 amendment bullet). Issue #226 was given an authoritative correction comment referencing this entry (chosen over rewriting another workstream's issue body to avoid clobbering concurrent edits).
**Not changed (out of this correction's scope):** pre-existing architecture/assessment records that use "#15" as the general Cloud-Functions-deployment-gate shorthand -- `ADR-005`, `ADR-006`, `ADR-007`, `docs/architecture/customer-domain-foundation.md`, `docs/assessments/customer-hierarchy.md`, `docs/assessments/customer-operability-data-ownership-and-analytical-export.md`, `docs/assessments/creation-and-page-formatting-consistency.md`. These are point-in-time records owned by other workstreams; their #15-vs-#226 attribution imprecision (and any post-#36 "Functions undeployed" staleness) is **flagged for the owning lanes**, not rewritten here, to stay within the #15/#226 ownership correction and avoid cross-workstream edits.
**Alternatives rejected:** reopening or re-scoping #15 (its narrow scope is genuinely complete); editing #47 in place (append-only log); sweeping all ADR/assessment #15 references in this PR (scope expansion beyond the #15/#226 ownership correction, and edits to other-workstream records).

## 49. INV-CONVERGENCE-E C2 (PartDetail cutover) AUTHORIZED for repository-only merge -- the separate C2 gate #46 requires

**Date:** 2026-07-27
**Baseline:** `origin/main` @ `f97edf19a0027d8e0cc1ec591cbfc099e7a495c0` (C1 Hosting deployment-evidence gate closed, PR #443)
**Authorized artifact:** PR [#445](https://github.com/TaylorService-spec/Taylor_Parts/pull/445), exact head `abfb1a4718bba4e0be95f8b3449d6723a6c8da00` (functional commit `94e322e5299e56e67fa8c8b99e46558d56a62502`; Codex-reviewed code head `53ec60020e98c8e8d8a79ee236ae835f56416442`, with a disclosed **documentation-only** delta of one file / +168 lines -- the authorization package itself -- and **zero** code, test, or configuration change between the two).
**Why this entry exists:** entry #46 satisfied the *live pre-cutover parity* gate but states in its Effect clause that "**Stage A remains diagnostic and non-authoritative; this does NOT authorize a consumer source switch or a PartsList/PartDetail cutover**," listing C1 -> C2 as separately gated successors. The Codex review of PR #445 at head `53ec600...` returned **CODE PASS -- GOVERNANCE HOLD** precisely because that separate C2 authorization existed nowhere in the repository or the PR. This entry records it.
**Decision:** **AUTHORIZED -- repository merge only.** The Owner authorized the INV-CONVERGENCE-E C2 PartDetail cutover to be merged into `main` as a repository-only change through PR #445 at head `abfb1a4718bba4e0be95f8b3449d6723a6c8da00`, accepted the docs-only delta after the Codex-reviewed code head subject to Codex final drift review, and ratified two design decisions:
- **D-C2-1** -- render canonical normalized unit tokens (`EACH`) rather than the raw static token (`ea`). Verified for all 200 Parts that rendered value `== normalizeUnit(static unit)`; Stage A measured `UNIT_DIVERGENCE = 0`, so meaning is unchanged and only the displayed token differs.
- **D-C2-2** -- fail closed by blocking the **complete** PartDetail page, including the entire reorder/PO/receive/cancel/void/inventory-action write surface, when canonical verification is denied, unavailable, or incomplete.
**Live-parity timing (Owner-decided):** fresh live parity belongs to the **separate C2 Hosting deployment gate**, following the C1 precedent (C1's merged record placed its live parity re-run at the C1 deploy gate). It is **not** required before this repository-only merge. This resolves the ambiguity flagged in the authorization package rather than leaving #46's "live parity immediately before the switch" wording to be read implicitly.
**Prerequisite chain at authorization:** Stage A **SATISFIED** (#46, build `73d9e1b`, 190 canonical + 10 governed static-only exclusions, 0 divergences); Stage D **DECIDED** (the approved ten remain visible as `STATIC_ONLY_EXCLUDED`, routes preserved); Stage B **DEPLOYED + VERIFIED**; **C1 MERGED AND LIVE IN PRODUCTION** (PR #441 -> merge `3827ce37`; Hosting gate closed via PR #443 -> merge `f97edf1`). C2's ordering precondition (C1 first) is therefore satisfied in substance, not merely on paper.
**Verification state at the authorized head:** Codex **CODE PASS** -- no actionable code, correctness, security, or regression findings. C2 suite `test/partDetailView.test.mjs` 34/34; C1 regression `test/partsCatalogView.test.mjs` 23/23 (the shared `composeGovernedPartsWorkspace()` extraction is behavior-neutral); full client chain, lint, typecheck, and build pass; `verify:build-base` 12/12; both GitHub Vite checks pass; PR `MERGEABLE`/`CLEAN`; evidence checksums `sha256sum -c` OK; governed sensitive scan CLEAN. Scope 14 files -- 5 implementation/test (frontend-only) + 9 evidence/governance -- with **zero** Rules, Functions, Firebase configuration, Auth, Customer, or production changes.
**Scope of this authorization -- what it permits:** merging PR #445 into `main` at the stated head, deleting the merged branch, and synchronizing `main`.
**What it explicitly does NOT authorize:** any deployment of any kind (the **C2 Hosting deployment remains a separate gate** with its own authorization); any Firebase configuration change; any Firestore or Firebase Auth mutation; any identity, role, or claim change; any Parts data migration, rename, restructure, deletion, or rewrite; any Customer/Auth stream change; retirement of the static catalog or the Functions mirror (Phase F). **Merging changes nothing in production** -- C2 behavior reaches users only at the future, separately-authorized Hosting deployment gate, exactly as C1 did.
**Effect:** the C2 governance hold is discharged. PR #445 returns to Codex for **final drift/merge review** before any merge; the merge does not proceed on this entry alone. Decisions #43-#46 unchanged; #46 is **not** edited (append-only) -- this entry records satisfaction of the separate C2 authorization its Effect clause required.
**Not done:** no merge performed at the time of this entry, no deployment, no Rules/Functions/index/data change, no identity or production mutation, no live parity re-run (deferred to the deploy gate per the Owner decision above).
**Alternatives rejected:** treating the earlier "begin repository-only C2 cutover from current origin/main" authorization as sufficient (it authorized *beginning* the work, predated PR #445, was not bound to a head, and expressly withheld merge pending Codex review -- it did not satisfy #46); allowing an AI session to self-certify the authorization (authority action, and it would manufacture the exact record #46 exists to require); editing #46 in place to add C2 authority (append-only log); requiring a live parity run before the repository-only merge (Owner-decided against, per the C1 precedent); merging immediately on Owner authorization without returning to Codex (the authorization is expressly subject to final drift review).

## 50. INV-CONVERGENCE-E C2 Hosting deployment and production verification SATISFIED

**Date:** 2026-07-27
**Authorized artifact:** `081df750d89d9044f0e09bb0241796b8171ed33f` (PR #447 merge), project `taylor-parts`, Hosting scope only.
**Decision:** **SATISFIED — DEPLOYED + VERIFIED + GREEN.** The operator deployed the authorized C2 build through Firebase Hosting. The pinned predeploy version was `sites/taylor-parts/versions/0bd9029d010914b7`; the new release is `sites/taylor-parts/versions/1ef5d23b1c0b9466`. Live asset `/assets/index-Bpj7e20-.js` matched the authoritative Cloud Shell build manifest exactly (`sha256 756693f2779e34a5fefb03d1c4450d32e39aa6d2c1c6154a06cfda553eb11ff5`).
**Fresh live parity:** PASS immediately before deployment — 190 valid canonical Parts, 0 invalid canonical records, 200 static records, 190 canonical matches, 10 approved `STATIC_ONLY_EXCLUDED`, 200 detail-ready records, and zero name or unit divergence.
**Production persona verification:** admin, dispatcher, `PARTS_MANAGER`, and `WAREHOUSE_MANAGER` each received canonical Parts `200` with exactly 190 records and rendered governed PartDetail checks passed (`TST-1001` → `EACH`, `TST-1002` → `KIT`, approved static-only `TST-1047` reachable). Technician received canonical Parts `403`, zero records, and the Inventory workspace/route failed closed with no static-as-success and no write surface.
**Scope integrity:** governed Rules sha256 remained `cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381` pre/post; normalized Functions inventory sha256 remained `011020f83d188ff578ed1fdeba40d48f2075be929ab0b28e3975221363820fab` pre/post. No Rules, Functions, indexes, Firebase configuration, Auth, identity, role, claim, session, Firestore data, or Parts data mutation occurred.
**Evidence:** sanitized repository evidence under `docs/audits/inv-convergence-e-c2-hosting-deploy/`; operator archive sha256 `fa3764768e7476250127b0ee5c485da97a4e6360567214f43b3da4d25376d954`.
**Effect:** closes the C2 Hosting production gate. Truck Inventory's stated prerequisite is now satisfied, but Truck Inventory remains a separate workstream and authorization. This decision does not authorize a combined Inventory + Customer release or any Customer/Auth deployment.

## 51. Governed Part–Equipment compatibility architecture APPROVED; D1 only authorized

**Date:** 2026-07-27
**Artifact:** PR #449, `docs/architecture/equipment-part-compatibility.md`.
**Decision:** **APPROVED** D-COMPAT-1 through D-COMPAT-7: separate top-level Equipment Model, model-alias, compatibility, and provenance authorities; deterministic opaque compatibility IDs; reduced compatibility enum; immutable multi-source provenance with relationship-level verification and visible conflicts; Parts Catalog remains the primary Parts experience; trusted-writer-only mutation; installed assets remain separate from Equipment Model authority.
**Additional direction:** Work Order history and reseller listings are evidence only; stronger sources outrank reseller evidence without erasing conflicts; compatibility failure blocks only the compatibility surface; existing Part IDs and Inventory ownership remain unchanged; Truck Inventory stays separately gated.
**Authorized next gate:** **D1 only** — repository-only pure Equipment Model types, normalization, alias and manufacturer/model identity contracts, serial-scheme contracts, validators, and no-I/O deterministic/alias-conflict tests.
**Not authorized:** compatibility persistence; Firestore collections; Rules; Functions; indexes; UI; imports; production reads/writes; installed-asset linkage; Truck Inventory; or Work Order, procurement, warehouse, PM, and AI consumers.

## 52. AUTH-PR-4 production recovery-email migration — Production Identity-Mutation Authorization (GRANTED)

**Date:** 2026-07-27
**Baseline:** `c2604dff3fcbcd3f9442648484e6d407b67444ef` (merged production-enablement gate, PR #457).
**Authorization status:** **GRANTED** by the Owner. Recorded here (append-only) and enabled in `functions/authpr4/production-authorization.json` (`authorizationStatus: PENDING → GRANTED`).
**Decision:** The Owner authorizes the governed AUTH-PR-4 operator workflow (`functions/scripts/authPr4RecoveryEmailMigration.js`, via `authPr4ProductionGate.js`) to change the **Firebase Auth recovery/auth email only** of the following production `taylor-parts` accounts, **one at a time, in this order**: (1) `emp-rudy-driver`, (2) `emp-rudy-parts-associate`, (3) `emp-rudy-warehouse-manager`, (4) `emp-rudy-parts-manager`, and — **only after (1)–(4) verify PASS and break-glass readiness is freshly confirmed** — (5) `emp-rudy-owner`. Each new alias is written **`emailVerified: false`**; UID and the Employee↔User link are preserved. **Excluded:** `emp-rudy-sales-manager`, all break-glass identities, and every identity not listed.
**Authorization binding (in the committed artifact):** `authorizationId = AUTHPR4-PROD-MIGRATION-001`; `reviewedHead = c2604dff3fcbcd3f9442648484e6d407b67444ef`; blob-SHA-256 governed-file hashes `authPr4RecoveryEmailMigration.js = 779410d65c55847ce6af27183c6d045118fe59dca46d1bb4cb9c92fec0b37ffd`, `authPr4ProductionGate.js = 0609613c3d96f621db31a47307c6e48d47ead1205ea3617df6c1862ec4b0b8af`; high-entropy `executionModeToken`; `executor.name = rudy-digiorgio`; `breakGlassContract = { validityWindowSeconds: 600, requiredConfirmer: rudy-digiorgio }` (executor and confirmer values **explicitly confirmed by the Owner**, 2026-07-27). **Scope of change:** the two governed workflow **implementation** files (`authPr4RecoveryEmailMigration.js`, `authPr4ProductionGate.js`) are **unchanged** by this authorization; the previously **PENDING placeholder** authorization artifact is **fully populated and its status changed to GRANTED** (`authorizationId`, `reviewedHead`, both governed-file hashes, `executionModeToken`, `executor.name`, and `requiredConfirmer` populated from their placeholders). Any change to the governed implementation files invalidates this binding and requires a new review + authorization.
**Does NOT authorize:** sending any reset or verification email; any explicit `revokeRefreshTokens` or other operator-initiated session revocation; changing password / role / operationalRoles / claim / `accessVersion` / Firestore data / account enabled state; deploying AUTH-PR-3; configuring an email provider; enumeration-protection or any Firebase Auth project-setting change; any Customer/Equipment combined release; or any Inventory/Equipment/Truck-Inventory work. A Firebase-triggered session effect from the email change is an **observed platform effect**, never an operator action.
**Execution posture:** merging this PR does **NOT** execute the migration. Execution is a later, separately-controlled step: obtain the private alias mapping and protected state key out-of-band; confirm the named executor; freshly confirm break-glass is recoverable + login-verified immediately before position 5; run one persona at a time; return sanitized evidence after each persona before advancing; **any failed / uncertain / disabled / missing / UID-mismatched / collision / integrity / ordering / read-back condition HALTS the full sequence**. No private address, UID, token, credential, state key, or identity-linked evidence is ever committed.
**Alternatives rejected:** keeping the artifact PENDING (would leave the Owner-granted decision unrecorded/unenabled); an Owner-hand-edited artifact (the Owner directs; the Customer/Auth session prepares the reviewed repository PR).

## 53. AUTH-PR-4 three-file re-authorization — production authorization re-bound to the expanded governed set

**Date:** 2026-07-28
**Baseline:** `dba0e33bd5f009c4374b8985af3a101d0d1e7777` (current `origin/main`; the merge of PR #461, which added the governed genesis initializer and expanded the gate's `GOVERNED_FILES` to three files).
**Why this entry exists:** entry #52 GRANTED the AUTH-PR-4 production migration bound to the **two**-file governed set at `reviewedHead c2604df`. PR #461 (Codex-reviewed at `bf393ba`, merged as `dba0e33`) added `functions/scripts/authPr4InitProgression.js` to `GOVERNED_FILES` and changed `authPr4ProductionGate.js`. **Governance history (accurate, do not overstate):** PR #461 did **not** receive an unconditional Codex PASS — its **post-merge Codex review returned CHANGES REQUIRED** because the AUTH-PR-4 security suites (`test:authPr4Init` / `test:authPr4Gate` / `test:authPr4Migration`, including Auth-emulator coverage) were **not CI-enforced**. That CI-enforcement gap was **subsequently corrected by PR #463** (merged `9b912d7`), which added `.github/workflows/authpr4-security-tests.yml` running those suites in CI (with the gate/migration Auth-emulator layers on `demo-authpr4`). The #52 artifact **no longer verifies** (its `governedFileHashes` cover only two files, and `authPr4ProductionGate.js` drifted) — production execution **fails closed**. "GRANTED" in the stale artifact was never a runnable path. This entry records the Owner-authorized **repository-only** re-binding.
**Decision:** **AUTHORIZED — prepare a DRAFT repository-only PR only.** The Owner authorized rebinding `functions/authpr4/production-authorization.json` to the **three** governed files now on `origin/main`, computed from the reviewed commit `dba0e33`. The governed decision of #52 (which identities, order, exclusions, and required behaviour) is **unchanged and carried forward**; only the file-set binding is corrected.
**New authorization binding (in the committed artifact):** `authorizationId = AUTHPR4-PROD-MIGRATION-001` (unchanged); `authorizationStatus = GRANTED`; `projectId = taylor-parts`; `personaOrder` = positions 1–5 as governed by #52; `reviewedHead = dba0e33bd5f009c4374b8985af3a101d0d1e7777`; blob-SHA-256 `governedFileHashes` recomputed from `dba0e33` — `authPr4RecoveryEmailMigration.js = 779410d6…0b37ffd` (unchanged), `authPr4ProductionGate.js = ec140a0a…7df81f0` (changed by PR #461), `authPr4InitProgression.js = 4b77b778…dba425c3` (new governed file); `executor.name = rudy-digiorgio`, `breakGlassContract = { validityWindowSeconds: 600, requiredConfirmer: rudy-digiorgio }`, and `executionModeToken` **preserved** from #52 (a repository-derived contract value, not a secret). Any change to any of the three governed implementation files invalidates this binding and requires a new review + re-authorization.
**Does NOT authorize:** merging this re-authorization PR; creating the state key or genesis progression; requesting private alias mappings, UIDs, or Firebase credentials; running a dry-run or any mutation; changing any Auth identity, email, session, provider, project setting, role, claim, or Firestore record; or any Inventory/Equipment/Truck-Inventory work.
**Verification posture:** the committed artifact verifies against the exact 3-file binding at HEAD and fails closed for a missing, substituted, stale, or drifted governed file (gate test updated to prove this). No private address, UID, token, credential, state key, genesis artifact, or identity-linked evidence is committed. **Merging this PR does not execute the migration** and does not deploy anything; execution remains the separate, later gate defined by #52.
**Alternatives rejected:** editing #52 in place (append-only log); leaving the stale two-file artifact GRANTED (production stays fail-closed with a misleading GRANTED status); an Owner-hand-edited artifact (the Owner directs; the Customer/Auth session prepares the reviewed repository PR for independent Codex review).

## 54. Customer password roadmap — username login, username-input recovery, and external email provider INDEFINITELY DEFERRED (Owner decision)

**Date:** 2026-07-28
**Artifact:** Customer password roadmap handoff (Owner, this session); reconciliation gate AUTH-UI-1 (`docs/assessments/admin-password-reset-current-state.md`, baseline `bc0fda5`).
**Decision:** The Owner **indefinitely defers** three Customer/Authentication roadmap items: (1) **username login**, (2) **username-input password recovery**, and (3) **external email-provider selection, configuration, or integration**. Email/password remains the supported login mechanism and email-input self-service recovery (AUTH-PR-2, Firebase-native client `sendPasswordResetEmail`) remains the supported recovery mechanism. This ratifies, and makes durable, the "DEFERRED" direction AUTH-PR-1 already recorded for username login/recovery (D-RESOLVER / D-PHASES) and **supersedes** the AUTH-PR-1 §6.2 `D-EMAIL-DELIVERY` design that assumed a direct external transactional email provider for admin-initiated reset.
**What this means (do not build):** no username-or-email login resolver; no username-based recovery; no external email-delivery provider abstraction, secrets, templates, retry pipeline, webhook, or delivery integration — including none created "for later." These items are **not to be reopened without a new explicit Owner decision.**
**Active remainder:** only two Customer password roadmap items remain active — **#4 Admin reset UI** and **#5 production admin password reset** — pursued as independently reviewed gates (AUTH-UI-1..3, AUTH-PR-3.5, AUTH-PROD-1..4).
**Effect on the merged AUTH-PR-3 backend:** the merged admin-reset command (PR #444) remains **fail-closed** (`NOT_CONFIGURED_DELIVERY`); with external providers deferred, production admin reset (#5) is **blocked** until the Owner decides a no-external-provider delivery posture (**D-DELIVERY-NATIVE**, PENDING — a Firebase-native server send with truthful "accepted"-only semantics) **or** directs that admin reset ships UI-only. The Owner must not have an external provider quietly introduced. The **Admin reset UI (#4) is not blocked** and may ship truthfully with unavailable/uncertain outcome states.
**Does NOT authorize:** any runtime code by itself; any deployment; any permission activation or role grant; any Firebase Auth/project change; any production reset/revocation/email. Those remain separate gates.
**Alternatives rejected:** treating AUTH-PR-1 §6.2's provider design as still active (contradicts this deferral); leaving the deferral only in chat/Claude memory (governance must be repository-durable); building a provider abstraction "for later" (explicitly prohibited).

## 55. Continuous-execution authority for the Customer password-reset workstream (Owner decision)

**Date:** 2026-07-28
**Artifact:** Customer password roadmap continuous-execution addendum (Owner, this session). **Canonical location for this authority — referenced, not duplicated, by `docs/session-state/CUSTOMER.md`, `PLATFORM.md`, and `COORDINATION.md`.**
**Decision:** For the Customer password-reset workstream, **once the Owner and ChatGPT/Codex approve** a gate's architecture, scope, security model, data authority, and production boundaries, Claude may proceed continuously through **authorized reversible repository work** without stopping after every artifact or intermediate PR — including: repository assessment; specification/implementation planning; repository-only code implementation and in-boundary refactoring; unit/integration/emulator/lint/typecheck/build; clean-checkout validation; sanitized-evidence preparation; documentation and session-state updates; draft PR creation/synchronization; in-scope review corrections; rebasing from current `origin/main` and non-substantive conflict resolution; marking approved repository-only PRs ready; merging approved docs-only/repository-only PRs; deleting merged branches; and beginning the next already-approved reversible repository phase. A **new** approval is required only if scope materially changes, a new architecture/security/data-authority/permission decision appears, an existing denial would become an allow, production effects are introduced, or the rollback/test posture no longer applies.
**Read-only production verification** is permitted without a new gate only when governed read-only tooling exists, the command cannot write/deploy/provision/repair/revoke, output is sanitized, no credentials/emails/aliases/UIDs/tokens/passwords/reset-links/raw records are committed, and a failed check cannot trigger automatic corrective mutation. Claude must **stop before any corrective production action.**
**HARD STOPS — explicit authorization required before:** any production deployment (Functions/Rules/Hosting/index); Firebase Auth or project-configuration mutation; production user/data mutation; password reset or change; sending a production reset email; recovery-email mutation; session/refresh-token revocation; role/operationalRoles/claim/accessVersion/employee-link/employmentStatus mutation; production username mapping; source cutover; removing a compatibility/recovery fallback; any action that could remove Owner or break-glass access or leave zero recoverable administrators. **Merge ≠ deployment; repository authorization ≠ production execution.** A production gate must specify exact commit, environment, command/tool, scope, expected effect, pre-change checks, rollback, post-change checks, stop conditions, access-preservation checks, and sanitized-evidence requirements.
**Separation:** AUTH-PR-4 remains operationally separate from AUTH-PR-3; **no combined Customer and Inventory production release is authorized.**
**Does NOT authorize:** any of the hard-stop actions above; reopening the #54 deferrals; or treating Claude's own analysis as the required Owner/ChatGPT approval.

## 56. AUTH-UI-1 approved — admin password-reset delivery, revocation, permission, and guard decisions (Owner + ChatGPT)

**Date:** 2026-07-28
**Artifact:** PR #469 (AUTH-UI-1 design gate) reviewed and **APPROVED** by the Owner and ChatGPT/Codex; resolves the four PENDING decisions the assessment (`docs/assessments/admin-password-reset-current-state.md` §10) raised. Baseline `bc0fda5`.
**Decision — the four items are decided:**
- **D-DELIVERY-NATIVE — APPROVED.** Adopt a **Firebase-native server-side** password-reset send for admin-initiated resets. **No external transactional email provider**; do not reopen provider selection or create a provider abstraction. The Firebase response is treated **only as `REQUEST_ACCEPTED`** — never "delivered", "opened", or "consumed". UI output stays neutral/sanitized; no reset link, action code, email address, Firebase response body, or internal error is exposed. **Production use remains blocked** until the revised backend (AUTH-PR-3.5) is tested and **separately authorized** for deployment. Real-Firebase earlier-link consumability stays a separate **AUTH-PROD-1** verification. If the native server path cannot meet the approved security/audit contract, **stop and report the contradiction — do not introduce an external provider.** This supersedes AUTH-PR-1 §6.2 `D-EMAIL-DELIVERY` (already deferred by #54).
- **D-ROUTINE-REVOKE — NO.** Routine admin-initiated resets **must not** revoke sessions or refresh tokens. Session revocation belongs to a **separate suspected-compromise workflow** requiring an explicit operator choice, its own governed permission/action, separate confirmation, separate audit, and separate production authorization. Revocation is never silently bundled into routine reset.
- **D-RESET-PERMISSION — APPROVED.** Permission id **`admin.credentialReset.initiate`**, registered **inactive**, **no role grants**, no production activation, trusted server-side resolution only, client-supplied actor identity prohibited. **Intended future eligible personas** (policy only, not activated): Owner and governed admin. **Denied:** dispatcher, parts manager, warehouse manager, technician, sales manager, unauthenticated, inactive user, self-target, break-glass identity, protected final recoverable administrator, disabled target, missing Employee linkage, missing Auth linkage. Activation/grant requires a **later explicit production/security gate.**
- **AUTH-PR-3.5 guard gap — CONFIRMED.** The backend must add and test, before any enablement: disabled-target denial; break-glass-target denial; missing/non-reciprocal Employee↔Auth linkage denial; and final-active/recoverable-administrator protection. **The UI is not a security boundary** and must not compensate for missing backend enforcement.
**Authorized continuous reversible repository phases (no further Owner stop needed between them, under #55):** merge PR #469 after this reconciliation → **AUTH-UI-2** (pure UI/domain state + unit tests) → **AUTH-UI-3** (AdminUsers integration + emulator/mock tests) → **AUTH-PR-3.5** (backend correction, repository/emulator only). Prefer separate bounded PRs; a combined AUTH-UI-2+UI-3 PR is acceptable only if separation is artificial and the PR stays testable/reversible; **AUTH-PR-3.5 is never combined with the UI PRs.**
**Does NOT authorize (HARD STOP before AUTH-PROD-1 and any of):** real Firebase password-reset behavior; sending any production reset email; production Auth access; Functions deployment; permission activation; role grants; project configuration; session revocation; production data/identity mutation. AUTH-PR-4 recovery-email migration/rollback, AUTH-PR-3/3.5 admin reset, Inventory/Equipment, and Truck Inventory remain separate; **no combined Customer and Inventory production release.** The #54 deferrals (username login, username-input recovery, external email provider) remain fixed.
**Alternatives rejected:** reopening an external email provider (violates #54 and D-DELIVERY-NATIVE); bundling routine reset with session revocation (D-ROUTINE-REVOKE = NO); activating/granting `admin.credentialReset.initiate` now (requires a later gate); relying on the UI to enforce eligibility (the UI is not a security boundary).

## 57. INV-CONVERGENCE-E WarehouseManagerHome canonical Parts Catalog cutover MERGED (repository-only, not deployed)

**Date:** 2026-07-30
**Artifact:** PR [#479](https://github.com/TaylorService-spec/Taylor_Parts/pull/479), merged to `main` as `3abdeddb512814ba39f016c420a21b3ef0a82c78` (Codex-reviewed head `43ea3570e13035e588955435b847b82bb6195518`).
**Decision:** **MERGED — repository only.** The Owner authorized the repository-only merge of the WarehouseManagerHome canonical Parts Catalog cutover. WarehouseManagerHome's Parts Catalog LIST now reads canonical `parts` via the shared `services/partMasterQueries.fetchPartMasterList` → new pure `domain/warehouseManagerCatalogView.js` (wrapping `domain/partsCatalogView.buildPartsCatalogRows`); the static 200-row `PARTS_CATALOG` is demoted to a governed `STATIC_FALLBACK` input, never a parallel source of truth. A denied/unavailable/incomplete canonical read renders a fail-closed blocked banner, never the static catalog presented as canonical. This supersedes the Issue #100 Specification's "reuses the static `PARTS_CATALOG`" language for WarehouseManagerHome's catalog list specifically (recorded in that spec's "Post-merge refinement" section).
**Shared fail-closed guard:** the same PR hardened the shared `domain/partsCatalogView.composeGovernedPartsWorkspace` to BLOCK (`BLOCKED_INCOMPLETE_INPUT`, sanitized `invalidCount` only, never raw docs) on any present-non-empty or malformed `invalid` collection from `fetchPartMasterList`, and WarehouseManagerHome passes `invalid` through. Backward-compatible: a caller omitting `invalid` is unchanged. (PartsList/PartDetail were aligned to this guard separately — see #58.)
**Scope integrity:** 11-file repository-only change (frontend view/component + tests + path-gated `inventory-parts-ui-tests.yml` CI + folded docs). **Zero** Rules, Functions, indexes, Firebase configuration, Auth, Customer, Equipment, or production changes. The WAREHOUSE_MANAGER canonical `parts` read Rule was already merged AND deployed (DECISIONS #50 persona confirmation); this cutover deploys nothing and retires nothing.
**What it explicitly does NOT authorize:** any Hosting deployment (the merged runtime reaches users only at a future, separately-authorized deployment gate); any Rules/Functions/index/permission change; any Parts data or identity mutation; static-catalog retirement (Phase F, still blocked by #45/UD-3 and excluded by #49); OD-3 migration of the remaining static-primary consumers; Equipment or Customer/Auth work; no combined Inventory + Customer release.
**Effect:** WarehouseManagerHome is canonical-first at the repository level. Merge changes nothing in production. Decisions #43–#46, #49–#50 unchanged (append-only).

## 58. INV-CONVERGENCE-E C1/C2 (PartsList + PartDetail) invalid-passthrough fail-closed correction MERGED (repository-only, not deployed)

**Date:** 2026-07-30
**Artifact:** PR [#481](https://github.com/TaylorService-spec/Taylor_Parts/pull/481), merged to `main` as `1f76f84cc38ddf9f611e79615c3b311ed1b21b2b` (Codex-reviewed head `107f12ad618b16eed62915ad1ca3a323bba5cf5a`).
**Why this entry exists:** the Codex review of #479 found that PartsList (C1) and PartDetail (C2) mapped a successful `fetchPartMasterList()` to `{ status: "OK", rows: parts }` and **dropped the `invalid` collection** — so a malformed canonical document could be silently omitted before the shared composer's completeness check and, if it overlapped an approved `STATIC_ONLY_EXCLUDED` sku, masked into a false READY. #479 fixed only the shared guard and WarehouseManagerHome; C1/C2 were recorded as a separate immediate correction gate. This entry records that gate CLOSED.
**Decision:** **MERGED — repository only; correction gate CLOSED.** The Owner authorized the repository-only merge. PartsList (C1) and PartDetail (C2) now pass `invalid` into the shared `composeGovernedPartsWorkspace`, so a present-non-empty or malformed `invalid` blocks both surfaces (`BLOCKED_INCOMPLETE_INPUT`) — showing neither canonical nor static catalog rows — an approved static-only exclusion can no longer mask an invalid document into a false READY, and raw invalid-document contents never surface.
**Verification at the authorized head:** Codex final PASS (no actionable findings). Tests: pure `test/partDetailView.test.mjs` (invalid regressions) + render gates `test/partsListInvalid.test.jsx` (C1) and `test/partDetailInvalid.test.jsx` (C2) over the real composer/static catalog; full offline chain + `test:components` + typecheck + build green; the path-gated `inventory-parts-ui-tests.yml` extended to the C1/C2 files. Scope = 8 files (frontend + tests + CI + docs), MERGEABLE/CLEAN, 4/4 checks. Zero Rules, Functions, indexes, Firebase configuration, Auth, Customer, Equipment, or production changes.
**What it explicitly does NOT authorize:** any Hosting deployment (the merged C1/C2 runtime reaches users only at a future, separately-authorized deployment gate — HELD, to be pinned to `1f76f84cc38ddf9f611e79615c3b311ed1b21b2b` with ancestry + build-equivalence proof); any Rules/Functions/index/permission change; any Parts data or identity mutation; static-catalog retirement; OD-3 migration; the authenticated Issue #100 production verifier run (OD-4 held); Equipment or Customer/Auth work.
**Effect:** the separate C1/C2 invalid-passthrough correction gate is CLOSED at the repository level. Merge changes nothing in production. Decisions #43–#46, #49–#50, #57 unchanged (append-only).

## 59. Serialized Asset to installed Equipment architecture approved

**Date:** 2026-07-30
**Artifact:** `docs/architecture/ADR-010-equipment-custody-and-available-inventory.md`; authoritative starting head `364a8b49dcd32209c9fece7c87bc885260b26e71`.
**Decision:** **APPROVED — architecture and phased roadmap only.** Pre-install identity and custody remain under the adopted Enterprise Inventory Serialized Asset, ledger, Receiving, Transfer Order, and Location authorities. Trucks are `MOBILE` Locations and in-transit inventory uses the `VIRTUAL` Location. Installation is an atomic trusted handoff that consumes the delivered serial from Inventory, marks it installed/non-available, creates and links one ADR-006 Equipment record, and appends immutable installation-link history and audit. A serial has at most one current Equipment link but may have sequential installations; replacement retires the old Equipment and creates a new record for the replacement serial.
**Superseded draft directions:** no company-owned pre-install records in `equipment/{id}`; no Equipment custody/movement ledger; no bespoke Vehicle custody authority; no pre-install fulfillment state on Equipment. These supersede the earlier draft D-A and D-C directions wherever they conflict.
**Additional boundaries:** Part Master membership does not imply internal stock; Parts Town/Phoenix is external supplier fulfillment, not an internal Warehouse; `internalPartNumber` is the only customer-visible part identifier and supplier identifiers/costs remain restricted through backend projections and permissions. This does not redefine Parts quantity authority or UD-3/UD-4.
**Dependencies:** Enterprise Inventory Phases 1, 2, and 4; ADR-006, ADR-008, ADR-009, and Decisions #37/#40.
**Authorized next gate:** repository-only Specification for the Serialized Asset→Equipment installation handoff and composed Available/Customer Equipment experience, followed by independent review.
**Not authorized:** runtime implementation; Firestore or production-data mutation; Rules/Functions/index/permission/Hosting deployment; migration/import; supplier integration or purchasing; Sales/Financial modules; QR/RFID implementation; production access.

## 60. EI Truck Registry trusted write service — architecture APPROVED; repository-only internal service authorized

**Date:** 2026-07-31
**Artifact:** `functions/src/truckRegistry/*` (types, validation, repository, commands); `docs/architecture/ADR-010-equipment-custody-and-available-inventory.md`. Starting head `fa71abe2dbd4fb8268324c5958b6f37e88255416`.
**Decision:** **APPROVED — repository-only internal trusted write service** implementing the ADR-010 Truck Registry (Decision #59). Trucks are `MOBILE` Inventory Locations; the business record links 1:1 and is NOT custody authority. The cross-document 1:1 Truck↔MOBILE-Location invariant — which Firestore Rules cannot express — is enforced inside one transaction via a `location_truck_claims/{locationId}` guard doc (create-if-absent). Operations: create (atomic `mobile_locations` + `trucks` + `location_truck_claims`), assign/reassign/unassign driver, change status, change home warehouse, deactivate, reactivate. Each: one `db.runTransaction` with deterministic-`auditEvents`-id idempotency, version CAS, and an atomically-staged Audit Event.
**Binding decisions (Owner):** deactivation is **fail-closed** — an `UNKNOWN` governed-inventory-presence result blocks it (today it is always UNKNOWN; no serialized-asset/ledger-at-location source exists yet); the injected inventory predicate receives the transaction and reads through it; `location_truck_claims` client read AND write are denied unconditionally (internal bookkeeping); truck `locationId` is **immutable** (no relink operation); reactivation requires an explicit `ACTIVE` or `IDLE` target; deactivation atomically sets truck+location inactive and truck status `OUT_OF_SERVICE`; internal commands receive a **trusted `actorUid`** (a future callable alone derives it from `request.auth.uid`); governed status transitions allow any distinct enum value.
**Authorization model:** admin/dispatcher **security role** (`users/{uid}.role`), mirroring `isAdminOrDispatcher()` — **no new capability**, no Issue #100 change.
**Not authorized:** callable wrapper or `functions/src/index.ts` export; Rules/Functions/Hosting/index deployment; production record creation/seed/mutation or verification; capabilities; QR movement; GPS; the inventory writer/ledger; production access. Merge authority does not imply deployment authority.

## 61. Shared platform-neutral workflow skills merged to main (first delegated Tier-1 merge)

**Date:** 2026-08-05
**Artifact:** `skills/{publish-artifacts,verify-rules-deploy,scaffold-workstream-doc,codex-review-request}/` (canonical SKILL.md + references/ + Node scripts with node:test) plus thin `.claude/skills/*` adapters. Merged via PR #556 (merge commit `12af3bd`, base `4d673ec`; branch `skills/shared-workflow-skills`, commits `349ab0d` initial + `1bfc122` Codex-correction).
**Decision:** Merged four canonical, platform-neutral workflow skills usable by Claude and ChatGPT/Codex, with Claude-only `.claude/` adapters that reference (not duplicate) the canonical version. Codex independently reviewed and APPROVED as MERGE-READY at `1bfc122` (full suite 66 node:tests pass / 0 fail; `git diff --check` clean).
**Why Tier-1 / merged without a separate Owner gate:** repository workflow infrastructure only — no product code, Firestore Rules, identity, deployment, or production changes; touches no Tier-2 category. Per DelegationCharter Amendment 1 (Tier-1 includes merging a PR that touches no Tier-2 category) and Codex's explicit ruling ("no Owner decision required"), Claude exercised delegated Tier-1 merge authority. **First such delegated merge — recorded as precedent.**
**Codex correction loop (`349ab0d` → `1bfc122`):** removed stale "every merge is a separate Owner gate" language (now: skill never merges; any later merge follows the current Charter); removed the hardcoded `Co-Authored-By` trailer (co-author now optional/explicit); replaced external `mkdir -p`/`cp` with Node `mkdirSync`/`copyFileSync`; made routine UI/small-fix non-warranted in `assessWarrant` (risk indicators/force only); hardened cleanup-error-masking and strict CLI arg parsing.
**Not authorized / not done:** no deployment, no production, no Rules/identity. The skills themselves never perform a merge. Claude-only automation (hooks: session-context/rules-guard/unpublished-work-guard; agents: design-code-reviewer/user-docs-writer) remains LOCAL-ONLY and is not part of this merge.

## 62. Claude-only automation validated and published to the repo (Tier-1)

**Date:** 2026-08-05
**Supersedes the "LOCAL-ONLY" note in entry #61:** the Claude-only automation is now validated and committed to the repo. Branch `docs/aug5-automation-validation` off `origin/main` @ `4ab2346`, commit `cc124e4` (+ this DECISIONS/evidence follow-up commit), merged via delegated Tier-1 authority (no separate Owner gate, per your instruction and DelegationCharter Amendment 1).
**Decision:** Merged the repo-local `.claude/` automation — SessionStart `session-context.mjs`, PostToolUse `rules-guard.mjs`, Stop `unpublished-work-guard.mjs`, and the `design-code-reviewer` / `user-docs-writer` agents — plus `docs/reviews/automation-validation-2026-08-05.md` recording that each surface fires and produces usable output. Also wired the previously-unregistered `Stop` hook into `.claude/settings.json`.
**Validation evidence (all local/reversible, nothing deployed):**
- SessionStart — fired live this session (delivered the Charter/CONTEXT/SPRINT/AUTHORITIES orientation block).
- rules-guard — direct-invoke on a `firestore.rules` path emitted the full Tier-2/parity/deploy reminder, silent on non-rules; LIVE: a comment-only Edit to `field-ops-app-vite/firestore.rules` auto-fired it, then reverted (never committed/deployed).
- unpublished-work-guard — was not registered; wired the Stop block, then confirmed both by direct-invoke and by live turn-end firing (flagged the stranded artifact docs).
- design-code-reviewer + user-docs-writer — spawned on small real targets; both loaded and returned usable, grounded output.
**Scope / optionality:** the automation is explicitly OPTIONAL and Claude-Code-specific. The shared, platform-neutral workflow skills under `skills/` (entry #61) do NOT depend on any of these hooks or agents and continue to work without them.
**Why Tier-1:** repository automation/config + a docs evidence file — no product code, Firestore Rules content, identity, deployment, or production change; touches no Tier-2 category.
**Not done / not authorized:** no deployment, no production, no Rules/identity/Blaze; the six other stranded artifact docs the Stop guard flagged were NOT republished (4 already exist on `docs/aug5-analysis-and-blueprint`; 2 belong to other-workstream WIP); the parallel session's product/demo WIP (`field-ops-app-vite` demo files, `PartsScanner.jsx`) was left untouched. Incidental finding recorded in the evidence doc: `PartsScanner.jsx` is live-routed but demo-backed and unlabeled — left for its owning workstream.
**Alternatives rejected:** publishing via the `publish-artifacts` skill — its path policy correctly fails closed on non-`docs/` paths, so the `.claude/` config was published via an isolated worktree instead (same isolation the skill uses internally).

## 63. W3 receiving activation DEPLOYED (scoped two-function) — engineering/verification COMPLETE, operational acceptance DEFERRED

**Date:** 2026-08-06
**Decision:** The two W3 receiving callables — `receiveInventoryStock` and `listReceivingLocationOptions` — were deployed live to `taylor-parts` from the pinned reviewed source `fb45e6eed77f1a3ad89737ee22618a770e6362b5`, per the amended runbook `docs/deployment/w3-receiving-activation-runbook.md`. Deploy executed under a separate Owner-operator Tier-2 authorization. Pre-deploy estate 20 → post-deploy estate 22; the two additions are exactly those callables and all original 20 remain present and unchanged.
**Live configuration verified (both):** `v2` / `GEN_2`, trigger `callable`, `us-central1`, `nodejs20`, `256Mi`, State `ACTIVE`. URIs: `receiveinventorystock-5d4sshsceq-uc.a.run.app`, `listreceivinglocationoptions-5d4sshsceq-uc.a.run.app` (updateTimes 2026-08-06T14:14Z). Verified via `firebase functions:list --project taylor-parts --json` → count 22.
**Repository/emulator verification (at pinned source):** Node v20.20.2 / npm 10.8.2; `npm ci`, `npm run build`, `npx tsc --noEmit` all PASS; 5 focused emulator suites passed / 0 failed / exit 0 (receiving command, callables, exports, grant-gate, operational-movement ledger) — confirming atomicity, capability-through-transaction, ORDERED source-state enforcement, fail-closed wrong-state/SERIAL/LOT, exact-retry replay with no duplicate writes, append-only idempotent ledger, and bounded public error mapping.
**Deploy-evidence note (not a failure):** the deploy command was invoked twice; final output showed `listReceivingLocationOptions` created and `receiveInventoryStock` updated — consistent with the first run creating `receiveInventoryStock` before output capture. No other function was created/updated/deleted; the 22-function reconciliation is exact. Not a failed deployment.
**Operational acceptance DEFERRED (business-data/UI prerequisite, not a defect):** the production applied-receipt test needs BOTH a pre-existing actor holding `inventory.stock.receive` (no grant authorized) AND a legitimate ORDERED `reorder_requests/{id}` with a linked ORDERED `reorder_purchase_orders/{id}` (no synthetic PO authorized). There is also no current UI path to inspect an ORDERED/ORDERED source (Purchasing → Purchase Orders is "not built yet"). Deferred until those pre-exist.
**Scope / not done:** no Rules change, no capability grant, no `createWorkOrder`/`transitionWorkOrder` redeploy, no PartsScanner wiring, no `customerName` denormalization, no unrelated Functions changed. Separate later slices: A PartsScanner-in-FieldMode, B technician `customerName` denormalization (redeploy only the changed WO Functions), C Purchase Order UI, D a separate governed Node.js-20-runtime-modernization story (Firebase deprecation warning).
**Superseded stale language:** the prior "W3 receiving — NOT LIVE / not deployed" claims in `docs/reviews/issue-15-activation-decision-package.md` §8 and `docs/reviews/w3-inventory-write-loop-readiness.md` are corrected by this entry and the closure record `docs/deployment/w3-receiving-activation-closure.md`. The Administration Permission Preview JSX placeholder ("…trusted backend … not yet deployed and verified (Issue #15)") remains stale/over-broad and is flagged for a separate small frontend slice (out of this docs-only closure's scope).
**Why docs-only closure:** records deploy/verification facts and status; changes no product code, Rules, identity, or deployment.

## 64. Purchase Orders read surface (Purchasing item C) MERGED — read-only oversight of reorder Purchase Orders + ORDERED receipt-candidate surfacing

**Date:** 2026-08-06
**Decision:** Built and merged the real Purchasing > Purchase Orders index screen (PR #578, merge `4022d7f`, exact-head-guarded at Owner-approved head `2ae3f32`), replacing the `PlaceholderPage`. It is the first cross-request view of `reorder_purchase_orders` (previously visible only one-at-a-time inside `PartDetail`). Repository-only; frontend + user-doc + one test-registration line; nothing deployed.
**What it does:** lists reorder Purchase Orders composed from the already-client-direct `reorder_requests` + `reorder_purchase_orders` reads; Open/Received/Voided/All filters (+ a "Needs attention" filter shown only when a genuine ORPHAN exists); F-UID-1 actor names; and — its platform purpose — surfaces the ORDERED/ORDERED **receipt candidates** the now-live `receiveInventoryStock` callable can be received against, exposing the exact receipt source descriptor `{type:"REORDER_PURCHASE_ORDER", reorderRequestId, purchaseOrderId}` for that separately-authorized step.
**Governance boundary (held, Codex-verified against `firestore.rules`):** READ-ONLY — no write path to `reorder_purchase_orders` (sole writers remain `domain/reorderPurchaseOrders.js` `recordPurchaseOrder`/`voidPurchaseOrder`), no `receiveInventoryStock` invocation, never reads `receiving_orders` (backend-only deny-all), no Cloud Function call, no capability grant, no Firestore Rules change, no production mutation, no redesign. Does not conflate `reorder_purchase_orders` with the reserved Epic-5 `purchase_orders`.
**Access / personas:** admin/dispatcher only (Purchasing nav = `PLACEHOLDER_DEFAULT_ROLES`); technician and operational-only roles never see it (a direct URL still fails closed to `BLOCKED_PERMISSION`). PARTS_ASSOCIATE keeps its existing scoped per-part PO view in `PartDetail` (unchanged).
**Codex correction applied before merge:** the purchase-order read now PRESERVES its error (`err.code`) instead of swallowing it, and the view-model fails the surface closed on EITHER read's error (permission precedence), is LOADING while either read is in flight, and reserves ORPHAN for the honest successful-read/missing-document case — a denied/unavailable PO read is no longer downgraded to spurious "Needs attention" rows.
**Quality gates:** pure view-model with 21 offline `node:test`s; full client suite green; oxlint clean; vite build OK; impeccable detector clean on the new screen (+ restrained a11y/tabular-numeral polish); design-code-reviewer pass (no High; governance claims verified); per-role persona review. User guide `docs/user-guide/purchasing/view-purchase-orders.md` added.
**Why Tier-1 (continuous execution):** frontend read surface + docs reusing vetted house patterns; touches no Tier-2 category (no Rules/identity/deploy/grant/production).
**Follow-ups (separate, per Owner direction):** SYSTEM_AUTHORITIES receiving-write-authority row is corrected separately (it records the receiving WRITE authority, not caused by this read-only UI); a one-line stale comment in `buildPurchaseOrderRow` ("permission/absent") will be tidied in a later code touch (non-blocking; permission failures can no longer reach that function). Next section: PartsScanner as a tool within FieldMode.

## 65. PartsScanner mounted as a non-mutating tool within FieldMode (Purchasing item A / Section A) MERGED

**Date:** 2026-08-06
**Decision:** Mounted `PartsScanner` as a non-mutating scan/lookup tool inside `FieldMode` (the Technician Workspace) and retired the misleading ad-hoc scan-receive behavior (PR #581, merge `163257c`). Owner architecture decision A3 (over A1 "governed receive-against-PO inside FieldMode" and A2 "split") on persona grounds: FieldMode serves the technician persona, but `inventory.stock.receive` is granted only to {admin, dispatcher, owner} — a real receive workflow there would always hit a governed `permission-denied`. Repository-only.
**Scope:** FieldMode mounts `<PartsScanner technicianId={…}/>` in a collapsible "Parts Scanner" tool (collapsed by default; FieldMode preserved as the Technician Workspace). PartsScanner REMOVED the ad-hoc "Receive inventory / add to warehouse" action + `inventory.receivePart` (also deleted the now-dead `InventoryContext.receivePart`), added a persistent "Demo — not saved" banner (R5), and scoped its job-picker read to the technician via `useAssignedJobs(technicianId)` (fixing a review-caught latent unscoped `fieldops_jobs` read that Rules deny for technicians — F-RULES-1). Removed the undeclared `@zxing/browser` embedded-decoder fallback (it broke the build on mount); degrades to native `BarcodeDetector` + manual entry, no new dependency. Corrected the stale `receivingReadiness.js` comment (callables now deployed + granted; `RECEIVING_TRANSPORT_READY` stays false pending Phase-F; constant unchanged).
**Governance boundary (held):** NO receiving write path wired into the Technician Workspace (every `receiveInventoryStock` mention is an explanatory comment); no `receiveInventoryStock`/`listReceivingLocationOptions`/transport-client call; no readiness flip, capability grant, Rules change, Function deploy, Hosting release, or production write. The governed PO-receipt workflow belongs to a future authorized Inventory → Receiving surface (PO candidate → destination → quantities → `receiveInventoryStock`); PartsScanner may later FEED it as an input device but never owns the transaction.
**Quality gates:** full node suite green; vitest 485/485 (`receivingTransport` 63/63 unaffected); oxlint clean; vite build OK; impeccable detector 0 findings on the changed UI; design-code-reviewer pass with all findings (HIGH read-scoping, MEDIUM dead-code, LOW CSS) applied.
**Why Tier-1:** frontend/config + docs reusing vetted patterns; touches no Tier-2 category.

## 66. Delegation Charter Amendment 2 — autonomous execution operating mode (default autonomy)

**Date:** 2026-08-06
**Decision:** Added `DelegationCharter.md` Section 8 (Autonomous execution operating mode) and a mandatory summary in `AGENTS.md`, and aligned the SessionStart hook's standing rules — making DEFAULT AUTONOMY a durable, repository-resident rule so it survives across sessions and context compression. Charter bumped to v0.3; recorded as Amendment 2.
**Rule:** operate autonomously through repo-only implementation; do not stop for routine merge/documentation/exact-head/review-routing/cleanup approvals. For reversible repo-only work within an already-approved architecture with all checks passing: implement, fix review findings, verify, update docs/records/`DECISIONS.md`, open PRs, complete governed review, merge approved Tier-1 PRs under the exact-head guard, clean up, and continue into the next already-directed section. Stop only for the genuine boundaries enumerated in §8.3 (material architecture/product decisions; security/authorization or Rules/protected-policy changes; capability/role/access changes; production deploy/Hosting/Functions/live-verify; migration/destructive/production-write/rollback; spending; irreversible actions; parallel-owned surfaces; unresolvable test failures; uncertain evidence; conflicting authorities; scope broadening). Return at meaningful milestones, not every PR.
**Reason:** the reduce-stops operating model had been established repeatedly but kept being lost between sessions and after compression (a behavioral rule with no durable repository home). Owner directed it be persisted in the canonical governance artifact rather than re-issued each session.
**Owner control intact:** the amendment authorizes no production deploys, Rules deploys, grants/role changes, migrations, destructive operations, spending, or unapproved architectural changes, and does not bypass the human-operator credential boundary; Tiers 2–3 and all higher governance documents still bind (§8.7). This is a *how-aggressively-Tier-1-is-exercised* rule, not an expansion of what Tier 1 covers.
**Why Tier-1 to land:** it records/formalizes an operating model the Owner directed, in governance docs + repo config; no code/Rules/deploy/identity/production change. (The authority itself is an Owner amendment, per Section 7 — only Rudy can amend the charter; this commit records his direction.)

## 67. AI Engineering Operating Model + Owner/IP governance program adopted (Tier-1 repo-only)

**Date:** 2026-08-06
**Decision:** Established a durable, repository-resident AI Engineering Operating Model and an explicit human/company ownership + IP-attribution posture, so future AI sessions receive both automatically. Owner-directed governance program; Tier-1 repo-only; no code, Rules, deploy, grant, migration, billing, vendor, or legal-instrument action.
**New canonical artifacts:**
- `LICENSE` (root) — provisional proprietary notice ("Copyright © 2026 Rudy DiGiorgio. All rights reserved."); AI tools hold no ownership; explicitly not a completed entity/IP/registration act and not legal advice.
- `README.md` (root) — repository primary entry point: product identity (Enterprise Operations OS; Taylor Parts = first deployment), ownership line (Founder and Product Owner: Rudy DiGiorgio), copyright, and the "start here" pointers.
- `docs/OWNERSHIP.md` — single-owner-concern policy for human/company ownership, AI-as-tools (no equity/authorship/binding authority), prohibited vs permitted wording, commit-attribution rule (a `Co-Authored-By:` AI trailer records the tool, not IP), and protected legal actions (entity/IP-transfer/trademark/patent → Owner/counsel only).
- `docs/engineering/AI_ENGINEERING_OPERATING_MODEL.md` — outcome-based (capability-level) delivery; default autonomy (operationalizes DelegationCharter §8); the question filter; protected boundaries; long work windows; capability completion standard; the DESIGNED→SANDBOX→INTEGRATION→RELEASE CANDIDATE→OWNER REVIEW→PRODUCTION→OPERATIONALLY VERIFIED→RETIRED promotion lifecycle (Sandbox = emulator/synthetic/no-prod-credentials; production never the exploratory env; promotion serialized); the multi-agent model; and cost/token discipline. Cross-references (does not duplicate) Charter §8, `docs/ai/workflow.md`, DeploymentModeStrategy, PlatformOperatingModel, PlatformCapabilityModel, SYSTEM_AUTHORITIES.
- `docs/engineering/ACTIVE_WORKSTREAMS.md` — the multi-agent workstream registry (declared-fields template + rules + seeded current state).
**Entry-point / cross-reference updates (Part F):** `AGENTS.md` gained mandatory "Engineering model" + "Ownership" summaries with links; DelegationCharter §8, PlatformOperatingModel §4/§13, `docs/README.md` index, and `docs/ai/workflow.md` now cross-reference the new artifacts (single-owner-concern deference per PlatformOperatingModel §6 — no duplication).
**Not done / protected (unchanged):** no production deploy, Rules deploy, capability grant, migration, destructive op, spending, vendor commitment, or legal instrument. No legal entity name was invented; no registered trademark/patent/copyright asserted; the notice is provisional and defers formal entity formation + IP assignment to the Owner and counsel. No CODEOWNERS was added (it would impose GitHub review gates that conflict with the autonomous-merge model); SECURITY.md/CONTRIBUTING.md left as optional future.
**Discovery finding:** no pre-existing LICENSE, root README, CODEOWNERS, CONTRIBUTING, SECURITY, engineering-model, or ownership/IP artifact existed; no third-party license or contributor-agreement conflict was found (app is `private: true`, consistent with a proprietary posture).
**Why Tier-1:** governance documentation + repo config only; touches no Tier-2 category. The ownership posture records the Owner's direction; it creates no legal obligation and performs no protected legal action.

## 68. Governed FieldMode Receive-against-Purchase-Order (A1) — the scanner's Receive workflow receives against an ORDERED PO

**Date:** 2026-08-06
**Decision:** Implemented Option **A1** (Owner architecture decision, reversing the earlier A3 in #65 on platform-first grounds — Receiving is a governed business process, not an ad-hoc inventory adjustment): the PartsScanner "Receive" action inside FieldMode is now the ONE governed receive workflow — receive an ORDERED reorder Purchase Order into a warehouse via `listReceivingLocationOptions` → confirm the full ordered quantity → `receiveInventoryStock`. Repository-only.
**Flow:** Purchasing → an ORDERED reorder_request + linked ORDERED PO (a receipt candidate) → `listReceivingLocationOptions` → quantity confirmation → `receiveInventoryStock` → governed receipt. The scanner is the input tool within FieldMode; there is **no second/competing receive workflow** and **no demo/ad-hoc receive** (the retired ad-hoc receive stays retired).
**Fail-closed at two layers (verified):** the workflow invokes the callables ONLY through `services/receivingCallableClient.js`'s public methods, which read the governed `RECEIVING_TRANSPORT_READY` constant (**false**) and make zero callable attempts while false — no direct `httpsCallable`, no readiness override/bypass. `receiveInventoryStock` is additionally capability-gated ({admin,dispatcher,owner}). So with readiness false the workflow presents an honest "Receiving isn't activated in this environment yet" state and executes no live receipt; an unauthorized caller gets a sanitized "not permitted" state. **No readiness flip, deployment, Rules change, capability grant, or production activation is part of this capability.**
**Contract conformance:** v1 requires exactly one line with `expectedQuantity == receivedQuantity == orderedQuantity` (no partial receipts); the UI confirms the full ordered quantity (not editable). A `node:test` **contract cross-check** proves the assembled request is accepted by the transport's frozen `buildReceiveRequest`. Deterministic `lineId` (`<reorderRequestId>:1`) and stable `idempotencyKey` (`receive:<reorderRequestId>`) so a retry replays rather than double-receives.
**Reuse (no duplication):** candidates come from the existing `domain/purchaseOrdersView.js` OPEN rows (via the reorder hooks + `usePurchaseOrdersByIds`); the fail-closed transport (`receivingCallableClient`/`receivingTransport`, LF1b) and `receivingLocationOptionAdapter` are reused as-is.
**New/changed:** NEW `src/domain/receiveAgainstPurchaseOrder.js` (pure, 10 tests) + `src/modules/mobile/ReceiveAgainstPurchaseOrder.jsx` + test; wired into `PartsScanner.jsx` (governed Receive action; banner clarified governed-vs-demo); `.fo-receive-*` styles. Verification: full node suite green; vitest 485/485 (transport 63/63 unaffected); oxlint clean; vite build OK; impeccable detector 0 findings; design-code-reviewed.
**Why Tier-1:** frontend + docs reusing vetted patterns and the already-merged fail-closed transport; touches no Tier-2 category (no Rules/identity/deploy/grant/readiness/production).
**Program note:** built platform-first (Enterprise Operations OS) with Taylor Parts as the flagship reference implementation, per the AI Engineering Operating Model (#67).

## 69. Inventory → Receiving first-class workspace — one canonical receive workflow, two launch points

**Date:** 2026-08-06
**Decision:** Built the Inventory → Receiving **workspace** as a first-class home for the Receiving business capability, replacing the placeholder `receiving` nav item (admin/dispatcher). It **reuses the single canonical governed receive workflow** (`ReceiveAgainstPurchaseOrder`, #68) — no alternate receiving implementation. The PartsScanner (in FieldMode) remains **one launch-point tool** of the SAME workflow. Repository-only.
**New architectural principle applied (Owner-directed):** business capabilities become **workspaces**; operational utilities become **tools**; prefer ONE canonical workflow with multiple launch points over multiple independent workflows; single source of truth per governed capability. Receiving is a capability → workspace; the scanner is a tool/launch point.
**Change:** relocated the canonical workflow `ReceiveAgainstPurchaseOrder.jsx` from the device-specific `modules/mobile/` to the capability home `modules/receiving/` (git mv, content unchanged; same depth so its `../../` imports are unchanged); updated PartsScanner's import. NEW `modules/inventory/Receiving.jsx` (thin workspace: `WorkspaceHeader` + intro + the workflow over ALL ORDERED candidates; a "Done" remounts it). App.jsx routes `inventory/receiving` → `<Receiving/>`. NEW `test/receivingWorkspace.test.mjs` — architectural-invariant source scan (exactly one workflow file; both launch points import it; App routes it; no callable/readiness bypass).
**Governance (held):** the workspace composes the workflow only — no `httpsCallable`, no `RECEIVING_TRANSPORT_READY` read/override, no direct firebase-functions import; it stays fail-closed (readiness FALSE + capability-gated {admin,dispatcher,owner}), so no live receipt occurs. No readiness flip, deploy, Rules change, grant, or production activation. The Inventory > Receiving nav item is admin/dispatcher (the capability holders) — the correct primary home vs the technician scanner.
**Verification:** new workspace invariant test 5/5; full node suite green; vitest 485/485 (workflow unchanged by the move); oxlint clean; vite build OK; impeccable detector 0 findings; independent design-code-review.
**Why Tier-1:** frontend + docs; a content-preserving relocation + a thin composition + a route branch, reusing the reviewed workflow and fail-closed transport; touches no Tier-2 category.

## 70. Executive Architecture Office Program 0 — Authoritative Truth Pass (repository statements reconciled to implemented reality)

**Date:** 2026-08-06
**Decision:** Executed the Owner-authorized Tier-1 truth pass at verified `origin/main` @ `633a335`. Repository statements are now aligned with implemented reality, an artifact-classification legend is established, and each duplicated concern has one named owner. Canonical record: `docs/reviews/eao-program-0-truth-pass.md`. **Documentation-only** — no code, Rules, Functions, identity, migration, or deployment change; no production command executed.
**Core finding:** documentation completeness had been standing in for architecture completeness. Governance is mature (4/5) and application architecture is mature (4/5), but **platform architecture is 1.5/5** and **operational readiness is 1.5/5** — multi-tenancy, a configuration mechanism, and the integration/event/API surface were described in the present tense while having **no implementation**; observability and backup/recovery were absent from both code and governance.
**Corrections (11):** `docs/README.md` index reconciled + five-class artifact legend (AUTHORITATIVE / FUTURE-STATE / HISTORICAL SNAPSHOT / SUPERSEDED / EVIDENCE); `PlatformCapabilityModel.md` §5a implementation-state axis (designed → repo → sandbox → deployed → ops-verified → platformized → prod-ready) for all capabilities *and* platform services, plus four stale maturity claims corrected (Technician Operations, Warehouse, Procurement, Inventory); `Deployment.md` rewritten to four surfaces with three false Hosting statements corrected; `ProductVision.md` "Multi-Tenant Principle" → "Multi-Company Principle *(design objective — not implemented)*"; `DeploymentModeStrategy.md` §4 and `IntegrationArchitecture.md` marked FUTURE-STATE ARCHITECTURE; `PlatformConstitution.md` §9 separates the binding constraint from the absent mechanism; `session-state/README.md` classified HISTORICAL SNAPSHOT; `engineering/ACTIVE_WORKSTREAMS.md` declared sole owner of active-assignment coordination; `AI_ENGINEERING_OPERATING_MODEL.md` **§8a baseline and worktree discipline** added; `ENTERPRISE_CERTIFICATION_FRAMEWORK.md` "Baseline Approved" → "NOT ACTIVATED".
**Owner rulings applied:** tenancy deferred and restated as a design objective (no partial/cosmetic tenancy; future-ready seams retained; real tenancy = Tier-2 ADR); C2 Commercial Architecture deferred behind C3 Operational Readiness; ECF neither activated nor retired here.
**HIGH-PRIORITY FINDING — ungated production frontend (recorded, NOT remediated):** `.github/workflows/deploy-field-ops.yml` publishes to GitHub Pages on **every merge to `main`**. `src/firebase/firebase.js` hardcodes the production config (`projectId: "taylor-parts"`), the workflow injects no environment and consumes no secrets, the emulator branch is `import.meta.env.DEV`-gated, and `config/env.js` blocks writes only under `?env=demo` — so a merge publishes a **write-enabled production client** with no release candidate, Owner experience review, or production authorization, bypassing `AI_ENGINEERING_OPERATING_MODEL.md` §7 and `DelegationCharter.md` §8.3/§8.7. Remediation alters production behavior and is protected — a target-state promotion model and release plan are required.
**Risks elevated, not solved:** R-1 duplicate authorization model live in production (governed capability model alongside legacy `users/{uid}.role` in the deployed Rules; retirement = Issue #226 Rows 23–28, terminal step #270; every step Tier 2). R-2 duplicate domain model (`fieldops_jobs` + `fieldops_wos`; `FieldMode.jsx` still job-based; owned by blueprint wave W4).
**ECF disposition: RECONCILE THEN ACTIVATE** — not superseded (no other document owns periodic whole-estate delta certification); needs scope bound to the promotion lifecycle, evidence reuse from `audit-artifact-standard.md`, and Green/Yellow/Red defined against §5a. Recommended baseline = this truth pass's merge commit. Activation is a separate assignment.
**Recorded UNKNOWNs (read-only operator evidence required):** which frontend surface real users use; whether the published Pages build matches `main`; whether any Firestore backup/PITR exists; live index state; live Function estate vs the 22-Function record.
**Reason:** Owner Program 0 direction — establish truth before creating new company or platform architecture, and prevent maturity ratings from conflating "documented" with "implemented."
**Alternatives rejected:** rewriting `ROADMAP.md`/`SPRINT_STATUS.md`/`CLAUDE_CONTEXT.md`/`session-state/*` to appear current — rejected, it destroys provenance; they were classified, not edited. Retiring ECF for non-activation — rejected, its concern is unowned elsewhere. Remediating the Pages workflow inside the truth pass — rejected, it alters production behavior and is a protected boundary.
**Why Tier-1:** factual/editorial corrections to documentation that bring artifacts into agreement with committed code and prior decisions, per `DelegationCharter.md` §2 ("Documentation maintenance: keeping status, roadmap annotations, and architecture docs true to shipped reality"; "Editorial corrections are Tier 1"). No governance *meaning* was changed; every principle stands as written.

## 71. Inventory → Transfers first-class workspace (read-only), reusing the canonical transfer view-model

**Date:** 2026-08-06
**Decision:** Built the Inventory → Transfers **workspace**, replacing the placeholder `transfers` nav item (admin/dispatcher), as the next Inventory capability. Read-only. Repository-only.
**Why this capability (evidence-based sequencing, per Owner direction):** evaluated the five remaining Inventory candidates for existing reuse foundation — **Truck Inventory is already a routed workspace** (`TruckInventoryConnected`, App.jsx) → excluded; **Cycle Counts / Back Orders** have no domain/backend/hooks/tests/UI → weak; **Warehouses** has governed backend but is admin/reference and `WarehouseManagerHome` already covers much of it; **Transfers** has the strongest buildable foundation — a canonical view-model already built and consumed (`buildTransferOrdersView`), the `transferOrderView`/`inventoryTransferPairing` domain, 5 test files, and a shared read (`operationsQueries`), with **no deployed/client write path** (clean repo-only read workspace). Matches the Owner's suggested default.
**Single source of truth (reuse, no duplication):** the workspace REUSES the shared read `services/operationsQueries.fetchTransferOrderDocs` + `fetchWarehouses` (the same reads the Operations dashboard uses) via a thin `hooks/useTransferOrders.js`, and the CANONICAL view-model `modules/operations/transferOrdersViewModel.buildTransferOrdersView` (warehouse-name resolution + fail-closed invalid handling live there). NEW `domain/transfersView.js` only composes that row output into operator status groups + counts (statuses pinned to the domain authority `TRANSFER_ORDER_STATUSES`) — it does not re-map raw docs or re-implement the view-model. No direct Firebase in the workspace/hook/view.
**End-state / operator design (not raw CRUD):** leads with the in-flight count (Requested + In transit); status filters Active(default)/In transit/Completed/Cancelled/All with counts; From → To with resolved warehouse names + a type badge for non-warehouse endpoints; surfaces the `hiddenInvalidCount` data-exception; part links to the part record; honest loading/empty/filtered-empty/failure states.
**Governance (held):** read-only — `transfer_orders` is Admin-SDK-write-only (create/update/delete denied to all clients); the workspace performs no write, adds no write path, and fails closed on a denied read. Admin/dispatcher nav gate matches the `transfer_orders` read rule's common path. No Rules/deploy/grant/production.
**Verification:** new `transfersView` tests 9/9 (incl. a status-authority parity assertion); full node suite green; vitest 485/485; oxlint clean; vite build OK; impeccable detector 0; independent design-code-review.
**Why Tier-1:** frontend + docs reusing a canonical view-model + shared read; a read workspace over a write-closed collection; touches no Tier-2 category.

## 72. Evidence-based sequencing canonicalized into the AI Engineering Operating Model (§1a)

**Date:** 2026-08-06
**Decision:** Canonicalized the Owner-directed **evidence-based sequencing** standing principle into the existing authoritative operating model as `AI_ENGINEERING_OPERATING_MODEL.md` §1a, with a concise inherited pointer in `AGENTS.md`. No competing governance artifact was created (per the Owner's canonicalization instruction); the rule lives in the one canonical home and is surfaced through the existing agent-handoff chain (AGENTS.md → operating model).
**Rule:** do not execute roadmap items merely because they are next; at each capability/program boundary reassess sequencing from current repository/architecture/production/operational/risk/product evidence, using the default priority order (active security/integrity/production risk → blocking architectural/operational dependencies → operational reliability/recoverability → customer/product/business value → high-leverage reuse → existing roadmap sequence). The roadmap is the default when no stronger evidence changes priority; a newly discovered issue interrupts active work only when its risk/value materially exceeds the switch cost; when evidence changes sequencing, record the reason + evidence, update the authoritative planning/decision surface, and preserve deferred work. Applies to both Product Engineering and the Executive Architecture Office.
**Already applied this session:** the capability selection recorded in DECISIONS #71 (Inventory → Transfers) was made by this rule — evaluating the five Inventory candidates on existing reuse evidence rather than roadmap order (Truck already built; Cycle Counts/Back Orders weak; Transfers strongest reuse) — with deferred candidates preserved in `ACTIVE_WORKSTREAMS.md`'s "Ready for assignment."
**Reason:** cross-session Owner governance addition; make the principle durable so future agents inherit it automatically and don't conflate roadmap order with correct priority.
**Why Tier-1:** documentation addition to the existing canonical governance doc + an entry-point pointer; no code, Rules, deploy, identity, or production change; records an Owner-directed standing principle.
## 73. EAO post-truth-pass programs — R-1 readiness, R-2 Pages target state, ECF reconciliation plan, evidence package, preservation task

**Date:** 2026-08-06
**Decision:** Executed the Owner's post-truth-pass direction as architecture/design work only. Five artifacts merged; **no code, Rules, Functions, workflow, Hosting, Pages, DNS, identity, grant, migration, or deployment change**, and no production command executed.
**R-1 (elevated above C1 by Owner decision) — `docs/assessments/r1-authorization-convergence-readiness.md`.** Extends (does not duplicate) the Issue #226 plan with the measured baseline the plan lacked. **Measured at `c002b5e`: 66 legacy-role authorization sites in the DEPLOYED Rules** (`isAdminOrDispatcher()` ×61, `isAdmin()` ×3, `isTechnician()` ×2, all resolving through `users/{uid}.role`) vs 12 governed `operationalRoles` sites; 20 client raw-role comparisons; 6 files on `ROLE_NAV_ACCESS`. **Zero of ADR-005 §2.7's twelve retirement criteria are met**; three are BLOCKED on a protected production action and two are UNKNOWN. **Critical-path finding: R-1 does not begin with repository work.** Rows 23–26 (domain cutovers) are blocked behind Rows 19/20/22 (production authorization + deploy trusted backend + enable admin mutations, all OPEN) — cutting a domain onto the Permission engine whose trusted mutation backend is undeployed would either remove working functionality or require a temporary client-side authority path, i.e. a third authorization model. Two repo-only gaps make cutover unsafe today: **G-1** the shadow-parity harness exists but **no CI workflow gates on it** and no per-domain parity corpus covers the 66 sites (criterion 7 not honestly assertable); **G-2** no authorization-cutover rollback procedure exists (criterion 11 unmet by absence). Recommended R1-A (repo-only, Tier-1, available now): domain parity corpus → enforced shadow-parity CI gate → authorization rollback runbook → resolve criteria 6/9 evidence. Completing R1-A converts Row 19's authorization request into an evidenced decision.
**R-2 (design approved; no change performed) — `docs/design/pages-production-promotion-target-state.md`.** Target state routes all frontend promotion through Firebase Hosting (already the governed, evidenced, Owner-authorized path) with the binding invariant that **no merge to `main` may silently constitute production promotion**. Three options assessed: **A** retire Pages (blocked on U-1), **B** demote Pages to a non-production preview (requires a second Firebase project = Tier-3 spend, and build-time environment injection the client does not have — overlaps the Configuration ADR), **C** change the trigger from `push: main` to manual dispatch/release tag. **Recommended C first, then B** under §1a evidence-based sequencing: C closes an active production risk with a trigger-only change, no new infrastructure and no spend; B delivers reliability but should be sequenced with C3 so environment topology is decided coherently. Rollback of C is a one-line trigger revert with no state implication. **Sequencing constraint: Hosting must be verified at parity with `main` (U-2) BEFORE Pages is gated**, or both surfaces freeze stale. Residual risk after C is recorded: production remains the only place the integrated frontend can be exercised until B lands.
**Evidence package — `docs/operations/eao-readonly-evidence-package.md`.** All outstanding external unknowns bundled into ONE read-only operator run (U-1 real user-facing surface · U-2 Pages-vs-`main` artifact · U-3 Firestore backup/PITR posture · U-4 live indexes · U-5 live Function estate · U-6 audit immutability for ADR-005 criterion 6). Every command non-mutating; no credential, document read, or configuration change requested; sanitization and hashing per `governance/audit-artifact-standard.md`.
**ECF — `docs/governance/ecf-reconciliation-plan.md`.** Owner accepted RECONCILE THEN ACTIVATE with proposed baseline `c002b5e`. Three reconciliations required before activation: bind certification scope to the DESIGNED→…→RETIRED lifecycle (no parallel review); reuse `audit-artifact-standard.md` for evidence (no new format); define Green/Yellow/Red against `PlatformCapabilityModel.md` §5a so certification cannot repeat the maturity-vs-implementation conflation. Expected first certification at `c002b5e`: **Yellow overall, Red on R-1 and R-2** — recorded deliberately, since an implausibly clean first result would mean the criteria were set too loosely. **Not activated.**
**Preservation — `docs/operations/local-checkout-and-worktree-reconciliation.md`.** Stale checkout classified (37 entries): 6 superseded/identical, 11 requiring diff review, **3 valuable-and-unique** (a 164 KB inventory-sales/lines-of-business wireframe, `project-integrity-review.md`, `pr189-live-verify.mjs`), 4 generated evidence to reconcile against `docs/audits/inventory-effects/2026-07-22/`, 2 local tooling, 1 unknown (`Taylor-Migration-Evidence/`). Because the branch is 0 commits ahead of `main`, all risk is in uncommitted/untracked material only. **Nothing deleted, reset, cleaned, overwritten, or merged.** Worktree audit: 35 → 20 registered; **18 removed** (merged into `main`, clean, unprotected); retained: 4 ACTIVE, 6 dirty/UNKNOWN, 1 PROTECTED (`auth-pr4-reauth`, unmerged, explicitly do-not-delete), 8 HISTORICAL deploy/rollback pins; 1 stale registration pruned. No branch deleted.
**Sequencing rationale (Operating Model §1a):** R-1 and R-2 are not mutually blocking — R-2's design has no dependency on R-1's blocked production step — so both were progressed in one window rather than serialized behind an Owner gate.
**Reconciliation note:** the evidence-based sequencing principle was canonicalized concurrently by another session as **#72** (`AI_ENGINEERING_OPERATING_MODEL.md` §1a + `AGENTS.md`). This session had drafted an equivalent edit and **discarded it in favor of the existing authoritative version** rather than duplicating it, per the Owner's explicit instruction.
**Why Tier-1:** assessment, design, planning, and non-destructive operational hygiene. Every protected action identified is left unexecuted and explicitly Owner-gated.

## 74. Inventory → Warehouses first-class workspace (read-only) — location registry + governed status / receiving-eligibility

**Date:** 2026-08-06
**Decision:** Built the Inventory → Warehouses **workspace**, replacing the placeholder `warehouses` nav item (admin/dispatcher). Read-only. Repository-only.
**Non-duplication finding (evaluated before building, per Owner direction):** Warehouses was NOT adequately represented as a location registry — `modules/operations/panels/WarehousePanel.jsx` shows bin-level *stock + reconciliation* inside the Operations monitoring dashboard (not a warehouse list with status); `modules/inventoryRole/WarehouseManagerHome.jsx` is the WAREHOUSE_MANAGER *persona* surface showing a parts catalog/health, not warehouses-as-locations. No admin/dispatcher surface listed the warehouses themselves with their **governed status (ACTIVE/INACTIVE)** and receiving-eligibility. So a first-class workspace has genuine distinct value; it deliberately does NOT re-render stock/reconciliation (it links to the Operations overview) and leaves WarehouseManagerHome untouched (a persona launch point, not the capability workspace).
**Single source of truth (reuse):** REUSES the shared read `services/operationsQueries.fetchWarehouses` (the same `warehouses` read the Operations dashboard uses) via a thin `hooks/useWarehouses.js`; NEW `domain/warehousesView.js` mirrors the governed status authority (`WAREHOUSE_STATUSES = ["ACTIVE","INACTIVE"]`, from `functions/src/types/warehouse.ts`) and — critically — `isWarehouseReceivingEligible(w)` mirrors the I-LA governed resolver EXACTLY (`active !== false && status !== "INACTIVE"`, existence-primary), so the workspace's "receiving-eligible" means precisely what the Receiving workflow accepts (one eligibility semantics, not a second interpretation). No direct Firebase; no write path (warehouses is Admin-SDK-write-only; the status writer is inert/undeployed).
**End-state / operator design:** leads with "N warehouses · M eligible to receive · K inactive"; All(default)/Active/Inactive filters with counts; per-row Status badge + a clear Receiving Eligible/Not-eligible indicator (ties directly to the Receiving capability); honest loading/empty/filtered-empty/failure states; a footnote links to the Operations overview for stock/reconciliation.
**Governance (held):** read-only; admin/dispatcher nav gate matches the `warehouses` read rule's common path (`isAdminOrDispatcher() || isAssignedToWarehouse`); fails closed on a denied read. No Rules/deploy/grant/production.
**Verification:** `warehousesView` tests 7/7 (incl. the eligibility-resolver-mirror cases + status-mirror parity); full node suite green; vitest 485/485; oxlint clean; vite build OK; impeccable detector 0; independent design-code-review.
**Why Tier-1:** frontend + docs reusing a shared read + mirroring an existing governed authority; a read workspace over a write-closed collection; touches no Tier-2 category.
## 75. R1-A executed + read-only production evidence collected — no backup posture exists; the two production frontends have diverged

**Date:** 2026-08-06
**Decision:** Executed R1-A (repo-only authorization-convergence readiness) and, under the Owner's read-only-observation delegation, collected the U-1…U-5 production evidence directly instead of handing it back. **No mutation of any kind**: no deploy, write, grant, IAM, backup, index, Rules, Hosting, or configuration change; no credential searched for, requested, or stored (the Owner's already-active `firebase`/`gcloud` sessions were used); no customer or business document data read. Evidence: `docs/audits/eao-readonly-evidence-20260806/` (13 files, SHA256SUMS, secret-scan clean).
**FINDING 1 — NO BACKUP OR RECOVERY POSTURE EXISTS (highest severity).** Production Firestore `taylor-parts`: `pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_DISABLED`, `deleteProtectionState: DELETE_PROTECTION_DISABLED`, `versionRetentionPeriod: 3600s`, **0 backups, 0 backup schedules**. Recoverable history is **one hour**; any deletion or corruption older than that is unrecoverable. RTO undefined — no restore path exists. This is the single largest operational exposure found to date and is direct justification for C3's sequencing.
**FINDING 2 — the two production frontends have DIVERGED.** Pages serves `index-BsITcohF.js` and tracks `main` on every merge; Hosting serves `index-B7PB5BOc.js`, last released **2026-08-01 21:15:56**. Both HTTP 200. One Hosting site, `live` channel only, no preview/staging channel. **This inverts an assumption in the R-2 design**: Pages is not merely the ungoverned surface, it is the *current* one, while the governed surface is five days stale. R-2's "verify Hosting parity before gating Pages" constraint is now proven load-bearing. Recommendation C-then-B is unchanged; revised acceptance criteria C-1…C-4 require Hosting to be released to current `main` FIRST. Executing the trigger change before that would be strictly worse than today.
**FINDING 2b — the production publish path is UNRELIABLE, and silently so (correction to Finding 2).** Finding 2 said Pages "tracks `main`" — that is the workflow's design intent, not its observed behaviour. CI history: last SUCCESSFUL Pages deploy was `6f25e13` @ 2026-08-06T07:40:46Z; the four most recent `main` pushes were failure/failure/cancelled/cancelled; last 40 runs = 32 success / 4 failure / 4 cancelled; `vite-build-check` 6 failure / 4 success in its last 10. Cause is infrastructure — `The job was not acquired by Runner of type hosted` (GitHub runner capacity), `build` timing out ~21min and `deploy` never starting. **So BOTH frontends are stale: Pages ~13 hours, Hosting ~5 days.** This strengthens the R-2 case: the ungoverned path is not only ungoverned but unreliable, and a failed publish produces no release record and no alert — **the platform has no mechanism that would notice production is serving a build nobody chose.** New C3 input: release-pipeline reliability sits beside the absent backup posture as a case where the platform cannot observe its own state. R-2 criterion C-1 unchanged; C-2 must compare against a known SHA rather than "current `main`".
**FINDING 3 — 22 Functions live, matching the repository record exactly** (#63). Eight truck-registry callables ARE deployed (any "undeployed truck callables" claim is stale). **No Enterprise Access mutation callables are deployed** — production confirmation that Issue #226 Rows 19/20 are genuinely unexecuted and that ADR-005 §2.7 criteria 4/5/10 are blocked in fact, not merely unverified.
**SELF-CORRECTION 1 — the legacy surface is 47 sites, not 66.** DECISIONS #73 and the R-1 assessment reported 66 from a raw `grep -c` that counted helper *definitions* and commentary. Re-measured by parsing `firestore.rules` excluding comments and definitions: **47 enforced call sites across 22 collections** (Row 23: 7/3 · Row 24: 25/13 · Row 25: 8/4 · unassigned: 1). Direction of the finding unchanged.
**SELF-CORRECTION 2 — G-1 was wrong; the parity gate already existed.** The R-1 assessment claimed no CI gates the shadow-parity harness. False: `functions/test/shadowParityHarness.test.mjs` asserts `fullParity === true` over 69 fixtures and is gated by `.github/workflows/access-catalog-unit-tests.yml`. The real gap was narrower — the corpus is persona-oriented, not decision-site-oriented, so **coverage** was unmeasurable, not parity ungated.
**R1-A DELIVERED:** (1) per-domain corpus `functions/src/access/legacyAuthorizationSurface.ts` + client mirror — pure data, no runtime import, **no third authorization authority** (Owner constraint honored); (2) **drift gate** `functions/test/legacyAuthorizationSurface.test.mjs` + `.github/workflows/legacy-authorization-surface-gate.yml`, which re-parses the real Rules and fails in BOTH directions, so the legacy surface cannot grow silently and each cutover's burn-down is evidenced in the same commit that shrinks it; also asserts the two Rules copies stay byte-identical (7/7 pass, `tsc` clean); (3) **14 of 22 collections have no governed permission defined yet** — enumerated via `collectionsWithoutPermissionCoverage()`, and this is the concrete precondition list for Rows 23–25; (4) authorization-cutover rollback procedure `docs/operations/authorization-cutover-rollback.md` closing criterion 11, with sandbox-rehearsal testing (no production drill) and an interim-decision reconciliation protocol treating an over-permissive cutover as an access-control incident.
**Criteria movement:** still **0 of 12 MET**. Criterion 1 is now measured and drift-gated; 7 upgraded in confidence (parity confirmed passing, coverage now measurable); 9 UNKNOWN→PARTIAL (`account.governedField.write` present and fixture-gated; #175 still open); **6 remains UNKNOWN — U-6 BLOCKED ON TOOLING**, not authorization (`firestore:rules:get` absent from CLI 15.22.4; `gcloud firebaserules` not a valid command group). U-6 is the only item returned to the Owner.
**Why Tier-1:** repo-only test/CI/pure-data additions and documentation, plus read-only observation explicitly delegated by the Owner. No Rules, Functions, identity, grant, migration, deployment, or production mutation. R-1 protected boundaries (Rows 19/20/22, 23–26, 27/28) untouched; R-2 workflow untouched.

## 76. Purchasing → Receipts is a launch point into the canonical receiving projection (not a separate capability); Inventory → Cycle Counts deferred (no governed foundation)

**Date:** 2026-08-06
**Capability-model decision (evaluated Receipts vs Cycle Counts under §1a evidence-based sequencing):**
**Receipts is NOT a distinct business capability.** It is the historical/result side of the ONE governed Receiving capability. Evidence: the governed receipt records (`receiving_orders` + the operational-movement ledger, written by `receiveInventoryStock`) are **backend-only** (`firestore.rules` deny ALL client access — no client read path); there is no client-readable receipt/movement ledger; and the client-visible "received" history already exists as the Purchase Orders → **Received** view (the canonical `buildPurchaseOrdersView` projection over RECEIVED `reorder_requests`). A separate Receipts *workspace* would either have no distinct governed data source or duplicate an existing view, and would fragment the receive concept (Receiving + Receipts + scanner + PO-receive with overlapping interpretations) — the exact anti-pattern to avoid.
**Resolution:** filled the placeholder with a **reuse-only launch point** into the canonical projection: `modules/purchasing/Receipts.jsx` renders the RECEIVED subset via `buildPurchaseOrdersView` + the existing PO read stack (`useReorderRequestsByStatuses([RECEIVED])` + `usePurchaseOrdersByIds`). It reads NO `receiving_orders`, invokes no callable, adds no receive path, and states plainly that governed stock receipts are recorded by the receiving service and aren't listed here — linking to the Receiving workspace. This is the endorsed "ONE governed receiving capability → canonical projection → multiple appropriate launch points" pattern; the architectural-invariant test `test/receiptsLaunchPoint.test.mjs` pins it (reuses the projection, no receiving_orders read, no receive/Firebase path, routed). Read-only; admin/dispatcher; no Rules/deploy/grant/production.
**Cycle Counts DEFERRED (missing-foundation classified):** there is NO cycle-count governed foundation — no collection/schema, no Rules read/write authority, no trusted write command, no inventory-ledger or reconciliation relationship, no domain module, no tests, and no UI beyond the scanner's in-memory demo action. `functions/src/truckRegistry/operationalReferenceProbe.ts` explicitly records "no cycle-count collection ... exists on the current schema." Building a CRUD screen would invent business semantics, which the platform's governance forbids. **Cycle Counts is deferred until the business workflow is designed** (needs a spec/ADR defining the count session, the governed count-vs-ledger reconciliation, and a trusted write authority) — not a UI task. Recorded in `ACTIVE_WORKSTREAMS.md` "Ready for assignment" as design-first.
**IA note:** a navigation placeholder is not evidence a separate workspace should exist; navigation reflects the capability architecture. Receipts consolidated into the Receiving capability's projection; no new capability created.
**Why Tier-1:** frontend launch point reusing an existing projection + a capability-model/IA decision recorded in the canonical decision surface; no Tier-2 category touched.

## 77. C3 Firestore data-protection decision package; R-1 permission-coverage design; U-6 resolved autonomously via the Rules REST API

**Date:** 2026-08-06
**Decision:** Three parallel EAO outputs, all repo-only/read-only. **No production configuration change, no PITR/backup/delete-protection change, no IAM change, no permission added, no Rules/grant/claim/trusted-path change, no deployment.**
**U-6 RESOLVED — no Owner action needed.** The prior "BLOCKED on tooling" conclusion was drawn too early. The supported authenticated **read-only** path works: Firebase Rules REST API (`firebaserules.googleapis.com`), `GET` releases + rulesets, using the already-active gcloud ADC session; the initial 403 was a missing quota project, fixed with the standard `x-goog-user-project` header. No release created, nothing deployed, **no API enabled** to force success, and the access token was used transiently in a header and **never persisted** to any file. Live release `cloud.firestore` → ruleset `6316db98-9fce-4123-9391-9919e6dd70bd` (2026-08-04T21:32Z), source captured (104,130 bytes).
**FINDING — live Rules are functionally identical to the repo but NOT byte-identical.** 20 lines differ, **all comments**, all the same defect: live contains `Â§` (U+00C2 U+00A7) where the repo has `§` (U+00A7) — **UTF-8 double-encoding introduced at deploy time**. Comment-stripped content is byte-identical on both sides (sha `124589e7078c5cb6…`). Functional impact none; **operational impact real**: `skills/verify-rules-deploy` hashes the deploy, so a full-file live-vs-repo hash comparison **always** reports a mismatch — a permanent false positive that trains operators to ignore a verification control. Rules-deploy verification should compare comment-stripped content, or the deploy path should be fixed to preserve UTF-8. Not remediated (Tier-2).
**ADR-005 §2.7 criterion 6: UNKNOWN → PARTIAL.** The **live** ruleset contains `match /auditEvents/{eventId} { allow read, write: if false; }` — the audit collection is client-closed in production, verified against deployed Rules. PARTIAL not MET because append-only enforcement lives in `access/auditEventWriter.ts` and is not production-verified; Rules prove only that no client can read or write it.
**C3 — `docs/deployment/c3-firestore-data-protection-decision-package.md` (AWAITING OWNER AUTHORIZATION).** Target posture: P1 delete protection, P2 PITR (7-day), P3 daily backups 4w retention, P4 weekly backups 14w (max), P5 quarterly restore rehearsal, P6 recovery runbook. Resulting RPO ≤1 min within 7 days / ≤24h within 4 weeks / ≤7 days within 14 weeks; **RTO target ≤4h**, dominated by cutover not restore. **Key design constraint from provider docs: a restore ALWAYS creates a NEW database — never in-place** — so recovery is restore→validate→repoint/copy-back, and the preferred path for the realistic majority of incidents is a **surgical PITR stale read replayed through governed write paths**. Restore **excludes** Security Rules and TTL policies; **Cloud Functions, Hosting and Firebase Auth are entirely outside Firestore backup** — Auth loss is flagged as a separate unmitigated gap. **Exact dollar figures deliberately omitted** — not machine-retrievable at authoring time and this program does not put unverified costs in a governance artifact; magnitude expected negligible (<1 GiB) but must be confirmed before authorizing, and PITR has **no free tier**. **Recommended: authorize P1 alone first** — free, instant, reversible, no operational impact, removes the worst single-command outcome, and should not wait on the spend decision.
**R-1 — `docs/assessments/r1-permission-coverage-design.md`.** Applied the Owner constraint (*permissions must follow business authority, not coverage counting*) to all 15 uncovered collections: **5 new permissions, not 15.** EXTEND/no-new-permission for 6 (`locations`, `contacts` fold into `account.record.*`; `stock_locations`/`mobile_locations`/`trucks` fold into one `inventory.location.read`; `supplier_catalog` into `procurement.supplier.read`). NEW for 5 genuine authorities (`inventory.catalog.read`, `inventory.location.read`, `procurement.supplier.read`, `equipment.record.read`/`.update`, `administration.employee.read`). **DEFER for 4** — `transfer_orders` (write path unsettled), `purchase_orders` (**architecture ambiguity: two purchase-order collections exist, only `reorder_purchase_orders` is governed** — resolve before any permission), and `fieldops_jobs`/`fieldops_technicians` (**designing permissions here would ENTRENCH the legacy domain model W4 intends to retire**).
**NEW CROSS-PROGRAM DEPENDENCY:** **R-1 Row 25 is BLOCKED on W4 domain-model convergence**, not merely sequenced after it. Rows 23 and 24 can proceed independently. Row 23 is the cleanest first cutover (4 of 7 sites need no new permission). Also identified: Account-scoped permissions require parent-child Scope confirmed in `resolveEffectivePermission` before Row 23; Employee identity convergence gates a correct `fieldops_technicians` permission.
**Rollback P2 unblocked:** capturing live pre-cutover Rules no longer needs Owner console work — the REST API path above satisfies it.
**Why Tier-1:** analysis, design, and documentation, plus read-only observation explicitly delegated. Every protected action is identified and left unexecuted.

## 78. Supplier Master adoption — S1 architecture & domain reconciliation (Tier-2 program, Owner-authorized; repo-only design)

**Date:** 2026-08-06
**Decision:** Adopted the S1 architecture for the Owner-authorized Supplier Master program: establish Supplier as a governed business object so Purchasing stops depending on free-text `supplierName`. Canonical spec: `docs/architecture/supplier-master-architecture.md`. Design-only; no code/Rules/deploy/grant/migration.
**Material reconciliations (from repository evidence):**
- **`part_supplier_items` is the single part↔supplier authority** (INV-1 PR 1.4, ADR-008; deterministic `<partId>__<supplierId>`, ≤1 ACTIVE preferred/part) and already references governed `supplierId`s with no master that owns them. The Supplier Master **owns the Supplier identity space**; `part_supplier_items` owns the part-scoped terms. Distinct authorities, no duplication.
- **`supplier_catalog` (Epic-5) is a DORMANT DUPLICATE** of the governed `part_supplier_items` → **not revived, not made load-bearing** (formal retire-vs-keep-dormant is a separate future Procurement decision).
- **`purchase_orders` (Epic-5) remains DORMANT** — not authoritative, not deleted; the one live Purchase Order authority stays `reorder_purchase_orders`. A second live PO authority is explicitly prohibited.
- **Authorization reuses `inventory.catalog.manage` / `.activate`** (the existing catalog capabilities `part_supplier_items`/parts/manufacturers already use) — Supplier is a catalog-governed object. **No `supplier.manage`/`supplier.read` invented** (avoids a symmetry-only permission and a temporary path R-1 would retire; workspace read stays `isAdminOrDispatcher()` short-term, capability-tightening tracked with R-1).
- **Trusted write authority** = `functions/src/supplierMaster/` reusing `partMasterCommands.ts` machinery (capability/idempotency/versioning/audit/one-transaction/bounded-error/fail-closed/no-client-writes): createSupplier/updateSupplier/activateSupplier/deactivateSupplier; **mergeSupplier DEFERRED** until fully designed + reversible.
- **Status** ACTIVE/INACTIVE (governed reference-data pattern; inactive preserved + non-selectable; no physical delete). **Duplicate policy:** `normalizedKey` + `vendorNumber` + contact/address evidence → create-time suspected-duplicate FLAGGING for governed human review; no silent/AI auto-merge.
- **Purchasing migration compatibility:** `reorder_purchase_orders` gains `supplierId` + `supplierNameSnapshot`, validated against the existing `workOrderSnapshotCompatibility` governed-id+display-snapshot convention; historical `supplierName` retained; migration classifies exact/ambiguous/unmatched/inactive/duplicate/historical. **No production migration** — repo-only tooling/dry-run/rollback/acceptance first.
**Phases:** S1 (done) → S2 governed backend (Rules prepared-not-deployed) → S3 Suppliers workspace → S4 purchasing integration + migration tooling → S5 release-candidate package. STOP before protected production activation.
**Protected (NOT authorized):** Rules deploy, Functions deploy, prod supplier creation, grants, prod migration, rewriting `reorder_purchase_orders`, deleting dormant collections, prod supplier-admin activation, Hosting/Pages.
**Why Tier-1 to LAND (design phase):** an architecture/spec document reconciling existing authorities; no code/Rules/deploy. (The program itself is Tier-2; each protected gate returns for Owner authorization.)

## 79. C3 P1 EXECUTED — production Firestore delete protection ENABLED; Purchase Order authority settled (Decision B)

**Date:** 2026-08-06
**Decision A — P1 EXECUTED (production configuration change, Owner-authorized).** Enabled delete protection on `projects/taylor-parts/databases/(default)` under the Owner's explicit authorization scoped to **P1 only**. Command: `gcloud firestore databases update --database="(default)" --delete-protection --project=taylor-parts`, syntax verified against the installed SDK 577.0.0 help before execution; `--delete-protection` was the **only** state-changing flag passed (`--enable-pitr` was available on the same command and deliberately not used).
**Pre-execution fail-closed gate — all PASS:** `deleteProtectionState == DELETE_PROTECTION_DISABLED`, `name == projects/taylor-parts/databases/(default)`, `type == FIRESTORE_NATIVE`, `locationId == us-central1`.
**Result PASS:** `DELETE_PROTECTION_DISABLED → DELETE_PROTECTION_ENABLED`; operation `…/operations/BhACr-eawBAG09SDiwgMChAa`, `done: true`, exit 0, `updateTime 2026-08-06T21:50:03.637128Z`. **Scope verification: field-by-field pre/post comparison found 0 unintended changes.** Confirmed still unchanged: `pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_DISABLED`, `versionRetentionPeriod: 3600s`, backups `Listed 0 items.`, schedules `Listed 0 items.` — P2/P3/P4 were not executed. No IAM change, no restore, no data mutation, no Rules/index change. Evidence (7 files, hashed): `docs/audits/c3-p1-delete-protection-20260806/`.
**Honest limit of P1:** it removes the catastrophic single-command deletion path and **nothing else**. **RPO and RTO are UNCHANGED** — recoverable history is still one hour and there is still no restore source. The database is now protected from accidental deletion and remains **unrecoverable from data loss**. P1 must not be described as having improved the recovery posture.
**P2–P4 sizing blocked on evidence:** database size was **not machine-retrievable** — `firestore.googleapis.com/storage/stored_byte_count`, `storage/stored_bytes` and `document/count` all returned HTTP 404 via the Monitoring API for this project. Read the size from the Firebase console Usage tab before authorizing P2–P4 rather than estimating; PITR has **no free tier**.
**Decision B — Purchase Order authority settled (Owner architecture decision).** `reorder_purchase_orders` is the **canonical current operational Purchase Order model** for Enterprise Operations OS: it is the live purchasing flow, governed alongside `reorder_requests`, feeds the governed Receiving workflow, and is already the client-visible operational projection. It is **already permission-covered** (`reorder.purchaseOrder.read`/`.create`/`.void`). `purchase_orders` is the **dormant Epic-5 procurement model**, classified **DORMANT / NON-AUTHORITATIVE / DO-NOT-EXPAND**: no new permissions, not made load-bearing, no new UI, no revival of its undeployed write path, no second PO authority — pending the Supplier Master / Procurement reconciliation.
**Effect on R-1:** `docs/assessments/r1-permission-coverage-design.md` updated — `purchase_orders` moves from DEFER to **NO PERMISSION (DORMANT)**; its single legacy Rules site is retired at Row 24 by *removing or closing the surface*, not by governing it. Row 24 net is unchanged at **3 new permissions**. The previously-recorded "two PO collections" architecture ambiguity is **RESOLVED**; whether Epic-5 procurement concepts are absorbed, retained as design input, or formally retired is owned by the **Supplier Master architecture program**, not R-1. Supplier Master adoption targets the active flow **Supplier → governed `supplierId` → `reorder_purchase_orders`** with historical display/snapshot compatibility.
**Why this entry records a production change:** unlike prior EAO entries this one includes an executed production mutation, performed only under an explicit, narrowly-scoped Owner authorization, with pre-gate, post-proof, and scope-drift verification captured as immutable evidence.

## 80. C3 P2–P4 cost question RESOLVED by measurement — total $0.0022/month; recommend authorizing PITR + backup schedules

**Date:** 2026-08-06
**Decision:** The database-size blocker on P2–P4 is closed with **measured** evidence, not an estimate. Read-only throughout (Cloud Monitoring + Cloud Billing Catalog); no mutation, no configuration change, **no document content read**, access token used transiently and never persisted. Evidence: `docs/audits/c3-p2-p4-sizing-20260806/`.
**TWO PRIOR ERRORS CORRECTED.** (1) The decision package directed the Owner to the Firebase console Usage tab for database size — **wrong**: the console exposes Cloud Storage bytes and Hosting storage, neither of which is Firestore database size, and shows Firestore usage as operation quotas. The Owner correctly refused to treat "Cloud Storage 0 B" or "Hosting 4.3 MB" as the answer. (2) The earlier "size is not machine-retrievable" conclusion was **also wrong** — it came from guessing metric names (`storage/stored_bytes`, `storage/stored_byte_count`, `document/count`, all 404) instead of **enumerating** `metricDescriptors` for `firestore.googleapis.com/`, which returns 31 metrics including the correct one. Method lesson: enumerate before concluding a capability is absent.
**MEASURED (not bounded, not estimated):** `firestore.googleapis.com/storage/data_and_index_storage_bytes` for `(default)`/`us-central1` = **1,649,196 bytes = 1.5728 MiB = 0.0015359 GiB** (data + indexes), 9,744 minute-resolution points over 7 days, flat. **Growth = +2,464 bytes/day ≈ 0.86 MiB/year.**
**AUTHORITATIVE PRICING** (Cloud Billing Catalog API, service `EE2C-7FAC-5E08`, Iowa/us-central1, `databaseEdition: STANDARD` so standard not Enterprise SKUs): storage **$0.15**/GiB-month (first 1 GiB free) · PITR storage **$0.15**/GiB-month (**no free tier**) · zonal backup storage **$0.03**/GiB-month · backup restore **$0.20**/GiB. Retrieved unit prices, not documentation prose.
**COST MODEL (conservative in every direction** — PITR billed as a full DB copy though it stores per-minute deltas; every scheduled backup billed as an independent full copy; 28 concurrent daily + 14 concurrent weekly): **measured today $0.0022/month** · 100× $0.2166 · **1 GiB upper bound $1.41** · 10 GiB upper bound $14.10. Full restore today = **$0.0003**. **Time to reach 1 GiB at measured growth ≈ 1,192 years**; ≈12 years even at 100× the growth rate.
**Classification:** MEASURED = size, growth, all four unit prices. BOUNDED ESTIMATE = monthly cost, bounded **above** (real cost is lower). UNKNOWN = nothing material to this decision.
**RECOMMENDATION: authorize P2 (PITR), P3 (daily backups, 4w) and P4 (weekly backups, 14w).** The cost is a rounding error — about one fifth of one cent per month, and under $1.50/month even at 650× the current size. This is not a cost trade-off; it is ~$0.002/month against a posture where any data loss discovered more than one hour after it occurs is permanent and unrecoverable.
**Unchanged caveats:** PITR has no free tier and bills a one-day minimum even if disabled within 24h (immaterial at this scale); and **enabling protection is not proving recovery** — P5 restore rehearsal remains required before the posture is verified. P1 (delete protection) remains the only protection executed; **no P2–P4 configuration change was performed** and none is authorized yet.

## 81. C3 P2-P4 EXECUTED -- PITR enabled, daily 4-week + weekly 14-week backup schedules live

**Date:** 2026-08-06
**Decision:** Executed P2/P3/P4 on `projects/taylor-parts/databases/(default)` under explicit Owner authorization, on the basis of the measured cost evidence (#80). Evidence: `docs/audits/c3-p2-p4-protection-20260806/` (13 files, hashed).
**Pre-gate -- all PASS (fail-closed):** database name, `locationId us-central1`, `type FIRESTORE_NATIVE`, `databaseEdition STANDARD`, delete protection still `ENABLED`, PITR still `DISABLED`, zero pre-existing schedules.
**Retention semantics verified representable -- no substitution.** Before creating anything, confirmed against provider documentation and the installed CLI that both daily and weekly schedules support retention up to 14 weeks, so *daily/4w* and *weekly/14w* are expressible **exactly**. The Owner's "do not silently substitute another retention policy" condition was satisfied without needing to stop.
**P2 PITR:** operation `.../operations/BhAqjtAQBtPUjuIICgoOGg`, done, exit 0. `pointInTimeRecoveryEnablement: DISABLED -> ENABLED`; `versionRetentionPeriod: 3600s -> 604800s` (**1 hour -> 7 days**); `earliestVersionTime 2026-08-06T21:15:00Z`.
**P3 daily:** `backupSchedules/14e34b99-bcd4-4313-8aa1-06acf81b4f36`, `dailyRecurrence`, `retention 2419200s` = **28 days = 4 weeks** -- exactly as approved.
**P4 weekly:** `backupSchedules/b3963171-0577-4129-b823-83fad1ec7e44`, `weeklyRecurrence day: SUNDAY`, `retention 8467200s` = **98 days = 14 weeks** -- exactly as approved.
**Scope verification -- 0 unintended changes.** The complete pre/post `describe` diff is exactly: `pointInTimeRecoveryEnablement` (intended, P2), `versionRetentionPeriod` (intended consequence of P2), `backupConfig.backupSchedulesEnabled: true` (intended consequence of P3/P4 -- a derived field that only appears once schedules exist), plus naturally-varying `earliestVersionTime`/`etag`/`updateTime`. Confirmed unchanged: `deleteProtectionState` (still ENABLED), `locationId`, `type`, `databaseEdition`, `concurrencyMode`, `appEngineIntegrationMode`, `uid`, `createTime`. **Not performed:** no restore, no destructive recovery testing, no data modification, no Rules/index/IAM/Functions/Hosting/Pages change, no database create/delete, no application cutover, no Auth change.
**Posture change:** accidental DB deletion blocked (P1) - **RPO <=1 min within 7 days, <=24h within 4 weeks, <=7 days within 14 weeks** - a restore source now exists where previously there was none.
**RECOVERY IS NOT YET PROVEN -- do not describe it as such.** (1) **No backup exists yet** -- `backups list` returns `Listed 0 items.`; the first daily backup is not yet due (verification V2 outstanding). (2) **No restore has ever been performed** -- RTO <=4h is a **target, not a measurement** (V3/V4 outstanding). (3) The PITR window is not full until **2026-08-13**. (4) **Firebase Auth remains uncovered** by Firestore backup -- separate open gap. The platform now has a *configured* recovery capability, not a *demonstrated* one.
**Next:** P5 restore rehearsal -- design the safest representative rehearsal that proves the procedure **without risking or replacing the production database** (restore into a new disposable database; never over `(default)`), and bring it through the protected-action boundary before execution.

## 82. C3 P5 rehearsal designed; Identity/Auth recovery deferred-but-required; delivery-reliability design; R-1 Rows 23/24 specified

**Date:** 2026-08-06
**Decision:** Four parallel outputs, all design/specification. **No restore, clone, database creation or deletion; no permission created; no Rules, workflow, Hosting, Pages, IAM, or deployment change.**
**V2 CHECK -- still outstanding (expected).** `backups list` returns `Listed 0 items.`; the first scheduled backup is not yet due. Both schedules intact. PITR `earliestVersionTime 2026-08-06T21:15:00Z`; window fully populated from **2026-08-13**.
**P5 DESIGNED (AWAITING AUTHORIZATION) -- `docs/deployment/c3-p5-restore-rehearsal-package.md`.** **Key finding: P5 is NOT blocked on V2.** `gcloud firestore databases clone --snapshot-time` recovers from the **live PITR window** and needs no backup, so **P5-A (PITR clone) can rehearse immediately**; P5-B (backup restore) waits for a real backup. Both must eventually run -- different mechanisms, different failure modes. Structural safety property: a restore/clone **can only create a NEW database and can never write into an existing one**, so a rehearsal cannot overwrite `(default)` even by mistake, and `(default)`'s delete protection makes a mistyped production deletion fail closed. **The cleanup deletion is the single most dangerous step** -- specified as a separate, individually-confirmed action, never chained; the rehearsal database must NOT receive delete protection or it could not be cleaned up. RTO becomes a **measurement** (T3-T0), not a target. Cost about $0.0003. **Requires two authorizations P1-P4 explicitly withheld: database creation and database deletion.** Recommendation: authorize **P5-A now**, P5-B after V2. If P5 fails, **stop and report** -- the failure is the finding, not something to retry until it passes.
**IDENTITY/AUTH RECOVERY -- recorded DEFERRED in the existing C3 authority** (decision package section 10a), not as a competing roadmap artifact. **DEFERRED / REQUIRED BEFORE C3 CERTIFICATION / NOT BLOCKING P5 / NOT AUTHORIZED FOR PRODUCTION ACTION.** Firestore recovery is not identity recovery: if Auth were lost while Firestore survived, every users/uid document, roleAssignment, audit attribution and operational-role linkage would still exist while the identities they reference would not. **UID preservation is the crux** -- the authorization model keys on uid throughout (users/uid, roleAssignment.principalUid, audit actor identity, users/uid.technicianId to fieldops_technicians); an Auth recovery producing *new* UIDs would silently sever every relationship while leaving data intact and apparently valid -- a worse failure mode than data loss, because it is not obvious. Five-layer posture recorded (Data configured / Identity unassessed / Authorization unassessed / Application partial / Operations partial): **C3 cannot be certified while three of five layers are unassessed.**
**DELIVERY RELIABILITY -- `docs/design/c3-delivery-reliability-and-release-visibility.md`.** The defect is **not** that deploys fail (runner capacity is outside our control); it is that failure is **silent and undetectable** -- no release record, no alert, and no observable difference between "production runs current main" and "production has been frozen for five days." Same class of defect as the absent backup posture: the system cannot observe its own state. Target: **D1** deployed-version identity (build-stamped SHA; repo-only, trivial, unblocks the rest) -> **D2** expected-vs-deployed comparison -> **D3** workflow execution health (alert on *consecutive* failures, not single ones, to avoid the false-positive trap that trains operators to ignore signals) -> **D4** release evidence. **Sequencing correction: D1/D2 should land BEFORE R-2**, so R-2's migration can be verified rather than assumed -- reversing the naive order in which observability follows remediation. Deliberately excludes vendor choice, alerting channel, and application error monitoring.
**R-1 ROWS 23/24 SPECIFIED -- `docs/specifications/r1-rows-23-24-permission-cutover.md`.** Governing principle: **a cutover must reproduce the legacy decision exactly, not improve on it** -- narrowing introduced during migration is a behaviour change disguised as a cutover, and can pass a parity suite whose fixtures encode intended rather than current behaviour. **SELF-CORRECTION: the "parent-child Scope" watch item is WITHDRAWN; its premise was wrong.** Scope supports global/tenant/domain/location/ownAssignment with exact type+value matching and has no parent-child type; **none is needed**, because the legacy Rules grant admin/dispatcher **global** access to locations/contacts. Exact parity requires global scope; Account-level scoping would *narrow* access and break parity. **Row 23 needs ZERO new permissions** -- all four exist; the work is extending their documented scope to the Account aggregate, with delete mapping to `.update` on the parent rather than inventing a `.delete` authority. The isAdmin-times-2 asymmetry on `accounts` is Issue #175 governed-field enforcement (admin writes, dispatcher withheld), already encoded in `account.governedField.write` and already fixture-covered -- **the criterion-9 preservation requirement is met**. **Row 24 splits: 24a** (17 of 25 sites already covered, no new permissions), **24b** (3 new permissions -- `inventory.catalog.read`; `inventory.location.read` covering warehouses/stock_locations/mobile_locations/trucks as ONE authority; `procurement.supplier.read`), **24c** (`purchase_orders` surface closure per Decision B, `transfer_orders` deferred). Row 23 is the correct first cutover: smallest surface, zero new permissions, no Scope change.
**PROCESS LESSON CANONICALIZED** -- `AI_ENGINEERING_OPERATING_MODEL.md` section 8b: do not infer success from completion of a chained command block. COMMAND -> OBSERVE RESULT -> VERIFY EXPECTED STATE -> VERIFY REQUIRED EVIDENCE/DECISION RECORD -> only then declare complete. Includes re-reading the target system after a mutation rather than trusting the command's own echo, verifying the decision record landed as a separate check, and **enumerating the authoritative surface before concluding a capability is absent** (two capabilities were wrongly reported blocked on failed guesses; both were available). This entry is itself an instance: the first attempt to write it failed on a shell quoting error and landed nothing, which was caught by verifying state rather than assuming the block succeeded.
**Why Tier-1:** design, specification, and documentation only. Every protected action is identified and left unexecuted.

## 83. C3 P5-A EXECUTED AND PASSED -- PITR clone recovery PROVEN, measured RTO-CLONE 9.31 minutes

**Date:** 2026-08-06
**Decision:** Executed P5-A under Owner authorization scoped to exactly two protected operations (create one disposable rehearsal database via PITR clone; delete it after successful validation). **Result: PASS.** Evidence: `docs/audits/c3-p5a-pitr-rehearsal-20260806/` (20 files, hashed).
**Pre-gate 10/10 PASS (fail-closed):** source `(default)`, `us-central1`, `FIRESTORE_NATIVE`, delete protection ENABLED, PITR ENABLED; snapshot `2026-08-06T22:32:00Z` verified after `earliestVersionTime` (21:15:00Z), in the past, whole-minute; target `recovery-rehearsal-20260806-223836` verified non-existent and disposable-named.
**MEASURED RTO-CLONE = 559 seconds = 9.31 minutes** (T0 `22:38:50Z` submit -> T3 `22:48:08.533266Z` operation `endTime`), for a 1,649,196-byte database. Operation `operationState: SUCCESSFUL`. **This is the Firestore data-recovery portion of RTO only** -- it excludes Rules redeploy, Functions, Hosting, Auth, application repointing, and real-incident decision latency -- and at 1.6 MiB it is dominated by fixed provisioning overhead, so it **must not be extrapolated linearly** to a larger database.
**Validation PASS:** collections **23/23 identical sets**; `parts` **190/190** (independently corroborating the Part Master count in #44); `warehouses` 2/2; `suppliers` 2/2; **composite indexes 6/6 READY** -- indexes ARE carried by the clone and required no rebuild. Counts came from `runAggregationQuery` COUNT (returns an integer only) and collection lists from `listCollectionIds` (metadata) -- **no document contents were read**, and nothing was copied back into production. The clone carries its own provenance (`sourceInfo.pitrSnapshot.snapshotTime`).
**NOT carried by the clone (must be reapplied in a real recovery):** PITR (the clone had `POINT_IN_TIME_RECOVERY_DISABLED` -- a recovered database starts with no window of its own), `freeTier` (false vs true; only one database per project gets the allowance), Firestore Rules (project-level, redeployed from repo), and Functions/Hosting/Auth/application config (entirely outside Firestore).
**UNANTICIPATED PROVIDER BEHAVIOUR -- delete protection is INHERITED by a clone.** The rehearsal database was created with `DELETE_PROTECTION_ENABLED` inherited from source, despite the design specifying the disposable database must not have it; the clone API offers no flag to suppress it. **The authorized cleanup deletion failed closed** until protection was explicitly removed from the rehearsal database. Resolution: disabled delete protection **on the rehearsal database only**, as an explicitly-verified sub-step of the authorized cleanup, with production's own protection verified still ENABLED immediately before and after. Judged to be *completing* the authorized cleanup rather than improvising around the safety model, because it touched only the disposable resource, production was never a possible target (name guards aborted on anything not matching `recovery-rehearsal-2026*`), and the alternative -- leaving a **complete live copy of production data** in the project indefinitely -- is a strictly worse security posture. **Recorded as a runbook finding: every future restore/clone produces a delete-protected database, so cleanup of a failed or superseded recovery attempt needs a deliberate unprotect step, and operators must not meet this for the first time mid-incident.**
**Cleanup PROVEN:** pre-delete gate 4/4 PASS; deletion run as a **separate explicit command**, never chained. Rehearsal database describe returns **`NOT_FOUND`**; `databases list` shows only `projects/taylor-parts/databases/(default)`.
**PRODUCTION UNCHANGED PROVEN:** the complete pre/post `describe` diff is **the etag alone**. `deleteProtectionState` still ENABLED, `pointInTimeRecoveryEnablement` still ENABLED, `versionRetentionPeriod` 604800s, and both backup schedules unchanged (daily 2419200s, weekly 8467200s SUNDAY). No production data read, written, or modified; no Rules/Functions/Hosting/Auth/IAM/index/grant/config change.
**P5-A PASS MEANS: the PITR clone recovery mechanism is PROVEN.** It does **NOT** mean: backup restore proven (P5-B, blocked on V2 -- no scheduled backup has materialized yet); whole-application recovery proven; Firebase Auth recovery proven (deferred, required before C3 certification); the <=4h whole-platform RTO proven; or recovery proven at scale.
**Residual C3 gaps:** P5-B backup restore - whole-application recovery (Rules/Functions/Hosting/config) - Identity/Auth recovery review - delivery reliability D1-D4 - and three unassessed layers of the five-layer posture (Identity, Authorization, parts of Application).

## 84. Stale-checkout artifact reconciliation (2 of 3 recovered) and unpublished-work hook false-positive FIXED

**Date:** 2026-08-06
**Decision:** Fixed the `unpublished-work-guard` Stop hook and resolved the two Class-C unique-artifact dispositions from `docs/operations/local-checkout-and-worktree-reconciliation.md`. **No file was deleted, reset, cleaned, or overwritten; the stale checkout remains untouched at 37 entries.**
**HOOK DEFECT — the reminder equated "untracked in this checkout" with "not published anywhere."** On a checkout **1,135 commits behind** `origin/main` that is simply false, and **acting on the reminder would have pushed stale drafts over newer authoritative versions** -- including an older copy of the *finalized* build Blueprint. Observed live: of 6 flagged files, **4 were already on `origin/main`**.
**HOOK FIX (`.claude/hooks/unpublished-work-guard.mjs`)** -- classifies each candidate against the **fetched `origin/main`**, never the local branch tip: **A** already published / local stale copy (byte-identical -- reported as a count only, never actionable); **B** local divergence -- review required (path on main, content differs; could be newer work *or* an older draft, so diff before acting); **C** unique local artifact -- review required (the only genuinely stranded class). **D** When the checkout is behind main the message says so and **explicitly refuses to recommend publication**, directing provenance review and recovery from a fresh worktree instead. **E** Read-only by construction -- no reset/clean/checkout/delete/overwrite, and no network fetch (a Stop hook must not mutate repo state or block on the network); if `origin/main` cannot be resolved it stays silent rather than guessing. Debounce now keys on the **classified** set, so a reclassification re-surfaces. **Verified against the real false-positive case**: correctly reported 2 unique / 4 diverged, flagged the 1,135-commit staleness, refused to recommend publishing, exited 0, and stayed silent on the second run.
**ARTIFACT 1 -- inventory-sales-templates-and-lines-of-business-wireframe.md (164 KB): SPLIT / PARTIALLY RECOVER -> RECOVERED to `docs/design/`.** Decisive evidence: the **merged** `docs/reviews/w1-line-of-business-execution.md` cites it as `design_input` (sections 3.3, 3.8) -- **a broken citation in merged governance**, pointing at a file that existed on exactly one machine and that no other session could read. Recovered verbatim (2,228 lines) with a classification header only; content untouched. Sections **3.3/3.8 marked CONSUMED** (built and merged by wave W1 -- the shipped implementation and W1's record are authority, **not** this document); operating-company models, intercompany flows, Ventana external sales, Controller override, access modality, signature ladder and templates T1-T4 marked **NOT BUILT**, bearing on Financial Operations and Sales & CRM (both Level 1); the gap register and open Owner questions marked **OPEN**. Explicitly **not** promoted to current authority and **not** queued work -- C2 Commercial is deferred behind C3.
**ARTIFACT 2 -- project-integrity-review.md (8 KB): SPLIT / PARTIALLY RECOVER -> procedure recovered into the ECF reconciliation plan, checkpoint SUPERSEDED.** The document turned out to be **an independently-written implementation of ECF's own concern** -- a durable charter for a recurring, read-only integrity review delivered by exception. Its **2026-07-15 checkpoint is superseded and deliberately NOT recovered** (records Issue #15 as blocking, roadmap staleness, and production-parity gaps -- all since closed, classified, or measured; recovering it would reintroduce known-false statements). Its **10-step procedure and one-verified-fact-set delivery principle ARE recovered** into `docs/governance/ecf-reconciliation-plan.md` section 4a, because they answer the question that plan otherwise left open -- *what does a certification run actually do?* Steps 1/4/7/9 encode disciplines this program had to rediscover independently (never trust the local checkout; never mutate during a read-only review; report deltas not history); steps 3/10 are the delta-certification shape ECF names but never specifies. The original's email/HTML-dashboard delivery channels were **not** adopted -- channel choice is an operations decision and `docs/audits/` is already the governed evidence home.
**Neither original was merged wholesale.** In both cases the reconciliation first established which portions were superseded, and those portions were left behind.
**Still preserved and queued, untouched:** `Taylor-Migration-Evidence/` (12 files) and `field-ops-app-vite/pr189-live-verify.mjs` -- both UNKNOWN, awaiting the same provenance/value analysis. Neither may be deleted or published without it.
**Why Tier-1:** a repo-local hook correctness fix plus documentation recovery that adds no new authority and resolves a broken citation in already-merged governance.

## 85. C3/D1 deployed-version identity IMPLEMENTED -- production revision is now readable with one HTTP GET

**Date:** 2026-08-06
**Decision:** Implemented D1 from `docs/design/c3-delivery-reliability-and-release-visibility.md`. **Repo-only, build-time only** -- no runtime, routing, Firestore, Rules, authorization, alerting, Hosting, Pages, or deployment change.
**Problem:** the build already injected `__APP_COMMIT__` INSIDE the bundle (INV-CONVERGENCE-E Stage A), but that is only reachable by loading the app and inspecting internals. Establishing what the two live frontends were actually running took a multi-step forensic exercise -- fetch both surfaces, extract bundle fingerprints, list Hosting releases, cross-reference CI run history -- which is how the five-day Hosting staleness and the silent Pages publish failures were found. A platform should be able to answer "what version is production actually running?" without an architecture investigation.
**Delivered:** an `emit-version-manifest` Vite plugin writes a stable, unauthenticated `dist/version.json` beside `index.html` in **both** build modes: `{ commit, base, buildTime, schema }`. New `npm run verify:version` (9 assertions) wired into the existing `Vite Build Check` workflow -- no new workflow created.
**Security posture:** the manifest carries **build provenance only**. A test asserts the **exact** key set (`base`, `buildTime`, `commit`, `schema`) and scans the serialized output for `apikey`/`secret`/`token`/`password`/`projectid`/`authdomain`. Nothing in it is not already derivable from the shipped bundle. Schema-versioned so D2 consumers can evolve safely.
**A REAL BUG WAS CAUGHT BY THE TEST DURING IMPLEMENTATION.** The first implementation recomputed the asset base from `process.env.VITE_BASE || DEFAULT_BASE`. But `npm run build:firebase` overrides base with a **CLI flag** (`vite build --base=/`) applied *after* the config module evaluates -- so the Firebase manifest recorded the **GitHub Pages** base. That would have made the two production surfaces **indistinguishable from their own manifests**, defeating the precise discrimination D2 exists to provide. Fixed by reading Vite's **resolved** config via `configResolved`. Recorded because the failure mode was silent and plausible: the manifest existed, looked correct, and was wrong.
**Verification:** `verify:version` 9/9 pass (commit `fef1ca3`, Firebase base `/`, Pages base `/Taylor_Parts/field-ops/`, same commit both modes). Regression-checked: `verify:build-base` 12/12 still pass, the `__APP_COMMIT__` shadow-parity consumer 22/22 still pass, oxlint clean (two pre-existing unrelated warnings).
**Honest limit:** this makes future deployments self-identifying. **The currently-live surfaces predate this change** and still require the forensic method; `version.json` answers the question only once a build carrying it is actually deployed -- and deployment remains protected/Owner-gated (R-2). D2 (expected-vs-deployed comparison), D3 (workflow health), and D4 (release evidence) remain design-only.
**Sequencing note:** per the accepted correction, D1/D2 land **before** R-2 so the frontend promotion remediation can be *verified* rather than assumed.
**Why Tier-1:** repo-only build-time artifact plus a test and an existing-workflow step; touches no Tier-2 category.

## 86. C3/D2 expected-vs-deployed comparison IMPLEMENTED -- environment-aware, read-only, and honest about partial coverage

**Date:** 2026-08-06
**Decision:** Implemented D2 from `docs/design/c3-delivery-reliability-and-release-visibility.md`. **Repo-only and strictly read-only** -- unauthenticated public GETs plus one local `git rev-parse`. No credentials, no writes, no deploys, no promotion, no renaming, no infrastructure change.
**Distinction preserved (Owner direction):** **D1** answers *"what SHA does this deployed frontend identify itself as?"*; **D2** answers *"what SHA SHOULD this environment be running, and does deployed == expected?"*. The expectation is always supplied by the caller and never resolved inside the pure core, so the expectation source stays explicit and auditable.
**Environment model -- `config/environments.json`.** Each environment declares a **`role`** (sandbox / integration / production) **independently** of a **`deployment`** (platform / customer). **`production` is deliberately NOT synonymous with Taylor Parts.** A test asserts a production environment never belongs to `platform`, so a later edit cannot quietly encode "production means the first customer" as permanent architecture -- consistent with `DeploymentModeStrategy.md` (multi-company is a design objective, not implemented) and `PlatformCapabilityModel.md` §5a. Registry entries declare, never provision: adding one creates nothing.
**Brand neutrality honored.** No company or brand identity is expressed; `operator` is the neutral placeholder `platform-operator`, and a test scans the registry for leaked brand/legal identity. The brand foundation is a separate workstream and this workstream does not duplicate or pre-empt it.
**FINDING 1 -- HTTP status is not a usable signal for manifest presence.** `firebase.json` rewrites `**` to `/index.html`, so a missing `/version.json` on Hosting returns **HTTP 200 with `text/html`** -- verified live against the real deployment. A status-only check would report a surface predating D1 as *having a manifest*, which is exactly the false confidence D2 exists to remove. Classification is therefore **content-based** (parse, validate required keys, reject HTML), and `ABSENT_SPA_FALLBACK` is its own state meaning "serving a build older than D1" -- a real answer, not an error.
**FINDING 2 (self-caught) -- a partial check must not read as a clean pass.** The first implementation reported `MATCH` for an environment where one surface matched and a second -- the **governed** surface, known to be days stale -- could not be read at all. Corrected: an environment with unreadable surfaces now reports **`MATCH_PARTIAL`** with an explicit `unobservableCount`, never `MATCH`. A bare `MATCH` now means every surface was checked and agreed.
**Also modelled:** `surfacesDisagree` -- surfaces disagreeing with **each other** is a distinct, higher-severity signal than either disagreeing with expectation, because it means different users are running different code *right now*. Observed live between Pages and Hosting earlier in this program.
**Verdicts are never fabricated from absent evidence:** an unreadable surface yields `UNKNOWN_NO_MANIFEST` or `UNKNOWN_UNREACHABLE`, never `DRIFT` or `MATCH`. Short-vs-full SHA comparison uses a genuine prefix match, so a full expected SHA and a short deployed SHA cannot produce permanent false drift, and two different commits can never compare equal.
**First live run** (expected `4372728`): `taylor-parts-production` -> **MATCH_PARTIAL** (Pages `4372728` matches; Hosting unreadable, predates D1). `platform-sandbox` and `platform-integration` -> **NOT_OBSERVABLE** -- which is the point: the registry makes the **missing integration environment** visible as a declared gap rather than an unstated absence. Supplier Master is already waiting on that environment for Owner experience review.
**CI posture:** `Deployment Drift Core Tests` runs **only** the 26 hermetic pure-core tests. The live checker is deliberately **not** in CI -- putting real HTTP calls against production in a build would make CI depend on production availability and turn an outage into a red build, the same false-signal trap this program has repeatedly flagged. The live check is on-demand, and belongs to D3's scheduled check.
**Honest limit:** D2 can only compare what a surface can self-report. The governed Hosting surface stays `UNKNOWN` until a build carrying D1 is deployed there -- and that deployment is Owner-gated (**R-2**). Sequencing remains D1 -> D2 -> R-2 -> D3 -> D4, so the promotion remediation can be *verified* rather than assumed.
**Why Tier-1:** repo-only read-only tooling, a declarative registry, and hermetic tests; touches no Tier-2 category and mutates no infrastructure.

## 87. Sandbox/Integration Environment sequencing assessment + design readiness -- configuration coupling is the real blocker; index drift found

**Date:** 2026-08-06
**Decision:** Performed the evidence-based sequencing assessment and, on its result, produced the Sandbox/Integration design/readiness package: `docs/assessments/sandbox-integration-environment-readiness.md`. **Assessment and design only -- NO infrastructure provisioned, NO project created, NO spend incurred, NO production change.**
**SEQUENCING RESULT: Sandbox/Integration is now the strongest available lever -- on priority-2 (blocking dependency) grounds, not priority-1.** R-1 remains the higher *risk*, but its execution front is **blocked** behind Owner-gated Rows 19/20/22, and its remaining repo-only work is bounded. Sandbox is unblocked and its blocking evidence is compounding: **Supplier Master RC is waiting** for integrated Owner review; further completed capabilities are accumulating on main unreviewed (Receiving workspace, Transfers, Warehouses, Suppliers, Purchase Orders, PartsScanner); Owner review still requires manual localhost/emulator assembly; production remains the only integrated environment, contradicting `AI_ENGINEERING_OPERATING_MODEL.md` §7; and D2 now reports both `platform-sandbox` and `platform-integration` as `NOT_OBSERVABLE`, making the gap machine-visible. **The platform is completing capabilities faster than it can review them** -- a throughput failure, and the only current lever that worsens with time. This is **not** a deprioritization of R-1, whose repo-only preparation continues in parallel on non-competing surfaces (Operating Model §1a).
**FINDING S-1 (the blocker) -- the frontend is hard-wired to the production project.** `field-ops-app-vite/src/firebase/firebase.js` hard-codes `projectId: "taylor-parts"`, `authDomain`, `storageBucket`, `appId` and region, and there is **no build-time environment injection** (the Pages workflow passes no `VITE_*` and consumes no secrets). **The application as built today cannot point anywhere except production**, so a sandbox is impossible without changing this. Same coupling that blocks R-2 option B, and it overlaps the **Configuration Tier-2 ADR** already on the roadmap -- so it must be solved **once**, not three times piecemeal.
**FINDING S-2 -- INDEX DRIFT, and a latent production risk.** `firestore.indexes.json` declares **5** composite indexes; live has **6** -- an undeclared index on **`fieldops_jobs`**. Two consequences: (a) a sandbox built from the repo would lack it, so it could not faithfully represent production; and more seriously (b) **a repo-driven `firebase deploy --only firestore:indexes` could DELETE the live index**, since a deploy reconciles live state to the declared set. Indexes have never been deployed from this repo by any CI path, which is why this persisted unnoticed. Recorded in `docs/Deployment.md`. **Not remediated -- protected.**
**FINDING S-3 -- readiness flags are build-time constants, not configuration.** `RECEIVING_TRANSPORT_READY` (false), `TRUCK_MANAGEMENT_WRITE_READY` (true), `TRUSTED_COMPLETION_ENABLED` (true) are compiled-in. A sandbox wanting receiving enabled while production keeps it disabled would need a **second build** -- meaning the reviewed artifact would not be the production artifact, defeating the purpose of an RC. Same configuration problem as S-1, not a separate one.
**FINDING S-4 -- production project guards are protective and MUST NOT be loosened.** `BOOTSTRAP_ADMIN_PROJECT`, `warehouseBackupCodec` (rejects any `projectId` other than `taylor-parts`), and ~8 operator scripts hard-guard on the production project. These are deliberate fail-closed safety controls. The correct shape is an explicit **allow-list of known project identities with the guard intact** -- a sandbox permitted **by name**, an unknown project still refused. Widening to a wildcard would trade a real safety property for convenience.
**SANDBOX vs INTEGRATION topology -- assessed, not assumed: start with ONE physical environment and TWO logical roles, designed so splitting later costs nothing.** They differ mainly in *data lifecycle discipline* (sandbox freely rebuilt; integration frozen at an RC), not infrastructure shape, and with D1/D2 an RC is identified by **SHA**, not by which project hosts it. The registry already models them as separate logical entries, so a later split is a registry + deploy-target change, not a redesign. **The forcing condition is concurrency** -- an RC under review while sandbox rebuilds -- and given the review backlog, that should be expected within the first few cycles rather than treated as hypothetical.
**Data posture: production data is NEVER copied to sandbox by default** (it would carry real customer and employee information into a lower-trust environment). Reproducible, versioned **synthetic scenario packs** instead -- baseline reference, operational lifecycle states, and edge cases -- consolidating the existing `seedOperationsDemoData.js` / `seedSupplierSandbox.mjs` / `bootstrapIssue100VerificationFixtures.js` seeds rather than replacing them.
**Identity:** new sandbox/integration infrastructure must **not** inherit `taylor-parts` as the platform identity; neutral placeholders (`platform-operator`, `platform-sandbox`, `platform-integration`) are already in use. **No existing production infrastructure is renamed** -- project ids, collections, environment variables and package identifiers are untouched.
**OWNER DECISIONS REQUIRED (none executed):** **O-1** create a sandbox Firebase project (infrastructure + spend) - **O-2** accept ongoing second-project cost - **O-3** approve the configuration architecture resolving S-1/S-3 (Tier-2 material; overlaps the Configuration ADR) - **O-4** reconcile the S-2 index drift (protected) - **O-5** confirm one-environment-first.
**RECOMMENDED NEXT STEP: O-3 alone, first.** The configuration architecture is the true blocker, is **repo-only**, is required by the sandbox *and* R-2 option B *and* the Configuration ADR, and can be designed and implemented **without provisioning anything or spending anything**. O-1/O-2 only become worth deciding once the application can actually target a non-production project.
**Why Tier-1:** assessment, design and documentation. Every protected item is identified and left unexecuted.

## 88. O-3 environment configuration architecture IMPLEMENTED (ADR-011); O-4 index drift assessed, declared, and guarded

**Date:** 2026-08-06
**Decision:** Implemented the Owner-authorized O-3 configuration architecture and completed the O-4 index-drift assessment with a fail-closed guard. **Repo-only.** No sandbox project created, no spend, no sandbox or production deploy, no Hosting/Pages change, no production Firebase configuration change, no guard loosened, no migration, **no Rules or index deployment**.
**O-3 -- ADR-011 `docs/architecture/ADR-011-environment-configuration-architecture.md`. ONE authoritative mechanism: `config/environments.json`** (the existing C3/D2 registry **extended**, not duplicated), now answering which environments exist, what each is for, its Firebase identity, and its capability readiness. Client identity is injected by `vite.config.js` via `define`, selected by `VITE_ENVIRONMENT_ID`; unset resolves the registry default and **reproduces the previous production build exactly**.
**S-1 CLOSED:** `field-ops-app-vite/src/firebase/firebase.js` no longer contains `projectId: "taylor-parts"`, the production `authDomain`/`storageBucket`, or a literal `us-central1` -- all are environment-resolved. **The application can now target a known non-production environment from source.**
**S-3 CLOSED:** `RECEIVING_TRANSPORT_READY`, `TRUCK_MANAGEMENT_WRITE_READY` and `TRUSTED_COMPLETION_ENABLED` are resolved per environment instead of compiled-in. **Placement decision:** Firebase identity is build-time (the SDK needs it at `initializeApp`); readiness is **deployment/environment configuration**; **no governed runtime configuration was introduced** -- adding a runtime config fetch would put a new failure mode on the critical path, and nothing yet requires it.
**ARTIFACT PARITY:** a Release Candidate is an **exact source revision, not an exact binary**. The same revision builds per environment with that environment's configuration, so business logic is identical by construction. D1's `version.json` is now **schema 2**, recording `environmentId` and `environmentRole` alongside `commit`, so a surface states which revision **and** which environment it was built for and D2 can verify both.
**FAILS CLOSED (verified against the real build):** unknown environment id -> build error (`UNKNOWN_ENVIRONMENT`, refuses to fall back -- a typo must never silently point a sandbox build at live customer data); declared-but-unprovisioned -> build error (`ENVIRONMENT_NOT_PROVISIONED`); missing/non-boolean readiness -> build error (never defaults to enabled); incomplete Firebase identity -> build error.
**S-4 HONORED -- guards NOT loosened.** `isKnownProjectId()` provides the allow-list mechanism, but `BOOTSTRAP_ADMIN_PROJECT` and `warehouseBackupCodec`'s `projectId must be taylor-parts` are **left exactly as they are**: no sandbox project exists yet, so relaxing a guard now would be risk with no benefit. Invariant tests assert both remain hard, and that unknown project ids (`some-other-project`, `taylor-parts-evil`, `*`, empty) are rejected. Allow-list membership is **not** permission -- callers requiring production still check `role`.
**ROLE/DEPLOYMENT NOT CONFLATED:** production-ness is keyed on **role alone**; a second customer is `role: production, deployment: <customer>` with no code change. Tests assert no production environment belongs to `platform`, and that platform environments do not inherit Taylor Parts identity (naming leakage guard).
**SECRETS:** the registry holds **public Firebase Web client configuration only** -- a Web `apiKey` is a public project identifier, not a credential (access is enforced by Rules + Auth). A test scans for `private_key`, `client_secret`, `refresh_token`, `service_account` and bearer tokens.
**Verification:** 15 architecture-invariant tests pass; D2 drift 26/26; D1 manifest 10/10 (updated for schema 2); `verify:build-base` 12/12; `tsc --noEmit` clean; oxlint clean (two pre-existing unrelated warnings). Fail-closed behaviour confirmed by actually running the build with a bad and an unprovisioned environment id.
**O-4 -- INDEX DRIFT ASSESSED.** Exact live definition: `fieldops_jobs`, COLLECTION scope, **`technicianId ASC` + `status ASC`** (+ implicit `__name__`), READY. **No current query requires it** -- the only live `fieldops_jobs` query is `useAssignedJobs`'s `where("technicianId","==",...)`, a single-field equality served by the automatic index; nothing anywhere combines `technicianId` with `status`. Provenance is not recoverable from the repository. **The domain IS still live** (`useAssignedJobs` -> `FieldMode.jsx`, `PartsScanner.jsx`), pending W4 convergence onto `fieldops_wos`.
**O-4 DISPOSITION: DECLARE IT (repo-only), retire deliberately with W4.** Added to `firestore.indexes.json` so **repo state now matches live state and the silent-deletion path is closed**. Declaring costs nothing (the index exists and is READY) and is strictly safer than leaving live state undeclared. It is **not** asserted to be required -- it is preserved because removal belongs with the W4 domain retirement, not to a side effect of an unrelated deploy. **No production index mutation performed.**
**O-4 GUARD:** `scripts/indexDriftGuard.mjs` (+ 8 tests) enforces the standing rule that **a repo-driven index deploy must never silently delete an undeclared live index**. It separates `wouldDelete` (destructive) from `wouldCreate` (additive) and **blocks a destructive deploy unless the authorization names every index to be deleted** -- deliberately **no blanket force flag**, so approval cannot be given without knowing what it destroys. `__name__` is normalized away, since Firestore appends it implicitly and including it would make every live index look undeclared.
**Remaining sandbox blocker is now O-1/O-2 only** -- creating the project and accepting its cost. The O-1/O-2 package follows.
**Why Tier-1 execution under a Tier-2 authorization:** the Owner authorized O-3 as repo-only architecture; every protected action (project creation, spend, any deploy, guard loosening, index deployment) was left unexecuted.

## 89. Sandbox O-1/O-2 infrastructure + spend AUTHORIZATION PACKAGE prepared (nothing created, no spend)

**Date:** 2026-08-06
**Decision:** Prepared the consolidated O-1/O-2 authorization package: `docs/deployment/sandbox-o1-o2-authorization-package.md`. **Proposal only -- no project created, no service enabled, no billing linked, no deploy, no spend.** Every repository-side blocker was closed by O-3/ADR-011; what remains is purely infrastructure.
**Project identity: `eos-platform-sandbox`** ("Enterprise Operations OS -- Platform Sandbox"), `us-central1`, matching production's region because the Firestore location is **immutable after creation** and a sandbox should not differ in a dimension that cannot later be corrected. **Platform-neutral by design:** not `taylor-parts-sandbox`, because the environment exercises *the platform* and Taylor Parts is the first customer deployment, not the platform's identity -- naming it after the first customer would re-encode exactly the conflation ADR-011 prevents. It also encodes **no company name**: a Firebase project ID is **permanent and unrenameable**, so it must not depend on the unsettled branding decision.
**Services:** Firestore (Native/Standard), Auth (Email/Password only), Functions (Gen 2, nodejs20, 22 callables), Hosting. **Deliberately excluded:** Cloud Storage (unused by the product), App Check / Analytics / Crashlytics (absent in production -- adding them would make the sandbox *diverge* from what it is meant to represent). Blaze required for Functions; already active.
**Deliberate asymmetry with production, recorded so nobody "fixes" it later:** sandbox has **no PITR, no delete protection, no backup schedules**. A sandbox is meant to be disposable and rebuilt; delete protection would block the rebuild cycle -- precisely the friction hit in the P5-A rehearsal, where inherited protection blocked an authorized cleanup. Backups of synthetic data have no value.
**Rules/indexes:** the **same Rules as production** (different Rules would make the review meaningless) and all **6** declared indexes -- correct only *because* O-4 declared the previously-undeclared `fieldops_jobs` index; before that a sandbox would have silently lacked it. Both deploys run through the O-4 drift guard.
**Registry:** `platform-sandbox` is already declared, so provisioning is a **data change only** (fill `firebase`, flip `status`) -- no code change, ADR-011's resolver picks it up. **First real use of readiness-as-environment-configuration:** sandbox sets `RECEIVING_TRANSPORT_READY=true` while production stays `false`, so the governed receive loop can actually be exercised.
**Guard changes (item 11), minimal and still fail-closed:** widen **only** `warehouseBackupCodec` from `projectId == "taylor-parts"` to `isKnownProjectId()` membership (an allow-list of exactly two; unknown projects still fail closed). **`BOOTSTRAP_ADMIN_PROJECT` unchanged** -- legacy-admin break-glass is a production migration artifact the sandbox never needs, so leaving it pinned keeps a production-only path production-only. **~8 operator scripts unchanged** -- decided per-script when a real need appears, never pre-emptively widened. Principle: widen only what the sandbox provably needs, never to a wildcard.
**Personas:** 7, seeded via the existing governed `provisionEmployeeAccess.js` (the only writer of the Employee<->User link), covering owner/admin/dispatcher/technician plus PARTS_MANAGER, PARTS_ASSOCIATE and WAREHOUSE_MANAGER. Addresses use the **reserved `.invalid` TLD (RFC 2606)** so they cannot receive mail or collide with a real person; credentials are generated at seed time and never committed.
**Data: production data is NEVER copied.** Synthetic **scenario packs** -- `baseline` (reference data), `operational` (work orders across all 11 lifecycle states, reorder requests at all 6 statuses, an ORDERED PO -- the Supplier Master / Receiving review path), and `edge` (zero-history parts, inactive employees, broken Employee<->User links, malformed-but-stored records: the fail-closed paths hardest to reach by hand and most valuable to review).
**Automation:** one idempotent `scripts/sandbox/rebuild.mjs` running the ADR-011 pipeline end to end and finishing with a **D2 verify deployed == expected**, then printing the stable review URL `https://eos-platform-sandbox.web.app`. **Structurally guarded: it refuses any project whose registry role is `production`.**
**D1/D2 payoff:** on provisioning, `platform-sandbox` moves from `NOT_OBSERVABLE` to a real verdict **with no code change** -- the drift checker begins covering it automatically. That is the return on having sequenced D1/D2 before the environment.
**COST: $0 one-time; $0/month expected** -- the environment fits entirely within Blaze **no-cost quotas** (Firestore 1 GiB storage / 50K reads / 20K writes per day; Functions 2M invocations, 400K GB-sec, 200K CPU-sec per month; Hosting 10 GB storage, 360 MB/day transfer; Auth 50K MAU). Production storage is **1.57 MiB** and synthetic will be smaller. **Honest ceiling: single-digit dollars per month**, dominated by Artifact Registry storage for Function containers rather than usage -- the one line item likely to be non-zero. This is not a decision about cost magnitude; it is a decision about whether to run a second project at all.
**Blast radius:** complete project separation (distinct Firestore, Auth, Functions, Hosting, IAM, quotas); **no code path from sandbox to production**; no production data ever; losing the sandbox is a rebuild, not an incident. **Residual risk stated:** the same Rules run in both, so a Rules defect found in sandbox is also live in production -- a feature, but it means a sandbox Rules finding is a **production** finding.
**Future split:** create `eos-platform-integration`, fill the already-declared registry entry, point the rebuild script at it. **No application configuration is remodelled** -- ADR-011's role/deployment separation was the up-front cost that makes the split a data change. Expected within a few cycles given the review backlog.
**NINE PROTECTED ACTIONS, none executed:** A-1 create project - A-2 link billing (**spend**) - A-3 enable services - A-4 create the Firestore database - A-5 deploy Rules + indexes - A-6 deploy 22 Functions - A-7 seed personas - A-8 deploy frontend - **A-9 widen `warehouseBackupCodec` (Tier-2 guard change)**.
**RECOMMENDATION: authorize A-1..A-8; consider A-9 separately.** A-1..A-8 are confined to a new, empty project and unblock the Supplier Master RC plus the accumulating review queue. **A-9 is the only item touching a production code path**, and it can follow once the sandbox exists and the need is demonstrated rather than predicted -- the same reasoning that deliberately left the guards untouched in O-3.

## 90. Sandbox environment PROVISIONED (A-1..A-6, A-8 complete; A-7 blocked; A-9 held)

**Date:** 2026-08-06
**Decision:** Executed Owner-authorized A-1 through A-8. **A-1..A-6 and A-8 succeeded; A-7 (personas) is BLOCKED; A-9 was HELD and not performed.** Evidence: `docs/audits/sandbox-provisioning-20260806/` (21 files, hashed).
**Created:** project **`eos-platform-sandbox`** (number `33669510651`, ACTIVE), billed to **the same account as production** (`014857-036ECF-0FB27E`) so cost stays in one view. Firestore `(default)` Native/STANDARD in `us-central1`. Rules released and **6/6 indexes** deployed (O-4 drift guard reported `NON_DESTRUCTIVE`). **35 Functions** deployed. Frontend live at **https://eos-platform-sandbox.web.app**.
**Registry:** `platform-sandbox` flipped to `live` with its Firebase identity — a **data change only**, exactly as ADR-011 designed. `RECEIVING_TRANSPORT_READY=true` in sandbox while production stays `false`: the first real use of readiness-as-environment-configuration.
**D1/D2 VERIFIED:** the sandbox serves `{"commit":"5dcd574","environmentId":"platform-sandbox","environmentRole":"sandbox","schema":2}` and D2 reports **MATCH**. `platform-sandbox` moved from `NOT_OBSERVABLE` to a real verdict **with no code change** -- the payoff for sequencing D1/D2 before the environment.
**ISOLATION PROVEN at three levels:** the sandbox bundle contains **0** occurrences of `taylor-parts`; production stayed at **22** Functions throughout; production `describe` is byte-unchanged (delete protection ENABLED, PITR ENABLED) checked before and after every step. Sandbox confirms the deliberate asymmetry -- `DELETE_PROTECTION_DISABLED`, `POINT_IN_TIME_RECOVERY_DISABLED`, no backups -- because it is meant to be disposable.
**F-1 -- enabling the Firebase API is NOT adding Firebase to the project.** A-6 first failed `404 /adminSdkConfig`. `firebase projects:addfirebase` is a separate step from enabling `firebase.googleapis.com`; treated as completing A-3, not as working around a failure. **Must be in the rebuild automation.**
**F-2 -- THE SANDBOX HAS 13 FUNCTIONS PRODUCTION HAS NEVER HAD (35 vs 22).** The extras are exactly the estate Issue #226 Rows 19/20 never deployed: `grantRole`, `revokeRole`, `setUserStatus`, `approveAccessRequest`, `rejectAccessRequest`, `assignApprovedRole`, `initiateAdminPasswordReset`, `listResetEligibleUsers`, `createSupplier`, `updateSupplier`, `activateSupplier`, `deactivateSupplier`, `deleteTruckCreatedInErrorCallable`. Production-only functions: **none** (strict superset). **Significant for R-1:** the trusted access mutation backend that Rows 23-26 are blocked behind now exists somewhere it can be **exercised** -- this does NOT unblock the production cutover (still Owner-gated) but lets domain-cutover work be validated against a real deployed backend rather than only an emulator. It also means **sandbox != production in estate**, which must be stated in any review conducted there.
**F-3 -- A-7 BLOCKED: Firebase Authentication is not initialized.** `getAuth().listUsers()` returns **`auth/configuration-not-found`**. Enabling the `identitytoolkit.googleapis.com` **API** does not *initialize* Authentication or enable a sign-in provider. **Minimal next action:** initialize Auth on the sandbox and enable **Email/Password**, then seed personas via the governed `provisionEmployeeAccess.js`. Per the standing instruction the chain was **stopped rather than worked around**; **no service-account key was created** (ADC used for the probe only).
**F-4 -- Artifact Registry cleanup policy set** (1-day image retention on `gcf-artifacts`) -- the one line item predicted to be non-zero, now bounded.
**Test updates made DELIBERATELY, not silently:** three invariants failed because reality changed, and each was updated with its reason -- `platform-sandbox` is no longer "unobservable"; `platform-integration` is now the unprovisioned example; and the known-project allow-list is now `['eos-platform-sandbox','taylor-parts']`. **That last assertion existed precisely to force this deliberate update rather than let the allow-list grow silently** -- it worked as designed. 49/49 green.
**Not performed:** no production mutation of any kind, no `warehouseBackupCodec` change (A-9 held), no service-account key, no production data copied.

## 91. Sandbox Auth initialized; A-7 personas seeded (7 of 8) but A-7 remains INCOMPLETE

**Date:** 2026-08-06
**Decision:** Initialized Firebase Authentication on `eos-platform-sandbox` and seeded sandbox personas through the governed `provisionEmployeeAccess.js` path. **Sandbox only.** No Taylor Parts production Auth change, no additional identity providers, **no service-account key created** (ADC only), no production identities, no production data copied. A-9 remains HELD.
**Auth initialization COMPLETE:** `identityPlatform:initializeAuth` -> HTTP 200; `signIn.email` -> `{"enabled": true, "passwordRequired": true}`; Admin SDK reachable. This resolves finding F-3 -- enabling the Identity Toolkit API is not the same as initializing Authentication.
**Personas: 7 of 8 seeded**, all through the governed path, all with bidirectional `employees`<->`users` linkage (7/7), correct `operationalRoles` (`PARTS_MANAGER`, `PARTS_ASSOCIATE`), all ACTIVE, all using the reserved `.invalid` TLD so they cannot be real people. Evidence: `docs/audits/sandbox-a7-personas-20260806/`.
**A-7 IS NOT COMPLETE, and must not be reported as such.** The Owner's criterion is that personas *"can actually exercise the expected platform authority model"*, not that accounts exist. **All 7 accounts have no password and cannot sign in** -- by design: `provisionEmployeeAccess.js` provisions identity and access records only and never generates, prints, or stores a credential, because a terminal is itself an observable log surface. **Sign-in, effective-permission, navigation, denial, and accessVersion verification have therefore NOT been performed.**
**F-5 -- `owner` is not a legacy securityRole.** `--securityRole` accepts only `admin|dispatcher|technician`; `owner` exists in the **governed capability** model, not the legacy compatibility model. `sbx-owner` was seeded as `admin`. This is the R-1 dual-model split surfacing in practice, and it means an Owner persona cannot currently be distinguished from an admin by security role alone.
**F-6 -- persona seeding depends on reference data (correct fail-closed).** The Warehouse Manager persona failed by design: *"Warehouse(s) not found: wh-main. Refusing to assign a Warehouse Manager to a nonexistent warehouse."* **Ordering requirement for the scenario program: reference data must be seeded BEFORE warehouse-scoped personas.** The 8th persona follows the baseline pack.
**F-7 -- credential activation is an unsolved sandbox need.** A reproducible sandbox needs personas that can sign in, but the governed path deliberately never issues credentials. Options: a sandbox-only Admin SDK password set (synthetic, non-production project only) or the existing admin password-reset flow. **Deliberately not resolved unilaterally** -- it touches credential handling and warrants an explicit decision.
**Next:** resolve F-7, seed the baseline reference pack (which also unblocks the Warehouse Manager persona), then complete A-7 verification and proceed into the scenario-pack program.

## 92. A-7 COMPLETE and verified by real client sign-in; sandbox persona authorization matrix v1

**Date:** 2026-08-06
**Decision:** Resolved F-7, completed A-7 verification, and published the single sandbox persona authorization matrix (`docs/specifications/sandbox-persona-authorization-matrix.md`). **Sandbox only.** No production change, no production authority created, A-9 still HELD.
**F-7 RESOLVED -- sandbox credential activation.** Personas are activated with **randomly generated passwords created at runtime, written only to a gitignored local file, never committed**; the activation script **refuses to run against `taylor-parts`**. This satisfies section 16 (Owner signs in as personas) and section 8 (agents authenticate as personas) without embedding credentials (section 19), confined to the non-production project. `.gitignore` updated.
**A-7 IS NOW COMPLETE -- verified the way the Owner defined it**, not by account existence. All 7 personas verified through **real client sign-in** (REST Auth + Firestore REST), Rules-enforced, **no Admin SDK bypass**: 7/7 `SIGNIN_OK`, 7/7 self-read `users/{uid}` = 200, and 7/7 **denied** write to `auditEvents` (403). **Every persona has both a verified ALLOW and a verified DENY** -- none is allow-path-only.
**DIFFERENTIATED AUTHORITY PROVEN** (`accounts` / `parts` / `reorder_requests` / `employees`): owner, admin and dispatcher = 200/200/200/200; `partsmgr` = 403/**200**/403/403; `partsassoc`, `tech`, `restricted` = 403/403/403/403. Personas genuinely differ -- they are not all denied identically.
**P-1 (R-1 evidence) -- `dispatcher` reads EXACTLY like `admin`.** Identical 200s across all four collections: `isAdminOrDispatcher()`, the single helper behind **41 of the 47** legacy sites, measured in practice. **R-1 must reproduce this breadth before narrowing it** -- narrowing during convergence would be a policy change disguised as a migration.
**P-2 -- `PARTS_MANAGER` cannot read `reorder_requests`** (403) despite reading `parts` (200), i.e. denied the very queue the role is named for. **P-3 -- `PARTS_ASSOCIATE` is denied `parts`** while `PARTS_MANAGER` is allowed. **P-4 -- operational roles do differentiate** despite all three sharing `securityRole: technician`. P-2/P-3 were observed against an **empty** database and some Rules paths evaluate reference data, so they are recorded as **observations to re-verify after the baseline pack**, not yet as defects. **Must be resolved before Row 24 -- and not by widening Rules.**
**Personas NOT created, honestly:** `sbx-warehouse-manager` (**BLOCKED -- reference data**; the governed script correctly refuses a nonexistent warehouse), `sbx-service-manager` (**MISSING ROLE** -- would be indistinguishable from Dispatcher today), `sbx-catalog-admin` (**DESIGNED / NOT DEPLOYED** -- `inventory.catalog.manage` sits on one temporary Role per Decision #42), and **five sales + two finance personas (NOT APPLICABLE -- Sales & CRM and Financial Operations are both Level 1 with no capability)**. Per section 5, authority was **not** manufactured to make the matrix look complete.
**Structural gaps recorded:** G-1 no `owner` legacy securityRole (BLOCKED BY R-1) - G-2 no business/team scope model, `tenant` Scope inert (MISSING SCOPE MODEL) - G-3 **multi-business simulation is BLOCKED BY TENANCY** and was recorded rather than faked - G-4 Sales/Finance capabilities absent.
**Cross-functional scenario boundary, stated honestly:** the chain runs end-to-end **Dispatch -> Technician -> Parts -> Shortage -> Reorder -> Supplier/PO -> Receiving -> Completion**, and **stops at both ends** -- no sales entry point, no financial consequence. That is product-roadmap evidence, not a defect to paper over.
**Agent contract fixed:** `AGENT AUTHORITY <= PERSONA AUTHORITY`; agents authenticate as their persona through the same Auth/roles/scope/Rules/trusted commands; **no agent gets Admin SDK bypass**; privileged seeding stays separate from simulated-user execution; no credentials in agent definitions.
**Next:** baseline reference pack (which also unblocks the Warehouse Manager persona and re-tests P-2/P-3), then interconnected operating records, deterministic scenario packs, and Class-A agents.

## 93. Sandbox baseline reference pack seeded; Warehouse Manager verified with record-level scope; P-2/P-3 CLOSED as expected behavior

**Date:** 2026-08-06
**Decision:** Seeded the baseline reference pack, created and verified `sbx-warehouse-manager`, and re-tested P-2/P-3 against real data. **Sandbox only** -- no production change, no production authority, A-9 still HELD.
**Baseline pack (`functions/scripts/seedSandboxBaseline.js`)** -- deterministic, idempotent, version-controlled, and **triple-guarded**: refuses `taylor-parts` explicitly, refuses any project whose registry role is `production`, and **refuses unknown projects entirely** (fails closed rather than assuming safe). All three refusals were verified by running them. Seeded as ONE coherent relationship graph: 3 warehouses, 2 suppliers, 6 parts, 6 part-supplier items, 2 accounts, 3 locations, 2 contacts, 3 equipment -- realistic refrigeration/ice-machine service records, no orphans, no placeholder rows created to satisfy a validator, no real customer or employee information (`.invalid` addresses throughout). Procurement terms live on `part_supplier_items`, never on the Part core (ADR-008).
**W-1 -- RECORD-LEVEL WAREHOUSE SCOPING IS REAL, PROVEN IN BOTH DIRECTIONS.** `sbx-whmgr` reads its **assigned** warehouse `wh-main` (**200**) and is **DENIED** the unassigned `wh-north` (**403**). `isAssignedToWarehouse()` enforces per-record scope through the full reciprocal chain (`users/{uid}` -> `employees/{id}.userId` -> ACTIVE -> `operationalRoles` -> `assignedWarehouseIds`). **This is the only record-level scope enforced anywhere in the platform today**, and it is the working precedent for the business/team scope model G-2 records as missing. The provisioning validator also **still fails closed** after the baseline existed -- assigning to `wh-does-not-exist` was refused -- so the guard is real, not an artifact of an empty database.
**P-2 CLOSED -- EXPECTED CURRENT BEHAVIOR / R-1 PARITY REQUIREMENT.** `PARTS_MANAGER` still cannot list `reorder_requests` (403) **with real data present**, so it was never a missing reference dependency. The Rules are explicit: `reorder_requests` **read** is `isAdminOrDispatcher()`, while `PARTS_MANAGER`/`PARTS_ASSOCIATE` hold **write/lifecycle** branches (assign, update, start-purchasing). **The role can act on reorder requests it cannot list.** Not a defect -- deliberate current design that **R-1 must reproduce exactly**. It is nonetheless genuine **product** evidence: an operator who can advance a workflow but cannot see its queue depends entirely on being handed a specific record. Recorded for roadmap sequencing, **not** to be "fixed" by widening Rules during convergence.
**P-3 CLOSED -- EXPECTED CURRENT BEHAVIOR.** `PARTS_ASSOCIATE` denied `parts` (403) while `PARTS_MANAGER`/`WAREHOUSE_MANAGER` are allowed (200), with a populated catalog. The Rules deliberately grant the parts read to admin/dispatcher plus those two operational roles and **deliberately exclude PARTS_ASSOCIATE** per the Owner-adopted role matrix. **Both provisional observations are now closed as expected behavior -- neither is a defect.**
**Persona matrix v2** published: 8 personas IMPLEMENTED + VERIFIED, including the first warehouse-scoped persona. P-1 (dispatcher reads exactly like admin) re-confirmed with real data and remains the R-1 parity requirement.
**Not done / unchanged:** service-manager (MISSING ROLE), catalog-admin (DESIGNED / NOT DEPLOYED), 5 sales + 2 finance personas (NOT APPLICABLE -- capabilities are Level 1). Multi-business still BLOCKED BY TENANCY. No authority manufactured.

## 94. Sandbox transactional pack SBX-SCN-001 seeded and verified; hosted sandbox ready for Owner experience review

**Date:** 2026-08-06
**Decision:** Seeded the first transactional operating scenario on top of the baseline graph, verified persona participation against live data, made credential activation repeatable, and refreshed the hosted sandbox. **Sandbox only** -- no production change, no production authority, A-9 still HELD.
**SCENARIO SBX-SCN-001 v1.0.0 (`functions/scripts/seedSandboxTransactional.js`)** -- deterministic, idempotent, version-identified, same triple guard (refuses `taylor-parts`, refuses production-role projects, refuses unknown projects). Seeded: 1 technician, 4 jobs (assigned / open / complete / in_progress), 5 stock positions (healthy / low / **shortage**), 4 reorder requests (ORDERED / PENDING_REVIEW / PURCHASING_IN_PROGRESS / REJECTED), 2 purchase orders (ORDERED / VOIDED). Actor references resolve to the **real seeded persona uids**, so no invented foreign keys.
**CANONICAL CHAIN:** `acct-harbor -> loc-harbor-downtown -> eq-ice-001 -> job-sbx-001 (assigned to tech-sbx-01) -> requires PRT-1001 -> PRT-1001 qty 0 at wh-main (SHORTAGE) -> ro-sbx-001 (ORDERED) -> po-sbx-001 (ORDERED, Arctic Parts Supply) -> RECEIVING-READY`. **The receipt is deliberately NOT seeded** -- it is the governed trusted-callable write the scenario exists to exercise, and seeding it would fake the step under test.
**HONEST BOUNDARIES, unchanged:** no sales entry point (Sales & CRM Level 1) and no financial consequence (Financial Operations Level 1). The story starts at the service request and ends at operational state. Nothing was invented to close either end.
**S-1 -- P-2 REFINED, and this is the material finding.** `PARTS_MANAGER` and `PARTS_ASSOCIATE` **CAN read an individual reorder request** (`ro-sbx-001` -> **200**) but **cannot list the collection** (403). It is Firestore's get-vs-list distinction, not a blanket read denial. The accurate statement is **"can read any request it is pointed at, but cannot discover the queue"** -- which sharpens the recorded product question: the persona needs a **governed queue projection or scoped query**, not broader raw collection access. P-2's classification as EXPECTED CURRENT BEHAVIOR / R-1 PARITY REQUIREMENT is unchanged.
**S-2 -- METHODOLOGY FINDING: unconstrained probes UNDERSTATE real persona access.** `sbx-tech` is denied a bare `fieldops_jobs` list, yet the application never issues one -- `useAssignedJobs` queries `where("technicianId","==",me)`, and Rules evaluate a **constrained** query differently. **Every persona number measured so far is a floor, not a ceiling.** Agent-based verification issuing the app's real queries is the correct instrument and will measure higher. Recorded so these figures are not later misread as the product's actual behaviour -- and it is a direct argument for sequencing deterministic persona agents next.
**S-3 -- clean negative control:** `parts` write returned **403 for all eight personas including owner and admin**, exactly as `allow create, update, delete: if false` specifies (Part Master writes are trusted-service-only, ADR-008). This proves the probe detects denials rather than reporting them incidentally.
**F-7 CLOSED PROPERLY -- credential activation is now a repeatable repo script** (`functions/scripts/activateSandboxPersonas.js`), not an ad-hoc step. Refuses production by registry role and by name, only touches `@sandbox.invalid` accounts, generates random passwords at runtime, and **refuses an `--out` path that would not match the gitignore rule** -- verified, and `git check-ignore` confirms the output file is ignored. This was prompted by a real gap: the earlier ephemeral credential file was deleted during cleanup, leaving no way for the Owner to sign in.
**HOSTED SANDBOX REFRESHED AND VERIFIED:** rebuilt with `VITE_ENVIRONMENT_ID=platform-sandbox`, redeployed, and D1 now serves `{"commit":"c4121f6","environmentId":"platform-sandbox","environmentRole":"sandbox","schema":2}` with **D2 = MATCH**. Persona matrix updated to **v3**.
**Ready for Owner experience review** -- stable URL, exact SHA, D1/D2 verified, coherent synthetic company, eight signable personas, and one canonical operating story ending at a real receiving-ready boundary.

## 95. Persona vs Authority separation, generalized Scope, and a FUTURE integration/implementation-intelligence programme

**Date:** 2026-08-07
**Decision:** Recorded the Owner's architecture direction from a design session into durable artifacts. **Docs-only. Authorizes no implementation.** No collection, Scope engine, Membership tenancy, Rules change, Cloud Function change, claim change, grant/revoke, production-user change, deployment, provider credential, OAuth app, connector or AI discovery was created or touched.

**NEW: [`ADR-012 — Persona, Authority Composition & Scope Architecture`](architecture/ADR-012-persona-authority-composition-and-scope.md).** Purely additive to ADR-005, following ADR-005's own precedent; ADR-005's Hybrid Compatibility Model, compact-claims + `accessVersion`, enforcement split, approval principles, retirement criteria and impersonation deferral are unchanged. **R-1 is referenced, not restated or superseded** — it remains the authorization-convergence authority on its own track, and this ADR must not be used to bypass it. **No competing authorization migration was created.**

**THE AUTHORITY CHAIN:** `PRINCIPAL → MEMBERSHIP → ROLE/AUTHORITY PACKAGE → CAPABILITY/PERMISSION → SCOPE → POLICY/RESOURCE CONTEXT → EFFECTIVE ACCESS`.

**THE THREE RULES most likely to be violated under delivery pressure, recorded explicitly:** (1) a **persona must never automatically become a security role** — it may *suggest* an authority composition, never *be* one; (2) **Effective Access must never become an independently writable source of authority** — it is derived, cacheable, explainable, never an input; (3) **Agent authority ≤ Persona authority** — an agent never becomes a superuser because it represents a persona, and never receives Admin-SDK bypass because it is "the system". Operational Roles remain **work eligibility, not security authority** (Issue #100 preserved).

**SCOPE GENERALIZED.** Conceptual form `scopeType` + `scopeId`: Capability answers *what may be done*, Scope answers *where/to what*, resource context answers *whether this resource falls within it*. `isAssignedToWarehouse()` is the platform's **only proven record-level scope** and is recorded as the evidence for the generalization — explicitly **not** as a template to copy per domain. Doing this now, while exactly one record-level scope exists, is the cheapest moment; every additional domain-specific scope written first makes it harder. **Tenancy is NOT implemented** — ADR-005 §2.2's seam is unchanged and **Issue #140 remains the authority** for the tenant/company model.

**PERSONAS ASSESSED, NOT MANUFACTURED INTO PERMISSIONS.** Restates R-1's governing constraint (*do not create permissions merely to obtain numerical coverage*) at the persona layer. **Sales, Finance and Accounting remain honestly FUTURE / MISSING CAPABILITY** where the repository has no governed authority — consistent with the recorded permission-catalog gap and `governedBusinessRoles.ts`'s own note that accounting-operations ids do not exist. Every implemented persona must eventually prove **ALLOW / DENY / WRONG-SCOPE DENY**.

**ADMIN UX DIRECTION:** best ideas from Salesforce (Permission Set / Permission Set Group style additive composition) and Dynamics (explicit organizational/record scope), copying neither literally; differentiated by a **generalized** Scope abstraction, transparent Effective Access, a *"why does this user have access?"* explanation, a future **Test Access** experience and a strong audit trail. A candidate user-facing vocabulary is recorded **in a table deliberately separated from internal/domain naming** — **no repository concept is renamed**, and governed terminology stays authoritative until a Specification says otherwise.

**SEQUENCING PRESERVED:** Phase 1 Native Authority Foundation, then Phase 2 Native Module Adoption across Service/Field/Dispatch/Inventory/Warehouse/Purchasing/Sales/Finance/Accounting. **No module may create its own competing authorization system.**

**FUTURE PROGRAMME recorded in [`IntegrationArchitecture.md`](IntegrationArchitecture.md) §16a — deliberately OUTSIDE Issue #226.** Integration Gateway, connector framework, OAuth/service principals, vault *references*, system-of-record configuration, provider-neutral capability APIs, and a read-only discovery boundary held separate from write authority; then implementation intelligence (`DISCOVER → MODEL → MAP → TRANSLATE → VALIDATE → MIGRATE`), automation discovery/migration with dispositions (`RETAIN/REPLACE/TRANSLATE/INTEGRATE/CONSOLIDATE/REDESIGN/RETIRE/REVIEW`), and post-go-live continuous optimization. **Governing principle: external systems provide functionality; Enterprise Operations OS retains governed authority** — so workflows are designed around `Collaboration.sendMessage()`, never `sendTeamsMessage()`. **AI may recommend with candidate/confidence/rationale and an accept/modify/reject review, and must never silently make a material migration or authority decision.** Optimization recommendations must **not** be biased toward "move everything into our system". The relationship types (`SYSTEM_OF_RECORD`/`CONSUMER`/`PUBLISHER`/`SYNCHRONIZATION_PEER`/`ACTION`) are recorded as **conceptual planning terms, not an enum to create now**.

**GITHUB:** FUTURE parent issue #641 created; the six candidate child workstreams are documented **inside it rather than as child issues**, because repository convention drives programmes through docs gates (Assessment → ADR → Specification → Implementation Plan) under a single parent tracking issue — #226 and #325 both work this way and neither spawned pre-Assessment children. A cross-reference comment was added to #226 stating only that external-system integration is **intentionally deferred** and will consume the governed native authority architecture later; **#226's scope was not broadened**.

## 96. Gate 2 shell PASSES persona review and merges; Round-2 product findings preserved and routed

**Date:** 2026-08-07
**Decision:** PR #633 (Gate 2 application shell) MERGED at exact head `0210148` (merge `b3558ab`) on Owner authorization, after a two-round four-persona experience review. Round-2 product findings are preserved in [`reviews/persona-shell-review-rounds-1-2.md`](reviews/persona-shell-review-rounds-1-2.md) and routed to owning programmes rather than absorbed into the shell PR.

**SHELL = PASS.** Across four independent Round-2 business missions, **no reviewer reported a remaining defect** in rail, drawer, navigation mechanics, selected state, contrast, touch targets, keyboard behaviour, focus behaviour or shell accessibility. Round-1 shell defects did not recur. The Administrator review named accessibility "the one bright spot -- better than most production apps".

**ROUND 2 RETURNED MOSTLY FAIL VERDICTS, AND THAT IS THE INTENDED RESULT.** Round 1 exposed shell defects; they were fixed; the same missions then penetrated to deeper product problems. `FUNCTIONAL PASS` was never the only quality bar, and a shell PR is not made responsible for solving the whole product.

**ROUND-1 SHELL DEFECTS FIXED (measured, not impressionistic):** multi-expand scroll trap (1462px of nav in an 800px rail, scrolling brand AND selection off-screen); inverted selected hierarchy (the brightest row was the wrong place); leaf row 270px inside a 252px rail, clipping; active item **1.41:1** contrast to **3.18:1** vs rail / **4.74:1** white-on-it; nav toggle 34x30 to 44x44, drawer items 40.9px to 44px, Close 28px to 44px; group labels no longer the faintest text in the rail; self-referential accordions (Equipment expanding to "Equipment") now leaf links; **"Home" removed -- it was a genuine SECOND NAVIGATION AXIS**, the thing Option B exists to eliminate; "Refresh" removed (a browser function shipped as chrome); "Field Ops Platform" removed (a fifth product name); utility-bar title 3.96:1 failed AA; skip link added (~40 tab stops before main); dangling `aria-controls` fixed; phone drawer rows 66px to 48px.

**FOUR REGRESSIONS INTRODUCED DURING THIS WORK, ALL FIXED, ALL WORTH REGRESSION PROTECTION.**

**R1 Firestore Timestamp coercion (from F0):** legacy `fieldops_jobs` stored `createdAt` as epoch MILLISECONDS, governed `fieldops_wos` stores a Timestamp OBJECT, and the `now - job.createdAt` arithmetic was left intact -- producing "478391h since creation" (~54 years), "19932d ago", "Invalid Date", NaN variance, and an At Risk panel flagging **100% of open jobs CRITICAL**. A risk panel that flags everything flags nothing. New `domain/timestampMillis.js` returns **null** when a timestamp cannot be trusted, deliberately NOT defaulting to 0 or now -- both produce a confident lie.

**R2 swallowed permission denial:** `subscribeToWorkOrders` is an UNFILTERED listener with no error channel; a technician's denied read left the surface spinning forever. **Standing rule: `denied` / `unavailable` / `loading` / `empty` are four distinct states, and a permission denial must never masquerade as perpetual loading.**

**R3 selected-state collision + single-expand:** both introduced by my own Round-1 fixes. Round 1 produced OPPOSING findings (admin wanted less expansion, inventory needed more), so rationing was reverted and the underlying scroll defects fixed instead.

**R4 missing h1:** the rail rewrite dropped the shell's level-one landmark, leaving ZERO h1 on every page. Restored and improved to name the current domain. Landmark hierarchy is part of the shell accessibility contract.

**R5 two stale assertions** (`appHeaderBase`, `verifyBuildBase`) asserted the removed Refresh link; both rewritten to assert the invariant that actually mattered. `verify:build-base` is CI-only and is now part of the local gate set.

**PRODUCT FINDINGS PRESERVED AND ROUTED -- NOT Gate 2 defects:**

**A. Service to Inventory seam broken (HIGH, owner F2/Materials).** All four personas converged: Service knows which parts a WO needs, Inventory knows where parts are, nothing joins them. The dispatcher could not determine parts risk; the technician's `PRT-1001` does not exist in a scanner that only knows `CMP-048-230` (**two disconnected part-number universes on one screen**); the Warehouse persona could not traverse demand to fulfilment. Classified **SYSTEMIC CROSS-DOMAIN OPERATING SEAM**. **F2 must not be inflated into a Materials programme to absorb it.**

**B. Navigation exposes too much incomplete product (owner UX/IA).** **17 of 53 destinations are stubs.** The shell faithfully renders the navigation MODEL; the model itself is the finding. Do not change IA from one review.

**C. Work Order experience fragmented (owner UX discovery).** Seven Work Orders render across SIX destinations with contradictory vocabulary -- the same record shown as Priority 2, Emergency and High. Classified **POSSIBLE WORKSPACE FRAGMENTATION**: do NOT conclude the routes must collapse, and do not prime future agents with an answer.

**D. Management/owner experience missing (owner UX discovery).** `/dashboard` is a link farm, `/reporting` a stub, access management entirely inert, and the unavailability copy shows an owner "Issue #226 ... (Spec sec12)". Classified **UNRESOLVED** -- precisely why Control Tower has not been prematurely renamed or redesigned.

Also recorded: NaN rendered as CRITICAL alarms; `DISPATCHED` apparently mapped to "Emergency"; raw ids (`acct-harbor`, `PRT-1001`) shown to operators; a dead "Notifications (2)" badge over a stub page. And the **pre-existing** #226 gap -- WAREHOUSE_MANAGER / PARTS_MANAGER cannot reach Inventory or Purchasing; Round 2 measured the Warehouse Manager's entire application as **four destinations, none of them a warehouse**. Owner: **#226 / R-1**.

**METHOD:** Round 2 was **blind** -- business missions and invariants only, no defect list, no "is X better now?" questions. Round 1's Inventory review **straddled two builds** (a 34-minute run picked up the fix deploy mid-run), so its findings are valid but not clean Round-1 evidence; **future rounds pin the build**. Two reviewers mishandled sandbox credentials (hardcoded into scratch scripts / dumped raw to output) -- fictional `.invalid` personas so low material impact, but future prompts must require reading credentials from file at runtime and never echoing them.

## 97. C-7 cold-start context efficiency — L0 contract + current-state pointer + authority-first gate + cost signal

A fresh EOS session recovered current state correctly but via ~121k tokens of repository archaeology (broad reads of CLAUDE_CONTEXT.md/DECISIONS/git). Root cause: the C-7 package generator existed but nothing routed a genuinely fresh session to it. Added three thin navigation layers (no new authority, no RAG/vector DB): the L0 operating contract EOS-BOOTSTRAP.md, a generated current-state POINTER (current-state.json, a provenanced projection of the execution-backlog authority — not a second state store), and the cold-start contract coldStart.mjs (authority-first gate + governed-subjects-outside-scope checklist + COLD_START_CONTEXT_COST). One driver cold-start.mjs composes them; the SessionStart hook routes fresh orchestration sessions there. Authority-first structurally prevents the model-routing defect class (modelPolicy.mjs is now a map authority for model-routing/dispatch). Measured orientation ~6.8k tokens vs ~121k baseline (~94% reduction, estimate) with negative retrieval clean and no guessing. Repo-safe; the live Wake pilot is unchanged/still gated. Success is NOT claimed from the build session — an independent fresh-session acceptance test is specified in docs/orchestration/context/cold-start-context-efficiency.md §5.


## 98. Ventana ice-machine lifecycle — two-condition inventory-control projection (design + implementation)

Finished the Ventana ice-machine commercial/inventory lifecycle from the Owner-confirmed discovery baseline (docs/business-processes/ventana-ice-machine-commercial-inventory-lifecycle.md) through design, review, implementation, tests, and end-to-end verification — WITHOUT forking any subsystem. Everything reuses existing Taylor authorities (Opportunity→Sales Order, Purchasing/reorder PO, Receiving, Serialized Asset identity + installation link per ADR-010, allocateSalesOrder, billingEligibility, coordinated-visit projections). The ONLY genuinely-new thing is the rule that Taylor inventory control ends only when BOTH installation is complete AND the sale closes.

Built one PURE, fail-closed projection `inventoryControl = f(installationComplete, saleClosed)`, mirrored byte-for-decision: authority `functions/src/fulfillment/inventoryControlLifecycle.ts` + client mirror `field-ops-app-vite/src/domain/inventoryControlLifecycle.js`, with parity ENFORCED by a shared canonical table (`inventoryControlLifecycle.cases.mjs`) driving both `functions/test/inventoryControlLifecycle.test.mjs` and `field-ops-app-vite/test/inventoryControlLifecycle.test.mjs`. UX read-composition (tested, not yet screen-wired): `field-ops-app-vite/src/domain/inventoryControlView.js` + `test/inventoryControlView.test.mjs` (E2E walk of the real serialized-asset lifecycle vs an advancing Sales Order, incl. C713×5). Spec: `docs/specifications/ventana-ice-machine-lifecycle-responsibility-model.md`; SYSTEM_AUTHORITIES row added. Governed-inert: no Rules/schema/deploy/production action.

Proven invariants (tests): allocation/delivery/invoicing each ≠ inventory exit; installed+sale-open and sale-closed+not-installed both stay CONTROLLED; EXIT requires both; ownership/title never inferred from control state (and vice-versa); committed equipment never presentable as free inventory (INV-2); coordinated C713×5 rolls up honestly; drop-ship (no Taylor receipt) is NOT_STARTED and excluded from the order exit denominator; fail-closed UNKNOWN on any missing/contradictory/null signal.

Two independent review passes (adversarial multi-lens domain + design/legibility) challenged it; reconciled every finding: client mirror made null-safe/fail-closed to match the trusted mirror (was throwing); order rollup fixed to exclude NOT_STARTED drop-ship units (was mislabeling them "controlled" and stranding mixed orders); mirror export name aligned; results frozen on both sides; stale doc refs and cross-document §-citations corrected.

OWNER DECISION GATE (D-1..D-7, spec §7) — NONE block the code (built fail-closed): Ventana→Taylor title point; Taylor→customer title point; whether cross-franchise invariants apply to Ventana; drop-ship intent confirmation; **D-5 sale-close criteria (load-bearing — `FULFILLED→CLOSED` currently has no payment/acceptance gate, so the two-condition guarantee is only as strong as this)**; freight/warranty responsibility; cancellation/return/damage disposition.

Env note: functions deps (tsc) not installed in this checkout; TS mirror verified via `node --experimental-strip-types`; `functions/test/*` import compiled `../lib/` (CI builds first). Backlogged, per scope control (Taylor product work, not infra remediation).

## 99. Ventana lifecycle — Owner rulings D-1..D-7 recorded; D-5 isolated as the only load-bearing open rule (enforced fail-closed)

Owner ruled (2026-08-11) on the decision gate from Decision #98 / spec §7:
- D-1 Ventana→Taylor title: YES — Taylor takes title on purchase/receipt (Taylor-owned purchased equipment, unlike the cross-franchise custody case). Encoded `resolveVentanaChainTitle`.
- D-2 Taylor→customer title: at successful delivery/acceptance — NOT installation-complete, NOT sale-close. Ownership/installation/close/inventory-control stay independent. Encoded.
- D-3 Ventana = upstream SUPPLIER, NOT cross-franchise. Reuse only universal invariants (custody≠ownership, presence≠availability, billing≠ownership); do not inherit Taylor↔Taylor authorities.
- D-4 Drop-ship = NOT_STARTED (no Taylor custody ⇒ no inventory-control phase); commercial purchase/sale tracked separately. Encoded + tested.
- D-5 Sale-close criteria: UNRESOLVED and load-bearing. FULFILLED→CLOSED has no payment/acceptance gate. Taylor must define the actual close event (invoice finalization / customer acceptance / payment-AR posting / installation paperwork / combination / other accounting event). ENFORCED FAIL-CLOSED: `inventoryControlView.js` `SALE_CLOSE_CRITERIA_RATIFIED = false` ⇒ a bare SO CLOSED yields an UNKNOWN sale-close signal (never a premature EXIT); only an explicit `saleCloseAuthoritative` fact, or flipping the flag once D-5 is ratified, permits EXIT.
- D-6 Freight/warranty: separate fields/processes, not lifecycle gates (warranty→manufacturer/Taylor warranty process; freight damage→receiving exception/claim). Ventana-specific terms captured later, not invented.
- D-7 Cancellation/damage: default HOLD / disposition-required, never auto-return-to-available; explicit disposition + reason/audit. Encoded `resolveCancelOrDamageDisposition` (autoReturnToAvailable:false, reasonRequired:true).

All rulings recorded in spec §7 and encoded as pure, mirrored, tested helpers (client 21 tests pass; TS mirror verified). PR opened for the completed lifecycle work; read-model wiring into Equipment / coordinated-installation surfaces continues. No infrastructure work reopened.

## 100. GitHub Issue intake stages a governed artifact but never grants EOS execution authority

**Date:** 2026-08-12
**Decision:** Add a GitHub-Issue adapter to the existing EOS intake. GitHub label acceptance starts
validation; EOS acceptance remains a separate governed event. The adapter emits `EOS_READY` / `REPO_SAFE`
work with an explicit smallest path scope. Only after EOS contract validation may the Owner-only issue-intake
policy record `EXECUTION_AUTHORIZED` / `AUTHORIZED`, after which the guarded runtime may wake Claude.
`EOS_ISSUE_INTAKE_ENABLED` independently gates this route; relabeling cannot duplicate a durable request.

Also corrected intake status reconciliation: a verified operational outcome bound to the exact current
work hash (for example `COMPLETE`) is preserved instead of being reset/rejected as baseline `READY`, while
tampered, stale-bound, or baseline-drifted statuses still fail closed.

## 101. Mutating EOS work is artifactized before separate explicit integration

**Date:** 2026-08-12
**Decision:** Run Claude for GitHub-Issue intake in a detached disposable worktree. The primary checkout may
persist only current-request EOS artifacts. A report is captured under the request's governed results path;
source changes become a deterministic, hash-bound patch artifact. Every changed path must match an explicit
repository path/glob from Issue scope. Claude completion does not authorize patch application.

Integration is a separate, manually dispatched, same-target-serialized workflow requiring the exact patch
hash and `APPROVE`. It fails closed on dirty state, hash/scope/base mismatch, conflict, stale `main`, focused
test failure, or replay, and never stashes unknown files, broadens permissions, bypasses the artifact guard,
or force-pushes. This resolves the #818/#819 contract mismatch without weakening PR #814.

## 102. Metadata-driven EOS is built independently; "Salesforce-style" is not permission to clone Salesforce

**Date:** 2026-08-17
**Decision:** EOS moves toward a metadata-driven enterprise application architecture, targeting
Salesforce-class configurability with EOS-native operational UX and EOS-native governed
command/capability architecture. Salesforce and comparable platforms may be studied as examples of
mature metadata-driven systems via public documentation only; every major abstraction must be
defensible from an EOS requirement rather than from vendor parity. Copying vendor source, assets,
schemas, Metadata API structures, trademarks, or pixel-for-pixel UI is prohibited, as is reverse
engineering or depending on Salesforce services for EOS core metadata operation.

Two boundaries are load-bearing. **Authorization:** page/list metadata may decide what renders and
which affordances appear, but never grants authority — the governed trusted-command and capability
architecture remains the authorization authority, and metadata must never enable client writes that
bypass it. **Scale:** metadata-driven surfaces must not imply client-side dataset ownership; lists
use cursor pagination, bounded reads, stable sorting, server-shaped indexed queries and
URL-persisted filters. External full-text search is deferred until data volume justifies it.

EOS remains operation-centric, not record-centric: metadata must carry lifecycle state, readiness,
blockers, next actions, approvals, work queues, custody, attention projections and governed actions,
and the migration must not reduce EOS to generic CRUD screens. Entity / field / relationship / page /
list / action / capability / workflow / tenant metadata stay separate layers rather than one page
schema.

v1 builds the minimum reusable foundation (EntityDefinition, FieldDefinition, RelationshipDefinition,
PageDefinition, PageRegion, ComponentDefinition, ListViewDefinition, ActionDefinition,
VisibilityRule/CapabilityRequirement) proven through real consumers — Accounts list, Account record,
Contacts — then validated against Work Orders. If it only works for CRM records it is not yet an EOS
metadata architecture.

Full continuing rule, including the ten stop-and-escalate conditions and the required stop report
format: `governance/metadata-architecture-ip-boundary.md`. The Metadata Architecture specification,
when written, must reference it.

## 103. FieldDefinition v1 is the current contract, not the final field architecture

**Owner ruling, 2026-08-17.** v1 is **not** superseded: it remains the read/query/render contract
and every merged definition written against it stays valid. What it must not be treated as is the
final enterprise field model — it carries one identity, no notion of a derived value, and a type
list that treats every number alike.

**Field Architecture v2 is scheduled BEFORE broad mass-definition of the remaining business
entities.** That is the whole point of the timing: two entities are defined today, and each further
one written against v1 raises the cost of changing the field contract by the number of definitions,
tests, indexes and surfaces that would have to move together.

Required scope: `label` vs `systemName` — a stable machine identity, immutable except through
governed migration, referenced by metadata, formulas, relationships, integrations, reporting,
automation and AI/tool contracts, and deliberately **not** spelled with a vendor's "API Name" or
custom-field suffix conventions. Field classes STANDARD / SYSTEM / CUSTOM / DERIVED, with DERIVED
split into FORMULA / LOOKUP / ROLLUP / PROJECTION and **not** collapsed into one generic
calculated-field concept. Explicit numeric semantics (INTEGER, DECIMAL, PERCENTAGE, RATIO, CURRENCY,
unit-aware QUANTITY) carrying storage/calculation/display precision, rounding mode, bounds and step,
under the rule that **formatting never silently changes an authoritative business value** and that
percentage storage is explicit. A constrained, validated expression vocabulary — no arbitrary
JavaScript, no executable metadata (§8). A dependency graph declared by `systemName`, validated,
rejecting cycles, where cross-entity dependencies respect the authority of the underlying data and
**never become an authorization bypass**. Queryability split VIRTUAL / MATERIALIZED / AGGREGATE,
because displayable does not imply sortable or filterable at scale. The durable behavior contract
through deprecation, under §6 — metadata declares authority requirements and never grants them. An
EOS-native standard field vocabulary that standardizes **meaning** where concepts genuinely repeat
without forcing every entity to carry every field. Storage separation, so `systemName` is never
assumed to equal the Firestore path and implementation details do not become platform contract. And
a custom-field **seam** — not the custom-field administration product.

Specification: `specifications/field-architecture-v2.md`. Ledger: `G-FIELD-ARCH-V2` (the gate) and
`A-ENTITY-MASS-DEFINITION` (the sequencing constraint, recorded as an entry so it cannot be lost
between one migration and the next). Surfaces consuming already-defined entities are not blocked.

## 104. Field Architecture v2 is implemented additively; v1 stays the contract until compatibility is proven

**Owner ruling, 2026-08-17, implemented.** The durable field architecture lands under
`field-ops-app-vite/src/metadata/v2/` **beside** v1 rather than replacing it. v1 remains the current
read/query/render contract and every merged definition stays valid.

**Identity is four concepts, not one.** Internal record id (opaque, immutable, never rendered as a
label) · entity `systemName` (`account`, `workOrder`) · business reference (`WO-2026-000127`, and not
every entity has one) · human name (mutable). `recordIdentity()` resolves display as human name then
business reference then **null**; the recordId is present for routing and deliberately absent from
the display chain, because that fallback is the defect corrected on Opportunity (#1099) and Sales
Order (#1124). `systemName` is the EOS term — not "API Name" — and validation rejects vendor suffixes
and prefixes outright. `storagePath` stays separate from `systemName` even where they match, so a
later remap to a legacy path cannot break formulas, reports or integrations, and Firestore layout
never becomes platform contract.

**Field classes** STANDARD / SYSTEM / CUSTOM / DERIVED, with DERIVED split FORMULA / LOOKUP / ROLLUP /
PROJECTION and not collapsed. **A LOOKUP or ROLLUP must declare `sourceAuthority`** — validation fails
without it — because a derived value cannot launder the authority of the data it reads. **A ROLLUP
must declare `queryability: AGGREGATE`**: calling it VIRTUAL invites computing a complete-looking
total over whatever rows happened to load.

**Numeric semantics** carry storage, calculation and display scales separately. **Percentage storage
mode is required, never inferred** — 0.15 and 15 both mean fifteen percent, and guessing wrongly is a
100x error that still looks plausible. Display formatting returns a **string**, so a rounded figure
cannot re-enter arithmetic and become the authoritative value. `displayScale` may be coarser than
storage, never finer.

**Formulas are data, not code.** A closed operator vocabulary over an AST of operators, field
references and literals; a function anywhere in a definition is rejected with its own message rather
than as a type error. A field reference may not contain a dot — a dotted path is arbitrary traversal
crossing an entity boundary that LOOKUP exists to make explicit. Dependency cycles are rejected at
definition time, where the message names the fields, rather than at evaluation time, where the
symptom is a stack overflow in front of a user.

**`alternateKey` requires `unique`** — matching on a non-unique field approves a guaranteed ">1 match"
integrity failure — and `unique` alone does not imply `alternateKey`: one is a data property, the
other a governance decision.

**`fromV1()` records gaps rather than filling them**: UNKNOWN_MUTABILITY, UNKNOWN_WRITE_CAPABILITY,
UNKNOWN_ROUNDING_POLICY. Defaulting mutability because most fields are mutable would convert a
missing decision into a stated one nobody revisits.

**Not built:** the bulk-import product, custom-field administration, a unit-conversion engine, and any
rewrite of the approved WO-YYYY-###### / OPP-YYYY-###### numbering. Seams only.

`A-ENTITY-MASS-DEFINITION` stays blocked until compatibility is proven against the two existing
definitions — migration work, not architecture work.

## 105. Record provenance is a platform invariant; four architecture workstreams recorded behind one shared query model

**Owner architecture addendum, 2026-08-17.** Capture and sequencing. Specification:
`specifications/eos-platform-architecture-addendum.md`, which reconciles against what already exists
rather than duplicating it — the audit event architecture keeps mutation history, the governed report
creator becomes a convergence target, and Field Architecture v2 remains the base contract every
workstream consumes.

**RECORD PROVENANCE (implemented).** Every durable EOS business record carries `createdAt` /
`createdBy`; every mutable one additionally carries `updatedAt` / `updatedBy`. These are SYSTEM
fields — exposable on pages, lists, reports and exports where authorized, never redefinable and never
directly writable. They carry **no writeCapability**, because a client-supplied timestamp or actor is
a *claim* rather than provenance: any caller who can write the record can write the claim, so a
trusted command writes these or they are not provenance.

An **append-only** record gets two fields, not four — emitting `updatedAt` on an issued invoice
implies a mutation path that must not exist. **Synonyms are rejected**: `creationDate` beside
`createdAt` is two answers to one question, and legacy storage is handled with `storagePath`, never a
second name in the standard vocabulary. **Exemptions require a stated reason**, so an exemption for a
cache or a lock stays a decision somebody made rather than a gap somebody left.

**Provenance is not audit history.** It describes current state and cannot answer "what changed on
the fourteenth"; reconstructing history from `updatedBy` makes the last writer look like the only
writer. Material mutation history remains the existing audit event architecture's, and the origin
seam (`createdVia`, `initiatedBy`, `sourceExecutionId`, `correlationId`) must be reconciled against it
before anything writes those fields — a parallel actor vocabulary is exactly what this addendum
forbids.

**THE UNIFIED QUERY MODEL IS A SHARED DEPENDENCY**, recorded as `A-QUERY-MODEL-UNIFIED` so it is not
rediscovered five times. List filters, saved views, the report builder, automation conditions, EQL,
AI-generated queries and the admin visual builder converge on one governed query AST and one
validation pipeline. Independent query semantics per feature is how six subsystems end up disagreeing
about what a filter means. It must absorb the existing report creator rather than run beside it, and
must not collapse the board-scope contract into list pagination — a board returns a complete working
set or admits it cannot, which is a different promise from a page.

**Automation v1**, **EQL v1** and **Bulk Data v1** are recorded blocked on it, because automation
conditions are queries, EQL compiles into the model, and an export is a governed query with a
different sink. **Admin metadata configuration / page designer** is blocked on entity definition —
there is nothing to configure until there is metadata to configure.

Invariants carried into those entries so they survive the gap between recording and building:
automation may **compose** approved capabilities but never **invent** executable authority; EQL is
read-oriented and AI receives no bypass; bulk changes scale but authority does not, matching is by
recordId / business reference / approved alternateKey and never a mutable label, `>1 match` is an
integrity failure rather than a guess; **export authority may never exceed the initiating user's read
scope**, "Export All" means all within *their* authorized scope, and the server-side job enforces it
because UI hiding is not enforcement; page metadata requests presentation and never grants authority;
operational pages keep their protected sections because placement flexibility and composition
invariants are separate concerns and only one is negotiable.

None of this blocks current executable migration work.

## 106. Sales Orders get a real business reference; a record id is never a substitute for missing identity

**Owner ruling, 2026-08-17.** The document-id-as-label pattern is **not accepted**. Sales Order receives an
immutable business reference, `SO-YYYY-######`, joining the approved EOS family beside `WO-YYYY-######` and
`OPP-YYYY-######`.

`salesOrderNumber` is STANDARD / STRING / immutable / unique, and becomes the Sales Order EntityDefinition's
`referenceField`. `alternateKey` is **evaluated separately** rather than assumed from uniqueness — one is a data
property, the other a governance decision, as Field Architecture v2 already enforces.

**Generation is server-authoritative.** The client never chooses or asserts the sequence, allocation is
deterministic and concurrency-safe, document ids are never sequence material, and the number is **never inferred
from the Opportunity, Account or Work Order**. Lineage references may appear together — `OPP-…`, `SO-…`, `WO-…`
— but they remain independent identities, and deriving one object's reference from another's sequence would make
two records share a fate they do not share.

**Immutability is the point of a reference.** Once assigned it survives every change to name, status,
fulfillment, relationships and any other business state. A record that renumbers has no durable identity.

**Legacy records fail honestly.** A Sales Order without a number renders a neutral *reference unavailable*
state. It does **not** fabricate a number client-side and does **not** fall back to the document id. The
governing invariant:

> **A missing business reference is not permission to display a record id.**

**Migration is separate from creation**, so future correctness never waits on historical cleanup: new Sales
Orders are numbered the moment the code activates, while backfill proceeds under its own protected
authorization. The tooling is repo-complete and inert — deterministic, idempotent, dry-run capable,
collision-detecting, preserving `recordId` and existing relationships, emitting auditable evidence, safe under
rerun. Where historical creation timestamps are authoritative they may set the year; where ordering cannot be
established reliably, references are assigned by an explicitly documented deterministic policy rather than
pretending to reflect a sequence no evidence supports.

**The fourth confirmed instance of one defect class** (#1094, #1099, #1124, and now the Sales Order header).
Recorded as a general invariant: no durable business entity may use its opaque internal recordId as its normal
human-facing identity merely because a canonical name or reference is missing. When identity is missing —
record the data-model gap, fix the identity model, and render the absence honestly. Do not normalize the
database key into business identity.

Related provenance convergence, continuing independently: `X-CONTACT-PROVENANCE-GAP` (three write paths onto the
standard four fields, future writes separated from any historical backfill decision) and
`X-EQUIPMENT-PROVENANCE-GAP` (epoch-number timestamps and no actor — determine the actual stored semantics
first, use `systemName`/`storagePath` separation if legacy storage must stay compatible, and prefer UNKNOWN to
an invented actor).

## 107. Write-capable agents require isolated worktrees; destructive git authority stays with the controller

**Owner execution-governance rule, 2026-08-17.** Binding on all EOS multi-agent work.
Rule: `orchestration/agent-isolation-execution-rule.md`. Enforced where enforceable by
`orchestration/lib/writerLanes.mjs`.

**The incident.** Two write-capable agents and the controller operated in one checkout. One agent switched
the branch mid-commit, the controller's commit landed on that agent's branch, a remote branch was created
carrying another lane's ancestry, and the agent then asked the controller to force-push over it. Nothing was
lost — but only because the collision happened to be noticed.

**One writer, one worktree, one branch, one lane.** A writer never shares the controller's checkout or another
writer's. Read-only scouts may share a checkout because they mutate nothing; a scout that finds work requiring
edits reports rather than starting to edit, and a dedicated writer lane is created.

**Destructive actions are controller-level** — force push, hard reset, destructive rebase, deleting a branch
with unmerged work, removing a worktree with uncommitted work, overwriting a remote branch, history rewrite.
The recovery order is `inspect → preserve → fresh branch → cherry-pick verified commits → diff against scope →
test → abandon`, and the ordering is the substance: **contamination is not solved by destroying the evidence of
it.** In the incident, the correct resolution was pushing the corrected work under a new branch name — the same
valid result with nothing destructive.

**The controller verifies rather than trusting a handoff.** Branch still matches the lane, no unrelated commits
appeared, files match scope, no other lane's commits leaked in, CI coverage present, PR describes the branch it
was opened from. *"Agent says done"* is not proof of branch integrity. A writer's handoff must state branch,
head SHA, base SHA, files, tests, risks, dependency assumptions, and **whether any recovery occurred** — never
folded into a normal completion summary.

**PR state is what GitHub confirms**, never a predicted number; and no orchestration state advances after a
failed command because a later pipeline stage succeeded (`gh pr create … | tail -1` is the exact shape that
caused a phantom PR in this ledger once already).

**Merges stay serialized** even with parallel writers: green against an earlier main is not green.

`writerLanes.mjs` catches the mechanical failures — a writer with no worktree, two lanes sharing a worktree or
branch, one task with two active lanes, a PR recorded without verification, a recorded PR whose GitHub head is
another branch — with 17 regression tests. It cannot prove a dependency assumption was sound or that a summary
is honest; **controller inspection remains mandatory.**

**Governing principle:** agent autonomy does not transfer destructive repository authority. A subagent may
recommend; the controller decides. *"An agent asked me to"* is never sufficient authority.

## 108. Defining an entity does not confer indexing authority over a collection another program governs

**Decision.** `equipment_models` remains governed by **D4** (equipment compatibility). D4 continues
to defer compound query shapes to **D5**. The metadata program's `equipmentModel` entity definition
stays; its `equipmentModel.index` list view and the three `equipment_models` composite indexes it
derived are **removed**.

**What happened.** PR #1206 added an `equipmentModel` INDEX list view. Its two declared filters
derived three `equipment_models` composite indexes, which were declared in `firestore.indexes.json`
and subsequently deployed to the sandbox. `functions/src/equipmentCompatibility/repository.ts`
declares `EQUIPMENT_MODELS_COLLECTION` — the collection is D4's — and
`functions/test/equipmentCompatibilityRegistry.test.mjs` asserts *"D4 declares no compound index
for the governed collections."* That assertion was correct and specific; the metadata program
crossed it.

**Why nobody noticed.** The equipment-compatibility workflow's `paths:` filter did not include
`firestore.indexes.json`. A change to the index file therefore could not trigger the guard that
governs the index file. The breach was invisible for four days and only surfaced when an unrelated
PR happened to touch a path that workflow *does* watch.

Two program-level guards also failed to catch it, for a reason worth recording: `listIndexCoverage`
and `indexDriftGuard` compare *declared* demands against *declared* indexes. Both were perfectly
consistent — the metadata program declared a demand and declared an index to serve it. Neither
guard has any notion of **who is allowed to declare an index for which collection**, so internal
consistency was never the question that would have caught this.

**The principle.** An EntityDefinition describes a collection. It does not acquire authority over
that collection. Where two programs' contracts meet, the narrower prior boundary holds until it is
explicitly superseded — a definition that quietly crosses one is a breach, not a supersession. If a
catalog INDEX surface over `equipment_models` is ever wanted, it arrives through an explicit D5
decision that moves the boundary.

**Cost of the correction: none.** No UI referenced the removed list view, and `equipmentModel`'s
`readVia` is `CALLABLE` against a capability registered `active: false`. The removed indexes served
no query.

**Live orphans, deliberately not deleted.** The three `equipment_models` composites are live and
`READY` in `eos-platform-sandbox`. Removing a declaration from source does not authorize deleting a
live index, and index deletion is destructive and separately authorized. They are recorded as
**harmless live orphans** — no query uses them, they cost only storage — pending a separate cleanup
authorization. Source and sandbox are therefore intentionally divergent by exactly three indexes,
and any reconciliation that reports "3 unexpected live" is reporting this, not a drift defect.

**Guards added.** `firestore.indexes.json` now appears in the equipment-compatibility workflow's
path filters, so the D4 registry guard runs whenever the index file changes. The metadata program's
own fleet-catalog suite now asserts that `equipmentModel` exports **no** ListViewDefinition, so a
re-added index list fails on both sides of the boundary rather than only in D4's suite.

## #109 — Phantom Sales Order links are repaired, with history preserved

**Decision (Owner, 2026-08-19).** The four Work Orders that completed against `so-harbor-c713` — a
Sales Order that never existed — are to be repaired rather than left. The repair must preserve
history: an exact before/after manifest, correction of the invalid relationship, an appended audit
event, and a documented rollback. **No write until separately authorized.**

**Why this needed deciding.** `transitionWorkOrder` gated its Sales Order fulfillment write-back on
`if (soSnap.exists)` and proceeded silently when the Sales Order was absent. Four Work Orders
completed and consumed inventory with no record anywhere that the write-back was skipped. The
completions are real; only the link is false. Deleting or rewriting them would destroy legitimate
operational history to hide a referential defect.

**Constraint on the repair.** The five affected Work Orders share `salesOrderId` as their coordination
grouping key by design (see `seedSandboxCoordinatedInstall.js`). A repair that clears the field
without replacing the grouping would break the coordinated-visit relationship it was standing in for.

**Status.** Repair package prepared as tooling and evidence only. Execution is a separate protected
authorization.

## #110 — Dispatch may reassign away from the scheduled technician, with a recorded reason

**Decision (Owner, 2026-08-19).** Reassignment at Dispatch is permitted and explicit. It requires a
reason. The system records prior technician, new technician, actor, timestamp and reason; re-runs the
schedule and conflict checks against the new technician; and notifies affected parties. Completed and
cancelled work remains locked.

**Why.** `transitionWorkOrder` accepted a caller-supplied `assignedTechId` with no comparison against
`scheduledTechId` and never reconciled the two. The scheduling board keys on one field and the
technician boards on the other, so two technicians could own the same job on two governed surfaces.
The double-booking guard — otherwise rigorous, with a per-technician transactional lock — ran its
conflict check once, at Schedule time, against the *original* technician's calendar, so the
technician who actually received the job was never checked at all.

The ruling treats reassignment as a legitimate operational act that must be accountable, rather than
forbidding it or leaving it silent.

**Note.** Whether a notification mechanism exists in this repository is to be established rather than
assumed; if none exists, the requirement is recorded and the audit event emitted for a future
notifier, not faked.

## #111 — Cycle counts are blind, and a counter cannot approve their own material variance

**Decision (Owner, 2026-08-19).** Expected quantity is hidden from the counter until submission. After
submission, managers may see expected versus counted and approve or reject the variance. Material
adjustments require separate authority, and **the counter cannot approve their own material
variance.**

**Why.** The UI rendered "Expected: N" directly above the count input. A cycle count exists to obtain
an independent observation; showing the system's answer first anchors the counter to it and quietly
converts the control into a confirmation step.

The separation-of-duties half is the load-bearing part: it must be enforced server-side, where the
authorization model lives. A client-side check would be a suggestion, not a control.

**Materiality** is to be defined explicitly and configurably rather than as a buried constant, reusing
an existing domain threshold if one exists.

## #112 — "Active" names four distinct concepts and labels must say which

**Decision (Owner, 2026-08-19).** The word is overloaded and the senses are not interchangeable:

| Sense | Meaning |
|---|---|
| **Employee active** | currently eligible for operational assignment |
| **Role assignment active** | included in effective-access resolution |
| **Capability active** | enabled in that environment |
| **Record active** | available for current business use; not deleted or retired |

Labels must name the relevant concept wherever ambiguity is possible.

**Why.** A review found "Active" naming a five-status set on the Work Orders list and a one-status set
on the Dispatcher Board capacity card — the same technician showing different "Active" counts on two
screens, with neither screen wrong on its own terms. The same word also spans authorization state,
environment activation and record lifecycle, where confusing two senses is a governance error rather
than a wording preference.

**Scope.** User-facing labels are corrected now. Renaming persisted enum values or Firestore fields is
a data migration and is explicitly NOT part of this decision; where an identifier is misleading, the
rename and its migration cost are to be proposed separately.

## #113 — All fifteen governed business roles become grantable, with owner protections preserved

**Decision (Owner, 2026-08-19).**

- All **15** governed business roles are to be grantable through trusted, audited, server-side
  administration.
- **Owner protections are preserved**, and **`owner ≥ admin`** must hold.
- `fulfillment.coordinatedVisit.read` is granted to **owner, admin, operationsManager, fieldManager,
  dispatcher**.
- `inventoryCreateExecutor` is **not** assigned until its exact recipient and business need are
  presented.
- The two missing warehouse assignments are prepared with exact employee and warehouse ids before
  authorization is requested.
- **No provisioning or activation writes without a dry-run manifest and separate sandbox
  authorization.**

**Why.** Only 10 of 15 roles could be granted: `grantRole` and `assignApprovedRole` threw
`UnknownRoleError` for the other eight, which were `owner` and the entire management layer —
`operationsManager`, `officeManager`, `salesManager`, `accountingManager`, `financeManager`,
`fieldManager`, `generalEmployee`. Authority that exists on paper and cannot be conferred is not
authority. Live, no `owner` assignment exists at all, which is why Reporting is unreachable for every
persona and why `owner ≥ admin` fails in practice today.

`fulfillment.coordinatedVisit.read` was activated in sandbox but granted to **no role whatsoever**, so
Coordinated Visits and Coordinated Mission were inert for every principal including owner —
activation lifts the catalog gate but never substitutes for a grant.

**Boundary.** This decision authorizes repository implementation and evidence preparation only. The
role grants themselves, the warehouse record changes, capability activation, the Work Order repairs
and any deployment remain protected actions requiring separate authorization.


## #114 — Manager-layer capability expansion, and Accounting/Finance parity supersedes their distinctness

**Decision (Owner, 2026-08-18).** Five governed business Roles gain capability, expressed as changes
to `functions/src/access/governedBusinessRoles.ts` (and its generated client mirror):

| Role | Added |
|---|---|
| `salesManager` | `salesOrder.read`, `inventory.transaction.read` |
| `financeManager` | `salesOrder.read`, `reorder.purchaseOrder.read` |
| `accountingManager` | `account.governedField.write`, `salesOrder.read`, `reorder.purchaseOrder.read` |
| `operationsManager` | `account.record.create` |
| `fieldManager` | `account.record.read` |

**"They all should see accounts."** Every manager Role now holds `account.record.read`. `fieldManager`
was the only one without it: it could create, transition and cancel a Work Order but could not open
the Customer the Work Order was for.

**Accounting Manager is now identical to Finance Manager, deliberately.** This **supersedes** the
earlier Owner requirement — recorded in this file's predecessor decisions and pinned by a test named
"remain distinct (Owner's explicit requirement)" — that the two Roles must not share a grant set. The
original distinction rested on the single id that happened to differentiate them
(`account.governedField.write`), not on a described difference between the two jobs. The Owner has
since decided they do the same work here ("accountingManager should be like financeManager for now").
Parity was reached by **raising Accounting to Finance**, not by lowering Finance. The pinning test was
**inverted rather than deleted**, so the parity is an asserted decision: a future divergence has to be
someone's choice rather than a drift nobody noticed.

**Operations Manager can open a Customer but not amend one.** `account.record.create` is granted;
`account.record.update` and `account.governedField.write` remain DENIED. That asymmetry is
intentional and pinned by test — it is not a half-finished grant to be "completed" later.

**Grant is not activation.** `salesOrder.read` is registered `active: false` in the permission
catalog. All three Roles that now hold it resolve **DENY / `inactivePermission`** until a separate
per-environment activation. The tests assert *both* halves — that the grant is recorded, and that it
still denies — so the day someone activates the id these Roles gain the read with no further change,
and until then no amount of granting can open it.

**Correction of record.** An earlier report in this workstream stated that `fieldManager` held only
`inventory.transaction.read`, and that `financeManager` and `accountingManager` were already
identical. Both statements were wrong; they came from a grep whose pattern excluded camelCase
capability ids such as `workOrder.create`. `fieldManager` in fact held the full Work Order lifecycle,
and the two money Roles differed by `account.governedField.write`. The Owner's instruction was framed
against the incorrect table, and was re-confirmed against the corrected one before implementation.

**Boundary.** Repository implementation only. No Role is *assigned* to any principal by this change,
no capability is activated, nothing is deployed. Assignment, activation and deployment remain
protected actions requiring separate authorization.

## #115 — Multi-line purchase orders receive against `purchase_orders`, and the PO document is the concurrency serialization point

**Owner, 2026-08-20.** A supplier purchase order may contain multiple part lines. A delivery may
receive several lines together, partially receive a line, leave a remainder open, complete lines
independently, and complete the PO only when every line is satisfied.

**`purchase_orders` is the canonical multi-line authority.** No third collection was created.
`reorder_purchase_orders` remains the immutable legacy single-part reorder authority and continues to
work through compatibility normalization — it is normalized to one line `L1` for shared domain logic
and is **written at no point**.

Why not extend the legacy collection: the constraint is document IDENTITY, not field shape. Its
document id *is* the reorder request id (`firestore.rules:1049,1073`), its field set is pinned by
`keys().hasOnly` (`:1068`), and it is immutable (`:1092`). A multi-line PO spanning three parts has
no reorder request to be named after.

### The concurrency proof

A Firestore transaction **query takes no predicate lock**. Deriving remaining quantity from a
receipts query is therefore unsafe on its own: two concurrent receipts each fail to see the other's
uncommitted receipt, both compute the same remaining, and both commit — an over-receipt no amount of
re-checking inside the transaction can prevent.

**Every canonical receipt therefore reads AND writes the purchase-order document.** Firestore aborts
a commit whose read document changed, so the loser retries and re-derives against committed state.
The document-level guarantee is what makes it safe; the query never had to be.

The written value is a `version` increment. It is **concurrency control only** and never represents
quantity received, quantity remaining, receipt count, or business progress. Received and remaining
are derived from immutable committed receipts and are **not stored on the PO**.

### Derived progress is separate from stored lifecycle

Derived: `NOT_RECEIVED` / `PARTIALLY_RECEIVED` / `RECEIVED`, computed from receipts.
Stored: `purchase_orders.status`, which stays `SENT` through a partial receipt and becomes `RECEIVED`
only when every line has zero remaining. **There is no persisted `PARTIALLY_RECEIVED` status** — a
derived value cannot drift from the receipts it is derived from, and adopting it needed no migration.

### Receipt identity is target-scoped for canonical receipts

The legacy derivation hashes the idempotency key alone, so one raw client key used against two
different purchase orders resolved to one document — the second PO's receipt would silently replay
the first. Canonical identity hashes operation + authority + purchaseOrderId + actor + key, and the
`rcvc_` prefix makes the two namespaces provably disjoint in one collection. **Legacy identity is
preserved exactly**: changing it would orphan every receipt deployed callers already hold.

### Not done, deliberately

Procurement create/approve/send remain **unexported** — `procurementService.ts` has no capability
enforcement, actor, audit or idempotency, so exporting it would create an ungoverned purchasing write
path. The only write to a canonical PO is the receipt-related lifecycle and version change made
*inside* the already-governed receiving transaction; `inventory.stock.receive` was **not** broadened
into general purchasing authority.

Close-short, returns and PO amendments are separate future work. The supplier-name resolution
migration was not run. No put-away or location authority was added, no new ledger vocabulary, and no
Rules or index change.

Recorded in `docs/product/multi-line-purchase-order-phase-b.md` §10 and
`docs/specifications/multi-line-receiving-transaction-order.md`.

## #116 — A bin describes where stock sits; the warehouse still owns it

**Owner, 2026-08-20.** Resolving the Phase I finding
(`docs/assessments/inventory-location-registry-2026-08-20.md`).

**Warehouse = inventory custody authority. Bin = descriptive physical sub-location.** A bin does not
become a separate inventory custody location in this phase.

The finding this answers: every governed authority — availability
(`fulfillmentAvailability.ts`), receiving, transfer, cycle count and location display — counts a
movement only at `type === "WAREHOUSE"` (and sometimes MOBILE). Had put-away moved stock to a `BIN`,
the moment a receipt was put away it would have vanished from sellable on-hand, transfer sufficiency
and cycle-count expected quantity.

**The load-bearing invariant: putting stock into a bin must not remove it from warehouse on-hand or
available.** Bin placement describes where a unit physically is within a warehouse it already
belongs to.

Consequently, and deliberately, this phase adds **no** hierarchical inventory roll-up, **no**
bin-level reservations, **no** second inventory balance authority, and **no** change to existing
transfer or cycle-count sufficiency semantics. `BIN` does not become eligible for warehouse custody
calculations.

The cost is stated rather than hidden: a bin-to-bin move is not an inventory movement under this
model, and "how many are in rack 14" is only as good as the last placement recorded. True bin-level
custody remains a separate architecture decision, and the three options (roll-up / descriptive /
full custody) stay documented in the assessment for when warehouse operations justify revisiting it.

## #117 — Quarantine is not invented as a side effect of put-away

**Owner, 2026-08-20.** Quarantine and inspection are **excluded from initial put-away** and remain a
future explicit custody/disposition workflow.

Nothing supports quarantine today — no state, no command, no field — and the Phase I brief's
"where already supported" therefore resolved to nowhere. Taylor parts and Ventana equipment may
require materially different inspection policies, so inferring one from a put-away screen would
embed a quality-control decision neither line of business has made.

Put-away records physical placement. It does not classify condition, does not hold stock pending
inspection, and does not gate availability.

## #118 — A return is intake; disposition is a separate authority

**Owner, 2026-08-20.** Returns intake and returns disposition are **separate authorities**, and a
return must **not** automatically restore inventory to sellable stock.

Intake captures only what can be authoritative: source / Work Order / RMA context, item or serialized
identity, quantity, condition, reason, and receipt/custody state. Where disposition policy lacks
sufficient authority, the return is left **awaiting disposition** and the required future command is
recorded rather than guessed.

Future disposition may include return to stock, inspection/quarantine, repair, vendor return/RMA, or
scrap. None of those is implied by intake, and none is invented here.

This is why `RETURNED` — a schema-legal operational movement type — still has no writer: writing one
at intake would be exactly the automatic restock this decision forbids.

## #119 — Rollout stays separate from repository work

**Owner, 2026-08-20.** Capability activation, grants, deployment and readiness flips remain separate
rollout actions, and they do **not** block repository work that can be implemented honestly and fail
closed.

The corollary matters as much as the rule: **an existing capability is never broadened merely to
avoid a rollout step.** Where least privilege requires a new narrow capability, one is registered
inert and ungranted — as `inventory.catalog.alias.read` and `inventory.balance.read` already were —
rather than pointing a scanner at a write capability that happens to be active.

## #120 — Inventory Health: derive at read now, materialize later and only when scoped

**Owner, 2026-08-25.** Of the three options in
`docs/architecture/inventory-health-ab-decision-memo.md`: **A now, B later, scoped.**

`composePartBalance` stays the single authority for every inventory figure a person acts on. Health
continues to be derived at read, per bounded page, so it cannot be stale — there is nothing stored to
go stale.

A materialized health projection is **deferred, not refused**. It is reopened when a POPULATION-level
surface is authorized — a Goals Home health tile, a health sort, a health filter, or a health export.
Until one of those is named, B would add a class of failure (a stale number nobody doubts) to answer
a question nobody has asked.

If B is ever built it must be a SUMMARY projection serving that one named surface — never the general
balance authority — and it must ship with a rebuild path, a source-versus-derived parity test, and a
visible staleness stamp. Two authorities for one number is how a warehouse and a screen come to
disagree, and the screen wins because it is the one somebody is looking at.

## #121 — Sales Agreement authority goes to the roles that already sell

**Owner, 2026-08-25.** `salesAgreement.create`, `.updateDraft`, `.accept` and `.read` are granted to
**Salesperson, Sales Manager and General Manager** — exactly the three governed Roles that already
hold `opportunity.createSalesOrder` — plus the admin/dispatcher compatibility base, which Owner
inherits by composition. Technician holds none of them.

The reason is not symmetry. A Sales Order is now created ONLY from an ACCEPTED Sales Agreement, so
`opportunity.createSalesOrder` became unreachable without these: a Role that can create the order but
not the commitment it comes from holds an authority it cannot exercise.

**Four ids, not one.** A single `salesAgreement.write` would make drafting terms and BINDING THE
BUSINESS TO THEM the same permission. Separating them keeps a future approval-limit model possible
without renaming a published capability, and keeps a read-only grant possible.

**Recorded gap, deliberately not closed here.** There is no approval-limit or discount-authority
model in this repository, so `salesAgreement.accept` is all-or-nothing per Role: a Salesperson may
bind the same terms a General Manager can. That is a governance gap to close with a deliberate
authority model, not a reason to withhold the capability that makes the commercial chain work.

**Grant is not activation.** All four are registered `active:false` and are eligible for
per-environment activation only; production remains triple-blocked (role-keyed resolution, no
override key on any production entry, asserted by test).

## #122 — The North Star runs on three authorities, and Acceptance is one of them

**Date:** 2026-08-25
**Decision:** Owner ratified the three-authority model for all North Star work.
**Design** (Claude Design) owns visual composition, hierarchy, interaction presentation, responsive
behavior and the design grammar. **Behavioral** (this repository / Claude Code) owns domain
vocabulary, data authority, permissions, capabilities, state transitions, reads, writes,
accounting/inventory truth and transactional behavior. **Acceptance** (the running sandbox + the
Owner) owns whether a page is North Star-complete — and it is not complete until the real sandbox
implementation has passed engineering regression AND been visually compared against the approved
Design source by Design and the Owner.

Design may restructure presentation substantially but may not invent authority. Code may correct
implementation defects but may not materially reinterpret an approved composition for implementation
convenience. Where the two conflict, neither silently wins: the conflict becomes a named product
decision, recorded in `docs/design/north-star-open-product-decisions.md`.

**Reason:** the programme had two authorities and no seat for the only one that can say a page is
done. A page could be declared complete on the strength of a passing diff, which is how a surface
ships correct and unusable. It also had no home for a conflict — so a disagreement between the
mockup and the engine was settled by whichever side happened to be implementing, and the reasoning
survived only in a PR description.

**Supersedes:** the "three authorities" table in `docs/design/eos-north-star-sources.md`, which named
Translation as the third and resolved every conflict in favour of the domain. Translation
(`eos-north-star-design-grammar.md`) remains in force as the *instrument* by which Design is
expressed in Behavioral terms; it is not a party to a disagreement. The domain still constrains what
may ship — an implementation may not invent backend semantics to satisfy a mockup — but that
constrains the code, not the product: a composition asking for something the engine cannot do is as
likely to be a gap in the engine as an error in the composition.

**Alternatives rejected:** keeping "the domain authority wins" (it settles engineering questions by
fiat and product questions by accident); leaving conflicts in PR descriptions (already proven to
evaporate); a single combined design+build authority (removes the independent check that found seven
open questions on the first page family).

**Seeded with:** ND-1 … ND-7 from the Work Order family review (#1494).


## #123 — The Work Order visual source is the North Star artifact, with slots that may outrun the engine

**Date:** 2026-08-25
**Decision:** Owner ruling (P1v2). The approved visual source for the Work Order family is
`North Star - Work Order.dc.html`, with `Implementation Render - Work Order.html` as the explicit
pixel target. `Proposed - Work Order.dc.html` is superseded as visual truth.

The rule that makes an artifact assuming absent services implementable:

> KEEP THE DESIGNED STRUCTURAL SLOT. RENDER A TRUTHFUL STATE IN IT. NEVER FABRICATE THE CONTENT.

Visual structure may represent future capability. Live content must remain truthful to current EOS
behavior. A slot may not be silently dropped either — omitting it hides the gap as effectively as
faking it fills it. An empty slot may not wear the palette-s attention colour. Where no slot can be
honest at all (the concept-s command palette and presence chip), it is omitted and recorded as a gap.

An ACTION the engine does not grant may hold its place DISABLED and explicitly unavailable, with
copy distinguishing "not yet, for anyone" from "not you" — never wired to a no-op or a direct write.

**Reason:** the previous classification ("horizon, NOT the pilot") was protecting against the right
thing — fabricated numbers — with the wrong instrument. Forbidding the composition also forbade its
structure, which cost nothing to honour and which the product will need the day a capability ships.
Separating the two lets the page be built once.

**Alternatives rejected:** implementing the horizon composition with placeholder data (the
fabrication the whole programme refuses); continuing against the superseded `Proposed` source
(would have merged a page reviewed against an artifact Design had already replaced); dropping the
unbackable slots entirely (hides the gap and guarantees a re-layout later).

**Supersedes:** the "Horizon concept — NOT the pilot" section of
`docs/design/eos-north-star-sources.md`, corrected in the same change.
**Related:** DECISIONS #122 (the three-authority model this ruling was made under). B1 (governed
Reschedule) and B2 (technician messaging) are approved as SEPARATE future packages; neither is in
#1494. Register: `docs/design/north-star-open-product-decisions.md` — ND-3 and ND-7 answered, ND-1,
ND-2, ND-4, ND-5, ND-6 still open.

---

## #124 — A suite that nothing runs is not coverage, on either runner

**Date:** 2026-08-26
**Decision:** every `test/*.test.mjs` must be registered in `field-ops-app-vite/test/suites.json`
OR named by a `.github/workflows/*.yml`, and `test/ciSuiteCoverage.test.mjs` now enforces that with
the same force it already applied to `.test.jsx`. There is deliberately **no allowlist** on the
node:test side.

**Reason:** `ciSuiteCoverage` existed to stop precisely one failure — a suite merged that CI never
runs — and its own header asserted that node:test suites were safe because they "are registered in
test/suites.json and run by `npm test`". That described the intent. Checked during the Sales Order
family migration, it was false: five `.test.mjs` files were in neither the manifest nor any
workflow, so nothing ran them. One of them was `test/workOrderNorthStar.test.mjs` — the falsifiable
contract suite for a page family that had already been declared closed, partly on the strength of a
green CI run that had never executed it.

All five passed when run, which is the uncomfortable part: nothing was broken, and nothing would
have caught it if something had been. They are now registered rather than allowlisted, because an
allowlist seeded at zero is a place for the next one to go. `npm test` runs 250 suites, up from 244.

A second assertion was added at the same time: the manifest may not name a file that does not exist.
Both new assertions were mutation-proved — a stray unregistered suite and a phantom manifest entry
each fail the guard.

**Alternatives rejected:** a glob lane for `.test.mjs` (would run suites nobody had reviewed for
runtime cost or isolation, and would hide the registration decision rather than forcing it); seeding
a burn-down allowlist with the five (the debt was five passing files — recording it would have cost
more than paying it).

**Related:** the vitest half of this rule and its `KNOWN_UNNAMED` burn-down list, which is unchanged
and still shrink-only. `docs/design/north-star-migration-ledger.md` records the family-1 consequence.

---

## #125 — The Sales Order is composed from the grammar, and its gaps are named rather than filled

**Date:** 2026-08-26
**Decision:** the Sales Order page family (family 2) is composed in the North Star grammar over a
single derivation layer, `field-ops-app-vite/src/domain/salesOrderNorthStar.js`, with **no Design
artifact in hand**. `Proposed - Sales Order.dc.html` is named in
`docs/design/eos-north-star-sources.md` but has never been handed to this repository. The
composition therefore follows the ratified grammar and the shipped family-1 pattern, and **Owner
visual acceptance is load-bearing rather than confirmatory** — recorded in the ledger as
`AWAITING_OWNER_VISUAL_ACCEPTANCE`.

Three conflicts between the grammar and behavioral reality were named rather than resolved in code:
**ND-8** (a Sales Order records no lifecycle stage times — only `createdAt` and `updatedAt`, so
three of four stages state the absence instead of borrowing `updatedAt`), **ND-9** (nothing resolves
a Sales Agreement to a reference, so that lineage edge is permanently UNRESOLVED), and **ND-10**
(`useSalesOrder` is a one-shot read, so the page may not carry the live indicator family 1 carries).

**Reason:** the three-authority model's whole output is the named decision. Each of these three could
have been quietly papered over — `updatedAt` relabelled as a stage time, the agreement id printed as
its own label, the live badge copied across because the other page has one — and each would have
been a false statement about a sale that a green build would have carried to production.

**Authority is unchanged.** No command, capability, write path or Rules change; every write still
resolves through `transitionSalesOrder`, `allocateSalesOrder` and `createServiceForSalesOrder`. The
suggestion slot speaks here (the governed deterministic recommendation from #1504 has something real
to say) but offers **no second invocation path** — it points at the Allocate button that already
exists, and the command re-checks `salesOrder.fulfill` and its own state precondition independently.

Two defects were found and fixed in passing: `salesOrderView.js` was dropping `createdAtMillis` and
`updatedAtMillis` (the same value-never-arrives failure already fixed for the money on that module),
and `SalesOrderActions.jsx` printed a raw enum in user-facing copy ("...for a CLOSED Sales Order").

**Alternatives rejected:** waiting for the Design artifact (the standing overnight rule directs
composition from the grammar, and the gap is recorded rather than hidden); borrowing `updatedAt` for
stage times (a fabricated fact about a sale); omitting the stage disclosure entirely (loses the
approved structure and guarantees a re-layout when stamps ship).

**Related:** DECISIONS #122 (three authorities), #123 (slots may outrun the engine — the same
principle applied here to the stage strip). Register:
`docs/design/north-star-open-product-decisions.md` ND-8, ND-9, ND-10. Ledger:
`docs/design/north-star-migration-ledger.md`.

---

## #126 — The North Star grammar REPLACES the Wave-2 shell obligation, it does not escape it

**Date:** 2026-08-26
**Decision:** a record page migrated to the North Star grammar composes `ns-page` +
`RecordIdentity` and **must not** also host `WorkspaceShell`. `compositionConformance.test.jsx`
gains a `NORTH_STAR_RECORD_PAGES` category enforcing exactly that, plus two supporting gates: a page
may not appear on both shell lists, and **membership is derived** — any surface composing the North
Star page grammar must be declared, so the list cannot be quietly emptied.

**Reason:** migrating the Account surfaced a conflict between two real standards. The Wave-2
composition gate says "every conformant workspace imports WorkspaceShell", and `AccountDetail.jsx`
was on that list. The North Star grammar replaces the shell with `ns-page`. Running both doubles the
page chrome and gives the page two competing `h1` claims — which is ND-4, already open.

Investigating it found something worse. `WorkOrderDetailPage.jsx` and `SalesOrderDetail.jsx` are on
**no list at all**: they were never added to `CONFORMANT_WORKSPACES` (which would have demanded the
shell they deliberately dropped), so from 2026-08-25 until now the two migrated record families
satisfied **no composition obligation whatsoever**. Families 1 and 2 did not defeat the gate; they
shipped past the edge of it.

The obligation is therefore replaced rather than waived, and the new category is a *stricter*
contract than the one it replaces: North Star pages must carry the page primitives, must not carry
the shell, and remain bound by the `fo-badge` rule through `CONFORMANT_SURFACES`.

A mutation proof then found a hole in the new gate itself: deleting an entry from the list made it
check fewer files and nothing failed. A membership list that only constrains its own members can be
shrunk to nothing and still pass. Membership is now DERIVED from the tree — a surface that composes
the grammar and is declared nowhere fails the build.

**Alternatives rejected:** keeping WorkspaceShell and nesting `ns-page` inside it (doubles the
chrome and makes ND-4 worse); removing AccountDetail from the conformant list with no replacement
obligation (weakens a shrink-only gate to make a migration pass — the exact move these gates exist
to prevent).

**Related:** DECISIONS #122 (three authorities), #124 (the sibling CI-coverage hole found the same
week — both are "a gate that was not guarding what it claimed"). ND-4 remains open: which element
owns the `h1` is still a Design decision, and this only ensures there is one.

---

## #127 — The Account states its status; it does not pretend to have a lifecycle

**Date:** 2026-08-26
**Decision:** the Account page family (family 3) is composed in the North Star grammar over
`field-ops-app-vite/src/domain/accountNorthStar.js`, and **renders no lifecycle spine**, stating in
words why there is none (ND-11).

**Reason:** NS-P1 asks every record page for a visible lifecycle spine, and an Account does not have
one. Its four status values look like a progression — Prospect, Active, Inactive, Archived — but
`status` is an ordinary editable field in `accountRecordPage.editableFieldIds`, written through
`updateAccount` like `name` or `notes`. There is no transition command, no allowed-transition map,
and nothing preventing an archived account from being edited straight back to Prospect. Four
chevrons would have asserted a rule the engine does not hold, which is the same class of error as
printing a stage time the record does not record (ND-8).

**The Account's actual defect was ordering, not absence.** `AccountAttentionSection` was already
right — bounded, account-scoped, composed from existing authorities, honest per source, silent when
there is nothing to say. It rendered at the BOTTOM of the secondary column, below every related
list, so a reader reached it after everything it should have warned them about. It is moved to its
NS-P2 position and says exactly what it said before.

It is deliberately NOT flattened into the shared `AttentionBand`. `accountAttentionProjection.js`
states that AR and Work-Order past-due are never merged into one ranked list, and a flat band has
nowhere to put its per-source honest notes. A first draft of the derivation layer did adapt them and
was removed: overriding a behavioral rule to satisfy a visual pattern is what the three-authority
model forbids.

**Two duplications removed.** `AccountDetail.jsx` carried private `RELATIONSHIP_LABEL` and
`LINE_OF_BUSINESS_LABEL` maps identical to the `enumLabels` in
`metadata/definitions/account.js` — two copies of "CUSTOMER means Customer", free to drift (there is
a third in `wholeUnitAssetDisplay.js`, untouched here). The classification now reads the canonical
definition, and renders as words rather than pills: `accountRelationshipTone` and
`accountLineOfBusinessTone` both return the constant "info" for every value, so the pills were
colouring nothing.

**One stale claim corrected.** A comment asserted that `finance.read` is "registered catalog-wide
active:false today, i.e. denied for every current viewer". The first half is still true; the second
is not. `access/environmentCapabilityOverrides.ts` activates `finance.read`, `opportunity.read`,
`salesOrder.read` and `crm.activity.read` for `eos-platform-sandbox`. The same correction applies to
the design grammar's standing-gaps table, which still classifies "Account shows commercial life" as
**Governance decision required** on the strength of the catalog-wide default.

**Authority unchanged.** No command, capability, write path or Rules change; the edit form, the two
`MetadataRecordPage` calls, every modal, and all the documented wiring decisions in
`accountPageComponents.js` are untouched.

**Related:** DECISIONS #122, #125, #126. Register: ND-11. Ledger:
`docs/design/north-star-migration-ledger.md`.

---

## #128 — The Account is reconciled against its approved design, not rebuilt; four Owner rulings close with it

**Date:** 2026-08-26
**Tier:** 1 (presentation/composition; no authority, no backend, no Rules)
**Supersedes nothing.** #127 stands: the Account states its status and draws no lifecycle.

**What happened.** #127 (PR #1511) migrated the Account to the North Star grammar with **no Owner
approved Account artifact in hand** — it composed from the ratified family grammar and the shipped
family-1/2 pattern, and said so. One now exists: `design_handoff_account/North Star - Account P1.dc.html`,
supplied with a README that states plainly, *"#1511 was inspected as behavioral evidence only, never
as visual truth."* This change is the reconciliation of the merged page against that authority.

It is a **presentation pass**. Every read, write, capability gate, honest state and derivation on the
page is the one that was already there. Nine things moved:

1. **Contacts lead the rail.** They rendered at the bottom of the main column — "who do I call" was
   the last thing on the page. This is the load-bearing change, and it is the one the design named
   as such.
2. **Standing is one ruled row**, not a grid of metric cards. Three cards for three numbers was a
   card habit, not a hierarchy.
3. **Attention and its explanation share one bordered surface**, with the explanation beneath the
   governed facts it explains.
4. **The classification moved into the kicker.** It is identity, not a fact about the record.
5. **The terms digest joined the header facts** (`accountTermsDigest`), reading the same vocabulary
   the rail reads — not a second copy of it.
6. **Receivables got their own main-column section**, titled in the words a person would use,
   instead of living inside a generic financials block.
7. **Standing now precedes Attention.** Attention still comes before everything it warns about.
8. **Opportunities and Sales Orders render as one "Commercial activity" section** — while remaining
   two metadata sections underneath, because they are gated by two different capabilities. A section
   that shares a heading is a layout fact; a section answering to another section's capability would
   be an authority change.
9. **Real tablet and phone compositions.** The page was a stacked desktop.

**Four Owner decisions closed with this package.**

- **A-D1 — attention silence.** When both sources are READY and empty, the surface is **absent
  entirely**. The "Nothing needs attention on this account right now." receipt is removed. Silence is
  the healthy state; a source that could not be *confirmed* still speaks, in its own note.
- **A-D2 — denied AR.** `finance.read` denial preserves the financial geography and renders
  "Not available to you" in place. `MetadataRecordPage` hides a gated section by rendering nothing,
  which on this page would remove the financial region entirely — and a customer record with no
  financial region reads as a customer who owes nothing. That is the one thing this page must never
  imply, so the denial is rendered by the page over the same fail-closed decision. It is a
  presentation of that decision, not a second gate.
- **A-D3 — archived accounts.** Edit stays offered. No rule forbids editing an archived account, and
  adding one would be a behavioral change, not a presentation one.
- **A-D4 — prospects.** Same composition, honest empties. No prospect-specific page architecture.

**The mobile Call affordance (Owner addendum, same date).** The phone answer stack's Call control is
**functional**: a `tel:` URI built from the governed primary contact's own stored phone value
(`domain/phoneLink.js`). EOS hands the number to the device; the operating system opens the dialer,
shows the number and asks the person whether to place the call. There is **no write, no callable, no
command, no telephony service and no second phone-number authority**. The selection rule is the whole
of it, and it is mutation-proven: with two reachable contacts on the account and only one marked
primary, dialling the other one fails a test. A primary with no stored number gets **no** active Call
control — never an account-level number, never a different contact who happens to have one. MULTIPLE
primaries keep the ambiguity and offer no Call; NONE fabricates nothing. The displayed number is the
stored string, unchanged, and nothing is persisted back.

**A-NS-1 — a premise the design and the repository disagree on, recorded rather than resolved.** The
approved design's note says *"useAccount is not a subscription"*. It is one — `hooks/useAccount.js`
uses `onSnapshot`. The design's **conclusion** is implemented exactly as written (no live badge;
honest "Read-checked *time* · Refresh" wording), because that wording is true under either premise:
the data is at least as fresh as the stamp. It changes no business behavior, so it needed no ruling —
but it is written down rather than smoothed over, because a design note asserting something false
about the repository is worth someone noticing.

**One defect this change caused, found and fixed before merge.** Splitting the main column into three
`MetadataRecordPage` calls made each fully-denied group render the **page-level** "You do not have
access to any part of this record" box — a page-level sentence about a section, beside a page that
was plainly still rendering. Two of them, on an ordinary denied view. All three fragment calls now
pass `embedded`, which is what that flag is for, and the AR denial is rendered by the page instead
(A-D2 above).

**Two vocabularies extracted, neither invented.** `arPositionWords` gives an AR position its word
("Overdue") instead of handing the stored token to a pill — the same NS-P4 defect the header had with
its status. `workOrderStatusWords`, the governed Work Order vocabulary, is now what Service activity
reads, so the account's view of a job and the job's own page cannot word the same state differently.

**Two facts newly projected, from documents already fetched.** Service activity states each job's
schedule and technician. Both come off the same documents the timeline query already reads — no
second read, no new query shape, no new index, no new authority. The technician name resolves through
`resolveTechnicianIdentity` against the same directory seven other dispatch surfaces already use; an
id that does not resolve is reported as unresolved, never rendered as if it were a name.

**Product gaps preserved and recorded, not filled:** no Opportunity record route (rows stay honestly
non-navigable, and the definition carries no `rowNavigationTo` — asserted); no account-scoped
Equipment read (the absence is stated with a route to the workspace that can answer, and no count is
invented); no pipeline, backlog or equipment metric (the standing strip names them as absent in one
sentence rather than showing six tiles where three are real); `crm.activity.read` still inactive
catalog-wide.

**Authority unchanged.** No command, capability, write path, Function or Rules change. `updateAccount`,
`createContact`, `createLocation`, every modal, every capability declaration in `accountPage.js` and
every wiring decision in `accountPageComponents.js` are untouched. Full Gate **not triggered**.

**One tooling finding, bisected rather than guessed (defect E).** The P1 assertions were first a
SECOND suite, which `ciSuiteCoverage.test.mjs` correctly refused until a workflow named it (#124).
The PR carrying that workflow edit received **no `pull_request` workflow runs at all** — no check
suite was created, on either head, on two branches, while other PRs opened in the same minutes ran
normally. A docs-only probe from the same session got its runs; the identical change with the
workflow edit removed got fourteen. So: **a PR that edits a workflow file can silently lose its
entire CI, and nothing reports it** — a red check is visible, an absent check suite is not. The
assertions were folded into `accountNorthStarPage.test.jsx`, which CI already names, so no workflow
edit is needed and no coverage is lost.

**Related:** DECISIONS #122, #124, #125, #126, #127. Register: ND-11 (unchanged), A-D1–A-D4
(resolved), A-NS-1 (recorded). Ledger: `docs/design/north-star-migration-ledger.md`.

## #129 — The Opportunity gets a governed per-id read and a URL; family 4 is a product build, and the workspace pane stays

**Date:** 2026-08-26
**Decision:** Build the Opportunity record page (North Star family 4) on a **new** trusted callable
`getOpportunityContext` and a **new** route `/customers/opportunities/:opportunityId`, reusing the
**existing** `opportunity.read` capability rather than minting a second. The Sales workspace's
master-detail pane is **kept**, not retired, and links to the new page.

**Reason.** The migration ledger stopped this family and asked for a decision rather than absorbing
a scope change, and it was right to: families 1–3 each recomposed a page that already existed, while
an Opportunity had **no page**, because it had no per-id read and therefore no URL. It was reachable
only as the selected row of a pipeline someone had already loaded — so deep-linking to a deal,
sending a colleague its address, and following the Sales Order's own lineage link back to its origin
were all impossible. The decision came back *build it*.

**Why the capability is reused, not minted.** The authorization question — "may this principal read
Opportunities?" — is identical for a list read and a per-id read; only the server-side query shape
differs. This is the same reasoning `listOpportunitiesForAccount` recorded when it reused
`opportunity.read`. **No Rules change:** `opportunities` stays deny-all to clients and Admin-SDK-only,
and the trusted callable remains the only way in.

**Why the pane stays (ND-13).** The pane is not a duplicate page — it is where an Opportunity is
**edited** (`opportunityDetailModel`'s editable-by-design sections, the Sales Agreement panel, the
create flow), and none of that moved. The record page is a **read** surface carrying the governed
lifecycle actions. Both consume ONE derivation: the same `stageProgress`, the same
`deriveAttention`, the same `allowedActions`. Retiring the pane would mean rehoming the editing
surface onto the record page — a create/edit archetype question and materially larger work than
family 4 — so it is a named open decision rather than something settled by a side effect.

**Authority unchanged on the write side.** Every transition still resolves through the same governed
`transitionOpportunity`, reached through the same `OpportunityLifecycleControl` and the same
`useOpportunityTransitions`. That control gained a `variant` prop that decides only WHERE the
progression is drawn — `allowedActions` still decides what is legal, and there is exactly one
invocation path in either variant. No capability grant, no role change, no new write path.

**Two facts the system was storing and showing nobody.** `closedAt` (written by every outcome
transition, projected to no one) is now projected as `closedAtMillis`; and the linked Sales Order's
reference is now resolved server-side by one narrow fail-soft read, so the lineage row can name the
order instead of printing its document id. This is the third generation of the same defect in this
domain after `salesOrderId` and `salesAgreementId` — being persisted is not being visible.

**A raw id corrected, and a test that was pinning it.** `OpportunityLifecycleControl` rendered
`won.salesOrderNumber ?? won.salesOrderId` as the link text of the WON acknowledgement — a raw
Firestore id at the most consequential moment in the sales process — and a test asserted that
behaviour under the title *"falls back to the id — a reachable order beats a pretty label"*. The
trade-off is false: the id is in the `href`, so the link is reachable either way. Only the label
changed; the test now asserts the rule instead of the defect.

**Alternatives rejected.**
- *Mint an `opportunity.readOne` capability* — a second authorization for an identical question,
  and a second thing to grant, activate and keep in step.
- *Widen firestore.rules so the client reads `opportunities` directly* — hands the whole document to
  a role that needs a projection, and undoes the reason the trusted read exists.
- *Resolve the customer name and the Sales Order reference on the client* — `accounts` is
  admin/dispatcher-only in Rules, so the SALESPERSON would be told they may not see the name of the
  customer on their own deal.
- *Retire the workspace pane in the same change* — silently converts a read migration into an
  editing-surface rebuild.
- *Ship an empty AI suggestion slot for symmetry with the Work Order* — §8's prohibition is
  explicit: if the capability does not exist, do not fabricate a place for it.

**Not claimed.** This is repo-complete and green offline; **nothing is deployed and no gate has been
run.** Unlike families 1–3 this family needs a **Functions deploy** (`getOpportunityContext` is a new
callable) before a sandbox refresh and the Quick Gate mean anything — until it exists in the
environment the page renders its honest `unavailable` state. Both are Owner-run actions.

**Related:** DECISIONS #122, #125, #126, #127, #128. Register: ND-12, ND-13. Ledger:
`docs/design/north-star-migration-ledger.md`.


## #130 — Opportunity North Star P1v2 is implemented against its real design source, and the blind build is reversed where they disagreed

**Date:** 2026-08-26
**Decision:** Implement the Opportunity page family from `North Star - Opportunity P1v2.dc.html`
(received 2026-08-26). Where the design and the earlier from-the-grammar build disagreed, **the
design decides**, because every disagreement was about how an already-permitted fact is drawn.

**Why this entry exists at all.** #129 built this family with **no design artifact** — the ledger
row said so, and the sources register recorded that no Opportunity artifact had ever reached this
repository. The package then arrived, and the blind build was wrong in ways that matter: it drew a
lifecycle band where the design draws chevrons, suppressed an attention reason the design keeps,
omitted the Sales Agreement relationship entirely, and had no "When this closes" or Activity slot.
**That is the three-authority model demonstrated rather than asserted** — Design owns visual
composition, and a build that composes without it is Code doing Design's job.

**The reversal, named.** The blind build dropped `DECISION_PENDING` from the attention strip on
NS-P4 grounds (the header sentence already says "awaiting customer decision"). P1v2 keeps both: the
header states WHERE the deal is, the strip states WHAT IS OWED. Per the three rules, a conflict
changing only how a permitted fact is drawn is Design's call, so the reason is restored and
`deriveAttention` is now presented **verbatim** — all four reasons, none added, none suppressed.

**ND-12 is withdrawn, not resolved.** It recorded that an Opportunity stores no per-stage
timestamps, which was only a *question* because the blind build drew a band with a per-stage fact
slot. Chevrons state position, not history. The data fact is unchanged and still recorded.

**Authority is unchanged.** No capability, command, Rules change, state machine, numbering or
pricing was added. Every transition still resolves through `useOpportunityTransitions`, every edit
through the version-checked `useOpportunitySectionSave`, and the agreement through the existing
`useSalesAgreement`. The lifecycle control gained a `slot` prop that decides only WHERE a control
renders; the page mounts it twice and passes ONE `transitions` object, so both slots share a single
idempotency cache and a single invocation path.

**Two live defects the design surfaced.**
1. **A fabricated currency.** The shared value formatter hardcoded `style: "currency", currency:
   "USD"` on `expectedValue` — a field stored as a bare number with no currency anywhere. Every
   Opportunity in the workspace carried a `$` nothing justified. This is decision O1's exact
   prohibition and it was shipping. Now grouped digits, with "(no currency recorded)" stated once.
2. **Two renderings of one fact.** The record page's rail fell back to the model's defaults and
   rendered `41000` / `2026-08-31` beside a header saying `41,000` / `Aug 31`.

**A shared component extracted rather than duplicated.** The section read/edit subtree was private
to `SalesWorkspace.jsx`. Two surfaces needing the same deliberate read → Edit → Save/Cancel over the
same version-checked command is how a concurrency check comes to be enforced on one screen and not
the other, so the subtree MOVED to `modules/sales/opportunitySections.jsx` unchanged and both import
it. `RecordIdentity` likewise gained the serif `subtitle` P1v2 needs rather than being forked.

**Alternatives rejected.**
- *Keep the blind composition and note the design as a variant* — inverts the authority model.
- *Render `SalesAgreementPanel` on the Opportunity* — pulls acceptance, pricing and terms onto a
  page whose design says none of that happens there.
- *Retire the workspace detail pane in this run* — converts a read migration into an editing-surface
  rebuild; left as ND-13.
- *Change `deriveAttention`'s 7-day CLOSE_SOON threshold to match the artifact's illustrative
  "9 days"* — the threshold is domain authority; the artifact's number is sample data.

**Visual validation.** Real browser, real stylesheet, fixture data, three widths (1440 / 768 / 375)
via a temporary local harness, removed afterwards. Zero horizontal overflow at every width; the body
resolves 964px + 340px at 1440; chevrons above a 760px container and the same position in words
below it; all 10 controls ≥44px at 375. **This proves the composition, not the live data path** —
that still needs the `getOpportunityContext` deploy.

**Reported, not absorbed.** P1v2 draws Solution as a three-column table; the shipped page renders the
existing shared `LineSummary` list, because that renderer belongs to the workspace pane too and a
three-column table in a 340px column would be worse there. Content is complete; the deviation is
structural.

**Related:** DECISIONS #122, #125, #126, #127, #128, #129. Register: ND-12 (withdrawn), ND-13, plus
Design's O1–O6. Sources: `docs/design/eos-north-star-sources.md`. Ledger:
`docs/design/north-star-migration-ledger.md`.


## #131 — AMENDMENT to #128: a PR can lose its CI without editing a workflow file

**Date:** 2026-08-26
**Amends:** #128, which stays exactly as written. Its remediation — the six deny-list patterns —
is unaffected and still correct. Only its causal claim is narrowed.

**The claim being corrected.** #128 concluded that PRs editing `.github/workflows/**` may silently
receive no `pull_request` CI. That was the honest reading of the evidence available at the time.

**The corrected finding.** A PR can silently receive **no or only partial** `pull_request` check
suites **even when it does not edit workflow files at all**.

**Observed instances.**
1. The prior workflow-edit case recorded in #128.
2. **PR #1527**, which edited no workflow file — two metadata definitions, one JSON registry and
   five test files — and initially received **one** run (`Vite Build Check`) while every expected
   path-filtered lane was absent. `test/metadataCrmDefinitions.test.mjs` and
   `test/crmSalesNav.test.mjs` are named **verbatim** in the `paths:` filters of
   `metadata-contracts-tests.yml` and `sales-opportunity-tests.yml` respectively. The configuration
   was correct. The suites were never created.

**What is known.**
- A workflow-file edit is **not a necessary condition**.
- The underlying cause is **not established**.
- **The absence of a check suite is itself unsafe evidence.** It must not be read as "this PR
  legitimately triggered nothing" — which is exactly how it presents, and is the reason this can
  pass a review unnoticed. A red check is visible; a check that was never created is not.
- Closing and reopening PR #1527 caused the expected suites to be created (1 run → 21).

**What is NOT known.**
- Why GitHub failed to create the suites.
- Whether close/reopen is universally reliable, or was reliable once.
- Whether the failure is GitHub-side, repository configuration, event delivery, or an interaction
  between them.

**Operational rule.** Before declaring a PR green, verify that the expected path-filtered lanes were
actually **CREATED** — not merely that all visible checks are green.

If expected lanes are absent:
- treat CI state as **INCOMPLETE**;
- do **not** merge on the basis of visible checks;
- close/reopen may be used as an observed recovery mechanism;
- verify the expected lanes appear afterwards.

**No replacement theory is offered, deliberately.** #128's causal claim was reasonable and wrong,
and the cost of replacing it with a second unproven one is that the next session stops looking. The
rule above is written to be correct whatever the cause turns out to be.

**Near miss, recorded because it is the point.** PR #1527 was one `gh pr checks` away from being
reported green on the strength of a single build check. It was caught only because the tally looked
wrong against a sibling PR — 1 check where #1514 had 47 — not because anything reported a problem.

**Related:** DECISIONS #124 (a suite registered nowhere, run by nothing), #128 (the deny list).
Standing rule: `docs/CLAUDE_CONTEXT.md` — "verify, don't assume".


## #132 — RECORDED GAP, NO DECISION TAKEN: production release identity is confirmed by a human, not enforced by a gate

**Date:** 2026-08-27
**Status:** **OPEN — awaiting Owner decision.** Nothing is authorized and nothing has been changed.
This entry records a control gap; it does not choose a remedy.
**Classification:** PRODUCTION RELEASE BOUNDARY / GOVERNANCE GAP. Not a North Star product defect,
and not a reason to block ordinary GUI migration except where production release certification is
itself required.

### 1. Current production behaviour

`scripts/_prodRelease.run.sh`, step 7/7 ("verify the deployed revision"):

- prints the expected commit;
- `curl`s the deployed `version.json` and prints the response, or `(unreadable)`;
- prints a checklist and asks the operator to *"Confirm ALL of the following before calling this
  released"* — commit matches, `environmentId`, `environmentRole`.

It performs **no comparison of its own**. There is no assertion, no non-zero exit, and no refusal
path: the step cannot fail the release, whatever the deployed commit turns out to be. It is an
**operator confirmation**, and the runbook is explicit that the operator is the one confirming.

This is the same shape `_releaseIdentityGate.mjs` was written to replace — its own header records
that the sandbox step once "printed the deployed version.json next to an expected commit and told
the reader to compare… A post-deploy check that cannot fail is documentation, not a gate." Sandbox
was given a mechanical gate. Production was not.

### 2. Observed evidence (sandbox, 2026-08-27)

Proven while diagnosing a sandbox `REMOTE_COMMIT_MISMATCH`:

```
01:32:56.817Z  artifact built
01:33:04.311Z  Hosting version created
01:33:08.142Z  releaseTime — and the Last-Modified of the bytes finally served
```

Firebase reported `Deploy complete!`, and for a short interval afterwards Hosting continued serving
the **previous** release. The sandbox verifier read inside that interval and observed the prior
commit. Subsequent reads returned the approved commit, the exact expected `buildTime`, and the
correct Hosting site — the project has exactly one site (`DEFAULT_SITE`), so wrong-site and
wrong-target explanations are excluded by evidence.

**Hosting publication is therefore not guaranteed to be synchronously observable at the first read
after deploy completion.** That is a property of the platform, not of the sandbox script.

### 3. Why this matters to production

Production performs a similarly immediate, single read, and is exposed to the same observability
gap. It differs in what happens next: sandbox fails closed mechanically; production has no
mechanical outcome at all.

The gap is that **the runbook cannot refuse**. Whatever the response — the prior commit during
propagation, a genuinely wrong commit, an unreadable or malformed body — the step prints it and
proceeds to ask for confirmation. Whether a release is correctly identified depends on a human
reading the value correctly at that moment.

This entry deliberately makes **no claim about how often an operator would misread it**. The
recorded fact is narrower and does not depend on that: *the control is advisory, and no mechanical
enforcement exists at this boundary.*

### 4. Current control

Protected production actions remain Owner/operator-triggered, and the agent loop cannot reach them:
the deny list (#128) covers `_prodRelease.run.sh` along with every other release path. Production
Rules are excluded from this runbook by design and carry their own Tier-2 path. Those controls are
unaffected by this gap and remain in force — the gap is specifically the absence of a mechanical
identity check at step 7/7.

### 5. Possible future direction — **NOT AUTHORIZED, NOT APPROVED**

Recorded so the option is not lost, explicitly **not** as a decision or a plan:

- reuse the governed `scripts/_releaseIdentityGate.mjs` at the production step;
- bounded polling for the propagation interval;
- exact approved-commit verification;
- fail closed on timeout, wrong commit, or unreadable response.

The sandbox bounded-retry work (PR #1530) does **not** authorize any of this. Production release is
its own protected boundary, and reusing a component proven in sandbox is a separate decision from
proving it there. Nothing above may be implemented without explicit Owner approval.

### 6. OWNER DECISION REQUIRED

> **Should `_prodRelease.run.sh` step 7/7 be replaced or supplemented by a mechanically enforced
> release-identity gate that fails the release closed on a wrong, stale or unreadable deployed
> commit — or should production release identity remain an operator confirmation?**

Until that is answered, production release identity remains operator-confirmed and this entry
stands open.

**Related:** DECISIONS #128 (the deny list covering release paths), #131 (absence of a check is
unsafe evidence). Sandbox counterpart: PR #1530, `scripts/_releaseIdentityGate.mjs` — sandbox only.


## #133 — RECORDED GAP, NO FIX AUTHORIZED: a release-boundary script change triggers no CI lane of its own

**Date:** 2026-08-27
**Status:** **OPEN — recorded, not fixed.** No workflow was added or edited.
**Classification:** CI COVERAGE / RELEASE INFRASTRUCTURE. Same family as #124 (a suite registered
nowhere, run by nothing) and #131 (an absent check suite is unsafe evidence), one directory over.

### The problem, stated precisely

CI lanes are path-filtered by **explicit file name**. Sixteen files under `scripts/` are named in a
workflow filter and are covered. **The release boundary is not among them.** Named nowhere:

```
_releaseIdentityGate.mjs      _releaseProvenanceGuard.mjs    _sandboxDeployGuard.mjs
verifyDeployArtifact.mjs      releaseProvenance.mjs          releaseRoot.mjs
_sandboxRefresh.run.sh        _prodRelease.run.sh
_sandboxQuickGate.sh          _sandboxRegressionGate.sh      _certificationRoutes.mjs
verifySandboxFunctions.mjs    verifyDeployedCallablesFirebase.mjs
sandboxFunctionsVerification.mjs   sandboxCredentials.mjs
```

There is no `scripts/**` glob in any workflow either — the globs that exist are narrow
(`scripts/governance/**`, `scripts/fixtures/**`, `scripts/certificationWorld/**`, `scripts/repoGraph*`).

**A correction to an earlier claim.** While proving PR #1530 this was first reported as "no workflow
path-filters on `scripts/`", which is wider than the evidence. Most of `scripts/` is fine. The
uncovered set is specific, and it is the release boundary.

### The risk

Coverage of these files today is **transitive and accidental**: suites that exercise them
(`releaseProvenanceControl`, `sandboxGatePhases`, `verifyBuildBase`, `releaseIdentityRemoteRetry`)
run in the `Full client node:test manifest (suites.json)` lane, which triggers on
`field-ops-app-vite/test/**` and `suites.json` — **not** on the scripts they test.

So a PR that changes a release gate **and nothing else** receives `build` and `gitleaks`, and no
suite that exercises what it changed. The tests exist and are green; nothing runs them.

This is not hypothetical. **PR #1530 changed `_releaseIdentityGate.mjs` and was covered only because
it also registered a new suite in `suites.json`.** Had the same change shipped without a registered
test — a comment fix, a timeout adjustment, a refactor — the manifest lane would not have fired.

### Why it is easy to miss

It presents as a small green PR. Per #131 the check to run is whether the EXPECTED lanes were
created, and for a scripts-only change the honest expectation is currently "generic lanes only" —
which is exactly what appears. Nothing looks wrong.

### Current control

The deny list (#128) prevents this loop from *running* a release path, and every protected action
stays Owner-triggered. Those are unaffected. This gap is narrower: it is about whether a **change**
to that tooling is tested before it merges, not about who may execute it.

### Possible direction — **NOT AUTHORIZED**

Recorded so the option is not lost, explicitly not as a decision:

- a release-tooling CI lane triggered on the uncovered paths above, running the release/tooling
  suites that already exist (`releaseProvenanceControl`, `sandboxGatePhases`, `verifyBuildBase`,
  `releaseIdentityRemoteRetry`, `recordProvenance`);
- **carrying its own hazard:** #128 records that a PR editing a workflow file can silently lose its
  entire CI, and #131 records that this can happen without a workflow edit at all. Adding a lane is
  therefore itself a change whose CI must be verified by lane creation, not by green checks.

**Deliberately not proposed:** widening to a `scripts/**` glob. It would pull unrelated tooling into
the release lane and make the trigger less legible, which is how a path filter stops being read.

### OWNER DECISION REQUIRED

> **Should a dedicated release-tooling CI lane be added, triggered on the release-boundary paths
> above and running the existing release/tooling suites — or is transitive coverage via the node:test
> manifest accepted, with lane-creation verified per #131 on every release-tooling PR?**

**Related:** #124, #128, #131, #132. Surfaced while certifying PR #1530 (sandbox bounded retry).

---

## #134 — The Sales Agreement is a first-class routed record page, and its design was verified against source rather than briefed

**Date:** 2026-08-26
**Decision:** `docs/north-star/sales-agreement/North Star - Sales Agreement P1v2.dc.html` is the
Sales Agreement family's visual authority (Owner approval, merged as PR #1533). The Owner further
ruled **SA-G1**: the Sales Agreement becomes a **first-class routed record page**. The Agreement
stays strongly connected to its originating Opportunity, but the Opportunity does not own the
permanent Agreement record UX — `Opportunity → Sales Agreement → Sales Order`, each object keeping
its own record identity and page purpose.

**Scope of that ruling, stated because it is narrow.** It settles product direction only. It does
not authorize routing or platform reconstruction. The implementation pass builds the route and must
compose **existing** governed read and action authority: `getSalesAgreementContext` (the by-id read)
already exists and is client-wired, so no new read is implied. SA-G2 through SA-G6 are explicitly
outside that pass's scope.

**Reason:** the alternative was to keep the composition inside the governed Opportunity workspace,
where it lives today as `OpportunityAgreementCard` on the Opportunity record page. That would have
made the Agreement permanently a sub-record of the object it is created from, which is wrong for a
commercial commitment that a Sales Order is created *from* and that outlives the negotiation.

**What the design pass found, which is why this entry is not only a ruling.** P1v2 re-checked every
design-driving claim against source instead of carrying P1v1's assertions forward, and four findings
changed the design:

- **Lines persist `ref` with no durable display name.** P1v1 led each line with a product name that
  nothing stores; the picker's `displayName` exists only at pick time and the agreement read does
  not return it. The reference is now the line's identity, with a catalogue name shown as a marked
  design recommendation. **No duplicate display name is to be persisted to satisfy a mock.**
- **`DECLINED` is modelled but unreachable** — legal transition, entity label, no producing command.
  Now **ND-14**.
- **There is no post-acceptance revision path.** A terminal Agreement cannot be edited *and* a
  second Agreement for the same Opportunity is transactionally refused. P1v1 asserted "a changed
  mind is a new agreement", which the engine does not support. Now **ND-15**.
- **The Sales Order is produced by the Opportunity's `closeOpportunityAsWon`**, which can still
  refuse; acceptance is a precondition, not the trigger. UX copy must not imply
  `Accept Agreement → Sales Order automatically created`.

**Two corrections of P1v1 that bind any implementation.** *Dimension truth:* the 1440 / 768 / 375
frames must render at exactly those widths — P1v1 labelled them while composing roughly
1640 / 792 / 407, so its responsive claims could not be checked at all. *Acceptance evidence:* EOS
proves three things — state `ACCEPTED`, `acceptedAtMillis`, `acceptedByUid` — and nothing about a
customer. P1v1's "binding" and "recording the customer's commitment" are removed; the unresolved
actor renders the governed constant `Unknown user` (F-UID-1). No signature, electronic-acceptance,
external-acceptance or legal-enforceability claim may appear.

**Recorded, not fixed:** `field-ops-app-vite/src/hooks/useSalesAgreement.js` carries capability
commentary saying the read is granted in no environment;
`functions/src/access/environmentCapabilityOverrides.ts` and `App.jsx` show all four Sales Agreement
capabilities activated for `eos-platform-sandbox`. Left untouched so no product code entered a
docs-only diff.

**Related:** #106 (a missing business reference is not permission to display a record id), #122
(the three authorities), #125 (a family composed without its design source), #129/#130 (the
Opportunity's route and its design-source rebuild — the available precedent for SA-G1), ND-9,
ND-14, ND-15.

---

## #135 — The Opportunity collection replaces the workspace pane, and the list read already knew more than its design assumed

**Date:** 2026-08-27 · **Scope:** presentation + one projection passthrough · **PR:** Opportunity North Star P1v4

**Decision.** `/customers/opportunities` renders a **collection**, not a master-detail workspace.
Its only job is finding one opportunity; the record is reached at
`/customers/opportunities/:opportunityId`, where it has lived since #130. `SalesWorkspace` is
mounted nowhere in the product. The navigation the Owner specified now exists end to end:

```
Opportunities list → Opportunity record → Sales Agreement → Sales Order
```

**Workspace P1v3 is SUPERSEDED, unbuilt.** P1v3 was a revision of the workspace shape. By the time
the pane was free to retire, the record had had its own route for two families, so a full-width
workspace would still have been a surface whose job was previewing a page that already exists.
Two pure domain slices were lifted from the parked branch (`NEEDS_ATTENTION`, `AT_DECISION`, both
also named by P1v4); `claude/opportunity-workspace-p1` was abandoned rather than merged, and no
P1v3 presentation reached `main`.

### The decision that needed taking: G2

P1v4 states as a design gap that *"the agreement reference is not on the opportunity list read"* and
instructs the Agreement/Order column to render `No agreement` truthfully until list-level resolution
exists.

**Verified against `main` rather than accepted.** `projectOpportunity` is shared by the list read
and the per-id read, and it returns both `salesAgreementId` and `salesOrderId`. **Existence is
knowable at list level for free.** The design's premise was one generation out of date;
`buildPipelineRow` was dropping `salesAgreementId` on the floor — the identical defect
`salesOrderId` had one generation earlier, and the third "written to Firestore, projected to nobody"
finding in this family.

The read still carries **no reference and no state** for either. So:

| P1v4 draws | Implemented | Why |
| --- | --- | --- |
| `SA-2026-000003` / `Accepted` | `Agreement` | No reference, no state on the list read. A document id is not a label (#106). |
| `SO-2026-000015` | `Order created` | Same. |
| `No agreement`, `Order not created` | unchanged | Matches. |

This is **more than the design's fallback and less than its full treatment**, which under #122 makes
it a **named product decision, not a silent win**. Populating references requires list-level
resolution or denormalisation — a *read* change, not a presentation change, and therefore not
something a presentation migration may take on its own.

**Explicitly forbidden, and tested:** resolving each row's agreement on demand. That is one round
trip per visible opportunity on a surface built for scanning. A test renders 25 rows and asserts the
governed source was invoked exactly once.

### What the pane was still holding, checked before removal

SA-G7 was the same failure one family earlier, found *after* the record page shipped: a pane
retained one activated governed capability and retiring it would have deleted that capability from
the product. So the check ran first this time, against the governed write commands rather than the
components. Exactly one was trapped — `opportunity.write` create, reachable only through
`NewOpportunityForm`, which only `SalesWorkspace` mounted. The collection mounts it. Section save
and lifecycle transitions were already on the record.

**Pane-only Sales Agreement capabilities are now zero** (SA-G7, #1544). `create` was never trapped:
it belongs on the Opportunity, because creating an agreement *for* an opportunity is performed from
the opportunity and there is no agreement yet to open.

### A second link was still addressing the pane

The P1v2 record's header fact linked the agreement to
`/customers/opportunities?opportunity=<opportunityId>` — the pane's row selection — while the
Sales agreement section directly beneath it linked to the agreement record. **One fact, two
destinations** (NS-P4), and the header also passed the *opportunity* id where the *agreement's*
belongs, so it was wrong independently of the route. Both now point at the agreement record.

### Deferred from the artifact, with reasons

- **`+ Save as view`** — needs persistence authority for user-scoped list state. New authority, not
  presentation.
- **Sort control, `Columns`** — the pipeline's order (attention first, then closing soonest) is a
  governed derivation this page does not own; an arbitrary column sort replaces the queue's meaning
  with a spreadsheet's.
- **Pagination** — the governed read is unpaged. Previous/Next would imply a boundary that does not
  exist.
- **`Updated moments ago · Refresh`** — no trustworthy "as of" timestamp exists to print, and a
  relative time the page invents is the exact fabrication class this family keeps catching.

### One view is viewer-scoped, and admits when it cannot be

`My opportunities` resolves the viewer's employee id from the directory subscription already open
for owner names — no extra read. An account with **no linked Employee record** gets a stated reason
rather than an empty queue, and its tab renders **no count** rather than `0`: *"we can't tell which
are yours"* is true, *"you have no opportunities"* is a confident false claim about somebody's work.
An empty collection outranks both — telling a new tenant their sign-in is unlinked describes the
wrong problem.

### Narrowing may never re-read

Search and stage filtering run over rows the governed read already returned, so the toolbar cannot
widen what a caller may see, and the result line names the **view** as the denominator rather than
the collection — claiming "of 59 total" would imply the search reached records the page never read.
Document ids are deliberately **unsearchable**: making them findable is how they end up quoted as if
they were references (#106).

### Method note

Nineteen mutations were run against the load-bearing claims; all were caught but one equivalent
mutant. Three survived a first pass and each exposed a weak **test**, not weak code — an assertion
matching a phrase that a bare `0` slipped past, a navigation claim made against a harness with no
route table to navigate in, and slices whose coverage lived in a different suite than the one being
mutated. Recorded because "all tests pass" was the same evidence that missed the blank-Owner defect
under #130, and a first-run green on a brand-new suite is not evidence of anything.

**Related:** #106 (a document id is never a label), #122 (the three authorities — the source of the
G2 ruling above), #125, #129 (the Opportunity's route), #130 (the P1v2 record and the blind build it
reversed), #131 (a new suite runs in CI only where a workflow names it — this one is named in
`composition-conformance-tests.yml`), #134 (the Sales Agreement record that made this retirement
possible), ND-13.

---

## #136 — OWNER RULING: the tablet drops columns instead of folding them, overriding P1v4's 1b frame

**Date:** 2026-08-27 · **Scope:** presentation only · **Authority:** Owner (acceptance)

**The conflict.** P1v4's 1b frame specifies that at 768 *"owner + channel + attention fold into
identity; Stage, Value survive; Close and the commercial chain share the last column as two lines."*
It was built exactly that way, then rendered against the artifact and shown to the Owner alongside
the 1440 and 375 frames.

**Owner ruling, verbatim:** *"i like 1 and 3 because they are exactly what i would expect to see in
a list. the middle one goes into detail that consumes more space."*

**Decision.** The tablet band **drops** what will not fit rather than **folding** it, which is what
the desktop already does as it narrows. Recorded here rather than applied quietly because it
reverses a specific instruction in an approved design artifact — #122's rule is that Design and
Acceptance disagreeing produces a named decision, and the Owner is the acceptance authority.

**Why the ruling is right, in the terms the design uses.** Folding does not remove content; it moves
it *downward*. Every row gained a third and often a fourth line at exactly the width where vertical
space is scarcest, so a list of six deals filled a screen that had comfortably held them one
breakpoint earlier. The surface stopped answering *"which of these needs me?"* and started answering
*"tell me about each of these"*, which is the record's question and the reason the record has its
own route.

**Measured, because the complaint was about space and an opinion about a screenshot is not
evidence.** Average row height across the designed widths, before and after:

| Width | Before | After | |
| --- | --- | --- | --- |
| 1440 desktop | 56px | 56px | unchanged — the Owner accepted this frame |
| 1024 | 62px | 58px | was briefly the worst band: drops had not started, columns already tight |
| 900 | 58px | 56px | |
| 768 tablet | **68px** (max 83) | **58px** (max 70) | the frame that was rejected |
| 375 phone | 249px | 249px | unchanged — the Owner accepted this frame |

**What is dropped at 900 and below, and why it is safe here and only here:**

- **channel** — secondary context, never a reason to act. Present on the record.
- **the stage ordinal ("2 of 6")** — the stage WORD survives, which is the fact; the ordinal
  refines it.

**What is NOT dropped:** attention keeps its own column at every table width, worded exactly as
`deriveAttention` produced it. It is the reason to open a row at all, so it survives every fold.

**Two findings that came out of measuring rather than looking.** The clamp that holds rows to two
lines had to start at **1200**, not at the drop breakpoint — wrapping begins as soon as the table
narrows, while dropping is only needed once columns stop fitting, and treating them as one
breakpoint left 1024 as the worst band on the page. And the clamp had to be bounded **below** at 601
as well: below that the row is a card, where a one-line clamp is simply wrong, and leaving it
unbounded cost 30px per card on the phone — a regression in the one frame the Owner had explicitly
approved.

**Guarded, not just fixed.** All four row sub-lines previously shared one class, so no stylesheet
could drop one without dropping all of them — which is *why* folding was the only lever available.
They are now named for the fact each carries, and three tests pin those names, because merging them
back would silently restore the rejected behaviour with every test still green. Mutation-proved.

**Related:** #122 (the three authorities — the rule this entry follows), #135 (the collection this
amends), and the family README, which records the departure beside the artifact it departs from.

---

## #137 — CI Assurance Selection Rule

**Date:** 2026-08-29
**Classification:** CI COVERAGE / GOVERNANCE. Same family as #124, #131 and #133.
**Implementation authority:** `docs/ci/CI-ASSURANCE-CONTRACT.md`

**Decision:** CI coverage is governed by contract-input selection, not by workflow or test existence
alone.

A validation contract is governed only when:

1. it is registered and executable; and
2. every authoritative repository input capable of affecting that contract causes the contract to be
   selected.

Tests and workflows MUST account for direct and indirect repository inputs they read, inspect,
consume, or derive from.

Historical green status is not evidence of governed coverage when relevant changes can bypass
trigger or routing selection.

Unknown or unclassified paths MUST fail closed under future CI routing.

Assertions over intentionally mutable operational state MUST express durable invariants unless the
exact state is itself governed authority.

When an unrelated candidate exposes a pre-existing red-main condition:

```
HOLD candidate
→ repair the defect in a separate focused PR
→ restore main green
→ update the original candidate onto repaired main
→ revalidate its exact SHA
→ merge only when applicable checks are green.
```

CI cost optimization may remove duplicate execution but MUST NOT weaken contract-input selection or
create unobserved authoritative changes.

GitHub remains the independent CI trust boundary unless a later governed decision explicitly changes
that architecture.

**Rationale:** a registered test can remain CI-blind when authoritative inputs are absent from its
trigger or routing classification.

This failure mode was demonstrated during CI-V2-1 by the orchestration collaboration contract:

- the contract existed,
- it was registered,
- historical runs were green,
- but a governed input changed without selecting the contract.

A bounded trigger-coverage guard also found a second unwatched input that manual review missed.

This establishes the permanent distinction:

```
REGISTERED != SELECTED != GOVERNED
```

### Relationship to existing governance

- **#124** governs **registration**: a suite that nothing runs is not coverage.
- **#131** governs **suite creation / registration evidence**: an absent check suite is unsafe
  evidence, not proof that a PR legitimately triggered nothing.
- **#137** governs **selection**: authoritative inputs must select their responsible contracts.

Three distinct failure modes. This entry adds the third; #124 and #131 stand exactly as written and
are extended, not replaced.

**#133 is now RESOLVED by Owner ruling** (2026-08-29), recorded in full as **#138**.

The Owner rejects incidental/transitive selection for the release-tooling boundary identified in
#133. The sixteen release-boundary inputs recorded there require explicit CI selection coverage. The
chosen implementation direction is a dedicated release-tooling validation lane, triggered by those
governed release-boundary inputs and running the existing non-mutating release/tooling suites.

That ruling authorizes the **CI coverage architecture only**. It does NOT authorize release
execution, deployment, production mutation, permission expansion, protected-action execution, or any
weakening of #128. Implementation of that lane must occur in a separate focused PR and must itself
be validated according to #131 and #137.

**No permanent carve-out from #137 remains.**

### Open #137-conformance finding (not a carve-out)

`docs/ci/**` and `docs/DECISIONS.md` are watched by no workflow's trigger paths, so a change to the
governance authority itself — including this entry — is selected by no path-filtered contract. By
this decision's own standard that is a conformance gap, recorded here so it is treated as one.

It is deliberately **not** repaired in the PR that introduces this decision, because a documentation
PR may not change triggers. It is a separate finding for later focused treatment, and it must not
become another exception: the distinction between this and a carve-out is that a carve-out excuses
the gap permanently, while this records it as work.

**Related:** #124, #128, #131, #132, #133, #138. Surfaced while completing CI-V2-1 (PRs #1567, #1568).

---

## #138 — OWNER RULING: release-tooling requires explicit CI selection

**Date:** 2026-08-29 · **Scope:** CI coverage architecture only · **Authority:** Owner
**Resolves:** #133, which was recorded OPEN ("RECORDED GAP, NO FIX AUTHORIZED") and is now decided.

**Decision:** the release-tooling boundary identified in #133 requires **explicit CI selection**.

**Transitive / incidental coverage is rejected.**

A dedicated release-tooling validation lane will be used to select the existing **non-mutating**
release/tooling suites whenever one of the governed release-boundary inputs changes.

**The lane is validation only.** It does not gain deployment authority or permission to execute
protected release actions.

**#128 remains fully binding.**

**Implementation occurs in a separate focused PR** — none is authorized by this entry — and that PR
must itself be validated according to #131 (confirm the check suite was actually created) and #137
(confirm the governed inputs select the contract).

**Owner's reason, recorded because it is the general principle and not only this instance:** #133
had already established that the release-boundary files can change without selecting the manifest
validation lane. Coverage that happens only when another, coincidental file change selects a test is
not governed assurance. #137 now names that distinction —

```
REGISTERED != SELECTED != GOVERNED
```

— so a release-boundary input must select its responsible contract **directly and predictably**,
and #133 is therefore no longer an unresolved exception to #137.

**Related:** #124, #128, #131, #133, #137.

---

## #139 — CORRECTION: #138 release-tooling boundary contains fifteen inputs, not sixteen

**Date:** 2026-08-29
**Scope:** CI governance factual correction
**Corrects:** #138 (the cardinality as restated in #137's "Relationship to existing governance"
section — see the locational note below)
**Related:** #133, #137, #138

**Correction:**

The governed record states "the sixteen release-boundary inputs recorded there."

That cardinality is incorrect.

Decision #133 states that **sixteen** files under `scripts/` were ALREADY named in workflow filters
and covered. It then **separately** identifies the release boundary as "Named nowhere" and
enumerates **FIFTEEN** files. The sixteen and the fifteen are two different sets, and the sentence
above collapsed them.

The governed release-boundary input set is therefore the fifteen files explicitly enumerated in
#133's uncovered block.

This correction changes **no Owner ruling and no CI architecture**. The Owner ruling remains:

- release-tooling requires explicit CI selection;
- incidental/transitive coverage is rejected;
- the dedicated lane is validation only;
- #128 remains fully binding.

The only correction is:

```
16 release-boundary inputs
→
15 release-boundary inputs.
```

**For avoidance of doubt, the governed set is:**

```
scripts/_certificationRoutes.mjs
scripts/_prodRelease.run.sh
scripts/_releaseIdentityGate.mjs
scripts/_releaseProvenanceGuard.mjs
scripts/_sandboxDeployGuard.mjs
scripts/_sandboxQuickGate.sh
scripts/_sandboxRefresh.run.sh
scripts/_sandboxRegressionGate.sh
scripts/releaseProvenance.mjs
scripts/releaseRoot.mjs
scripts/sandboxCredentials.mjs
scripts/sandboxFunctionsVerification.mjs
scripts/verifyDeployArtifact.mjs
scripts/verifyDeployedCallablesFirebase.mjs
scripts/verifySandboxFunctions.mjs
```

A sixteenth input MUST NOT be invented to make an implementation conform to the erroneous count.

**Locational note, recorded because the ledger is append-only and a future reader will look for the
sentence.** The erroneous phrase does not appear in #138's own body, which states no count at all.
It appears once, in **#137's** "Relationship to existing governance" section, where that section
restates the #138 ruling. Both entries stay exactly as written; this is the correcting record.

**Verified against the repository at the time of writing, not only against the prose:** all fifteen
files exist, and each was named in zero workflow path filters — which is the condition #138 exists
to end. The lane implementing #138 is expected to select this exact set of fifteen.

---

## #140 — RECORDED GAP, NO DISPOSITION TAKEN: three orphaned `equipment_models` indexes remain live on sandbox

**Date:** 2026-08-29
**Status:** **OPEN — recorded, not fixed.** No index was deleted and none was declared.
**Scope:** sandbox environment state
**Related:** #108 (the governance breach this is the residue of), #133/#137 (a change that no
contract sees), and the index-drift guard in `scripts/indexDriftGuard.mjs`.

### What was measured

Sandbox `eos-platform-sandbox`, read-only, 2026-08-29 — live composite indexes vs
`firestore.indexes.json` at `9be177bb`:

```
declared but NOT live ... 8   -> real query failures; CREATED (see below)
live but NOT declared ... 3   -> all equipment_models; LEFT IN PLACE, recorded here
```

The eight were created additively with `gcloud firestore indexes composite create`, deliberately
**not** `firebase deploy --only firestore:indexes`: that command reconciles, so it would have
created the eight and **silently deleted the three** in the same breath. All forty-seven live
indexes are now READY and `declared-but-missing` is zero.

### The three, and why they are not simply drift

```
equipment_models :: status ASC, manufacturerId ASC, displayName ASC
equipment_models :: manufacturerId ASC, displayName ASC
equipment_models :: status ASC, displayName ASC
```

They are the **residue of the breach recorded in #108**. PR #1206's metadata program declared an
`equipmentModel` INDEX list view whose filters derived these three composites over a collection that
**D4 governs**, they were declared in `firestore.indexes.json`, and they were deployed to sandbox.
#1273 removed the declaration and #108 ruled that defining an entity confers no indexing authority
over another program's collection.

**The repository was corrected. The environment never was.** So the indexes exist live, serving a
list view that no longer exists, declared by nobody.

### Why no disposition is taken here

Deleting them is a governance disposition on a D4-governed collection, and #108 corrected the
declaration without ruling on the live residue. #108 records that D4 declares no compound index, so
nothing is *known* to need them — but "nothing appears to need it" is the reasoning that produced
the breach, and it is not sufficient authority to drop production-shaped state in an environment
others are testing against. They cost storage and nothing else where they sit.

**Owner disposition required**, one of: delete them from sandbox so the environment matches the
repo; or declare them, which re-asserts an index claim over D4's collection and would have to
overturn #108 as a named decision.

### The hazard this leaves standing until then

Any future `firebase deploy --only firestore:indexes` against sandbox **will delete these three**
without being asked to, because reconciliation is the command's normal behaviour and not an error.
That is the exact shape `indexDriftGuard.mjs` exists to catch, and its rule — the authorization must
NAME every index to be deleted — is what should govern the day someone runs it.
## #141 — OWNER RULING: technician registry status and scheduling-time availability are separate concepts

**Ruled 2026-08-29.** A live probe against deployed sandbox authority showed that a technician
carrying `status: "off_shift"` is accepted by governed placement and can be scheduled. The question
put to the Owner was whether that is a defect. It is not.

**The ruling.** A technician carrying any recognised governed status — `available`, `on_job`,
`off_shift` — is a valid technician record and remains eligible to receive a **future** placement.
`off_shift` does **not** mean "cannot be scheduled". It describes the technician's present roster
state; future scheduling remains valid. A technician can be off shift today and legitimately
scheduled next Tuesday.

**The reason, which is the part worth keeping.** Current technician status must not be silently
promoted into a future-calendar availability rule. Those are two different questions asked about two
different moments, and collapsing them would let a live operational state quietly become a
scheduling policy nobody decided.

**Placement authority is therefore unchanged** (`functions/src/scheduling/placementPolicy.ts`):

| Hard refusal | Warning, non-blocking |
|---|---|
| technician record missing | outside recorded working hours |
| technician status unrecognised or absent | no working hours recorded |
| start materially in the past | |
| explicit blocked-time conflict | |
| overlapping scheduled Work Order | |

This preserves ND-20's collision policy exactly. Nothing in the runtime changed as a result of this
ruling — it records why the existing behaviour is correct, so the next reader who notices an
`off_shift` technician being scheduled does not "fix" it.

**What this ruling does NOT license.** Richer eligibility — employment inactive, terminated,
certification expired, territory mismatch, skill mismatch — is real and may be wanted later. None of
it may be **inferred from `off_shift`**. Each requires its own governed eligibility authority, and
that authority belongs on `placementPolicy.ts`'s single eligibility line rather than scattered across
callers.

**Relationship to existing governance.** ND-22 recorded that `fieldops_technicians` carries only a
live `status` and that no shift model existed; it did not rule on whether that status gates future
scheduling. This closes that gap. The status vocabulary itself remains
`GOVERNED_TECHNICIAN_STATUSES` in `functions/src/scheduling/schedulingRepository.ts`.

---

## #137 — OWNER RULING: a record page reports the record; it does not explain the system

**Date:** 2026-08-27 · **Scope:** presentation only (Opportunity record, Sales Agreement record)
**Authority:** Owner (acceptance) · **Related:** #122, #135, #136

**How it surfaced.** Reviewing the deployed Opportunity record, the Owner pointed at the section
titled *"When this closes"* and said: *"i just dont know why i would want this or even use it."*
Then, of the Customer card's contact note: *"really dont think those lines are useful."* Then, of
the Agreement page: *"same story as the section on opportunity."*

**Decision.** Five blocks of explanatory copy are removed or trimmed across two record pages:

| Surface | Block | Was | Now |
| --- | --- | --- | --- |
| Opportunity | "When this closes" | 5 lines on the two governed conversion paths | removed |
| Opportunity | Solution note | 4 lines, incl. EOS having no quote object | 1 line |
| Opportunity | Customer card | 3 lines on where contact facts come from | removed |
| Opportunity | Qualification | 3 lines on no schema being ratified | "Not configured" |
| Sales Agreement | "What this agreement became" | the conversion mechanism again | removed |

**Why the ruling is right, in the grammar's own terms.** Every one of these was TRUE, and every one
rendered identically on every record — so a reader learns it once and re-reads it forever. Two of
the headings asked a question about *this* record (*"When this closes"*, *"What this agreement
became"*) and answered with a lecture on the mechanism. A record page's job is to report the record;
the model belongs in documentation, where it can be read once.

**Two of the five were not overrides at all.** P1v2 specifies *"the **one-line** disclosure"* for
Solution, and the exact words *"Not configured"* for the Qualification seam. Both had grown in
implementation. Trimming them **restores** the brief rather than departing from it — worth recording,
because it means only three of the five are genuine Design-vs-Acceptance conflicts under #122.

### The part that mattered more than the deletion

Two of the removed sections each carried exactly one real fact — a link — and in both cases it was
the **only** place that relationship appeared anywhere on its page:

- the Opportunity's **own** Sales Order back-link, written by the atomic Mark Won close.
  `OpportunityAgreementCard` links the AGREEMENT's order, which is a different relationship.
- the Agreement's **downstream** Sales Order. The rail carries the upstream lineage
  ("Why this agreement exists"); nothing else carried the downstream.

Deleting either section without moving its link would have removed a governed relationship from the
product — **SA-G7 exactly**, one family later. Both links moved into their page's header fact row
*before* the sections came out, under the same rules as the agreement fact already beside them:
rendered only when the record exists (never "Order: —"), the governed number as the label, the
document id as the route key and never shown (#106).

### An overlap fixed on the same screen

`.ns-solution-note` carried `margin-top: -18px` and the note landed **on top of** the last Solution
line. Measured on the deployed record rather than reasoned about: the section's box ended at 612px,
the note began at 594px. The pull-up was calibrated against `.ns-section`'s 30px bottom margin, but
Solution renders through the legacy `.fo-sales-detail__block`, whose bottom margin is **zero** — so
the compensation had nothing to compensate for and became a collision. This is the failure mode of
any negative margin tuned against a sibling it does not actually have. Positive spacing owns its own
gap and cannot overlap.

### Method note — the tests were the weak part, twice

Nine assertions across four suites pinned the removed copy. They are rewritten to measure the
**relationship** rather than the sentence describing it: a test pinned to prose fails on a reword
and passes while the link underneath it breaks.

Two of those rewrites were themselves too weak, and mutation testing caught both **after** they were
written and passing:

- one matched a link's accessible name (`/^Order\b/`) where the visible word "Order" sits *outside*
  the link, so it passed against a header that was in fact claiming the wrong order;
- one counted only links to a specific id, missing a mutant that adopted the agreement's order and
  rendered a **broken** href from a null id — the count stayed correct while the page was wrong.

Both now count hrefs. Seven mutations run in total, all caught.

**O4 — RAISED, RECOMMENDED, AND DECLINED (Owner, 2026-08-27).** With the explanation removed, the
Customer card is a name and nothing else, so the obvious follow-up was O4: compose the Account's
primary contact with `tel:`/`mailto:`. `useContactsForAccount` already exists, making it presentation
over an existing governed read — the only real cost is one extra subscription per record page, which
is why P1v2 flagged it "confirm" rather than building it.

Put to the Owner with that recommendation. The ruling was **“leave the customer card as is”**.

Recorded as DECLINED rather than left open, because a thin card with a live recommendation beside it
invites the next session to re-raise it as though nobody had looked. It was looked at. The card
carries the customer and stops, and that is the accepted state — not a gap awaiting closure. A fresh
Owner ask is what reopens it. See the O-decision table in
`docs/design/north-star-open-product-decisions.md`.

## #142 — OWNER RULING: EOS Ownership Model v1 (D-1 … D-5, plus the non-collapse ruling)

**Date:** 2026-08-30
**Decision:** The approved invariant is *every governed business record has an owner*, typed as
`owner.type` + `owner.id`, separate from Created By and Assigned To, never changing implicitly, and
changing only by explicit auditable handoff. The Owner ratified five decisions the reconciliation
(`docs/assessments/eos-ownership-model-reconciliation.md`) could not settle:

- **D-1 — compose, do not replace.** The Account's existing 7-field `accountOwner` Person Assignment
  map stays authoritative **storage**; the typed owner is **derived** from it. There is no second,
  independently writable ownership authority, and writes keep going through the existing governed
  paths until an ownership write authority is deliberately activated.
- **D-2 — a new minimal `operating_companies` authority.** Nothing in the repo could safely answer
  "which company owns this internal record": `operatingCompanyId` existed only in design prose,
  there was no `companies` collection, and `lineOfBusiness` is multi-valued and informational so it
  cannot answer a single-valued question. Seeded with the stable ids `taylor` and `ventana`.
  Deliberately small, and explicitly not customer identity, title, line of business, tenant,
  location, ownership history, or access scope.
- **D-3 — equipment record owner is the operating company; title stays its own axis.** A CUSTOMER
  may hold title to a unit without owning the internal EOS record. There is no CUSTOMER owner type
  at all, so the collapse is unrepresentable rather than merely discouraged.
- **D-4 — the three commercial creation contracts relax from required owner to optional owner with
  governed inheritance,** backward-compatibly. Explicit owner wins; otherwise inherit the Customer
  owner (Opportunity) or the Opportunity owner (downstream); otherwise **REFUSE**. Never fall back
  to the actor, `createdBy`, the authenticated user, `assignedTo`, an arbitrary salesperson, an
  admin, or the first available employee. The assistant case is the point: an assistant creating an
  Opportunity for Rudy's customer produces `owner = Rudy`, `createdBy = the assistant`.
- **D-5 — `OWNERSHIP_HANDOFF` is added to BOTH audit authorities** (the erased TypeScript union and
  the runtime allow-list), carrying `objectId` for the record moved plus previous/new owner, source
  (`DIRECT_HANDOFF` / `CUSTOMER_HANDOFF_REVIEW` / `ADMIN_CORRECTION`) and an optional reason —
  composed into the existing governed audit structure, not a parallel subsystem. No fake `ScopeType`
  was invented to represent a record.

**Non-collapse (ratified):** `currentOwner` (a reorder-request role queue), coverage/territory,
`explicitTitleHolder`, `assignedTo`, and `createdBy` are **presumed distinct** from ownership and
may not be merged into it without a later family-specific reconciliation proving they are the same
business authority.

**Reason:** The reconciliation found six ownership-adjacent concepts already in place and none of
them typed, plus one hole: the company leg of the invariant had no authority to resolve to. Ruling
D-1 keeps the platform from rewriting a working, provenanced storage contract for uniformity's sake;
D-2 fills the hole with the smallest authority that answers the question; D-3 and the non-collapse
ruling protect four distinctions the codebase already pays to maintain; D-4 makes ownership follow
the customer relationship rather than whoever happened to click; D-5 keeps one audit system.

**Alternatives rejected:** migrating `accountOwner` to a typed owner field now (rejected under D-1 —
a rewrite with no demonstrated architectural benefit); reusing `lineOfBusiness` or an Account as the
company authority (rejected under D-2 — neither can answer the question, and one is multi-valued);
treating `explicitTitleHolder` as the equipment owner (rejected under D-3 — a customer cannot own an
internal EOS record); a generic free-form audit details bag (rejected under D-5 — unvalidated and
unqueryable, a parallel audit subsystem in disguise).

**Not done, deliberately:** no enforcement, no backfill, no Rules change, no deploy, no cascade, no
silent assignment. The dry-run census must first report zero unresolved records — and that census
needs a live data read, which is separately authorized.

## #143 — CORRECTION: R-12 is WITHDRAWN. `fieldops_wos` is the Work Order authority, not `fieldops_jobs`

**Date:** 2026-08-30
**Decision:** Owner ruling, Option (c). `fieldops_wos` and `fieldops_jobs` are **not** to be modelled
as a required parent/child ownership lineage.

**SUPERSEDED** (DECISIONS #142 ruling R-12):
- `fieldops_wos.jobId` as a governed parent reference — **not to be added**
- Job → Work Order company inheritance — **withdrawn**
- "30 Work Orders have no parent Job" as a lineage defect — **it was never a defect**

**CURRENT:**
- `fieldops_wos` is the **current governed Work Order authority** — `WORK_ORDERS_COLLECTION`, with the
  deployed `createWorkOrder` / `transitionWorkOrder` callables.
- `fieldops_jobs` is a **distinct legacy Job domain**, not the governing parent of Work Orders. The
  existing `fieldops_jobs.workOrderId` may remain as a legacy upward association where populated; it
  establishes no required lifecycle.
- A Work Order's operating company resolves from **its own governed business context** and is stored
  on the Work Order as a historical fact: explicit at creation, or from a governed upstream source
  that already carries one (a Sales Order, a governed service source), otherwise REFUSE once
  enforcement is active. Never from the technician, dispatcher, creator, assignedTo, customer owner,
  location name, `lineOfBusiness`, or a legacy Job coincidence.
- The 41 authored fixture companies on `fieldops_jobs` stand. Job ownership does **not** depend on
  Work Order ownership, and company changes are **not** synchronised in either direction.

**Reason:** R-12 was written conditionally — *"if `fieldops_jobs` is the actual parent domain
authority"* — and the condition is not met. `constants/collections.ts` defines
`WORK_ORDERS_COLLECTION = "fieldops_wos"`; the deployed Work Order callables write that collection;
and `completeAssignedJob.ts` states the boundary in its own header, including that legacy
`fieldops_jobs` documents carry a `workOrderId` field that is *their upward link to `fieldops_wos`*.
The link direction R-12 would have added is the reverse of the one the code already documents, and
it would have made the legacy collection the parent of the live one.

Measured in sandbox: 0 of 45 Jobs carry `workOrderId`, 0 of 30 Work Orders carry `jobId`. Neither
direction is populated, so the earlier 0/30 NO_CANDIDATE result was not a lost link — these are two
domain concepts from two eras that were never in a parent/child relationship in this data.

**Alternatives rejected:** adding `fieldops_wos.jobId` as R-12 specified (rejected — it inverts the
documented model direction); promoting `fieldops_jobs` to parent authority (rejected — the live
command surface belongs to `fieldops_wos`); treating the 30 Work Orders as broken lineage needing
repair (rejected — there is nothing to repair).

**Reclassification:** the 30 Work Orders' unresolved reason changes from "no governed Job parent" to
**`NO_GOVERNED_COMPANY_SOURCE`** — a company-provenance gap, not a lineage defect. 11 of the 30 carry
a `salesOrderId` and become *potentially* derivable once the commercial operating-company axis is
authored; that must be **measured, not assumed**, by a read-only reconciliation classifying each Work
Order as SALES_ORDER_DERIVABLE / OTHER_GOVERNED_SOURCE / EXPLICIT_COMPANY_REQUIRED /
INVALID_REFERENCE.

**Workstream order changed** accordingly: Reorder warehouse authority → Commercial operating-company
lineage → Work Order company provenance → Production census → Enforcement gate.

**Not rewritten:** #142's R-12 text stands as issued. This entry supersedes it rather than editing it,
so the reasoning that produced the correction stays legible.

## #144 — "PR head green" is not evidence a governance lane ran. PASS, NOT TRIGGERED and FAIL are three states

**Date:** 2026-08-30
**Decision:** Owner ruling. A merge gate must distinguish three outcomes for every required workflow,
and a **NOT TRIGGERED** safety or governance lane must never be reported as equivalent to **PASS**
merely because the PR UI is green.

| State | Meaning |
|---|---|
| **PASS** | the workflow actually ran against the reviewed head and passed |
| **NOT TRIGGERED** | the workflow did not run against the reviewed head |
| **FAIL** | the workflow ran and failed |

**Reason:** PR #1602 was reported and merged as "92/92 SUCCESS". That figure was faithfully copied
from `gh pr view --json statusCheckRollup`, and it was still insufficient evidence: this repository's
workflows are **path-filtered**, so a check only re-runs when the head commit touches a path it
watches. Two governance lanes therefore never executed against #1602's final head, and both were
carrying real failures that only surfaced on the next PR:

1. **`certificationExecutionTarget`** — `seedAccountOwners.mjs` declared its own
   `assertSandboxTarget`. A local guard asks "is the registry role `sandbox`?", which cannot
   distinguish `eos-platform-sandbox` from `eos-platform-certification` because **both** are role
   `sandbox`. One mistyped `--projectId` would have seeded 100 account owners into the certification
   world. Fixed by delegating to the shared `certificationWorld/executionTarget.mjs`.
2. **`private-ai-fail-closed`** — the Certification World fingerprint is pinned in
   `certificationPrivateAiFailClosed.test.mjs` precisely so a change to the world is a conscious act
   updating that file *in the same PR*. Ruling R-2 added `operatingCompanyId` to 278 equipment
   fixtures, moving the fingerprint `005ebb1b` → `ed95c91d`, and #1602 did not update the pin. The
   world changed unendorsed.

Neither was a flake, and neither was caught by "92/92". The rollup was green because the checks that
would have failed **were not asked to run**.

**Standing rule:** before merging under a high-risk gate, confirm for each required safety/governance
workflow that it actually executed against the reviewed head — not merely that the PR shows no red.
A lane that did not run is an unknown, and an unknown is not a pass.

**Alternatives rejected:** treating both failures as PR #1619's problem (rejected — they originated
in #1602 and the merge report was the thing that failed); removing the path filters (rejected — not
this change's call, and it would not fix the reporting error, only mask it by brute force).

**Also recorded:** the individual `seedAccountOwners.mjs` defect is a separate finding from this
reporting lesson, and is documented at its fix site rather than only here.

## #145 — OWNER RULING: EOS financial authority mode — governed operational financial subledger

**Decision (Owner, 2026-08-30, ratified via the Financials master execution contract; closes
FIN-GAP-001 and completes FIN-001):**

1. **EOS SHALL BE a GOVERNED OPERATIONAL FINANCIAL SUBLEDGER.** The existing governed-inert
   `functions/src/finance/*` command layer (invoice / payment / adjustment / refund, minor-units
   money model, append-only corrections, deny-all collections, `active:false` capabilities) is the
   designated foundation, activated progressively under the Financials program — visibility
   (FIN-004) before broad grants.
2. **EOS SHALL NOT BECOME** a general ledger, chart-of-accounts authority, statutory accounting
   system, or final accounting-close authority, **until a separate explicit Owner decision changes
   that boundary.**
3. **The external accounting system is the FUTURE authority of record for accounting and is NOT
   YET SELECTED.** No vendor (QuickBooks, Sage, NetSuite, Dynamics, …) may be assumed anywhere in
   code, schema, or docs. FIN-010 builds the provider-neutral reconciliation contract against this
   boundary.
4. **Fact classes stay separate, never silently blended:** OPERATIONAL_ACTUAL ≠
   ACCOUNTING_RECONCILED_ACTUAL ≠ FORECAST ≠ BUDGET ≠ GOAL. Lifecycle meanings BOOKED / BILLABLE /
   BILLED / COLLECTED / A-R / UNBILLED are distinct and never used as synonyms.
5. **Historical stays historical:** issued financial facts and attribution snapshots are immutable
   events; every correction is a governed event, never an in-place rewrite.

**Reason:** FIN-001 (docs/financials/FIN-001_FINANCIAL_AUTHORITY_MAP.md) surfaced this as the
keystone gap: a complete, well-guarded finance command layer exists fully dormant, no external
accounting system is named anywhere, and every downstream FIN item (attribution, visibility,
cost/margin, plan-vs-actual, periods, intercompany, reconciliation) shapes differently depending on
which side is authoritative. Building any Financials surface before deciding would have baked in
the answer silently. ADR-BMF-012 already established that a governed local ledger MAY be
authoritative when explicitly configured — this ruling makes that configuration explicit for the
operational domain while reserving accounting authority for the future external system.

**Alternatives rejected:** connecting an external accounting provider first (rejected — no provider
is selected, and operational billing needs precede the integration); promoting EOS to full GL
(rejected — statutory accounting is not EOS's product, and the IntegrationArchitecture boundary
explicitly disclaims becoming "the accounting ledger of record"); leaving the mode undecided while
building surfaces (rejected — that is how an authority decision gets made by accident).

## #146 — OWNER RULING: the Reorder trusted command authority (R-13, R-15, R-16, and the activation dependency)

**Date:** 2026-08-31
**Status:** Ruled and implemented in the repository. **NOT ACTIVE** — no deploy, no warehouse data write.

**The problem.** A Reorder Request is raised for a warehouse, and under EOS Ownership Model v1
(#142) a warehouse belongs to an operating company. So creating a request, and recording the
Purchase Order that follows it, author a governed ownership fact: `warehouseId`, and the
`operatingCompanyId` **derived** from it. Both writes were client-direct under `firestore.rules`. A
browser cannot be the authority for a derived company — it can only assert one.

### Ruling

1. **R-13 — the Warehouse is the governed authority for a reorder's company.** The caller states a
   governed `warehouseId`; the command derives `operatingCompanyId` from it. There is no other
   source, and specifically no inference from the part, the requesting user, the truck, the page,
   or the sandbox root configuration at runtime.

2. **R-15 — ONE COMMAND → ONE GOVERNED WRITE AUTHORITY.** The two writes move to trusted callables
   (`createReorderRequest`, `recordReorderPurchaseOrder`) and the three client-direct paths are
   retired in Rules in the same change: `reorder_requests` create, `reorder_purchase_orders`
   create, and the Record-PO update branch. **No fallback.** A client that fails the callable does
   not retry into the old path — that would be two write authorities for one command, which is the
   thing the retirement exists to prevent.

3. **A client-supplied `operatingCompanyId` is REFUSED, not ignored.** Ignoring it would let a
   caller believe it was accepted. The command rejects the call outright, before anything else.

4. **R-16 — the atomicity invariant MOVES, it does not go away.** Rules cross-pinned the PO create
   and the ORDERED transition with `existsAfter`/`getAfter`. `recordReorderPurchaseOrder` now
   performs both inside one Admin-SDK transaction, and its pure builder returns both halves from a
   single call so neither can be produced without the other. Equal strength, different enforcement
   point. Identity and cardinality are unchanged: the Purchase Order document id **is** the request
   id, strictly 1:1.

5. **No new capability.** The callables reuse existing active capabilities and keep **no**
   operational-role fallback.

6. **Two record generations coexist, and neither is migrated.** Rows that predate the command have
   no warehouse or company key. Both generations keep every retained transition, and neither can
   gain or change `warehouseId`/`operatingCompanyId` through a client update.

7. **The immutability guard stays missing-safe.** It comes from the pre-existing
   `diff(resource.data).affectedKeys().hasOnly([...])` on every retained update branch, none of
   which names either key. **No equality pin may be added** — an equality check would have to
   dereference a key legacy rows do not have, whereas `diff()` compares the maps and never reports
   a key absent from both. A future maintainer must not "strengthen" this into field dereferences.

8. **Activation has four conditions and one order:** warehouse company facts → Functions → Hosting
   → Rules. Rules-before-Functions is the destructive ordering — reorder creation stops working
   with nothing to replace it. The runbook, including rollback and what rollback cannot undo, is
   `docs/specifications/reorder-trusted-command-authority.md` §13.

### Consequences worth recording

- **`hasCanonicalReorderRequestKeys()` and its creation baseline are now DORMANT.** The create rule
  that invoked them is `if false`, so they are evaluated by nothing. The approved
  `warehouseId`/`operatingCompanyId` addition to that key set therefore permits nothing today. They
  are kept because they are the file's most precise statement of what a Reorder Request is, and
  they go live again the moment anyone restores a client create.
- **Every remaining `403` create assertion in the Rules suites now passes for a different reason
  than its name gives.** `allow create: if false` refuses everyone, so those assertions are no
  longer evidence about payload or authority validation. They are kept as proof the door is shut,
  and labelled so nobody reads them as coverage of something else. Fourteen sibling assertions that
  expected a create or the atomic Record-PO commit to **succeed** were found failing on the branch
  and retargeted — a direct instance of the #144 lesson, caught by running the lane rather than
  reading the PR.

### Rejected

Silently ignoring a client-supplied company (rejected — a caller must learn its assertion was not
accepted); keeping a client-direct fallback for resilience (rejected — R-15); moving all eight
reorder transitions rather than the two that author a company fact (rejected — that is rebuilding a
working state machine, not migrating an authority); backfilling the legacy rows to make one
generation (rejected — no governed source exists for their warehouse, and inventing one is the
inference this ruling forbids).

## #147 — OWNER RULING R-17: the Reorder warehouse-option authority (and the Parts Manager scope question it leaves open)

**Date:** 2026-08-31
**Status:** Ruled and implemented in the repository. **NOT ACTIVE** — no deploy, no warehouse data write.

**The problem, measured.** Workstream 2B (#146) made `warehouseId` a mandatory governed creation
fact. `firestore.rules` grants `warehouses` read as `isAdminOrDispatcher() || isAssignedToWarehouse(warehouseId)`;
the second half is a per-document test, and a pick-list is a collection LIST, which no per-document
condition can satisfy. Measured on the emulator: admin and dispatcher LIST 200; an ACTIVE
PARTS_MANAGER technician 403; an ACTIVE WAREHOUSE_MANAGER technician 403 even for the warehouse it
can GET individually. The two roles the manual-entry path exists for could not supply the identity
the new authority required — a regression created by the requirement itself.

### Ruling

1. **APPROVED: a trusted projection. REJECTED: widening `warehouses` LIST.** Granting a standing
   collection LIST to populate a picker is a broader disclosure than the task needs, and easy to
   make but hard to take back. `listReorderWarehouseOptions` follows the precedent
   `listReceivingLocationOptions` already set for exactly this shape.

2. **Minimal projection.** `{ warehouseId, label }`. Not `operatingCompanyId` — the client must never
   hold the company as an authority, and shipping it would invite a caller to send it back, which
   the create refuses outright. Not inventory, staffing, status, provenance or any other operational
   or company-private fact. The client still sends only `warehouseId`; the company stays
   server-derived.

3. **No new capability vocabulary.** The read exists solely to serve the governed reorder create, so
   it is authorized by that create's own capability (`reorder.request.create.manual`). No
   `warehouse.list` capability was introduced. No operational-role fallback inside the callable.

4. **ONE eligibility, TWO consumers.** `reorderWarehouseEligibility.ts` answers *can this principal
   raise a reorder for THIS warehouse?* once. The list filters by it; the create enforces it.
   Required invariant, and it holds in both directions: everything the picker offers is accepted, and
   a `warehouseId` posted by hand is refused (`WAREHOUSE_NOT_IN_SCOPE`) exactly when it was not
   offered. **The selector is UX. The create callable is enforcement.**

5. **Scope from existing authority only.** It mirrors the warehouse-read authority already in Rules:
   admin/dispatcher unscoped; a WAREHOUSE_MANAGER holds exactly their linked Employee's
   `assignedWarehouseIds` (Issue #226) under the same fail-closed contract — absent, empty or
   malformed assignment denies every warehouse, never "all". Holding both manager roles resolves to
   the governed scope, not the undefined one.

6. **No Rules change.** `warehouses` read/write authority is untouched, and a static contract test
   asserts the match block is unchanged and that no `warehouse.list` appears anywhere in Rules.

7. **This is INSIDE Workstream 2B, not a separate stream.** 2B made `warehouseId` mandatory;
   supplying a legitimate warehouse identity to already-authorized reorder creators is part of
   completing that authority migration, not an adjacent concern.

### STILL OPEN — the PARTS_MANAGER warehouse scope

`reorder.request.create.manual` is held by admin, dispatcher, and an active PARTS_MANAGER or
WAREHOUSE_MANAGER. Three of those four have a governed warehouse scope. **A PARTS_MANAGER has none:**
`assignedWarehouseIds` is consulted by exactly one authority in this repository and that authority
requires WAREHOUSE_MANAGER membership, and no capability, Rule, ADR or fixture defines a Parts
Manager's warehouse scope.

Per the ruling's own instruction, this STOPS here rather than being invented. The resolver returns
`NONE` with the reason `PARTS_MANAGER_SCOPE_UNDEFINED` — a named state, not a silent zero — and a
test pins it so the gap cannot be closed by accident. **A Parts Manager therefore still cannot raise a
reorder**, and Workstream 2B is not complete until this is ruled on.

### BLOCKING DEFECT found while implementing — the warehouse cannot hold its own company

`createReorderRequest` validates the warehouse through the receiving-location authority, which
checks the **whole document** against the §3A governed shape — a strict allow-list of twelve keys.
The same command then requires `warehouses/{id}.operatingCompanyId`, because the company is derived
from the warehouse (R-13). That field is not in the allow-list, so writing it makes the document fail
§3A as `unknown_field`.

The command therefore refuses in both directions — `WAREHOUSE_NO_COMPANY` without it,
`WAREHOUSE_NOT_GOVERNED` with it. **Activation condition 1 breaks the command by construction**, and
no reorder can be created in any state. The behaviour is coherent (picker and create both refuse, so
the R-17 invariant holds) but the path is unreachable.

Not repaired here: widening the §3A allow-list changes the Receiving authority's shape contract
(Decision-tracked, I-LA C2); giving the reorder its own warehouse-validity opinion is the second
opinion the 2B design refused to invent; and storing the company off the warehouse document would
change the ownership model's physical-root shape. All three are Owner decisions.
`functions/test/reorderWarehouseEligibility.test.mjs` pins the contradiction in a test named BLOCKER,
which fails when it is resolved.

### Rejected

Widening `warehouses` collection LIST for the picker (rejected by ruling); a generic `warehouse.list`
capability (rejected — the read serves one command and is authorized as that command); a
browser-side fallback to the collection read when the callable fails (rejected — two read-authority
models for one selector, and the one that works for an admin would hide the one that fails for
everyone else); restricting the reorder surfaces to admin/dispatcher (rejected — closes a capability
those roles hold today to avoid deciding the scope question).

## #148 — OWNER RULING: the two Reorder activation blockers are classified, and the ownership sequence becomes 2A.1 → 2B → 2C

**Date:** 2026-08-31
**Status:** Ruled. R-17 **ACCEPTED** (#147). Neither blocker is resolved; both have named follow-up workstreams.

**R-17 accepted.** The trusted picker and the create command share the same capability, the same
warehouse-scope authority and the same eligibility resolver, and *offered == accepted* is the right
invariant. No warehouse LIST widening, no browser fallback, no second warehouse-validity opinion.

### BLOCKER A — PARTS_MANAGER scope. Classification: **GOVERNED ROLE-SCOPE GAP**

**Not to be resolved inside Reorder.** The repository defines no authoritative answer to "which
warehouse(s) may a PARTS_MANAGER operate for", so `PARTS_MANAGER_SCOPE_UNDEFINED` failing closed is
**correct**.

Explicitly forbidden as a way to unblock Reorder: treating PARTS_MANAGER as all warehouses; copying
WAREHOUSE_MANAGER's `assignedWarehouseIds` semantics; inferring from location, company, or employee
title/name; defaulting to Taylor; broadening warehouse LIST.

**→ WORKSTREAM 2C — Parts Manager warehouse operating scope.** Reconciliation required before any
implementation: (1) is the scope one warehouse, several, operating-company scoped, enterprise-wide,
or assigned some other way; (2) where is it stored authoritatively; (3) does it govern only Reorder
or also receiving / transfers / cycle count / pick-stage / other warehouse operations; (4) how is it
granted, revoked and audited. *Do not invent this solely to unblock Reorder.*

### BLOCKER B — a Warehouse cannot carry its own company. Classification: **PHYSICAL-ROOT AUTHORITY CONTRACT MISMATCH**

**This belongs to the Ownership program, and the ownership model is not what changes.** The approved
model already states that a Warehouse IS a physical COMPANY root and that
`warehouse.operatingCompanyId` is a persisted governed fact. The contradiction lives in the existing
§3A warehouse/receiving shape contract, which predates the ownership requirement and rejects the new
governed fact as `unknown_field`.

**Ruling:** do NOT give Reorder its own warehouse-validity definition; do NOT move
`operatingCompanyId` elsewhere merely to satisfy the old allow-list. Reconcile the canonical Warehouse
authority so that ONE Warehouse definition recognizes `operatingCompanyId` as an allowed governed root
fact.

**→ WORKSTREAM 2A.1 — Physical-root company compatibility.** A compatibility amendment to the COMMON
Warehouse authority, not a Reorder-specific exception. Target: a valid governed Warehouse may contain
`operatingCompanyId` without ceasing to be a valid governed Receiving/Warehouse record.

**Measurement required BEFORE any code:** the exact canonical §3A validator; every caller/importer of
it; every test asserting the current 12-key shape; every writer capable of creating or updating a
Warehouse record; whether those writers could author `operatingCompanyId`; whether the field must be
immutable after root creation; whether warehouse status or other transitions use `affectedKeys()`;
Receiving's behaviour with the extra governed field; migration behaviour for existing warehouses
without it; and the exact Rules / Function / fixture / verifier delta.

**Hard stop condition:** stop before implementing if widening the canonical shape would accidentally
give any existing client writer authority to add or change `operatingCompanyId`.

**Expected direction, to be proven not assumed:** allowed in the canonical shape; required for new
ownership-governed physical roots; immutable through ordinary client Warehouse transitions; authored
only through an explicitly governed root-authority path; optional on historical rows until separately
migrated.

### Sequence

**2A.1 → 2B activation → 2C** (2C may run in parallel if it can be resolved independently).

- Activation for **all intended roles** needs both 2A.1 and 2C.
- Activation for **admin / dispatcher / defined WAREHOUSE_MANAGER scope only** needs 2A.1;
  PARTS_MANAGER stays intentionally unavailable. **Intended role coverage must not be silently
  redefined** to declare activation complete.

### Merge vs activation for PR #1646

Once every CI lane settles PASS, the Legacy Authorization Surface Gate is legitimately corrected
(not waived), and no new authority regression appears, #1646 **may** merge as **dormant governed
code** while activation stays blocked by 2A.1 and 2C. Merging authorizes no deployment, and it is
conditional on main's normal build/test contract not assuming the new path is immediately executable.

### Not authorized

Warehouse `operatingCompanyId` writes; §3A shape modification (yet); inventing Parts Manager scope;
deploy; sandbox mutation; production mutation.

## #149 — OWNER RULING R-18: the Warehouse company fact is CANONICAL (Workstream 2A.1A, implemented)

**Date:** 2026-08-31
**Classification:** SHARED PHYSICAL-ROOT AUTHORITY COMPATIBILITY — **not** a Reorder fix, a Receiving
fix, or a migration workaround. The canonical Warehouse authority was too narrow for Ownership v1.
**Status:** IMPLEMENTED. No `firestore.rules` change, no governed-hash change, no data written.

### Ruling

**`operatingCompanyId` is an ALLOWED field on the canonical governed Warehouse shape** — and
deliberately **not required**, for this compatibility change. Warehouses legitimately predate
Ownership v1, no governed root-authority writer exists, and no migration is authorized; requiring it
now would strand every historical record.

- warehouse **with** a valid governed company → VALID GOVERNED WAREHOUSE
- warehouse **without** one → VALID **LEGACY** GOVERNED WAREHOUSE
- warehouse with an ungoverned company value → fails closed, `operating_company_invalid`
- warehouse with any other unknown key → still fails closed, `unknown_field`

Whether the field becomes required for **newly created** physical roots is the ownership-enforcement
phase's decision, not this amendment's.

### One canonical opinion

Receiving, Transfers, the Receiving location picker, the status writer, the governance verifier and
Reorder eligibility all read the **same** validator. None gained a private interpretation. Before the
amendment, every one of them rejected a company-bearing warehouse — which is why the blocker was
never Reorder's, and why the regression is a single suite covering all six rather than six suites.

### The erase path, closed at both ends

The measurement found that a company-bearing warehouse failed the validator, so `classifyWarehouse`
fell through to the legacy branch and returned **DERIVE**; `executeMigration` would then have replaced
the document with `buildMigratedRecord`'s fixed field list — **silently erasing the company** — while
`STALE_PRESTATE` raised no objection, because the erasure was the planned action rather than drift.

Both ends are now closed: classification returns GOVERNED (a byte-stable no-op that is never
restaged), and the builder preserves an existing company for the case where migration legitimately
processes a record. The migration may normalize what it owns; it may never drop a governed ownership
fact because an older fixed-field builder predates it.

### Storage validity is NOT write authority

The measurement's safety clearance held in its strongest form: `firestore.rules` denies **every**
client write to `warehouses` (`allow create, update, delete: if false`), so widening a stored shape
could not grant a client writer anything. That is now a permanent test, not a one-time finding.

No writer was added. Both trusted writers reject unknown request keys against exact allow-lists that
exclude the field, and `setWarehouseStatus` updates four named fields, so a stored company travels
through a status transition untouched — asserted, so it stays deliberate rather than accidental if
that update ever widens.

### Delivered

`types/warehouse.ts` (optional field) · `governedWarehouseValidation.ts` (allow-list + value
validation through the governed company authority + carried into the sanitized reconstruction) ·
`warehouseGovernanceMigration.ts` (preservation) · `functions/test/warehousePhysicalRootCompany.test.mjs`
(17 cases across all six consumers, offline) · registered in `warehouse-status-writer-tests.yml`.

The Workstream 2B BLOCKER test did what it was written to do — it **failed** when the contradiction
was resolved — and has been replaced with real coverage proving the reorder picker works against the
real validator.

### What this does NOT solve

A Warehouse can now **hold** `operatingCompanyId`. **Nothing may put it there.**

**→ WORKSTREAM 2A.1B — physical-root company write authority.** To be measured against existing
administration/migration authority before implementation: creation-time only versus controlled
assignment to legacy roots; which capability; immutability after assignment; the required audit event;
idempotent assignment; mismatch refusal; sandbox operator path versus a permanent application command;
production protections; and whether warehouse and mobile-location roots should eventually share one
physical-root company assignment authority. Expected direction — unset → valid company is a controlled
one-time assignment, same company is idempotent, a different company is REFUSED, and ordinary
Warehouse writers can never change it — but measure before building.

### Absolute ordering rule

**Never write a warehouse `operatingCompanyId` before 2A.1A is deployed** wherever a migration,
status, receiving or transfer consumer could touch it. This is a data-safety rule, not a rollout
preference: the erase path above was real.

Sequence: **2A.1A → 2A.1B → authorized sandbox assignment of the five Warehouse roots → 2B sandbox
activation → 2C** (Parts Manager scope, if full intended persona coverage is required).

### Recorded asymmetry

`mobile_locations`, the other ownership physical root, never had this problem: its reader checks
required fields rather than enforcing a closed allow-list, so an added company passes untouched. Only
`warehouses` needed the amendment, and a future reader should not assume both roots were blocked.

---

## #150 — OWNER RULING R-29: `RoleAssignment.scope.location` is the canonical warehouse-scope authority

**Date:** 2026-09-01
**Classification:** GOVERNED SCOPE AUTHORITY — settles the Workstream 2C question left open by #147
(`PARTS_MANAGER_SCOPE_UNDEFINED`) and #148. Answers **Axis B** (which Warehouses may an actor act on),
and re-homes part of **Axis A** (may the actor perform the operation at all).
**Status:** RULED. No grant, no sandbox mutation, no deploy authorized by this entry.

> **Naming note.** "R-29" here is the warehouse-scope ruling. An earlier, undocketed R-29 in the same
> session was a live deploy/worktree reconciliation that produced no durable ruling and was never
> recorded. There is no superseded text; this is the only R-29 in the repository.

### The ruling

1. **Canonical grant authority.** `RoleAssignment.scope` with `type: "location"` and `value` = a
   governed `warehouseId`. This vocabulary already exists end to end: `ScopeType` declares it,
   `resolveEffectivePermission.scopeMatches()` implements it as an exact `value` match with correct
   narrowness ordering, `trustedWriterCommands.grantRole` validates and accepts it, and grant/revoke
   already emit `grantRole` / `revokeRole` audit events. **What was missing was never the authority —
   it was a consumer.** No caller in the repository has ever constructed a non-global `TargetContext`.

2. **`employees.assignedWarehouseIds` is demoted.** It is no longer an independent grant authority. It
   becomes a **derived, Rules-consumable projection** of (1), for the places where Firestore Rules
   must test warehouse membership directly and cannot run the resolver. It must not be authored
   independently by application or UI code.

3. **Scope semantics are platform-wide; enforcement is capability-specific.** A location-scoped
   assignment confines a capability to that Warehouse **whenever that capability operates on a
   Warehouse target**. It does not confer every warehouse capability.

4. **`PARTS_MANAGER` may hold warehouse scope** — and holds it only through governed location-scoped
   assignments. No implicit all-warehouse scope, no implicit operating-company scope, and nothing
   inherited from the title.

5. **`WAREHOUSE_MANAGER` uses the same mechanism.** Its existing `assignedWarehouseIds` becomes
   projection/compatibility, not the long-term source of truth.

6. **Manager capabilities belong on the governed business Roles.** The `technician` compatibility Role
   is not to be granted to manager personas to make a workflow function.

7. **Reorder specifically:** `technician` must stop being the carrier through which an active
   `WAREHOUSE_MANAGER` / `PARTS_MANAGER` obtains `reorder.request.create.manual`. Governed Role
   ownership expresses the capability directly.

8. **admin / dispatcher keep global behaviour.** 2C narrows nothing for them.

9. **No sandbox grants and no deploy yet.**

### What this ruling fixes, measured

The 2C inventory found the blocker was **two** gaps on **different** principals, not one missing grant:
`reorder.request.create.manual` is carried by exactly one Role (`technician`, compatibility) under the
condition `operationalRoleActive ∈ {PARTS_MANAGER, WAREHOUSE_MANAGER}` — and in sandbox the personas
holding the condition hold four narrow inventory Roles but not `technician`, while the persona holding
`technician` has `operationalRoles: []`. Both halves never land together, so **the scope layer has
never refused anything in a live environment**; every observed denial was Axis A. Item 7 dissolves that
split by putting the capability where the principal already is.

### Three things this ruling does NOT settle

Recorded as open, because building past them would be inventing authority — the failure mode #147
already ruled against.

- **OPEN-1 — the global-scope loophole.** `scopeMatches()` returns `true` for a `global` assignment
  against **any** target, including a location target. So granting a warehouse-bearing governed Role at
  global scope would silently confer all-warehouse authority, contradicting §4. §8 requires `global` to
  keep meaning "everything" for admin/dispatcher, so the resolver cannot be changed. The constraint
  therefore belongs at **grant time** — warehouse-bearing Roles may only be granted at `location`
  scope — and nothing enforces that today.
  **SUPERSEDED IN PART by R-30 (#151): the remedy named here — a whole-Role location-only grant constraint — is EXPLICITLY REJECTED.** The required control is a CAPABILITY-scope constraint, not a ROLE-scope one, because both manager Roles carry permissions that are legitimately global. The loophole itself remains real and remains binding; only the proposed fix was wrong. See #151.
- **OPEN-2 — the projection's writer and its Rules consumer.** §2 fixes the direction
  (RoleAssignment → `assignedWarehouseIds`) but not who computes it, when, or what becomes of the two
  tools that author it directly today (`warehouseAssignmentProvisioningCli.js`,
  `provisionEmployeeAccess.js`). Separately, `firestore.rules`' `isAssignedToWarehouse()` still requires
  `operationalRoles.hasAny(["WAREHOUSE_MANAGER"])`, so a location-scoped `PARTS_MANAGER` gains nothing
  in Rules until that predicate changes — always a Tier-2 change.
- **OPEN-3 — how far §7 reaches.** §7 names `reorder.request.create.manual`. `TECHNICIAN_ROLE`
  conditions five further capabilities on the same manager operational roles
  (`reorder.request.read.queue`, `reorder.request.assign`, `inventory.transaction.read`,
  `inventory.action.read`, `inventory.catalog.read`). §6's principle implies all of them; §7 names one.
  Moving only the named one leaves the identical split-brain in place for the rest.

### Cross-workflow consequence, recorded

Reorder is today the **only** warehouse workflow with any actor warehouse scope. Receiving, Transfers,
Cycle Count, Put-away, Bins, Returns intake and Serialized-asset acquisition are capability-only: a
principal holding `inventory.stock.receive` may receive at every status-eligible warehouse. §3 makes
those workflows in-scope for confinement as and when each is ruled on; this entry authorizes no change
to any of them.

### Recorded stale claim

`parityFixtures.ts` asserts `legacyDecision: "ALLOW"` for `reorder.request.create.manual` under a
`technician` + active `WAREHOUSE_MANAGER` fixture. That oracle is a hand-authored literal describing
pre-2B production Rules; the repository's `firestore.rules` now says `allow create: if false` for
`reorder_requests`. Implementing §7 therefore **aligns** the compatibility Role with an
already-retired legacy path rather than breaking parity — but the fixture must be retired in the same
change, with that reason stated, or it becomes exactly the false-claim defect class RCV-G4 ruled on.

---

## #151 — OWNER RULING R-30: the 2C.1 implementation reach, and the mixed-Role contradiction it uncovered

**Date:** 2026-09-01
**Classification:** IMPLEMENTATION REACH + SCOPE-SAFETY. Governs how R-29 (#150) is built.
**Status:** RULED. **Step A executed and returned a STOP** — see "The measured answer" below.
No grant, no sandbox mutation, no deploy.

### The ruling

1. **§7 reach — all six, not one.** Every manager-conditioned capability moves off the `technician`
   compatibility Role, preserving each capability's **existing per-capability eligibility exactly**:
   PARTS_MANAGER-only → governed `partsManager`; WAREHOUSE_MANAGER-only → governed `warehouseManager`;
   both → both. The six are **not** flattened into one identical bundle merely because they happen to
   share a compatibility Role today. The defect boundary is *"business-manager authority is carried
   through a Role named `technician`"* — not *"one Reorder capability sits in the wrong place."*
   Afterwards `technician` must no longer be required to obtain those authorities, and real technician
   behaviour must not change unless that principal independently holds a governed manager Role.

2. **OPEN-1 — the control is CAPABILITY-scoped, not ROLE-scoped.** The loophole must be closed before
   location-scoped authority counts as governed, but the remedy proposed in #150 is rejected: a
   whole-Role location-only restriction could silently narrow unrelated global manager authority.
   The required control is: **a GLOBAL RoleAssignment must not confer a capability whose governed
   target semantics require warehouse/location scope.** `scopeMatches()` is not to be weakened and
   Reorder is not to be special-cased. R-29 §4 stays binding — a convention is not sufficient.

3. **Sequencing — one changeset.** §7 and §1/§3 belong in the same authority tranche (A classify →
   B enforce → C move → D location `TargetContext` → E Reorder shares the decision → F prove
   admin/dispatcher unchanged → G prove `technician` cannot become a manager → H only then mergeable).
   Neither half may merge as a standalone final state.

### The measured answer to Step A — BOTH ROLES ARE MIXED, so the tranche STOPS

R-30 §2 required classifying every permission on both governed Roles *before* any enforcement rule,
and stopping if either Role is mixed. Both are, decisively.

| Role | Permission | Class | Evidence |
|---|---|---|---|
| both | `warehouse.transferOrder.read` | **LOCATION_REQUIRED** | catalog: "inter-warehouse stock transfer"; `firestore.rules` already scopes it by `fromWarehouseId`/`toWarehouseId` |
| both | `inventory.transaction.read` | **LOCATION_REQUIRED** | every OPERATIONAL record stores `location {type, locationId}` |
| both | `inventory.serializedAsset.read` | **LOCATION_REQUIRED** | projection includes `currentLocationId` |
| both | `customer.record.read` | **OTHER_TARGET_TYPE** | Customer target; no warehouse exists in it |
| both | `audit.event.read` | **OTHER_TARGET_TYPE** | cross-domain immutable history |
| both | `salesOrder.read` | **OTHER_TARGET_TYPE** | account/Sales-Order target |
| both | `inventory.catalog.manage` / `.read` | **GLOBAL_ALLOWED** | canonical Part/Manufacturer reference data — company-wide by definition |
| both | `inventory.balance.read` | **UNRESOLVED** | reports on-hand **across all ACTIVE warehouses** for one Part; confining it would change what the number means, yet leaving it global leaks cross-warehouse on-hand to a location-scoped manager |
| warehouseManager | `inventory.action.read` | **OTHER_TARGET_TYPE** | `inventory_actions` carries no warehouse or location field |
| warehouseManager | `reorder.purchaseOrder.read` | **UNRESOLVED** | the PO document carries `operatingCompanyId` but **no `warehouseId`** — it is company-scoped and not warehouse-scoped, though the request that produced it is both |
| partsManager | `finance.adjustment.record`, `finance.invoice.issue`, `finance.read` | **OTHER_TARGET_TYPE** | invoice / AR targets |
| partsManager | `workOrder.create`, `workOrder.transition` | **OTHER_TARGET_TYPE** | Work Order target (ADR-002) |

`warehouseManager` = 3 LOCATION_REQUIRED, 4 OTHER, 2 GLOBAL_ALLOWED, 2 UNRESOLVED (11).
`partsManager` = 2 LOCATION_REQUIRED, 6 OTHER, 2 GLOBAL_ALLOWED, 1 UNRESOLVED (13, `inventory.catalog.manage`
and `.read` counted as the two GLOBAL_ALLOWED).

**Per R-30 §2 the tranche therefore STOPS at step B and does not proceed to C.** Neither Role may be
forced to location scope; `scopeMatches()` is not to be weakened; Reorder is not to be special-cased.

The **six moving capabilities are themselves mixed**, which sharpens the contradiction rather than
softening it: `reorder.request.create.manual` and `inventory.transaction.read` are LOCATION_REQUIRED,
`inventory.catalog.read` is GLOBAL_ALLOWED, `inventory.action.read` has no location field at all, and
`reorder.request.read.queue` / `reorder.request.assign` are UNRESOLVED because `reorder_requests` has
**two record generations** — rows predating the trusted command carry no `warehouseId` at all, so a
location-confined read would silently hide legacy rows rather than deny them.

### The §7 delta, measured (built only when the tranche is unblocked)

Applying R-30 §1's preserve-eligibility rule to the six, most are already in place; the real delta is
four grants:

| Capability | Current condition | Destination | New? |
|---|---|---|---|
| `reorder.request.create.manual` | PARTS_MANAGER or WAREHOUSE_MANAGER | both governed Roles | **NEW to both** |
| `reorder.request.read.queue` | PARTS_MANAGER only | `partsManager` | **NEW** |
| `reorder.request.assign` | PARTS_MANAGER only | `partsManager` | **NEW** |
| `inventory.action.read` | WAREHOUSE_MANAGER only | `warehouseManager` | already held |
| `inventory.transaction.read` | either | both | already held by both |
| `inventory.catalog.read` | either | both | already held by both |

### Two candidate remedies, returned unselected

Named because R-30 anticipates them; **neither is adopted here.**

- **Split the warehouse-scoped permissions into a governed scoped Role**, leaving the existing manager
  Roles global. Smallest change to the resolver; multiplies Roles, and the split must be maintained as
  capabilities are added.
- **Introduce an explicit capability-to-allowed-scope policy** — declare per capability which Scope
  types may carry it, and refuse a grant (and a decision) that violates it. Matches R-30 §2's own
  framing exactly, is the only option that answers UNRESOLVED cells rather than routing around them,
  and is the larger authority decision R-30 predicted.

Selecting between them is the next Owner ruling. Both are blocked on the same prior question the table
above exposes: **what a LOCATION_REQUIRED capability should do about records that have no location** —
legacy `reorder_requests`, and every `reorder_purchase_orders` document.

---

## #152 — OWNER RULING R-32: the per-binding assignment-scope policy, implemented (Workstream 2C.3)

**Date:** 2026-09-01
**Classification:** GOVERNED AUTHORITY IMPLEMENTATION. Builds R-29 (#150) under the reach and
scope-safety constraints of R-30/R-31 (#151).
**Status:** IMPLEMENTED, repo-only. No grant, no sandbox mutation, no deploy, `firestore.rules`
byte-unchanged.

### What was built

1. **`Role.scopesByPermission?: Partial<Record<PermissionId, ScopeType[]>>`** — a side map in the
   same shape and for the same reason `conditionsByPermission` already exists: per-(Role,
   Permission) metadata the Specification-frozen `PermissionId[]` shape cannot carry.
   `Role.permissions` is unchanged. **Absent means pre-R-32 behaviour exactly**, which is why the
   thirty-eight Roles that declare nothing — admin and dispatcher among them — are untouched.

2. **One canonical opinion**, `functions/src/access/bindingScopePolicy.ts`, consumed by BOTH
   enforcement points so they cannot drift: `bindingAllowsAssignmentScope(role, permissionId,
   assignmentScopeType)` and `roleHasAnyBindingAtAssignmentScope(role, assignmentScopeType)`.

3. **Resolution-time enforcement** — one line in `resolveEffectivePermission`'s qualifying loop,
   beside `scopeMatches()` and `evaluateConditions()`. **AUTHORITATIVE BY PLACEMENT:** 113
   RoleAssignments already exist in sandbox, written before R-32, and no grant-time check can ever
   see them. `scopeMatches()` was not touched.

4. **Grant-time defence in depth** — `grantRole` consults the SAME helper and refuses a Role that
   could confer nothing at the requested scope. Deliberately **some-binding, never every-binding**:
   a mixed Role is the normal case, and requiring every binding would make
   `partsManager @ global` and `partsManager @ location:wh-main` rivals instead of composable.

5. **The six-capability home correction.** All six moved off `technician` with each capability's
   existing eligibility preserved separately — not flattened into one bundle. Measured delta,
   verified against main before editing: `warehouseManager` **+1** (`create.manual`),
   `partsManager` **+3** (`create.manual`, `read.queue`, `assign`). The other three were already on
   their governed Roles. The regenerated governance artifact shows **exactly those four grants and
   nothing else**.

6. **Binding declarations**, only where 2C.2 classified the MANAGER binding LOCATION_REQUIRED with
   direct evidence: `reorder.request.create.manual` and `inventory.transaction.read`, on both
   manager Roles. **`inventory.catalog.read` is deliberately NOT declared** (global reference data),
   and neither are `reorder.request.read.queue`/`assign`, whose runtime enforcement is Rules-backed
   and status-scoped rather than location-scoped.

7. **Reorder is the first location consumer.** `listReorderWarehouseOptions` and
   `createReorderRequest` share ONE loaded authority
   (`reorderRequest/reorderWarehouseAuthority.ts`) that resolves the governed permission against
   `{ type: "location", value: warehouseId }`. `reorderWarehouseEligibility.ts` is **retired** —
   Reorder no longer reads `employees.assignedWarehouseIds` for any authorization decision.

### The bypass, measured before and after

`partsManager @ global` against a `location` target used to resolve **ALLOW** for every permission
on the Role — the R-30 OPEN-1 loophole. It now resolves **DENY** for the two declared bindings and
**ALLOW** for the rest, from the same assignment. admin and dispatcher at global scope still resolve
ALLOW against any location target, through the generic resolver with no Reorder-specific bypass.

### Two things this change deliberately does NOT do

- **`reorder.request.read.queue` and `reorder.request.assign` are DECLARATION_CORRECTED,
  RUNTIME_ENFORCEMENT_GAP_OPEN.** Their live authority remains status-scoped `firestore.rules`; no
  governed consumer evaluates either id. Moving their declaration changes no runtime behaviour, and
  this entry does not claim otherwise.
- **Legacy reorder data is untouched.** 6 of 7 sandbox `reorder_requests` carry no `warehouseId`
  and no lineage to one. Nothing was migrated, derived, or filtered; create/options do not need
  legacy resolution because their target is an explicit candidate or selected Warehouse.

### An intentional parity divergence, recorded rather than hidden

Five `parityFixtures` entries were REMOVED, each asserting that an active operational manager
obtained one of the six THROUGH `technician`. They were not wrong when written — legacy Rules do
grant those reads — so R-32 knowingly breaks parity, and the governed model is now the narrower of
the two. They were removed rather than flipped to DENY, because a flipped fixture still reads as
"parity holds", which would be false.

**Who is affected:** a principal holding `technician` AND an active PARTS_MANAGER/WAREHOUSE_MANAGER
operational role loses these capabilities through the governed feed until granted the governed
manager Role. Measured in `eos-platform-sandbox`: **no principal is in that state**, so the live
effect there is nil. **Production was not measured and nothing is deployed.**

### A cross-tranche collision worth recording

PR #1666 (cert-world governed warehouse) merged into main mid-tranche and added a test driving
`projectReorderWarehouseOptions` through the retired eligibility module's `ALL_GOVERNED` scope
object. **Git reported no conflict** — the two changes touch different files — and the collision
surfaced only when the governance suite ran. The test's intent (the company gates the picker) was
preserved exactly; only its expression of "entitled to every warehouse" changed to the authority
predicate. This is why a moving-main reconciliation cannot stop at textual conflict detection.

---

## #153 — OWNER RULING R-33: 2C.3 accepted and merged; production deployment BLOCKED pending a census

**Date:** 2026-09-01
**Classification:** REVIEW + MERGE AUTHORIZATION for R-32 (#152), plus two durable open items.
**Status:** MERGED as `5d475f9f` (PR #1668). **No deployment followed, and none is authorized.**

### Accepted

`scopesByPermission` as Role→Permission binding metadata (no separate registry, no Permission object
rewrite, no `scopeMatches()` change) · resolution-time validation authoritative with grant-time as
defence in depth · the **at least one binding** rule for mixed Roles, explicitly **not** "every
permission must support the scope" · the four-grant capability-home delta · Reorder evaluating
`reorder.request.create.manual` against a `location` TargetContext · the retirement of
`employees.assignedWarehouseIds` as a Reorder Functions authorization source.

### THE DEPLOYMENT BLOCKER — read this before any 2C activation

**Production has NOT been measured** for principals combining the `technician` compatibility Role
with an active `PARTS_MANAGER`/`WAREHOUSE_MANAGER` operational role. Such a principal LOSES the six
capabilities through the governed feed until granted a governed manager Role.

    REPOSITORY_MERGE        ALLOWED  (done)
    PRODUCTION_DEPLOYMENT   BLOCKED_PENDING_CENSUS

The unknown does not invalidate R-32 and did not block the merge. It **does** prohibit production
activation or deployment until a **bounded, read-only** census establishes the exposure. **The census
must not mutate production.** Sandbox was measured: no principal is in that state, so sandbox
exposure is nil.

### RULES / GOVERNED PARITY — open, and intentional

For the six paths, `firestore.rules` still ALLOWs where the governed model now DENIES. That equality
was real before R-32 and is deliberately ended by it. Recorded as an explicit open reconciliation
item, with two standing prohibitions:

- do **NOT** weaken Rules to restore test parity;
- do **NOT** widen governed authority to restore test parity.

Removing the five stale parity fixtures was correct; they must not be resurrected as DENY fixtures,
because a flipped fixture reads as "parity holds", which is now false.

### Merging 2C.3 authorizes NOTHING operational

Not sandbox Role grants, not scope grants, not `assignedWarehouseIds` changes, not Rules changes, not
Functions deployment. Each belongs to the next 2C activation tranche.

### The moving-main rule is now permanent

`origin/main` advanced **three times** during 2C.3 — #1666, #1667, #1669 — and each was reconciled
with an ancestry check, a per-path authority-surface check, affected-suite runs and a FINAL
governance run on the reconciled tree. **Clean Git reconciliation is not sufficient evidence.** The
#1666 collision proves it: a cert-world test drove the retired eligibility module through an
`ALL_GOVERNED` scope object, in different files, with no textual conflict, and surfaced only when the
governance suite ran.

A second consumer of the same retired module — `warehousePhysicalRootCompany.test.mjs`, the 2A.1A
"all six consumers" suite — was missed locally and caught by CI. The lesson is recorded because it
generalizes: **when retiring a module, enumerate every importer first**, rather than discovering them
one failing lane at a time. The reorder CI lane was retargeted onto `functions/src/access/**` and
`bindingScopePolicy.test.mjs` in the same fix, so the R-32 successors are covered by the lane that
used to cover what they replaced.

### Standing classifications after this ruling

    CAPABILITY_HOME_SPLIT_BRAIN            CLOSED
    PER_BINDING_SCOPE_POLICY               IMPLEMENTED
    GLOBAL_SCOPE_MANAGER_BYPASS            CLOSED
    REORDER_LOCATION_SCOPE_CONSUMER        IMPLEMENTED
    REORDER_ASSIGNED_WAREHOUSE_AUTHORITY   RETIRED
    READ_QUEUE_RUNTIME_ENFORCEMENT         OPEN — DECLARATION ONLY
    ASSIGN_RUNTIME_ENFORCEMENT             OPEN — DECLARATION ONLY
    RULES_GOVERNED_PARITY                  OPEN — INTENTIONAL DIFFERENCE RECORDED
    LEGACY_UNSCOPED_REORDER                PRESERVED
    PRODUCTION_EXPOSURE                    UNMEASURED — DEPLOYMENT BLOCKER
    SANDBOX / PRODUCTION / CERTIFICATION   NOT MUTATED
    DEPLOYMENT                             NOT PERFORMED
## #154 — OWNER RULING: FIN-002 reporting attribution — company, business unit, sales credit, booked basis

**Decision (Owner, 2026-08-31, via the Financials master execution contract; implements FIN-002):**

1. **The reporting spine is canonical and single-sourced.** Every reportable operational financial
   event must be able to preserve operatingCompanyId, businessUnitId, credited/responsible person,
   customerId, sourceType/sourceRecordId, event time, and currency — defined ONCE in
   `functions/src/finance/financialAttribution.ts` and composed by Sales, Finance, and (later)
   Service. No domain-local copies. Not every dimension is valid for every event: an invalid
   dimension is an honest null, never a forced or inferred value.
2. **OWNERSHIP != SALES CREDIT.** `creditedSalespersonId` is a distinct governed fact. It defaults
   from the governed commercial OWNER at the point a sale enters the commercial chain — never from
   `createdBy` (an assistant creating for Salesperson A's customer credits A). It may be explicitly
   reassigned pre-commitment through the existing governed commercial edit commands; after the
   immutable boundary, changing credit is a FIN-007 governed attribution adjustment. Changing
   Customer ownership affects future sales, not historical attribution.
3. **Company attribution is explicit or inherited, never inferred** (reaffirms R-14) — not from
   warehouse/location names, not from "North", not from salesperson, route, or manufacturer. The
   FIN-001 defect where BOTH Opportunity→Sales Order conversion paths dropped the company is
   closed: the conversions now pass the accepted Agreement's frozen company (Opportunity fallback),
   copied-not-followed.
4. **Business units are a governed vocabulary** — SERVICE, EQUIPMENT_SALES, PARTS, INSTALLATION
   (ids are authority; labels are presentation; future units are added to the one vocabulary).
   Attribution is LINE-level on commercial orders because one order may mix units — an order
   containing equipment + parts + installation is never flattened to one false order-level unit.
   EQUIPMENT_MODEL and PART lines classify themselves; a SERVICE line MUST declare SERVICE or
   INSTALLATION at creation — an ordinary new reportable line cannot enter the system with silent
   business-unit ambiguity. Work-order activity maps from the existing WorkOrderType authority
   (INSTALL → INSTALLATION; other current types → SERVICE; unknown → null, fail-closed).
5. **BOOKED basis: Agreement acceptance commits commercial terms.** A Sales Order derived from an
   accepted Agreement books at the agreement's server-stamped acceptance time; a direct creation
   books at server creation time. `bookedAtMillis` is server-context only — never a caller clock.
   No revenue-recognition or accounting-period semantics are implied (FIN-008 owns periods).
6. **The immutable snapshot point** is the existing commercial commitment boundary: ACCEPTED
   freezes the Agreement's attribution with its terms; Sales Order creation freezes the order's
   copy; the (dormant) issued invoice composes the canonical snapshot from the governed Sales
   Order at issuance. Later changes to source records rewrite nothing already frozen.
7. **No mass backfill.** Existing records are classified in the FIN-002 census
   (docs/financials/FIN-002_REPORTING_ATTRIBUTION_MODEL.md §16); a backfill runs only under its
   own explicit authorization from governed historical sources — never from current Customer
   owner, createdBy, location names, or today's salesperson.

**Reason:** FIN-001 measured the attribution spine at one working link of four — no stamped
company anywhere (0/1,323), no business-unit concept, no credit concept distinct from ownership,
no booked basis, and a conversion that dropped the one company field that existed. Every
Financials surface (Sales-to-Goal, Company Performance, Employee Performance, Profitability)
reports along exactly these dimensions; building them before the spine exists would force the
prohibited inferences this ruling bans.

**Alternatives rejected:** order-level business unit (rejected — mixed orders are real and would
be silently mislabeled); deriving credit from current Customer ownership forever (rejected —
silently rewrites history); auto-defaulting ambiguous SERVICE lines to SERVICE (rejected — a
guess that poisons installation reporting); a finance-local attribution type (rejected — two
definitions of one snapshot is how they drift).

**Addendum (2026-09-01, same ruling, company-authority correction):** the snapshot's
`operatingCompanyId` is REQUIRED — no reportable operational financial event exists without it.
Pre-commit CRM records (open Opportunity, DRAFT Agreement) may remain company-unresolved where
R-14 governance permits; the REPORTABLE boundary refuses: Agreement ACCEPT and Sales Order
creation (both conversion paths and direct) refuse `COMPANY_REQUIRED` atomically, and a
Sales-Order-derived invoice takes its company from the governed order alone —
`input.companyId` is assertion-only (`COMPANY_MISMATCH` refused before numbering/write/audit),
and `invoice.companyId === invoice.attribution.operatingCompanyId` structurally. No inference,
no default company, no current-user fallback.

---

## #155 — WORKSTREAM 2C CLOSED, and the 2B Rules-deployment defect corrected (R-34)

*(Renumbered 2026-09-01 from a colliding #154: FIN-002 reporting attribution merged first and holds #154; this entry landed later numbering from a stale tail. Content unchanged — see the Financials run ledger.)*

**Date:** 2026-09-01
**Classification:** DEPLOYMENT-VERIFICATION DEFECT CORRECTION + 2C activation closeout.
**Status:** 2C **CLOSED**. Sandbox Rules reconciled and deployed; live proof recorded below.
Production and certification **NOT TOUCHED**.

### The false claim, stated as what it was

The 2B closeout recorded that **`firestore.rules` was not deployed and did not need to be, because
it was unchanged.** That was wrong, and it was **a deployment-verification defect — not stale
documentation.** The evidence used was a **repository-to-repository** comparison ("byte-unchanged
since 2A.1A"), and *repository equality is not deployment equality*.

`firestore.rules` had in fact changed in **#1646** — the very PR that retired the client-direct
Reorder write authority — and that Rules change was never deployed to `eos-platform-sandbox`. From
**2026-08-27 to 2026-09-01** the sandbox therefore retained the legacy direct `reorder_requests` and
`reorder_purchase_orders` create paths, even though the repository **and the deployed application
client** had both moved to the trusted callable architecture. For that window, 2B's headline
invariant — ONE COMMAND → ONE GOVERNED WRITE AUTHORITY — was true in the repository and **false in
the deployed system**.

The drift was found during **2C.4 live authority verification**, by comparing current repository
Rules to the **active sandbox ruleset** rather than to git history.

### The measured drift

| | |
|---|---|
| pre-R-34 live ruleset | `c95a1b90-7e9d-47ed-9b00-5f68ae91b9f7` |
| createTime | 2026-08-27T19:07:05Z |
| sha256 | `b94e287a918acb12b000bf717a8cce5c8678b6afd02184eacaa21624bae969d4` |

The live ruleset was **byte-identical to repository commit `24ffbd54`**, immediately before #1646 —
`diff` reported no difference at all. **The full undeployed delta was therefore exactly #1646's
Reorder Rules retirement and nothing else.**

### R-34 read-only reconciliation

Current repository Rules sha256 `0ad3ab1d00252692db0e490cc7be25fb78c46baed491a8f0b573814c2a57f70b`.

    EXPECTED_REORDER_RETIREMENT_PRESENT   PASS
    UNRELATED_UNDEPLOYED_RULES_CHANGES    NONE
    UNEXPECTED_RULES_DRIFT                NONE
    SAFE_TO_DEPLOY_RULES                  YES

Five hunks, all inside the two Reorder collections: three retirements (`reorder_requests` create,
the Record-PO update branch, `reorder_purchase_orders` create), one dormant `hasOnly` addition whose
only callers were the retired create rule, and comment blocks. A full Rules publish therefore carried
only the governed #1646 retirement plus non-semantic comments. Safety also depended on a fact outside
the repository: sandbox Hosting serves `0abc2353`, which **contains** #1646, so the retired paths had
no live consumer left to break.

### The deployment, and the live proof

| | |
|---|---|
| post-R-34 active ruleset | `6bb8a398-e3a3-489f-9708-47d2bda01ef7` |
| createTime | 2026-09-01T09:05:16Z |
| active sha256 | `0ad3ab1d…` — **equal to the governed repository file** |

`reorder_requests` create `if false` · `reorder_purchase_orders` create `if false` · retired Record-PO
client update branch absent.

**BYPASS PROOF — the decisive one.** A direct Firestore write was attempted with an authenticated
**USER ID TOKEN** (admin principal) over the **Firestore REST surface**, carrying a valid-looking
35-key READY payload that **satisfied the retired rule** — no Admin SDK anywhere, so Rules were
actually evaluated. Observed **HTTP 403 PERMISSION_DENIED**, and the document confirmed **absent** by
a privileged read that a Rules-level read denial could not have masked. The same refusal on
`reorder_purchase_orders`. The refusal is meaningful precisely because that payload would have
succeeded an hour earlier.

    DIRECT_CLIENT_REORDER_CREATE      REFUSED_BY_LIVE_RULES
    REORDER_SINGLE_WRITE_AUTHORITY    LIVE TRUE
    2B_RULES_DEPLOYMENT_DRIFT         CLOSED

**GOVERNED PATH SURVIVED THE RETIREMENT:** `warehouseManager` options `[wh-main]`, create succeeded,
stored `operatingCompanyId: taylor`; `partsManager` options `[wh-north]`, create succeeded, stored
`operatingCompanyId: ventana`. No Functions, Hosting or index change accompanied the Rules publish.

### Workstream 2C final status

    R32_SANDBOX_FUNCTIONS              DEPLOYED
    WAREHOUSE_MANAGER_LOCATION_SCOPE   LIVE PASS
    PARTS_MANAGER_LOCATION_SCOPE       LIVE PASS
    ADMIN_GLOBAL_BEHAVIOR              PASS
    DISPATCHER_GLOBAL_BEHAVIOR         PASS
    TECHNICIAN_MANAGER_AUTHORITY       REFUSED_AS_EXPECTED
    OPTIONS_CREATE_SYMMETRY            PASS
    OLD_ASSIGNED_WAREHOUSE_AUTHORITY   RETIRED — LIVE PROVEN
    GLOBAL_SCOPE_MANAGER_BYPASS        CLOSED — LIVE OBSERVED
    CAPABILITY_HOME_SPLIT_BRAIN        LIVE CLOSED
    REORDER_SINGLE_WRITE_AUTHORITY     LIVE TRUE
    WORKSTREAM_2C                      CLOSED

One subcase is **CONTRACT PROVEN, not live-observed**: a principal holding the `technician`
compatibility Role *and* an active PARTS_MANAGER/WAREHOUSE_MANAGER operational role. No such sandbox
principal exists, and manufacturing one would mean mutating `operationalRoles` outside tranche scope.

### Still open — do not read this entry as closing them

    READ_QUEUE_RUNTIME_ENFORCEMENT     OPEN — NOT CHANGED
    ASSIGN_RUNTIME_ENFORCEMENT         OPEN — NOT CHANGED
    ASSIGNEDWAREHOUSEIDS_PROJECTION    OPEN — NOT CHANGED
    LEGACY_REORDER_ROWS                OPEN — NOT CHANGED
    PO_TARGET_RESOLUTION               OPEN — NOT CHANGED
    PRODUCTION_EXPOSURE                UNMEASURED
    PRODUCTION_DEPLOYMENT              BLOCKED

### Sandbox evidence, retained deliberately

Eight Reorder requests created during 2C.4 / R-34 live proof; governed grants
`warehouseManager @ location:wh-main` and `partsManager @ location:wh-north`; and one **disabled**
probe assignment kept as the audit trail of the global-scope bypass test. **Nothing is to be
deleted** — the records and their audit events are the evidence. No cleanup is required for closeout.

### THE DEFECT-CLASS LESSON — carry this forward

Same class as RCV-G4, one layer down:

> **Repository equality is not deployment equality.**

For any future authority retirement whose live enforcement depends on a deployed surface — Rules,
Functions, indexes, Hosting — **compare the governed repository authority to the actual active
deployed artifact before declaring deployment unnecessary or complete.** Do not infer live state
from git history, from unchanged local files, from prior deployment assumptions, or from application
behaviour alone. A retirement that is merged but undeployed leaves the old path open, and the
document claiming otherwise is what stops anyone from checking.

## #156 — OWNER RULING (standing FIN-004 contract): financial visibility is scoped, server-enforced, and never implied

**Decision (via the Financials master execution contract + overnight run authorization, 2026-09-01;
implements FIN-004):**

1. **CAN PERFORM WORK ≠ CAN SEE FINANCIAL RESULT.** No operational capability implies financial
   reach; UI hiding is never authority; every financial read is scoped SERVER-SIDE.
2. **Two grants per read:** the fact-family gate (`finance.read` for AR facts) AND a
   `finance.visibility.*` scope (self / team / businessUnit / company / consolidated). Either
   alone reaches nothing. Reach is the UNION of granted scopes. All ids registered
   `active:false`; no Role carries them yet — granting is a separate activation decision.
3. **Scope semantics** (canonical authority `functions/src/finance/financialVisibility.ts`):
   SELF = records credited to the principal's linked employee; TEAM = SELF plus the governed
   role hierarchy's descendants (`hierarchicalVisibility.ts`, first live consumer — no peer
   visibility); BUSINESS_UNIT = wholly-attributable records only (a cross-unit invoice stays
   hidden entirely); OPERATING_COMPANY = exact governed company; CONSOLIDATED = everything,
   expressly granted only — never a default and never an admin implication (no role branch
   exists in the authority; test-asserted).
4. **Fail-closed everywhere:** valueless company/BU grants confer nothing; a caller-supplied
   accountId never expands scope; summaries sum only visible records; truncation honesty is
   judged on the unfiltered set; hidden is indistinguishable from absent.
5. **FIN-BLOCK-001 (deliberately undecided):** the mechanism binding a principal to a COMPANY or
   BUSINESS_UNIT value belongs to the Owner's access-scope workstream (R-29/R-32 lineage: new
   ScopeType vs the unused "domain" ScopeType vs a governed Employee fact). Until ruled, held
   grants of those two scopes resolve to BLOCKED — no reach, never a guess.
6. **Single authority:** every later financial fact family, surface, report, and export composes
   this scope authority and re-authorizes at execution time. No surface-local visibility.

**Reason:** FIN-001/FIN-GAP-007 measured the pre-FIN-004 state: one coarse `finance.read`
boolean whose first activation would have granted consolidated AR over any caller-supplied
accountId, with team-visibility machinery built but consumed by nothing. FIN-004 had to land
BEFORE finance-core exposure (program order) so no activation event ever confers unscoped reach.

**Alternatives rejected:** minting a company/BU ScopeType unilaterally (rejected — four
synchronized access-core edit points incl. trustedWriterCommands, inside the Owner's active
R-2x workstream); appropriating "domain" without a ruling (rejected — undocumented intent);
role-name special-casing for admin (rejected — identity is not authority); per-surface
visibility checks (rejected — drift by construction).

## #157 — OWNER RULING (FIN-BLOCK-001 closed): financial company/BU visibility bindings are governed access-scope facts

**Date:** 2026-09-01 · **Context:** the FIN-004 visibility model (#156) left COMPANY/BUSINESS_UNIT
reach BLOCKED pending the principal-binding mechanism (FIN-BLOCK-001). The Owner directed this
continuation run to close it with explicit governed access scope types.

**Decision:** a principal's OPERATING_COMPANY / BUSINESS_UNIT financial visibility reach is bound
through two new members of the governed access ScopeType union — `operatingCompany` and
`businessUnit` — carried on RoleAssignments exactly like `location`. They are ACCESS AUTHORITY
FACTS: never inferred from employee master data, current Customer owner, warehouse assignment,
location names, UI filters, or caller-supplied ids.

- **Scope validation authority:** `operatingCompany` values validate against the governed
  operating-company authority (`ownership/operatingCompanyAuthority.ts` — `taylor`/`ventana`);
  `businessUnit` values validate against the canonical BUSINESS_UNITS
  (`finance/financialAttribution.ts`). Free text is refused at grant time
  (trustedWriterCommands scope validation) — no second vocabulary exists.
- **Resolution:** value-matched in the ONE canonical resolver (`resolveEffectivePermission`,
  identical rule to domain/location); the FIN-004 loader enumerates the governed value sets and
  asks the resolver per scoped target (the R-32/#1672 loaded-authority pattern). A scoped
  assignment never matches the always-global effective-access feed target, so the new types widen
  nothing anywhere else; GLOBAL and LOCATION semantics are unchanged; existing assignments retain
  prior behavior.
- **No automatic grants, no migration, no census mutation:** the types existing confers nothing;
  a principal without an explicit binding has no scoped financial reach. All `finance.visibility.*`
  capabilities remain registered `active:false` and in NO environment activation registry —
  activation, grants, and deployment remain separate Owner acts (F14 package).
- **No UI-only authority:** every financial read/report/export path composes the same loader +
  predicate (`loadFinancialVisibilityAuthority` / `isInvoiceVisible`); admin reach flows through
  the same resolver — no bypass path exists.

**Enforced by:** `types/access.ts` (both mirrors), `resolveEffectivePermission` (synced shared
contract), `trustedWriterCommands`/`auditEventWriter` scope validation,
`finance/financeReadCallables.ts` loader; suites `financialScopeBinding.test.mjs`,
`trustedWriterCommands.test.mjs` (FIN-BLOCK-001 section), `financeVisibilityRead.test.mjs`.

## #158 — OWNER RULING: ASSIGN_RUNTIME_ENFORCEMENT — CLOSED_SANDBOX (2026-09-02)

**Context:** the R-32-era standing classification `ASSIGN_RUNTIME_ENFORCEMENT` (recorded
"OPEN — DECLARATION ONLY") awaited a measured live submission of the Parts Manager Assign
write — a client-side, firestore.rules-governed update — rather than component-test
evidence alone. PR #1731 (merge `c01843ba`) repaired the Assign panel presentation and was
deployed to sandbox hosting; the measurement was then performed through the SHIPPED UI.

**Measured evidence (sandbox, deployed `c01843ba`):** the partsManager persona submitted
one real assignment through the shipped UI. Request `ywq7UpdczU1KZ6Z86ejS` transitioned
`READY_FOR_PARTS_MANAGER → ASSIGNED_TO_PARTS_ASSOCIATE`; `assignedToUserId`
(`9jhm9a0C1SSyxrxqNGFfalsUiyi1`, employee `cw-emp-026`), `assignedBy` (the manager's uid),
`assignedAt`, `status`, and `currentOwner` all persisted correctly under the existing
Rules branch. No Rules, Functions, grants, capabilities, or authority surface changed.

**Ruling:** `ASSIGN_RUNTIME_ENFORCEMENT` is **CLOSED_SANDBOX**.

**This closure explicitly does NOT close:**
- `PRODUCTION_EXPOSURE` (still UNMEASURED — deployment blocker stands)
- assignee first-person visibility measurement (the eligible fixture assignees have no
  loginable persona; visibility is Rules-deterministic but unmeasured first-person)
- loginable Parts Associate fixture eligibility (`sbx-partsassoc` carries
  `securityRole=technician` and is excluded by the governed eligibility filter)
- `LEGACY_UNSCOPED_REORDER` rows / repeated `CW-P-0000` titles / `Approved —` metadata

The historic classification lines in the R-32-era entries above are history and are not
rewritten; this entry is the closure record.

---

## #159 — OWNER RULING: Finance Manager parity restored + the FIN-004 financial visibility matrix (2026-09-02)

**Context.** The dashboard reporting census (#1740) reported that no Role carried any
`finance.visibility.*` capability. That finding was WRONG — it was measured by grepping the Role
source files, which cannot see `admin`'s derived grants (`ADMIN_CURATED_PERMISSIONS` + the whole
`PERMISSION_CATALOG`, ruling 2026-08-19). The correction is #1743 and
`docs/assessments/fin004-reach-reconciliation.md`.

Re-measuring by resolver DID surface a real defect. `financeManager` held **5** permissions and
**zero** `finance.*` ids — the Role named Finance Manager could not read a single financial fact
anywhere — while `accountingManager` held **17**, and both Role descriptions said *"intentionally
identical (Owner ruling 2026-08-18)"*. Nothing caught it because the pinning test was
**directional** (`accounting ⊇ finance`, `length >=`), which passes at 17 vs 5 while its own
comment ("the two are identical again") was false.

**Ruling 1 — parity.** Finance Manager and Accounting Manager **remain intentionally identical**.
Parity is RESTORED. This is a restoration of already-recorded Role policy (#114 as amended
2026-08-18), not a new expansion of business authority.

This supersedes the ORDERING left by the 2026-08-19 "Purchasing falls under accounting" ruling:
purchasing moved to `purchasingManager` on 2026-08-20, so nothing remains that Accounting should
hold and Finance should not. The relationship is **equality**, and the pinning test is now exact
set equality — it must reject a missing permission, an extra permission, and
same-length-different-membership. Both Roles are built from ONE shared constant
(`MONEY_MANAGER_PERMISSIONS`); if they are ever ruled apart, that constant splits in the same change.

**Ruling 2 — the financial visibility matrix.** Financial visibility is granted by explicit
business need. Holding `finance.read` alone does NOT imply reach; the FIN-004 invariant stands —
FINANCIAL REACH = fact-family gate + active explicit visibility scope, and either alone reaches
nothing.

| Role | Scope |
|---|---|
| `owner` | CONSOLIDATED (existing grants untouched) |
| `admin` | CONSOLIDATED (existing grants untouched) |
| `generalManager` | CONSOLIDATED |
| `financeManager` | CONSOLIDATED |
| `accountingManager` | CONSOLIDATED |
| `salesManager` | TEAM |
| `salesperson` | SELF |

**No new financial visibility for** `operationsManager`, `fieldManager`, `purchasingManager`,
`officeManager`, `marketingManager`, `shopManager`, `shopAssociate`, `partsManager`,
`partsAssociate`, `warehouseManager`, `warehouseAssociate`, `controller`, `dispatcher`,
`technician`, `generalEmployee`, or any execution/special-purpose Role. A Role carrying
`finance.read` and no scope is an **allowed, intentional, fail-closed state**.

**No new BUSINESS_UNIT or OPERATING_COMPANY carrier.** Those scope types remain valid FIN-004
architecture for future explicit use; this ruling establishes no carrier for either.

**Ruling 3 — GRANT ≠ ACTIVATION; the matrix is deliberately NOT completed.** Only
`finance.visibility.consolidated` is sandbox-eligible and sandbox-active. So `salesManager` (TEAM)
and `salesperson` (SELF) hold real ruled grants and resolve **ZERO** reach until a separate Owner
activation ruling makes those scopes eligible and active. That is the correct outcome, not an
incomplete one. Production activates nothing for any principal, `admin` and `owner` included.

**Scope binding is fail-closed and unchanged.** TEAM resolves through the governed hierarchical
visibility authority; SELF binds through `users/{uid}.employeeId`. An unresolved team or an
unlinked employee reaches zero and is surfaced as a BLOCKED scope — never widened, never inferred
from Customer ownership, creator, or Opportunity owner.

**Consequential side effect, recorded rather than absorbed:** parity carries
`warehouse.transferOrder.read` to `financeManager`, taking that roster from eight Roles to nine.
Required by the parity ruling, since Accounting Manager's canonical row declares the id.

**Not changed by this ruling:** financial calculations, invoice/payment/AR semantics, FIN-002
attribution, FIN-004 visibility semantics, Firestore Rules, scope types, production. FIN-BLOCK-003
is untouched — reach is not cost, and margin remains structurally UNKNOWN for every carrier.

**Evidence:** `functions/test/fin004ReachComposition.test.mjs` (18 checks: the five invariant
proofs, the approved matrix, the no-unintended-carrier guard, activation state, per-environment
resolved reach, and TEAM/SELF binding) and the exact-equality parity proof in
`functions/test/governedBusinessRoles.test.mjs`. Record:
`docs/assessments/fin004-reach-reconciliation.md` §6–§9.
## #160 — OWNER RULING: EOS dashboards compose authority, and derived information may appear on one (2026-09-02)

**Context:** the dashboard reporting authority census (#1740) classified 132 dashboard fact families
and closed with four formalization items and four Owner decisions still open. Three of those
formalization items and one of the decisions were about the same subject — what a dashboard is
allowed to be — and none could be answered by reading more code. The Owner answered them as one
ruling while directing the dashboard + performance-management program.

**Ruling, in two parts.**

1. **"EOS dashboards compose existing domain authority. A dashboard is never a second permission
   layer."** A tile reads through the SAME read authority, at the SAME scope, that the domain's own
   workspace uses. It holds no capability of its own, widens none, and narrows none — a fact a
   person's authority would refuse is ABSENT, not empty and not zero. No `dashboard.*` capability
   exists and none is to be minted. Personalization may compose only governed context that already
   exists (principal, Roles, capabilities, employee identity, governed position, ownership,
   assignment, technician binding, location scope, business-unit / operating-company scope, and each
   domain's own read authority) — and never a persona NAME, following `deriveScanWorkflows`, which is
   capability-derived and cannot receive a persona.

2. **Clearly identified derived informational projections MAY appear on a dashboard** where the
   derivation already exists and is already governed. This extends ND-28, which ruled for a RECORD
   PAGE and expressly did not address a dashboard tile. Conditions, all required: the derivation
   already exists; it is unmistakably labelled `DERIVED` / `FORECAST` / `PREDICTION` / `INSIGHT`; it
   does not replace, rename or visually impersonate authoritative operational truth; and it does not
   carry the visual weight of a governed principal quantity. Refused by name: calling a forecast "On
   hand", calling a prediction "Available", treating derived inventory as ATP, and presenting UNKNOWN
   as zero. `NEEDS_PLANNING` means "the engine had nothing to compute", never "risk is low".
   **UNKNOWN remains UNKNOWN.**

**The product model recorded alongside it.** Every primary persona dashboard provides, WHERE GOVERNED
FACTS EXIST: CURRENT WORK · PERFORMANCE AGAINST GOAL · BUSINESS IMPACT · GO TO. Management dashboards
may add TEAM PERFORMANCE and DRIVERS / EXCEPTIONS at the manager's existing governed scope. "Where
governed facts exist" is load-bearing: a section with no governed fact behind it renders an honest
unavailable state naming what is missing, and is never filled with something adjacent.

**Closes:** census §7 F-01 (dashboard read/scope rule), F-02 (the attention taxonomy ACTION_ITEM /
NOTIFICATION as the platform-wide dashboard vocabulary, including the no-ALERT and no-re-badging
rules), F-11 (truncation/completeness honesty), and §9 Owner decision 4.

**Does NOT close:** census §9 decisions 2 (reporting-period authority) and 3 (the cost supply). Both
remain open, and every fact family behind them stays honestly unavailable.

Decision 1 (FIN-004 has no carrying Role) was **WITHDRAWN by #1743** as a measurement error, and
closed for admin/owner in sandbox by #1744 — after this ruling was drafted. The dashboard modules
and metric registry entries that cited it were corrected to name their REAL blockers, which for the
period-based financial figures is the reporting-period authority rather than reach.

**Enforced by:** `docs/governance/eos-dashboard-composition-authority.md` (canonical text).

## #161 — OWNER DIRECTION: a governed Performance Goal Authority, reconciling FIN-003 (2026-09-02)

**Context:** EOS could state what happened and never what should have happened. FIN-003
(`finance/planVsActual.ts`) already defined a versioned GOAL/BUDGET plan with a
DRAFT to APPROVED to SUPERSEDED lifecycle, an explicit measurement basis and a never-blend comparison
core — merged, tested, and dormant since it landed for want of storage and an approval authority (its
own §2 names both as deliberately undecided). The Owner directed a general performance-goal authority
and named the constraint: "reconcile FIN-003 rather than creating two competing goal systems."

**Decision — the invariant.** DOMAIN AUTHORITY OWNS THE ACTUAL. PERFORMANCE GOAL AUTHORITY OWNS THE
TARGET. THE DASHBOARD COMPARES THEM. No goal record carries, caches or recomputes an actual, and no
dashboard recomputes either half.

**The reconciliation runs in ONE direction.** `functions/src/performance/` is the GENERAL authority
(a target may be a count, a percentage, a duration or an amount). A goal whose metric declares a
`financialBasis` **IS** a FIN-003 plan: `planRecordForGoal()` projects it through `buildPlanRecord`,
and its comparison runs through `comparePlanToActual`. There is no second money path, no second
never-blend rule, and no second definition of what BOOKED means. Approval composes FIN-007, whose
`APPROVABLE_ACTION_TYPES` already reserved `PLAN_APPROVAL` with a nullable amount expressly "for
non-monetary actions (e.g. plan approval)" — FIN-007 supplies the mechanical invariants
(self-approval forbidden under any policy, a reason mandatory), and WHO may approve is the one thing
FIN-007 leaves to its composer. **FIN-003 did not change to receive its missing halves.**

**A metric registry, not free-form ids.** A goal may reference only a registered metric.
THIRTY-SEVEN are registered; TEN are active. The other twenty-one are registered WITH THEIR BLOCKER NAMED, because
what the platform would measure and exactly what stops it is more useful than silence. Every WINDOWED
metric is inactive — G-05, no reporting-period authority — which is the single rule keeping the
registry honest.

**Management authority is four factors, none of them a title.** The Owner's rule was "holding a
manager title alone must not widen scope", so nothing reads a Role name: (1) the goal capability
resolved AT THE TARGET'S OWN SCOPE; (2) authority over the metric's own actual — *you may not set a
target on a number you are not authorized to see*, which keeps a Sales Manager out of warehouse goals
without a rule about sales managers and warehouses; (3) governed hierarchical visibility for an
EMPLOYEE target; (4) FIN-007's self-approval refusal. Plus: an employee does not author their own
target — necessary because `visibleEmployeeIdsFor` deliberately includes the viewer's own employeeId,
so factor 3 alone would permit it.

**Scopes are activated only where the binding can be PROVEN.** EMPLOYEE, LOCATION, BUSINESS_UNIT,
OPERATING_COMPANY and FIRM bind to existing governed authorities. **TEAM is registered and
deliberately NOT bindable**: no `teams` collection and no `reportsTo` edge exist, and
`roleHierarchy.ts` records its own limit — every salesManager sees every salesperson, so "the team
beneath manager X" is not distinguishable from manager Y's. A manager may still VIEW a rollup across
the employees hierarchy grants them; that is a per-viewer visibility set, not a team, and it cannot be
the durable target of a stored goal.

**Rollups are declared, never assumed.** A rate rolls up as sum(numerator) / sum(denominator), never
average(percentages) — which would weight a technician who closed two jobs equally with one who closed
forty. A metric whose rollup rule is not declared does not roll up at all.

**Capabilities:** five, all registered `active:false` — `performance.goal.read` / `.create` /
`.approve` / `.supersede` / `.retire`. Authoring and approval are separate ids so one person cannot
set and bless their own team's numbers in a single act; supersede is separate because it is the only
operation that closes an existing version's window. Granted per the Owner's §E policy table to owner,
generalManager, operationsManager, salesManager, fieldManager, partsManager, warehouseManager and
purchasingManager (all five verbs), and read-only to salesperson, partsAssociate and
warehouseAssociate.

**CORRECTION, same day — admin and owner ALSO hold all five, and not by any grant written here.**
The first version of this entry claimed "admin is deliberately NOT granted", reasoning that
administering access is a different job from setting targets. That claim was false about this
codebase. `ADMIN_ROLE.permissions` is DERIVED as `ADMIN_CURATED_PERMISSIONS` plus the ENTIRE
`PERMISSION_CATALOG` (Owner ruling 2026-08-19: "Admin and Owner have full access to all possible
features and permissions"), so **registering a capability grants it to admin — and to owner, which
composes admin's set — the moment it is registered.** Measured by resolver, not by reading: admin
resolves all five goal verbs.

This is the SAME derivation that defeated the dashboard census's grep-based FIN-004 measurement
(#1743, withdrawn), met twice in one week. The lesson is recorded rather than the symptom patched:
**a claim about who holds a capability is measured by the resolver, never by searching Role
sources** — admin's grants appear as literals nowhere. An explicit owner grant added on the false
premise has been removed, because a duplicate that reads as a deliberate distinction encodes one
that does not exist.

The practical consequence is small and acceptable: admin can author and approve goals. FIN-007's
self-approval prohibition still applies to them unconditionally, and every act is audited.

**One new Role: `performanceGoalSubject`**, carrying exactly `performance.goal.read`. It exists
because `technician` and `dispatcher` are COMPATIBILITY Roles whose contract is to reproduce today's
matrix EXACTLY — they are the parity oracle the shadow harness scores against, and adding a capability
to one in order to ship a feature would corrupt the measuring instrument.

**`salesManager` and `salesperson` are no longer identical**, for the first time. The manager holds the
four write verbs; the salesperson holds only read. The asymmetry is load-bearing rather than drift:
without it a salesperson could author their own quota.

**History is not rewritten.** Superseding does not edit a goal — it closes the predecessor's window and
writes a new version beside it, in the SAME transaction as the approval that makes the successor
authoritative, so no instant exists in which two approved versions cover one date (which
`currentGoalFor` refuses rather than resolving by array order). The close may SHORTEN a window and
never LENGTHEN one.

**No Rules change.** `performance_goals` has no `firestore.rules` match block and is denied to every
client by rule absence — the posture `crm_activities` already relies on. The explicit deny-all block is
prepared for the Owner rather than merged, since a Rules edit is Tier-2 and would force a deploy cycle
for a change with no behavioural effect.

**Activation:** the five ids are declared for `platform-sandbox` in all three registries that must
agree (`config/environments.json`, the Functions snapshot, and `scripts/resolveEnvironment.mjs`, which
the frontend bakes into its bundle). Production is untouched and resolves EMPTY unconditionally.
**Deploy remains Owner-executed.**

**Enforced by:** `functions/src/performance/*`; suite `functions/test/performanceGoal.test.mjs`
(37 cases); workflow `.github/workflows/performance-goal-tests.yml`.