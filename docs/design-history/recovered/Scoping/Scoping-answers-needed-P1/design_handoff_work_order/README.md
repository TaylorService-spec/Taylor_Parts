# Handoff: Work Order Detail — North Star recomposition (page family 1 of N)

## Overview
Replace the PRESENTATION of the Work Order detail route (`/service/work-orders/:workOrderId`) in the EOS frontend (`field-ops-app-vite/`, React + Vite) with the approved North Star composition, while preserving every existing behavior, read, write path, and authority check unchanged. This is the first page family; STOP after it renders for Owner visual approval before touching any other family.

Division of truth:
- **Visual/compositional source of truth:** the bundled design reference `Proposed - Work Order.dc.html` (and the annotations below).
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
Top to bottom, exactly as in `Proposed - Work Order.dc.html`:

1. **Utility line** — breadcrumb "Service → Work Orders → {woNumber}" (right-aligned, 11px uppercase letterspaced, `--color-text-secondary`). Left side keeps nothing (the app shell rail already states identity). "← Back to Work Orders" behavior moves into the breadcrumb's "Work Orders" link (reuse the existing `backToWorkOrders()` — it preserves saved list state).
2. **Thick–thin rule pair** — 3px solid `--verenward-evergreen` top border + 1px bottom, 3px apart (`.ns-rulepair`).
3. **Record header** (`.ns-record-header`) —
   - Kicker: "Work Order · {type} · {priority text}" — 12px, 600, uppercase, letter-spacing .12em, color `--verenward-bronze`. Priority via existing `workOrderPriorityText()`.
   - Title: `{woNumber}` — `--font-display-serif`, 40px/1.05, 700. THE PAGE'S ONLY H1.
   - Fact row (13px, `--color-text-secondary`, 18px gaps, wraps): status in words (map from `STATUS_LABEL` in WorkOrderActions.jsx — e.g. DISPATCHED → "Dispatched — awaiting technician acceptance"); customer · location (resolved names via the reads the page already performs; on a failed read render the existing FailureState copy inline — never the raw id); technician (resolveTechnicianIdentity); window (scheduledStart, formatted "Tue Aug 26, 8:00–12:00").
   - Action cluster (right, baseline-aligned): see Actions.
4. **Lifecycle band** (`.ns-lifecycle`) — chevron buttons for Created → Scheduled → Dispatched → On site → Complete → Closed. Map from `workOrder.status` using the same order the transition engine defines; completed steps = filled `--verenward-stone-sunken` with ✓ and `--color-success` text; current = filled `--verenward-evergreen`, white text, 7px pulsing bronze dot (`@keyframes ns-pulse`, opacity 1→0.35, 2s); future = `--verenward-stone-card` with hairline outline. Chevron shape: `clip-path: polygon(0 0, calc(100% - 11px) 0, 100% 50%, calc(100% - 11px) 100%, 0 100%, 11px 50%)` (first chip omits the left notch, last omits the right point). Clicking a step toggles a one-line detail strip below (3px left border, stage facts from the timestamps the doc already carries: createdAt, scheduledStart, dispatchedAt…). Cancelled: render a terminal red chip after the last reached step; no pulse. Trailing text: "from {SO reference}" ONLY if resolvable — see Gaps #1.
5. **Two-column body** — `grid-template-columns: minmax(0,1fr) 340px; gap: 56px`.
   **Main column:**
   - "The job" — serif h2 19px, 2px evergreen top rule; complaint and diagnosis as prose paragraphs ("Complaint." / "Working diagnosis." lead-ins bold). If both absent: "No complaint recorded." muted.
   - "Parts" — serif h2; mount `WorkOrderPartsPlanEditor` unchanged inside. Restyle ONLY via a wrapper class (`.ns-section .fo-card { border: none; background: transparent; padding: 0; }` scoped) so its table inherits the North Star table look: 2px evergreen header rule, hairline rows, uppercase 11px column labels. The readiness column from the design is a GAP (see Gaps #2) — do not fabricate it; add a muted line: "Availability by source (truck / warehouse) isn't recorded yet."
   - "Timeline" — serif h2; rows `grid-template-columns: 150px 1fr`, hairline separators. Use the real lifecycle timestamps (the `timestampRows` list from WorkOrderDetail.jsx) as recorded events; keep the existing honesty caption for the reconstructed portion: "Reconstructed from Work Order milestones — times are approximate, not a recorded audit trail."
   **Right rail (13px, small-caps 11px headers with 2px evergreen bottom rule):**
   - Equipment — `equipmentDisplayName` + `equipmentSummary` from the existing read; if no equipmentId, omit the section entirely.
   - Site — location name + address (formatAddress). Access notes are a GAP (#3): omit the line, never placeholder text.
   - Lineage — sales order / sibling WOs: GAP (#1); render "Lineage isn't linked on this record yet." only when salesOrderId absent.
   - "Record detail" `<details>` collapsed — type, priority, severity, createdBy if present.

## Actions (header cluster)
Reuse WorkOrderActions' `getAllowedActions` output, re-skinned:
- The single most-likely transition (first primary action from `orderWorkflowActions`) renders as the ONE filled button (`.ns-btn-primary`: evergreen fill, white, 9px 18px, hover `--verenward-guardian`).
- Other non-destructive actions: outlined (`.ns-btn-secondary`: 1px `--verenward-border-strong`, text `--verenward-guardian`, hover stone tint).
- Cancel: red TEXT button (`.ns-btn-destructive`: no border, `--color-danger`, hover `--color-danger-surface`) — keeps the existing ConfirmDialog flow untouched.
- Read-only statuses (READ_ONLY_STATUSES, CLOSED, CANCELLED): render the status sentence in the fact row; no buttons — exactly today's behavior, new placement.
- Dispatch tech picker + Schedule form: keep the existing components; open them below the header (not inline in the old card).

## Interactions & states
- Chevron detail toggle: local useState, one open at a time, current stage open on mount.
- Loading: existing LoadingState inside the page frame (rule pair + breadcrumb render immediately).
- Error/not-found: existing FailureState components, unchanged copy, inside the frame.
- Partial reads (account/location/technicians errors): keep the existing per-read FailureState lines, placed directly under the header.
- Hover/active on every button: 140ms background transition (values above).
- Responsive < 900px: single column; rail sections stack after Timeline; action cluster wraps under the title; lifecycle band scrolls horizontally (`overflow-x: auto`, no wrap). True technician mobile is a LATER family (do not build it in this pass).

## Gaps to report (render truthful states, do not invent)
1. **WO → Sales Order lineage reference**: the doc may carry no resolvable SO number (naming read service pending — pilot governance item). Render the muted sentence above.
2. **Parts readiness (truck/warehouse/staged)**: no read exists joining plan lines to stock location. Muted disclosure line only.
3. **Site access notes**: no field exists on Location. Omit.
4. **Sibling work orders**: no query exists on this page. Omit (do not add a new Firestore read in this pass).

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
- [ ] Gaps 1–4 render their truthful sentences
- [ ] ControlTower.jsx still renders the legacy WorkOrderDetail card unchanged
Then STOP for Owner review before the next family (recommended order: Sales Order detail → Entity list → the rest per the migration map).

## Files in this bundle
- `NorthStarWorkOrderDetailPage.jsx` — **ready-to-integrate page component.** Drop into `src/modules/workOrders/`, swap the route element in App.jsx (keep the old file for rollback). Verify import paths/prop names against the current repo state before wiring; fix drift in the wiring, not by changing behavior.
- `ns-workorder.css` — **ready-to-paste CSS block** for the end of `src/index.css` (plus the one `--font-display-serif` token in `:root` and the Source Serif 4 @font-face pair).
- `Proposed - Work Order.dc.html` — the desktop composition + technician mobile concept (mobile is reference-only for a later family)
- `North Star - Work Order.dc.html` — post-pilot horizon (suggestions/live data); NOT in scope; included so intent is unambiguous

## Integration order for Claude Code
1. Add the `:root` token + Source Serif 4 @font-face; paste `ns-workorder.css` at the end of `src/index.css`.
2. Copy `NorthStarWorkOrderDetailPage.jsx` in; fix any import-path drift against the real files (the component deliberately reuses `WorkOrderActions` and `WorkOrderPartsPlanEditor` unmodified).
3. Swap the route element in `App.jsx`; run the app; compare against `Proposed - Work Order.dc.html` side by side.
4. Run the existing test suite; add RTL coverage for the new DOM only.
5. Walk the acceptance checklist above; screenshot for Owner review; STOP.
