---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-07-12
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/customer-account-business-model.md, docs/architecture/enterprise-business-metrics-framework.md]
implements: []
supersedes: [docs/specifications/customer-record-page-structured-address.md, docs/implementation-plans/customer-record-page-structured-address.md]
superseded_by: []
related_pr: null
related_issue: 158
target_release: Post-Release 2.1 (Inventory → Procurement chain)
---

# Sprint Specification: Customer/Account Business Model — Sectioned Account Page, Relationship Type, Financial Summary Surface, Service Activity

**Status: DRAFT.** Not yet reviewed. This document is the specification derived from the **merged, Architecture-Approved** Assessment `docs/assessments/customer-account-business-model.md` (PR #161) and is reconciled against the **Accepted** `docs/architecture/enterprise-business-metrics-framework.md` (PR #163, merge commit `db33208e`). It awaits ChatGPT Specification Final Review and separate Owner authorization before anything it describes is built.

**This Specification authorizes no implementation.** It defines *what* the Account page becomes and *what* each future build must satisfy. It does not authorize application code, PR creation, Firestore Rules or schema changes, index creation or deployment, provider integration, migration, deployment, or any production-data action. Each of those remains its own separate gate under `docs/ai/workflow.md`, and the Implementation Plan (`docs/implementation-plans/customer-account-business-model.md`) sequences them without authorizing them either. PR #159 remains **paused and must never merge as-is** (Assessment "Adopted disposition"); this Specification explicitly supersedes the prior direction's Specification and Implementation Plan (see "Supersedes" below).

## Executive summary

Issue #158 redefined the Account ("Customer") record page after PR #159 (the tabbed shell, PR 1 of the prior plan) had already been built and Final-Reviewed under the superseded direction. The new direction is a **sectioned** page (not tab-dependent) that adds: an Account **relationship type** (customer / vendor / both), a **Financial Summary** surface built to the Framework's provider contract, and a **Service Activity** section (operational Work Order counts + a chronological activity timeline). All product and architecture decisions are already resolved in the merged Assessment; this Specification turns them into a buildable design and records the exact queries, indexes, states, and acceptance criteria each future PR must meet.

## Sprint objective

Deliver a provider-neutral, Framework-compliant sectioned Account page that:
1. classifies an Account as customer, vendor, or both, without duplicate company records;
2. presents financial information only through the Framework's five-state provider contract — rendering **"Sales data source not connected"** today, never a fabricated `$0`;
3. presents genuine operational activity (Work Order counts + timeline) under a clearly separate **Service Activity** heading, never as a financial figure;
4. reuses the address/contact domain layer already built in PR #159, and replaces PR #159's tab shell with readable page sections.

## Scope (in scope for this initiative)

1. **`relationshipTypes` field on `accounts`** — new, optional, additive (`string[]`, values `"CUSTOMER"` / `"VENDOR"`, either or both). Informational only: it does **not** gate authorization and does **not** show/hide any page section.
2. **Sectioned Account page** replacing the tab shell, in the reading order fixed by the Assessment: Account Summary → Financial Summary → Contacts → Locations → Service Activity → Notes/Identifiers.
3. **Account Summary** section with relationship-type badges rendered inline (not a separate section).
4. **Financial Summary** surface — provider-neutral, rendering the Framework's five-state contract; **only the `unconfigured` state is reachable in this initiative** (no provider is connected).
5. **Service Activity** section — two distinct, separately-queried elements: operational **summary counts** (`Completed Work Orders` / `Open Work Orders`) and a paginated **Account Activity timeline** of the Account's Work Orders.
6. **Contacts** and **Locations** sections — the existing lists + add actions, reusing PR #159's `domain/address.js`, `shared/address/AddressFields.jsx`, and `domain/contacts.js`'s `primaryContactState()` as-is.
7. **Notes / Identifiers** section — `notes`, `tags`, and the four external identifiers (`customerNumber`/`erpId`/`accountingId`/`legacyId`), collapsed by default (the one section suited to collapsing, per the Owner's item 7).
8. **Index requirements defined** (not created or deployed) for the Service Activity queries — see "Index requirements."

## Explicitly out of scope

- **Connecting any financial provider** (external ERP/CRM/data-lake/accounting system, or a governed local ledger). The Financial Summary surface and its `unconfigured` state are built here; a real provider of either mode is a **separate future initiative** (Framework Section 17).
- Any of the Framework's revenue-bearing entities — Opportunity, Quote, Sales Order, Invoice, Payment, Credit Memo — none exists today (Framework Section 20) and none is created here.
- **Firestore Rules changes.** The `relationshipTypes` field is additive and needs none (see "Firestore Rules impact").
- **Index creation or deployment.** Indexes are *specified* here; their creation, PR, merge, and deployment are separate gates (Implementation Plan PR 1).
- Linking or replacing the existing internal `Supplier`/`purchase_orders` procurement dataset — "vendor" is company-identity classification only this phase (Assessment §f, resolved decision 4).
- Any change to PR #159's branch beyond its eventual close-unmerged (a separate action, sequenced in the Implementation Plan, not performed by drafting this Specification).
- Issue #140 (data-ownership/export) — confirmed no genuine overlap (Assessment scope).
- Vendor-specific fields (payment terms, vendor catalog) and any "list all Vendors" filtered view (would need its own index; not built now).

## Product design — the six sections

Reading order and behavior are fixed by the Assessment's "Adopted Account page hierarchy." Exact responsive layout, spacing, and component decomposition are implementation detail, not re-opened here.

1. **Account Summary** — always visible, never collapsed. Name, `status`, **relationship-type badges** (`CUSTOMER`/`VENDOR`, either/both, inline), `customerNumber` if present, one-line billing address (`formatAddress()`), primary-contact summary (`primaryContactState()`), tags, one Edit action. An Account with no `relationshipTypes` renders **no badge** (blank/omitted) — never a silent default to "Customer."
2. **Financial Summary** — provider-neutral surface (see "Financial Summary surface"). Today renders the Framework's exact `unconfigured` copy, **"Sales data source not connected."** Never `$0`. Never a bare "Sales" figure. Never fed by Work Order counts or procurement spend.
3. **Contacts** — existing Contact list + "+ Add Contact," as a section. Reuses `primaryContactState()`'s multiple-primary warning.
4. **Locations** — existing Location list + "+ Add Location," reusing `addressRows()`/`AddressFields` as-is. Location remains **add-only** (no Location edit action exists in this repo; do not introduce one — the same correction that landed on the superseded spec).
5. **Service Activity** — two distinct elements over the same Account's Work Orders, each its own query, never merged:
   - **Summary counts** — `Completed Work Orders` / `Open Work Orders`, above the list, from their own aggregate `count()` queries. Additional to Financial Summary, never a substitute for it, never relabeled as financial content.
   - **Account Activity timeline** — newest-first, paginated list; each row shows the Work Order's date, status, and an exact drill-down link.
6. **Notes / Identifiers** — `notes`, `tags` (if not already in Summary), and `customerNumber`/`erpId`/`accountingId`/`legacyId`; collapsed by default (integration-only, low-frequency fields — PR #159's existing collapse precedent for this group).

Sections 3–5 read top-to-bottom; only section 6 is collapsed by default, per the Owner's instruction that collapsing is the exception.

## Technical design

### 1. Data model — `relationshipTypes` on `accounts`

- Shape: `relationshipTypes?: ("CUSTOMER" | "VENDOR")[]` on the `accounts` document. Optional; absent on every existing Account until edited.
- A new constant (e.g. `ACCOUNT_RELATIONSHIP_TYPE` in `domain/constants.js`) enumerates the two values, kept **separate** from `ACCOUNT_STATUS` and from any security/operational role concept.
- **No migration / backfill.** Nothing reads the field until this page does; absence renders as no badge.
- **No Firestore Rules change** — the `accounts` match block has no field-level validation today (Assessment §h, confirmed against the rules file lines 823–827); adding an optional field is allowed the same way `tags`/`notes`/the four identifier fields were added without a Rules change.

### 2. Service Activity — two distinct queries (never one shared query)

Both scoped to one Account via `fieldops_wos.customerId == accountId`. `CANCELLED` is excluded from every count and is shown in the timeline only as a terminal, non-sale status (it is not filtered out of the chronological record, but is never counted as completed or open).

**a. Summary counts — aggregate `count()` queries (Firestore `getCountFromServer()` / `AggregateQuery`):**
```
Completed = count( where customerId == accountId AND status in ["COMPLETED","CLOSED"] )
Open      = count( where customerId == accountId AND status in
                   ["CREATED","READY_TO_DISPATCH","SCHEDULED","DISPATCHED",
                    "ACCEPTED","EN_ROUTE","ARRIVED","WORK_IN_PROGRESS"] )
```
Each is a single-purpose aggregate query. Counts are **never** derived by summing/recomputing the timeline's loaded pages. Count loading/error state is **independent** of the timeline's state — a slow or failed count must never block or misrepresent the timeline, and vice versa.

**b. Account Activity timeline — bounded, ordered, cursor-paginated query:**
```
where customerId == accountId
orderBy createdAt desc
limit pageSize            // fixed initial page, never an unbounded read
startAfter(lastDoc)       // cursor pagination for "Load More" (not offset/page-number)
```

These two are distinct queries that share only the collection and the Account scope, never loading/error/pagination/result state.

### 3. Financial Summary surface (provider-neutral; `unconfigured` only this phase)

- The surface is built to the Framework's **five-state provider contract** (Section 17): `complete` / `partial` / `stale` / `error` / `unconfigured`, never collapsed to a boolean.
- **In this initiative only `unconfigured` is reachable** (no provider exists), rendering the Framework's exact copy **"Sales data source not connected."** The other four states are specified here so the surface is built to the full contract, but are exercised only once a provider is connected (separate future initiative).
- **Never `$0`** for a missing source — `$0` reads as a known true zero and would misrepresent "no source" (Framework Section 20).
- Canonical metric vocabulary only (Framework Section 4): Open Pipeline, Quoted Value, Booked Value, Committed Backlog, Invoiced Net Sales, Cash Collected, Credited Net Sales, and (derived, price-source-dependent) Fulfilled Service Value. **No bare "Sales" or "Pending"** label, no "revenue" as a bare word (Sections 4/5/13).
- **Work Order counts and procurement spend are never shown here** — counts belong to Service Activity; `purchase_orders.totalCost`/procurement estimates are spend the business pays out and must never appear as customer sales (Framework Section 20; Assessment Risks).

### 4. Reused from PR #159 (carried forward, not rewritten)

- `domain/address.js` (`formatAddress()`, `addressRows()`) — as-is.
- `shared/address/AddressFields.jsx` — as-is.
- `domain/contacts.js` `primaryContactState()` — as-is.
- `AccountDetail.jsx` header *content decisions* (status badge, customer number, billing-address line, primary-contact summary, tags, Edit) inform the new Account Summary — but the tab **container** does not carry over.
- `shared/tabs/Tabs.jsx` is **not used by this page** (Owner item 3). It is not deleted here — it remains an available, verified component for any other future multi-tab surface; disposing of it is a separate, non-blocking decision.

## Framework compliance — Required Decision Checklist (Framework Section 21)

Answered for the financial surface as scoped (provider-neutral, `unconfigured` only):

- **Exact metric(s) displayed:** none rendered as a value this phase — the surface renders only the `unconfigured` state. When a provider is later connected, only canonical Section 3/4 metrics the provider actually supplies may render.
- **Owning domain / authoritative collection:** none in this phase (no provider). Future: per the Financial Provider Contract (Section 17), stated per configured provider.
- **Statuses included/excluded, date basis, `asOf`, tax, discounts, currency/scale/rounding, cancellations, credits, refticket handling, partial fulfillment, stored/snapshot/derived + lineage:** not applicable while `unconfigured` (no figures). Each becomes a required, explicit answer in the future provider-integration Specification before any figure renders (Sections 10/12/17).
- **Provider state contract:** the surface implements the full five-state contract now (Section 17), even though only `unconfigured` is reachable.
- **Who may view the metric + masking/export (Section 19):** in this phase the surface exposes **no financial figure** to anyone — the `unconfigured` copy discloses nothing — so no new financial-visibility grant is introduced. The Section 19 answers (per-metric visibility, masking, tenant isolation, audit logging, retention, AI access) are **required before any real figure ships** and are the responsibility of the future provider-integration Specification, not this one. This Specification asserts only that no financial value is rendered until those answers exist.

Service Activity counts are operational, not financial (Framework Section 3): they are labeled "Service Activity," never placed in or adjacent to Financial Summary, never offered as a "primary sales KPI," never summed into a dollar figure.

## Firestore Rules impact

**None.** The only schema change is the additive, optional `relationshipTypes` field on `accounts`, which the current `accounts` rule (no field-level validation) already permits. No new collection, no rule change, no `firestore.rules` edit is part of this initiative. (Should a future "list all Vendors" filtered view ever be built, its array-contains query would need its own index at that time — not now, and still not a Rules change.)

## Index requirements (specified here; created/deployed under a separate gate)

Two composite indexes on `fieldops_wos` are required by Service Activity. **This Specification does not create or deploy them** — it records their exact shape so the Implementation Plan can sequence an index-only PR with its own Owner Merge Authorization, separate Owner Deployment Authorization, and `[READY]` verification (matching PR #111's established discipline):

1. **Timeline:** `fieldops_wos(customerId ASC, createdAt DESC)` — for the equality-filter + `orderBy` paginated query.
2. **Summary counts:** `fieldops_wos(customerId ASC, status ASC)` — for the equality + `status in [...]` aggregate `count()` queries.

Verification for each: `firebase firestore:indexes --project taylor-parts --pretty` must read the exact index `[READY]` (a successful `firebase deploy --only firestore:indexes` alone is insufficient) before any UI PR that depends on it may merge.

## Empty / loading / error states

**Financial Summary** — the Framework's five states (Section 17), restated for Taylor Parts:
- `unconfigured` (today's only reachable state): **"Sales data source not connected"** — never `$0`.
- loading: standard loading text (this codebase's `LoadingEmptyState` / `fo-muted "Loading…"` convention) — a transient state, not one of the five.
- `error`: "Sales data temporarily unavailable" (provider configured, current read failed).
- `stale`: "Sales data may be stale as of [asOf]" (configured, data older than freshness threshold).
- `partial`: a per-figure "partial data" warning; missing portions shown as unavailable, never `$0`; drill-down shows included vs. excluded (Section 17).
- `complete`: each configured metric rendered explicitly (never one undifferentiated "no sales" sentence); a legitimate `$0` per metric only when completeness is known for that metric/scope/`asOf`; an unsupported metric is **explicitly disclosed as unavailable**, never silently omitted.

**Service Activity — summary counts:** its own three-way split — loading; `0`/`0` (a legitimate, always-computable count from `fieldops_wos`, not an unavailable-data case); and a distinct error state if a count query fails. Independent of the timeline's state.

**Service Activity — Account Activity timeline:** loading; "No activity yet for this Account" (genuine zero); a distinct error state — never an empty list indistinguishable from an error. Neither Service Activity element uses the financial provider-state contract (`fieldops_wos` is always present or erroring, never "unconfigured").

**Relationship-type badges, unset:** render blank/omitted, never a silent default (matches `domain/address.js`'s null-for-missing precedent).

## Testing strategy

- **Pure/domain logic** (Work Order status → completed/open bucketing; relationship-type badge derivation; count-vs-timeline separation) tested as directly-callable functions, consistent with this repo's convention of extracting pure logic for assertion-based tests (no React test renderer exists; none is added).
- **Provider-state rendering** tested by driving the Financial Summary surface through each of the five states with fixture inputs — asserting `unconfigured` renders the exact copy and **never** `$0`, and that `error`/`stale`/`partial`/`complete` render their specified copy (even though only `unconfigured` is reachable in production this phase).
- **Reused PR #159 fixtures** (`CUSTOMER_FIXTURE`, account/location/contact seed) carry over for the sectioned page; the Tabs-specific ARIA/keyboard assertions are moot once tabs are dropped.
- **Service Activity queries** validated against the Firestore emulator with seeded `fieldops_wos` documents across all statuses (including `CANCELLED` excluded from both counts), and timeline pagination via `startAfter`.
- Each PR owns full verification of what it introduces before it may merge; the Implementation Plan assigns those obligations per PR.

## Acceptance criteria

1. An Account can be classified `CUSTOMER`, `VENDOR`, or both; badges render inline in Account Summary; an unset Account shows no badge.
2. `relationshipTypes` is additive; no existing Account breaks; no Rules change is made.
3. The page renders as readable sections in the fixed order; only Notes/Identifiers is collapsed by default; no tab navigation is used.
4. Financial Summary renders **"Sales data source not connected"** and never `$0`, `0 sales`, a bare "Sales" figure, a Work Order count, or any procurement figure.
5. Service Activity shows `Completed Work Orders` / `Open Work Orders` from independent aggregate `count()` queries (never recomputed from the timeline) and a newest-first, cursor-paginated Account Activity timeline with exact per-Work-Order drill-down links; `CANCELLED` is excluded from both counts.
6. Count state and timeline state are independent — one failing/slow never blocks or misrepresents the other.
7. Contacts and Locations reuse PR #159's address/contact domain layer unchanged; Location remains add-only.
8. The two required composite indexes are documented with exact shapes; the UI that depends on them does not merge until each is `[READY]` in production (enforced by the Implementation Plan's sequencing, not by this Specification's existence).

## Risks

- **Framework mislabeling.** The single highest-risk defect is presenting a Work Order count or procurement figure as a financial/"Sales" value. Mitigated by hard separation (Service Activity vs. Financial Summary), canonical vocabulary only, and acceptance criteria 4–6.
- **Index-before-UI ordering.** The Service Activity UI depends on two indexes that do not exist today; shipping the UI before either is `[READY]` produces live query failures. Mitigated by the index-only PR + separate deployment authorization + `[READY]` verification the Implementation Plan sequences.
- **Discarding reviewed PR #159 work.** The tab shell (and its 37-assertion suite) does not fit the new direction; roughly half of PR #159 (the address/contact domain layer) is carried forward, the tab shell is not. This is an accepted, Owner-directed trade (Assessment Risks).
- **Premature financial visibility.** Even the `unconfigured` surface must not imply a future entitlement; Section 19 answers are required before any real figure ships, and this Specification renders none.

## Open questions

None blocking. All product decisions are resolved in the merged Assessment. Two items are explicitly deferred to their own future initiatives (not this one): (a) connecting a real financial provider of either mode, and (b) any vendor-relationship depth beyond the identity-level `relationshipTypes` flag.

## Supersedes

This Specification supersedes the prior direction's `docs/specifications/customer-record-page-structured-address.md` and `docs/implementation-plans/customer-record-page-structured-address.md` (both via PR #120). Their reusable domain-layer pieces are carried forward explicitly (see "Reused from PR #159"); their tab-shell design is replaced by the sectioned layout above. Per the Assessment's adopted disposition, PR #159 remains paused and is closed unmerged only **after** this Specification and its Implementation Plan merge — a step the Implementation Plan sequences, not this document.

## Approval

**Draft — pending ChatGPT Specification Final Review and Owner authorization.** No architecture approval, no merge authorization, and no implementation authorization is claimed by this document. It authorizes no application code, Rules/schema/index change, deployment, provider integration, or production-data action.
