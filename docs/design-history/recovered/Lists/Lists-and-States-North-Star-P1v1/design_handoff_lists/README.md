# Handoff: EOS Lists North Star — shared list/workspace grammar + state system
## VERSION: Lists North Star P1 — DESIGN AUTHORITY for every list/queue/register/index surface. Presentation only.

## Visual authority
`North Star - Lists P1.dc.html` in this folder: 1a Work Orders master (populated desktop, active view, active filters — the canonical reference), 1b component/state board, 1c the 16 page states + filter panel, 1d Opportunities reuse proof, 1e mobile 375.

## Page grammar (every list page, in order)
context line → rule pair → editorial object header (serif 30–34px title = object family; supporting count in words: "148 work orders · 32 open · 3 need attention") → primary governed action top-right (one, only when permitted; absent otherwise — never disabled-forever) → saved-views row (understated tabs, active = 3px bronze underline, counts inline, "+ Save as view" at the end) → toolbar (object search · Filter trigger with active count · removable filter tokens + Clear all · Sort · Columns) → result context ("7 of 32 open work orders — narrowed by 2 filters") → table → footer ("1–50 of 1,248 · Previous / Next") with freshness in the utility line.

## The three state axes (never collapsed)
- **Object state** — the governed lifecycle position, in words, in its own column, colored by semantic family: neutral/closed (muted) · info (blue) · active (evergreen) · positive (green) · warning (amber) · exception (red). Families are presentation over governed states — "WAITING_FOR_PARTS" renders "Waiting for parts" in the warning family; the governed state is never renamed. Words carry meaning; color reinforces; no pills.
- **Attention state** — its own column, same tone vocabulary, only domain-derived conditions ("Overdue 2d", "Parts risk", "No next action"); "—" when none. Never overwrites status, never a score.
- **UI state** — the 16 page states (1c), all preserving the shell.

## Table grammar
Two-line identity cell (reference bold 13.5 + subject muted 12.5); two-line context cell (account + location/equipment); disciplined columns in priority order Identity → State → Exception → Assignment → Timing → Context; horizontal hairlines only (no vertical grid); numeric right-aligned tabular; sticky header on long lists; row hover = stone-card fill; whole row clickable, checkbox/overflow stop propagation; 8–14 rows visible on a normal desktop viewport (44–52px rows).

## States (1c is normative)
A populated · B initial loading (skeleton rows, shell stays, no lone spinner) · C background refresh (rows stay; utility line says "Refreshing…") · D true empty (serif headline + purpose; create only when truly permitted) · E empty saved view (good-news wording + link to a useful view) · F no search results (query echoed; clear search; no create CTA) · G filter zero (tokens stay visible; Clear filters) · H load error (headline + Try again; no raw backend text) · I degraded (quiet line above table; affected cells say "Name unavailable") · J access restricted (no counts leaked) · K offline ("Offline · Showing last available data") · L large set (1,248 — same composition) · M single record · N selection mode (stone-tinted rows + docked bulk bar "4 selected · Assign · Export · More · ✕" — governed bulk actions only) · O action in progress (bar shows progress, buttons disable, no blocking modal) · P action failure (counts stated, failed rows marked, Retry failed, success never implied) · Q action success (one quiet line; row state is the confirmation). D/E/F/G are four different facts with four different sentences — never one generic "nothing here."

## Filter panel
Right sheet 360px: object-specific sections (State as checkboxes over governed states in words · Assignment · Account · Date range · Attention condition). Apply (filled) / Reset / Cancel; nothing applies until Apply; Esc discards. Applied values echo as toolbar tokens. "Save as view" captures filter+sort as a named view tab — presentation pattern only; no sharing/permissions architecture invented. "Columns" reorders/hides display fields only — presentation state, never data model.

## Responsive
Tablet/narrow: columns drop by the priority order (Updated first, then Schedule, then the subject line); search/views/filter/primary action all retained. Mobile (1e): structured rows, not cards — identity+attention / account / subject / state·timing·owner; one sticky 36px control row (search · current view · filter); rows ≥44px; no horizontal scroll. Opportunities mobile identical with stage/value/close.

## Money, dates, identifiers
USD as $1,234.00, right-aligned tabular, never raw minor units — except fields that govern no currency (Opportunity expectedValue) which render bare per that family's standing rule. Dates human ("Today, 2:00 PM", "Aug 26"); relative only where unambiguous. Identifiers are the governed references (WO-/SO-/OPP-/SA-), selectable; document ids never surface; "Reference unavailable" for unnumbered records.

## Component model (conceptual mapping)
NorthStarListPage · ObjectHeader · SavedViews · OperationalSummary (the count sentence — only where counts materially help; not a dashboard) · ListToolbar (Search / FilterTrigger / ActiveFilters / Sort / Columns) · ResultContext · Table · RecordRow (two-line identity) · StateLabel (6 families) · AttentionSignal · BulkActionBar · Pagination · Empty/Error/Restricted/OfflineState. Existing behavioral layers these compose (not replace): each object's metadata listViewDefinition (columns, filters, savedViews, sort, capabilityRequirement, readVia/callables), the domain view models (pipeline views, honest empty texts, tone vocabularies), and fail-closed capability gating.

## Do-not-invent list
No universal workflow taxonomy (each object's states come from its own domain); no new bulk actions, saved-view sharing, column-model changes; no scores/health/rainbow pills; no counts on restricted pages; no create CTAs the user lacks; no offline editing; sample rows/counts in the artifact are demo content and establish no authority.

## Acceptance checklist
- [ ] Side-by-side vs 1a (whole composition) per applied object
- [ ] Object state / attention / UI state visibly independent
- [ ] All 16 UI states reachable; D/E/F/G distinct; H shows no backend text
- [ ] Views/filters/sort read from the object's own listViewDefinition; nothing unsupported implied
- [ ] Keyboard: visible focus, row activation + control activation separable; touch ≥44px on handheld
- [ ] Money/date/identifier rules hold in every cell
