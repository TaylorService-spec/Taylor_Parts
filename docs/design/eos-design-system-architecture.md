# EOS Design-System Architecture — systemic diagnosis + minimum composition primitive set

Status: **PROPOSAL (design direction).** Synthesizes the five-agent static code audit into root causes and a
*small* evidence-supported primitive set. Findings from the audit are labelled **PROVISIONAL SYSTEMIC DESIGN
FINDINGS** — not final UX conclusions until the UX persona programme validates them against realistic sandbox
workflows. Design owns the composition solution; UX owns the workflow/IA problem; Product implements.

Guiding result: not "every page uses the design system," but **"the design system makes excellent operating
experiences easier to build and poor ones harder."** Fix causes, not 35 symptoms.

---

## 1. Systemic design diagnosis (root causes)

The token layer is genuinely good (semantic colours, AA contrast, warm elevation, one measure). **The gap is
entirely at the composition/primitive layer.** Two exemplars already prove the bar in-repo: the **F1 field
shell** and **Scheduling**. Everything weak shares these causes:

1. **No Operating Workspace Shell.** `AppShell` stops at chrome and hands each page a bare `<main>`; so every
   page invents its own root. `.fo-panel` (a bordered/padded/rounded/shadowed *card*) became the de-facto
   page model — ~80 uses across 38 files; **~35 screens return `<div class="fo-panel">` as their root**. This
   is the direct cause of the card-farm page model.
2. **A phantom shell class.** 5 files use `className="fo-workspace …"` but `.fo-workspace` **has no CSS rule** —
   authors reaching for a shell primitive that was never built.
3. **No section primitive.** Sections are bare `<h3>` (~96 uses) inside the page-card; several detail pages use
   a 12px-muted sub-label ramp *as the section title*, inverting hierarchy (titles quieter than their body).
4. **Status-pill proliferation.** ~9 parallel pill families (`fo-badge`+~15 modifiers, `fo-chip`,
   `fo-signal-badge`, `wo-status`/`wo-*`, `fo-po-status`, `fo-transfer-status`, `fo-wh-status`, `fo-sup-status`,
   `fo-readiness`) plus 2 fully-inline `STATUS_TONE` systems (PartMaster/Manufacturers). The intended shared
   `SignalBadge` is used in only 3 files.
5. **No master/detail or contextual-detail primitive.** Exactly one detail root exists (`fo-sched-detail`);
   **0 module files use `grid-template-columns` for a split.** Detail pages (AccountDetail 6+ stacked sections
   in one panel; PartDetail ~1,529 lines; EquipmentDetail) are vertical scrolls.
6. **No action hierarchy.** The global `button{}` is one weight; the Dispatcher-Board toolbar class
   (`disp-board-toolbar`) is cross-used as the generic button row in 7 files with **~17 inline `justifyContent`
   hacks**. No dominant/secondary/ghost distinction.
7. **No numeric-table standard.** `.fo-table` cells are `text-align:left`; tabular right-aligned numerals exist
   only as a one-off (`fo-po-qty`). Quantity columns — exactly what these personas compare — scan poorly.
8. **No attention/summary band convention.** House rhythm is `WorkspaceHeader → intro <p> → FilterBar →
   table`; pages open with prose, not state. `fo-stat-grid` is used as 5 equal *centred marketing tiles*
   (Control Tower/Operations), and exceptions are appended *last*, below a full-detail dump.
9. **Two off-shell outliers** (PartMasterList, Manufacturers) — fully inline-styled, own badges, monospace raw
   ids — the biggest single cross-surface break.
10. **Ship-time CSS gaps.** `.fo-detail-grid/.fo-detail-header/.fo-detail-list` (+ `.fo-forecast-*`) are used
    in JSX but **never defined**, so intended grids silently degrade to card stacks; reporting nests `.fo-main`
    inside `.fo-main`. Nothing couples a layout class name to a CSS rule.

**Meta-root:** there is no shared *composition* layer between the (good) tokens and the (hand-rolled) pages.
Two teams' worth of surfaces diverged only by era, not intent — the newest surfaces (F1, Scheduling, Work
Orders List, Dispatcher Board) already embody the target; the legacy ones never got the primitives.

---

## 2. Current primitive inventory (what exists / where insufficient)

**Exists and fine (keep):** the token layer; `WorkspaceHeader` (correct but 16 lines, used by only 3 list
surfaces); `FilterBar`; `SignalBadge` (under-adopted); `EmptyState`/`FailureState`/`LoadingState`/
`LoadingEmptyState`; `Modal`/`ConfirmDialog`; `form/*`.

**Of the current "Gate-3 set," what actually ships:** Workspace Header ✓; Semantic Status Pill only partially
(as under-adopted `SignalBadge`); Governed Entity Picker **tripled** (`EmployeeAssignmentPicker`,
`SupplierPicker`, `GlobalSearch`). **Attention/Readiness Summary, Peer Operational Card, and Contextual Detail
do NOT exist as primitives** — they live only as bespoke CSS in the F1 and Scheduling shells.

---

## 3. Proposed MINIMUM primitive set (evidence-supported; three-use rule)

Roughly ten — a handful of *composition* primitives + refinement of existing components + usage guidance.
Not 40.

**P1 — highest leverage (each unblocks many surfaces):**
1. **Operating Workspace Shell** — a real page container declaring *regions*, not a card: workspace identity ·
   context slot · attention slot · work-area slot(s) · supporting-context slot · primary-action slot. It
   establishes hierarchy **without dictating one visual layout** — the work area accepts a queue, table,
   calendar, timeline, split pane, map, or detail. Resolves the phantom `.fo-workspace`; demotes `.fo-panel`
   to a low-level surface. *Fixes the ~35 card-farm roots.* **Do not implement it as six literal cards.**
2. **Context Band** — a compact business-context strip (identity + key state + primary action) that *reduces*
   repeated cards; generalised from the F1 head and the Scheduling toolbar. Not another card — hierarchy,
   inline relationships, progressive detail.
3. **Semantic Status Pill (unify)** — promote `SignalBadge` to the single pill taking `(tone, label)`, fed by
   a per-domain state→tone map. See §5.
4. **Action Rail** — dominant / secondary / ghost action row; retires the `disp-board-toolbar` cross-use and
   the inline `justifyContent` hacks.

**P2:**
5. **Master/Detail Split + Contextual Detail** — grid-based split for record-detail (AccountDetail,
   EquipmentDetail, PartDetail, WorkOrderDetail).
6. **Exception / Attention Queue** — a prioritised work queue as the *dominant* surface for oversight roles
   (Control Tower, Operations, inventoryRole homes).
7. **Compact Metric Strip** — a dense operational summary (replaces the centred `fo-stat` tiles).
8. **Dense Operational Table** — a standardised `fo-table` wrapper: sticky header, `tabular-nums`,
   right-aligned quantity columns, scroll container. Fixes the ~29 table files + the numeric standard.

**P3:**
9. **Governed Entity Picker (unify the three pickers)**.
10. **Section / Progressive-Detail** helpers (a proper `<h3>`-scale section region within the Shell; disclosure).

---

## 4. Page/workspace types (the small intentional set) → composition

Not every route gets a unique composition. Seven provisional types (confirm against UX evidence before
canonising):

| Type | Examples | Composition |
|---|---|---|
| A. Personal Home | technician home | Shell + Context + Attention + focused next-action |
| B. Operating Workspace | inventoryRole homes, Receiving | Shell + Attention band + work-area (queue/table) |
| C. Management / Oversight | Control Tower, Operations | Shell + **Exception Queue dominant** + Compact Metric Strip subordinate |
| D. Collection / Queue | Work Orders List, Accounts, Parts, Suppliers | Shell + FilterBar + Dense Table |
| E. Entity Detail | AccountDetail, EquipmentDetail, PartDetail, WorkOrderDetail | Shell + Context Band + Master/Detail split |
| F. Guided Task / Workflow | WO Wizard, Receive-against-PO, schedule collector | focused stepper (already good — generalise) |
| G. Field / Current-Work | FieldMode | field shell + Responsive Field Stack (the F1 exemplar) |

---

## 5. Standards

**Card-farm standard (§8 of brief).** A Card = a *meaningful, self-contained, bounded peer object* (a work
order in a list, a truck in a fleet grid). A Card is **not** the default section wrapper. Before adding one:
"does this information need an independent visual boundary?" If no → hierarchy, spacing, section grouping,
rows, table, timeline, split view, progressive disclosure. **Anti-pattern:** a page-root `.fo-panel` holding a
vertical stack of `.fo-panel` sections. Sections are Shell regions, not cards.

**Status semantic standard.** Three separated layers: (1) **Semantic tone** — the shared visual language
(`positive / attention / unknown / muted`, + `info / critical`), reusing the readiness-language tone tokens
already merged; (2) **Domain state vocabulary** — the words, per domain (WO `SCHEDULED`, PO `ORDERED`, part
`SHORT`); (3) a per-domain **state→tone map** feeding the ONE Semantic Status Pill. Converge the 9 families
onto this **without** flattening domain meaning into one colour. Rules: a pill only where a state must scan at
a glance; plain text otherwise; never a wall of pills; colour is semantic, never decorative.

**Responsive = recomposition (not squeeze).** Per workspace type, define laptop/tablet/phone transforms owned
by the Shell so pages don't each reinvent breakpoints. E.g. Management: desktop = queue + metrics + detail
split → phone = exception-first list → focused intervention. Dispatch: desktop 3-pane (DispatcherBoard
exemplar) → phone exception-first assign flow. Field: phone-first single-column stack (F1 exemplar). Same
authority + information, different composition.

**Density matches the job.** Density *modes* the Shell/Table consume, not one universal density: FIELD (≥52px
targets, low load, one next action) · DISPATCH/SCHEDULING (high density, comparison, temporal/spatial) ·
WAREHOUSE (scan-oriented, high legibility) · ADMINISTRATION (precise, explainable, dense) · MANAGEMENT
(exception-oriented, summarised + drill-down). Never solve desktop density by inflating everything into cards.

---

## 6. F1 / Scheduling learnings — what becomes reusable (without copying pages)

- **F1 field shell** (`fo-field`/`fo-job`/`fo-btn-field` 52px/`fo-readiness`/honest identity projection) →
  extract the **Field/Current-Work composition**, a **Responsive Field Stack**, and a **field control
  primitive** (large targets). It is the reference for type G.
- **Scheduling** (`fo-sched-summary` compact context+attention strip, `fo-sched-body` split, attention dedupe,
  day/week drill-down) → extract the **Context Band**, **Attention Summary**, and **Master/Detail** patterns.
  It is the reference for types C/E.
Extract the *patterns*, not the pages.

---

## 7. Historical-surface → systemic-treatment map (provisional)

| Surface(s) | Primary systemic treatment |
|---|---|
| Control Tower, Operations | Exception Queue dominant + Compact Metric Strip + Shell (retire full-detail dump / 5-tile grid) |
| inventoryRole homes, PartsList | Shell + Attention band + tabbed/sectioned work area (the TruckInventory tab shell is a good local exemplar) |
| Dispatch, Jobs | reconcile with Dispatcher Board / Work Orders List (IA question — UX-owned); adopt Shell + Action Rail |
| AccountDetail, EquipmentDetail, PartDetail, WorkOrderDetail | Master/Detail Split + Context Band + Contextual Detail; fix missing `.fo-detail-*` CSS |
| PartMasterList, Manufacturers | port onto the shared shell/table/badge kit (off-shell outliers) |
| TechnicianDashboard lineage | migrate to the F1 field composition (or retire in its favour) |
| All list surfaces (~29) | Dense Operational Table + numeric standard |
| Reporting | remove double `.fo-main` nesting; adopt Shell |

---

## 8. Implementation waves (order — do NOT begin broad page rewrites yet)

- **Wave 0 (design-system only):** build the P1 primitives (Shell, Context Band, unified Status Pill, Action
  Rail) as shared code, each with **one** reference-migration surface as proof — not 35 pages. Add the missing
  `.fo-detail-*` CSS + resolve the phantom `.fo-workspace` as part of building the Shell.
- **Wave 1 (after UX evidence):** Management/Oversight (Control Tower, Operations) — the worst offenders — via
  Exception Queue + Metric Strip.
- **Wave 2:** Entity Detail (Master/Detail). **Wave 3:** Collection/Queue (Dense Table). **Wave 4:** off-shell
  outliers + ship-time CSS-gap fixes.
Wave *prioritisation* is gated on UX live-persona evidence; only Wave 0 (primitive foundation) is safe to start
before it.

---

## 9. Dependencies on UX evidence (hold until persona missions return)

Navigation/IA consolidation (Jobs/Scheduling/Dispatch merge), Control Tower purpose/rename, which surfaces are
retired vs kept, final page-type assignment for ambiguous surfaces, and the *priority order* of page
remediation — all UX-owned. Design supplies the composition solution once UX defines the IA problem.

---

## 10. Owner decisions (only genuinely unresolved)

1. **Ratify the ~10-primitive minimum set + the 7-type page taxonomy** as the EOS composition foundation
   (subject to UX validation of the type assignments)?
2. **Authorise Wave 0 now** — Design builds the P1 primitives + one reference migration each (design-system
   code; conflict-clean; no page-family rewrites) — or hold the primitives as spec-only until UX live evidence?
No new canonical authority, Rules, capability, or protected boundary is implicated by this proposal.
