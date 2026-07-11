---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
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

Six PRs, one architectural concern each, in dependency order. No PR in this plan is implemented, merged, or run against production by this document itself -- each requires its own Codex review (where warranted, per `docs/ai/workflow.md` -- Rules changes here qualify), its own ChatGPT Final Review, and its own Owner Merge Authorization before merge; the three Rules-relevant PRs (2, 4, 5) additionally each require a **separate Owner Deployment Authorization** after merge, per this Specification's "Schema deployment sequence" and this session's own established pattern (PR #109/#111/#114's index/Rules deploys). **This plan is planning only -- no application code, Firestore Rules, or provisioning has been run.**

## PR breakdown

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|
| 1 | Cancel/Void schema fields -- transitional Rules | Specification's deployment-sequence step A: `hasCanonicalReorderRequestKeys()`/`...CreationBaseline()` accept old shape (no new keys) OR new shape (six new keys, all `null`); reject partial presence | None | Not started |
| 2 | Cancel/Void schema fields -- writer | `createReorderRequest()` always sends the six new fields as `null`. Frontend-only, no Rules change. Step B; step C's live confirmation happens after this merges and deploys, recorded in `docs/DECISIONS.md`, not its own PR | PR 1 (deployed and confirmed live) | Not started |
| 3 | Cancel/Void schema fields -- tightened Rules | Specification's step D: remove the old-shape branch, require the six new keys unconditionally. Step E's live confirmation happens after this merges and deploys, recorded in `docs/DECISIONS.md` | PR 2 (deployed and confirmed live, per step C) | Not started |
| 4 | Cancel Reorder Request | New `CANCELLED` status/branch on `reorder_requests`, `cancelReorderRequest()` write function, Rules (`isAdminOrDispatcher()`, three reachable source statuses, non-blank-reason regex) | PR 3 (deployed and confirmed live) | Not started |
| 5 | Void Purchase Order | New `VOIDED` status/branch, new `reorder_purchase_order_voids` collection and Rules (Purchase-Order-existence proof, cross-document invariant, reason/timestamp binding), `voidPurchaseOrder()` write function | PR 3 (deployed and confirmed live) | Not started |
| 6 | Cancel/Void UI | `PartDetail.jsx` actions (reason field, confirmation copy), `ReorderRequestCancelled`/`ReorderRequestVoided` read-only cards, `useReorderPurchaseOrderVoids.js` hook, `docs/BusinessEntityModel.md` Section 4/4b update | PR 4, PR 5; **also depends on PR #107 merging** (`resolveActorDisplayName()`) for the two new cards' actor-name display -- see External dependencies | Not started |

## Sequencing notes

PRs 1-3 must land and deploy strictly in order -- this is the Specification's expand/contract sequence, not an arbitrary planning choice. PR 2's writer change is only safe against PR 1's transitional Rules (which accept both shapes); PR 3's tightening is only safe once PR 2 is confirmed live (per step C) -- tightening before every live client is sending the new shape would reject in-flight creates from any client still running the old writer. **PR 3 must not be drafted until PR 2's step-C confirmation is recorded in `docs/DECISIONS.md`.**

PRs 4 and 5 both depend on PR 3 (deployed and confirmed), not on each other -- Cancel and Void are independent transitions on independent source statuses (`CANCELLED` reachable pre-`ORDERED`, `VOIDED` only from `ORDERED`), so PRs 4 and 5 could in principle be implemented in either order or in parallel. Sequenced 4-then-5 here only to match the Specification's own section order, not because of a hard dependency between them.

PR 6 (UI) depends on both 4 and 5 being deployed and live -- it wires up actions against Rules branches that must already exist in production, the same "Rules before UI" discipline every prior sprint on this object has followed (e.g. Sprint 2.1.10's Purchase Order Foundation). It does not itself carry a Rules change.

**Each of PRs 1, 3, 4, and 5 is Rules-relevant** (PR 1 and 3 touch the exact-key creation gate; PR 4 and 5 add new `update`/`create` branches) and requires its own independent Rules-focused Final Review plus a separate Owner Deployment Authorization after merge -- four separate deployment authorizations across this plan, not one blanket authorization covering the whole sprint. PR 2 and PR 6 are frontend-only and auto-deploy at merge, same as every prior frontend-only PR in this initiative (e.g. PR #105, PR #107).

## External dependencies

- **PR #107** (post-assignment raw-User-ID display fix, open as of this writing) must merge before PR 6 is implemented, so `ReorderRequestCancelled`/`ReorderRequestVoided` can reuse `resolveActorDisplayName()` rather than re-introducing a raw-uid display. If PR #107 is still open when PR 6 is otherwise ready, PR 6 either waits or ships with an explicit, documented raw-uid fallback and a tracked follow-up -- not a silent regression, per the Specification's UI impact section.
- No dependency on Firebase Blaze / Cloud Functions -- every write path in this plan is client-direct-write-with-rules, matching every prior sprint on this object.
- No dependency on the Parts and Purchase Order Assignment Adoption initiative, or on the Zero-history reorder behavior sprint's own closed scope.

## Tracking

| PR | Merge status | Deployment status |
|---|---|---|
| 1 -- Transitional Rules | Not started | Not deployed |
| 2 -- Writer | Not started | Not deployed |
| 3 -- Tightened Rules | Not started | Not deployed |
| 4 -- Cancel Reorder Request | Not started | Not deployed |
| 5 -- Void Purchase Order | Not started | Not deployed |
| 6 -- UI | Not started | Not deployed |

Update this table as each PR merges and deploys -- this document is the running source of truth for "what's left in this sprint" until it completes, per the template's own guidance. Link from `docs/SPRINT_STATUS.md` once PR 1 is opened.
