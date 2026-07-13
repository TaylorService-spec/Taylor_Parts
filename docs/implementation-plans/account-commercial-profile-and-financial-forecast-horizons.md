---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
date: 2026-07-13
owner: Claude Code
related_adrs: []
depends_on: [docs/specifications/account-commercial-profile-and-financial-forecast-horizons.md, docs/assessments/account-commercial-profile-and-financial-forecast-horizons.md, docs/architecture/enterprise-business-metrics-framework.md]
implements: [docs/specifications/account-commercial-profile-and-financial-forecast-horizons.md]
supersedes: []
superseded_by: []
related_pr: null
related_issue: 175
target_release: TBD
---

# Implementation Plan: Account Commercial Profile and Financial Forecast Horizons

**Status: DRAFT.** Sequences the merged, Specification-Approved Spec `docs/specifications/account-commercial-profile-and-financial-forecast-horizons.md` (PR #176) and the merged Architecture-Approved Assessment (PR #174). Tracking issue: **#175**.

**This plan authorizes nothing.** It defines a PR sequence and each PR's verification obligations and gates. It does not authorize application code, Firestore Rules/index changes, a financial-provider integration, deployment, migration, production-data access, `ROADMAP.md`/global-document edits, or Inventory work. **Every PR below requires its own separate Owner authorization to begin, its own Owner Merge Authorization, and — where it changes Rules or indexes — its own separate Owner Deployment Authorization with `[READY]`/live verification.** Merged is never deployed; approved is never merged (`docs/ai/workflow.md`).

Scope note: this plan covers Spec **Phases 1–4**. Spec **Phase 5** (connect a real financial provider → real forecast/credit figures) is a **separate future initiative**, not sequenced here. `CUSTOM` payment terms, pricing tiers, and the credit authority/storage are likewise separate future initiatives (per the Spec), not built here.

## PR sequence

Ordered by dependency. Each is a separate PR with its own review + authorization; they are **not** authorized as a batch.

| PR | Phase | Title | Touches | Rules/deploy? | Depends on |
|---|---|---|---|---|---|
| PR 1 | 1 | Informational Commercial Profile + identity display | `domain/`, `modules/accounts/`, `index.css` | No | — |
| PR 2 | 2a | Governed enum fields + Rules foundation | `firestore.rules`, `domain/`, `modules/accounts/` | **Yes (Tier 2 Rules)** | PR 1 |
| PR 3a | 2b | Server-side hierarchy writer (parentAccount) | `functions/`, `firestore.rules` | **Yes (Rules + server-side deploy)** | PR 2; **Cloud Functions deploy** (see prerequisite) |
| PR 3b | 2b | `parentAccount` UI + commercial-profile audit log | `functions/`, `firestore.rules`, `modules/accounts/` | **Yes (Tier 2 Rules)** | PR 3a |
| PR 4 | 3 + 4 | Provider-neutral financial surfaces (credit unavailable + forecast horizons) | `domain/`, `modules/accounts/`, `index.css` | No | PR 1 |

PR 4 depends only on PR 1's Account page shell, so it may proceed in parallel with the governed PRs 2/3 once PR 1 is merged.

## PR 1 — Phase 1: informational Commercial Profile + identity display (no Rules change)

- **Fields (additive, optional on `accounts`):** `defaultCurrency`, `purchaseOrderRequired`, `invoiceDeliveryMethod`, `billingContact` (`{contactId}`), `accountOwner` (Person Assignment snapshot). New constants in `domain/constants.js`; pass-through in `domain/accounts.js` (no migration).
- **Editing:** extend `AccountForm.jsx` — **admin/dispatcher** edit, exactly the permission the current `accounts` Rules enforce (no admin-only field here). `accountOwner` uses `EmployeeAssignmentPicker` (name search → resolves the person, never a raw UID).
- **Display:** a new **Commercial Profile** section in `AccountDetail.jsx` rendering each field; ID-bearing fields render the **current** resolved name (`hooks/useEmployeeDirectory.js` for `accountOwner`; a contact lookup for `billingContact`), `"Unknown …"` when unresolved, omitted when unset. No credit, no forecast, no `paymentTerms`, no `parentAccount`, no `taxStatus`, no audit log (all governed → later PRs).
- **Verification:** build/lint/typecheck; pure-logic Node tests for identity resolution (current name vs "Unknown"); a `verify-*` driver check that the section renders resolved names (never raw IDs) with "Unknown" fallbacks, and that a **non-admin/dispatcher** cannot reach the edit (matching current Rules — no field claims an authorization Rules don't enforce); accessibility + responsive. No financial figure anywhere.

## PR 2 — Phase 2a: governed enum fields + Rules foundation (Tier 2 Rules)

- **Fields:** `paymentTerms` (`COD`/`NET_30`/`NET_60`/`NET_90`) and `taxStatus` (`UNKNOWN`/`TAXABLE`/`EXEMPT`/`RESELLER`; absent ⇒ `UNKNOWN`, never `TAXABLE`).
- **Rules (MANDATORY):** a `firestore.rules` change validating the enum values and restricting edits of these governed fields to **admin** — enforced in Rules, **not** UI hiding. This is a **Tier 2** change: its own Architecture Review, Owner Merge Authorization, **separate Owner Deployment Authorization** (`firebase deploy --only firestore:rules --project taylor-parts`), and post-deploy live verification (the rules are enforced; no client bypass).
- **Rules test:** emulator Rules test (`functions/test/*.test.js` pattern) proving a non-admin write of `paymentTerms`/`taxStatus` is denied and an admin write with a valid enum is allowed, an invalid enum denied.
- **Verification:** build/lint/typecheck; pure-logic tests (payment-term net-days → due date for Net-N; **COD resolves against the delivery/fulfillment event, not `invoiceDate+0`**, and a pre-delivery COD invoice is due-date-pending; issued-invoice snapshot unchanged by a later Account-term change); `taxStatus` safe-default; browser render.

## PR 3a — Phase 2b: server-side hierarchy writer (parentAccount integrity authority)

- **The privileged server-side transactional writer** that owns `parentAccount` integrity: a Cloud Function (or Admin-SDK operational path — see prerequisite) that, **inside a server-side transaction, re-reads the full prospective ancestor chain** and atomically rejects a cycle/self-parent or a resulting depth > `MAX_HIERARCHY_DEPTH` (**= 5**). It is the integrity **authority**; Rules only restrict *routing* (the write must arrive via this path) and validate *shape*, and are not the ancestor-walk authority.
- **Rules:** a `firestore.rules` change that makes `accounts.parentAccount` writable **only** through the trusted server-side path (deny direct client writes to that field), Tier 2 with its own deploy + verification.
- **Verification:** emulator/integration test proving cycle/self-parent/over-depth rejection, including a **concurrent-write scenario** where two individually-valid writes would form a cycle and the in-transaction re-read rejects one; a client-SDK write to `parentAccount` is denied by Rules.

**⚠ Hard prerequisite — Cloud Functions are not deployed (Blaze-plan blocker, issue #15).** A live UI `parentAccount` edit needs a deployed server-side writer, which does not exist today. Two acceptable paths, decided at PR-3a authorization:
- **(a) Deploy the Cloud Function** — requires the Blaze upgrade (Owner billing action, issue #15). Preferred long-term; unblocks live UI editing.
- **(b) Interim Admin-SDK operational path** — an operator-run Admin script (the `functions/scripts/provisionEmployeeAccess.js` trust class: explicit `--projectId`/`--confirmProduction`, no client access) performs the transactional parentAccount write; the **UI renders `parentAccount` read-only** until (a) lands. This keeps the integrity authority server-side/privileged without waiting on Blaze, at the cost of manual operation.
**PR 3b's live UI edit path must not ship until one of these exists.** The plan does not assume a client write suffices, and does not itself deploy anything.

## PR 3b — Phase 2b: parentAccount UI + commercial-profile audit log

- **`parentAccount`:** UI to set it (via PR 3a's server-side writer if deployed; otherwise read-only display + operator path), rendering the resolved parent name / `"Unknown account"`.
- **Audit log:** the commercial-profile change log — an append-only record written **only** by a trusted/audited server-side writer, with its own schema and Rules gate (client writes denied; entries immutable; snapshot the actor/subject display names at event time + retain IDs). Tier 2 Rules; separate deploy + verification.
- **Verification:** parentAccount resolution + "Unknown account"; audit entries writable only by the trusted writer (a client cannot forge/alter them), immutable, name-snapshotted; browser render.

## PR 4 — Phase 3 + 4: provider-neutral financial surfaces (no Rules change)

- **Credit — rendered unavailable (no storage/Rules/writer/value):** the Account's financial area renders credit as **unavailable via the provider-state contract** (reuse the merged `domain/financialSummaryView.js` five-state view + `FinancialSummarySection` pattern), showing `unconfigured` → "Sales data source not connected". **No `creditStatus`/`creditLimit` field, document, or Rule is added.**
- **Forecast horizons:** two separately-labeled family sub-sections (Receivables and Pipeline/order) rendering the five-state contract, `unconfigured` only, never `$0`; Family 1's due-date aging labeled **`Receivables Due`** (never `Cash Collected` or `Projected Collections`), with the defined component policy encoded but not computed; families never merged.
- **Visibility:** admin/dispatcher see the `unconfigured` state only; **no real figure, drill-down, export, or AI-access path is reachable** (all deferred to the separate provider Specification).
- **Verification:** pure-logic tests (forecast bucketing per family; `Receivables Due` vs `Cash Collected`/`Outstanding Receivables` distinct; receivables component policy — includes tax/shipping/fees, never labeled/summed as revenue; five-state render views extending `financialSummaryView`); browser render (exact `unconfigured` copy, no figure, `Receivables Due` labeling, credit unavailable, no reachable real-figure/drill-down/export/AI path); accessibility + responsive.

## Testing strategy (per the Spec)

- **Pure logic (standalone Node assertion tests, repo convention):** identity resolution; payment-term/COD due-date semantics; forecast bucketing + vocabulary + component policy; parent cycle/depth. Committed under `field-ops-app-vite/test/` and run via `npm test` (extend the existing script), the pattern PRs #170/#172 established.
- **Emulator Rules tests (`functions/test/*.test.js`):** governed-field edit authorization, `parentAccount` client-write denial, audit-log trusted-writer-only — the pattern `functions/test/employeesRules.test.js`/`reorderRequestsRules.test.js` established.
- **Browser (`verify-*` driver):** Commercial Profile rendering (resolved names, "Unknown", no raw IDs), safe defaults, provider-neutral credit/forecast surfaces, non-admin-edit-rejected-at-Rules-layer, accessibility, responsive. No React test renderer is added.

## Shared-file collision controls

Multiple Claude sessions work this repo concurrently (Customer + Inventory). Controls, mandatory for every PR here:
- **Path-specific `git add <file>`** only — never `git add -A`/`.` — to avoid staging the concurrent-session working-tree changes (`docs/DECISIONS.md`, `.claude/settings.json`) or another session's files.
- **`firestore.rules` is high-collision** (the Inventory session edits it). Before any Rules PR (PR 2/3a/3b): `git fetch` + check for open PRs touching `firestore.rules` (`gh pr list --search "firestore.rules"`); **rebase on the latest `origin/main`** immediately before opening/merging; re-verify the deployed ruleset after merge (the standing "merged ≠ deployed" discipline) and confirm the deploy does not drop another session's rules.
- **Shared UI/test files** (`AccountDetail.jsx`, `AccountForm.jsx`, `index.css`, the run-skill `seed.mjs`/`driver.mjs`, `package.json`): check for open PRs touching them before editing; keep each PR's diff surface tight; re-verify against the latest `main` before merge.
- **Work in the isolated Customer worktree**; do not switch the shared main checkout.

## Separate Rules / index / deployment gates

- **Rules (PR 2, PR 3a, PR 3b):** each `firestore.rules` change is **Tier 2** — own Architecture Review, own Owner Merge Authorization, **own separate Owner Deployment Authorization** (`firebase deploy --only firestore:rules --project taylor-parts`), and live post-deploy verification. Merging a Rules PR never deploys it; nothing in CI does.
- **Indexes:** this plan's Account-page surfaces need **no** composite index (single-Account point reads; the parent-chain walk is point reads by ID). **Any future filtered/list view** ("accounts by owner / parent / payment terms") is a **separate index-only PR** with its own Merge + Deployment authorization + `[READY]` verification (the PR #167 pattern) — not part of this plan.
- **Server-side deploy (PR 3a):** deploying the Cloud Function (path (a)) is its own Owner Deployment Authorization and depends on the Blaze upgrade (issue #15). The interim Admin-SDK path (b) is an operator-run, separately-authorized production-data action, not a deployment.

## External dependencies / blockers

- **Cloud Functions not deployed (issue #15, Blaze blocker)** — gates PR 3a's live server-side writer (handled above).
- **Financial provider** — not connected; all credit/forecast figures stay `unconfigured`. Connecting one is Spec Phase 5, a separate future initiative.
- **Finer-grained finance/credit role, `CUSTOM` payment terms, pricing tiers, credit storage/authority** — each a separate future initiative, out of this plan.

## Tracking

| PR | Begin auth | Merge auth | Rules deploy auth | Verified live | Merged |
|---|---|---|---|---|---|
| PR 1 | — | — | n/a | n/a | — |
| PR 2 | — | — | — | — | — |
| PR 3a | — | — | — | — | — |
| PR 3b | — | — | — | — | — |
| PR 4 | — | — | n/a | n/a | — |

(All cells empty — nothing is authorized, begun, merged, or deployed by this Draft.)

## Approval

**Draft — pending ChatGPT Implementation Plan Review and Owner authorization.** No begin-authorization, merge authorization, or deployment authorization for any PR above is implied or granted by this document.
