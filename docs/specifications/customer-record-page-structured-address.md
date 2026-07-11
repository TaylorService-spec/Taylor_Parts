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

A user viewing a Customer sees a clear header (name, status, customer number, billing address, primary-contact summary, tags, one Edit action) and three tabs (Details, Locations, Contacts) built on a new, accessible, reusable tab component. Billing and Location addresses render as distinct labeled fields through one shared address-formatting utility; the Customer's billing address is **edited** through one shared `AddressFields` component (preserving every existing field on save), and a new Location's address is **entered** through that same component (no Location edit action exists or is added this sprint). Nothing about who may read or write these collections changes.

## Scope

- New reusable tab component (no existing precedent in this codebase — see Technical design).
- New shared address display-formatting utility, replacing the two duplicated inline `.filter(Boolean).join(", ")` call sites (`AccountDetail.jsx:144`, `:162`).
- New shared `AddressFields` form component, replacing the four duplicated raw `<input>` blocks in `AccountForm.jsx` (lines 67-70) and `AccountDetail.jsx`'s inline `LocationForm` (lines 41-44).
- `AccountDetail.jsx` redesigned: record header + Details/Locations/Contacts tab shell, consuming already-fetched `useAccount`/`useLocationsForAccount`/`useContactsForAccount` data (no new queries).
- `AccountForm.jsx` reorganized into sectioned two-column layout (Customer Information / Billing Address / External Identifiers / Notes and Tags), billing-address inputs replaced by `AddressFields`.
- Location **add** form (currently `AccountDetail.jsx`'s inline `LocationForm`, shown when "+ Add Location" is clicked) converted to consume `AddressFields`. **Correction (this revision):** no Location edit action exists in the current repository — `AccountDetail.jsx` only provides "+ Add Location" and read-only display of existing Locations, never an edit form for an already-created Location. This sprint does not add one; see "Explicitly out of scope" below.
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
- **Location editing.** **Added in this revision, per Codex Final Review's correction.** No Location edit action or edit form exists in the current repository — `AccountDetail.jsx` provides only "+ Add Location" (creates a new Location document) and read-only display of already-created Locations; there is no way to modify an existing Location's name/address/access notes today. This sprint does **not** introduce one. An earlier draft of this Specification repeatedly described the existing inline `LocationForm` as an "add/edit" form and required verifying that "editing a Location preserves its address" — that would have silently introduced a new business capability (the ability to modify an existing Location) that was never approved and does not exist today. If Location editing is wanted later, it is a separate, future enhancement requiring its own Assessment/Specification, not something to add silently as part of this sprint's address-display/`AddressFields` work.

## Technical design

### Component 1: `Tabs` (new, reusable, no existing precedent)

**Contract corrected in this revision, per Codex Final Review.** The prior draft rendered `Tabs` and `TabPanel` as independent siblings while saying `Tabs` generates IDs via `useId()`, with no defined mechanism for `TabPanel` to receive that same generated prefix — `aria-controls`/`aria-labelledby` could not be guaranteed to resolve. Corrected to the **React Context-owned instance ID** design (the Preferred option): a `Tabs` root generates one instance ID via `useId()` and provides it, plus the active-tab state, through context; `Tab`/`TabPanel` descendants consume that context and derive their own DOM IDs from `{instanceId}-{businessTabId}`, so every `aria-controls`/`aria-labelledby` pairing is computed from the same source, never independently reproduced by the caller.

Location: `field-ops-app-vite/src/shared/tabs/Tabs.jsx` (new directory, mirrors `shared/assignment/`'s existing convention of one feature-scoped subdirectory under `shared/`).

Contract:
```js
// Tabs owns exactly one thing: a React Context providing this
// instance's useId()-generated ID and the current active-tab state to
// every Tab/TabPanel descendant. The CALLER supplies only stable,
// business-meaningful tab ids ("details"/"locations"/"contacts") --
// never a useId()-shaped string -- and owns activeTabId itself (via
// useState or equivalent), same controlled-component posture as the
// prior draft. Tabs renders the tablist (the row of Tab buttons);
// TabPanel is rendered by the caller wherever its content belongs,
// consuming the same context to resolve its own DOM id/aria-labelledby
// -- it does not need activeTabId passed to it explicitly (removing
// the prior draft's redundant, error-prone activeTabId prop on
// TabPanel).
<Tabs tabs={[
  { id: "details", label: "Details" },
  { id: "locations", label: "Locations" },
  { id: "contacts", label: "Contacts" },
]} activeTabId={activeTabId} onChange={setActiveTabId}>
  <TabPanel tabId="details">{/* Details content */}</TabPanel>
  <TabPanel tabId="locations">{/* Locations content */}</TabPanel>
  <TabPanel tabId="contacts">{/* Contacts content */}</TabPanel>
</Tabs>
```

```js
// Tabs.jsx -- illustrative shape, not final implementation code.
const TabsContext = createContext(null);

export function Tabs({ tabs, activeTabId, onChange, children }) {
  const instanceId = useId();
  // Invalid activeTabId (matches no tab.id) falls back to the FIRST
  // tab, silently -- consistent with this codebase's established
  // "never throw, always resolve to a safe default" convention (e.g.
  // resolveActorDisplayName() falling back to the raw uid rather than
  // erroring). Never renders with nothing selected.
  const validIds = tabs.map((t) => t.id);
  const effectiveActiveId = validIds.includes(activeTabId) ? activeTabId : tabs[0]?.id;

  return (
    <TabsContext.Provider value={{ instanceId, tabs, activeTabId: effectiveActiveId, onChange }}>
      <div role="tablist" className="fo-tablist">
        {tabs.map((tab) => <Tab key={tab.id} tab={tab} />)}
      </div>
      {children}
    </TabsContext.Provider>
  );
}

function Tab({ tab }) {
  const { instanceId, activeTabId, onChange, tabs } = useContext(TabsContext);
  const isActive = tab.id === activeTabId;
  const tabDomId = `${instanceId}-tab-${tab.id}`;
  const panelDomId = `${instanceId}-panel-${tab.id}`;
  // ArrowLeft/ArrowRight/Home/End keyboard handling lives here, scoped
  // to `tabs` from THIS instance's context only -- two Tabs instances
  // on one page never share a keydown handler or a focus loop, since
  // each Tab reads only its own Tabs.Provider's context value.
  return (
    <button
      type="button"
      role="tab"
      id={tabDomId}
      aria-selected={isActive}
      aria-controls={panelDomId}
      tabIndex={isActive ? 0 : -1}
      onClick={() => onChange(tab.id)}
      onKeyDown={(e) => { /* ArrowLeft/Right/Home/End -> onChange(newId) + focus that tab's button */ }}
    >
      {tab.label}
    </button>
  );
}

export function TabPanel({ tabId, children }) {
  const { instanceId, activeTabId } = useContext(TabsContext);
  // CORRECTED (Codex Final Review): every declared TabPanel stays
  // MOUNTED at all times, active or not -- never conditionally
  // returns null. An unmounted inactive panel would mean its tab's
  // aria-controls points at a DOM id that doesn't exist, contradicting
  // this contract's own "every aria-controls target exists" guarantee.
  // Inactive panels are hidden via the native `hidden` attribute
  // instead (removes the element from the accessibility tree and the
  // tab order without unmounting it -- browser-native behavior, no
  // extra aria-hidden needed on top of `hidden`).
  //
  // Because every panel stays mounted, any in-progress, unsaved
  // panel-local state (e.g. a half-filled "+ Add Location" draft in
  // the Locations tab) SURVIVES switching to another tab and back --
  // this is now the intended, binding behavior (reversing the prior
  // draft's "intentionally discards state" position, per Codex's
  // review).
  const isActive = tabId === activeTabId;
  const panelDomId = `${instanceId}-panel-${tabId}`;
  const tabDomId = `${instanceId}-tab-${tabId}`;
  return (
    <div role="tabpanel" id={panelDomId} aria-labelledby={tabDomId} hidden={!isActive}>
      {children}
    </div>
  );
}
```

Accessibility and behavior contract (binding — this repo has zero existing tab precedent to draw from, so every point below is specified explicitly rather than "match the existing pattern"):
- `role="tablist"` on the tab row; each tab is `role="tab"` with `aria-selected`, a context-derived unique `id`, and `aria-controls` pointing at its `TabPanel`'s context-derived `id` -- both derived from the same `{instanceId}-...-{businessTabId}` formula, so every `aria-controls` target is guaranteed to exist and every `aria-labelledby` reference is guaranteed to resolve, by construction, not by the caller manually matching strings.
- Keyboard: `ArrowLeft`/`ArrowRight` move focus between tabs and activate the newly-focused tab (WAI-ARIA "automatic activation" tabs pattern); `Home`/`End` jump to the first/last tab; roving `tabIndex` (`0` on the active tab, `-1` on the rest) keeps a single `Tab`-key stop for the whole tablist, per the standard pattern.
- **Invalid `activeTabId`** (a value that matches no `tab.id` in the supplied `tabs` array): falls back to the first tab in the array, silently -- never throws, never renders with no tab selected.
- **Disabled tabs are explicitly unsupported this sprint** -- `Tabs`' `tabs` prop has no `disabled` field; every tab supplied is always selectable. Adding disabled-tab support is a future enhancement to this contract if a real need arises, not assumed here since none of Details/Locations/Contacts needs to ever be disabled.
- **Focus behavior if the active tab is removed/changed** (i.e. the `tabs` array itself changes and no longer contains the previously-active id): falls back to the first tab in the new array (same rule as the invalid-`activeTabId` case above, since it's the same underlying condition — the current `activeTabId` no longer matching any supplied tab).
- **Every declared panel stays mounted; inactive panels are hidden via the native `hidden` attribute**, per the illustrative `TabPanel` code above. **Corrected in this revision** — an earlier draft unmounted inactive panels, which contradicted this same contract's "every `aria-controls` target exists" guarantee (an unmounted panel has no DOM node for its tab to point to). `hidden` removes an element from the accessibility tree and the tab order (native browser behavior — no extra `aria-hidden` needed) without unmounting it, so: every `aria-controls`/`aria-labelledby` pairing resolves to a real, mounted DOM node at all times; exactly one panel is visible at any moment; inactive panel content is not keyboard-reachable; and any in-progress, unsaved panel-local state (e.g. a half-filled "+ Add Location" draft) **survives** switching tabs and back — reversing the prior draft's "intentionally discards state" position. Binding.
- Unique IDs generated via one `useId()` call per `Tabs` instance (not per `Tab`/`TabPanel`), same underlying primitive `EmployeeAssignmentPicker.jsx` already establishes for the identical reason (multiple instances on one page must never collide) — but owned by the `Tabs` root and shared via context here, correcting the prior draft's gap.

Rendered-DOM tests required (binding; corrected in this revision to test the mounted-but-`hidden` design, not the earlier unmount design):
- Every rendered tab's `aria-controls` value resolves to a **mounted** panel's `id` (all panels are always mounted now, so this holds for every tab, active or not — not just the active one).
- Every rendered panel's `aria-labelledby` value resolves to its corresponding **mounted** tab's `id`.
- **Exactly one panel is visible at a time** — the active panel has no `hidden` attribute; every other declared panel does.
- **Inactive panels are hidden and not reachable via normal keyboard navigation** — `Tab`/`Shift+Tab` from within the active panel never lands focus inside a `hidden` panel's content (native `hidden`-attribute behavior, verified against the rendered DOM, not assumed from the attribute's presence alone).
- **Form state inside a panel survives switching away and back** — type into the Locations tab's "+ Add Location" name field, switch to Contacts, switch back to Locations, confirm the typed value is still present (proves panels are genuinely still mounted, not just visually re-created).
- Two `Tabs` instances rendered on one page (e.g. in a future second consumer, or a test harness mounting two side by side) produce zero duplicate DOM `id` values across both instances.
- Keyboard navigation (`ArrowLeft`/`ArrowRight`) issued while focus is inside one `Tabs` instance only moves focus within that instance's own tabs, never into a second instance's tabs, confirming each instance's keydown handling is scoped to its own context value.

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
// any consumer (AccountForm.jsx, the Location add form, or the record
// page itself) -- the binding "must allow future expansion without
// redesigning the record page" constraint from the Architecture
// Decision.
<AddressFields
  value={{ street, city, state, zip }}
  onChange={(field, newValue) => /* caller updates its own state */}
  disabled={submitting}
  idPrefix="billing" // or "location-add" -- keeps input ids unique if more
                       // than one AddressFields instance ever renders on one
                       // page at once (defensive; today's approved scope has
                       // at most one mounted at a time -- the Customer edit
                       // form's billing address, or the Locations tab's
                       // "+ Add Location" form -- never both simultaneously,
                       // and never a per-existing-Location edit instance,
                       // since no Location edit action exists this sprint)
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
- Location **add** form gains real `<label>` elements (was placeholder-only) as a byproduct of using `AddressFields`. No Location edit action exists before or after this sprint.
- Primary-contact summary or a "No primary contact"/"Multiple primary contacts" state now appears in the header — previously, `AccountDetail.jsx` did not surface this at all in the header (only inside the Contacts list further down the page).
- No change to Global Search (Accounts), the Customers list page (`AccountsList.jsx`), or the "Back to Customers" navigation.

## Testing strategy

No Rules changed, so no new Rules-emulator test file — this sprint's testing is component/behavior-level, via this repo's established "standalone script or manual verification" pattern for non-Rules changes (`docs/ai/claude-code.md`'s testing responsibilities), plus live browser verification per PR (`run-field-ops-app-vite` skill or an equivalent one-off Playwright driver, matching the pattern used for PR #107's verification this session).

**Data states (all four required, per the Owner's testing expectations):**
- Existing Customer with a complete legacy address (`street`/`city`/`state`/`zip` all populated) — Details tab and header both render all four rows/the joined header line correctly.
- Existing Customer with a partial address (e.g. only `city`/`state` populated, `street`/`zip` empty or absent) — `addressRows()`/`formatAddress()` both omit the missing fields cleanly, no empty label, no stray comma.
- Customer with no address at all (`billingAddress: null`) — header omits the "Billing address" line entirely; Details tab's Billing Address section shows an explicit empty state (e.g. "No billing address on file"), not a blank section with just a heading.
- **Editing an existing Customer without changing any address field** preserves `billingAddress` byte-identically — verified by reading the document before and after a save that only touches, e.g., `notes`, confirming `billingAddress` is unchanged. **(Corrected in this revision — Location has no edit action; see the three Location-specific cases below instead of an equivalent "edit a Location" case.)**

**Location address cases (new in this revision, replacing the incorrect "editing a Location" case — Location has no edit action, only creation via "+ Add Location"):**
- A newly added Location stores the exact entered address — all four fields as typed, verified by reading the created document back and comparing to what was submitted through `AddressFields`.
- A newly added Location with a partial address (e.g. only `city`/`state` filled in, `street`/`zip` left blank) is preserved correctly — the stored `address` object reflects exactly what was entered, no field silently populated or dropped.
- A newly added Location with every address field left blank follows the existing supported behavior for a blank address: unlike `AccountForm.jsx`'s `hasAddress` check (which persists `null` when every field is empty), `LocationForm`'s current `handleSubmit()` (`AccountDetail.jsx:31-35`) always sends `address: { street: "", city: "", state: "", zip: "" }` — an object of empty strings, never `null`. This sprint does not change that asymmetry between Account and Location blank-address behavior; it is out of scope here (changing it would be a behavior change, not a presentation change) and is verified to remain exactly as it is today.

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
- **Rendered-DOM `Tabs` tests, per the corrected component contract (Technical design, Component 1 — all panels mounted, inactive ones `hidden`):** every tab's `aria-controls` resolves to a mounted panel `id`; every panel's `aria-labelledby` resolves to a mounted tab's `id`; exactly one panel is visible at a time; inactive panels are hidden and unreachable via normal keyboard navigation; form state inside a panel (e.g. an in-progress "+ Add Location" draft) survives switching away and back; two `Tabs` instances on one page produce zero duplicate DOM ids; keyboard navigation started inside one instance never moves focus into a second instance's tabs.

**Negative/scope-boundary checks:**
- No empty Work Orders/Activity/Invoices/Related tab renders anywhere.
- No fabricated summary value renders for a field that doesn't exist in the schema (no blank "Phone:" row, no "Website:" placeholder) — every header/section field is either populated from real data or entirely omitted.

## Rollback strategy

Entirely additive/presentational — no schema, no Rules, no migration, no new collection. If a defect is found post-merge:
- **Not yet deployed:** revert the PR(s) normally, no live impact.
- **Already deployed (frontend-only, auto-deploys at merge, same as every prior frontend-only PR in this initiative, e.g. PR #105/#107):** revert to the prior `AccountDetail.jsx`/`AccountForm.jsx` in a follow-up PR/deploy. No data was ever written in a new shape — `billingAddress`/`address` documents are read and written in exactly the shape they've always been, so a UI-only rollback has zero data-shape consequences in either direction.

## Acceptance criteria

- [ ] `Tabs`/`TabPanel` component exists, is reusable (no `AccountDetail`-specific assumptions baked in), owns its generated instance ID via Context (not an independently-reproduced `useId()` string), and implements the ARIA tablist/tab/tabpanel contract described above with `ArrowLeft`/`ArrowRight`/`Home`/`End` keyboard support, invalid-`activeTabId` fallback, and **every declared panel mounted at all times, inactive ones hidden via the native `hidden` attribute** (not unmounted).
- [ ] Rendered-DOM `Tabs` tests pass: every `aria-controls`/`aria-labelledby` pairing resolves to a mounted node, exactly one panel is visible at a time, inactive panels are unreachable via normal keyboard navigation, in-progress form state inside a panel survives switching tabs away and back, two `Tabs` instances on one page produce no duplicate DOM ids, and keyboard navigation stays confined to the correct instance.
- [ ] `domain/address.js`'s `formatAddress()`/`addressRows()` exist, are the sole address-formatting logic in the app (both inline call sites in `AccountDetail.jsx` removed), and return `null`/`[]` rather than an empty/malformed string for a missing address.
- [ ] `shared/address/AddressFields.jsx` exists, is consumed by **both** `AccountForm.jsx` and the Location **add** form (`LocationForm`), and renders four real `<label htmlFor>`-paired inputs (Street address/City/State/ZIP code). No Location edit action is added.
- [ ] `AccountDetail.jsx` renders a header (name, status, customer number if present, billing address if present, primary-Contact state, tags if present, one Edit action) and a Details/Locations/Contacts tab shell — no Work Orders/Activity/Invoices/Related tab rendered.
- [ ] Details tab shows the four sections (Customer Information/Billing Address/External Identifiers/Notes and Tags) in a two-column desktop layout collapsing to one column at the existing 900px breakpoint.
- [ ] Locations tab shows existing Locations as cards with structured address rows and preserves the existing add-Location function via `AddressFields`.
- [ ] Contacts tab shows existing Contacts as cards, preserves the primary badge/add-Contact function, and shows the multiple-primary warning when applicable.
- [ ] `primaryContactState()` (or equivalent) correctly derives NONE/ONE/MULTIPLE and both header and Contacts tab render the correct corresponding UI for all three.
- [ ] Editing a Customer without touching any address field leaves `billingAddress` byte-identical to its pre-edit value (verified, not assumed).
- [ ] A newly added Location stores exactly the entered address (complete, partial, or blank per the existing `LocationForm` behavior) — verified by reading the created document back, not assumed. No Location edit action exists.
- [ ] No Rules change: `firestore.rules` (both copies) byte-identical to `main` before this sprint, verified via diff.
- [ ] `npm run build && npm run lint && npm run typecheck` clean.
- [ ] Live browser verification (fresh emulator): complete-address Customer, partial-address Customer, no-address Customer, zero/one/multiple-primary-Contact Customer, desktop and narrow viewport, keyboard tab navigation — all pass, per Testing strategy above.
- [ ] Two-PR sequence followed (PR 1: tabs + shared components + header/tab shell + preserved related-record functionality; PR 2: reorganized Customer edit form + Location add form using the shared component + documentation/verification) unless the Implementation Plan documents evidence requiring a different split.

## Risks

- **First implementation of a genuinely new interaction pattern (tabs).** No existing precedent in this codebase to copy ARIA/keyboard behavior from — the contract above is specified from the WAI-ARIA Authoring Practices' standard tabs pattern, not derived from an existing component, so it carries more first-implementation risk than a typical bounded correction in this initiative.
- **Address-component reuse discipline.** The binding requirement that both Account and Location addresses use one shared component/utility is the main thing this Specification exists to prevent from silently drifting during implementation (e.g. building `AddressFields` for the Account form first, then a "close enough" second version for Locations under time pressure).
- **Data-preservation regression risk during the input swap.** Replacing four raw `<input>` elements with `<AddressFields>` in two different forms (`AccountForm.jsx`'s Customer edit form, `LocationForm`'s Location add form) is exactly the kind of mechanical change where a copy-paste or prop-wiring mistake could silently start writing `null`/an empty string over a previously-populated field — the explicit "load, save without touching, confirm byte-identical" test case above exists specifically to catch this class of bug before merge, not just to pad the test count.
- **Scope discipline on the header.** The record header is the most visually "Salesforce-reference-shaped" surface in this sprint — the concrete risk is quietly reintroducing a `phone`/`website`/`industry` placeholder row "because the reference screenshot has one," which the Architecture Decision explicitly forbids (no empty placeholders for fields that don't exist).
- **Mount-all-panels design does not introduce new listener overhead.** (New in this revision, addressing a natural question the "keep every panel mounted" correction raises.) `useLocationsForAccount`/`useContactsForAccount` are already called unconditionally at `AccountDetail.jsx`'s top level today (per Scope: "no new queries") — every panel being mounted simultaneously does not multiply `onSnapshot()` subscriptions or trigger any new data fetch; it only changes whether each tab's already-fetched content is visually hidden (`hidden` attribute) versus not, which is a rendering concern, not a data-fetching one.

## Open questions

None remaining that block implementation — the Architecture Decision resolved every item the Assessment raised, and this Specification's Technical design section resolves every component-contract question needed to implement it. Any question that surfaces during implementation (exact card/badge CSS class names, exact section ordering within a card) is an implementation detail, not an open architectural question, per this Specification's own Technical design section above.

## Approval

Awaiting ChatGPT Final Review of this Specification before an Implementation Plan is drafted. **No code has been written for this sprint.**
