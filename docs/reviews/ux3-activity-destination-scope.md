# UX-3 — Activity destination scope

Interpreted from the routed Agent Manager evidence `UX-EX-001.result.json`, then traced
against repository authority. **No new agent request was made** — the existing evidence
was sufficient, and the contract forbids spending capacity on a settled question.

**Disposition: `PRODUCT_DIRECTION_REQUIRED`.** No UX fix is justified, and none was
manufactured to close the item.

## What "Activity" actually names today — four surfaces, three sources, four grains

Verified in the repository, not taken from the evidence on trust:

| Surface | Grain | Data source | Persistence |
|---|---|---|---|
| Service Operations → **Activity Timeline** | global / system-wide | `buildTimeline(jobs)` | derived-only |
| Work Order → **Operational History** | one Work Order | `buildTimeline(jobsForWorkOrder)` | derived-only |
| Dispatcher Board → **Recent Activity (this session)** | global status changes | `useSessionActivityFeed` | **ephemeral** — in-memory, capped, gone on reload |
| Account → **Service Activity** | one Account | `fieldops_wos` query | persisted |
| `/dashboard/activity` | **undecided** | **none — unbuilt** | — |

Two of these share one authority: Operational History is `buildTimeline` scoped to a
single Work Order — a **narrower view of the same builder**, not a competing authority.
That was already established in #708 and the evidence confirms it independently.

The other two are genuinely different: a session-only in-memory feed, and a persisted
per-Account query. So this is **not** a duplicate-entry-point problem. Four surfaces
legitimately show different things; they simply share a word.

## Corrected finding — the wayfinding claim is wrong

The evidence reports the `/dashboard/activity` placeholder points at "Service
Operations" while "the panel actually lives in Control Tower; no screen is labeled
'Service Operations'."

**Traced and refuted.** `navConfig.js` declares a top-level domain
`{ key: "serviceOperations", label: "Service Operations", path: "service-operations" }`,
rendered by `LEGACY_COMPONENTS["controlTower"]` — Platform Task 3 moved Control Tower
out of the Service sub-nav and **relabelled it Service Operations**, with
`/service/control-tower` redirecting there. "Control Tower" is the internal component
name; "Service Operations" is what a user sees and navigates to.

The #708 copy is correct as written. **No correction applied.** Recorded because the
observation was reasonable and the diagnosis was not — the reader saw the component,
not the label.

## Why this is not a UX decision

The open question is *what a standalone `/dashboard/activity` destination should be*:

- **global** — then it duplicates the already-live Service Operations Activity Timeline,
  and the right answer is probably to remove the destination rather than build it;
- **"my activity"** — a per-user grain that **no current surface provides** and no
  authority currently supports;
- **cross-domain roll-up** — would need Inventory / Purchasing / Sales events that
  `buildTimeline` does not consume, i.e. a new projection.

Each is a different product, not a different layout. Nothing in the repository decides
between them, and the evidence deliberately does not either. Choosing one here would be
manufacturing product direction and calling it UX.

Related unbuilt placeholders that any answer must be reconciled with: **Service History**
(Customers) and **Audit Logs** (Administration).

## UX recommendation, preserved for that decision

If a standalone Activity destination is wanted, the term collision should be resolved at
the same time — four surfaces named "Activity" at four grains is the comprehension
defect, and it cannot be fixed by relabelling one of them in isolation. UX's position:
**name the grain in every label** (whose activity, over what), rather than adding a
fifth "Activity".

**Not acted on.** Renaming navigation is an IA change, it is evidence-driven, and the
grain decision above must come first.

## Status — DECIDED

**Owner decision, 2026-08-09: retire the standalone destination.** It had no
demonstrated unique product responsibility, and neither "my activity" nor a
cross-domain roll-up was invented to justify keeping it — each would be a new
product with its own authority.

Implemented as the minimum IA correction: the single `navConfig` entry removed, with
the rationale left in place so the next reader learns why rather than re-deriving it.
A regression test guards restoration and names what must be decided first. The four
legitimate activity/history surfaces are untouched — their grains and authorities are
genuinely distinct, and the decision covered the standalone destination only.

Browser-verified: Activity absent from navigation; Service Operations timeline still
live; an existing `/dashboard/activity` bookmark falls through to the dashboard index
rather than erroring.

_(Original disposition, preserved:)_ `PRODUCT_DIRECTION_REQUIRED` — preserved with evidence. Not blocked on Round 3 (that
gate governs Service IA consolidation, a different question).
