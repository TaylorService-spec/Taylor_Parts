---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-07-11
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/customer-record-page-structured-address.md]
implements: []
supersedes: []
superseded_by: []
related_pr: 120
target_release: Post-Release 2.1 (Inventory → Procurement chain)
---

# Sprint Specification: Customer Record Page and Structured Address Experience

**Architecture Review:** `docs/assessments/customer-record-page-structured-address.md`'s "Architecture Decision" section — Approved 2026-07-11 (Option A: retain the existing address shape, redesign the Customer UI only).

## Executive summary

Redesigns the Customer (`Account`) record page from a single flat panel into a header + tabbed layout (Details/Locations/Contacts), using Owner-supplied Salesforce-style screenshots as information-architecture references only — no Salesforce branding or visual assets, this repository's own Field Ops design system throughout. Addresses are already structured at the data layer (`{ street, city, state, zip }`, four distinct fields on both `Account.billingAddress` and `Location.address`); this sprint fixes the **display and editing** of that data — distinct labeled rows instead of one collapsed line, and one shared, reusable address component instead of two duplicated inline forms. No schema change, no Rules change, no new query, no migration.

## Sprint objective

A user viewing a Customer sees a clear header (name, status, customer number, billing address, primary-contact summary, tags, one Edit action) and three tabs (Details, Locations, Contacts) built on a new, accessible, reusable tab component. Billing and Location addresses render as distinct labeled fields and are edited through one shared `AddressFields` component, preserving every existing field on save. Nothing about who may read or write these collections changes.

## Scope

- New reusable tab component (no existing precedent in this codebase — see Technical design).
- New shared address display-formatting utility, replacing the two duplicated inline `.filter(Boolean).join(", ")` call sites (`AccountDetail.jsx:144`, `:162`).
- New shared `AddressFields` form component, replacing the four duplicated raw `<input>` blocks in `AccountForm.jsx` (lines 67-70) and `AccountDetail.jsx`'s inline `LocationForm` (lines 41-44).
- `AccountDetail.jsx` redesigned: record header + Details/Locations/Contacts tab shell, consuming already-fetched `useAccount`/`useLocationsForAccount`/`useContactsForAccount` data (no new queries).
- `AccountForm.jsx` reorganized into sectioned two-column layout (Customer Information / Billing Address / External Identifiers / Notes and Tags), billing-address inputs replaced by `AddressFields`.
- Location add/edit form (currently `AccountDetail.jsx`'s inline `LocationForm`) converted to consume `AddressFields`.
- Primary-Contact header derivation: none / exactly-one / multiple-primary data-quality warning.
- `docs/BusinessEntityModel.md` updated to reflect the Customer page's new shape (header/tabs), not a schema change.

## Explicitly out of scope

- **Any schema change.** `Account.billingAddress`/`Location.address` remain exactly `{ street, city, state, zip }`. No `countryCode`, no `addressLine2`, no country selector, no international region list (Architecture Decision items 1-2).
- **Any Rules change.** `isAdminOrDispatcher()` remains the sole authorization for `accounts`/`locations`/`contacts` writes, unchanged (Architecture Decision item 8).
- **Primary-Location designation.** No `isPrimary` field added to `Location` (Architecture Decision item 3).
- **`phone`/`website`/`industry`/`accountOwner`/`contractManager` fields.** Not added to `Account`. Header phone/email come from the primary Contact, not a new Account field (Architecture Decision item 6).
- **Account Owner assignment via the Person Assignment Platform Service Standard.** Deferred to its own future Specification (Architecture Decision item 7).
- **Enforcing one-primary-contact-per-Customer.** This sprint surfaces the "multiple primary contacts" data-quality state; it does not prevent or fix it at the write path or Rules level — a separate, not-yet-scoped follow-up (Architecture Decision item 5).
- **Work Orders, Activity/Timeline, Invoices, or Related tabs.** Not built as empty shells, per the Assessment and Architecture Decision.
- **Any new Firestore query, index, or route.** Locations/Contacts tabs render already-fetched data from already-existing hooks.
- **A standalone foundation PR for the shared tab/address components.** They land together with their first real consumer (PR 1 below), per explicit Architecture Decision reversing the `EmployeeAssignmentPicker.jsx` zero-consumers precedent for this initiative specifically.
- **The Parts and Purchase Order Assignment Adoption initiative, PR #107, PR #108, and Issue #118.** Unrelated collections and UI modules; no interaction.

## Technical design

### Component 1: `Tabs` (new, reusable, no existing precedent)

Location: `field-ops-app-vite/src/shared/tabs/Tabs.jsx` (new directory, mirrors `shared/assignment/`'s existing convention of one feature-scoped subdirectory under `shared/`).

Contract:
```js
// <Tabs> is a pure, stateless-from-the-outside controlled component --
// the caller owns `activeTabId` (via useState, a URL query param, or
// any other mechanism); Tabs renders the tablist and fires onChange,
// it never manages selection state itself. This keeps it reusable for
// a future record page without assuming Customer-specific state shape.
<Tabs
  tabs={[{ id: "details", label: "Details" }, { id: "locations", label: "Locations" }, { id: "contacts", label: "Contacts" }]}
  activeTabId={activeTabId}
  onChange={(id) => setActiveTabId(id)}
/>
<TabPanel tabId="details" activeTabId={activeTabId}>
  {/* Details content */}
</TabPanel>
```

Accessibility contract (binding, per Architecture Decision's implementation constraints — this repo has zero existing tab precedent to draw ARIA behavior from, so this is specified explicitly rather than "match the existing pattern"):
- `<Tabs>` renders a `role="tablist"` container; each tab is a `role="tab"` element with `aria-selected`, a unique `id`, and `aria-controls` pointing at its corresponding `<TabPanel>`'s `id`.
- Each `<TabPanel>` is `role="tabpanel"`, `aria-labelledby` pointing back at its tab's `id`, and only the active panel is rendered (not merely hidden via CSS — matches this codebase's existing conditional-render pattern, e.g. `PartDetail.jsx`'s status-branching render).
- Keyboard: `ArrowLeft`/`ArrowRight` move focus between tabs and activate the newly-focused tab (standard WAI-ARIA "automatic activation" tabs pattern); `Home`/`End` jump to the first/last tab. `Tab` key moves focus out of the tablist into the active panel, not between individual tabs (standard roving-tabindex behavior — only the active tab is in the natural tab order).
- Unique IDs generated via `useId()`, same pattern `EmployeeAssignmentPicker.jsx` already establishes for exactly this reason (multiple `Tabs` instances on one page must never collide).

### Component 2: Address formatting utility (new)

Location: `field-ops-app-vite/src/domain/address.js` (new file, mirrors this codebase's existing "small pure-function domain module" convention, e.g. `domain/employees.js`'s query builders).

```js
// Single source of truth for turning a stored address object into a
// display string -- replaces the two duplicated inline
// .filter(Boolean).join(", ") call sites (AccountDetail.jsx:144, :162).
// Returns null for a null/undefined address (never an empty string or
// a string of stray commas) so callers can decide whether to omit the
// row entirely (this sprint's requirement: no fabricated/empty values
// ever displayed).
export function formatAddress(address) {
  if (!address) return null;
  const parts = [address.street, address.city, address.state, address.zip].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

// Structured form for the Details tab's "distinct displayed rows"
// requirement -- returns an ordered array of { label, value } pairs,
// omitting any field that's empty/missing (never a "Not set" fabricated
// value). Labels match Architecture Decision item 2's exact wording.
export function addressRows(address) {
  if (!address) return [];
  return [
    { label: "Street address", value: address.street },
    { label: "City", value: address.city },
    { label: "State", value: address.state },
    { label: "ZIP code", value: address.zip },
  ].filter((row) => Boolean(row.value));
}
```

### Component 3: `AddressFields` (new, shared editing component)

Location: `field-ops-app-vite/src/shared/address/AddressFields.jsx`.

```js
// Shared editing component for BOTH Account billing address and
// Location address -- the Architecture Decision's binding requirement
// that both use the same component, not parallel implementations.
//
// Controlled component: the caller owns the four field values (same
// pattern AccountForm.jsx/the inline LocationForm already use with
// individual useState calls) -- AddressFields does not own state
// itself, it only renders the four labeled inputs and calls onChange
// per field. This keeps the component trivially reusable without
// assuming a specific parent form's submit shape.
//
// Deliberately four fields, not fewer/more -- but the props shape
// (an explicit `value` object with named keys, not four positional
// arguments) is chosen specifically so a future addressLine2/
// countryCode addition only requires adding a key to `value` and a
// new labeled input inside this one component, never a redesign of
// any consumer (AccountForm.jsx, the Location form, or the record
// page itself) -- the binding "must allow future expansion without
// redesigning the record page" constraint from the Architecture
// Decision.
<AddressFields
  value={{ street, city, state, zip }}
  onChange={(field, newValue) => /* caller updates its own state */}
  disabled={submitting}
  idPrefix="billing" // or "location-<id>" -- keeps input ids unique when
                       // multiple AddressFields instances render on one page
                       // (e.g. the Locations tab's add-form alongside an
                       // existing Location's edit form)
/>
```

Rendered fields, in order, each with a `<label htmlFor>` (not a bare `placeholder`, correcting `AccountForm.jsx`'s and the inline `LocationForm`'s current placeholder-only inputs — a real accessibility gap this sprint fixes as a byproduct of building the shared component correctly, not a scope expansion):
- **Street address** (optional, clearly labeled as such — no `*`/required marker).
- **City** (optional).
- **State** (optional).
- **ZIP code** (optional).

No field is required — matches `AccountForm.jsx`'s current behavior exactly (an address is either fully absent or a `hasAddress` check determines whether to persist `null` vs. an object; no individual field within a populated address is mandatory today, and this sprint does not add a new requirement).

### `AccountDetail.jsx` — record header + tab shell

```
┌─────────────────────────────────────────────┐
│ ← Back to Customers                          │
│ {Customer Name}          [Status badge]      │
│ Customer #{customerNumber}  (only if present)│
│ Billing address: {formatAddress(...)}        │  <- one line, header context only;
│                                                │     Details tab shows the 4 distinct rows
│ {Primary Contact summary | data-quality state}│
│ Tags: {tags.join(", ")}   (only if present)  │
│                                    [Edit Customer]
├─────────────────────────────────────────────┤
│ [Details] [Locations] [Contacts]   <- Tabs   │
├─────────────────────────────────────────────┤
│ {active tab panel content}                    │
└─────────────────────────────────────────────┘
```

**Primary-Contact header derivation** (pure function, `domain/contacts.js` or inline in `AccountDetail.jsx` — Implementation Plan's call):
```js
// Three states, per Architecture Decision item 5. Never silently picks
// one when multiple exist.
function primaryContactState(contacts) {
  const primaries = contacts.filter((c) => c.isPrimary);
  if (primaries.length === 0) return { state: "NONE" };
  if (primaries.length === 1) return { state: "ONE", contact: primaries[0] };
  return { state: "MULTIPLE", contacts: primaries };
}
```
Header rendering per state:
- `NONE` → "No primary contact." (plain text, `fo-muted`, matching this codebase's existing empty-state convention, e.g. `AccountDetail.jsx:178`'s "No contacts yet.").
- `ONE` → the contact's `name`, plus `phone`/`email` if present (omit either individually if not set — never a fabricated blank).
- `MULTIPLE` → a visible warning, e.g. `<span className="fo-badge fo-badge-critical">Multiple primary contacts</span>`, reusing the existing `fo-badge` convention (same class family `account.status`/Contact's own "Primary" badge already use) rather than inventing new styling.

### Details tab

Two-column desktop layout, collapsing to one column below 900px — reuses `.disp-board-layout`'s existing grid/media-query shape (`index.css:394-400`), not a new breakpoint value invented for this sprint. New CSS class (e.g. `.acct-detail-grid`) with the same two declarations, since `.disp-board-layout` is a 3-column grid (`1.2fr 1fr 1fr`) and this sprint needs 2 columns — a new class with the same collapsing behavior, not a reuse of the exact 3-column class.

Sections, each a `fo-card`-style block (matching this codebase's existing card convention, e.g. `PartDetail.jsx`'s every `<div className="fo-card">`):
1. **Customer Information** — name, status, customer number, notes-and-tags is its own section (4) so this one stays focused on identity/status only.
2. **Billing Address** — the four `addressRows()` entries as distinct labeled rows (not the joined-line header display) — this is the concrete fix for the Business Request's core complaint.
3. **External Identifiers** — `customerNumber`/`erpId`/`accountingId`/`legacyId`, collapsed-by-default exactly as `AccountForm.jsx` already does today (no behavior change, just relocated into this section).
4. **Notes and Tags** — `notes` (free text) and `tags` (comma list), each omitted entirely if empty (never an empty "Notes:" row with nothing after it).

### Locations tab

- Existing related Locations, rendered as cards (not the current bare `<div className="wo-history-row">` rows) — each showing `name`, structured address rows (`addressRows()`, same utility as Details), `accessNotes` if present.
- Existing "+ Add Location" function preserved exactly (`createLocation()`, unchanged) — the add-form's four address inputs replaced by `<AddressFields>`.
- No primary-Location UI of any kind (Architecture Decision item 3 — explicitly deferred).

### Contacts tab

- Existing related Contacts, rendered as cards.
- Primary badge preserved (`fo-badge fo-badge-active`, unchanged from today's `AccountDetail.jsx:183`).
- Phone/email display preserved.
- Existing "+ Add Contact" function preserved exactly (`createContact()`, unchanged).
- **Multiple-primary warning**, same derivation as the header (`primaryContactState()`), shown once at the top of this tab if `state === "MULTIPLE"` — not repeated per-contact-card.

### `AccountForm.jsx` — sectioned two-column reorganization

Same four sections as the Details tab (Customer Information / Billing Address / External Identifiers / Notes and Tags), same responsive two-column-to-one-column layout. Billing-address inputs replaced by `<AddressFields value={{ street, city, state, zip }} onChange={...} idPrefix="billing-edit" />`. **Behavior preserved exactly**: the existing `hasAddress` check (`AccountForm.jsx:35`) — persisting `null` when every address field is blank, an object when at least one is populated — is unchanged; `AddressFields` only renders the four inputs, it does not own the has-address-at-all decision, which stays in `AccountForm.jsx`'s `handleSubmit()`.

**Data-preservation contract (binding, tested explicitly — see Testing strategy):** `AccountForm`'s `initialValues` prop already seeds each field's `useState` from `initialValues?.billingAddress?.street` etc. (lines 13-16) — this pattern is preserved, extended to whatever shape `AddressFields` needs. Opening the edit form and saving without touching any address field must write back the exact same four values that were loaded, never `null`, never a subset. This is not a new behavior to build — it already works today by construction (React state initialized from props, unchanged unless the user types) — this sprint's job is to not break it while swapping the four raw `<input>`s for `<AddressFields>`.

## Firestore Rules impact

**None.** `firestore.rules`' `accounts`/`locations`/`contacts` match blocks (both copies, lines 685-701) are untouched — zero characters changed. `isAdminOrDispatcher()` remains the sole authorization for create/update on all three collections; `allow delete: if false` remains unchanged on all three. No field-level validation exists today and none is added.

## UI impact

- Customer Detail page changes from a single flat panel to a header + three-tab layout. URL/route (`/customers/:accountId`, per existing `App.jsx` routing — unchanged) stays the same; tab selection is client-side state, not separate routes, per the Tabs component contract above (no new route).
- Billing/Location addresses render as distinct labeled rows instead of one comma-joined line.
- Customer edit form reorganizes into four labeled sections in a two-column desktop layout.
- Location add/edit form gains real `<label>` elements (was placeholder-only) as a byproduct of using `AddressFields`.
- Primary-contact summary or a "No primary contact"/"Multiple primary contacts" state now appears in the header — previously, `AccountDetail.jsx` did not surface this at all in the header (only inside the Contacts list further down the page).
- No change to Global Search (Accounts), the Customers list page (`AccountsList.jsx`), or the "Back to Customers" navigation.

## Testing strategy

No Rules changed, so no new Rules-emulator test file — this sprint's testing is component/behavior-level, via this repo's established "standalone script or manual verification" pattern for non-Rules changes (`docs/ai/claude-code.md`'s testing responsibilities), plus live browser verification per PR (`run-field-ops-app-vite` skill or an equivalent one-off Playwright driver, matching the pattern used for PR #107's verification this session).

**Data states (all four required, per the Owner's testing expectations):**
- Existing Customer with a complete legacy address (`street`/`city`/`state`/`zip` all populated) — Details tab and header both render all four rows/the joined header line correctly.
- Existing Customer with a partial address (e.g. only `city`/`state` populated, `street`/`zip` empty or absent) — `addressRows()`/`formatAddress()` both omit the missing fields cleanly, no empty label, no stray comma.
- Customer with no address at all (`billingAddress: null`) — header omits the "Billing address" line entirely; Details tab's Billing Address section shows an explicit empty state (e.g. "No billing address on file"), not a blank section with just a heading.
- Editing an existing Customer/Location **without changing any address field** preserves the exact stored values — verified by reading the document before and after a save that only touches, e.g., `notes`, confirming `billingAddress`/`address` is byte-identical.

**Primary-Contact states (all three, per Architecture Decision item 5):**
- Zero primary Contacts → header shows "No primary contact."
- Exactly one primary Contact → header shows that Contact's name + available phone/email.
- Two or more Contacts marked `isPrimary: true` (a fixture the current schema already permits, since nothing enforces uniqueness) → header and Contacts tab both show the "Multiple primary contacts" warning, no Contact silently chosen.

**Rendering parity:**
- Account billing address and Location address both render through the same `formatAddress()`/`addressRows()` utility and the same `AddressFields` editing component — verified by checking both consumers import from the same module, not parallel reimplementations.

**Responsive layout:**
- Desktop viewport (e.g. 1280px): Details/AccountForm two-column layout, side-by-side sections.
- Narrow viewport (below the 900px breakpoint, matching `.disp-board-layout`'s existing precedent): single-column, sections stack vertically.

**Accessibility:**
- Keyboard: `ArrowLeft`/`ArrowRight`/`Home`/`End` navigate tabs without a mouse; each `AddressFields` input has a real `<label htmlFor>`, not a placeholder-only input.
- Screen-reader semantics: `role="tablist"`/`role="tab"`/`role="tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby` all present and correctly paired (verified via the rendered DOM, not just visual inspection).

**Negative/scope-boundary checks:**
- No empty Work Orders/Activity/Invoices/Related tab renders anywhere.
- No fabricated summary value renders for a field that doesn't exist in the schema (no blank "Phone:" row, no "Website:" placeholder) — every header/section field is either populated from real data or entirely omitted.

## Rollback strategy

Entirely additive/presentational — no schema, no Rules, no migration, no new collection. If a defect is found post-merge:
- **Not yet deployed:** revert the PR(s) normally, no live impact.
- **Already deployed (frontend-only, auto-deploys at merge, same as every prior frontend-only PR in this initiative, e.g. PR #105/#107):** revert to the prior `AccountDetail.jsx`/`AccountForm.jsx` in a follow-up PR/deploy. No data was ever written in a new shape — `billingAddress`/`address` documents are read and written in exactly the shape they've always been, so a UI-only rollback has zero data-shape consequences in either direction.

## Acceptance criteria

- [ ] `Tabs`/`TabPanel` component exists, is reusable (no `AccountDetail`-specific assumptions baked in), and implements the ARIA tablist/tab/tabpanel contract described above with `ArrowLeft`/`ArrowRight`/`Home`/`End` keyboard support.
- [ ] `domain/address.js`'s `formatAddress()`/`addressRows()` exist, are the sole address-formatting logic in the app (both inline call sites in `AccountDetail.jsx` removed), and return `null`/`[]` rather than an empty/malformed string for a missing address.
- [ ] `shared/address/AddressFields.jsx` exists, is consumed by **both** `AccountForm.jsx` and the Location add/edit form, and renders four real `<label htmlFor>`-paired inputs (Street address/City/State/ZIP code).
- [ ] `AccountDetail.jsx` renders a header (name, status, customer number if present, billing address if present, primary-Contact state, tags if present, one Edit action) and a Details/Locations/Contacts tab shell — no Work Orders/Activity/Invoices/Related tab rendered.
- [ ] Details tab shows the four sections (Customer Information/Billing Address/External Identifiers/Notes and Tags) in a two-column desktop layout collapsing to one column at the existing 900px breakpoint.
- [ ] Locations tab shows existing Locations as cards with structured address rows and preserves the existing add-Location function via `AddressFields`.
- [ ] Contacts tab shows existing Contacts as cards, preserves the primary badge/add-Contact function, and shows the multiple-primary warning when applicable.
- [ ] `primaryContactState()` (or equivalent) correctly derives NONE/ONE/MULTIPLE and both header and Contacts tab render the correct corresponding UI for all three.
- [ ] Editing a Customer or Location without touching any address field leaves `billingAddress`/`address` byte-identical to its pre-edit value (verified, not assumed).
- [ ] No Rules change: `firestore.rules` (both copies) byte-identical to `main` before this sprint, verified via diff.
- [ ] `npm run build && npm run lint && npm run typecheck` clean.
- [ ] Live browser verification (fresh emulator): complete-address Customer, partial-address Customer, no-address Customer, zero/one/multiple-primary-Contact Customer, desktop and narrow viewport, keyboard tab navigation — all pass, per Testing strategy above.
- [ ] Two-PR sequence followed (PR 1: tabs + shared components + header/tab shell + preserved related-record functionality; PR 2: reorganized edit form + Location form using the shared component + documentation/verification) unless the Implementation Plan documents evidence requiring a different split.

## Risks

- **First implementation of a genuinely new interaction pattern (tabs).** No existing precedent in this codebase to copy ARIA/keyboard behavior from — the contract above is specified from the WAI-ARIA Authoring Practices' standard tabs pattern, not derived from an existing component, so it carries more first-implementation risk than a typical bounded correction in this initiative.
- **Address-component reuse discipline.** The binding requirement that both Account and Location addresses use one shared component/utility is the main thing this Specification exists to prevent from silently drifting during implementation (e.g. building `AddressFields` for the Account form first, then a "close enough" second version for Locations under time pressure).
- **Data-preservation regression risk during the input swap.** Replacing four raw `<input>` elements with `<AddressFields>` in two different forms (`AccountForm.jsx`, the Location form) is exactly the kind of mechanical change where a copy-paste or prop-wiring mistake could silently start writing `null`/an empty string over a previously-populated field — the explicit "load, save without touching, confirm byte-identical" test case above exists specifically to catch this class of bug before merge, not just to pad the test count.
- **Scope discipline on the header.** The record header is the most visually "Salesforce-reference-shaped" surface in this sprint — the concrete risk is quietly reintroducing a `phone`/`website`/`industry` placeholder row "because the reference screenshot has one," which the Architecture Decision explicitly forbids (no empty placeholders for fields that don't exist).

## Open questions

None remaining that block implementation — the Architecture Decision resolved every item the Assessment raised, and this Specification's Technical design section resolves every component-contract question needed to implement it. Any question that surfaces during implementation (exact card/badge CSS class names, exact section ordering within a card) is an implementation detail, not an open architectural question, per this Specification's own Technical design section above.

## Approval

Awaiting ChatGPT Final Review of this Specification before an Implementation Plan is drafted. **No code has been written for this sprint.**
