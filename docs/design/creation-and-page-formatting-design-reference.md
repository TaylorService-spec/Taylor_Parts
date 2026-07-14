---
artifact_type: design-reference
gate: Design Reference
status: Architecture-Approved
date: 2026-07-14
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/creation-and-page-formatting-consistency.md]
implements: []
related_pr: null
related_issue: 214
target_release: TBD
---

# Design Reference: Creation / Edit / Modal / Wizard / Page-formatting Consistency

Related: [Assessment — Application-wide Creation/Edit/Modal/Wizard/Page-formatting Consistency](../assessments/creation-and-page-formatting-consistency.md) · Issue #214

This is the **approved target design** derived from the Architecture-Approved Assessment (merged via PR #215). It records the Owner's decisions so each migration PR can be implemented against a fixed reference. It is documentation only.

**Merging this reference authorizes no application migration.** It changes no application code, CSS, Firestore Rules, indexes, or backend; it deploys nothing; it edits no global/status document. Each migration below is its own separately-authorized gate; **PR-1 implementation does not begin until its separate authorization.**

The reference builds on **System A** (the newer `fo-wizard-*` field tokens + shared `Modal` at [`shared/ui/Modal.jsx`](../../field-ops-app-vite/src/shared/ui/Modal.jsx)), whose two current exemplars are the Work Order wizard ([`WorkOrderWizard.jsx`](../../field-ops-app-vite/src/modules/workOrders/WorkOrderWizard.jsx)) and the Contact CSV import ([`ContactImportModal.jsx`](../../field-ops-app-vite/src/modules/accounts/ContactImportModal.jsx)). It retires **System B** (`.fo-form` / `.fo-account-form`) incrementally.

## 1. Shared form primitives

Thin, **composable** React components built on the existing System-A `fo-wizard-*` tokens — **not** a large schema-driven form framework. Callers keep owning their own state, layout composition, and submit handlers; the primitives standardize markup, ARIA, and copy only.

Initial family:

- **`Field`** — label-above-control wrapper (`fo-wizard-field` / `fo-wizard-field-label` / `fo-wizard-control`), with consistent hint / required / per-field-error slots.
- **`FormActions`** — the action row (`fo-wizard-actions`), enforcing primary → secondary → separated-destructive order and narrow-layout stacking.
- **`FormError`** — a categorized, accessible error region (`role="alert"`) using the §6 vocabulary.
- **`FormStatus`** — an accessible live status region (`role="status"` / `aria-live`) for saving/success announcements.
- **`ConfirmDialog`** — part of the target family, but **implemented only with the separately authorized destructive-action migration (PR-3)**, not before.

Components must remain independently usable and composable; do not introduce a monolithic form engine or config-driven schema.

## 2. Container rules

Container choice is decided by the interaction shape, not by defaulting everything to a modal:

- **Shared `Modal`** — bounded create/import flows (e.g. Customer create, Contact/Location create, Contact CSV import).
- **Full-page wizard** — complex multi-step creation such as **New Work Order** (stays a dedicated wizard; not a modal).
- **Inline controls** — contextual state transitions performed in place on a record/list.
- **Confirmation dialog** — destructive or consequential transitions (see §4).

## 3. Contact and Location creation

Both move into the **shared `Modal`**:

- Customer/account context is **fixed by the surrounding page and is never a user-remappable field** (mirrors the CSV import's fixed-account behavior).
- Preserve the existing fields, permissions, and client-direct write paths ([`domain/contacts.js`](../../field-ops-app-vite/src/domain/contacts.js), [`domain/locations.js`](../../field-ops-app-vite/src/domain/locations.js)); this is presentation/container only.
- Validation and save failures **remain inside the modal** (the overlay stays open with categorized copy).
- On success the modal **closes once**, **announces** the result via a live region, allows the **live subscription to insert** the new record, then **moves focus to the resolved new row**.
- This decision does **not** automatically move *editing* into a modal; editing container is decided separately.

## 4. Destructive actions

- **Cancel, Void, and Reject** require confirmation via `ConfirmDialog`.
- **Reject** may collect its required reason **inside the confirmation surface**.
- Confirmation is a UX guard only: it **adds no authorization** and **cannot replace Firestore Rules enforcement** — Rules remain the security boundary.

## 5. Legacy screens

- [`Jobs.jsx`](../../field-ops-app-vite/src/modules/jobs/Jobs.jsx) and [`Technicians.jsx`](../../field-ops-app-vite/src/modules/technicians/Technicians.jsx) are **deferred**.
- Do **not** migrate them until an explicit **retain-or-replace** decision is made (PR-5).

## 6. Error vocabulary

`FormError` renders one of these categories; success/failure always use accessible live/alert regions:

- **Validation** — safe, actionable field-level information.
- **Permission** — an authorization message with **no raw provider detail**.
- **Unavailable** — service-unavailable / retry guidance.
- **Internal or unknown** — "operation failed and nothing was saved."
- Domain-specific validation detail is allowed **only when it is safe and actionable** (as in the CSV import's per-row reasons).

This matches the categorized copy already shipped in `getWizardCreateErrorMessage`, `accountSaveErrorMessage`, and `contactImportErrorMessage`.

## 7. Layout rules

- Label **above** the control.
- Control is **full-width within its field**.
- Consistent **hint / required / error** placement.
- Action order: **primary → secondary → separated destructive**.
- **Narrow layouts stack** the actions.
- Form/wizard **readable width capped near 56rem / 896px** (matches the WO Step-1 `fo-wizard-panel-wide` / PR #213 cap).
- **Tables and dashboards retain their wider content pattern** (the readable cap applies to forms/wizards, not data views).
- **No create form parked above or below its own live list** unless simultaneous context is genuinely essential (Rule R from the Assessment).

## 8. Approved migration sequence

Each PR is small and reversible; presentation-first; no PR depends on a later one. Implementation of each is separately authorized.

| PR | Scope | Boundary |
|----|-------|----------|
| **PR-1** | Shared primitives (`Field`, `FormActions`, `FormError`, `FormStatus`) **plus `AccountForm` migration** onto them | Presentation-only |
| **PR-2** | **Contact and Location creation modals** (§3) | Presentation + container change |
| **PR-4** | Shared **loading / empty / saving / success / failure** states | Presentation-only |
| **PR-3** | Workflow **action order / error copy** plus **Cancel / Void / Reject confirmations** (introduces `ConfirmDialog`) | Presentation + confirmation-dialog behavior |
| **PR-5** | Deferred **legacy Jobs / Technicians** retain-or-replace decision | Decision gate |

The numbering preserves the Assessment's dependency logic: PR-4's shared state tokens are available to PR-3's confirmation work, so PR-4 lands before PR-3.
