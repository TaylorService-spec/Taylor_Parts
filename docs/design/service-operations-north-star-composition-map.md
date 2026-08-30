# Service Operations North Star P1 — composition map

The reconciliation between the design artifact
([`docs/north-star/service-operations/North Star - Service Operations P1.dc.html`](../north-star/service-operations/North%20Star%20-%20Service%20Operations%20P1.dc.html)),
the Service Operations surface as it stood, and the governed behavioral truth underneath it. Produced
before any UI code changed, per the North Star execution rule, and updated with the Owner's rulings.

**Design authority:** the artifact above, frames 1a–1d, plus
[`DESIGN-HANDOFF-SERVICE-OPERATIONS-P1.md`](../north-star/service-operations/DESIGN-HANDOFF-SERVICE-OPERATIONS-P1.md)
and [`README.md`](../north-star/service-operations/README.md) in the same folder.
**Behavioral authority:** `src/domain/workOrderAttentionProjection.js`, `jobRiskScoring.js`,
`dispatchScoring.js`, `timelineBuilder.js`, and the governed Work Order engine behind them.
**Where they conflicted, behavioral truth won.** Each conflict is a named decision below, not a
silent resolution.

## The one thing to read first

**Nine items the artifact drew could not be rendered truthfully, and every one of them was a fact the
page would have had to invent.** Not styling disagreements — claims. A severity the attention model
does not assign; a section that would have counted the same work order twice; a clock time the schema
does not record; a person where only a role exists; an actor the event model has never carried; a
board filter with no URL seam; a technician count that included off-shift staff; a route that does
not exist; and a business concept ("past readiness") that appears nowhere in the repository.

A migration that reproduced the mockup would have shipped all nine. They were caught by checking every
drawn element against the function that would have to supply it, before writing any component.

## Verdict — the page survives as an Overview

Service Operations stays at `/service-operations` with internal key `controlTower`, recomposed into
the grammar's **Overview** archetype: the cross-cutting exceptions read for Admin and Dispatcher.

It stops re-rendering the Work Order record (the migrated Work Order family owns that), stops hosting
dispatcher transitions (the record and the Dispatch Board own those), and re-ranks its existing panels
by decision value instead of by the order the sprints added them.

Ordering law as shipped: **kicker → header → attention → metrics → work → rail.**

## Disposition — what happened to every block on the old page

| Was | Is | Ruling |
|---|---|---|
| bare `<h2>` | workspace header: kicker, rule pair, live indicator, action cluster with one filled primary | — |
| technician degradation notice | kept, and extended to say the reader's other work is unaffected | — |
| five unlinked stat tiles | four metrics, each linked, each carrying its exception count | SO-N7, SO-N9, SO-D4 |
| bare `⚠` unassigned warning div | deleted; the governed attention block replaces it | SO-N2 |
| every work order as a full detail card, each with its own action cluster | **cut** — a work order is at most one exception row with a link | SO-D2 |
| "Technician Load" text divs + separate Overloaded panel | one Technician load table, overload folded in as a column | — |
| six equal-weight panels | attention promoted above everything; At risk is the primary table; dispatch becomes the page's one suggestion tray; activity moves to the rail; Parts Overview leaves | SO-D3 |
| `WorkOrderActions` inside every card | **no governed transition anywhere on this page** | SO-D2 |

## Item-by-item: does the drawn element fall within functionality?

Every row was checked against the function that would have to supply it.

### Buildable as drawn, no new read

| Drawn | Source | Note |
|---|---|---|
| Attention sections + deep links | `workOrderAttentionItems` + `groupWorkOrderAttentionItemsBySection` | Sections are fixed and governed |
| Account on a row | join `workOrderId → wo.customerId → useAccountNames` | Already loaded; a join, not a derivation |
| At risk severity, age, factors | `detectStalledJobs` | Null age handled, sorted last |
| Dispatch suggestions, "n open, m placeable" | `computeDispatchRecommendations` | Counts, not new scoring |
| Technician load + overload | `groupJobsByTechnician` + `detectOverloadedTechnicians` | |
| Status as a word | `technicianStatusLabel` | Imported from its existing home; not relocated |
| Activity entries | `buildTimeline` + `describeEvent` | Description only — see SO-N3 |
| Live indicator | `subscribeToWorkOrders` + `useFirestoreCollection` | Both are `onSnapshot`; the claim is true |
| Verenward tokens, Source Serif 4, Inter | `src/index.css` | All present and self-hosted |

### Not buildable as drawn — the nine rulings

| # | Drawn | Why it could not ship | Ruling |
|---|---|---|---|
| SO-N1 | "Urgent / Stalled / Parts blocked" severity words on attention rows | The attention projection carries no severity, deliberately. Its header warns that one badge vocabulary across attention and risk makes both meaningless. | Attention keeps ACTION_ITEM/NOTIFICATION → "Action needed" / "In progress". Risk severity lives only in the At risk table. |
| SO-N2 | An "Urgent" section folding in `unfinished && !assignedTechId` | Not a governed section, and it double-counts: that work is already Ready to Schedule. It also puts a business derivation back in JSX. | Governed sections only, in `WO_ATTENTION_SECTION_ORDER`. |
| SO-N3 | A clock time per activity entry | `timelineBuilder` stamps **every** milestone with the work order's `createdAt`. Three milestones would show one identical time — false precision. | No per-entry time. Order is real and preserved. Gap recorded as SO-G6. |
| SO-N4 | An "Owner" on each attention row | `recipientRole` is a role (`DISPATCHER`), not a person. No ownership model exists. | Omitted. Never "Owner: Dispatcher". |
| SO-N5 | An actor on each activity entry | The event model carries no actor identity at all; `describeEvent` returns a static per-type label. | Omitted. |
| SO-N6 | "Board lane →" with the technician preselected | `TechnicianFilter` takes its selection through props. There is no URL-param seam. | "Open board →" — wording matches what the link does. |
| SO-N7 | "Technicians on shift" over `technicians.length` | That count includes `OFF_SHIFT`, making the label false. | `status !== OFF_SHIFT`. |
| SO-N8 | `/work-orders/:id` | That route does not exist. The governed route is nested under `/service` and is permission-gated. | `/service/work-orders/:id`, via the projection's own `deepLink`. |
| SO-N9 | "n past readiness" | Not a repository or domain fact under any name. | The governed Ready to Schedule attention count, named exactly that. |

### Gaps carried, not closed

- **SO-G4** — dispatch suggestions are read-only here; assignment is the governed command on the
  Dispatch Board. The tray says so and offers no assign control.
- **SO-G5** — parts readiness is not read by this page. The Parts Blocked section therefore cannot
  populate, and an empty section would read as "no parts problems". Where an attention block renders,
  it states *"Parts readiness isn't connected to this page yet."* Wiring the read is separate work; the
  projection already accepts it.
- **SO-G6** — authoritative per-transition activity timestamps do not exist. Presentation cannot
  create them.
- **SO-G7 — NEW, found by this migration.** R23 says an exception record must never disappear for want
  of a field. For the At risk table that is **not currently true**: `jobRiskScoring` scores an
  unreadable `createdAt` as 0 for both age and stagnation, so the work order falls to `LOW` and
  `detectStalledJobs` — which returns only `HIGH` and `CRITICAL` — drops it. **The work order the
  system knows least about is the one it shows least.** This is pre-existing (the old panel rendered
  the same output, so its own "age unknown" branch was unreachable through this path) and fixing it
  means changing risk scoring — a domain authority change, out of scope for a presentation migration.
  Pinned by a test so it stays visible.

### Two defects found and corrected in passing

- The old page passed `label="Loading operations"` to `LoadingState`, which takes **children**. The
  prop was ignored and the generic "Loading…" rendered instead; the specific wording never reached
  anyone.
- The old At risk panel rendered `signal.severity` directly, printing the raw enum **"CRITICAL"** at
  the reader. Severity is now a word.

## The architectural invariant, restated

The old header claimed *"every panel receives exactly `{ jobs, technicians, workOrders }` — no panel
may accept or require any other prop shape."* That had stopped being true: `WorkOrderAttentionPanel`
already took a fourth prop, and `assertPanelProps` only ever checked that three named arrays were
arrays. Nothing tested the sentence, so nothing caught the drift.

It is restated to match the code, and made stronger rather than weaker:

1. **The composition root owns the reads.** `useWorkOrders`, `useFirestoreCollection` and
   `useAccountNames` are called in `ControlTower.jsx` and nowhere else in the module.
2. **Derivation lives outside JSX**, in `src/domain/serviceOperationsNorthStar.js`, which composes the
   governed modules and derives no business fact of its own.
3. **Sections are pure presenters** of finished rows plus local UI state.
4. **Governed projection shapes are preserved** — attention items keep their `sectionLabel`,
   `attentionType` and `deepLink`; risk signals keep the canonical `Signal` shape.

`test/serviceOperationsComposition.test.jsx` asserts 1 and 2 **against the source**, so the wording
cannot drift from the code the way the previous sentence did.

## Proof

| Suite | What it makes falsifiable |
|---|---|
| `test/serviceOperationsNorthStar.test.jsx` (33) | SO-N1..SO-N9 as rules, plus SO-D4, SO-G5 and the SO-G7 pin |
| `test/serviceOperationsComposition.test.jsx` (20) | 1a composition and ordering, 1b clean day, 1c honest states, and the invariant asserted against source |
| `test/workOrderAttentionPanel.test.jsx` (9) | Section order, names never ids, terminal exclusion, no severity word, no owner |
| `test/serviceOperationsRisk.test.jsx` (11) | Risk domain honesty + the render path, severity as a word, one table pattern |

CI: `.github/workflows/service-operations-north-star-tests.yml`, path-filtered to the projection, the
module and the four suites. Registered — `test/ciSuiteCoverage.test.mjs` fails the build for a vitest
suite no workflow names, and it caught these two before they could ship uncovered.

Full local run at implementation: **258/258 node suites, 2743/2743 vitest tests, `vite build` clean,
oxlint clean.**

## What was deliberately not done

- **No new Firestore read**, no Function, no Rules change, no capability change, no state-machine
  change, no dispatch-write authority.
- **`controlTower/WorkOrderDetail.jsx`, `WorkOrderActions.jsx` and `PartsOverviewPanel.jsx` were left
  in place**, no longer called by this page. Deleting them is the separate dead-code decision that
  travels with SO-D2 and SO-D3.
- **`technicianStatusLabel` was not relocated** into `domain/`. It has three consumers and a
  conformance test pinning its import path; moving it is not a rider on this migration.
- **The four domain modules with extensionless imports were not touched**, which is why both new
  suites are vitest rather than `node:test`.

## Acceptance

Per the three-authority model, engineering proof is not acceptance. This family ends at
**`AWAITING_OWNER_VISUAL_ACCEPTANCE`**: the sandbox page must survive whole-composition side-by-side
comparison against frame 1a by Design and the Owner — including 1b and 1c, and at realistic data
volume, which is the case the old list wall failed.
