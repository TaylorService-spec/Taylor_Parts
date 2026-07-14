---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: 2026-07-14
owner: Claude Code
related_adrs: []
depends_on: [docs/PROJECT_ARCHITECTURE.md, docs/PlatformOperatingModel.md]
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: 214
target_release: TBD
---

# Assessment: Application-wide Creation / Edit / Modal / Wizard / Page-formatting Consistency

**Status: DRAFT (pending Architecture Review).** Assesses **Issue #214** only — the current divergence across the app's create/edit flows, modals, wizards, inline forms, and principal page layouts after PRs **#199** (Work Order wizard), **#201** (Customer creation overlay + shared `Modal`), **#211** (Contact CSV import), and **#213** (responsive picker). It inventories every user-facing flow into a matrix, proposes a consistency *system* (not an implementation), and recommends small, reversible migration PRs.

**Merging this Assessment authorizes NO migrations.** It changes no application code, CSS, Firestore Rules, or indexes; it deploys nothing; it accesses no production data; and it edits no global/status document (`ROADMAP.md`, `SPRINT_STATUS.md`, `CLAUDE_CONTEXT.md`, capability/entity models). Every migration named here is its own separately-authorized gate under `docs/ai/workflow.md`. It deliberately does **not** conclude that every creation belongs in a modal.

Verified against `origin/main` @ `48a497b`.

## 1. Current state — two coexisting design systems

The codebase currently runs **two form/layout systems** in parallel:

- **System A — "wizard/modal tokens" (the newer reference).** Shared `Modal` (`shared/ui/Modal.jsx`, PR #201) plus the field tokens `fo-wizard-field` / `fo-wizard-field-label` / `fo-wizard-control` / `fo-wizard-actions` / `fo-wizard-panel` / `fo-wizard-review` (from PR #199), with `role="status"` `aria-live` announcements and `role="alert"` error regions. **Used by:** the Work Order creation wizard (`modules/workOrders/WorkOrderWizard.jsx`) and the Contact CSV import (`modules/accounts/ContactImportModal.jsx`). These two are label-above-control, have consistent action rows, explicit disabled-state hints, and safe categorized error copy.
- **System B — "legacy `.fo-form`".** The classes `fo-form` / `fo-account-form` / `fo-form-field` / `fo-fieldset` / `fo-btn-row`. **Used by:** `AccountForm.jsx` (Customer create AND edit), the inline `ContactForm` / `LocationForm` defined inside `AccountDetail.jsx`, the inventory/reorder action surfaces, and the legacy `Jobs.jsx` / `Technicians.jsx` screens.

The single most visible inconsistency: the **Customer creation overlay** already uses the shared `Modal` (System A container) but wraps the **`AccountForm` System-B body** — so the same modal that renders the CSV-import flow (System A fields) renders Customer fields in the older token set. The reference already exists (`ContactImportModal` is a multi-step flow inside the shared `Modal` using System-A tokens); the work is to converge the rest onto it, not to invent anything.

**Two flows are already reference-quality and should be the templates:**
- **Work Order wizard** — the model for a genuine multi-step creation (progress indicator, per-step disabled-reason hints, review `dl`, explicit `getWizardCreateErrorMessage` categorized copy, viewport-fit dropdown from #213). It should **stay a dedicated full-page wizard**, not become a modal (§4).
- **Contact CSV import** — the model for a bounded multi-step import inside the shared `Modal` (step live-region, `fo-wizard-*` fields, review `dl` summary, save-error kept in the modal, all-or-nothing write).

## 2. Flow inventory matrix

Columns: (1) domain/route · (2) create/edit action · (3) presentation pattern · (4) width/spacing/type/action placement · (5) validation & disabled-state · (6) save/error/success · (7) keyboard/focus/dialog/SR · (8) responsive/overflow · (9) permission/write path & deps · (10) recommended target + priority + migration boundary.

Scope: this matrix inventories create/edit/movement flows and their state surfaces. Pure read-only lookup/filter/search forms (e.g. the `PartsList` history-lookup `.fo-inline-form`, global search) are **excluded** — they create/edit no record — but any submit-styling they share should follow the same token system once adopted.

### Customer / CRM–Sales

| # | Flow | Pattern | Layout / actions | Validation / disabled | Save / error / success | A11y | Responsive | Write path / deps | Target · priority · boundary |
|---|---|---|---|---|---|---|---|---|---|
| C1 | **Customer create** — `/customers`, `AccountsList` → `Modal` → `AccountForm` | Shared `Modal` (System A) wrapping **System-B** `AccountForm` | `.fo-account-form` grid; `.fo-btn-row` actions | validation beside fields; submit blocked on invalid; generic "fix highlighted" alert | `await onSubmit` → `accountSaveErrorMessage` in-form; overlay stays open on failure; success closes, clears hiding filters, announces, focuses new row | `Modal` focus-trap/Escape/restore ✓; form fields not on shared tokens | overlay 375px full-screen ✓ (PR #201) | `domain/accounts.js` client-direct, admin/dispatcher; governed fields Rules | **Migrate `AccountForm` body to System-A field tokens** · **P1** · presentation-only |
| C2 | **Customer edit** — `/customers/:accountId`, `AccountDetail` → inline `AccountForm` | **Inline** System-B form (not a modal) | inline `.fo-account-form` in detail page | same `AccountForm` validation | same `AccountForm` save path (edit) | inline; no dialog semantics (edit-in-place) | inherits `AccountForm` | same as C1 | Same token migration as C1 (same component) · **P1** · presentation-only |
| C3 | **Contact create** — `AccountDetail` inline `ContactForm` | **Inline** System-B form revealed below the Contacts list | `.fo-form`; `.fo-btn-row` "Add Contact"/Cancel | minimal (name); no shared hint tokens | client add; no explicit save-error UI on this inline form | toggle-reveal, no dialog; focus not managed | not specifically handled | `domain/contacts.js` client-direct | **Decide inline-vs-modal (§4/§9-Q2)**; at minimum System-A tokens · **P2** · presentation (+ possible container change) |
| C4 | **Location create** — `AccountDetail` inline `LocationForm` | **Inline** System-B form revealed below the Locations list | `.fo-form`; `.fo-btn-row` "Add Location"/Cancel | minimal | client add; no explicit save-error UI | toggle-reveal, no dialog | not specifically handled | `domain/locations.js` client-direct | Same as C3 · **P2** · presentation (+ possible container change) |
| C5 | **Contact CSV import** — `AccountDetail` → `ContactImportModal` | **Shared `Modal` + System-A tokens** (3 steps: select/map/preview) | `.fo-wizard-field`/`-control`/`-actions`; review `dl` summary | mapping-valid gate; disabled Validate/Import with reasons; over-limit message | `contactImportErrorMessage` in-modal; atomic `writeBatch`; success announces totals + focuses first new row | `Modal` semantics ✓; step `role=status` live region ✓ | `.fo-table-scroll` preview; modal responsive | `domain/contactImport.js` client `writeBatch`, Rules; **PR #211, merged** | **Reference — keep as-is** · **P0 (template)** · n/a |
| C6 | **Equipment create/edit** | **None — not built** (Equipment is a future capability; retired nav path redirects to `/customers`) | — | — | — | — | — | — | Out of scope (nothing to migrate) |

### Service / Work Orders

| # | Flow | Pattern | Layout / actions | Validation / disabled | Save / error / success | A11y | Responsive | Write path / deps | Target · priority · boundary |
|---|---|---|---|---|---|---|---|---|---|
| S1 | **Work Order create** — `/service/work-orders/new`, `WorkOrderWizard` | **Full-page wizard, System A** (4 steps) | `.fo-wizard-panel` (Step 1 `-wide` to ~56rem, #213); progress indicator; `.fo-wizard-actions` | per-step `stepBlockedReason` hints; disabled Next explains itself | `getWizardCreateErrorMessage` categorized copy (invalid-argument/unauth/permission/unavailable/internal); success → detail route | native keyboard, `aria-current` step, combobox picker with viewport-fit dropdown (#213) | responsive; Step-1 picker scales/flips (#213) | `services/workOrderService.ts` → `createWorkOrder` **Cloud Function (undeployed, #15)** | **Reference — keep a dedicated wizard** · **P0 (template)** · n/a |
| S2 | **WO lifecycle actions** — `WorkOrderActions` / `TechnicianWorkOrderActions` (detail pages) | **Inline action panel, System B** | `.fo-form` + `.fo-btn-row` | action-specific | transition via CF | inline buttons; no dialog | not specifically standardized | `transitionWorkOrder` CF (undeployed, #15) | Align error copy + action-order to system; some transitions warrant **confirmation dialog** (§4) · **P3** · presentation + confirmation-dialog behavior |
| S3 | **Legacy Job/Technician create** — `Jobs.jsx`, `Technicians.jsx` | **Inline `.fo-form` ABOVE the result table** (System B) | `.fo-form` above `.fo-table` | minimal | `domain/jobActions.js` client-direct | inline; no dialog | not standardized | `jobActions.js` client-direct (still live) | **Anti-pattern (§ rule R)**: inline-create-above-live-list. Lower priority (legacy screens) · **P4** · presentation (+ container decision) |

### Inventory / Reorder / Procurement

| # | Flow | Pattern | Layout / actions | Validation / disabled | Save / error / success | A11y | Responsive | Write path / deps | Target · priority · boundary |
|---|---|---|---|---|---|---|---|---|---|
| I1 | **Reorder request create** — `RequestReorderControl` (`PartDetail`/`PartsList`) | **Inline workflow control/action, System B** | inline control; manual-qty entry for NEEDS_PLANNING | eligibility-gated; manual-qty guarded | client write; error handling added in PR #73 | inline | not standardized | `domain/inventoryReorderRequests.js` client-direct + per-role Issue #100 Rules | **Inline workflow action** (correct container); align tokens/error copy · **P3** · presentation |
| I2 | **Reorder review / reject** — `RejectForm` (reorder flow) | **Inline `.fo-form`, System B** | `.fo-form` reason field | reason required | client write | inline | not standardized | `inventoryReorderRequests.js` + Rules | Inline action or **confirmation dialog** (reject is consequential); align copy · **P3** · presentation (+ possible confirmation dialog) |
| I3 | **Purchase Order / receiving / Cancel / Void** — `PartDetail` / reorder flow | **Inline workflow actions, System B** | 6 `.fo-form` blocks in `PartDetail` (+ `RequestReorderControl`) | action-specific; Void requires a linked PO | client write / `runTransaction` | inline | not standardized | `reorderPurchaseOrders.js` client-direct + Rules; Cancel/Void PR #138 merged | Inline workflow actions (correct container); **Cancel/Void are destructive → confirmation-dialog pattern (§4)**; align copy · **P3** · presentation + confirmation-dialog behavior |
| I4 | **Warehouse → Truck stock transfer** — `Inventory.jsx` (`handleTransfer`) | **Inline `.fo-form`, System B** | `.fo-form` in a `.fo-card`: part `select` + qty `input` + submit; no field grid/labels/hints | none (bare `min="1"`; no disabled/guarded state) | client write; **no explicit save-error or success surface** | inline; no dialog | not specifically handled | client-direct stock write / Rules | Align to System-A field tokens + add validation/error/success states · **P4** · presentation |
| I5 | **Inventory panel stock actions** — `operations/panels/InventoryHealthPanel` etc. | Inline panels, System B | panels | — | client/logged | inline | not standardized | `inventoryActions.js` / Rules | Align tokens/copy · **P4** · presentation |

### Administration / Identity

| # | Flow | Pattern | Notes |
|---|---|---|---|
| A1 | **Employee / User / Role administration** — Administration domain nav | **Not built** — renders via `PlaceholderPage`; there is **no in-app Employee/User/Role create/edit component**. Provisioning is the out-of-app Admin-SDK script `functions/scripts/provisionEmployeeAccess.js` (see the Issue #140 assessment). | **Out of scope for a UI-consistency migration** — there is no flow to migrate. When an in-app admin console is later specified (its own gate), it must adopt the consistency system from day one. |
| A2 | **Login** — `auth/Login.jsx` | `<form>` sign-in (single, distinct auth surface). | Not a create/edit product flow; low priority; may adopt shared field tokens for polish · **P4** · presentation. |

### Cross-cutting states (observed)

- **Loading:** ad hoc — `role="status"` "Loading…" text (`AccountsList`), per-screen spinners/text; no single token.
- **Empty:** ad hoc per screen ("No customers yet", "No contacts yet", filtered-no-results).
- **Validation error:** System A = beside-field + `role="alert"` (WO wizard, CSV); System B = `.fo-warning` (`AccountForm` has explicit per-field errors; inline forms are minimal).
- **Permission error:** only the export/governed paths reason about it explicitly; most flows surface a generic message.
- **Save error:** System A keeps the modal/step open with categorized copy (`accountSaveErrorMessage`, `contactImportErrorMessage`, `getWizardCreateErrorMessage`); System-B inline forms often lack an explicit save-error surface.
- **Success:** System A announces via `role="status"`/`aria-live` and moves focus to the resolved new record (Customer overlay, CSV import); most System-B flows do neither.
- **375px:** overlay + WO wizard + picker verified (PRs #201/#199/#213); inline System-B forms and legacy screens are not viewport-verified. (Note: a **pre-existing app-shell primary-nav horizontal overflow at 768/1024** — `nav.fo-nav` — is unrelated to these flows and out of scope, per the PR #213 review.)

## 3. Proposed consistency system (specification of intent — NOT implemented here)

1. **Page header & content width.** One page-header pattern (title + primary action row) and one readable content max-width per surface type: forms/wizards use the Step-1 wide precedent (`min(available content, ~56rem/896px)`); dashboards/tables use the existing `.fo-main` 960px. No page introduces its own fixed narrow cap.
2. **Section/card spacing & typography.** One vertical rhythm (single gap scale) and one type scale for title / section-title / label / body / muted; reuse existing tokens rather than per-screen values.
3. **Field grid, labels, hints, required-state.** Standardize on the System-A field unit: **label above control**, control full-width of its container, an optional hint line, and an explicit "(required)" marker — the `fo-wizard-field`/`-control` tokens already used by the WO wizard and CSV import.
4. **Action order.** One order everywhere: **primary → secondary → (destructive separated)**, right-aligned via `.fo-wizard-actions`; single column on narrow screens.
5. **Error copy.** One categorized-copy helper family (the WO-wizard `getWizardCreateErrorMessage` is the model): **validation** (safe field detail), **permission** (authorization), **service-unavailable**, and **internal/unknown** (failure + "nothing was saved", never a raw provider detail). Generalize the three existing per-flow helpers into one shared vocabulary.
5b. **Loading / empty / saving / success / failure states.** One token set: a `role="status"` loading line, a per-surface empty state with an optional primary action, a disabled "Saving…" submit, a `role="status"`/`aria-live` success announcement, and an in-place failure region that never discards entered data.
6. **Modal behavior.** All modals use the shared `Modal` (`role="dialog"`, focus trap, initial focus, Escape/Cancel/backdrop close, background blocked, scroll lock, focus restored to trigger) — already delivered by PR #201.
7. **Container-choice criteria** (the core product rule — do **not** default everything to a modal):
   - **Modal** — a *bounded* create/import/edit that is a detour from the current page and does not need the page visible behind it (Customer create, Contact CSV import). ≤ ~1 screen of fields.
   - **Full-page multi-step wizard** — a *complex, multi-step* creation with its own progress/branching where each step needs room and context (New Work Order). **Stays a wizard**; it follows the same visual/field/error system but is **not** forced into a modal.
   - **Inline workflow action** — a state transition on an entity already on screen, executed in place (reorder request, WO lifecycle transitions, purchasing steps). Stays inline; adopts shared tokens/error copy.
   - **Confirmation dialog** — a small, focused confirm for a **destructive/irreversible** action (Cancel/Void, reject, delete). A minimal shared confirm surface (not a full form).
8. **Responsive breakpoints & readable max width.** One breakpoint set (the existing 480px form breakpoint + the tablet/desktop sizes verified in #213) and the readable form max (~56rem) as the single rule; no per-flow ad hoc widths.
9. **Focus restoration & post-save insertion.** On close: focus returns to the trigger (shared `Modal`). On success: the **live subscription** inserts the new record (no manual insert/refetch), hiding filters that would conceal it are cleared, success is announced, and focus moves to the resolved new record — the pattern PR #201 established for the Customer overlay and PR #211 for CSV import.
10. **Rule R — no inline create/edit form parked above/below its own live list unless the workflow genuinely needs simultaneous context.** `Jobs.jsx`/`Technicians.jsx` (create-form-above-table) violate this; the Contact/Location add-forms sit below their lists (contextual, borderline — see Q2). Reorder/PO/lifecycle *transitions* are legitimately in-context and are exempt (they act on the row in view).

## 4. New Work Order specifically

New Work Order **should remain a dedicated full-page wizard**, not be collapsed into a modal: it is genuinely multi-step (customer → location → service details → review), each step needs horizontal room (the #213 wide Step-1 picker), and it depends on the undeployed `createWorkOrder` Cloud Function (#15). It already *is* the System-A reference for wizards. The only consistency work it needs is to remain the canonical example the other flows converge toward — no container change.

## 5. Recommended migration PRs (small, reversible; each separately authorized)

> Shared prerequisite for all: a short **design-tokens/consistency reference** (either an ADR or a `docs/` design-note, itself a separate governance gate) that names the System-A tokens, the container-choice criteria (§3.7), the error-copy vocabulary (§3.5), and Rule R. No CSS/JSX changes until that reference is accepted.

- **PR-1 — `AccountForm` onto System-A field tokens (Customer create + edit).** *Scope:* `AccountForm.jsx` (+ scoped `index.css`, driver assertions). *Presentation-only* (no field set, validation, governed-field Rules, or write-path change). *Prereq:* tokens reference. *Verify:* `verify-customer-create-overlay`, `verify-account-form-layout`, `verify-commercial-profile`, `verify-governed-fields` (all must stay green), + width/label/action assertions. *Order:* first (highest-traffic, self-contained). *Rollback:* revert one component + its CSS block. *Decision:* none.
- **PR-2 — Inline Contact/Location add-forms (`AccountDetail`).** *Scope:* the inline `ContactForm`/`LocationForm` in `AccountDetail.jsx` (+ CSS/driver). *Presentation* (+ a **container decision**, Q2). *Prereq:* PR-1 patterns. *Verify:* a new `verify-account-detail-forms` + existing Customer regressions. *Order:* after PR-1. *Rollback:* revert `AccountDetail` form blocks. *Decision:* **Q2 — modal vs inline-with-context.**
- **PR-3 — Workflow-action error copy + action order (Inventory reorder / WO lifecycle).** *Scope:* `RequestReorderControl`, reorder reject, `WorkOrderActions`/`TechnicianWorkOrderActions` — align to the shared error-copy vocabulary and action order; introduce the **confirmation-dialog** pattern for Cancel/Void/reject. *Presentation + one behavior addition* (confirmation step). *Prereq:* tokens reference + a shared confirm surface. *Verify:* extend `verify-cancel-void`, `verify-pr-a`, reorder browser commands. *Order:* after PR-1/2. *Rollback:* per-component. *Decision:* **Q3 — is a confirmation dialog required for Cancel/Void/reject (behavior change)?**
- **PR-4 — Cross-cutting state tokens (loading/empty/saving/success/failure).** *Scope:* a small shared set of state components/classes + adopt on the highest-traffic screens. *Presentation-only.* *Prereq:* tokens reference. *Verify:* per-screen state assertions. *Order:* can parallel PR-2/3. *Rollback:* remove the shared components. *Decision:* none.
- **PR-5 — Legacy `Jobs.jsx`/`Technicians.jsx` (Rule R).** *Scope:* the create-form-above-table legacy screens. *Presentation (+ container decision).* *Prereq:* PR-1/4. *Verify:* new browser coverage. *Order:* last (lowest traffic, legacy). *Rollback:* per-screen. *Decision:* **Q4 — align in place vs defer (are these screens slated for replacement?).**

No PR migrates the New Work Order wizard's container (§4), Employee/User admin (unbuilt, A1), or Equipment (unbuilt, C6).

## 6. Unresolved decisions (Owner / product / architecture)

- **Q1 — Tokens as CSS-only or a shared React component set?** Reuse the `fo-wizard-*` classes as-is, or extract a `Field`/`FormActions`/`FormError`/`ConfirmDialog` component family. (Architecture; affects every migration PR's shape.)
- **Q2 — Contact/Location creation: modal or inline-with-context?** They are contextual to the open Account, but sit below live lists (borderline Rule R). Product/UX decision.
- **Q3 — Confirmation dialog for destructive actions (Cancel/Void/reject)?** This is a **behavior** change, not just presentation. Product decision.
- **Q4 — Legacy `Jobs.jsx`/`Technicians.jsx`: align or defer?** Depends on whether these screens are slated for replacement. Roadmap decision.
- **Q5 — Error-copy vocabulary ownership.** Generalizing three per-flow helpers into one shared vocabulary is low-risk, but the exact wording is a product/UX decision.

## 7. Scope honored / not done

This is the assessment artifact only. No application code, CSS, Firestore Rules/schema/index change, migration, deployment, or production-data action was made; no global/status document was edited; no ADR, design-note, or Specification was authored; and no migration was started. The New Work Order wizard, the Employee/User admin (unbuilt), and Equipment (unbuilt) are explicitly excluded from container migration. Every recommendation above remains a separate, individually-authorized gate.
