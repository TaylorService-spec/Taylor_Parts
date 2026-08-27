# Handoff: Opportunity collection — North Star List + State View
## VERSION: Opportunity North Star List + State View P1v4 — DESIGN AUTHORITY for /customers/opportunities. Presentation only. Supersedes Workspace P1 (artifact retained in this folder for provenance). Opportunity Detail P1v2 remains authority for the record route and is untouched.

## Visual authority
`North Star - Opportunity List P1v4.dc.html`: 1a desktop 1440 (canonical), 1b tablet 768, 1c phone 375, 1d the five designed states, 1e reuse/customization/gaps map.

## What P1v4 changes vs Workspace P1
1. The page is now an explicit **Lists P1 composition** (shared list + state engine underneath, North Star presentation on top) — same architecture, now documented as such.
2. Adds the **Agreement / Order** column (compact downstream commercial context; see G2/G3).
3. Designs the five North Star page states in Opportunity wording (1d) on the Lists P1 16-state system.
4. Confirms identity treatment against the work order's "Opportunity Name" preference: no name field exists (G1); identity stays reference + need.

## Record handoff (OW-D3, unchanged)
`/customers/opportunities` → click row → `/customers/opportunities/:opportunityId` (Opportunity Detail P1v2). The whole row is an anchor (cmd/middle-click work); checkbox/overflow, if ever added, stop propagation. No pane, no auto-select, no expand, no edit-on-click. The collection and the record are separate North Star surfaces.

## Columns (desktop, in order)
Opportunity (reference bold + need subtitle) · Customer (resolved name + channel; "Customer — name unavailable" until G4 ships) · Stage (governed words + "n of 6" — compact signal, never the record page's chevrons) · Attention (deriveAttention words only; "—" when none) · Est. value (bare number, right/tabular; "Not estimated" when absent — never $ or 0) · Expected close (date; "· Nd" when near; overdue in exception tone; "Not recorded" when absent) · Agreement / Order (two lines: SA reference + state word / SO reference or "Order not created"; "No agreement" when none; column omitted entirely under NOT_ENABLED) · Owner (resolved name; "Unresolved" honestly).

## State view (§5)
Views = the domain's own pipeline views with truthful counts: Open · My Opportunities · Needs Attention · At Decision · Won · Lost · All. Stage filtering via the Filter sheet (checkboxes over the six governed stage words). "+ Save as view" is the Lists P1 capture pattern (filter+sort as a named tab; no sharing architecture). No probability, forecast, weighted pipeline, or new states.

## Reused platform
List engine (listViewDefinition columns/filters/sort/savedViews/readVia/capabilityRequirement) · state engine (opportunityLifecycle pipeline views + counts) · search/filter/sort/columns/saved-view mechanics · row-anchor navigation · 16-state UI system · result-context + pagination · responsive column-drop order · deriveAttention presentation.

## North Star customization
Object-family header (context line, rule pair, serif title, count sentence, Create Opportunity placement) · Opportunity row composition · Agreement / Order compact column · Opportunity wording for states · 768 identity-fold and 375 scan-card recompositions.

## Responsive
1440 (1a): 8 columns, full-width table. 768 (1b): owner/channel/attention fold into a 3-line identity cell; Stage + Value survive; Close and the commercial chain share the last column. 375 (1c): scan cards — reference + attention / customer / stage · value · close · owner / commercial chain when one exists (omitted otherwise); whole card taps to the record; ≥44px; no horizontal scroll.

## States (1d)
Loading (skeleton in intact shell) · True empty ("No opportunities" + purpose + Create only when permitted) · Filtered empty ("No opportunities match this view", tokens visible, Clear filters, no create CTA) · Load error (honest headline + Try again, no backend text) · Access restricted (no counts leaked). All sixteen Lists P1 states remain reachable; these five carry Opportunity wording.

## Authority gaps (named, not invented)
- **G1 — No "Opportunity Name" field.** Identity = governed reference + need subtitle. Adding a name field is an Owner/product decision.
- **G2 — Agreement reference not on the list read.** Association is stored on the agreement (sourceOpportunityId); the only governed read is per-record (getSalesAgreementForOpportunity). Populating the column needs list-level resolution or denormalization. Until then: "No agreement" / "—" truthfully; under NOT_ENABLED the column is omitted — no dead cells.
- **G3 — Sales Order reference:** durable on the record after atomic Won (LIVE for Won rows); for open rows with agreement-created orders it rides on G2's resolution.
- **G4 — Customer name resolution** (= Opportunity O2): read returns accountNameById: {} today; "name unavailable" renders until it ships. Demo names in artifacts are design intent.
- **G5 — No governed currency on expectedValue** (= Opportunity O1): bare numbers; "Not estimated" when absent; zero currency symbols on this page.

## Do-not-invent list
No preview pane; no currency symbols on expectedValue; no pipeline math/probability/forecast/scores; no inline stage mutation from rows; no agreement workflow (acceptance, pricing, terms, editing) from this surface; no fabricated agreement/SO links ahead of G2; no columns beyond these without a design pass; sample rows/counts establish no authority.

## Owner decisions
None new. G1 (name field) and G2 (list-level agreement resolution) are named product decisions only if the Owner wants the column populated at launch; the design ships truthfully without them.

## Acceptance checklist
- [ ] Whole-composition side-by-side vs 1a; Lists P1 grammar visibly present (rule pair, serif header, views row, toolbar, result context, footer)
- [ ] Row click navigates to the record route; cmd/middle-click open tabs; no pane anywhere
- [ ] Value: bare numbers, "Not estimated" — zero $ on this page
- [ ] Agreement / Order column: truthful states only; omitted under NOT_ENABLED; no dead cells or fabricated links
- [ ] Views/counts/attention from existing projections; five designed states match 1d wording; all 16 states reachable
- [ ] 768 fold and 375 cards per 1b/1c; ≥44px targets; no horizontal scroll
