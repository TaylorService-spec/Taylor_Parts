---
artifact_type: assessment
gate: Repository Assessment
status: Architecture-Approved
date: 2026-07-12
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/customer-record-page-structured-address.md, docs/specifications/customer-record-page-structured-address.md, docs/implementation-plans/customer-record-page-structured-address.md, docs/architecture/enterprise-business-metrics-framework.md]
implements: []
supersedes: []
superseded_by: []
related_pr: 161
target_release: Post-Release 2.1 (Inventory -> Procurement chain)
---

# Assessment Report: Customer/Account Business Model -- Dual Customer/Vendor Role, Financial Summary, Account Activity

**Business Request:** Issue #158. The Owner has clarified the Account business model and information architecture after PR #159 (PR 1 of 2, the tabbed header/Details/Locations/Contacts shell) was already implemented and Final-Reviewed under the prior direction (`docs/specifications/customer-record-page-structured-address.md`, `docs/implementation-plans/customer-record-page-structured-address.md`, both via PR #120):

1. "Customers" are Accounts.
2. An Account may represent a customer, a vendor, or both -- do not create duplicate company records merely because the relationship differs.
3. The Account page should not depend on numerous tabs.
4. Contacts should appear as an Account-owned listing/section.
5. The page needs an Account Activity section aligned to the company's business history.
6. The page needs sales information: completed/recognized sales, pending sales, and links/drill-down to the records behind those totals.
7. Locations, contacts, identifiers, notes, and activity should be organized as readable page sections, using collapsible sections only where they improve usability.

**Architecture Review: APPROVED.** Reviewed by ChatGPT on 2026-07-12 at head `6d6c0636826aeb9af83b3573607be08ef1e399e5`, after three REQUEST CHANGES rounds. **This approval does not authorize the Specification, index work, application implementation, any schema/Rules change, deployment, or any production-data action** -- each remains its own separate gate under `docs/ai/workflow.md`, requiring its own review and Owner authorization. PR #159 remains paused (see "Resolved architecture and product decisions" below), PR 2 has not begun, and this assessment does not itself authorize any code, schema, Rules, index, or production-data change.

**Updated to align with `docs/architecture/enterprise-business-metrics-framework.md`, Accepted at merge commit `db33208e321b435033199f225697c99bf9a2da00`.** That framework is now this repository's authoritative source for business-metrics/revenue-lifecycle terminology; every "sales"/"revenue" reference below has been reconciled against its canonical definitions rather than left as this assessment's own ad hoc language. Its acceptance does not itself authorize building any of the entities discussed here -- see its own header.

**One terminology note on item 6 above:** the Owner's own phrase "completed/recognized sales" is not itself changed (it is quoted verbatim from Issue #158), but the Framework prohibits the term **"Recognized Revenue"** as a metric name until an implemented accounting authority defines it (Framework Section 13). The closest canonical concepts this assessment maps that phrase to, once a financial provider is eventually connected (see "Resolved architecture and product decisions" below), are **Fulfilled Service Value** (if a priced Sales Order/Quote exists) or **Invoiced Net Sales** -- never an accounting-recognition claim this platform isn't positioned to make.

## Scope of this assessment

Investigated, read-only, in the isolated Customer worktree: `docs/BusinessEntityModel.md` (the full object model), `domain/accounts.js`/`domain/contacts.js`/`domain/locations.js`, `firestore.rules`' `accounts`/`locations`/`contacts`/`suppliers`/`supplier_catalog`/`purchase_orders` match blocks, `domain/constants.js` (`ACCOUNT_STATUS`, `JOB_STATUS`, `WORK_ORDER_STATE`), `types/workOrder.ts` (the Work Order Engine v1.2 schema), `domain/workOrders.js` (a second, unrelated "workOrders" store), `services/operationsQueries.ts` (Supplier/Purchase Order read shapes), `functions/src/createWorkOrder.ts`, `functions/src/procurementBridge.ts`, and every file in the repository referencing `accountId` or `customerId`.

Explicitly **not** investigated or addressed here:
- Inventory Issue #154's Assessment/Specification/Implementation Plan, branches, or PRs -- separate initiative, separate owner, untouched.
- Issue #140 ("Customer Operability, Data Ownership, and Analytical Export Architecture") -- read to confirm scope, but **not applicable here**: it governs how a *company that licenses Taylor Parts* owns and exports its own data to external BI/lake platforms. This assessment's "Account/Customer/Vendor" is a different meaning of "customer" entirely -- the operating business's own customers and vendors inside the CRM/field-service data model. No genuine overlap was found; not linked substantively below, per the Owner's explicit instruction not to merge the two initiatives automatically.
- Any application code, Firestore Rules, deployment, or production-data change -- none was made producing this assessment.

## Current repository state

### a. Which entities currently represent sales

**None, authoritatively.** `docs/BusinessEntityModel.md` Section 2/Section 3 lists **Invoice** and **Opportunity/Quote** as **Future** entities -- neither is built, neither has a collection, neither has any code anywhere in the repository (confirmed: zero matches for "invoice"/"quote"/"estimate" outside of comments in `functions/src/procurementBridge.ts`/`inventoryAnalyticsService.ts`, and those are about *procurement* cost estimation, not customer sales).

The only real, production entity connected to an Account at all that could plausibly represent a sale is **Work Order** (`fieldops_wos` collection, "Work Order Engine v1.2", `types/workOrder.ts`) -- confirmed live via `services/workOrderService.ts`, routed at `/work-orders`, `/technician`, `/control-tower`, `/dispatcher-board`. Its `customerId` field links to an `accounts` document's ID (`docs/BusinessEntityModel.md` Section 10, confirmed unchanged).

**A second, unrelated `workOrders` collection exists in `domain/workOrders.js`** (lowercase, lead comment: `"open" | "scheduled" | "in_progress" | "closed"`) -- confirmed **dead code**: zero importers anywhere in `field-ops-app-vite/src` besides its own file. Not a real data source; must not be confused with `fieldops_wos`.

### b & c. Completed vs. pending sales statuses

If Work Order counts are reported as Service Activity (see the Framework-aligned Risks section below on why this is never a Sales figure, per `docs/architecture/enterprise-business-metrics-framework.md`), its real `WorkOrderStatus` lifecycle (`types/workOrder.ts`) is:

- **Completed/terminal:** `COMPLETED`, `CLOSED`.
- **Pending/in-flight:** `CREATED`, `READY_TO_DISPATCH`, `SCHEDULED`, `DISPATCHED`, `ACCEPTED`, `EN_ROUTE`, `ARRIVED`, `WORK_IN_PROGRESS`.
- **Terminal but not a sale:** `CANCELLED` -- must be excluded from both completed and pending counts, not folded into either.

(A separate, older `JOB_STATUS` enum -- `open`/`assigned`/`in_progress`/`complete`, `fieldops_jobs` collection -- also exists and also has no monetary field; not investigated further since Work Order is the entity actually linked to `accountId`/`customerId`.)

### d. Whether monetary totals exist and which amount field is authoritative

**No monetary field exists on Work Order at all.** `types/workOrder.ts`'s full `WorkOrder` interface was read in its entirety: `id`, `woNumber`, `status`, `priority`, `severity`, `type`, `customerId`, `locationId`, `assignedTechId`, five scheduling/execution timestamps, `complaint`/`diagnosis`/`resolution`, `laborHours` (a quantity, not currency), an optional non-authoritative `inventorySnapshot` (parts planned/used, no price), and `executionLog`. **No `price`/`cost`/`amount`/`total`/`revenue` field anywhere.** `functions/src/createWorkOrder.ts` confirms the same field set at the write path.

In the Framework's own terms (Section 3): there is no **Sales Order** or accepted **Quote** anywhere in this codebase that could own a `bookedValue` for a Work Order to be priced against, so **Fulfilled Service Value is not computable for any Work Order today** -- not merely "unpopulated," but structurally absent, since its composite-ownership model (Framework Section 3) requires a price-owning record that does not exist. The only metric a Work Order can support today is the Framework's unconditional operational fallback: **`Completed Work Orders` / `Open Work Orders`** (Section 3) -- pure activity counts, never a dollar figure, never labeled "sales" or "revenue."

The only real monetary totals anywhere in the repository are on the **procurement (spend) side**, not sales: `RawPurchaseOrder.totalCost` (`services/operationsQueries.ts`, the existing `purchase_orders` collection, Admin-SDK-only, Supplier-linked -- money the business pays *out*), and `procurementBridge.ts`'s `estimatedUnitPrice`/`estimatedTotalCost` (reorder cost estimation against `supplier_catalog` pricing, also spend-side). **Neither is connected to an Account, and neither represents revenue** -- per the Framework's own explicit warning (Section 20), vendor procurement spend must never appear as customer sales.

**Conclusion: no field in this codebase today can support any of the Framework's canonical revenue-bearing metrics (Open Pipeline, Quoted Value, Booked Value, Fulfilled Service Value, Invoiced Net Sales, Cash Collected, Credited Net Sales). The only metric available is the Framework's own operational fallback, `Completed Work Orders` / `Open Work Orders`.**

### e. Which entities can form the Account Activity timeline

**Work Order is the only real candidate**, via `customerId` -- but **no existing query fetches Work Orders by `customerId`/`accountId` anywhere in the repository** (confirmed: zero `where("customerId", ...)` or `where("accountId", ...)` call sites against the Work Order collection; `workOrderService.ts`'s `onSnapshot` reads the whole `fieldops_wos` collection unfiltered for its own list views).

**Correction (Architecture Review): a deterministic, newest-first, paginated Account Activity timeline needs more than a bare equality filter.** Building it requires a new query/hook shaped as:
```
where("customerId", "==", accountId)
orderBy("createdAt", "desc")
limit(pageSize)
```
This combination -- an equality filter plus an `orderBy` on a different field -- **requires a Firestore composite index**: `fieldops_wos(customerId ASC, createdAt DESC)`. This does not exist today (confirmed: no such index is defined anywhere in this repository's index configuration). The prior draft of this assessment incorrectly claimed "no composite index needed" by analogy to `reorder_requests`' hooks -- those hooks use equality filters only, with no `orderBy`, which is the actual reason they need no composite index; this timeline's requirement is different because it needs a deterministic sort order, not just a filter.

No other entity references `accountId`/`customerId` except Location and Contact (already read/rendered by PR #159), and Reorder Request (Part-linked only, never Account-linked -- not a candidate).

### f. How vendor relationships are currently represented, if at all

**Not represented at all, and not connected to Account in any way.** `Supplier` is a real, existing, **separate** entity (`suppliers`/`supplier_catalog` collections, `docs/BusinessEntityModel.md` Section 3/Section 8's relationship diagram: `Supplier -- 1:many -- Purchase Order -- many:many -- Part`) with its own shape (`RawSupplier: { id, name, contactEmail, leadTimeDays }`) and is **Admin-SDK-only** -- `firestore.rules` denies all client `create`/`update`/`delete` on `suppliers`/`supplier_catalog`/`purchase_orders` unconditionally (`allow create, update, delete: if false`), read-only for admin/dispatcher. There is no `accountId` field on `Supplier`, no `supplierId` field on `Account`, and no code anywhere linking the two.

Separately, `reorder_purchase_orders.supplierName` (Section 4b) is manually-entered free text, explicitly documented as "no Supplier/Vendor Management object, no vendor catalog... yet" -- also disconnected from both `Account` and the real `Supplier` entity.

**A "this Account is also a vendor" relationship, as the Owner now wants, has zero existing representation to build on.** It would need to be modeled fresh -- most likely as a field/flag on `Account` itself (see below), not by reusing the existing `Supplier` entity, which is a different, Admin-SDK-only, internal procurement dataset with no product surface for editing vendor company records at all.

### g. Whether an Account relationship-type field already exists

**No.** `domain/accounts.js`'s full documented `Account` shape: `{ id, name, billingAddress?, status?, notes?, tags?, customerNumber?, erpId?, accountingId?, legacyId?, createdAt, updatedAt }`. `domain/constants.js` defines only `ACCOUNT_STATUS` (`Active`/`Inactive`/`Prospect`/`Archived`) -- no `ACCOUNT_TYPE`, `RELATIONSHIP_TYPE`, `isVendor`, `isCustomer`, or equivalent constant or field exists anywhere.

### h. Schema/Rules/index/migration impact this direction would require

- **Account relationship-type field (customer/vendor/both):** a **new, optional field on `accounts`** (e.g. `relationshipTypes: string[]`, values `CUSTOMER`/`VENDOR`). `firestore.rules`' `accounts` match block has **no field-level validation today** (confirmed by direct read, lines 823-827) -- adding this field needs **no Rules change** to merely allow it, the same way `tags`/`notes`/the four external-identifier fields were added without a Rules change. No index needed unless a future "list all Vendors" filtered view is built (a single-field array-contains query would need its own index at that point, not now). **No migration is required** -- existing Accounts simply have no value for the new field until edited; nothing needs backfilling to keep working, since nothing reads this field today.
- **Financial Summary (completed/pending totals + drill-down):** **no schema exists to source this from.** Two real options, both re-expressed in the Framework's own canonical terms (Section 3/17) -- see "Resolved architecture and product decisions" below for which is adopted:
  - **(i) Connect a real financial provider and report Booked Value / Fulfilled Service Value / Invoiced Net Sales / Cash Collected** -- **adopted as the target architecture (see "Resolved architecture and product decisions" below), deferred as a build** -- this requires the Sales Order/Quote/Invoice/Payment entities `docs/BusinessEntityModel.md` Section 2 lists as Future/unbuilt, sourced through the Framework's Financial Provider Contract (Section 17), and **is a separate future initiative, not part of this Customer-page initiative's own scope.** **The Framework supports either mode, and neither is built by this initiative:**
    - **External provider mode** -- an ERP, accounting system, CRM, or data-lake integration supplies these entities; Taylor Parts never becomes their authority, only a subordinate cache with full lineage (Framework Section 17).
    - **Governed local-ledger mode** -- Taylor Parts builds and owns these entities itself (new collections, new Rules, a write path -- genuine schema/data-architecture work, Tier 2 per `docs/DelegationCharter.md`'s "changes to firestore.rules that alter who can read or write what"), explicitly configured as the authoritative source per the Framework's authority-mode field, not merely a cache.
    - Whichever mode is eventually chosen, the Framework's five-state contract (`complete`/`partial`/`stale`/`error`/`unconfigured`) governs what the Financial Summary surface shows before, during, and after that provider is connected -- this is the only way to show a truthful monetary total, in either mode. **This Customer-page initiative builds the provider-neutral Financial Summary surface and its `unconfigured` state only** -- connecting an actual provider of either mode is out of scope here.
  - **(ii) `Completed Work Orders` / `Open Work Orders`, presented as Service Activity** -- **adopted, additional to (i), never an alternative to it.** The Framework's own unconditional operational fallback (Section 3/20): pure counts plus a chronological timeline (see the page hierarchy above), never dollars, never labeled "Financial Summary"/"Sales." This is buildable now, independent of any financial-provider decision.
  - **Correction (Architecture Review): the summary counts and the timeline are two distinct queries, not one shared query.** A bounded, paginated `orderBy("createdAt", "desc").limit(pageSize)` timeline query cannot also produce an accurate Account-wide count -- it would only count the currently loaded page(s). Adopted design: the counts use separate Firestore aggregate `count()` queries, never the timeline's bounded query:
    ```
    // Completed
    count(where("customerId", "==", accountId).where("status", "in", ["COMPLETED", "CLOSED"]))
    // Open
    count(where("customerId", "==", accountId).where("status", "in", ["CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]))
    ```
    Each is a single-purpose `count()` aggregation query (Firestore's `getCountFromServer()`/`AggregateQuery`), never derived by summing or recomputing from the timeline's currently loaded pages. `CANCELLED` is excluded from both, per Section b/c above. **Count loading/error states are independent of the timeline's own loading/error/pagination state** -- a slow or failed count query must never block, hide, or misrepresent the timeline, and vice versa.
    - **Index impact**: an equality filter (`customerId`) plus an `in` filter (`status`) is a composite condition -- the exact required index shape must be confirmed (and recorded explicitly) at Specification time, not assumed by analogy to any other query in this codebase.
    - **Correction (Architecture Review): the summary counts are adopted as part of the approved Account design, not an optional element the Specification may drop.** `Completed Work Orders` and `Open Work Orders` remain required summary counts; their aggregate queries and required indexes must be specified and sequenced in the Specification, not deferred or removed for implementation convenience. If later technical evidence during Specification or implementation genuinely proves the aggregate-query/index approach unsafe or infeasible, that finding must return through Architecture Review before any change to this adopted element -- the Implementation Plan itself must never silently drop it.
  - (ii)'s timeline needs the new `customerId`-filtered, ordered, paginated Work Order query from (e) above and its prerequisite composite index (below); (ii)'s summary counts need their own separate aggregate `count()` query and index (above), never the timeline's query; (i) needs a new collection + Rules + write path, regardless of authority mode, when that separate future initiative begins.
- **Account Activity timeline:** the new `customerId`-filtered, `createdAt`-ordered, paginated Work Order query from (e). No Rules change (existing `fieldops_wos` read rule already covers admin/dispatcher, unchanged) -- but **does require a new composite index**, `fieldops_wos(customerId ASC, createdAt DESC)`, which does not exist today. A future Implementation Plan must record and sequence, matching this repository's own established index-deployment discipline (e.g. PR #111's `PARTS_ASSOCIATE`-eligibility index):
  - A **bounded initial page** (a fixed `limit(pageSize)`, not an unbounded read of every Work Order ever created for the Account).
  - **Cursor-based "Load More"** (Firestore `startAfter()` on the last document's `createdAt`, not an offset/page-number scheme) for any activity beyond the initial page.
  - **An index-only prerequisite PR**, separate from the Activity UI PR -- the index definition change lands and deploys first, on its own.
  - **Separate Owner Merge Authorization** for the index PR, independent of any UI PR's own authorization.
  - **Separate Owner Deployment Authorization** to actually deploy the index (`firebase deploy --only firestore:indexes`) -- merged is not deployed, the same discipline this repository already applies to every Rules deploy.
  - **Confirmed `[READY]`** via this repository's established index-verification command, `firebase firestore:indexes --project taylor-parts --pretty` (not `gcloud firestore indexes composite list` or the Firebase Console) -- require explicit confirmation that the exact `fieldops_wos(customerId ASC, createdAt DESC)` index reads `[READY]`. A successful `firebase deploy --only firestore:indexes` command alone is insufficient -- only the `[READY]` read confirms the index has actually finished building, matching the verification pattern PR #111 already established. **Any additional aggregate-count indexes from the summary-counts correction above need this identical treatment**: their own index-only PR, separate Owner Deployment Authorization, and the same exact `[READY]` verification via this same command -- before the Activity UI PR that depends on either index may merge.
- **Vendor relationships beyond a flag on Account** (e.g. actually linking to `Supplier`, or vendor-specific fields like payment terms) -- **not assessed here**, since the Owner's stated requirement (item 2) is company-identity-level ("an Account may represent... a vendor"), not a request to merge or link the existing internal `Supplier` procurement dataset. Treated as out of scope unless the Owner says otherwise.

## Whether PR #159 contains reusable work

Assessed each piece of PR #159 (head `b1f1d1eaf001a754f441c455af040f5ea0160e63`) independently, **without assuming the tabbed layout survives**:

| Component | Reusable under the new direction? | Why |
|---|---|---|
| `domain/address.js` (`formatAddress()`/`addressRows()`) | **Yes, as-is.** | Pure formatting functions, no dependency on tabs or any particular page layout. Still needed for a "Locations" section and an "Account Summary" address display under the new hierarchy. |
| `shared/address/AddressFields.jsx` | **Yes, as-is.** | Pure controlled form component. Still needed wherever an address is edited (Account billing address, Location add/edit) regardless of section vs. tab layout. |
| `domain/contacts.js`'s `primaryContactState()` | **Yes, as-is.** | Pure derivation (NONE/ONE/MULTIPLE), independent of layout. Still needed for an Account Summary header and a Contacts section. |
| `shared/tabs/Tabs.jsx` (+ `tabs-harness.jsx`/`.html`) | **Not reusable for this page.** | The Owner's item 3 ("should not depend on numerous tabs") directly conflicts with the tab-shell approach PR #159 built. The component itself (a correct, accessible, reusable ARIA tablist) is not *wasted* -- it remains available for some *other* future multi-tab surface in this codebase if one is ever needed -- but must not be assumed as this page's navigation pattern. Collapsible sections (item 7) are a different, simpler interaction (e.g. native `<details>`/`<summary>` or a plain expand/collapse button), not a tablist. |
| `AccountDetail.jsx`'s specific header/tab-shell wiring | **Not reusable structurally**, but its header content decisions (status badge, customer number, billing address line, primary-contact summary, tags, Edit action) are a reasonable starting point for the new "Account Summary" section -- the *data* and *derivations* carry over, the *container* (tab shell) does not. |
| `index.css`'s `.fo-tablist`/`.fo-tab`/`.fo-tab-active` | **Dead weight if the tabs approach is dropped** -- would need removal or repurposing, not reuse. `.acct-detail-grid`/`.fo-form-field` remain reusable (generic 2-column/labeled-field patterns, no tab dependency). |
| `verify-customer-record-page` test infra (`CUSTOMER_FIXTURE`, `seed.mjs`/`driver.mjs` additions) | **Partially reusable.** `CUSTOMER_FIXTURE`'s account/location/contact seed data is reusable for testing the new page. The Tabs-specific assertions (ARIA contract, keyboard nav, multi-instance, invalid-fallback) become moot if this page drops tabs entirely. |

**Net finding:** roughly half of PR #159's substance (the address/contact-derivation domain layer) survives a redesign untouched; the tab shell itself -- the single largest and highest-risk piece of PR #159 (the first-ever Tabs implementation, extensively verified) -- does not fit the new direction and would need to be replaced with a sectioned layout.

## Adopted Account page hierarchy

All six sections below are established by the Owner's request and this assessment's resolved architecture -- none remain undecided. Exact responsive layout, spacing, and component breakdown are Specification-stage details, not open product decisions.

In reading order:

1. **Account Summary** -- name, status, **relationship-type badges** (`CUSTOMER`/`VENDOR`, either or both, rendered directly here -- **not a separate section**, per the resolved architecture decision below), customer number if present, billing address (one line, `formatAddress()`), primary-contact summary (`primaryContactState()`, reused as-is), tags, one Edit action. Always visible, never collapsed.
2. **Financial Summary** (renamed from this assessment's earlier "Sales Summary", per the resolved architecture decision below) -- a **provider-neutral surface**. Supports either an external financial provider or a governed local ledger through the Framework's common Financial Provider Contract (Section 17) -- **this Customer-page initiative builds the surface and its states, not either provider** (that is separate future scope). Until a provider is configured, renders the Framework's exact **"Sales data source not connected"** copy (Section 17/20) -- never a fabricated `$0.00`. Once `complete` for a given metric/scope/`asOf`, renders each configured canonical metric explicitly (see the corrected genuine-zero example in "Empty/loading/error states" below) -- never a bare "Sales" figure, and never a metric the connected provider doesn't actually supply.
3. **Contacts** -- existing Contact list + "+ Add Contact", as a readable section (not a tab). Reuses `primaryContactState()`'s MULTIPLE-primary warning.
4. **Locations** -- existing Location list + "+ Add Location", reusing `addressRows()`/`AddressFields` as-is.
5. **Service Activity** -- **two related but distinct presentation elements, both scoped to the same Account's Work Orders, each backed by its own distinct query (Section h) -- never merged into one shared query:**
   - **Summary counts** -- `Completed Work Orders` / `Open Work Orders` (the Framework's operational-count metrics, Section 3), shown above the list, sourced from their own separate aggregate `count()` queries, **never recomputed or summed from the timeline's currently loaded pages.** **Additional to Financial Summary, never an alternative implementation of it** -- these counts never appear under, substitute for, or get relabeled as Financial Summary content.
   - **Account Activity timeline** -- the chronological list itself: each Work Order's date, status, and an exact drill-down link, newest-first, paginated (see Section h's index/deployment sequencing), sourced from the bounded paginated query. This is the timeline's actual content; the summary counts above are not a substitute for it, and it is not a substitute for them.
   - Needs its own empty state ("No activity yet for this Account") distinct from a data-fetch error, per "Empty/loading/error states" below.
6. **Notes / Identifiers** -- `notes`, `tags` (if not already shown in Summary), and the four external-identifier fields (`customerNumber`/`erpId`/`accountingId`/`legacyId`), collapsed by default -- the one section explicitly suited to collapsing, per item 7 of the Owner's original request ("collapsible only where it improves usability") (these are low-frequency, integration-only fields, exactly PR #159's existing collapse precedent for this same field group).

Sections 3, 4, 5 read top-to-bottom on the page; only 6 is collapsed-by-default, consistent with the Owner's instruction that collapsing should be the exception, not the default page shape.

## Resolved architecture and product decisions (Architecture Review, this revision)

These were open questions in the assessment's prior revision; the corrections below resolve them rather than forwarding them into the Specification.

1. **Financial Summary architecture (was Owner Decision #1):** the Account page includes a **provider-neutral Financial Summary surface**, supporting either an external financial provider or a governed local ledger through the Framework's common contract (Section 17) -- neither is assumed, and **this Customer-page initiative does not build either provider**; connecting a real financial provider (of either mode) is a **separate future initiative**. This lets the Account page proceed now without forcing every future deployment into Taylor Parts' own storage choice. Until a provider is configured, the surface renders "Sales data source not connected." **Service Activity (item 5 above) is an additional operational section, never an alternative implementation of Financial Summary** -- the two are never merged, relabeled as each other, or presented as substitutes.
2. **Relationship-type field shape and behavior (was Owner Decision #2):** `relationshipTypes: ["CUSTOMER", "VENDOR"]` on `Account` (either value, or both). **Informational only in this phase** -- it does not gate authorization and does not hide or show any page section (Financial Summary and Service Activity both render identically regardless of an Account's relationship types).
3. **Relationship-type placement (was Owner Decision #3):** rendered as badges inside Account Summary (item 1 above) -- **not a separate page section.**
4. **Vendor relationship depth (was Owner Decision #5):** "vendor" means **company-identity classification only** for this phase. Linking or replacing the existing internal `Supplier` procurement dataset (Section f) remains **separate future scope**, not implied or authorized by adding this field.
5. **PR #159's disposition (was the assessment's last open Owner decision, now resolved):** PR #159 remains paused and **must never merge as-is**. It is **preserved, not closed**, until the superseding Specification and Implementation Plan are merged, so the reusable pieces identified above (`domain/address.js`, `AddressFields.jsx`, `primaryContactState()`) can be referenced precisely against a real, citable commit. **Once that Specification and Implementation Plan are merged, PR #159 is closed unmerged** -- its branch/history preserved unless the Owner separately requests branch deletion. **PR 2 of the old plan remains cancelled/not started.** **The new Specification explicitly supersedes** `docs/specifications/customer-record-page-structured-address.md` and `docs/implementation-plans/customer-record-page-structured-address.md` (both via PR #120) -- the Specification's own frontmatter should mark `supersedes` accordingly when it's written.

## Owner decisions still required

None remaining. All product decisions this assessment identified are resolved above (see "Resolved architecture and product decisions"). No unresolved product decision blocks the new Specification.

## Empty/loading/error states (definitions, for a future Specification)

Financial Summary's states are the Framework's own five-state provider contract (`docs/architecture/enterprise-business-metrics-framework.md` Section 17), not this assessment's own invention -- restated here in Taylor-Parts-specific terms:

- **`unconfigured`** (today's actual state, and the state until a future, separate initiative connects a provider -- external or governed local ledger): the Framework's exact copy, **"Sales data source not connected"** -- never a fabricated `$0`/`0 sales` that could be misread as a true zero.
- **loading:** standard loading text, matching this codebase's existing `LoadingEmptyState`/`fo-muted "Loading..."` convention -- not one of the Framework's five states itself, but the transient state before one of them resolves.
- **`error`:** "Sales data temporarily unavailable" -- a provider is configured but the current sync/read failed, distinct from `unconfigured`.
- **`stale`:** "Sales data may be stale as of [time]" -- a provider is configured and has data, but it is older than the deployment's freshness threshold.
- **`partial`:** a "partial data" warning attached to the specific figure it qualifies, with the missing portion shown as unavailable (not `$0`) and drill-down showing what was included vs. excluded (Framework Section 17's full `partial` contract) -- relevant once a provider exists and a sync is incomplete for some date range/metric.
- **`complete`** (**correction, Architecture Review**): renders **each configured canonical metric explicitly**, not a single undifferentiated "no sales" sentence -- doing so would reintroduce the exact standalone "Sales"/"Pending" ambiguity the Framework prohibits (Section 4/5). A legitimate `$0` is shown per metric only when completeness is actually known for that metric/scope/`asOf`, and only for metrics the connected provider actually supplies -- never an invented lifecycle stage the provider doesn't report. Example rendering for a fully-`complete`, genuinely-empty Account:
  ```
  Booked Value: $0
  Invoiced Net Sales: $0
  Cash Collected: $0
  Complete through [asOf]
  ```
  **Correction (Architecture Review): an unsupported metric must never be silently omitted.** If the connected provider only supplies, say, Invoiced Net Sales and Cash Collected (no Sales Order/Quote integration), the surface must explicitly disclose its configured metric scope -- silent omission risks being mistaken for a true zero or overlooked data, which conflicts with the Framework's rule that unavailable prerequisites are never silently omitted. Corrected example for that same provider configuration:
  ```
  Invoiced Net Sales: $0 -- complete through [asOf]
  Cash Collected: $0 -- complete through [asOf]
  Booked Value: unavailable -- this provider does not supply Sales Orders
  Open Pipeline: unavailable -- this provider does not supply Opportunities
  ```
  A metric may be absent from the rendered list only when the UI has explicitly identified, in this same block, which canonical metrics are configured for that deployment -- a metric must never simply not appear with no explanation.
- **Service Activity summary counts, loading/empty/error:** its own three-way split -- loading, `0`/`0` (a legitimate, always-computable count, not an unavailable-data case, since it reads directly from `fieldops_wos`'s dedicated aggregate `count()` queries with no external-provider dependency), and a distinct error state if either count query itself fails (network/permission). **These states are independent of the timeline's own loading/error/pagination state below** -- the two never share a query, and never share loading/error/pagination/result state. They do share the same authoritative collection and Account scope (`fieldops_wos` filtered by `customerId`), just not the same query or state.
- **Account Activity timeline, loading/empty/error:** **correction (Architecture Review): the timeline and the summary counts share the same authoritative collection and Account scope (`fieldops_wos` filtered by `customerId`), never the same query.** They use distinct Firestore queries -- counts via independent aggregate queries, the timeline via the bounded, ordered, cursor-paginated query -- and never share loading, error, pagination, or result state. The timeline's own states: loading, "No activity yet for this Account" (genuine zero, i.e. the query legitimately returns no Work Orders), and a distinct error state, never silently rendering an empty list indistinguishable from "no activity." Neither Service Activity element uses the Financial Summary provider-state contract -- `fieldops_wos` is always either present or erroring, never "unconfigured" in the financial-provider sense.
- **Relationship-type badges, unset:** an Account with no relationship type recorded should render as genuinely blank/omitted (matching this codebase's established "never fabricate a value for missing data" convention, e.g. `domain/address.js`'s `null`-for-missing-address precedent), not default to "Customer" silently.

## Risks

- **A Work Order count is never a Financial Summary figure, per the Framework -- it must never be presented under that heading at all, proxy or otherwise.** A completed Work Order is evidence of service *performed*, not proof of a *sale* (no price, no payment confirmation, no invoice). `Completed Work Orders`/`Open Work Orders` belong under Service Activity only (item 5 above), never under Financial Summary (item 2), even labeled as an approximation. A dollar-denominated figure can only come from a connected financial provider (Section h(i)) -- there is no permitted proxy.
- **The Account Activity timeline requires a new composite index** (`fieldops_wos(customerId ASC, createdAt DESC)`) that does not exist today, sequenced through its own prerequisite PR with separate Owner Merge and Deployment Authorization, confirmed `[READY]` before the Activity UI merges (Section h/e) -- not a pure UI change, and not a same-PR addition to whatever PR builds the Financial Summary surface or the Account page shell.
- **Reworking PR #159 discards real, reviewed work** (the Tabs component, its 37-assertion verification suite) even though it is not wasted in an absolute sense (Tabs.jsx itself remains available for other future uses) -- the Owner should weigh this against the cost of continuing to ship a page shape they've now said doesn't fit the product.
- **Issue #140 conflation risk**, explicitly flagged by the Owner: nothing in this assessment's findings actually calls for touching Issue #140's data-ownership/export scope; confirmed no genuine overlap, so it is intentionally not linked into this initiative's scope.

## Adopted disposition for PR #159 and PR #120's prior plan (Architecture Review, this revision)

**Do not merge PR #159 as-is.** Its tabbed shell directly conflicts with the Owner's now-stated direction (item 3). Adopted disposition (resolved decision 5 above) -- not pending, not a recommendation awaiting confirmation:

- **PR #159 remains paused and must never merge as-is.**
- **Preserve PR #159 until the superseding Specification and Implementation Plan are merged**, so the reusable pieces identified above (`domain/address.js`, `AddressFields.jsx`, `primaryContactState()`) can be referenced precisely against a real, citable commit.
- **Then close PR #159 unmerged** -- not delete the branch/history; a closed PR remains readable and linkable, and its branch/history is preserved unless the Owner separately requests branch deletion.
- **PR 2 of the old plan remains cancelled/not started.**
- **The new Specification explicitly supersedes** `docs/specifications/customer-record-page-structured-address.md` and `docs/implementation-plans/customer-record-page-structured-address.md` (both via PR #120) -- the Specification's own frontmatter marks `supersedes` accordingly when it's written; this assessment's own `depends_on` (the prior direction this assessment investigates a change from) is unchanged, since superseding is a Specification-stage action.
- **Do not discard the reusable pieces** identified above -- a follow-up Implementation Plan should explicitly carry them forward rather than rewriting them, and should treat `Tabs.jsx` as available-but-unused for this specific page rather than deleting a correct, verified component outright (a separate, smaller decision the Owner can make when convenient, not blocking).
- Issue #158 remains the tracking issue; update its title/description once the new Specification lands, since "Implementation Tracking (PR 1 & PR 2)" no longer accurately describes the now-changed scope.
