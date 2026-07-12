---
artifact_type: assessment
gate: Repository Assessment
status: Pending Review
date: 2026-07-12
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/customer-record-page-structured-address.md, docs/specifications/customer-record-page-structured-address.md, docs/implementation-plans/customer-record-page-structured-address.md]
implements: []
supersedes: []
superseded_by: []
related_pr: 161
target_release: Post-Release 2.1 (Inventory -> Procurement chain)
---

# Assessment Report: Customer/Account Business Model -- Dual Customer/Vendor Role, Sales Summary, Account Activity

**Business Request:** Issue #158. The Owner has clarified the Account business model and information architecture after PR #159 (PR 1 of 2, the tabbed header/Details/Locations/Contacts shell) was already implemented and Final-Reviewed under the prior direction (`docs/specifications/customer-record-page-structured-address.md`, `docs/implementation-plans/customer-record-page-structured-address.md`, both via PR #120):

1. "Customers" are Accounts.
2. An Account may represent a customer, a vendor, or both -- do not create duplicate company records merely because the relationship differs.
3. The Account page should not depend on numerous tabs.
4. Contacts should appear as an Account-owned listing/section.
5. The page needs an Account Activity section aligned to the company's business history.
6. The page needs sales information: completed/recognized sales, pending sales, and links/drill-down to the records behind those totals.
7. Locations, contacts, identifiers, notes, and activity should be organized as readable page sections, using collapsible sections only where they improve usability.

**Architecture Review: PENDING.** This assessment has not yet been reviewed or approved. No implementation should begin against it -- PR #159 remains paused, PR 2 has not begun, and this assessment does not itself authorize any code, schema, Rules, index, or production-data change.

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

If Work Order is adopted as the sales-history proxy (see Risks below on why this is a proxy, not a true sale), its real `WorkOrderStatus` lifecycle (`types/workOrder.ts`) is:

- **Completed/terminal:** `COMPLETED`, `CLOSED`.
- **Pending/in-flight:** `CREATED`, `READY_TO_DISPATCH`, `SCHEDULED`, `DISPATCHED`, `ACCEPTED`, `EN_ROUTE`, `ARRIVED`, `WORK_IN_PROGRESS`.
- **Terminal but not a sale:** `CANCELLED` -- must be excluded from both completed and pending counts, not folded into either.

(A separate, older `JOB_STATUS` enum -- `open`/`assigned`/`in_progress`/`complete`, `fieldops_jobs` collection -- also exists and also has no monetary field; not investigated further since Work Order is the entity actually linked to `accountId`/`customerId`.)

### d. Whether monetary totals exist and which amount field is authoritative

**No monetary field exists on Work Order at all.** `types/workOrder.ts`'s full `WorkOrder` interface was read in its entirety: `id`, `woNumber`, `status`, `priority`, `severity`, `type`, `customerId`, `locationId`, `assignedTechId`, five scheduling/execution timestamps, `complaint`/`diagnosis`/`resolution`, `laborHours` (a quantity, not currency), an optional non-authoritative `inventorySnapshot` (parts planned/used, no price), and `executionLog`. **No `price`/`cost`/`amount`/`total`/`revenue` field anywhere.** `functions/src/createWorkOrder.ts` confirms the same field set at the write path.

The only real monetary totals anywhere in the repository are on the **procurement (spend) side**, not sales: `RawPurchaseOrder.totalCost` (`services/operationsQueries.ts`, the existing `purchase_orders` collection, Admin-SDK-only, Supplier-linked -- money the business pays *out*), and `procurementBridge.ts`'s `estimatedUnitPrice`/`estimatedTotalCost` (reorder cost estimation against `supplier_catalog` pricing, also spend-side). **Neither is connected to an Account, and neither represents revenue.**

**Conclusion: there is no authoritative sales/revenue amount field anywhere in this codebase today.**

### e. Which entities can form the Account Activity timeline

**Work Order is the only real candidate**, via `customerId` -- but **no existing query fetches Work Orders by `customerId`/`accountId` anywhere in the repository** (confirmed: zero `where("customerId", ...)` or `where("accountId", ...)` call sites against the Work Order collection; `workOrderService.ts`'s `onSnapshot` reads the whole `fieldops_wos` collection unfiltered for its own list views). Building an Account Activity timeline from Work Orders requires **a new query/hook** (a single-field equality filter, `where("customerId", "==", accountId)` -- no composite index needed on its own, per the same reasoning already established for `reorder_requests`' hooks).

No other entity references `accountId`/`customerId` except Location and Contact (already read/rendered by PR #159), and Reorder Request (Part-linked only, never Account-linked -- not a candidate).

### f. How vendor relationships are currently represented, if at all

**Not represented at all, and not connected to Account in any way.** `Supplier` is a real, existing, **separate** entity (`suppliers`/`supplier_catalog` collections, `docs/BusinessEntityModel.md` Section 3/Section 8's relationship diagram: `Supplier -- 1:many -- Purchase Order -- many:many -- Part`) with its own shape (`RawSupplier: { id, name, contactEmail, leadTimeDays }`) and is **Admin-SDK-only** -- `firestore.rules` denies all client `create`/`update`/`delete` on `suppliers`/`supplier_catalog`/`purchase_orders` unconditionally (`allow create, update, delete: if false`), read-only for admin/dispatcher. There is no `accountId` field on `Supplier`, no `supplierId` field on `Account`, and no code anywhere linking the two.

Separately, `reorder_purchase_orders.supplierName` (Section 4b) is manually-entered free text, explicitly documented as "no Supplier/Vendor Management object, no vendor catalog... yet" -- also disconnected from both `Account` and the real `Supplier` entity.

**A "this Account is also a vendor" relationship, as the Owner now wants, has zero existing representation to build on.** It would need to be modeled fresh -- most likely as a field/flag on `Account` itself (see below), not by reusing the existing `Supplier` entity, which is a different, Admin-SDK-only, internal procurement dataset with no product surface for editing vendor company records at all.

### g. Whether an Account relationship-type field already exists

**No.** `domain/accounts.js`'s full documented `Account` shape: `{ id, name, billingAddress?, status?, notes?, tags?, customerNumber?, erpId?, accountingId?, legacyId?, createdAt, updatedAt }`. `domain/constants.js` defines only `ACCOUNT_STATUS` (`Active`/`Inactive`/`Prospect`/`Archived`) -- no `ACCOUNT_TYPE`, `RELATIONSHIP_TYPE`, `isVendor`, `isCustomer`, or equivalent constant or field exists anywhere.

### h. Schema/Rules/index/migration impact this direction would require

- **Account relationship-type field (customer/vendor/both):** a **new, optional field on `accounts`** (e.g. `relationshipTypes: string[]`, values `CUSTOMER`/`VENDOR`). `firestore.rules`' `accounts` match block has **no field-level validation today** (confirmed by direct read, lines 823-827) -- adding this field needs **no Rules change** to merely allow it, the same way `tags`/`notes`/the four external-identifier fields were added without a Rules change. No index needed unless a future "list all Vendors" filtered view is built (a single-field array-contains query would need its own index at that point, not now). **No migration is required** -- existing Accounts simply have no value for the new field until edited; nothing needs backfilling to keep working, since nothing reads this field today.
- **Sales Summary (completed/pending totals + drill-down):** **no schema exists to source this from.** Two real options, not decided here:
  - **(i) Build a real Invoice/Sale entity now** -- this is exactly `docs/BusinessEntityModel.md` Section 2's **Invoice**, currently Future/unbuilt. Bringing it forward is genuine schema/data-architecture work: a new collection, new Rules, a write path, a real amount field, and a decision about who creates these records and when (nothing in this repository today ever computes or stores a price for a completed Work Order). This is the only way to show a truthful monetary total.
  - **(ii) Proxy "sales" as Work Order counts/status**, not dollars -- e.g. "12 completed engagements, 3 pending" instead of a currency total. This satisfies "completed/pending" and "drill-down to the records" but **does not satisfy "monetary totals"** if the Owner means actual dollar amounts -- flagged as an open question below, not assumed.
  - Either path needs the new `customerId`-filtered Work Order query from (e) above; (i) additionally needs a new collection + Rules + write path (Tier 2-shaped: new collection, new Rules -- `docs/DelegationCharter.md`'s "changes to firestore.rules that alter who can read or write what" is Tier 2).
- **Account Activity timeline:** the new `customerId`-filtered Work Order query from (e). No Rules change (existing `fieldops_wos` read rule already covers admin/dispatcher, unchanged). No index needed for the single-field filter alone; if the Activity section later adds a second filter (e.g. status) or an `orderBy`, a composite index may become necessary at that point -- not assumed needed now.
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

## Proposed Account page hierarchy (recommendation, not a decision)

Per the Owner's requested structure, in reading order:

1. **Account Summary** -- name, status, relationship type(s) badge(s) (Customer/Vendor/Both, once the new field exists), customer number if present, billing address (one line, `formatAddress()`), primary-contact summary (`primaryContactState()`, reused as-is), tags, one Edit action. Always visible, never collapsed.
2. **Relationship Types** -- could be folded into Account Summary as a badge row rather than a separate full section, given it's a small, always-relevant fact, not a body of content needing its own scroll region. Recorded as an open question below rather than decided here.
3. **Sales Summary** -- completed count/total and pending count/total (pending the Owner's decision on (i) real Invoice entity vs. (ii) Work Order count proxy, per Section h above), each linking/drilling down to the underlying Work Order records. **Must have an honest empty/no-data state** (see below) given no authoritative source exists today -- must not render a fabricated `$0.00`.
4. **Contacts** -- existing Contact list + "+ Add Contact", as a readable section (not a tab). Reuses `primaryContactState()`'s MULTIPLE-primary warning.
5. **Locations** -- existing Location list + "+ Add Location", reusing `addressRows()`/`AddressFields` as-is.
6. **Account Activity** -- the new `customerId`-filtered Work Order query (Section e), rendered as a chronological history (status, date, drill-down link to the Work Order). Needs its own empty state ("No activity yet for this Account") distinct from a data-fetch error.
7. **Notes / Identifiers** -- `notes`, `tags` (if not already shown in Summary), and the four external-identifier fields (`customerNumber`/`erpId`/`accountingId`/`legacyId`), collapsed by default -- the one section explicitly suited to collapsing, per item 7's "collapsible only where it improves usability" (these are low-frequency, integration-only fields, exactly PR #159's existing collapse precedent for this same field group).

Sections 4, 5, 6 read top-to-bottom on the page; only 7 is proposed as collapsed-by-default, consistent with the Owner's instruction that collapsing should be the exception, not the default page shape.

## Empty/loading/error states (definitions, for a future Specification)

- **Sales Summary, no authoritative source configured** (today's actual state, until Section h's decision is made): an explicit message distinct from both "loading" and "zero sales" -- e.g. "Sales tracking is not yet connected for this Account" -- never a fabricated `$0`/`0 sales` that could be misread as a true zero.
- **Sales Summary, loading:** standard loading text, matching this codebase's existing `LoadingEmptyState`/`fo-muted "Loading..."` convention.
- **Sales Summary, genuine zero** (once a real source exists and legitimately has no records for this Account): a distinct "No completed or pending sales yet" state -- different copy from the no-source-configured state above, so a user can tell "nothing has happened yet" apart from "this feature isn't wired up."
- **Account Activity, loading/empty/error:** same three-way split -- loading, "No activity yet for this Account" (genuine zero), and a distinct error state if the new `customerId` query itself fails (network/permission), never silently rendering an empty list indistinguishable from "no activity."
- **Relationship Types, unset:** an Account with no relationship type recorded should render as genuinely blank/omitted (matching this codebase's established "never fabricate a value for missing data" convention, e.g. `domain/address.js`'s `null`-for-missing-address precedent), not default to "Customer" silently.

## Risks

- **"Sales" is currently a proxy, not a fact, if Work Order is used without a real Invoice entity.** A completed Work Order is evidence of service *performed*, not proof of a *sale* (no price, no payment confirmation, no invoice) -- presenting a Work Order count as "Sales Summary" without a monetary total risks materially misrepresenting the Owner's actual request. This is the single most consequential open question in this assessment (see below).
- **No `customerId`-filtered Work Order query exists today.** Building the Account Activity section (and any Work-Order-based Sales proxy) is not a pure UI change -- it requires a new Firestore query/hook, which is real, if modest, engineering work, not a copy-paste of an existing pattern.
- **The Account relationship-type field, if it ever gates *behavior* (e.g. hiding Sales Summary for a vendor-only Account, or hiding a future Vendor-specific section for a customer-only Account), starts to look like a data-model branch, not just a display label** -- worth deciding explicitly whether relationship type is informational-only in this phase or actually changes what renders.
- **Reworking PR #159 discards real, reviewed work** (the Tabs component, its 37-assertion verification suite) even though it is not wasted in an absolute sense (Tabs.jsx itself remains available for other future uses) -- the Owner should weigh this against the cost of continuing to ship a page shape they've now said doesn't fit the product.
- **Issue #140 conflation risk**, explicitly flagged by the Owner: nothing in this assessment's findings actually calls for touching Issue #140's data-ownership/export scope; confirmed no genuine overlap, so it is intentionally not linked into this initiative's scope.

## Owner decisions required

1. **Sales Summary data source (Section h):** build a real Invoice/Sale entity now (schema/Rules/write-path work, Tier 2), or proxy "sales" as Work Order completion counts (no dollar total, smaller scope, but does not literally satisfy "monetary totals")? This is the highest-leverage decision -- it determines whether Sales Summary is buildable at all in the near term.
2. **Relationship Types field shape and behavior:** a simple `relationshipTypes: string[]` badge (informational only), or should it gate what sections/behavior appear (e.g. hide Sales Summary for a vendor-only Account)?
3. **Relationship Types placement:** its own page section, or folded into Account Summary as a badge row (recommended above, not decided)?
4. **PR #159's disposition** (see recommendation below) -- confirm before any further code work begins.
5. **Vendor relationship depth:** is "Account may represent a vendor" purely a company-identity flag for this phase, or does it imply linking to/replacing parts of the existing internal `Supplier` procurement dataset? This assessment assumes the former (flag only) and recommends treating any deeper linkage as explicitly out of scope unless the Owner says otherwise.

## Recommendation for PR #159 and PR #120's prior plan

**Do not merge PR #159 as-is.** Its tabbed shell directly conflicts with the Owner's now-stated direction (item 3). Recommended disposition, pending Owner confirmation:

- **Close PR #159 without merging** (not delete the branch/history -- closed PRs remain readable and linkable) once a new Specification/Implementation Plan for the sectioned page exists, citing this assessment and the closed PR for context on what was tried and why it changed.
- **Supersede `docs/specifications/customer-record-page-structured-address.md` and `docs/implementation-plans/customer-record-page-structured-address.md`** (both via PR #120) with a new Specification/Implementation Plan reflecting the Owner decisions above -- this assessment's own frontmatter lists both as `depends_on` (the prior direction this assessment investigates a change from), not yet marked `supersedes` since that is a Specification-stage action requiring the Owner decisions above to be resolved first, not something this Assessment should presume.
- **Do not discard the reusable pieces** identified above (`domain/address.js`, `AddressFields.jsx`, `primaryContactState()`) -- a follow-up Implementation Plan should explicitly carry them forward rather than rewriting them, and should treat `Tabs.jsx` as available-but-unused for this specific page rather than deleting a correct, verified component outright (a separate, smaller decision the Owner can make when convenient, not blocking).
- Issue #158 remains the tracking issue; update its title/description once the Owner's decisions above land, since "Implementation Tracking (PR 1 & PR 2)" no longer accurately describes the now-changed scope.
