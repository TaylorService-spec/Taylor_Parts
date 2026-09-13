# Handoff: Service Operations — North Star P1 (for Claude Code)

## Overview
Recomposition of the Service Operations page (`/service-operations`, internal key `controlTower`) from
an append-order accumulation into the North Star **Overview** archetype: attention first, linked
metric strip, exception tables, one suggestion tray, activity rail. Same data, same panel
invariants — this is a composition change, not a data or authority change.

Read alongside `README.md` in this folder (verdict, named decisions SO-D1–D4, gaps SO-G1–G5,
integration order, acceptance checklist). This file is the implementation spec.

## About the Design Files
`North Star - Service Operations P1.dc.html` is a **design reference created in HTML** — a static
composition artifact, not production code. The task is to **recreate it in the existing React app**
(`field-ops-app-vite/`, Vite + React + react-router + Firestore hooks) using its established
patterns: the existing Verenward CSS variables in `src/index.css`, shared UI primitives
(`StatusPill`, `SignalBadge`, `LoadingState`, `FailureState`, `Button`), and the existing domain
projections. Do not ship the HTML.

The artifact has four labeled frames:
- **1a** — canonical desktop 1440 composition (the build target)
- **1b** — clean-day state (attention absent, honest zeros)
- **1c** — loading / failed WO read / degraded technician read
- **1d** — disposition map (today's blocks → P1) and the review brief's seven answers

## Fidelity
**High-fidelity** for composition, hierarchy, spacing rhythm, copy tone and state wording.
Colors/type must come from the repo's existing Verenward tokens, not the artifact's literal hexes
(the hexes below map 1:1 to existing variables — use the variables). Sample data (WO numbers,
accounts, technicians) is illustrative; render live data.

## Hard constraints (ratified, not preferences)
From `docs/design/eos-north-star-design-grammar.md` and `ControlTower.jsx`'s enforced invariants:
1. Every panel/section receives exactly `{ jobs, technicians, workOrders }`; the composition root
   owns the only Firestore listeners; no section computes severity/risk/ranking itself; every
   rendered signal is a canonical `Signal`. **Preserve all four** (dev-build assertions in
   `domain/controlTower/types.js` must keep passing).
2. Ordering law: kicker → header → attention → work → rail. Attention renders **nothing** when clean.
3. Status as words, never enums, never color alone. No raw document id as content
   (`resolveTechnicianIdentity` for names). One filled primary per surface.
4. Tables never wrapped in cards; 32px rows; numerals Inter, tabular, right-aligned.
5. Honest states per 1c: zeros only when known; failure copy includes "Your work elsewhere is
   unaffected."; technician degradation notice kept verbatim.
6. R23 lossless composition: an exception record never disappears because it lacks a field —
   see the "age unknown" row.

## Screen: Service Operations (1a)

### Page chrome
- Existing app nav (dark rail) unchanged. Breadcrumb line: `SERVICE → SERVICE OPERATIONS · <date>`
  (11px, 600, letter-spacing 0.14em, uppercase, ink-2) with live indicator right (7px green dot +
  "Live — updates as work orders change").
- Rule pair under it: 3px solid ink top + 1px solid ink bottom, 3px apart. Page identity — do not omit.
- Header row (flex, space-between, align-end, padding 18px 0 14px):
  - h1 "Service Operations" — Source Serif 4, 700, 34px, line-height 1.05.
  - Subline 13px ink-2: "The exceptions read across service — what needs a decision before the
    board or the record. Admin & Dispatcher."
  - Action cluster right: "Work Orders" (outlined: 1px border rule-strong, paper fill, 12.5px/600)
    and "Open Dispatch Board" (**the one filled primary**: accent #1C4638 fill, paper text). Both
    navigational `Link`s — no governed transitions on this page.

### Layout
Work area `grid-template-columns: 1fr 300px; gap: 40px`, content max-width ~1240px.

### 1 · Attention block (first in work area)
- h2 "Needs attention" (serif 19px/700) + count pill (11px/600 white on #B23B3B, radius 999px).
- 2px ink rule, then rows: `grid-template-columns: 84px 1fr auto; gap 14px; padding 9px 0;`
  1px hairline row rule. Row = severity word (10.5px/700 uppercase, ls 0.08em; Urgent #B23B3B,
  Stalled/Parts blocked #A9740D) · plain-language fact with **WO ref bold**, account, owner ·
  deep link right (12.5px/600): "Schedule on board →" (unassigned) or "Open work order →".
- Sources: `workOrderAttentionItems` + `groupWorkOrderAttentionItemsBySection`
  (`domain/workOrderAttentionProjection`), plus the unassigned filter
  (`fieldPhase(wo) !== FINISHED && !wo.assignedTechId`) folded in as the Urgent section —
  **the bare ⚠ warning div is deleted**, this replaces it.
- **Parts blocked section (SO-G5):** the projection already defines it; it is empty because
  ControlTower doesn't read `partsReadinessByWorkOrderId` (documented boundary in
  `WorkOrderAttentionPanel.jsx`). Until that read is wired, render one line: "Parts readiness isn't
  connected to this page yet." Never fabricate; never drop the slot.
- **Clean: the entire block renders nothing** (1b) — no empty box, no "all clear" banner.

### 2 · Metric strip
4 cells, `grid-template-columns: repeat(4, 1fr); gap 24px`. Each: 1px top rule (rule-strong) ·
micro-label (10.5px/600 uppercase ls 0.1em ink-3) · numeral Source Serif 4 700 34px · exception
line 11.5px with count bold in tone color + link.
| Metric | Source | Exception + destination |
|---|---|---|
| Awaiting dispatch | `byPhase(AWAITING_DISPATCH)` | n past readiness (bold #B23B3B) → Dispatch Board queue |
| In progress | `byPhase(ASSIGNED) + byPhase(ON_SITE)` | n stalled (bold #A9740D) → at-risk table anchor |
| Technicians on shift | technicians length (Available + On WO merged — one fact) | n overloaded → load table anchor |
| Completed this week | finished count — **SO-D4:** no windowed read exists yet; ship label "Completed" over snapshot truth unless the window read is built | "no exceptions" in ink-3, link → Work Orders list |
No fifth tile. No unlinked number.

### 3 · At risk (primary table)
- h2 "At risk" + sort toggle right ("Sorted by severity · age" — severity default; age sort puts
  null `ageHours` last, exactly as `AtRiskPanel` does today).
- One table pattern: 2px ink head rule, uppercase 10.5px head labels, 1px hairline row rules,
  32px rows, 12.5px text. Columns: Work order (bold ref) · Account · Severity (word, tone color) ·
  Age (right-aligned tabular, `~52h`; null → "age unknown" in ink-3 with Why = "createdAt
  unavailable — age not computed") · Why (factor explanations joined " · ", ink-3) · Technician
  ("Unassigned" in ink-3 when none) · "Open →" link.
- Right-aligned cells keep 24px right padding **except the last column** (collision fix — see the
  artifact's `table.ops` rules).
- Source: `detectStalledJobs` (`domain/jobRiskScoring`).
- Empty: "No work orders at risk. N open work orders exist and are moving normally." (count only
  when known).

### 4 · Technician load (table, same pattern)
Columns: Technician (bold) · Status (word) · Active work orders (right, tabular) · Load
("Overloaded" 10.5px uppercase #A9740D via `detectOverloadedTechnicians`; otherwise "Normal" ink-3)
· "Board lane →" (link to Dispatch Board, ideally with that technician pre-selected in its existing
filter). Sources: `groupJobsByTechnician` + `detectOverloadedTechnicians` + `resolveTechnicianIdentity`.
Replaces both the "Technician Load" divs and the Overloaded panel.

### 5 · Suggestion tray (the page's ONE suggestion slot)
Amber ruled panel: #F0E4C8 fill, 1px #C3BCAB outline, padding 14px 18px. Header 12.5px/700
"Recommended dispatch — n open, m placeable" + Collapse control (collapsed state persists per user).
Rows 12.5px: bold WO ref → technician name (score + all reasons in parens, ink-3) · "Review on
board →". No-candidate rows state why ("No eligible technician — …"). Footer 11px #8A6D28:
"Suggestions are read-only here. Assignment is the governed command on the Dispatch Board — reasons
always shown, accept with undo there." Source: `computeDispatchRecommendations`
(`domain/dispatchScoring`). **No assign action on this page.**

### 6 · Rail: Activity
300px, 1px left hairline, 24px left padding. Micro-label "ACTIVITY"; filter as labeled text links
(All · Work order · Job · System — replaces the bare `<select>`); entries 12px: bold description /
actor · time in ink-3. Footer note above nothing else: "Derived from the loaded work-order
snapshot — not an audit log." Source: `buildTimeline` + `describeEvent`. Rail carries no actions,
no attention.

### Removed (do not port)
- The `workOrders.map(WorkOrderDetail)` wall and its per-card `WorkOrderActions` (SO-D2 —
  `controlTower/WorkOrderDetail.jsx` loses its last caller; dead-code decision travels with SO-D2).
- `PartsOverviewPanel` on this page (SO-D3 — rollup to Inventory/Operations; exceptions re-enter
  via attention).
- The five-tile stat grid, the ⚠ warning div, the emoji heading, the bare selects.

## Interactions & Behavior
- All navigation via existing routes: attention/at-risk rows → `/work-orders/:id` (the migrated
  North Star record); queue/board links → dispatcher board (deep links already exist on attention
  items — `item.deepLink`).
- Sort toggle (severity/age) and activity filter are local UI state only.
- Tray collapse: local state, persisted (e.g. localStorage keyed per user) — optional.
- No optimistic writes, no mutations anywhere on this page.

## State Management
Composition root keeps exactly today's reads: `useWorkOrders()`,
`useFirestoreCollection(TECHNICIANS_COLLECTION)`, `useAccountNames`. All derivations via the
existing pure domain modules listed above. New state: sort key, activity filter, tray collapsed.
No new Firestore read **except** the named SO-G5 parts-readiness integration, which is optional
and separately scoped.

## Design Tokens (map to existing Verenward CSS variables — do not hard-code)
Ground #F3F0E9 · surface #FCFAF6 · ink #102B24 · ink-2 #4A5B55 · ink-3 #6B7A74 · rules #D9D3C6 /
#E3DDD0 / #C3BCAB · accent #1C4638 · brass #B08A55 · positive #237A45 · warn #A9740D · negative
#B23B3B · amber tint #F0E4C8 (suggestion only). Type: Source Serif 4 (titles + display numerals
only) / Inter (body, UI, all tabular data). Scale: h1 34px · section h2 19px · body 12.5–13px ·
micro-labels 10.5–11px 600 uppercase. Rows 32px. Radius ~0 except count pill (999px).

## Assets
None. Icons: none required for P1 (severity is words). If icons are added later, the repo's
established set — not a new family.

## Files in this bundle
- `North Star - Service Operations P1.dc.html` — the design reference (frames 1a–1d)
- `README.md` — verdict, named decisions SO-D1–D4, gaps SO-G1–G5, integration order, acceptance checklist
- `CLAUDE-CODE-HANDOFF.md` — this spec

## Acceptance
Per this project's three-authority model: done means the sandbox page passes engineering regression
AND survives whole-composition side-by-side comparison against frame 1a by Design and the Owner —
including 1b/1c states and realistic data volume (the old list-wall case). Never token-level matching.
