# Handoff: EOS Lists North Star — shared collection grammar
## VERSION: EOS Lists North Star P2 — DESIGN AUTHORITY for every collection/index/queue/register surface. Presentation grammar only; no shared business model, no implementation, no authority changes. Supersedes Lists P1 (artifact retained in this folder for provenance).

## Standing declarations (per the alignment work order §40)
- **Opportunity List P1v4 was the primary evidence source** — the first EOS collection reconciled against a North Star artifact and implemented (`OpportunityList.jsx` / `opportunityListView.js`).
- **Opportunity remains its own collection authority** (`docs/north-star/opportunity/` in the repo; `design_handoff_opportunity_workspace/` here).
- This document **extracts and aligns the shared EOS collection grammar**; object-specific artifacts may override shared composition where their operational needs require it.
- **Repository/domain authority always outranks visual implication.**

## Visual authority
`North Star - Lists P2.dc.html`: 2a canonical desktop anatomy · 2b tablet 768 · 2c mobile 375/320 · 2d 17-state page-state board · 2e three-axis state board · 2f row-priority + drop/fold board · 2g Opportunity study · 2h Work Order study · 2i Parts study · 2j major-object matrix · 2k authority-dependent board · 2l component board.

## The grammar (anatomy, in order)
Context line → North Star rule pair → collection identity (serif 34px title + governed count + workload summary) → primary governed action → views → search/narrowing → result context → record list → record route. COLLECTION → RECORD: rows anchor to the routed record page; no master-detail panes, no auto-select, no lesser record copies. WorkspaceIdentity is the ratified header primitive.

## What P2 corrects vs Lists P1 (each verified against source)
1. **Pagination:** no Previous/Next page numbers anywhere. Three governed data shapes only — complete read (no controls; Opportunity), cursor-paged read ("Load more" + governed aggregate total; Work Orders/metadata runtime), incremental where the read truly supports it.
2. **Freshness:** "Updated moments ago" is removed from the grammar. Refresh may render without a recency claim; a timestamp or liveness claim requires a real data timestamp or subscription (request time ≠ data time).
3. **Unknown is not zero:** an unresolvable derivation renders no count (My Opportunities with an unresolved viewer renders NO number); bounded lists show no per-bucket counts without a counting authority (Work Order chips, deliberately); aggregate totals are null-on-failure, never 0.
4. **Saved views:** definition-declared saved views are live platform (listViewDefinition + ListViewHeader). USER-created "+ Save as view" is AUTHORITY-DEPENDENT / FUTURE and renders nowhere until persistence authority exists.
5. **Columns control:** removed from the live grammar; authority-dependent.
6. **Sorting:** Pattern A — governed operational order, no sort control (Opportunity: attention first, closing soonest). Pattern B — definition-declared sorts only, with honest on-screen consequences (sorting by an optional date states that records without it cannot appear). Arbitrary sorting is never a mandatory control.
7. **Search honesty:** the placeholder names exactly what the search reaches; narrowing runs over loaded rows (complete reads) or a bounded governed query (prefix on the reference); ids are never searchable; the result denominator is the view, never an unread total.
8. **Relationship projection (no N+1):** five treatments — fully resolved (reference + state) · existence only ("Agreement", "Order created" — id projected, reference not) · reference unavailable · true absence ("No agreement") · not projected (column omitted). Never per-row reads, never document ids as labels.
9. **Create action:** three treatments — rendered (permitted) · protected: disabled with the seam's reason as visible text (a vanished control reads as a missing feature) · absent (object not user-creatable / creation owned elsewhere). Existence is not universal.
10. **IDLE ≠ LOADING**, and NOT ENABLED / DENIED / UNKNOWN are distinct states (2d) — 17 total, one rendering each.
11. **Real content width:** the application nav consumes 248–252px; design at real container widths (1440→~1160, 1024→~744, 768, 375, 320); no horizontal overflow.
12. **Tablet: drop before fold** (Opportunity's tablet learning) — columns leave in reverse row-priority; identity folds at most one line; rows never become four-line mini-cards.

## Three state axes (never collapsed)
Object state (governed lifecycle words, per-family vocabulary, tone families as presentation, no pills, never color alone) · Attention (domain-derived condition, own column, first-class where it exists, absent where the object has none) · UI state (the 17 page states). All three coexist.

## Row priority
Identity (reference bold + human subtitle) → object state → attention → primary context → assignment (Unassigned ≠ Unresolved) → critical timing → numeric (right/tabular Inter; currency only where governed — unknown is not zero, unpriced is not $0.00) → relationships. Order varies per object; the discipline does not. 32px working density desktop; ≥44px targets for touch contexts.

## Alignment studies
- **2g Opportunity** (shared vs domain annotated): proves complete-read shape, Pattern A ordering, null-count views, protected create, existence-only commercial column.
- **2h Work Orders**: proves bounded cursor-paged shape, governed aggregate total, count-less status-group chips, prefix search with the text-search gap named, definition-declared filters/sorts/views, picker-not-id filters.
- **2i Parts**: proves the grammar across domains — Scan as a second non-mutating header action, on-hand baseline with visible provenance, no Available column, attention from partsAttentionProjection, no implied inventory effects.

## Do-not-invent list
No universal workflow taxonomy, forced attention concepts, or shared view vocabulary; no invented pagination boundaries, freshness claims, per-bucket counts, availability math, currency assumptions, bulk actions, exports, saved-view persistence, column preferences, N+1 relationship enrichment, searchable ids, or create CTAs without capability; sample rows/counts establish no authority; matrix rows marked "unverified" require source inspection before design.

## Owner decisions
None new raised by P2. Carried: relationship references at list level (read change — Opportunity G2), per-bucket counting authority for bounded lists, user saved-view persistence, full-text search reads. All in 2k with truthful fallbacks shipping meanwhile.

## Acceptance checklist
- [ ] Whole-composition side-by-side of 2a–2c against any migrating family before its own study is drawn
- [ ] 17 states reachable per family; the seven empties distinct; UNKNOWN renders no counts; DENIED leaks nothing
- [ ] Data-shape truth: pagination/freshness/counts render only what the family's read genuinely has
- [ ] Search placeholder scope = real scope; result denominator = the view
- [ ] Relationship cells use the five projection treatments; zero document ids; zero per-row reads
- [ ] Row → record route; in-row controls stop propagation; cmd/middle-click work
- [ ] 1440/1024/768/375/320 at real container widths; drop-before-fold at 768; ≥44px touch targets
