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

**Upstream: none.** No Rules change (confirmed in the Specification's "Firestore Rules impact" section -- the existing unconditional read rule already permits a single-document `get`/`onSnapshot` by ID), no new Firestore index, no other in-flight work this PR itself depends on.

**Downstream: PR 6 (Cancel/Void UI) is a sequencing prerequisite, not merely separate scope.** This sprint's PR does not implement any of PR 6's own scope, and PR 6 does not implement any of this sprint's scope -- the two touch different files with no code overlap. But PR 6 is a downstream consumer of correct navigation identity: its `ReorderRequestCancelled`/`ReorderRequestVoided` read-only terminal-state cards render on `PartDetail`, the exact page a misrouted notification click currently lands a user on unexpectedly. Shipping PR 6 before this fix is verified would let that exact defect surface through PR 6's own new UI, immediately. **Therefore: PR 6 must not begin until this sprint's PR is merged, deployed to the frontend, and verified against the multiple-requests-per-part scenario** -- see "Tracking" below for the exact verification gate that must be checked off first. Issue #140 (unrelated topic) has no sequencing relationship in either direction, confirmed in the Assessment.

## Verification strategy

Resolves the Specification's own undecided point ("existing hook-testing conventions, or a lightweight ... script if no hook test harness exists yet") -- confirmed by direct inspection: **no frontend hook-testing harness exists in this repository.** `field-ops-app-vite/package.json` has no `vitest`/`jest`/`@testing-library/react` dependency and no test script; `find field-ops-app-vite/src -iname "*.test.*"` returns zero files. The only test convention this repository has anywhere is `functions/test/*.test.js` -- plain Node scripts using `firebase-admin` plus raw Firestore REST calls against a local emulator, zero new dependencies, run manually (`node functions/test/<file>.test.js`), used so far for Rules-enforcement testing (`employeesRules.test.js`, `reorderRequestsRules.test.js`).

Introducing a full React-rendering test harness (Vitest + `@testing-library/react` + jsdom) for one hook's resolution logic would be a disproportionate new-dependency addition, contrary to this project's established zero-new-dependency posture for testing. `useReorderRequestForPart()`'s actual defect-relevant logic -- exact-ID lookup, `partId` agreement check, not-found vs. mismatch distinction, and the newest-by-`createdAt` fallback across multiple requests for one part -- is genuinely Firestore-read logic, separable from React rendering. It is testable against a real emulator using the exact same tooling this repo already has, without touching React at all.

**Automated coverage -- new file `functions/test/notificationIdentityResolution.test.js`**, same zero-new-dependency convention as the three existing `functions/test/*.test.js` scripts (`firebase-admin`, raw Firestore REST reads, run against a local `firebase emulators:start --only firestore,auth` instance). Seeds multiple `reorder_requests` documents for one `partId` (a mix of active and terminal statuses, with a terminal document deliberately given a *later* `createdAt` than an active one -- the exact defect scenario), then exercises the same two Firestore access patterns the hook uses (a `get`-by-document-id read; a `where("partId","==",partId)` query sorted by `createdAt` descending) to assert:
- Exact-ID resolution returns the correct document regardless of any other, newer document existing for the same `partId`.
- A resolved document whose own `partId` doesn't match the expected `partId` is detected as a mismatch (the same comparison `useReorderRequestForPart()`'s `error: "mismatch"` branch performs).
- A `requestId` that doesn't exist is distinguished from a mismatch (`not_found` vs. `mismatch`, not collapsed into one generic failure).
- The unchanged fallback path (no `requestId` supplied) still returns the newest-by-`createdAt` document across multiple requests sharing one `partId`, status-agnostic -- proving the fallback is genuinely byte-for-byte unchanged, not accidentally also filtered by this sprint's changes.

This proves the Firestore-level semantics the hook depends on are correct. It does not, and cannot, prove the React/router wiring (`useSearchParams()` reading the query param, the `Link to=` templates actually including it, `PartDetail.jsx` actually branching on `error`) -- that half is covered by browser verification below.

**Browser verification -- required before this PR's implementation is considered complete**, using this repository's existing `run-field-ops-app-vite` Playwright skill (the established browser-driving convention for UI-touching PRs, per `docs/SPRINT_STATUS.md`'s discipline notes):
1. Seed the same multiple-requests-per-part fixture (active + terminal, terminal newer) in the emulator.
2. Click each of the four `NotificationPanel.jsx` sections' items in turn (Pending Review, Ready for Parts Manager, Assigned to You, Purchasing Started) and confirm each lands on the exact request that produced it, not the newer terminal one.
3. Click each of the three `PartsList.jsx` queue links (Parts Manager Queue, Parts Associate Waiting, Parts Associate In Progress) and confirm the same.
4. **Hard-refresh persistence**: from a `?requestId=`-bearing URL reached via step 2 or 3, hard-refresh the browser and confirm the same (correct) request still renders -- proving the query-parameter approach survives a refresh (the specific reason Option A was chosen over router-state-only Option C).
5. Visit `/inventory/:partId` directly (no query string) and confirm behavior is visually and functionally unchanged from today (the existing most-recent fallback).
6. **Confirm `PartsList.jsx:381`'s catalog-row link is unchanged** -- no `?requestId=` appended, no behavioral difference, still a plain `/inventory/${part.sku}` link.
7. Exercise the fail-safe path directly (a hand-edited URL with a foreign or non-existent `requestId`) and confirm `PartDetail.jsx` renders the distinct empty-state message, not a silently-wrong request, and that the rest of the page (Catalog/Stock Position/Recent Transactions) still renders normally.

**Frontend deployment verification -- the completion gate for the PR 6 sequencing prerequisite above.** After merge (auto-deploy, no Rules involved, per `docs/Deployment.md`), confirm via `gh run list --commit <merge-sha>` that both `Vite Build Check` and `Deploy Field Ops (Vite) to GitHub Pages` completed `success` at the merge commit -- the same method used throughout this session for every prior frontend-only PR (e.g. `docs/DECISIONS.md` entry #18). **PR 6 may not begin until all of: this PR is merged, this deployment check has passed, and the browser verification steps above have been re-run against the live deployed site** (not just the local emulator) confirming the multiple-requests-per-part scenario resolves correctly in production.

## Tracking

Distinguishes merge status from deployment status, per this project's standing "merged ≠ deployed" discipline -- though this PR is frontend-only and auto-deploys at merge (no separate deployment step or Owner Deployment Authorization applies, since there is no Rules change).

| PR | Merge status | Deployment status | Verification status |
|---|---|---|---|
| 1 -- Notification/queue links resolve by `reorderRequestId` | Not started | Not deployed | Not verified -- see "Verification strategy" above. This row must reach fully verified (automated + browser, including live-production re-check) before PR 6 begins. |

Update this table as the PR merges and deploys. Given this is a single-PR sprint, this table (not a separate `docs/SPRINT_STATUS.md` link) is sufficient to track "what's left" until it completes.
