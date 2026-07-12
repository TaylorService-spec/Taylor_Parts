---
artifact_type: implementation-plan
gate: Implementation Plan
status: Approved
date: 2026-07-12
owner: Claude Code
related_adrs: []
depends_on: [docs/specifications/inventory-operational-queue.md]
implements: [docs/specifications/inventory-operational-queue.md]
supersedes: []
superseded_by: []
related_pr: 160
target_release: Post-Release 2.1 (Inventory -> Procurement chain)
---

# Implementation Plan: Inventory Operational Queue -- Manager Oversight, Complete-Catalog Browsing, History Discovery

**Sprint Specification:** `docs/specifications/inventory-operational-queue.md` -- **Approved by ChatGPT, 2026-07-12**, after two REQUEST CHANGES rounds (reviewed head `7c61adc` -> corrections -> reviewed head `43bccac` -> corrections -> **APPROVED at head `fc4eaf318ff56540352b359ffee4944739a0225f`**, merged to `main` at commit `c007c040868fd872f1c69c461e87dffcefd1bf8b`). This Implementation Plan translates that Specification's six-stage design into a concrete PR sequence. **No PR named below is implemented, merged, or run against production by this document itself** -- each requires its own review appropriate to its content and its own Owner Merge Authorization before merge; the Backfill, its tracking PR, and C0's index deployment each additionally require their own separate authorization beyond a merge -- see "Authorization gates" below for the complete, non-overlapping list.

**This is Round 2 of this Plan** -- Round 1 mischaracterized A0 as a frontend change that "auto-deploys" (it is an Admin-SDK command-line script, documentation, and tests; nothing in it deploys to anything), understated PR B's independence (stated as if only A0/C0 could begin, when PR B has no blocking dependency either), left several distinct authorization types collapsed into looser "deployed"/"authorized" language, used an unscoped `firebase firestore:indexes --pretty` command, and left the `docs/DECISIONS.md` conflict's resolution implicitly framed as something an Owner "authorizes" rather than external-state coordination. All corrected below.

## Eligible to start once this Plan is merged and the Owner separately authorizes work

**A0, PR B, and C0 -- three independent starting points, not two.** None of the three has a blocking dependency on anything else in this sequence:

- **A0** may begin -- it depends on nothing.
- **PR B** may begin -- it depends on nothing (no shared file, collection, or ordering constraint with either chain).
- **C0** may begin -- it depends on nothing (a single-file index addition, independent of A0/Backfill/PR A entirely).
- **Backfill** remains gated on A0's merge, plus its own separate Owner Production Data Authorization -- cannot start before either.
- **PR A has three distinct states, not one gate** -- see "Sequencing notes" and "Authorization gates" below for the precise boundary between them:
  1. **Blocked from opening at all** until A0 has merged and the authorized Backfill has passed zero-drift verification.
  2. **Draft-review allowed** -- implemented, opened as a Draft PR, tested, and reviewed -- from the moment the Backfill's zero-drift evidence is posted durably to A0's merged PR or Issue #154. The unrelated `docs/DECISIONS.md` conflict does not block this state.
  3. **Merge allowed** only once the separate, docs-only Backfill tracking PR has also merged, the zero-drift evidence is formally recorded there, PR A's own checks/reviews pass, and the Owner separately grants PR A its own Merge Authorization.
- **PR C** remains gated on C0's merge, its own separate Owner Deployment Authorization, and the resulting index confirmed `[READY]` in production.

## PR breakdown

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|
| A0 | Security-role mirror rollout | `provisionEmployeeAccess.js` writes `employees.securityRole` alongside `users/{uid}.role`; `docs/BusinessEntityModel.md` Section 8a documents the new field; a new Admin-SDK drift-detection/repair script. No UI change, no application deployment of any kind. | None | Not started |
| -- | Backfill (operational, not a PR) | Owner-run `--repair` pass of A0's script, executed from the exact reviewed `main` commit, against every pre-existing `employees` document, under a separate Owner Production Data Authorization. Verified by a zero-drift read-only re-run. | A0 (merged) | Not started |
| -- | Backfill evidence -- durable record (not this Plan's PR sequence) | Posted immediately after verification to A0's merged PR (comment) or Issue #154, then formalized in a separate `docs/DECISIONS.md` tracking PR once that file's current, unrelated working-tree conflict is resolved. | Backfill (verified) | Not started |
| A | All Assigned Work oversight + assignment-eligibility filter | New `useReorderRequestsByStatuses()` hook (explicit error state); read-only oversight view; picker excludes `technician`-role/missing-role candidates using `employees.securityRole`, with an admin-visible configuration warning for the missing/invalid case | **Open as Draft:** A0 merged + Backfill zero-drift verified (evidence posted durably). **Merge:** the above, plus the Backfill tracking PR merged + evidence formally recorded. | Not started |
| B | Inventory Health / Parts Catalog separation | Inventory Health reduced to Critical & High + Needs Planning only (no `ALL` tab); Parts Catalog enriched per-row with health/risk data or "No ledger activity"; counts on both filter bars; differentiated `InventoryHealthPanel.jsx` empty states | None | Not started |
| C0 | History composite index | Exactly one `firestore.indexes.json` entry (`reorder_requests`: `status` ASC, `createdAt` DESC). No application code. | None | Not started |
| C | Reorder Request History | New paginated/ordered hook + `useReorderRequestById()`; bounded, cursor-paginated History view; four explicit states (loading/error/empty/end-of-history) | C0 (merged, index deployed, confirmed `[READY]` in production) | Not started |

## Sequencing notes

**Chain 1 -- A0 -> Backfill -> PR A's three states.** A0 changes a command-line script (`functions/scripts/provisionEmployeeAccess.js`), `docs/BusinessEntityModel.md`, and a test file -- **there is no application to deploy and nothing auto-deploys.** Merging A0 is the entirety of its own delivery; the script simply becomes runnable from `main` at that point. The Backfill is a separate, later, Owner-run operational action: the operator runs the merged script's `--repair` mode from the exact reviewed commit, under its own Owner Production Data Authorization. **Before that authorized production run**, the operator (or whoever prepares the run for them) verifies: a clean working tree, `git rev-parse HEAD` equal to `git rev-parse origin/main` (no local drift from what was reviewed), the script's project target is `taylor-parts` (not the emulator), and the script's own production-confirmation guard is intact and will actually prompt/require explicit confirmation before writing.

**PR A's exact sequencing, one precise boundary, not a single gate:**
1. **Before A0 merges and the authorized Backfill passes zero-drift verification: PR A must not be opened.**
2. **After the Backfill passes zero-drift verification and its exact evidence is posted durably** -- immediately, as a comment on A0's merged PR or on Issue #154, no external blocker -- **PR A may be implemented, opened as a Draft PR, tested, and reviewed.** The unrelated `docs/DECISIONS.md` conflict does not block this work.
3. **PR A must not leave Draft, receive a final merge disposition, or merge until:** the separate, docs-only Backfill tracking PR (formally recording the zero-drift evidence in `docs/DECISIONS.md`) is merged; that evidence is formally recorded; PR A's own checks and reviews pass; and the Owner separately grants PR A its own Merge Authorization.

**Chain 2 -- C0 -> index deployment -> PR C.** Independent of Chain 1 entirely. C0 is a single-file, index-only PR (not a Rules change) -- its own Owner Merge Authorization, then the deployment itself requires a **separate** Owner Deployment Authorization (`firebase deploy --only firestore:indexes --project taylor-parts`, scoped to indexes only, matching this project's established `employees`-index deployment precedent). **PR C must not merge until `firebase firestore:indexes --project taylor-parts --pretty` confirms the exact new `reorder_requests (status ASC, createdAt DESC)` index -- not merely some index, and not merely that the deploy command exited 0 -- reads `[READY]`.**

**PR B is fully independent of both chains** -- no shared file, no shared collection, no ordering constraint with A0/Backfill/PR A or C0/PR C. It may be implemented and merged in any order relative to the other two chains, including first.

**Within PR A:** the hook (`useReorderRequestsByStatuses()`) and the oversight-view UI should land in the same commit sequence as the picker's eligibility filter, since the Specification requires both pieces of PR A to ship together, gated on the same backfill-verified precondition -- there is no safe intermediate state where only one half of PR A is live.

**Within PR C:** the paginated/ordered hook, `useReorderRequestById()`, and the History UI are one cohesive concern (the Specification's own PR C scope) -- no further sub-splitting recommended, since none of the three pieces is independently useful without the others.

## Authorization gates

Nine distinct gates across this initiative -- **a merge authorization for one item never covers a production-data operation, an index deployment, or a later PR's own merge.** Listed in the order they'll actually occur, not grouped by type, so this reads as a checklist against the sequence above:

1. **A0 -- Owner Merge Authorization.** Covers merging A0's script/docs/test changes to `main` only. Does not authorize running the script against production.
2. **Backfill -- Owner Production Data Authorization.** A separate, later authorization, scoped specifically to running A0's already-merged script's `--repair` mode against production `employees`/`users` data. Cannot be satisfied by A0's own merge authorization.
3. **Backfill evidence tracking PR -- Owner Merge Authorization.** Covers merging the docs-only `docs/DECISIONS.md` entry recording the Backfill's result. Requires the file's current unrelated conflict to be resolved first (see below) -- that resolution is not itself an authorization this list grants or requires from the Owner; it's external-state coordination this Plan has no control over.
4. **PR A -- Owner Merge Authorization.** Covers merging PR A's code only. **Distinct from PR A's own opening/Draft-review, which only requires gates 1-2 (A0 merged, Backfill zero-drift verified and its evidence posted durably) -- opening PR A as a Draft and reviewing it does not require gate 3.** Gate 4 itself -- PR A's actual merge -- requires gates 1, 2, **and** 3 (the Backfill tracking PR merged, evidence formally recorded) all complete, in addition to PR A's own checks/reviews passing.
5. **PR B -- Owner Merge Authorization.** Independent of every other gate in this list.
6. **C0 -- Owner Merge Authorization.** Covers merging the `firestore.indexes.json` change only. Does not authorize deploying it.
7. **C0 -- Owner Deployment Authorization (indexes).** A separate, later authorization, scoped specifically to running `firebase deploy --only firestore:indexes --project taylor-parts`. Cannot be satisfied by C0's own merge authorization.
8. **PR C -- Owner Merge Authorization.** Covers merging PR C's code only, and is itself gated on gates 6-7 above plus the index's confirmed `[READY]` state.
9. **Frontend deployment verification for A/B/C, after each one's own merge.** Not an authorization -- each of PR A/B/C auto-deploys on merge (frontend-only, same as every prior frontend PR in this project), so this is a read-only confirmation step (the GitHub Actions build/deploy workflows completed `success`, the production URL is reachable) rather than something requiring the Owner's prior sign-off. Recorded in the Tracking table below, kept separate from "merged."

**On the `docs/DECISIONS.md` conflict, stated precisely:** resolving it is neither this Plan's job nor an "Owner Production Data Authorization"-shaped gate -- it is external-state coordination (identifying and clearing whatever uncommitted, unrelated working-tree change currently sits in that file) that has nothing to do with this initiative's own authority chain. It blocks gate 3 specifically and nothing else in this list.

## External dependencies

- **PR #155** (Architecture-Approved Assessment) and **PR #157** (Approved Specification) -- both merged, both satisfied. This Plan implements PR #157's design directly; no further architecture decision is pending.
- **No dependency on the Cancel/Void initiative** (PRs 1-6, all merged/deployed) -- confirmed no shared file requires a change here, per the Specification's own "Explicitly out of scope."
- **No dependency on Issue #100** (technician nav-access gap) or **Issue #152** (Inventory Action Log redesign) -- both remain explicitly separate, per the Specification.
- **`docs/DECISIONS.md`'s current, unrelated working-tree conflict** blocks gate 3 (the Backfill evidence tracking PR) only -- and therefore blocks PR A's *merge* specifically, not PR A's opening. It does not block A0, the Backfill operation itself (evidence can be posted to A0's PR/Issue #154 immediately, ungated), PR A being implemented/opened as Draft/reviewed, PR B, C0, or PR C. This Plan does not attempt to resolve it.

## Deployment and rollback boundaries

Restated from the Specification's own "Rollback strategy," corrected here for A0's actual (non-)deployment model and organized by what's safe to revert at each point -- consult before authorizing any rollback at any stage of this initiative, present or future.

**Before A0 is merged.** No live impact. Normal revert, no ordering constraint.

**After A0 is merged, before the Backfill runs.** The script exists on `main` and is runnable, but has not been run against production -- `employees.securityRole` exists on newly-provisioned Employees only (any provisioning that happens to run after A0's merge picks up the new field automatically), while every pre-existing document still lacks it. Reverting A0's merge at this point is a normal code revert -- no production data was ever touched by A0 itself.

**After the Backfill runs, before PR A merges.** `securityRole` now exists on every Employee document, verified zero-drift. **The Backfill itself is never rolled back** -- it only ever adds/corrects a read-only mirror field; no other Employee data is touched, and there is no "un-backfill" operation that would make sense. A0's script code may still be reverted independently at this point without affecting the already-backfilled data; doing so would only stop *future* provisioning from keeping the mirror current, which would itself need to be caught by a subsequent drift-audit re-run (per the Specification's re-verification trigger).

**After PR A merges.** Reverting PR A's oversight view and/or its eligibility filter is a normal, independent frontend revert -- `securityRole` data on `employees` is unaffected either way. **Never revert A0's script/writer code while PR A's eligibility filter remains live in production** -- doing so would let newly-provisioned employees silently accumulate without a `securityRole`, reopening exactly the gap A0/Backfill closed, this time for new hires rather than pre-existing employees.

**Before C0 is merged/deployed.** No live impact -- an undeployed index has no production presence. Normal revert.

**After C0's index reaches `[READY]`, before PR C merges.** The index exists in production but nothing queries it yet. Fully safe to leave in place indefinitely even if PR C is delayed or never ships -- an unused index is inert, not a liability requiring its own rollback urgency.

**After PR C merges.** Reverting PR C's frontend code is independent of C0's index -- **the index is never automatically removed by reverting the code that queried it.** Removing the index itself (if ever desired) requires its own, separate, explicit Owner Deployment Authorization, exactly mirroring how it was added.

**PR B, at any point.** No schema, Rules, or index component -- reverting is a normal, independent frontend change with no ordering constraint relative to any other PR in this Plan.

## Tracking

**Kept as two tables, deliberately** -- A0/Backfill/Backfill-evidence/C0 are infrastructure/data items with no "frontend live" concept at all, while A/B/C are ordinary frontend PRs with a real deploy-and-verify step. Forcing both shapes into one table's column set was itself part of what made "merged," "deployed," and "verified" easy to blur together in earlier drafts.

**Prerequisites and infrastructure:**

| Item | Merged | Script / Index verified | Additional evidence |
|---|---|---|---|
| A0 | Not started | N/A -- no deployment exists for an Admin-SDK script; correctness is verified by A0's own emulator-fixture tests, run as part of A0's own review, not a separate deployment step | -- |
| Backfill | N/A (operational, not a PR) | Not authorized / not executed | Requires Owner Production Data Authorization (gate 2); verified via a zero-drift read-only re-run of A0's script; durable evidence posted to A0's merged PR or Issue #154 immediately upon verification |
| Backfill evidence -- `docs/DECISIONS.md` tracking PR | Not started | N/A (docs-only) | Blocked on `docs/DECISIONS.md`'s current unrelated working-tree conflict being resolved (external-state coordination, not an Owner authorization -- see "Authorization gates") |
| C0 | Not started | Index not deployed | Requires separate Owner Deployment Authorization (gate 7); verified via `firebase firestore:indexes --project taylor-parts --pretty`, confirming the **exact** `reorder_requests (status ASC, createdAt DESC)` index -- not merely "an index" -- reads `[READY]` |

**Application PRs:**

| PR | Merged | GitHub Pages workflow | Live URL reachable | Browser verification |
|---|---|---|---|---|
| A | Not started -- **may reach Draft/reviewed before "Merged" here changes**, per its three-state sequencing above; "Merged" in this column specifically means gate 4 (PR A's own Merge Authorization) has been granted, not merely that a Draft exists | Not run | Not confirmed | Not run |
| B | Not started | Not run | Not confirmed | Not run |
| C | Not started | Not run | Not confirmed | Not run |

Update both tables as each item merges, deploys, and is verified -- this document is the running source of truth for "what's left in this initiative" until it completes. Link from `docs/SPRINT_STATUS.md` once A0, PR B, or C0 (whichever opens first) is opened.

## Testing strategy

Restated from the Specification's own "Testing strategy" (not re-derived here) -- each application PR's own implementation is responsible for extending the `run-field-ops-app-vite` Playwright skill's `driver.mjs` with a named command, same established pattern as PR #148/#151:

- **A0:** no browser-testable surface, no deployment to verify. Verification is the drift-detection script's own read-only report against emulator fixtures -- three named cases (correct, missing, mismatched `securityRole`), not one generic pass/fail.
- **PR A:** cross-user oversight visibility, personal-queue non-broadening, accurate count, a simulated query-failure error state, and the picker's exclusion-plus-warning behavior for a missing/invalid `securityRole` fixture. No test asserts detecting a valid-but-drifted mirror client-side -- that's exclusively A0's script's own coverage.
- **PR B:** exactly two Inventory Health tabs, accurate counts on both surfaces, Parts Catalog enrichment for both a ledger-active and a ledger-inactive fixture part.
- **C0:** no browser-testable surface -- verification is the `firebase firestore:indexes --project taylor-parts --pretty` poll itself, confirming the exact new index, recorded in C0's own PR body/comment (immediately available) and later in `docs/DECISIONS.md` once that file's conflict clears.
- **PR C:** deterministic ordering, bounded initial page, cursor-based "Load More," exact-id lookup independent of loaded page, and all four explicit states (loading/error/genuinely-empty/end-of-history) as named, separate assertions.
- **Accessibility spot-check** (not a full audit, per the Specification's own scope limit): every new/changed filter control reachable via Playwright's `getByRole(..., { name })` locators, the same mechanism this project's driver commands already use.

## Acceptance criteria

Restated from the Specification's own "Acceptance criteria" section verbatim in intent -- not duplicated item-by-item here to avoid the two documents drifting out of sync. **This Plan's own additional requirement:** each PR's Final Review must independently re-confirm the specific acceptance-criteria subset that applies to it (A0's, PR A's, PR B's, C0's, PR C's) against `docs/specifications/inventory-operational-queue.md`'s "Acceptance criteria" section directly, not against this Plan's summary of it.

## Risks

Restated from the Specification's own "Risks" section, with this Plan's own sequencing risk corrected and expanded:

- **The Backfill/evidence chain is this initiative's single largest schedule risk**, not a technical one -- before PR A may *merge*, the chain requires four separate Owner authorizations that cannot be combined or substituted for one another: A0's own merge (gate 1), the Backfill's Production Data Authorization (gate 2), the Backfill tracking PR's own merge (gate 3), and PR A's own Merge Authorization (gate 4) -- plus a third party's (the concurrent session's) unrelated `docs/DECISIONS.md` conflict resolving before gate 3's tracking PR can even open. **Resolving that file conflict is external-state coordination, not a fifth authorization** -- restated here since it's easy to conflate with the four real authorizations above. **Mitigated in this round, precisely:** gate 3 and the `docs/DECISIONS.md` conflict only block PR A's *merge*, not its opening -- PR A may be implemented, opened as Draft, and fully reviewed as soon as gates 1-2 clear (Backfill zero-drift verified, evidence posted durably to A0's PR/Issue #154), letting implementation and review proceed in parallel with gate 3 and the file conflict clearing, rather than waiting on all four before any work on PR A can start.
- **C0/index-deployment chain is comparatively low-risk** -- a single, well-precedented deployment step (two prior `employees` composite indexes already went through this exact procedure successfully), with two distinct authorizations (gates 6 and 7) that are still worth tracking separately even though the risk of either being delayed is low.
- **A0's actual lack of a deployment step is itself worth naming as a (resolved) risk of this Plan, not the initiative.** Round 1 treated A0 as if it had a "frontend-live" state to verify, which would have led a future reviewer to look for a deployment that doesn't exist. Corrected here; no residual risk once this Plan's own language is accurate.
- Every other risk (client's permanent inability to re-verify `securityRole` drift; `InventoryHealthPanel.jsx`'s shared-with-`Operations.jsx` exposure; Parts Catalog/Inventory Health's shared `healthEntries` read) is unchanged from the Specification -- not re-litigated here.

## Approval

**Approved by ChatGPT on 2026-07-12**, citing reviewed head `a84746129b8b5200705e9ac7fe3314e435596c6e`, after two REQUEST CHANGES rounds (Round 1: A0 mischaracterized as a frontend change that auto-deploys, PR B's independence understated, authorization/verification language too loose, unscoped index command; Round 2: an internal contradiction between "PR A cannot start implementation-review until all gates clear" and "PR A review can proceed on durable evidence while the tracking PR catches up" -- both corrected, the latter resolved into PR A's three explicit states: blocked from opening, Draft-review allowed, merge allowed). No findings remain open. Owner Merge Authorization for this document's own merge is still separate and not yet granted -- per the standing "architecture approval is not merge authorization" rule, and this approval does not itself authorize opening A0, PR B, or C0. No code, Rules, deployment, or production-data change has been made while producing this document -- planning only.
