---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
date: 2026-07-12
owner: Claude Code
related_adrs: []
depends_on: [docs/specifications/customer-account-business-model.md, docs/assessments/customer-account-business-model.md, docs/architecture/enterprise-business-metrics-framework.md]
implements: [docs/specifications/customer-account-business-model.md]
supersedes: [docs/implementation-plans/customer-record-page-structured-address.md]
superseded_by: []
related_pr: null
related_issue: 158
target_release: Post-Release 2.1 (Inventory → Procurement chain)
---

# Implementation Plan: Customer/Account Business Model — Sectioned Account Page, Relationship Type, Financial Summary Surface, Service Activity

**Status: DRAFT.** Sequences the future work for `docs/specifications/customer-account-business-model.md` (itself Draft). Awaits ChatGPT Implementation Plan Final Review and separate Owner authorization.

**This plan authorizes nothing.** It defines a PR sequence and each PR's verification obligations and gates. It does not authorize application code, PR creation, Firestore Rules/schema changes, index creation or deployment, provider integration, migration, deployment, merge, or any production-data action. **Every PR below requires its own separate Owner authorization to begin, its own Owner Merge Authorization, and — where it deploys indexes — its own separate Owner Deployment Authorization.** Merged is never deployed; approved is never merged (`docs/ai/workflow.md`).

## PR breakdown

Ordered by dependency. Each is a separate PR (or, for G0, a GitHub-only governance step) with its own review and authorization; they are **not** authorized as a batch by this plan. G0 is not an implementation PR.

| Step | Title | Touches | Depends on |
|---|---|---|---|
| G0 (governance, GitHub-only) | Close PR #159 unmerged + update Issue #158 | GitHub only (no repo files) | Specification + this Implementation Plan merged |
| PR 1 | Service Activity composite indexes (index-only) | `firestore.indexes.json` | — |
| PR 2 | Sectioned Account page + `relationshipTypes` (Summary / Contacts / Locations / Notes) | `domain/constants.js`, `domain/accounts.js`, `modules/accounts/*`, `index.css`; selectively ports PR #159's reusable domain layer | — |
| PR 3 | Service Activity (summary counts + Account Activity timeline) | `modules/accounts/*`, a new Work Order-by-Account query/hook | PR 1 indexes `[READY]`; PR 2 page shell |
| PR 4 | Financial Summary surface (`unconfigured` state only) | `modules/accounts/*`, a provider-state surface component | PR 2 page shell |

**No step in this sequence changes `firestore.rules`.** The only schema change (`relationshipTypes`, PR 2) is additive and needs no rule change (Specification "Firestore Rules impact"). If any implementation step later appears to require a Rules change, that is a Tier 2 event under `docs/DelegationCharter.md` and must return through Architecture Review before proceeding — it must never be slipped into a UI PR.

## Governance step G0 — Close PR #159 unmerged + update Issue #158 (immediate, after Spec + Plan merge)

**Timing:** the moment this Implementation Plan and its Specification merge — **not** deferred until after the implementation PRs. It is a **GitHub-only governance step** (no repository files) requiring its **own separate Owner authorization**, independent of any implementation PR.

- **Close PR #159 unmerged.** Branch and history are **preserved** — no branch deletion unless the Owner separately requests it. A closed PR remains readable and linkable, so its head `b1f1d1eaf001a754f441c455af040f5ea0160e63` stays citable as the source for the selective port (below) even after the PR is closed.
- **Do not merge PR #159**, and do not merge or cherry-pick its branch — in whole or in part — as part of closing it.
- **Update Issue #158's** title/description to reflect the now-current scope ("Implementation Tracking (PR 1 & PR 2)" no longer describes it).
- Touches no repository files.

## PR 1 — Service Activity composite indexes (index-only)

- Adds exactly two composite indexes to `firestore.indexes.json`:
  1. `fieldops_wos(customerId ASC, createdAt DESC)` — Account Activity timeline.
  2. `fieldops_wos(customerId ASC, status ASC)` — summary-count aggregate queries.
- **No application code, no UI, no Rules change.** Index definition only.
- **Separate Owner Merge Authorization**, independent of any UI PR.
- **Separate Owner Deployment Authorization** to run `firebase deploy --only firestore:indexes --project taylor-parts` — merged is not deployed.
- **`[READY]` verification is a hard gate:** `firebase firestore:indexes --project taylor-parts --pretty` must show **each** index `[READY]` before PR 3 may merge. A successful deploy command alone is insufficient (PR #111's established discipline).

**Verification obligations:** confirm the two index entries are exactly as specified; after authorized deploy, capture the `[READY]` read for each index in this repo's decision record. No behavioral verification (there is no code in this PR).

## PR 2 — Sectioned Account page + `relationshipTypes`

- Adds `ACCOUNT_RELATIONSHIP_TYPE` constant (`domain/constants.js`) and the optional `relationshipTypes` field handling (`domain/accounts.js`), additive, no Rules change, no migration.
- Replaces `AccountDetail.jsx`'s tab shell with the fixed sectioned layout: Account Summary (with inline relationship-type badges) → Financial Summary *placeholder mount point* → Contacts → Locations → Service Activity *placeholder mount point* → Notes/Identifiers (collapsed by default).
- Reuses `domain/address.js`, `shared/address/AddressFields.jsx`, and `domain/contacts.js`'s `primaryContactState()` **as-is**, brought in via the selective port defined in "PR #159 reusable-piece selective port" below — never by merging or cherry-picking PR #159's branch. Location remains **add-only**.
- The Financial Summary and Service Activity sections may render as inert placeholders in this PR (their live behavior lands in PR 3/PR 4) or be sequenced entirely into PR 3/PR 4 — either is acceptable provided no half-wired query ships. This PR introduces **no** `fieldops_wos` query and therefore has **no** index dependency.
- Removes/repurposes tab-only CSS (`.fo-tablist`/`.fo-tab*`) only if it is genuinely unused after the shell change; `Tabs.jsx` itself is left in place (available-but-unused), not deleted.

**Verification obligations:** full interaction/accessibility/responsive/regression verification of the sectioned page and the relationship-type editing path, against the reused `CUSTOMER_FIXTURE`; confirm an unset Account shows no badge; confirm no existing Account breaks (additive field); confirm no Rules/query/index/route/migration is introduced; and complete the selective-port verification below. Owns complete verification of everything it introduces before merge.

### PR #159 reusable-piece selective port (governs PR 2)

PR 2 brings forward **only** the three Architecture-approved reusable pieces from PR #159's frozen head `b1f1d1eaf001a754f441c455af040f5ea0160e63` (readable even after G0 closes the PR):

- `field-ops-app-vite/src/domain/address.js` (`formatAddress()`, `addressRows()`)
- `field-ops-app-vite/src/shared/address/AddressFields.jsx`
- `field-ops-app-vite/src/domain/contacts.js`'s `primaryContactState()` — only this derivation, not any unrelated edit PR #159 made to that file.

**Method:** on the fresh branch cut from then-current `main`, port these by file/definition-level retrieval from the frozen commit — e.g. `git checkout b1f1d1e -- <path>` for a wholly-reused file, or a reviewed copy of just the named function where the file also carries unrelated changes. **Never** obtain them by merging or cherry-picking PR #159's branch.

**Explicitly prohibited:**
- merging PR #159;
- merging or cherry-picking its branch — wholesale or any individual commit — to obtain these pieces;
- carrying over its tab shell (`shared/tabs/Tabs.jsx`, `tabs-harness.*`), tab-specific tests, or tab-specific CSS (`.fo-tablist`/`.fo-tab*`);
- carrying over any other, unrelated PR #159 change not in the three-item list above.

**Verification (required before PR 2 merges):** produce and review PR 2's `git diff main...HEAD` and confirm its exact file/change surface contains only (a) the three ported pieces above and (b) PR 2's own new sectioned-page / `relationshipTypes` work — and specifically that no tab shell, tab test, tab CSS, or unrelated PR #159 content appears. The selective-port surface is proven by exact diff, not asserted by description.

## PR 3 — Service Activity (summary counts + Account Activity timeline)

- Adds the Account-scoped Work Order query/hook: aggregate `count()` for `Completed` / `Open` (independent of each other and of the timeline), and the bounded, `createdAt desc`, cursor-paginated timeline.
- Wires the Service Activity section: counts above the list; timeline with per-Work-Order date/status/exact drill-down link; "Load More" via `startAfter`.
- `CANCELLED` excluded from both counts; count state and timeline state independent; each with its own loading/empty/error handling per the Specification.
- **Hard gate:** must not merge until PR 1's two indexes read `[READY]` in production.

**Verification obligations:** emulator-seeded `fieldops_wos` across every status (asserting `CANCELLED` in neither count, counts not recomputed from timeline pages, pagination via `startAfter`); count-vs-timeline state independence (one failing does not block the other); genuine-zero "No activity yet" distinguished from an error state. Confirm the live queries match the deployed index shapes before merge.

## PR 4 — Financial Summary surface (`unconfigured` state only)

- Adds the provider-neutral Financial Summary surface built to the Framework's full five-state contract, with **only `unconfigured` reachable** in production — rendering **"Sales data source not connected."**
- Renders **no** dollar figure, **no** `$0`, **no** Work Order count, **no** procurement figure. Canonical vocabulary only for the (currently unreachable) rendered-figure states.
- No provider integration, no new collection, no Rules change.

**Verification obligations:** drive the surface through all five states with fixture inputs — assert `unconfigured` renders the exact copy and never `$0`; assert `error`/`stale`/`partial`/`complete` render their specified copy and, for `complete`, disclose unsupported metrics explicitly rather than omitting them. Assert the surface exposes no financial value to any role in the `unconfigured` state (no new visibility grant introduced).

## Sequencing notes

- **G0 first** — the moment this Plan and its Specification merge, as an immediate, separately Owner-authorized GitHub-only step, independent of the implementation PRs. PR #159's reusable pieces stay citable against its preserved frozen head `b1f1d1e` after it is closed, so closing early does not block PR 2's selective port.
- **PR 1 before PR 3**, always — PR 3 depends on both indexes being `[READY]`.
- **PR 2 before PR 3 and PR 4** — both wire into the sectioned shell PR 2 establishes.
- PR 3 and PR 4 are independent of each other and may proceed in either order once PR 2 is merged (PR 3 additionally gated on PR 1 `[READY]`).
- **Every step is separately authorized** — G0 (GitHub-only governance) needs its own Owner authorization; each implementation PR needs separate begin-authorization and separate Owner Merge Authorization; PR 1 additionally needs separate Owner Deployment Authorization + `[READY]` verification.

## External dependencies

- **Financial provider (any mode)** — a separate future initiative (Framework Section 17). This plan builds only the provider-neutral surface and its `unconfigured` state; connecting a real provider (external ERP/CRM/data-lake/accounting, or a governed local ledger) requires its own Assessment/Specification/Implementation Plan, and must answer the Framework Section 19 authorization questions before any real figure ships.
- **The Framework's revenue-bearing entities** (Opportunity/Quote/Sales Order/Invoice/Payment/Credit Memo) — none exists; none is created here; each is future scope gated on that separate financial-provider initiative.

## Tracking

| Step | Begin auth | Merge auth | Deploy auth | `[READY]` verified | Merged | Deployed |
|---|---|---|---|---|---|---|
| G0 (close #159 + issue, GitHub-only) | — | n/a | n/a | n/a | n/a | n/a |
| PR 1 (indexes) | — | — | — | — | — | — |
| PR 2 (page + field) | — | — | n/a | n/a | — | — |
| PR 3 (Service Activity) | — | — | n/a | (depends on PR 1) | — | — |
| PR 4 (Financial Summary) | — | — | n/a | n/a | — | — |

(All cells empty/n/a — nothing is authorized, begun, merged, or deployed by this Draft.)

## Approval

**Draft — pending ChatGPT Implementation Plan Final Review and Owner authorization.** No begin-authorization, merge authorization, or deployment authorization for any PR above is implied or granted by this document.
