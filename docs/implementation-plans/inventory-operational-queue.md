---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
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

**Sprint Specification:** `docs/specifications/inventory-operational-queue.md` -- **Approved by ChatGPT, 2026-07-12**, after two REQUEST CHANGES rounds (reviewed head `7c61adc` -> corrections -> reviewed head `43bccac` -> corrections -> **APPROVED at head `fc4eaf318ff56540352b359ffee4944739a0225f`**, merged to `main` at commit `c007c040868fd872f1c69c461e87dffcefd1bf8b`). This Implementation Plan translates that Specification's six-stage design into a concrete PR sequence. **No PR named below is implemented, merged, or run against production by this document itself** -- each requires its own review appropriate to its content (a Rules-focused or index-focused Final Review where relevant, a ChatGPT Final Review confirming it matches this Plan, and Owner Merge Authorization before merge), and A0's backfill, the backfill's own tracking PR, and C0's index deployment each additionally require their own separate Owner Production Data Authorization or Owner Deployment Authorization, per the Specification's own gating.

**Six PRs plus one non-PR operational step, in the exact sequence the Specification requires** -- this is not a "pick any order" breakdown; A0 -> Backfill -> PR A is a hard chain, and C0 -> index deployment -> PR C is a second, independent hard chain. PR B has no dependency on either chain.

## PR breakdown

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|
| A0 | Security-role mirror rollout | `provisionEmployeeAccess.js` writes `employees.securityRole` alongside `users/{uid}.role`; `docs/BusinessEntityModel.md` Section 8a documents the new field; a new Admin-SDK drift-detection/repair script. No UI change. | None | Not started |
| -- | Backfill (operational, not a PR) | Owner-run `--repair` pass of A0's script against every pre-existing `employees` document, under a separate Owner Production Data Authorization. Verified by a zero-drift read-only re-run. | A0 (merged and deployed -- frontend-only writer change, auto-deploys) | Not started |
| -- | Backfill result tracking PR (docs-only, not this Plan's PR sequence) | One new `docs/DECISIONS.md` entry recording the backfill's verified-zero-drift result, opened fresh off `main` once the file's current, unrelated working-tree conflict is resolved. | Backfill (verified) | Not started |
| A | All Assigned Work oversight + assignment-eligibility filter | New `useReorderRequestsByStatuses()` hook (explicit error state); read-only oversight view; picker excludes `technician`-role/missing-role candidates using `employees.securityRole`, with an admin-visible configuration warning for the missing/invalid case | A0 + Backfill (verified and recorded) | Not started |
| B | Inventory Health / Parts Catalog separation | Inventory Health reduced to Critical & High + Needs Planning only (no `ALL` tab); Parts Catalog enriched per-row with health/risk data or "No ledger activity"; counts on both filter bars; differentiated `InventoryHealthPanel.jsx` empty states | None | Not started |
| C0 | History composite index | Exactly one `firestore.indexes.json` entry (`reorder_requests`: `status`, `createdAt`). No application code. | None | Not started |
| C | Reorder Request History | New paginated/ordered hook + `useReorderRequestById()`; bounded, cursor-paginated History view; four explicit states (loading/error/empty/end-of-history) | C0 (merged, deployed, index confirmed `[READY]` in production) | Not started |

## Sequencing notes

**Chain 1 -- A0 -> Backfill -> Backfill tracking PR -> PR A.** A0's writer change is safe to merge and auto-deploy on its own (it only adds a field going forward; no existing behavior depends on it yet). The backfill itself is an Owner-run operational action, not a PR, and must be verified zero-drift before PR A's eligibility filter can be considered safe to ship -- per the Specification, **PR A must not merge until this entire chain, including the tracking PR that records it, has landed.** The tracking PR is docs-only and has no dependency on A0/PR A's own code state, but per the Specification's "Recording the backfill result" section, it cannot be opened until `docs/DECISIONS.md`'s current, unrelated working-tree conflict (present throughout this Specification's own review cycle, and still unresolved as of this Plan) is cleared -- **this Plan does not resolve that conflict and does not treat it as this initiative's problem to fix**, but flags it here as a real, external blocker on this specific chain's last step.

**Chain 2 -- C0 -> index deployment -> PR C.** Independent of Chain 1 entirely. C0 is a single-file, Rules-adjacent-but-not-Rules PR (an index, not a Rules change) -- it gets its own Owner Merge Authorization, then the deployment itself gets a **separate** Owner Deployment Authorization (`firebase deploy --only firestore:indexes --project taylor-parts`, scoped to indexes only, matching this project's established `employees`-index deployment precedent). **PR C must not merge until the index is polled and confirmed `[READY]`** -- not merely "the deploy command exited 0."

**PR B is fully independent of both chains** -- no shared file, no shared collection, no ordering constraint with A0/Backfill/PR A or C0/PR C. It may be implemented and merged in any order relative to the other two chains.

**Within PR A:** the hook (`useReorderRequestsByStatuses()`) and the oversight-view UI should land in the same commit sequence as the picker's eligibility filter, since the Specification requires both pieces of PR A to ship together, gated on the same backfill-verified precondition -- there is no safe intermediate state where only one half of PR A is live.

**Within PR C:** the paginated/ordered hook, `useReorderRequestById()`, and the History UI are one cohesive concern (the Specification's own PR C scope) -- no further sub-splitting recommended, since none of the three pieces is independently useful without the others.

## External dependencies

- **PR #155** (Architecture-Approved Assessment) and **PR #157** (Approved Specification) -- both merged, both satisfied. This Plan implements PR #157's design directly; no further architecture decision is pending.
- **No dependency on the Cancel/Void initiative** (PRs 1-6, all merged/deployed) -- confirmed no shared file requires a change here, per the Specification's own "Explicitly out of scope."
- **No dependency on Issue #100** (technician nav-access gap) or **Issue #152** (Inventory Action Log redesign) -- both remain explicitly separate, per the Specification.
- **`docs/DECISIONS.md`'s current, unrelated working-tree conflict** is an external blocker on Chain 1's final step (the backfill tracking PR) only -- it does not block A0, PR A's code itself, PR B, C0, or PR C. This Plan does not attempt to resolve it.

## Deployment and rollback boundaries

Restated from the Specification's own "Rollback strategy," organized here by what's safe to revert at each point in the sequence -- consult before authorizing any rollback at any stage of this initiative, present or future.

**Before A0 deploys.** No live impact. Normal revert, no ordering constraint.

**After A0 deployed, before the backfill runs.** `employees.securityRole` exists on newly-provisioned Employees only; every pre-existing document still lacks it. Reverting A0's writer change at this point is safe -- no data was migrated, nothing yet depends on the field being present.

**After the backfill runs, before PR A merges.** `securityRole` now exists on every Employee document, verified zero-drift. **The backfill itself is never rolled back** -- it only ever adds/corrects a read-only mirror field; no other Employee data is touched, and there is no "un-backfill" operation that would make sense. A0's writer code may still be reverted independently at this point without affecting the already-backfilled data; doing so would only stop *future* provisioning from keeping the mirror current, which would itself need to be caught by a subsequent drift-audit re-run (per the Specification's re-verification trigger).

**After PR A merges.** Reverting PR A's oversight view and/or its eligibility filter is a normal, independent frontend revert -- `securityRole` data on `employees` is unaffected either way. **Never revert A0's writer change while PR A's eligibility filter remains live** -- doing so would let newly-provisioned employees silently accumulate without a `securityRole`, reopening exactly the gap A0/Backfill closed, this time for new hires rather than pre-existing employees.

**Before C0 deploys.** No live impact -- an undeployed index has no production presence. Normal revert.

**After C0's index reaches `[READY]`, before PR C merges.** The index exists in production but nothing queries it yet. Fully safe to leave in place indefinitely even if PR C is delayed or never ships -- an unused index is inert, not a liability requiring its own rollback urgency.

**After PR C merges.** Reverting PR C's frontend code is independent of C0's index -- **the index is never automatically removed by reverting the code that queried it.** Removing the index itself (if ever desired) requires its own, separate, explicit Owner Deployment Authorization, exactly mirroring how it was added.

**PR B, at any point.** No schema, Rules, or index component -- reverting is a normal, independent frontend change with no ordering constraint relative to any other PR in this Plan.

## Tracking

Distinguishes merged, frontend live, and (for A0/C0) index/data-deployment-verified states -- "merged" is never treated as equivalent to "deployed" or "verified," per this project's standing "merged ≠ deployed" discipline (`docs/SPRINT_STATUS.md`'s "Discipline notes").

| PR | Merged | Frontend live | Backfill / Index deployed | Verified live | Additional verification |
|---|---|---|---|---|---|
| A0 | Not started | -- | N/A | -- | -- |
| Backfill | N/A (operational) | N/A | Not started | N/A | Requires separate Owner Production Data Authorization; verified by a zero-drift read-only script re-run |
| Backfill tracking PR | Not started | N/A (docs-only) | N/A | N/A | Blocked on `docs/DECISIONS.md`'s current unrelated working-tree conflict being resolved first |
| A | Not started | Not deployed | N/A | N/A | Blocked on A0 + Backfill (verified and recorded) |
| B | Not started | Not deployed | N/A | N/A | Independent -- no blocking dependency |
| C0 | Not started | N/A (index-only) | Not started | N/A | Requires separate Owner Deployment Authorization; verified via `firebase firestore:indexes --pretty` polled to `[READY]` |
| C | Not started | Not deployed | N/A | N/A | Blocked on C0 (index confirmed `[READY]` in production) |

Update this table as each item merges, deploys, and is verified -- this document is the running source of truth for "what's left in this initiative" until it completes. Link from `docs/SPRINT_STATUS.md` once A0 or C0 (whichever opens first) is opened.

## Testing strategy

Restated from the Specification's own "Testing strategy" (not re-derived here) -- each PR's own implementation is responsible for extending the `run-field-ops-app-vite` Playwright skill's `driver.mjs` with a named command, same established pattern as PR #148/#151:

- **A0:** no browser-testable surface. Verification is the drift-detection script's own read-only report against emulator fixtures -- three named cases (correct, missing, mismatched `securityRole`), not one generic pass/fail.
- **PR A:** cross-user oversight visibility, personal-queue non-broadening, accurate count, a simulated query-failure error state, and the picker's exclusion-plus-warning behavior for a missing/invalid `securityRole` fixture. No test asserts detecting a valid-but-drifted mirror client-side -- that's exclusively A0's script's own coverage.
- **PR B:** exactly two Inventory Health tabs, accurate counts on both surfaces, Parts Catalog enrichment for both a ledger-active and a ledger-inactive fixture part.
- **C0:** no browser-testable surface -- verification is the `[READY]` poll itself, recorded in `docs/DECISIONS.md` (once that file's conflict clears) or in C0's own PR body/comment in the interim, same pattern already used for prior index deployments.
- **PR C:** deterministic ordering, bounded initial page, cursor-based "Load More," exact-id lookup independent of loaded page, and all four explicit states (loading/error/genuinely-empty/end-of-history) as named, separate assertions.
- **Accessibility spot-check** (not a full audit, per the Specification's own scope limit): every new/changed filter control reachable via Playwright's `getByRole(..., { name })` locators, the same mechanism this project's driver commands already use.

## Acceptance criteria

Restated from the Specification's own "Acceptance criteria" section verbatim in intent -- not duplicated item-by-item here to avoid the two documents drifting out of sync. **This Plan's own additional requirement:** each PR's Final Review must independently re-confirm the specific acceptance-criteria subset that applies to it (A0's, PR A's, PR B's, C0's, PR C's) against `docs/specifications/inventory-operational-queue.md`'s "Acceptance criteria" section directly, not against this Plan's summary of it.

## Risks

Restated from the Specification's own "Risks" section, with this Plan's own sequencing risk added:

- **The backfill/tracking-PR chain is this initiative's single largest schedule risk**, not a technical one -- it depends on Owner availability for two separate authorizations (Production Data Authorization for the backfill, and whatever's needed to resolve `docs/DECISIONS.md`'s conflict before the tracking PR can open) plus a third party's (the concurrent session's) conflict resolving. PR A cannot start implementation-review until all of that clears -- worth surfacing early rather than discovering it mid-PR-A.
- **C0/index-deployment chain is comparatively low-risk** -- a single, well-precedented deployment step (two prior `employees` composite indexes already went through this exact procedure successfully).
- Every other risk (client's permanent inability to re-verify `securityRole` drift; `InventoryHealthPanel.jsx`'s shared-with-`Operations.jsx` exposure; Parts Catalog/Inventory Health's shared `healthEntries` read) is unchanged from the Specification -- not re-litigated here.

## Approval

**Not yet reviewed.** This Implementation Plan requires its own review (ChatGPT Final Review confirming it matches the approved Specification, plus Owner Merge Authorization for this document's own merge) before A0 or C0 -- the two PRs with no blocking dependency on anything else in this sequence -- may be opened. No code, Rules, deployment, or production-data change has been made while producing this document -- planning only.
