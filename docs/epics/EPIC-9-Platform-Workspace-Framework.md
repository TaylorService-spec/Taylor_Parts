# Epic 9 — Platform Workspace Framework

Next unclaimed epic number (Epic 7 = Execution Analytics Foundation, PR #34; Epic 8 = Operations Intelligence Unification, PR #36 — both merged; see `docs/CLAUDE_CONTEXT.md`'s branch/PR history).

**Status:** Planning only. No code, branches (beyond this documentation branch), or repository structure changes made as part of producing this document. Implementation does not begin until this plan is reviewed and approved, and does not begin before Sprint 2.1.2 (per the accepted sequencing: this epic lands between Sprint 2.1.1 and Sprint 2.1.2).

**This is a cross-cutting platform initiative, not a business capability.** It has no entry in `PlatformCapabilityModel.md`'s Capability Hierarchy and should not gain one — it doesn't advance a business capability's maturity level (Section 5 of that document), it improves the *shared UI substrate* several capabilities are built on. This is why it lives in `docs/epics/` (feature-level planning for a major work effort) rather than `docs/capabilities/` (which is reserved for per-capability Implementation Plans, per that folder's own Section Template — see `docs/capabilities/InventoryManagementPlan.md`).

---

## 1. Purpose

Three real, shipped screens — `AccountsList.jsx` (Customers, Sprint 2.0.2), `WorkOrdersList.jsx` (Service, Sprint 2.0.3), and `PartsList.jsx`/`PartDetail.jsx` (Inventory, Sprint 2.1.1) — now independently implement the same handful of UI patterns: a workspace header/toolbar, a loading/empty-state chain, and a toggle-button filter bar. Each was built correctly for its own sprint, but the duplication is now proven, not hypothetical, and manual validation of Sprint 2.1.1 surfaced concrete usability gaps (nav contrast, active/hover-state visibility, spacing, visual hierarchy) in the pattern all three share. This epic extracts the proven-duplicated pieces into shared components and fixes the usability gaps once, at the shared-component level, instead of three (and growing) times per screen.

## 2. Scope

**In scope**: extracting exactly the three components proven duplicated across Accounts/Work Orders/Inventory, refactoring those three existing screens to consume them, and resolving the accumulated usability feedback from Sprint 2.1.1's validation session as requirements on those three components.

**Out of scope**, explicitly: pagination (one instance only — Inventory's — not yet proven as a general shape), a master/detail layout generator (three instances exist, but each detail screen's content is entirely domain-specific and must stay that way), a detail-page framework, any Warehouse/Procurement/Dispatch/Control Tower/Operations work, and any visual redesign beyond what the named usability feedback calls for. This is a consistency pass, not a redesign.

## 3. Shared Platform UI Components (this epic's actual deliverable)

Three components, each backed by ≥2 real pre-existing instances (per the architectural assessment that authorized this epic):

1. **Workspace header/toolbar** — the `h2` + search + primary-action-button row, currently hand-duplicated (`disp-board-toolbar` wrapper) in `AccountsList.jsx`, `WorkOrdersList.jsx`, and `PartsList.jsx`.
2. **Loading/empty-state component** — the `loading ? ... : items.length === 0 ? ... : <content>` ternary chain, currently duplicated in at least five places (Accounts, Work Orders, Parts, Technicians, Part detail's transaction list).
3. **Filter bar** — the toggle-button-group-with-counts pattern (`fo-nav-btn` array map, active-key `useState`), currently duplicated in `WorkOrdersList.jsx` (status groups) and `PartsList.jsx` (categories).

## 4. Components to Be Extracted

The three named in Section 3, and only those three. Each becomes a single, shared component under `field-ops-app-vite/src/shared/` (mirroring where `GlobalSearch.jsx` already lives, the existing proof that "build once, extend per sprint" works in this codebase), parameterized narrowly enough to serve all three current consumers without a screen-specific branch inside the shared component itself.

## 5. Components Intentionally Left Capability-Specific

- **Every detail screen's actual content** (`AccountDetail.jsx`, `WorkOrderDetailPage.jsx`, `PartDetail.jsx`) — each renders entirely different business data and must remain hand-built per capability.
- **Pagination** (currently Inventory-only) — one instance is not enough evidence to generalize; revisit once a second screen needs it.
- **Master/detail routing/layout** — the list→`Link`→route-param-detail *shape* is consistent, but building a shared generator now would force three genuinely different detail screens through one abstraction prematurely.
- **Operations dashboard's report-panel composition** (`InventoryHealthPanel`, `WarehousePanel`, `ProcurementPanel`, `ExecutionInsightsPanel`) — a fundamentally different UI shape (multi-panel report, not browse/detail), explicitly not folded into this framework.
- **Technicians.jsx** (Administration) — simpler CRUD list with no search/filter/pagination today; not refactored in this epic since it isn't one of the three proven-duplicated instances driving this work (it may adopt the loading/empty-state component in a later pass, but that's not this epic's scope).

## 6. Implementation Phases

### Phase 1 — Extract the three shared components
Build `WorkspaceHeader` (or equivalent name), `LoadingEmptyState`, and `FilterBar` under `shared/`, incorporating the usability requirements from Section 8 directly into their first implementation (contrast, active-state, hover-state, spacing, visual hierarchy) — these are not deferred follow-ups, they're acceptance criteria for Phase 1 itself.

**Exit Criteria (Phase 1 → Phase 2):** all three components exist, are independently reviewable, and satisfy every Section 8 requirement on their own (verifiable before any existing screen consumes them).

### Phase 2 — Refactor the three proven consumers
Refactor `AccountsList.jsx`, `WorkOrdersList.jsx`, and `PartsList.jsx` to consume the three shared components, removing their local duplicated implementations. No behavior change beyond the visual/consistency improvements themselves — same data, same routes, same role gating.

**Exit Criteria (Phase 2 complete):** all three screens render via the shared components; each screen's existing tests/manual-verification checklist (search, filter, pagination where applicable, detail navigation, role gating) still passes; no regression in any of the three screens' existing behavior.

## 7. Success Criteria

- The three shared components exist, are documented (a brief usage note per component, mirroring `GlobalSearch.jsx`'s own header-comment convention), and are the only implementation of their respective patterns across Accounts/Work Orders/Inventory.
- Nav/filter contrast, active-state, and hover-state visibility are measurably improved (a reviewer should be able to tell, without prompting, which filter option is active and which is hovered).
- Spacing and visual hierarchy are consistent across all three refactored screens — no screen-specific spacing overrides remain for the extracted components.
- Zero new Firestore read/write paths, zero schema changes, zero role-gating changes — this is a presentation-layer refactor only.
- `npm run build` and `npm run lint` remain clean.

## 8. Exit Criteria (epic-level, gating Sprint 2.1.2)

- Phases 1 and 2 are both complete per their own exit criteria above.
- All three refactored screens are live-verified (admin/dispatcher access, existing functionality intact, no console errors) before Sprint 2.1.2 begins.
- The accumulated "Platform Experience Requirements" (Section 9) are each addressed in the shared components, not left as an open backlog item.

## 9. Dependencies

- **Depends on**: Sprint 2.1.1 (merged, PR #58) and the already-merged Customers/Work Orders screens — this epic extracts from three real instances, not a speculative design.
- **Blocks**: Sprint 2.1.2 (Inventory Actionability) — per the accepted sequencing, 2.1.2 should build its new low-stock/reorder view against the shared components rather than needing its own later refactor.
- **Does not depend on and does not block**: Warehouse Management, Procurement UI, Dispatch, Control Tower, or Operations work — none of those are refactor targets in this epic (Section 5), so none of them gate or are gated by it.
- **Does not depend on**: the Forgot Password developer tooling (separate, unrelated workstream).

### Platform Experience Requirements (user-validated, gathered during Sprint 2.1.1's manual validation)

These are the formal design requirements this epic's Phase 1 must satisfy, per `docs/CLAUDE_CONTEXT.md`'s "Sprint 2.1.1 complete" section:

- Improve secondary navigation contrast.
- Strengthen active-state visibility.
- Improve hover states.
- Standardize workspace spacing.
- Improve visual hierarchy.
- Reduce unused white space.
- Create a consistent platform-wide workspace experience.

### Explicitly preserved, NOT this epic's scope

Recorded in `docs/CLAUDE_CONTEXT.md` so it isn't lost, and deliberately not addressed here: platform renaming, global search/autocomplete improvements, Browser Back-button behavior, Home navigation, Control Tower improvements, Customer workspace improvements, Dispatch improvements, Inventory enhancements beyond Sprint 2.1.1–2.1.3's already-planned scope, and Operations dashboard improvements. Each belongs to a future capability or platform initiative of its own and should be scoped against `PlatformCapabilityModel.md`/`ProductBlueprint.md` when picked up.

## 10. Rollout Strategy Across Existing Capabilities

1. **Build in isolation first** (Phase 1) — the three shared components are built and satisfy Section 8's requirements before any existing screen is touched, so a review of the components themselves can happen independently of the refactor's blast radius.
2. **Refactor the three proven consumers together** (Phase 2), in one pass, since they're what justified building the components in the first place — not staggered across separate PRs per screen, to avoid a long window where some screens are "old style" and others "new style."
3. **No other screen is touched in this epic.** `Technicians.jsx`, the Operations panels, and every placeholder screen keep their current implementation untouched — adopting the shared components elsewhere is future work, scoped and reviewed separately when that screen's own capability work happens, not retrofitted opportunistically here.
4. **Sprint 2.1.2 becomes the first "born using the framework" screen** — the actual validation that this rollout strategy works, immediately after this epic closes.

## 11. Future Expansion

These are future considerations, named here so a future contributor recognizes them as deliberately deferred rather than forgotten — **none of them are part of Epic 9**, and none should be pulled into this epic's Phase 1 or Phase 2 without a new plan of their own:

- **Master/detail workspace shell** — a shared generator for the list→detail routing shape (Section 5 explains why this epic doesn't build one yet: three instances exist, but each detail screen's content is entirely domain-specific).
- **Shared pagination component** — currently one instance only (Inventory); revisit once a second screen needs it.
- **Shared detail panels** — a common `fo-card`-based detail-page shell, distinct from the master/detail shell above.
- **Global search integration** — deeper integration between `GlobalSearch` and the shared filter bar/workspace header, beyond what each already does independently today.
- **Responsive/mobile workspace behavior** — beyond the ad hoc `@media` breakpoints already in `index.css`; a deliberate responsive layer is not this epic's scope (see `MobileStrategy.md` for the separate, already-planned technician/warehouse mobile experiences, which are not desktop-workspace concerns).
- **Accessibility improvements** — beyond whatever the contrast/visual-hierarchy work in Section 8 incidentally improves; a dedicated accessibility pass is not scoped here.
- **Theme support** — light/dark or brand-configurable theming is not addressed by this epic.
- **Keyboard navigation** — beyond whatever native `<button>`/`<input>` semantics already provide; no dedicated keyboard-navigation work is scoped here.

---

**Traceability summary:** this epic is authorized by the architectural assessment that evaluated whether Sprint 2.1.1's UI patterns should become shared platform components (concluding: yes, for exactly the three named here, after — not before — Sprint 2.1.1 proved the duplication). It does not modify `PlatformCapabilityModel.md`, `ProductBlueprint.md`, or any other governance document; it is scoped entirely within the Development/Architecture layer `PlatformOperatingModel.md`'s Governance Responsibilities table already assigns to `architecture/SYSTEM_AUTHORITIES.md` and `DEVELOPMENT_STANDARDS.md`.
