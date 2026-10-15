# EOS Compact UX Standard

Status: **PROPOSED, first slice in review.** Owner direction 2026-10-15 ("EOS DESIGN — SITE-WIDE COMPACT UX
STANDARD"). Presentation only: no server behaviour, permission, capability, data model, workflow or
Firebase-migration change. Developed under the direction of Rudy DiGiorgio using AI-assisted engineering tools.

Page inventory and rollout: [`compact-ux-page-inventory.md`](compact-ux-page-inventory.md).

This standard **extends** the existing design system rather than replacing it:
[`eos-north-star-design-grammar.md`](eos-north-star-design-grammar.md) (action architecture §4, honest-state
model §5, page archetypes §6), [`eos-design-system-architecture.md`](eos-design-system-architecture.md)
(WorkspaceShell, the card-farm diagnosis) and [`contextual-help-layer.md`](contextual-help-layer.md)
(empty-state guidance). Where they already decide something, this document points at them.

**The goal, in one sentence:** an employee opening a page sees their work, the data that matters to their role,
and the actions they can take, before they see any explanation.

---

## 1. Spacing and type scale

Use the existing tokens (`index.css :root`). No new spacing values.

| Gap | Token | Use |
|---|---|---|
| Page header → work area | `--space-3` (12px) | Every page. Set once on `.fo-page-header`; was 20px |
| Header title → subtitle | `--space-1` (4px) | Built into `PageHeader` |
| Toolbar → table/queue | `--space-3` (12px) | `.ns-toolbar` |
| Between sections | `--space-5` (20px) | Never more than one section gap in a row |
| Inside a row/list item | `--space-1`–`--space-2` | Rows stay ≥ 44px tall for touch |

- **One display-type title per page** (`PageHeader`, h1). Section titles use `SectionHeader` (interface type,
  `--font-size-lg`, or `--font-size-md` for a small block). A section title never repeats the page title.
- **No empty decoration.** No card whose only content is prose; no spacer elements; no hero blocks.
- **12px floor** for visible text (`--font-size-sm` is 12.5px); `--font-size-xs` only for labels and badges.

## 2. Page header — `PageHeader` / `WorkspaceShell`

`shared/ui/primitives/PageHeader.jsx` (via `WorkspaceShell` → `WorkspaceHeader` on workspaces).

| Slot | Rule |
|---|---|
| `title` | The thing the page is, in the nav's words. Short noun phrase. |
| `description` | **Optional, one line** (≲ 60 characters): what the page is for. Never a paragraph, never two. |
| `help` | **New.** Anything longer: background, how the page relates to others, rollout notes. Renders as an `InfoTip` beside the title. |
| `actions` | The page's primary action (one filled) and at most two secondaries, **beside the title**. |

Requirement 1 (concise titles) and 4 (actions beside the title) are this component. A page that hand-rolls
`<h2>` + intro `<p>` is migrated to it.

## 3. Toolbar — `Toolbar`

`shared/ui/primitives/Toolbar.jsx`. One row directly under the header holding search, view chips
(`FilterBar`), sort and secondary controls. Reuses the North Star `.ns-toolbar` styling. Search and essential
filters stay visible; they are never collapsed behind a "Filters" button on desktop (requirement 5). Layout only:
each page still owns its controls and what they do.

## 4. Secondary explanation — `InfoTip` and field help

`shared/ui/primitives/InfoTip.jsx`. The one place explanation goes once it leaves the page body
(requirement 2). Also exposed as:

- `PageHeader help=…` / `WorkspaceShell help=…` — page-level explanation beside the title;
- `Field help=…` — field-level explanation beside the label. `Field hint=…` stays for what the user needs
  to fill the field in correctly (format, limits, required instructions); that is **not** moved into a tip.

**Accessibility contract (requirement 9) — every item is tested in `test/compactUxStandard.test.jsx`:**

| Input | Behaviour |
|---|---|
| Mouse | Opens on hover, closes on leave |
| Keyboard | The trigger is a real `<button>` in tab order; opens on focus, closes on blur; **Escape** closes without moving focus |
| Touch | Tap toggles it open (no hover on touch); tapping again or anywhere else closes it |
| Screen reader | The tip is the button's `aria-describedby` description, so it is announced on focus whether or not it is visible; the button has an `aria-label` ("About …") |
| Size | 24px glyph inside a 44×44 hit area; visible focus ring |
| Placement | `position: fixed`, placed from the trigger and kept on-screen; never clipped by a panel's overflow; above modals |

Tip copy is plain text, one to three sentences. No links or controls inside a tip (a tooltip is not
interactive); if the explanation needs a link, it belongs in an expandable section or the user guide.

## 5. Dense content over explanatory cards

Requirement 3, 6 and 7. Prefer, in order: a table or queue (`.fo-table`, metadata list grid); a compact list
(`.fo-compact-list`: name, one-line summary, InfoTip — one ≥ 44px row each); key/value facts (`.fo-facts`:
label left, value right); and only then a card.

- A stack of cards that each hold a title and a paragraph becomes a compact list.
- A status block written as sentences ("Loaded build: x. Deployed: y.") becomes `.fo-facts`.
- Show the fields a role acts on first; secondary fields go into a details disclosure or the record page.
  This standard never hides a field the role needs to do the job (requirement 10).

## 6. What always stays visible (requirement 8)

Never moved into a tooltip, collapsed section or secondary tab:

- errors and failed reads (`HonestState` UNAVAILABLE, `FormError`, `role="alert"` lines);
- warnings and stale-state notices (e.g. "Your loaded app is behind the deployed version");
- authorization refusals and capability-not-enabled states (`HonestState` DENIED / NOT_ACTIVATED,
  grammar §5 — one sentence, once);
- approvals and decisions awaiting the user, and blocked-action checklists (grammar §4);
- required instructions: anything the user must do or know to complete the task correctly, including
  `Field hint` and required-field markers;
- honest-state text that distinguishes "none", "none match", "not available to you" and "could not load".

## 7. Status and empty states

Already standardized — reuse, don't re-invent:

- status: `StatusPill` (inline/table), `StatusIndicator` (standalone line), `AttentionBand` (above the work
  area), one tone vocabulary (`shared/ui/tone.js`);
- empty/unavailable/denied: `HonestState` and `EmptyState` (`variant` database vs filtered; `guidance` only on
  a first-run empty, per [`contextual-help-layer.md`](contextual-help-layer.md)).

The compact rule for both: one line where one line is enough. An empty state is a sentence and an action, not
a card with an illustration and a paragraph.

## 8. Applying the standard

- Apply through the shared components, not one-off CSS. A page that needs a new pattern adds it here first.
- Move text, don't delete meaning: an intro paragraph becomes `help`, a card's paragraph becomes a row's
  InfoTip. Truthfulness tests that pin wording keep passing because the wording still exists.
- No behaviour change: same reads, same routes, same capability gates, same actions in the same places of
  authority. A compact PR that changes what data is fetched or who can do what is out of scope.
- Every compact PR carries before/after screenshots at 1440px and 375px, rendered with the credential-free
  visual harness (`test/__visual__/`, `VISUAL=1`).
- Reserved files (navigation, My Work, AdminWorkflows, Work Order detail, data import, equipment) are
  migrated only by, or with a handoff from, the lane that owns them (`docs/engineering/ACTIVE_WORKSTREAMS.md`).
