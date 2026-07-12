---
artifact_type: implementation-plan
gate: Implementation Plan
status: Approved
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

**Implementation Plan Final Review: APPROVED, 2026-07-11**, after three REQUEST CHANGES rounds. **Round 1** (reviewed head `22f2c2f`): corrected the PR 6 dependency from "independent" to an explicit sequencing prerequisite; resolved the Specification's undecided automated-verification method; applied at head `c71d608`. **Round 2** (reviewed head `c71d608`): made repeatable Playwright browser automation the primary implementation test rather than an independently-reimplemented Node script; removed the requirement to write production test data; applied at head `1f07779`. **Round 3** (reviewed head `1f07779`): corrected the PR breakdown/expected-file scope from four files to the complete seven (application + verification infrastructure, correctly classified); made the read-only production smoke check non-vacuous; applied at head `c9caf24`. **Approved at exact head `c9caf24f73e0c2e937db437aa0ed26b667b644ea`.**

**One PR**, per the Specification's own "Estimated PR count" (single, cohesive navigation/identity concern; no Rules change, no schema change, no natural expand/contract boundary). Per the Implementation Plan template's own guidance, a standalone document isn't strictly required for a single-PR sprint -- created anyway at the reviewer's explicit request, for the same traceability this initiative's other artifacts already have. **This document is planning only -- no application code has been written.**

## PR breakdown

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|
| 1 | Notification/queue links resolve by `reorderRequestId` | `useReorderRequestForPart(partId, requestId)`'s exact-document resolution + `partId` validation + fail-safe `not_found`/`mismatch` states; `PartDetail.jsx`'s empty-state rendering on error; `NotificationPanel.jsx`'s and `PartsList.jsx`'s link updates (`?requestId=`) -- plus the verification infrastructure listed below, required for this PR to be considered verified | None | **Merged, deployed, and fully verified** -- PR #148, merge commit `f9e71789d36d52df2aef3bd90d5336a886eb6c7b`. See "Tracking" below. |

No sub-PR breakdown -- none of the files below can safely land independently of the others: shipping the hook change alone with no caller passing `requestId` would be a no-op; shipping the link changes alone without the hook's exact-resolution path would just append an inert, unused query parameter; the Playwright command can't assert against behavior that doesn't exist yet.

**Complete expected-file scope, seven files, two categories** (corrected -- the Specification's own Scope section only enumerated the first four; this Plan's own required verification work touches three more, which must be named here too):

*Application behavior (4 files, the Specification's scope):*
- `field-ops-app-vite/src/hooks/useReorderRequests.js`
- `field-ops-app-vite/src/modules/inventory/PartDetail.jsx`
- `field-ops-app-vite/src/shared/ui/NotificationPanel.jsx`
- `field-ops-app-vite/src/modules/inventory/PartsList.jsx`

*Verification infrastructure, not application behavior (2 required, 1 optional):*
- `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/seed.mjs` -- **required**, new multiple-requests-per-part fixture function, needed for the primary Playwright test below to have something to click through.
- `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/driver.mjs` -- **required**, new `verify-notification-identity` command, this PR's primary implementation test (see "Verification strategy").
- `functions/test/notificationIdentityResolution.test.js` -- **optional**, not a gate. Supporting, non-primary Firestore-semantics coverage only, per the "Verification strategy" section's own framing (it doesn't execute the real hook/router code and doesn't prove the client implementation). Whether to include it is left to the implementer's judgment during the PR itself; its absence does not block this PR from being considered complete, and its presence does not substitute for the Playwright command passing.

## Sequencing notes

Within the single PR, the hook change (`useReorderRequestForPart`) and `PartDetail.jsx`'s consumption of its new `error` field should be written before or alongside the link changes, so the feature is testable end-to-end in one commit rather than landing an unused parameter first. This is an internal ordering note for the PR's own commits, not a multi-PR dependency.

## External dependencies

**Upstream: none.** No Rules change (confirmed in the Specification's "Firestore Rules impact" section -- the existing unconditional read rule already permits a single-document `get`/`onSnapshot` by ID), no new Firestore index, no other in-flight work this PR itself depends on.

**Downstream: PR 6 (Cancel/Void UI) is a sequencing prerequisite, not merely separate scope.** This sprint's PR does not implement any of PR 6's own scope, and PR 6 does not implement any of this sprint's scope -- the two touch different files with no code overlap. But PR 6 is a downstream consumer of correct navigation identity: its `ReorderRequestCancelled`/`ReorderRequestVoided` read-only terminal-state cards render on `PartDetail`, the exact page a misrouted notification click currently lands a user on unexpectedly. Shipping PR 6 before this fix is verified would let that exact defect surface through PR 6's own new UI, immediately. **Therefore: PR 6 must not begin until this sprint's PR is merged, deployed to the frontend, and verified against the multiple-requests-per-part scenario** -- see "Tracking" below for the exact verification gate that must be checked off first. Issue #140 (unrelated topic) has no sequencing relationship in either direction, confirmed in the Assessment.

## Verification strategy

Resolves the Specification's own undecided point ("existing hook-testing conventions, or a lightweight ... script if no hook test harness exists yet"). Corrected per Implementation Plan review round 2: **the primary implementation test is repeatable browser automation against the real, built application** -- not a Node script that reimplements Firestore reads independently of the shipped code. A script that reproduces the same comparisons without importing or executing `useReorderRequestForPart()`, `useSearchParams()`, or the actual `Link to=` templates could pass even if the real feature were broken; it proves nothing about the implementation itself.

**Primary test -- a new named command added to the existing `run-field-ops-app-vite` Playwright skill's driver**, this repository's established, already-committed browser-driving convention (`field-ops-app-vite/.claude/skills/run-field-ops-app-vite/driver.mjs`, extended with a new command in the same style as its existing `login`/`inventory`/`needs-planning`/`submit-manual-qty`/`submit-ready` commands -- not a one-off scratch script, a permanent, repeatable, named addition):

- **`seed.mjs`** gains a new fixture function seeding the multiple-requests-per-part scenario across every status the Notification Panel and `PartsList.jsx` queues surface: for each of `PENDING_REVIEW`, `READY_FOR_PARTS_MANAGER`, `ASSIGNED_TO_PARTS_ASSOCIATE`, and `PURCHASING_IN_PROGRESS`, seed one **active** `reorder_requests` document for a dedicated test part (a new part id, not `TST-1003` -- already used by the existing legacy-shape fixture) alongside one **terminal** (`CANCELLED`) document for the *same* part with a deliberately **later** `createdAt` -- the exact defect scenario, reproduced for every notification/queue type that shares this hook, not just one.
- **`driver.mjs`** gains a new command, e.g. `verify-notification-identity <accountKey> [outPng]`, that: logs in; opens the Notification Panel and clicks each of its four sections' items in turn, asserting via `page.url()` that the resulting URL's `requestId` query param equals the seeded *active* document's own id (not the terminal one) and that the rendered page content corresponds to that specific request; navigates to `PartsList.jsx` and clicks each of its three queue links, asserting the same; performs a hard **page reload** on one resulting `?requestId=`-bearing URL and re-asserts the same request still renders (proving persistence across a refresh, the specific reason Option A was chosen over router-state-only Option C); navigates directly to `/inventory/:partId` with no query string and asserts the page renders (today's unchanged most-recent-by-`createdAt` fallback, still resolving to the terminal document as it does today -- a regression check, not a new assertion); navigates to a hand-crafted URL with a syntactically valid but non-existent `requestId` and asserts the distinct not-found empty state renders; navigates to a hand-crafted URL where `requestId` resolves to a document for a *different* `partId` and asserts the distinct mismatch empty state renders; and confirms the catalog-row link (`PartsList.jsx:381`) still points at a plain `/inventory/${part.sku}` URL with no `requestId` appended.
- This single command, run via `node .claude/skills/run-field-ops-app-vite/driver.mjs verify-notification-identity <accountKey>` against the local emulator + dev server (per `SKILL.md`'s standard three-process startup sequence), is what "this PR's implementation is verified" means for this sprint -- it exercises the actual shipped code (the real hook, the real router wiring, the real rendered links), not a parallel reimplementation of its logic.

**Optional, non-primary coverage -- new file `functions/test/notificationIdentityResolution.test.js`**, same zero-new-dependency convention as the three existing `functions/test/*.test.js` scripts (`firebase-admin`, raw Firestore reads, run against a local emulator). This would exercise the underlying Firestore-level semantics (get-by-id, `partId` agreement, the `where("partId","==",...)` sort-and-take-first fallback) in isolation, as a fast, no-browser-needed sanity check during development. **It is explicitly not proof the client feature works** -- confirmed by direct inspection that no frontend hook-testing harness exists in this repository (`field-ops-app-vite/package.json` has no `vitest`/`jest`/`@testing-library/react` dependency; zero test files under `field-ops-app-vite/src`) -- and it does not substitute for the Playwright command above. **This file is optional, not a gate**: including it is left to the implementer's judgment during the PR itself; this PR is not blocked on writing it, and its presence (if written) does not reduce the Playwright command's own requirement below.

**Frontend deployment verification -- read-only, no production data written.** After merge (auto-deploy, no Rules involved, per `docs/Deployment.md`), confirm via `gh run list --commit <merge-sha>` that both `Vite Build Check` and `Deploy Field Ops (Vite) to GitHub Pages` completed `success` at the merge commit -- the same method used throughout this session for every prior frontend-only PR (e.g. `docs/DECISIONS.md` entry #18).

Separately, perform a **read-only live smoke check that must actually exercise the deployed identity path -- not a vacuous pass if no active notification happens to exist at check time**:
- If an active Reorder Request notification or queue item exists in production at check time, click it and confirm it lands on the exact request that produced it (the same assertion the Playwright command makes, performed once, by hand, against the live site).
- **If none exists** (a real possibility -- this platform's live notification state is whatever Inventory/Parts Managers happen to have pending at the moment), this check is **not skipped**: read (via the Firebase Console, no write) at least one existing production `reorder_requests` document's own `id` and `partId`, construct the exact URL `.../inventory/<that partId>?requestId=<that id>` by hand, visit it, and confirm it resolves to that exact document -- proving the deployed `requestId`-aware resolution path actually works in production, using only data that already exists, with no new document created or modified.
- Either way, this check must end with a positive confirmation that the deployed `requestId` query-parameter path was actually exercised and resolved correctly -- "no active notification existed" is not, by itself, an acceptable outcome for this gate.

**The full seeded multiple-requests-per-part scenario is verified against the emulator/local dev server only, via the Playwright command above -- it is not re-run against production.** Creating or modifying production `reorder_requests` documents to reproduce that scenario live is **not authorized by this Plan** and is explicitly out of scope -- it would require its own, separate Production Data Authorization, not implied by any gate in this initiative. **PR 6 may not begin until all of: this PR is merged; the `verify-notification-identity` Playwright command has passed against the emulator/local build; the deployment check above has passed; and the read-only production smoke check above has passed** -- not a live re-run of the seeded scenario in production.

## Tracking

Distinguishes merge status from deployment status, per this project's standing "merged ≠ deployed" discipline -- though this PR is frontend-only and auto-deploys at merge (no separate deployment step or Owner Deployment Authorization applies, since there is no Rules change).

| PR | Merge status | Deployment status | Verification status |
|---|---|---|---|
| 1 -- Notification/queue links resolve by `reorderRequestId` | **Merged** (squash, branch deleted) -- PR #148, merge commit `f9e71789d36d52df2aef3bd90d5336a886eb6c7b` | **Deployed** -- `Vite Build Check` (run `29183235766`) and `Deploy Field Ops (Vite) to GitHub Pages` (run `29183235761`), both `completed`/`success` against the merge commit | **Fully verified, all three gates passed:** (1) `verify-notification-identity` Playwright command, 26/26 assertions, emulator/local build. (2) Frontend deployment check, both workflows `success` as above. (3) Read-only production smoke check performed at `https://taylorservice-spec.github.io/Taylor_Parts/field-ops/inventory/TST-1015?requestId=1J53DsEEkmLt6J1fsIcd` -- an existing production `reorder_requests` document (`partId` `TST-1015`, document id `1J53DsEEkmLt6J1fsIcd`) resolved correctly, its exact fields rendered, no `not_found`/`mismatch` fail-safe message appeared, no production data was created, modified, or deleted. **PR 6 (Cancel/Void UI) is now unblocked by this Plan's own gate** -- see `docs/DECISIONS.md` entry #33 for full evidence. |

Update this table as the PR merges and deploys. Given this is a single-PR sprint, this table (not a separate `docs/SPRINT_STATUS.md` link) is sufficient to track "what's left" until it completes.
