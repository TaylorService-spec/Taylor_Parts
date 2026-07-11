---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
date: 2026-07-11
owner: Claude Code
related_adrs: []
depends_on: [docs/specifications/notification-identity.md]
implements: [docs/specifications/notification-identity.md]
supersedes: []
superseded_by: []
related_pr: 146
target_release: Post-Release 2.1 (Inventory -> Procurement chain)
---

# Implementation Plan: Notification/Queue Links Resolve by `reorderRequestId`, Not `partId`

**Sprint Specification:** `docs/specifications/notification-identity.md` -- Approved, 2026-07-11.

**One PR**, per the Specification's own "Estimated PR count" (single, cohesive navigation/identity concern; no Rules change, no schema change, no natural expand/contract boundary). Per the Implementation Plan template's own guidance, a standalone document isn't strictly required for a single-PR sprint -- created anyway at the reviewer's explicit request, for the same traceability this initiative's other artifacts already have. **This document is planning only -- no application code has been written.**

## PR breakdown

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|
| 1 | Notification/queue links resolve by `reorderRequestId` | `useReorderRequestForPart(partId, requestId)`'s exact-document resolution + `partId` validation + fail-safe `not_found`/`mismatch` states; `PartDetail.jsx`'s empty-state rendering on error; `NotificationPanel.jsx`'s and `PartsList.jsx`'s link updates (`?requestId=`) | None | Not started |

No sub-PR breakdown -- the Specification's own Scope section already enumerates every file this single PR touches (`useReorderRequests.js`, `PartDetail.jsx`, `NotificationPanel.jsx`, `PartsList.jsx`), and none of them can safely land independently of the others: shipping the hook change alone with no caller passing `requestId` would be a no-op; shipping the link changes alone without the hook's exact-resolution path would just append an inert, unused query parameter.

## Sequencing notes

Within the single PR, the hook change (`useReorderRequestForPart`) and `PartDetail.jsx`'s consumption of its new `error` field should be written before or alongside the link changes, so the feature is testable end-to-end in one commit rather than landing an unused parameter first. This is an internal ordering note for the PR's own commits, not a multi-PR dependency.

## External dependencies

- **None.** No Rules change (confirmed in the Specification's "Firestore Rules impact" section -- the existing unconditional read rule already permits a single-document `get`/`onSnapshot` by ID), no new Firestore index, no other in-flight work this depends on or is depended on by. Independent of PR 6 (Cancel/Void UI) and Issue #140 (both explicitly out of scope, confirmed in the Assessment and Specification).

## Tracking

Distinguishes merge status from deployment status, per this project's standing "merged ≠ deployed" discipline -- though this PR is frontend-only and auto-deploys at merge (no separate deployment step or Owner Deployment Authorization applies, since there is no Rules change).

| PR | Merge status | Deployment status |
|---|---|---|
| 1 -- Notification/queue links resolve by `reorderRequestId` | Not started | Not deployed |

Update this table as the PR merges and deploys. Given this is a single-PR sprint, this table (not a separate `docs/SPRINT_STATUS.md` link) is sufficient to track "what's left" until it completes.
