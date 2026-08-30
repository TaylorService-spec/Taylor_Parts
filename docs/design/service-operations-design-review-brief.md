# Service Operations — design review brief

**Status:** Handoff brief for design review. **Analysis only — no code changed, nothing proposed as
built.** Produced from the current repository state, not from recollection; every claim below carries
a file and line reference so the reviewer can check it.

**Ask:** the Owner's assessment is *"feels like it's a dashboard for service but looks like a hot
mess."* This document gives design what it needs to review that page and make recommendations: what
the page is, who sees it, what data it already holds, what governs any redesign, and the questions
only design can answer.

---

## 1. The one thing to read first

**Service Operations was never migrated to the North Star grammar, and it is the only surviving page
that renders the Work Order record its own way.**

`docs/design/north-star-migration-ledger.md` records five migrated page families — Work Order, Sales
Order, Account, Opportunity, Sales Agreement. Service Operations is in none of them. It predates the
ratified grammar in `docs/design/eos-north-star-design-grammar.md` and has accumulated content by
append: several sprints each added a block to the bottom of one flat column.

The result is not a dashboard that reads badly. It is an **accumulation with no composition** — no
archetype, no ordering law, no hierarchy, and no editorial answer to *what does a service manager
need to see first*. The Owner's reaction is a correct reading of the structure.

---

## 2. Where the page lives

| | |
|---|---|
| **User-facing name** | Service Operations |
| **Route** | `/service-operations` (the retired `/service/control-tower` redirects to it — `App.jsx:865`) |
| **Internal key** | `controlTower` — deliberately stable, it is the `legacyKey` wired to `LEGACY_COMPONENTS` and `ROLE_NAV_ACCESS` (`moduleRegistry.ts:48`) |
| **Composition root** | `src/modules/controlTower/ControlTower.jsx` — 225 lines |
| **Panels** | six, in `src/modules/controlTower/panels/` — 353 lines total |
| **Audience** | **Admin and Dispatcher only.** Technicians cannot see it (`src/domain/constants.js:374`) |

Both roles that can see this page can also see `dispatcherBoard`, `dispatch`, `jobs`, `technicians`,
`inventory` and `operations`. That matters — see §6.

---

## 3. What is on the page today, in render order

One `<div className="fo-panel">` containing, top to bottom, with nothing between the blocks but
document flow:

1. **`<h2>Service Operations</h2>`** — the entire page header. No kicker, no context, no action
   cluster. (`ControlTower.jsx:157`)
2. **A conditional degradation notice** when the technician read fails independently of the
   work-order read. (This one is good — it is honest-state done correctly, and should survive any
   redesign.) (`ControlTower.jsx:161`)
3. **A five-tile stat grid** — Open Work Orders · In Progress · Completed · Techs Available · Techs
   On Work Order. **None of the five is linked**, and none carries an exception count.
   (`ControlTower.jsx:167`)
4. **A bare warning `div`** — `⚠ Work Orders with no assigned technician: {n}` — a raw glyph and a
   count, not a link, not an attention block. (`ControlTower.jsx:191`)
5. **Every work order, unfiltered, unsorted, uncapped, rendered as a full detail card** —
   `workOrders.map(...)` (`ControlTower.jsx:197`). This is the wall the page is mostly made of.
   There is no pagination, no filter, no "show more", and no sort — whatever the work-order read
   returns is rendered in full, and **each card carries its own dispatcher action cluster**
   (Mark Ready / Schedule / Dispatch / Close / Cancel, via `WorkOrderActions.jsx`).
6. **"Technician Load"** — an unstyled `<div>` per technician reading `Name: 3 jobs`. No table, no
   row pattern, no link. (`ControlTower.jsx:208`)
7. **Six signal panels, stacked, all at the same visual weight** (`ControlTower.jsx:216`):

   | Panel | What it renders | Its own controls |
   |---|---|---|
   | Work Order Attention | Attention Items grouped into sections, each a deep link | — |
   | At Risk Jobs | stalled-job risk signals with severity + age | a `Sort:` `<select>` |
   | Recommended Dispatch Queue | per-WO technician recommendation + reasons | — |
   | Overloaded Technicians | technicians over workload, with active job count | — |
   | Activity Timeline | derived operational events | a `Filter:` `<select>` |
   | 🧰 Parts Overview | planned parts demand rolled up by SKU | a Show/Hide button |

   Each opens with its own `<h3>`, each is styled `tech-overview tech-overview--compact`, and each
   shouts at exactly the same volume as the other five. Two carry bare unlabelled `<select>`
   elements. One leads with an emoji.

**Net effect:** on a busy day the six intelligence panels — the part of the page with the most
decision value — sit *below* an unbounded list of full work-order cards. The signal is under the
noise, by construction.

---

## 4. What the page already has to work with

Design should know it is not short of material. The composition root already owns a single Firestore
snapshot and passes it everywhere, and the derivation layer is already built and governed:

- **Live data:** work orders (governed `fieldops_wos` via `useWorkOrders`), technicians, resolved
  account names, work orders grouped by technician.
- **Existing domain projections**, all pure and already consumed here: `workOrderAttentionProjection`
  (normalized Attention Items with deep links and section grouping), `jobRiskScoring`,
  `dispatchScoring` (recommendations + overload detection), `timelineBuilder`, `workOrderScoring`,
  `workOrderInventorySnapshot`.
- **Shared primitives:** `StatusPill`, `SignalBadge`, `LoadingState`, `FailureState`, `Button`.

So a redesign is overwhelmingly a **composition and hierarchy problem, not a data problem.** Almost
nothing new has to be computed to build a better page.

---

## 5. Constraints any recommendation has to respect

These are not preferences; they are ratified in the repo.

**From the design grammar** (`docs/design/eos-north-star-design-grammar.md`):

- **Ordering law:** kicker → header → lifecycle → attention → work → rail.
- **Attention block comes first in the work area**, and **renders nothing when clean.**
- **Metric strip: 3–5 numbers, each with its exception count and a link. Never unlinked vanity
  numbers.**
- **One table pattern** for all row data.
- **Action cluster belongs at the right end of the header — never scattered through body sections.**
- **Ten page archetypes govern all destinations; there is no eleventh grammar.** Overview · Entity
  list · Operational queue · Record detail · Sub-record drill-in · Create/edit · Workflow execution ·
  Board/scheduler · Handheld flow · State page.
- **Honest-state model:** twelve situations, one rendering each. No blank regions, no spinners
  standing in for content.

**From the page's own architecture** (documented in `ControlTower.jsx`'s header and enforced by
`domain/controlTower/types.js`, asserted in dev builds):

1. Every panel receives exactly `{ jobs, technicians, workOrders }` — no other prop shape.
2. No panel may read Firestore; the composition root is the only listener owner.
3. No panel may inline scoring or derivation logic; panels render what the domain returns.
4. Every rendered signal must be a canonical `Signal` — `{ id, score, severity, label, metadata }`.

**A redesign may freely re-lay-out, re-group, re-rank, tab, collapse, defer or remove these panels.
It may not make a panel fetch its own data or compute its own severity.** That boundary is what keeps
the page honest, and it is not a design constraint worth trading away.

---

## 6. The question this page cannot answer about itself

**Which archetype is Service Operations, and what does it own that its neighbours do not?**

The same two roles who see this page also see:

- **Dispatcher Board** (`modules/dispatcherBoard/`) — the *migrated* North Star P1 board, shipped and
  gated, with lane grid, ready-to-schedule queue, technician filter, activity feed and placement.
- **Dispatch** (`modules/dispatch/`) — where a job actually gets assigned.
- **Operations** (`modules/operations/`) — inventory health, warehouse reconciliation, procurement.
- **Work Orders** (`modules/workOrders/WorkOrderDetailPage.jsx`) — the *migrated* North Star Work
  Order record page, over `domain/workOrderNorthStar.js`.

Service Operations currently overlaps all four. Most sharply: it renders work-order detail through
`controlTower/WorkOrderDetail.jsx`, **a legacy rendering of the Work Order record used by no other
screen in the app**, while the migrated North Star rendering of that same record lives one route
away. Two different visual grammars for one business object, both reachable by the same user in the
same session.

That is a product and IA decision, not a styling decision — which is exactly why it goes to design
rather than being resolved in a refactor.

---

## 7. What we are asking design to answer

1. **Archetype.** Is this an *Overview*, an *Operational queue*, or should it stop existing as a
   destination and have its parts absorbed by Dispatcher Board / Work Orders / Operations? A
   recommendation to delete the page is an acceptable answer.
2. **The first screen.** If it survives: what does a dispatcher or service manager see in the first
   viewport, before scrolling? What is the single most important thing on this page?
3. **The work-order list.** Should Service Operations carry a full work-order list at all, given that
   the migrated Work Order family and the Dispatcher Board both exist? If yes — filtered how, capped
   at what, sorted by what, and rendered with which row pattern?
4. **The six panels.** Six equal-weight panels is the core of the "hot mess". Rank, group, tab,
   collapse, promote, or cut — and say which. Which of the six actually earn a permanent place in a
   dispatcher's field of view?
5. **The metric strip.** Five unlinked counts today. Which 3–5 numbers matter, what is each one's
   exception count, and where does each link to?
6. **Attention.** Two things compete for the "needs attention" role right now: the bare `⚠`
   unassigned-work-orders warning and the Work Order Attention panel. There should be one.
7. **Actions.** Dispatcher transitions currently sit inside every card in a long list. Where do they
   belong under the action-cluster rule?

---

## 8. Out of scope for this review

- **Authority, permissions and Firestore Rules.** Role visibility (Admin + Dispatcher) is governed
  elsewhere and is not a design variable here.
- **The domain/derivation layer.** Scoring, risk, recommendations, timeline and attention projections
  are governed and tested; design consumes them, and should not assume they can be changed to suit a
  layout.
- **New data.** A recommendation that requires a new Firestore read is not disqualified, but it must
  be called out explicitly as such rather than assumed free.
- **The internal key.** `controlTower` stays as the internal identifier regardless of what the page is
  renamed or restructured into; it is load-bearing in nav and access wiring.

---

## 9. Known gap in this brief

**No screenshot of the running page is attached.** Everything above is derived from source. A capture
of `/service-operations` in the sandbox with realistic data volume — specifically enough work orders
to show the list wall — would make the review materially better, and should be attached before this
goes to review.
