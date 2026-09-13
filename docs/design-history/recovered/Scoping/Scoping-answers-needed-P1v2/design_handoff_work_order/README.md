# Handoff: Work Order Detail — North Star recomposition (page family 1 of N)

## Overview
Replace the PRESENTATION of the Work Order detail route (`/service/work-orders/:workOrderId`) in the EOS frontend (`field-ops-app-vite/`, React + Vite) with the approved North Star composition, while preserving every existing behavior, read, write path, and authority check unchanged. This is the first page family; STOP after it renders for Owner visual approval before touching any other family.

Division of truth:
- **Visual/compositional source of truth:** the bundled design reference `North Star - Work Order.dc.html` (and the annotations below). The implementation must materially reproduce ITS composition, hierarchy, density, geometry, typography, lifecycle treatment, action architecture, content/rail proportions and first-viewport experience — not a reinterpretation into the existing EOS composition. Where the concept shows capabilities that do not exist (suggestion engine, live truck-stock reads, ETAs, prediction, presence, dispatcher-context reads), keep the designed structural slot and render a truthful state — never fabricated data.
- **Behavioral source of truth:** the existing EOS code — hooks, domain projections, trusted commands, capability gates, firestore.rules. Never reimplement or bypass them.

## About the design files
The bundled HTML files are **design references** (hi-fi prototypes), not production code. Recreate them in the existing React codebase using its established patterns (function components, existing hooks, `index.css` classes/tokens). Do not ship the HTML, do not add new dependencies, do not introduce a CSS-in-JS layer.

## Fidelity
**High-fidelity.** Colors, type, spacing, and copy in the reference are final. All colors already exist as tokens in `src/index.css` (`--verenward-*`, `--color-*`); use tokens, never raw hex. The serif display face is new: add Source Serif 4 (self-host under `src/assets/fonts` alongside the existing Inter/Barlow files, same @font-face pattern) as `--font-display-serif`. Numerals in tables stay Inter with `.fo-tabular-nums`.

## Files you will touch (and only these)
- `src/modules/workOrders/WorkOrderDetailPage.jsx` — route wrapper; becomes the North Star page composition.
- `src/modules/controlTower/WorkOrderDetail.jsx` — legacy card; its CONTENT (timestamps, complaint/diagnosis, history) is absorbed into the new composition. Keep the file exports working for ControlTower.jsx (which still uses it) — do NOT delete or restyle it globally; the new route stops rendering it.
- `src/modules/controlTower/WorkOrderActions.jsx` — keep as the action source; render its buttons inside the new header action cluster (see Actions). Its state-gating logic is untouched.
- `src/modules/workOrders/WorkOrderPartsPlanEditor.jsx` — reused as-is inside the "Parts" section (it already owns the governed plan write + capability gate).
- `src/index.css` — additive classes only (prefix `ns-`), listed under Design Tokens. Do not modify existing `fo-*` rules.

## Do NOT touch (behavioral authority)
`transitionWorkOrder`, `getAllowedActions`, `READ_ONLY_STATUSES`, `useWorkOrder`, `useAccount`, `useLocation`, `useEquipmentDoc`, `useWorkOrderPartsPlanCapability`, reference resolvers, MetadataRecordPage/workOrderRecordPage definitions (simply stop rendering the metadata grid on this route — the fields it showed all appear in the new composition), firestore.rules, functions/, navConfig, routes.

## The composition (desktop ≥ 900px)
Top to bottom, exactly as in `North Star - Work Order.dc.html`:

1. **Utility line** — context left: "Service → Work Orders → {woNumber}" (11px uppercase letterspaced; the "Work Orders" link reuses `backToWorkOrders()` — preserves saved list state). Right: a truthful live indicator ("Live — this record updates in real time" with a pulsing green dot) — truthful because `useWorkOrder` is an onSnapshot subscription. The concept's ⌘K hint has no command palette behind it: not rendered.
1b. **Page measure** — `.ns-page { max-width: 1360px; margin: 0 auto; }` (concept measure, wider than `--layout-measure`).
2. **Thick–thin rule pair** — 3px solid `--verenward-evergreen` top border + 1px bottom, 3px apart (`.ns-rulepair`).
3. **Record header** (`.ns-record-header`) —
   - Kicker: "Work Order · {type} · {priority text}" — 12px, 600, uppercase, letter-spacing .12em, color `--verenward-bronze`. Priority via existing `workOrderPriorityText()`.
   - Title: `{woNumber}` — `--font-display-serif`, 40px/1.05, 700. THE PAGE'S ONLY H1.
   - Fact row (13px, `--color-text-secondary`, 18px gaps, wraps): status in words (map from `STATUS_LABEL` in WorkOrderActions.jsx — e.g. DISPATCHED → "Dispatched — awaiting technician acceptance"); customer · location (resolved names via the reads the page already performs; on a failed read render the existing FailureState copy inline — never the raw id); technician (resolveTechnicianIdentity); window (scheduledStart, formatted "Tue Aug 26, 8:00–12:00").
   - Fact row also carries the concept's first-visit-fix slot as an honest gap: "First-visit fix — not computed" (muted, title explains the missing prediction engine).
   - Action cluster (right, baseline-aligned): see Actions. Pass `showStatus={false}` to WorkOrderActions — the fact row already states the status once.
   - The concept's presence chip ("M. Cortez viewing") has no presence capability: omitted.
4. **Lifecycle band** (`.ns-lifecycle`) — chevron buttons for Created → Scheduled → Dispatched → On site → Complete → Closed. Map from `workOrder.status` using the same order the transition engine defines; completed steps = filled `--verenward-stone-sunken` with ✓ and `--color-success` text; current = filled `--verenward-evergreen`, white text, 7px pulsing bronze dot (`@keyframes ns-pulse`, opacity 1→0.35, 2s); future = `--verenward-stone-card` with hairline outline. Chevron shape: `clip-path: polygon(0 0, calc(100% - 11px) 0, 100% 50%, calc(100% - 11px) 100%, 0 100%, 11px 50%)` (first chip omits the left notch, last omits the right point). Clicking a step toggles a one-line detail strip below (3px left border, stage facts from the timestamps the doc already carries: createdAt, scheduledStart, dispatchedAt…). Cancelled: render a terminal red chip after the last reached step; no pulse. Trailing text: "from {SO reference}" ONLY if resolvable — see Gaps #1.
4b. **Suggestion strip** — the concept's structural slot below the stage detail (`.ns-suggest`: auto/1fr grid, hairline border, stone-card fill, 26px bottom margin). No suggestion engine exists — render the honest empty state verbatim: label "Suggested" (muted, uppercase) + "No suggestion engine is connected yet — nothing is proposed for this job." Never advice, never fabricated numbers. When an engine ships, `.ns-suggest--active` restores the bronze treatment.
5. **Two-column body** — `grid-template-columns: minmax(0,1fr) 340px; gap: 56px`.
   **Main column:**
   - "The job" — serif h2 19px, 2px evergreen top rule; complaint and diagnosis as prose paragraphs ("Complaint." / "Working diagnosis." lead-ins bold). If both absent: "No complaint recorded." muted.
   - "Parts" — serif h2 with the honest disclosure as the heading annotation (where the concept carries its "verified against truck stock" note): "· readiness by source (truck / warehouse) isn't recorded yet — quantities are planned demand". Mount `WorkOrderPartsPlanEditor` unchanged inside `.ns-embed`, which restyles its `.fo-card`/`.fo-table` to the concept's table geometry (2px evergreen header rule, hairline rows, uppercase 11px column labels, bold part names). The readiness column itself is a GAP (see Gaps #2) — do not fabricate it.
   - "Timeline" — serif h2; rows `grid-template-columns: 150px 1fr`, hairline separators. Use the real lifecycle timestamps (the `timestampRows` list from WorkOrderDetail.jsx) as recorded events; keep the existing honesty caption for the reconstructed portion: "Reconstructed from Work Order milestones — times are approximate, not a recorded audit trail."
   **Right rail (13px, small-caps 11px headers with 2px evergreen bottom rule):**
   - Equipment — `equipmentDisplayName` + `equipmentSummary` from the existing read; if no equipmentId, omit the section entirely. The concept's repair-history insight box is a GAP (#6): render the muted sentence in its slot, no amber fill.
   - Site — location name + address (formatAddress). Contact + access notes are a GAP (#3): omit the lines, never placeholder text.
   - Dispatcher context — the concept's section (tech day load, slip window, sibling WOs) is a GAP (#7): keep the section, render the one muted sentence.
   - Lineage — sales order / sibling WOs: GAP (#1); render "Lineage isn't linked on this record yet." as the lifecycle tail only when salesOrderId absent.
   - "Record detail" `<details>` collapsed — type, priority, severity, createdBy if present.

## Actions (header cluster)
Reuse WorkOrderActions' `getAllowedActions` output, re-skinned:
- The single most-likely transition (first primary action from `orderWorkflowActions`) renders as the ONE filled button (`.ns-btn-primary`: evergreen fill, white, 9px 18px, hover `--verenward-guardian`).
- Other non-destructive actions: outlined (`.ns-btn-secondary`: 1px `--verenward-border-strong`, text `--verenward-guardian`, hover stone tint).
- Cancel: red TEXT button (`.ns-btn-destructive`: no border, `--color-danger`, hover `--color-danger-surface`) — keeps the existing ConfirmDialog flow untouched.
- Read-only statuses (READ_ONLY_STATUSES, CLOSED, CANCELLED): render the status sentence in the fact row; no live buttons — exactly today's behavior, new placement. (The disabled backlog placeholders B1/B2 still hold their positions.)
- Dispatch tech picker + Schedule form: keep the existing components; open them below the header (not inline in the old card).

## Interactions & states
- Chevron detail toggle: local useState, one open at a time, current stage open on mount.
- Loading: existing LoadingState inside the page frame (rule pair + breadcrumb render immediately).
- Error/not-found: existing FailureState components, unchanged copy, inside the frame.
- Partial reads (account/location/technicians errors): keep the existing per-read FailureState lines, placed directly under the header.
- Hover/active on every button: 140ms background transition (values above).
- Responsive < 900px: single column; rail sections stack after Timeline; action cluster wraps under the title; lifecycle band scrolls horizontally (`overflow-x: auto`, no wrap). True technician mobile is a LATER family (do not build it in this pass).

## Behavioral backlog (separate work items — NOT part of this presentation pass)
The concept's header shows three actions; today's engine grants a dispatcher only Cancel at DISPATCHED. Rather than dropping the buttons, the page renders them **disabled with explanatory tooltips** so the action architecture matches the North Star now and lights up when the behavior ships. Each item is a behavior change: it needs Owner sign-off and its own PR, touching the authorities this pass must not touch.
- **B1 — Reschedule from DISPATCHED**: add a `Reschedule` action (DISPATCHED → SCHEDULED) to `functions/src/transitionEngine.ts` AND its client mirror `src/domain/workOrderWorkflow.js` (defense-in-depth: both tables must change together), with dispatcher/admin permission and the governed scheduling form as its payload collector. Once `getAllowedActions` returns it, replace the disabled placeholder with the real button from WorkOrderActions.
- **B2 — Message technician**: requires a technician notification channel (pilot governance item — none exists). Placeholder stays disabled until the channel and its command exist; never wire it to a direct Firestore write.

## Gaps to report (render truthful states, do not invent)
1. **WO → Sales Order lineage reference**: the doc may carry no resolvable SO number (naming read service pending — pilot governance item). Render the muted sentence above.
2. **Parts readiness (truck/warehouse/staged)**: no read exists joining plan lines to stock location. Heading-annotation disclosure only.
3. **Site contact + access notes**: no fields exist on Location. Omit.
4. **Sibling work orders**: no query exists on this page. Covered by the Dispatcher-context sentence (do not add a new Firestore read in this pass).
5. **Suggestion engine**: none connected. The `.ns-suggest` slot renders its honest empty state.
6. **Equipment repair-history insight**: no equipment-history read on this route. Muted sentence in the slot.
7. **Dispatcher context reads** (tech day load, slip windows): none on this route. Muted sentence in the section.
8. **First-visit-fix prediction / live ETAs / presence / ⌘K**: no engines or channels exist. First-visit fix renders the muted "not computed" fact; ETAs, presence, and ⌘K are omitted.

## Design tokens (add to :root in index.css)
```css
--font-display-serif: "Source Serif 4", Georgia, serif;
--ns-rule-heavy: 3px solid var(--verenward-evergreen);
```
New classes (all additive, `ns-` prefixed): `.ns-rulepair`, `.ns-breadcrumb`, `.ns-record-header`, `.ns-kicker`, `.ns-title`, `.ns-facts`, `.ns-btn-primary/secondary/destructive`, `.ns-lifecycle`, `.ns-chip`, `.ns-chip--done/--current/--future/--terminal`, `.ns-stage-detail`, `.ns-body-grid`, `.ns-section`, `.ns-h2`, `.ns-table`, `.ns-rail-h`, `@keyframes ns-pulse`. Spacing: page gutter inherits the existing measure; section gap 36-40px; header padding 26px 0 16px.

## Acceptance checklist (Owner visual approval gate)
- [ ] Route renders the new composition; zero changes to any write path, gate, or rule
- [ ] Status appears ONCE in words (fact row) + once as the lifecycle band — the four legacy repetitions are gone
- [ ] No raw enum (WORK_IN_PROGRESS) or Firestore id visible anywhere
- [ ] All existing tests pass; WorkOrderActions/PartsPlanEditor behavior identical (add snapshot/RTL updates for the new DOM only)
- [ ] Gaps 1–8 render their truthful states (nothing fabricated, no slot silently dropped)
- [ ] Backlog buttons B1/B2 render disabled with their tooltips; no new write path was added to enable them
- [ ] ControlTower.jsx still renders the legacy WorkOrderDetail card unchanged
Then STOP for Owner review before the next family (recommended order: Sales Order detail → Entity list → the rest per the migration map).

## Files in this bundle
- `NorthStarWorkOrderDetailPage.jsx` — **ready-to-integrate page component.** Drop into `src/modules/workOrders/`, swap the route element in App.jsx (keep the old file for rollback). Verify import paths/prop names against the current repo state before wiring; fix drift in the wiring, not by changing behavior.
- `ns-workorder.css` — **ready-to-paste CSS block** for the end of `src/index.css` (plus the one `--font-display-serif` token in `:root` and the Source Serif 4 @font-face pair).
- `North Star - Work Order.dc.html` — **the visual source of truth** (approved concept).
- `Implementation Render - Work Order.html` — a static render of exactly what the JSX+CSS produce for a DISPATCHED record with today's capabilities (honest gap states shown). Use it as the pixel target when comparing the running app.
- `Proposed - Work Order.dc.html` — earlier pilot composition; superseded as visual truth, kept for history (its technician-mobile concept remains reference for a later family).

## Integration order for Claude Code
1. Add the `:root` token + Source Serif 4 @font-face; paste `ns-workorder.css` at the end of `src/index.css`.
2. Copy `NorthStarWorkOrderDetailPage.jsx` in; fix any import-path drift against the real files (the component deliberately reuses `WorkOrderActions` and `WorkOrderPartsPlanEditor` unmodified).
3. Swap the route element in `App.jsx`; run the app; compare against `Implementation Render - Work Order.html` (pixel target) and `North Star - Work Order.dc.html` (composition truth) side by side.
4. Run the existing test suite; add RTL coverage for the new DOM only.
5. Walk the acceptance checklist above; screenshot for Owner review; STOP.
