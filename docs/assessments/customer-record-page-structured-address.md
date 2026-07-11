---
artifact_type: assessment
gate: Repository Assessment
status: Architecture-Approved
date: 2026-07-11
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr: 120
target_release: Post-Release 2.1 (Inventory → Procurement chain)
---

# Assessment Report: Customer Record Page and Structured Address Experience

**Business Request:** Rudy supplied Salesforce-style screenshots as information-architecture references and asked for a redesigned Customer record page — strong header, immediately-visible summary fields, tabs for Details and related records, two-column detail layout, and addresses displayed/edited as distinct fields rather than one collapsed line. Explicit instruction: use the screenshots for structure only, never copy Salesforce branding or visual assets, and use this repository's own Field Ops design system and accessibility conventions instead.

## Scope of this assessment

Covers the `Account` (UI-labeled "Customer") record page, its `Location`/`Contact` related records, and the address shape both `Account.billingAddress` and `Location.address` use. Explicitly does **not** cover: Work Orders, Invoices, Service Contracts, or any other future tab's actual data model (assessed as tab candidates only, per the Business Request); the Parts and Purchase Order Assignment Adoption initiative; the Reorder Request Cancellation/Void initiative (PR #108); or any other in-flight work. No code, schema change, migration, or deployment is authorized by this assessment.

## Current repository state

Verified directly against `main` (commit `9c05af0` at time of writing):

- **`Account` is internally named `Account`, UI-labeled "Customer"** throughout, per `docs/BusinessEntityModel.md` Section 10 ("Internal collection/type name: `accounts`. UI/navigation label: 'Customers'"). Confirmed in code: `field-ops-app-vite/src/domain/accounts.js`, `AccountDetail.jsx`, `AccountForm.jsx`.
- **`field-ops-app-vite/src/modules/accounts/AccountForm.jsx`** (`domain/accounts.js:31-52`, `AccountForm.jsx:11-53`) already stores `billingAddress` as exactly `{ street, city, state, zip }` — confirmed at `AccountForm.jsx:44` (`billingAddress: hasAddress ? { street: trimmedStreet, city: trimmedCity, state: trimmedState, zip: trimmedZip } : null`). Four separate `<input>` elements already exist for these fields (`AccountForm.jsx:67-70`) — the fields are already structured in the form UI, not a single free-text field; the collapsing into one line happens only on **display**, not on input.
- **`field-ops-app-vite/src/modules/accounts/AccountDetail.jsx:142-148`** collapses `billingAddress` into one comma-separated `<div>` line: `[account.billingAddress.street, account.billingAddress.city, account.billingAddress.state, account.billingAddress.zip].filter(Boolean).join(", ")`. Same collapsing pattern repeated for each Location's `address` at `AccountDetail.jsx:161-163`.
- **`Location` (`domain/locations.js:5`) already uses the identical shape**: `{ id, accountId, name, address: { street, city, state, zip }, accessNotes?, createdAt, updatedAt }`. `AccountDetail.jsx`'s inline `LocationForm` (lines 19-52) already collects these as four separate inputs, same pattern as `AccountForm`.
- **The current Customer Detail page is a single flat panel** (`AccountDetail.jsx`, entire file, 197 lines) — no tabs, no routing sub-structure. The file's own header comment (lines 11-18) states this explicitly: "Future tabs (Overview/Locations/Contacts/Timeline/Work Orders/Invoices) are documented as a future shape, not built this sprint — this file is a single flat panel, not a tab shell." This is Sprint 2.0.2 (Customer Foundation)'s deliberate, documented scope boundary, not an oversight.
- **Therefore the initial change here is a UX evolution of an already-structured address, not a migration from one free-form field.** `street`/`city`/`state`/`zip` already exist as four distinct, independently-editable form inputs and four distinct stored document keys on both `Account.billingAddress` and `Location.address` — nothing needs to be "split" at the data layer to display them as distinct fields; `AccountDetail.jsx`'s display logic is the only thing collapsing them today.
- **`Account` schema, as actually implemented** (`domain/accounts.js:16-18`): `{ id, name, billingAddress?, status?, notes?, tags?, customerNumber?, erpId?, accountingId?, legacyId?, createdAt, updatedAt }`. `customerNumber` already exists (reserved for future integrations, per that file's comment — not currently displayed anywhere in `AccountDetail.jsx`). **No `phone`, `website`, `industry`, `accountOwner`, or `contractManager` field exists anywhere in this schema.** `ACCOUNT_STATUS` (`domain/constants.js:52-57`) is `Active`/`Inactive`/`Prospect`/`Archived` — a status, not a "type" in the CRM-record-type sense.
- **`Contact` already has an `isPrimary` boolean** (`AccountDetail.jsx`'s inline `ContactForm`, line 58/64/73-75) — a "primary Contact" concept already exists and is already displayed (`AccountDetail.jsx:183`, a badge). **`Location` has no equivalent `isPrimary` field** — "primary Location" does not exist today.
- **No tab-based UI pattern exists anywhere in this codebase.** Searched the full `field-ops-app-vite/src` tree for `role="tab"`, a `Tabs` component, or any `TabPanel`-shaped convention — none found. This would be a genuinely new interaction pattern for this app, not a reuse of an existing one.
- **A responsive two-column-to-one-column CSS precedent already exists**: `field-ops-app-vite/src/index.css:394-400`, `.disp-board-layout { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 16px; } @media (max-width: 900px) { .disp-board-layout { grid-template-columns: 1fr; } }` (Dispatcher Board). Not a two-column shape, but proves the "grid collapses to one column below a breakpoint" pattern is already established and reusable.
- **`firestore.rules`' `accounts`/`locations`/`contacts` match blocks (`firestore.rules:685-701`) have no field-level schema enforcement at all** — `allow create, update: if isAdminOrDispatcher()`, no `hasOnly()`/`hasAll()`/key-shape validation of any kind, unlike `reorder_requests`' exact-key gate (`hasCanonicalReorderRequestKeys()`). This is a materially different, and materially simpler, migration situation than the Cancel/Void initiative's schema-deployment-sequence problem (PR #108) — there is no exact-key gate here that could reject a partially-migrated document shape. Both old-shape and new-shape address documents can coexist under the current Rules with zero Rules change required for either Option A or Option B below.
- **No documented accessibility convention exists in this repository** (checked `docs/DEVELOPMENT_STANDARDS.md`, `docs/GuidingPrinciples.md` — no hits for "accessib"/"aria"/"screen reader"). The closest existing precedent is `field-ops-app-vite/src/shared/assignment/EmployeeAssignmentPicker.jsx`'s actual ARIA combobox wiring (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, per-instance unique IDs via `useId()`) — the best real example to follow, not a written standard to cite.
- **Every Account/Location read already uses `onSnapshot()`**, not one-shot reads (`hooks/useAccount.js:21`, `hooks/useLocationsForAccount.js:24`) — this project's established standard (see PRs #73/#74's precedent elsewhere in this codebase). Any new tabbed data-fetching must preserve this.
- **No standalone Locations or Contacts list/detail page exists** — both are only ever shown nested inside `AccountDetail.jsx` (`domain/locations.js:13-15`, `AccountDetail.jsx`'s header comment). A "Locations" or "Contacts" tab in the redesigned page is a new *presentation* of already-fetched data (`useLocationsForAccount`/`useContactsForAccount` already exist and are already called from `AccountDetail.jsx`), not a new query or a new route.

## Affected files

| File | Current role | Why it's affected |
|---|---|---|
| `field-ops-app-vite/src/modules/accounts/AccountDetail.jsx` | Single flat panel: header, inline billing-address line, inline Locations list + add-form, inline Contacts list + add-form | Becomes the tabbed record page — header + summary redesign, Details/Locations/Contacts tab split, two-column Details layout |
| `field-ops-app-vite/src/modules/accounts/AccountForm.jsx` | Edit form: name/status/billing address (4 inputs)/notes/tags/external IDs (collapsible) | Reorganized into the "Customer Information / Billing Address / External Identifiers / Notes and Tags" sections; billing-address inputs replaced by the new shared address form component |
| `field-ops-app-vite/src/domain/accounts.js` | `Account` schema comment, `createAccount()`/`updateAccount()` | Schema comment updated if Option B (canonical shape) is selected; write functions unchanged either way (already pass through whatever shape is given) |
| `field-ops-app-vite/src/domain/locations.js` | `Location` schema comment, `createLocation()`/`updateLocation()` | Same as above, for `Location.address` |
| A new shared address form component (location TBD, e.g. `field-ops-app-vite/src/shared/address/AddressForm.jsx`) | Does not exist yet | New reusable component both Account billing-address editing and Location address editing must consume, per the Business Request's explicit requirement that both use "the same reusable form component and formatting utility" |
| A new address-formatting utility (e.g. `field-ops-app-vite/src/domain/address.js`) | Does not exist yet — formatting is currently inlined twice (`AccountDetail.jsx:144`, `:162`) | Single source of truth for turning a stored address shape into a display string, replacing both inline `.filter(Boolean).join(", ")` call sites |
| `docs/BusinessEntityModel.md` | Documents `Account`/`Location`/`Contact` schemas (Sections 3, 10) | Needs the canonical address contract (if Option B) or the retained-shape decision (if Option A) documented |
| `firestore.rules` (both copies) | `accounts`/`locations`/`contacts` match blocks, currently no field-level validation | Only affected if a future decision adds field-level validation to these collections — not required by either Option A or Option B on their own, since no such validation exists to migrate away from |

## Dependencies

- **No dependency on, or conflict with, PR #107, PR #108, or Issue #118** — different collections (`accounts`/`locations`/`contacts` vs. `reorder_requests`/`reorder_purchase_orders`), different UI module (`modules/accounts/` vs. `modules/inventory/`). Sequenced after them per the Owner's explicit roadmap placement (see below), not because of a technical dependency.
- **Depends on this repo's existing `onSnapshot()` standard, `EmployeeAssignmentPicker.jsx`'s ARIA precedent, and `.disp-board-layout`'s responsive-grid precedent** — all three should be reused, not reinvented.
- **No dependency on Firebase Blaze / Cloud Functions** — `accounts`/`locations`/`contacts` are, and would remain, client-direct-write-with-rules, matching their current implementation.
- **The "receiving-to-ledger" and "Truck Inventory" initiatives the Owner referenced as later roadmap items are not currently named or scheduled anywhere in `docs/ROADMAP.md` or `docs/SPRINT_STATUS.md`.** `docs/PlatformCapabilityModel.md:96` mentions "Truck Inventory" only as an existing **nav placeholder**, not a scoped initiative. This assessment cannot verify their exact current roadmap position beyond the Owner's own statement in the Business Request; the roadmap placement section below records the Owner's stated ordering as given, not as independently cross-checked against a written schedule that doesn't yet exist.

## Risks

- **New interaction pattern, no existing precedent.** Tabs don't exist anywhere in this app today — the first implementation of this pattern carries more design/accessibility risk (keyboard navigation, ARIA `tablist`/`tab`/`tabpanel` roles, focus management) than reusing an established one. Recommend building it as a small, isolated, reusable component (not `AccountDetail.jsx`-specific) so the pattern is available for future record pages rather than a one-off.
- **Scope creep from the reference screenshots.** Salesforce's record page implies fields (phone, website, industry, account owner, contract manager) this schema doesn't have. The Business Request explicitly pre-empts this risk ("do not invent... merely because they appear in the reference screenshot") — Section "Open business decisions" below keeps these as separate, un-decided candidates, not assumed scope.
- **Address component reuse discipline.** The Business Request requires one shared form component and one shared formatting utility for both Account billing address and Location address. Building two similar-but-not-identical implementations (e.g. because Location also has `accessNotes` and Account doesn't) is the likely failure mode if this isn't deliberately factored as a shared component from the start of implementation, not refactored into one after the fact.
- **Editing must never silently drop data.** `AccountForm.jsx`'s current `hasAddress` check (line 35) already treats a fully-empty address as `null` rather than an empty-fields object — any new address form must preserve this "don't fabricate an address object out of blank inputs" behavior, and must never truncate an existing multi-field address down to fewer fields just because a new field (e.g. `addressLine2`, `countryCode`) wasn't present in older data and the edit form doesn't populate it correctly on load.
- **Country/state-selector scope risk.** A full country + per-country state/province selector is a meaningfully larger UI/data task (needs a maintained region list) than a US-only free-text state field. Given no current business requirement for non-US addresses is stated or evidenced anywhere in this repository, defaulting to this scope without a business decision would be over-building relative to actual need.

## Implementation options

**For the address shape (Business Request Section 4):**

1. **Option A — Retain the existing stored shape (`street`/`city`/`state`/`zip`), improve labels/layout only.** Zero data migration. `AccountDetail.jsx`'s display and `AccountForm.jsx`'s (and the new Location form's) editing both already operate on exactly these four fields — this option is purely a UI/UX change: distinct display rows instead of one joined line, the new shared address form component, better labels (already-optional fields clearly marked), no schema change, no expand/contract sequence needed (per the "Current repository state" finding that these collections have no exact-key Rules gate to navigate). Does not add country support or a second address line.
2. **Option B — Evolve to a canonical shape** (`countryCode`, `addressLine1`, `addressLine2`, `city`, `stateOrProvince`, `postalCode`) **via an expand/contract migration.** Adds country support and a second street line, at the cost of: a schema migration (write path changes on both `Account` and `Location`, a decision on whether/how to backfill or dual-read existing `street`/`city`/`state`/`zip` documents), a state/province selector needing a maintained per-country region list, and meaningfully more implementation and testing surface. Because `accounts`/`locations`/`contacts` have no Rules-level exact-key gate, this migration would **not** require the multi-PR expand/contract Rules sequence PR #108 needs for `reorder_requests` — a plain "accept both shapes at the domain/UI layer, backfill lazily or not at all" approach is viable here specifically because there's no schema-enforcing Rules layer to satisfy on both sides at once. Still a materially larger change than Option A.

**Recommendation: Option A, the smallest safe solution**, per the Business Request's own stated preference ("prefer the smallest safe solution unless country support or a second street line is an actual current business requirement"). Nothing in this repository's current data, schema comments, or prior sprints evidences a present need for multi-country address support or a second address line — every existing address in this codebase (`Account.billingAddress`, `Location.address`) is US-shaped, and no non-US customer or location has ever been modeled. Option B remains a legitimate future path if that business requirement becomes real, and Option A's UI work (the shared address component, the formatting utility) is not wasted if Option B is chosen later — the component boundary this assessment recommends is exactly where a future shape change would be absorbed, not a redesign.

**For tabs (Business Request Section 2):** build only Details, Locations, and Contacts now (all three already have fetched data and existing inline UI to relocate, per "Current repository state" above — no new query, no new route). Work Orders/Activity/Invoices/Related are assessed as named future candidates only, per the Business Request's explicit instruction not to implement empty shells — each would need its own future Assessment once a real data source exists to populate it (e.g. a Work Orders tab needs the "Real Work Order documents" candidate sprint already named in `docs/ROADMAP.md`'s "Candidate future sprints" section to exist first).

## Estimated PR count

Rough estimate, one architectural concern each, per `docs/ai/workflow.md` — **not fixed here**, the Implementation Plan's call once a Specification is approved:
1. Shared address formatting utility + shared address form component (no consumer wired yet — foundation only, mirrors this repo's own `EmployeeAssignmentPicker.jsx` "zero production consumers at first" precedent).
2. `AccountDetail.jsx` header/summary redesign + tab shell (Details/Locations/Contacts), consuming already-fetched data, no new queries.
3. `AccountForm.jsx` reorganized into sectioned two-column layout, address inputs replaced by the shared component from PR 1.
4. Location address editing (currently inline in `AccountDetail.jsx`'s `LocationForm`) converted to the same shared component.
5. `docs/BusinessEntityModel.md` documentation update reflecting whichever address-shape option is approved.

If Option B (canonical shape) is chosen instead of the recommended Option A, add at least one more PR for the schema/write-path change itself, sequenced before PR 3/4 above.

## Open questions for Architecture Review

Restated from the Business Request's "Business-process questions to resolve" (Section 8), since none of these can be answered from repository inspection alone — they are business decisions, not implementation details:

1. Is country support required now, or is US-only sufficient initially? (Recommendation above: US-only/Option A, pending Owner confirmation.)
2. Is `addressLine2` required now, or is single-line street sufficient? (Same recommendation.)
3. Should one Location be designated primary? (`Location` has no `isPrimary` field today, unlike `Contact`, which already does — this would be new schema either way.)
4. Should the record header show billing address or primary service Location — and if the latter, does question 3 need to be resolved first?
5. Which Contact is the primary Customer contact for header display — the existing `Contact.isPrimary` flag, or a separate designation?
6. Are `phone`, `website`, `industry`, `accountOwner`, and `contractManager` real Customer fields needed now, or reference-screenshot artifacts not to be built? (None exist in the schema today — confirmed above.)
7. Should Customers have Account Owner assignment through the Employee platform (`docs/PROJECT_ARCHITECTURE.md`'s Person Assignment Platform Service Standard, already used for Reorder Request assignment)? This would be the first consumer of that standard outside Inventory/Procurement if approved.
8. Which roles may edit Customer details — today `isAdminOrDispatcher()` for all of `accounts`/`locations`/`contacts` writes (`firestore.rules:685-701`), with no per-field or per-role distinction. Does this initiative need a narrower authorization model, or does the existing admin/dispatcher-wide grant remain correct?

This assessment recommends Option A (retain existing address shape, UI/UX evolution only) and a Details/Locations/Contacts-only tab set for the first Specification — both are the Business Request's own stated preference where evidence permits a recommendation. Questions 1-8 above require the Owner's decision before a Sprint Specification can be written for anything beyond that recommended baseline.

## Architecture Decision (2026-07-11)

**Approved. Option A** (retain the existing `{ street, city, state, zip }` shape, redesign the Customer UI only). Answers to the eight open questions above, in order:

1. **US-only for this iteration.** No `countryCode`, no country selector, no maintained international region list.
2. **No `addressLine2` in this iteration.** Continue storing exactly `street`/`city`/`state`/`zip`, labeled clearly as "Street address"/"City"/"State"/"ZIP code". **Binding constraint on implementation:** the shared address component's boundary must allow a future `addressLine2`/country expansion without redesigning the record page — i.e. the component's props/internal structure must not hard-code "exactly four US fields, forever" in a way a later field addition would have to work around.
3. **No primary-Location designation yet.** Deferred until service-location selection is designed as part of the Customer-to-Work-Order business process — this would introduce new schema and uniqueness rules, out of scope for a presentation-only sprint.
4. **Record header shows the Customer billing address**, explicitly labeled "Billing address" — never represented as, or conflated with, the primary service Location. The two business concepts (where the Customer is billed vs. where work is performed) remain distinct, per the Assessment's own "Related records" framing.
5. **Primary Contact uses the existing `Contact.isPrimary` field.** Exactly one primary → show that person's name and available phone/email in the header. None → show "No primary contact." **More than one** (a data-quality state the schema doesn't currently prevent) → show a visible "Multiple primary contacts" warning, never silently pick one. Enforcing one-primary-contact-per-Customer (e.g. a Rules-level or write-path uniqueness guarantee) is a **separate, not-yet-scoped data-integrity follow-up** — this initiative surfaces the data-quality state, it does not fix the underlying possibility of it occurring.
6. **No `phone`/`website`/`industry`/`accountOwner`/`contractManager` fields added.** Phone/email displayed in the header come from the primary Contact (per decision 5), not a new Account-level field. Account Owner requires a separate Person Assignment/permissions design (decision 7). Website/industry/contract manager need actual business requirements before becoming persisted fields — none exist today, per the Assessment's "Current repository state." **No empty placeholder is ever displayed for a field that does not exist** — absence is handled by omitting the row/section entirely, not by rendering a blank or "Not set" value for something never modeled.
7. **Account Owner assignment via the Person Assignment Platform Service Standard is deferred**, not decided against — it requires its own separate Specification defining ownership, reassignment, visibility, and authorization before the Customer page becomes the first non-Inventory/Procurement consumer of that standard. Not attempted in this initiative.
8. **Edit authorization is unchanged**: `isAdminOrDispatcher()` remains the authorization for `accounts`/`locations`/`contacts` writes, exactly as `firestore.rules:685-701` already enforces. This sprint changes presentation, not permissions — no Rules change of any kind. Operational-role-specific Customer editing remains a future access-model decision, not addressed here.

**Approved first-iteration scope**, binding on the Specification:

- **Record header:** Customer name, status, customer number (when present), billing address (formatted clearly, per decision 4), primary Contact summary or data-quality state (per decision 5), tags (when present), one "Edit Customer" action.
- **Tabs:** Details, Locations, Contacts only. No empty Work Orders/Activity/Invoices/Related tabs.
- **Details tab:** responsive two-column layout collapsing to one column; sections: Customer Information, Billing Address (separate displayed rows, not a joined line), External Identifiers, Notes and Tags.
- **Locations tab:** existing related Locations, structured address display, existing add-Location function preserved, consuming the shared address component.
- **Contacts tab:** existing related Contacts, primary badge, phone/email display, existing add-Contact function preserved, multiple-primary warning where applicable (per decision 5).

**Implementation constraints, binding on the Specification and Implementation Plan:**

- Field Ops styling only — no Salesforce branding or visual assets, per the original Business Request.
- A new, accessible, reusable tab component: correct `tablist`/`tab`/`tabpanel` ARIA semantics, keyboard navigation (this repo has no existing tab pattern to reuse — see "Current repository state" above).
- One shared `AddressFields` component and one address-formatting/display utility, consumed by **both** Account billing-address and Location address UI — no parallel/duplicate implementation.
- `onSnapshot()`-based reads preserved throughout — no one-shot reads introduced.
- All existing Customer/Location data preserved during editing — never write `null` over an existing address field merely because it wasn't rendered or changed in a given edit.
- No schema migration, Rules change, new query, new index, new route, or production-data backfill of any kind.
- **No standalone foundation PR with zero consumers** — the shared tab/address components must land together with their first real Customer-page consumer, not as an isolated foundation PR the way `EmployeeAssignmentPicker.jsx` (Employee Foundation PR 4) was allowed to. This reverses that specific precedent for this initiative, per explicit Owner direction — noted here so a future reader doesn't treat the zero-consumers pattern as this project's universal default.

**Approved two-PR implementation sequence** (supersedes this Assessment's earlier five-PR estimate):

- **PR 1:** reusable accessible tabs; shared address fields/display utility; Customer record header; Details/Locations/Contacts tabbed page; existing related-record functionality preserved.
- **PR 2:** reorganized Customer edit form; Location form consumes the shared address component; documentation and focused browser verification; any corrections discovered during integration.

The Implementation Plan may adjust this sequence only with evidence that a separate architectural boundary requires it — not merely for convenience.

This decision set is the input to the Sprint Specification (to be added to `docs/specifications/`) — implementation does not begin from this assessment alone. PR #120 remains documentation-only and Draft until the Specification receives Final Review.
