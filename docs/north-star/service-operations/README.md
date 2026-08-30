# Service Operations — North Star P1 handoff

Visual source of truth: `North Star - Service Operations P1.dc.html` (copy in this folder).
Behavioral source: `field-ops-app-vite/src/modules/controlTower/*` + domain projections (see github.md).
Review brief answered: the Owner's "hot mess" assessment — accumulation with no composition.

## Verdict

The page survives as an **Overview** archetype: the cross-cutting exceptions read for Admin +
Dispatcher. It stops re-rendering the Work Order record (the migrated WO family owns that), stops
hosting dispatcher transitions (the record and the Dispatch Board own those), and recomposes the
existing six panels by rank instead of by sprint order. Route `/service-operations` and internal key
`controlTower` unchanged.

## Composition (1a)

kicker → workspace header (action cluster right, Open Dispatch Board = the one filled primary) →
attention block (renders nothing when clean) → metric strip (4 linked numbers with exception counts)
→ At risk table → Technician load table → suggestion tray (the page's one) | rail: Activity.

All sections remain pure renderers of existing domain projections over the composition root's single
snapshot: `workOrderAttentionProjection`, `jobRiskScoring`, `dispatchScoring`, `timelineBuilder`.
Panel invariants (props shape, no Firestore in panels, no inline scoring, canonical Signal) are
preserved — this is a recomposition, not a data change. No new Firestore read is required.

## Disposition of today's blocks

| Today | P1 |
| --- | --- |
| bare h2 header | workspace header with kicker, rule pair, action cluster |
| technician degradation notice | kept (honest state done correctly) |
| five unlinked stat tiles | 4 linked metrics + exception counts; Available/On-WO merged |
| bare ⚠ unassigned warning | merged into the attention block (Urgent section) |
| full WO card wall + per-card actions | **cut** (SO-D2) |
| Technician Load divs | Technician load table (Overloaded panel folded in as Load column) |
| six equal panels | Attention promoted · At Risk = primary table · Dispatch Queue = suggestion tray · Overloaded folded · Activity → rail · Parts Overview **cut** (SO-D3) |

## Behavioral backlog — named product decisions (Owner)

- **SO-D1 — the page exists.** Recommendation: keep as Overview. The alternative (delete; board
  absorbs attention + queue) is a legitimate Owner call; the design does not foreclose it.
- **SO-D2 — the work-order wall is cut.** Every WO renders as at most one exception row with a link.
  Depends on nothing; per-card `WorkOrderActions` usage on this page retires with it.
  `controlTower/WorkOrderDetail.jsx` loses its last caller here — dead-code decision travels with SO-D2.
- **SO-D3 — Parts Overview leaves this page.** The planned-demand rollup belongs to Inventory/
  Operations. Parts EXCEPTIONS stay: they surface as the attention block's Parts blocked section
  (see SO-G5) — exceptions in, rollup out.
- **SO-D4 — "Completed this week" scope.** Today's count is all loaded finished WOs, not a time
  window. The designed label implies a window read that does not exist yet — either build the
  windowed read or ship the label as "Completed" over current-snapshot truth.

## Gaps (truthful states designed in)

- **SO-G1** — At-risk age can be unknown (`createdAt` unusable): rendered as "age unknown", sorted last (domain already does this).
- **SO-G2** — Technician read can fail independently: notice band kept; load table states "unavailable" rather than computing over ids (1c).
- **SO-G3** — Activity is derived from the loaded snapshot, not an audit log — labeled as such in the rail.
- **SO-G4** — Dispatch suggestions are read-only here; the governed assign command exists only on Dispatch/Board. The tray links, never executes.
- **SO-G5** — Parts blocked attention. `workOrderAttentionProjection` already carries a Parts Blocked section, honestly empty because ControlTower does not read `partsReadinessByWorkOrderId` (a new, separate Firestore-read integration — documented boundary in WorkOrderAttentionPanel.jsx). The slot is designed in 1a; until the read is wired it renders one line — "Parts readiness isn't connected to this page yet" — never fabricated, never dropped. Calling out explicitly per the brief §8: this recommendation requires a new read.

## Integration order

1. Header + rule pair + action cluster (nav-only; no new authority).
2. Attention block from `workOrderAttentionProjection` + unassigned filter (replaces ⚠ div); Parts blocked section ships in its SO-G5 interim state, lights when the readiness read lands.
3. Metric strip (existing counts, re-grouped, linked).
4. At-risk table from `jobRiskScoring` (severity/age sort preserved).
5. Technician load table (techGroups + `detectOverloadedTechnicians`).
6. Suggestion tray from `computeDispatchRecommendations` (collapsible, one per page).
7. Activity rail from `timelineBuilder` (filter preserved as labeled tabs).
8. Remove WO wall + Parts Overview (SO-D2/SO-D3 after Owner ratifies).

## Acceptance checklist

- [ ] Sandbox render vs 1a side-by-side, whole composition (Design + Owner).
- [ ] Clean day: attention absent (not an empty box), no suggestion tray (1b).
- [ ] Loading / failed WO read / degraded technician read match 1c wording.
- [ ] Every metric links; every exception count reaches its rows.
- [ ] No raw document id rendered as content; status as words, never enums.
- [ ] Regression: panel invariant assertions still pass (props shape unchanged).
- [ ] Realistic data volume (the old list-wall case) — page height stays bounded.
