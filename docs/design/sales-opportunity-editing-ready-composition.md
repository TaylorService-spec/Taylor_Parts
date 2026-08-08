# Sales Opportunity — Editing-Ready Detail Composition

**Status:** Design + repo-only implementation. Fail-closed; nothing activated, deployed, or Rules-widened.
**Scope:** the Opportunity Operating Workspace detail pane (`field-ops-app-vite/src/modules/sales/SalesWorkspace.jsx`)
and its pure field-classification model (`src/domain/opportunityFieldModel.js`).

## Why

The Opportunity workspace is intended to become an **operating** workspace: once its governed write authority
is activated, authorized users will **maintain** Opportunity information here. The detail pane must therefore be
composed now to support **both** read/scan **and** edit/operate — responsively, at desktop, tablet, and phone —
**without** requiring another structural redesign when writes turn on. It must do this **without** becoming a
permanent wall of form controls, and **without** activating anything to validate the composition.

This document records the data model and the interaction/responsive decisions. It deliberately leaves the
*final* interaction polish (inline vs. section vs. explicit edit mode) to UX; the composition here **accommodates
all of them** so UX can choose without a rebuild.

## The four data classes (never collapse them)

The core of the design is that **not every displayed value is an editable field.** Each datum is classified,
and the classification — not the current read-only state — drives the composition. Classification lives in a
pure module (`opportunityFieldModel.js`, `OPPORTUNITY_DATA_CLASS`) so it is unit-tested and reused, and it is
kept **separate from runtime write-readiness**: the data model says a field *can* be maintained; the
write-readiness seam (`access/opportunityWriteReadiness.js`) says whether it *may* be maintained right now.

| Class | Meaning | Rendered as | Examples |
|---|---|---|---|
| **USER_MAINTAINED** | Business data an authorized user maintains | Read value + contextual **Edit** (fail-closed) | customer need/description, solution lines (product/model/part + qty), estimated value, expected close date, next action, Channel, owner reassignment (governed), future qualification fields |
| **SYSTEM_DERIVED** | Computed from Opportunity facts | Read-only; **no** edit affordance | Attention reasons, commercial state label/tone |
| **LIFECYCLE_ACTION** | Governed state transition | Explicit lifecycle actions, **not** a field edit | Stage advance, **WON**, **LOST** |
| **READ_ONLY** | Identity + audit | Immutable | opportunity ID, createdAt, updatedAt |

Consequences enforced in code + tests:

- **Stage is never a `<select>`.** Advancing stage / marking WON / LOST are governed transitions rendered by
  `LifecycleActions`, gated by the same readiness seam. The field model contains **no** `stage`/`outcome`
  field (`opportunityFieldModel.test.mjs` asserts this).
- **Attention is not hand-editable.** You change the underlying fact (add a next action, move the close date)
  and the derivation follows. Attention renders as read-only tone pills.
- **IDs / audit timestamps are read-only.** Absent audit timestamps on synthetic fixtures render honestly as
  “not recorded” — never a fabricated value.
- **Owner reassignment is USER_MAINTAINED but *governed*.** It is an authorized change, flagged `governed` in
  the model and labelled “· governed” in the form. The employee directory is not connected yet (accountOwner is
  free text; ADR-012 has no team/scope model), so the control is honest about recording an owner id rather than
  faking a picker.
- **Channel** edits from the ratified `SALES_CHANNELS` set. Making Channel fully-configurable reference data
  and adding `STRATEGIC_ACCOUNTS` belongs to **Commercial Coverage & Territory (capability #15)**, not this
  work; the control reads the const so it widens automatically when #15 lands.
- **Qualification** is a preserved **seam**: a USER_MAINTAINED section that renders “not configured yet” with
  zero invented fields until Product ratifies a qualification schema.

## Interaction: section-level editing (the responsive default)

The detail reads cleanly by default. Editing is **contextual and section-level**:

- Each USER_MAINTAINED section shows a quiet **Edit** affordance in its header.
- Entering edit **swaps that section’s read body for a compact form**; **only one section edits at a time**.
- **Cancel** always returns to read with no side effects. **Save** hands the section’s draft (its
  USER_MAINTAINED fields only) to the governed command.

Why section-level is the composition that scales: a single section’s form is a **short, single-column stack**
at every width. It never becomes a desktop multi-column form that has to be squeezed into a phone. This is the
interaction that satisfies “support READ/SCAN and EDIT/OPERATE without squeezing a desktop form into smaller
widths.” Inline single-field editing (e.g. next action) and an explicit per-section edit mode are both
expressible within this same structure, so UX can tune the affordance without a structural change.

## Responsive behaviour (evaluated at three widths)

The detail pane is the workspace’s supporting aside (`WorkspaceShell` `supporting` slot). Its responsive model
is **recomposition, not shrink**, reusing the shell’s existing breakpoint:

- **Desktop (≥ ~1024px):** detail is the right-hand rail (`.fo-workspace__body--split`, ~260–340px). Read rows
  scan compactly; an open section form is a single-column stack in the rail.
- **Tablet / intermediate:** same rail until ≤860px, where `.fo-workspace__body--split` collapses to one column
  and the detail stacks **full-width** beneath the pipeline. Section forms gain width but stay single-column.
- **Phone (≤640px):** field label/value rows collapse to stacked pairs; the solution-line editor’s controls each
  take a full row (`.fo-sales-lineedit__row .fo-input { flex-basis: 100% }`) so nothing is cramped.

No width renders a wall of standing controls: controls exist only inside the one section being edited.

## Fail-closed posture (no activation to test the composition)

- Field editing **and** lifecycle transitions are governed writes, both gated by
  `opportunityWriteReadiness()`. Today it returns `{ enabled: false }` (capability `opportunity.write`
  ungranted; command not deployed), so every **Edit** and lifecycle button renders **disabled with an honest
  reason** — the same posture as the inert “New opportunity” control.
- **Save** is additionally gated on a wired governed command (`onSaveSection`). With readiness enabled but no
  command wired, Save is disabled and honest (“command not wired”). No Firestore, no callable, no Rules change.
- The composition is validated by **injecting** readiness/`onSaveSection` in tests and by fixture state — never
  by granting a capability, deploying a callable, or widening Rules.

## Activation path (later, separately authorized)

When a future cycle grants `opportunity.write` and deploys the transition/maintenance callables:

1. `opportunityWriteReadiness()` flips to `{ enabled: true }` → all Edit/lifecycle affordances become live with
   **no structural change** here.
2. `SalesWorkspace` is passed an `onSaveSection(sectionId, draft)` wired to the governed maintenance callable
   (server re-validates and remains the authority; the client only offers the actions the domain graph allows).

## Pipeline responsive content priority (reconciliation)

The original observed defect lived on the **pipeline** (master), not the detail: at intermediate widths the
six-column table overflowed its grid cell and **collided with the detail rail** (labels/values compressed, the
desktop master/detail squeezed rather than recomposed). The editing-ready detail work did not touch this, so it
was reconciled separately with an intentional **content-priority** strategy — recompose, never squeeze:

- **Overflow-safe wrapper** (`.fo-sales-pipeline-wrap`, `overflow-x:auto`) — a hard backstop so the pipeline can
  never paint over the detail rail. It is a guarantee, not the mechanism; the priority rules keep the table
  fitting so its scrollbar effectively never appears.
- **Column priority** — the highest-value Sales columns (Customer / Stage / Est. value / Attention·next) always
  show; the lower-priority **Channel** and **Expected close** (`.fo-sales-col--secondary`) are **deferred** at
  ≤1024px and remain visible in the **detail pane** for the selected opportunity. Information is deferred, not
  lost. This ordering is a starting point, not immutable — UX may revise it with evidence.
- **Phone recomposition** (≤640px) — each row recomposes from a squeezed table row into a compact **labelled
  block** (thead visually hidden for AT; each cell carries a `data-label`). A legible list, not a card farm.

Verified in a real browser (synthetic source, no auth/emulator) by measuring actual layout geometry at
**~400 / 768 / 900 / 1360px**: before, at 900px the table right edge (593px) overlapped the detail aside (left
529px); after, it sits clear (509 < 529), no wrapper scroll, no page horizontal scroll, master/detail intact at
desktop, and the phone block recomposition shows the four priority fields. jsdom has no layout engine, so the
regression tests lock the enabling **structure** (wrapper + secondary classes + per-cell data-labels) rather
than pixels.

## Tests

- `test/opportunityFieldModel.test.mjs` (node:test) — data-class classification, control types, governed owner,
  honest audit rendering, Stage/WON/LOST excluded from fields, `editableSectionIds`/`sectionDraft`, channel
  options from `SALES_CHANNELS`, null-row safety.
- `test/salesWorkspace.test.jsx` (vitest + jsdom) — reads by default (disabled Edit affordances, no standing
  controls); enabling readiness opens a section form; Cancel returns; one-section-at-a-time; Save inert without a
  wired command; Save with a wired command hands the section draft to the command; derived/read-only sections
  expose no edit affordance; **pipeline responsive priority** — overflow-safe wrapper, Channel/Expected-close
  flagged secondary in header + rows, every cell carries a `data-label`.
