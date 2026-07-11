---
artifact_type: implementation-plan
gate: Implementation Plan
status: Approved
date: 2026-07-11
owner: Claude Code
related_adrs: []
depends_on: [docs/specifications/reorder-request-cancellation.md]
implements: [docs/specifications/reorder-request-cancellation.md]
supersedes: []
superseded_by: []
related_pr: 108
target_release: Release 2.1 -- Inventory to Procurement workflow chain
---

# Implementation Plan: Governed Cancel/Void for Reorder Request and Reorder Purchase Order

**Sprint Specification:** `docs/specifications/reorder-request-cancellation.md` -- Approved, 2026-07-11.

**Implementation Plan Final Review: APPROVED, 2026-07-11**, after one REQUEST CHANGES round. **Round 1 -- REQUEST CHANGES** (reviewed head `4851324`): five required corrections -- Rules-relevant PR count/list (was "PRs 2, 4, 5", corrected to 1, 3, 4, 5), a "Deployment and rollback boundaries" section, a five-state tracking table, a "Legacy-document test obligation" section for PRs 4/5, and a "PR 4/5 merge-before-Rules-deployment safety" section; applied at head `d3d5cef`. **Round 2 -- APPROVED at head `d3d5cef51898f08e66701cf4a9e479afcf1f9037`.** Rebased onto `main` at `cc13f10` (post PR #120) after this approval -- documentation-only scope, mergeability, and CI unaffected by the rebase.

Six PRs, one architectural concern each, in dependency order. No PR in this plan is implemented, merged, or run against production by this document itself -- each requires its own Codex review (where warranted, per `docs/ai/workflow.md` -- Rules changes here qualify), its own ChatGPT Final Review, and its own Owner Merge Authorization before merge; the four Rules-relevant PRs (1, 3, 4, 5) additionally each require a **separate Owner Deployment Authorization** after merge, per this Specification's "Schema deployment sequence" and this session's own established pattern (PR #109/#111/#114's index/Rules deploys) -- **four Rules-focused Final Reviews, four separate Owner Deployment Authorizations, not one blanket authorization**. PR 2 (writer) is frontend application code that depends on PR 1's Rules but is not itself Rules-relevant; PR 2 and PR 6 are frontend-only and auto-deploy at merge. **This plan is planning only -- no application code, Firestore Rules, or provisioning has been run.**

## PR breakdown

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|
| 1 | Cancel/Void schema fields -- transitional Rules | Specification's deployment-sequence step A: `hasCanonicalReorderRequestKeys()`/`...CreationBaseline()` accept old shape (no new keys) OR new shape (six new keys, all `null`); reject partial presence | None | **Merged and deployed, PR #117** (shipped separately, before this Implementation Plan formally existed; deployment confirmed by the Owner, `docs/DECISIONS.md` entry #17) |
| 2 | Cancel/Void schema fields -- writer | `createReorderRequest()` always sends the six new fields as `null`. Frontend-only, no Rules change. Step B; step C's live confirmation happens after this merges and deploys, recorded in `docs/DECISIONS.md`, not its own PR | PR 1 (deployed and confirmed live) | **Merged and deployed, PR #127. Step C: COMPLETE** -- production audit of all 3 post-deployment `reorder_requests` documents confirmed the complete 35-key shape on every one (`docs/DECISIONS.md` entry #24, resolving the entry #23 dispute). |
| 3 | Cancel/Void schema fields -- tightened Rules | Specification's step D: remove the old-shape branch, require the six new keys unconditionally. Step E's live confirmation happens after this merges and deploys, recorded in `docs/DECISIONS.md` | PR 2 (deployed and confirmed live, per step C) | **Merged and deployed, PR #132. Step E verified (`docs/DECISIONS.md` entries #25, #26).** |
| 4 | Cancel Reorder Request | New `CANCELLED` status/branch on `reorder_requests`, `cancelReorderRequest()` write function, Rules (`isAdminOrDispatcher()`, three reachable source statuses, non-blank-reason regex) | PR 3 (deployed and confirmed live) | **Open, Draft, PR #TBD. Awaiting Rules-focused Final Review. Not merged, not deployed.** |
| 5 | Void Purchase Order | New `VOIDED` status/branch, new `reorder_purchase_order_voids` collection and Rules (Purchase-Order-existence proof, cross-document invariant, reason/timestamp binding), `voidPurchaseOrder()` write function | PR 3 (deployed and confirmed live) | Not started |
| 6 | Cancel/Void UI | `PartDetail.jsx` actions (reason field, confirmation copy), `ReorderRequestCancelled`/`ReorderRequestVoided` read-only cards, `useReorderPurchaseOrderVoids.js` hook, `docs/BusinessEntityModel.md` Section 4/4b update | PR 4, PR 5. (PR #107 dependency **satisfied** -- merged, `5911fd9` -- see External dependencies) | Not started |

## Sequencing notes

PRs 1-3 must land and deploy strictly in order -- this is the Specification's expand/contract sequence, not an arbitrary planning choice. PR 2's writer change is only safe against PR 1's transitional Rules (which accept both shapes); PR 3's tightening is only safe once PR 2 is confirmed live (per step C) -- tightening before every live client is sending the new shape would reject in-flight creates from any client still running the old writer. **PR 3 must not be drafted until PR 2's step-C confirmation is recorded in `docs/DECISIONS.md`.**

PRs 4 and 5 both depend on PR 3 (deployed and confirmed), not on each other -- Cancel and Void are independent transitions on independent source statuses (`CANCELLED` reachable pre-`ORDERED`, `VOIDED` only from `ORDERED`), so PRs 4 and 5 could in principle be implemented in either order or in parallel. Sequenced 4-then-5 here only to match the Specification's own section order, not because of a hard dependency between them.

PR 6 (UI) depends on both 4 and 5 being deployed and live -- it wires up actions against Rules branches that must already exist in production, the same "Rules before UI" discipline every prior sprint on this object has followed (e.g. Sprint 2.1.10's Purchase Order Foundation). It does not itself carry a Rules change.

**Each of PRs 1, 3, 4, and 5 is Rules-relevant** (PR 1 and 3 touch the exact-key creation gate; PR 4 and 5 add new `update`/`create` branches) and requires its own independent Rules-focused Final Review plus a separate Owner Deployment Authorization after merge -- four separate deployment authorizations across this plan, not one blanket authorization covering the whole sprint. PR 2 and PR 6 are frontend-only and auto-deploy at merge, same as every prior frontend-only PR in this initiative (e.g. PR #105, PR #107).

## External dependencies

- **PR #107** (post-assignment raw-User-ID display fix) -- **merged and satisfied**, merge commit `5911fd9858e1a9121afbf31e1c669428ae6c5090`. `field-ops-app-vite/src/hooks/useEmployeeDirectory.js`'s `resolveActorDisplayName()` is available on `main`; `ReorderRequestCancelled`/`ReorderRequestVoided` (PR 6) can consume it directly, no fallback/follow-up needed.
- No dependency on Firebase Blaze / Cloud Functions -- every write path in this plan is client-direct-write-with-rules, matching every prior sprint on this object.
- No dependency on the Parts and Purchase Order Assignment Adoption initiative, or on the Zero-history reorder behavior sprint's own closed scope.

## Deployment and rollback boundaries

Each boundary below describes what is safe to revert at that point in the sequence, and what must never happen. This is a durable part of the plan, not a one-time note -- consult it before authorizing any rollback at any stage of this sprint, present or future.

**Before PR 1 deployment.** No live impact yet. Normal `git revert`/branch rollback is safe -- nothing in production depends on any part of this sprint.

**After PR 1 (transitional Rules) deployed, before PR 2 (writer) deployed.** Reverting to pre-transition Rules is safe: no new-shape writer is live yet, so no in-flight write depends on the transitional Rules' new-shape branch.

**After PR 2 (writer) deployed, before PR 3 (tightened Rules).** Transitional Rules (PR 1) must remain live -- the writer now sends the new shape and needs the transitional Rules' new-shape branch to accept it. The writer itself may be rolled back to the old shape at any time in this window, since transitional Rules still accept both shapes. **Never revert Rules to the old strict (pre-PR-1) shape while any new-shape writer remains live** -- doing so would reject every subsequent create from that writer.

**After PR 3 (tightened Rules) deployed.** Old-shape creates are now rejected unconditionally. To roll back the writer (PR 2) after this point, transitional Rules (PR 1's shape) must be redeployed *first* -- confirm transitional Rules are live before rolling back the writer, otherwise the old-shape writer's creates will be rejected the moment it goes live. **Never deploy old-shape-only Rules while any new-shape client may still exist** -- that would reject creates from any writer still running the new shape.

**After PR 4/5 (Cancel/Void terminal records exist).** The Cancel/Void *capability* may be disabled going forward through a reviewed Rules/code rollback (e.g. removing the `CANCELLED`/`VOIDED` write branches). **Existing `CANCELLED`/`VOIDED` Reorder Requests and their append-only void records remain permanent** -- no rollback at any stage deletes, rewrites, or reopens a terminal record. Original Purchase Orders referenced by a void record remain immutable, unchanged by any rollback.

**After PR 6 (UI) deployed.** The UI may be reverted independently of Rules, as long as the underlying Rules state remains one of the safe configurations described above. Removing the UI does not remove or alter any existing terminal (`CANCELLED`/`VOIDED`) record -- those remain visible only through whatever UI or direct query is available at the time, but the data itself is untouched.

## Tracking

Distinguishes five states per PR, not two: merged, frontend live, Rules deployed, Rules verified live, and (where applicable) required production/document-shape verification complete. "Merged" is never treated as equivalent to "deployed" or "verified live" -- per this repo's standing lesson (`docs/SPRINT_STATUS.md`'s "Discipline notes," merged ≠ deployed).

| PR | Merged | Frontend live | Rules deployed | Rules verified live | Additional verification |
|---|---|---|---|---|---|
| 1 -- Transitional Rules | Merged (PR #117) | N/A (Rules-only) | Deployed | Confirmed live by Owner (`docs/DECISIONS.md` entry #17) | -- |
| 2 -- Writer | Merged (PR #127) | Deployed | N/A (no Rules change) | N/A | **Step C: COMPLETE.** Frontend deploy confirmed (`docs/DECISIONS.md` entry #18); a disputed `TST-1003` report (entry #23) was resolved by a full production audit of all 3 documents created after PR #127's deployment cutoff (`1783790142000` ms) -- every one has the complete 35-key shape, including the newest `TST-1003` document (`docs/DECISIONS.md` entry #24) |
| 3 -- Tightened Rules | Merged (PR #132) | N/A (Rules-only) | Deployed | Confirmed live (`docs/DECISIONS.md` entry #26, two-call deploy verification) | 40/40 Rules-emulator assertions pass pre-deploy. **Step E: VERIFIED.** Full schema deployment sequence (A-E) complete. |
| 4 -- Cancel Reorder Request | Open, Draft (PR #TBD) | N/A (Rules-only) | Not deployed | Not verified | Legacy-document Cancel test obligation confirmed passing (51/51 Rules-emulator assertions, fresh emulator) -- see "Legacy-document test obligation" below. Awaiting Rules-focused Final Review. |
| 5 -- Void Purchase Order | Not started | Not deployed | Not deployed | Not verified | Legacy-document Void test obligation (see "Legacy-document test obligation" below) confirmed passing before Rules deploy |
| 6 -- UI | Not started | Not deployed | N/A (no Rules change) | N/A | Browser verification of Cancel/Void actions and read-only cards, recorded in `docs/DECISIONS.md` |

Update this table as each PR merges, deploys, and is verified -- this document is the running source of truth for "what's left in this sprint" until it completes, per the template's own guidance. Link from `docs/SPRINT_STATUS.md` once PR 1 is opened.

## Legacy-document test obligation (PRs 4 and 5)

Existing Reorder Requests created before PR 1 deployed may lack all six of this sprint's reserved fields entirely (the old 29-key shape, per `docs/SPRINT_STATUS.md`'s Zero-history reorder sprint history of this same expand/contract pattern on this collection). PR 4 and PR 5 must each include Rules-emulator fixtures proving:

- An eligible legacy-shape document (missing all six reserved fields) **can** transition to `CANCELLED` (PR 4) or have a void record created against its Purchase Order (PR 5) without any bulk backfill migration.
- Only the relevant terminal fields for that transition are added by the write (e.g. `cancelledAt`/`cancelledBy`/`cancellationReason` for PR 4) -- no other reserved field is silently populated as a side effect.
- Every other existing lifecycle field on the document (`status`, `assignedToUserId`, `purchasingStartedBy`, etc.) remains pinned -- the transition does not touch fields outside its own concern.
- A write that attempts to add a partial or unrelated subset of the six reserved fields (not the exact set the transition owns) is rejected by Rules, the same "exact-key" discipline this collection's `hasCanonicalReorderRequestKeys()` already enforces for creates.

## PR 4/5 merge-before-Rules-deployment safety

PR 4 and PR 5 each contain both application domain functions (`cancelReorderRequest()`, `voidPurchaseOrder()`) and their supporting Rules changes. Because frontend bundles auto-deploy at merge (per `docs/Deployment.md`) while Rules deploy separately and later (their own Owner Deployment Authorization), each PR's frontend code goes live *before* its Rules do. This is safe only because:

- No production UI invokes `cancelReorderRequest()` or `voidPurchaseOrder()` until PR 6 ships -- PR 4 and PR 5 add the functions as dormant exports, not wired to any button, route, or other production caller.
- PR 6 itself remains blocked until PR 4's and PR 5's Rules are both deployed and confirmed live (see "Sequencing notes" above) -- so the window between a PR 4/5 frontend deploy and its Rules deploy is never exposed to a real user action.
- **Scope check for PR 4 and PR 5's Final Review:** confirm neither PR adds a button, route, nav entry, or any other production caller that could invoke the new function before its Rules are live. If either PR is found to add one, that is a scope violation requiring correction before merge, not something to fix after the fact.
