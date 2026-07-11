---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
date: 2026-07-11
owner: Claude Code
related_adrs: []
depends_on: [docs/specifications/customer-record-page-structured-address.md]
implements: [docs/specifications/customer-record-page-structured-address.md]
supersedes: []
superseded_by: []
related_pr: 120
target_release: Post-Release 2.1 (Inventory → Procurement chain)
---

# Implementation Plan: Customer Record Page and Structured Address Experience

**Sprint Specification:** `docs/specifications/customer-record-page-structured-address.md` -- Approved, 2026-07-11.

Two PRs, per the Architecture Decision's explicit two-PR sequence (supersedes the Assessment's earlier five-PR estimate). No PR in this plan is implemented, merged, or run against production by this document itself -- each requires its own Codex review (optional; this sprint has no Rules change, so Codex review is not required per `docs/ai/workflow.md`'s "documentation-only PRs, small bug fixes, routine UI changes, or low-risk implementation using established patterns" carve-out, but may still be requested if the first-ever `Tabs` implementation warrants independent engineering review), its own ChatGPT Final Review, and its own Owner Merge Authorization before merge. **Neither PR touches `firestore.rules` -- no Owner Deployment Authorization is needed for Rules; both PRs are frontend-only and auto-deploy at merge**, same as every prior frontend-only PR in this initiative (e.g. PR #105, PR #107). **This plan is planning only -- no application code has been written.**

## PR breakdown

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|
| 1 | Customer record header + tabbed shell | New reusable `Tabs`/`TabPanel` component (Context-owned instance ID, mount-all-panels-`hidden`); `domain/address.js` (`formatAddress()`/`addressRows()`); `shared/address/AddressFields.jsx`; `AccountDetail.jsx` redesigned into header + Details/Locations/Contacts tabs, consuming already-fetched data; primary-Contact NONE/ONE/MULTIPLE derivation; existing Locations/Contacts display and "+ Add Location"/"+ Add Contact" functions preserved, Location add form converted to `AddressFields` | None | Not started |
| 2 | Customer edit form + Location add form + verification | `AccountForm.jsx` reorganized into sectioned two-column layout, billing-address inputs replaced by `AddressFields`; `docs/BusinessEntityModel.md` updated to reflect the new page shape; focused live browser verification against a fresh emulator; any corrections discovered during integration with PR 1's components | PR 1 (merged) | Not started |

Per the Architecture Decision: **no standalone foundation PR** for `Tabs`/`AddressFields`/the formatting utility -- they land together with PR 1, their first real consumer, reversing the `EmployeeAssignmentPicker.jsx` zero-consumers precedent for this initiative specifically.

## Sequencing notes

PR 1 is the larger of the two: it introduces every new shared component (`Tabs`, `domain/address.js`, `AddressFields`) **and** wires them into `AccountDetail.jsx`'s new header/tab shell in the same PR, per the Architecture Decision's explicit "no standalone foundation PR" constraint -- these components must not exist with zero consumers even transiently across a PR boundary. This is a deliberate divergence from the smaller-PR-per-concern pattern the Cancel/Void initiative (PR #108) uses, because that initiative's constraint runs the opposite direction (Owner explicitly capped this initiative at two PRs, not five).

PR 2 depends on PR 1 being merged (not merely opened) because it reuses `AddressFields` in a second consumer (`AccountForm.jsx`) and needs `Tabs`/the Details tab's Billing Address section already in place to reorganize the edit form consistently with the read-side layout PR 1 established. PR 2 is also where the Location **add** form (already converted to consume `AddressFields` in PR 1, inside `AccountDetail.jsx`'s Locations tab) gets its focused live verification alongside the edit-form work -- not a second component change, a verification and documentation pass.

Neither PR carries a `firestore.rules` change, a new Firestore query, a new index, or a new route -- both are pure frontend/presentation changes over already-fetched data and already-existing collections, per the Specification's "Firestore Rules impact: None" and "Explicitly out of scope" sections. Both auto-deploy at merge; no separate deployment step or Owner Deployment Authorization applies to either.

## External dependencies

- **None.** All data (`useAccount`/`useLocationsForAccount`/`useContactsForAccount`) is already fetched by the existing `AccountDetail.jsx`; no other in-flight PR (`PR #108`, `Issue #118`) is touched or depended on.
- No dependency on Firebase Blaze / Cloud Functions -- `accounts`/`locations`/`contacts` remain client-direct-write-with-rules, unchanged.
- No dependency on the Person Assignment Platform Service Standard -- Account Owner assignment via that standard is explicitly deferred (Architecture Decision item 7), not part of either PR in this plan.

## Tracking

| PR | Merge status | Deployment status |
|---|---|---|
| 1 -- Record header + tabbed shell | Not started | Not deployed |
| 2 -- Edit form + Location add form + verification | Not started | Not deployed |

Update this table as each PR merges and deploys -- this document is the running source of truth for "what's left in this sprint" until it completes, per the template's own guidance.
