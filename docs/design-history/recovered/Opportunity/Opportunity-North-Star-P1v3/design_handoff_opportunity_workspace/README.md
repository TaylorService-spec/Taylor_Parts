# Handoff: Opportunity Workspace — North Star design source
## VERSION: Opportunity Workspace North Star P1 — DESIGN AUTHORITY for /customers/opportunities. Presentation only. The approved Opportunity Detail P1v2 remains authority for the record route and is untouched.

## Visual authority
`North Star - Opportunity Workspace P1.dc.html`: 1a desktop 1440 (canonical), 1b tablet 768, 1c phone 375.

## Chosen architecture — OPTION A (full-width, no record pane)
The record now has a certified route (/customers/opportunities/:opportunityId), so the workspace no longer needs to be a reading surface. A preview pane was evaluated and rejected: everything a bounded preview could legally show (reference, customer, stage, value, attention, owner) already fits in the row itself — a preview would only duplicate the row or creep back toward the miniature record the Owner rejected. One surface, one job.

## Row interaction (OW-D3)
Row click → navigate to /customers/opportunities/:id. The whole row is the target (checkbox/overflow, if ever added, stop propagation per Lists P1). Middle-click/cmd-click work as normal links (the row is an anchor). No pane, no expand, no edit-on-click. New Opportunity opens the governed create surface and, on success, navigates to the new record.

## Legacy-pane disposition
Retired entirely. Its content maps: Overview/Commercial Terms/Pricing/Instructions/Provenance/Items → RECORD DETAIL ONLY (all already exist on the approved P1v2 record — sections: identity/facts, Solution, Agreement, provenance rail). Lifecycle controls and qualification editing → RECORD DETAIL ONLY. Nothing from the pane needs a new home; the record already carries all of it. Remove the master-detail selectedId state and the pane component tree.

## Workspace vital few (OW-D4)
Seven columns: Opportunity (reference bold + need subtitle) · Customer (resolved account name + channel words; "Customer — name unavailable" when unresolved) · Stage (governed words + "n of 6") · Attention (domain derivation only: Awaiting decision / No next action / Close overdue Nd; "—" when none) · Est. value (bare number, right/tabular; "Not estimated" when absent — never $ or 0; OW-D7) · Owner (resolved name; "Unresolved" honestly) · Expected close (date + "· Nd" when near; overdue in exception tone; "Not recorded" when absent). Everything else is RECORD ONLY.

## Views & pipeline (OW-D5)
Tabs from the domain's own pipeline views: Open · My Opportunities · Needs Attention · At Decision · Won · Lost · All, with truthful counts. Stage filtering via the Filter sheet (checkboxes over the six governed stage words). Sort default: attention first, then closing soonest — the pipeline's own operational order. No weighted pipeline, forecast, probability, conversion, or scores (none exist).

## Attention (OW-D6)
A column, not a dashboard: the derivation's words in tone color, the count in the header sentence and the Needs Attention tab. No banners on the workspace.

## Responsive
1440 (1a): full-width table, 7 columns, 10–14 rows visible. 768 (1b): owner + customer-subtitle + attention fold into the identity cell (3-line cell); Stage/Value/Close survive as columns; views row scrolls horizontally. 375 (1c): scan cards — reference + attention / customer / stage · value · close · owner; whole card taps to the record; sticky search/view/filter; targets ≥44px; no horizontal scroll.

## Implementation mapping
EXISTING EOS TRUTH: all seven columns, view counts, attention derivations, stage words/progress, currency-truth rendering rules.
EXISTING EOS ACTION: New Opportunity (governed create), search/filter/sort per the object's listViewDefinition, record navigation (certified route).
PRESENTATION CHANGE: retire the master-detail pane; full-width Lists P1 grammar (shell, views, toolbar, 16 states, result context, pagination); row = link.
PRODUCT GAP: none required for this correction. (Saved custom views beyond the pipeline set remain the Lists P1 pattern — adopt only if/when governed.)

## Owner decisions
None genuine — Option A implements the Owner's stated preferred direction; everything else is answered by existing authority.

## Do-not-invent list
No preview pane resurrection; no currency symbols on expectedValue; no pipeline math/scores; no inline stage mutation from rows; no columns beyond the vital few without a design pass.

## Acceptance checklist
- [ ] Side-by-side vs 1a; the legacy pane is gone and the table owns the canvas
- [ ] Row click navigates to the record route; cmd/middle-click open tabs
- [ ] Value: bare numbers, "Not estimated" for absent — zero $ symbols on this page
- [ ] Views/counts/attention all from existing projections; 16 Lists P1 states reachable
- [ ] 375 cards tap-navigate; ≥44px; no horizontal scroll
