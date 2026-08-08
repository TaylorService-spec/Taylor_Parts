# IA Evidence — the stub destinations personas kept hitting

Classification from **repository evidence**, cross-referenced against what personas
actually did when they landed there. No persona run was spent on this: the routes and
their renderers are static facts, and the behavioural evidence already exists across
seven completed missions.

**No route added, removed, relabelled or consolidated.** Final Service IA remains
gated on C713×5 Round 3.

Every one of these renders the same shared `PlaceholderPage`: *"This area isn't built
yet. It's reachable now so the navigation foundation reflects the platform's target
shape… ahead of implementation."* That intent is legitimate. The evidence below is
about what it costs a working user, and the costs are **not** uniform — which is why
"hide all stubs" would be the wrong conclusion.

| Destination | Classification | Evidence |
|---|---|---|
| **Back Orders** (Inventory) | **MISPLACED / ACTIVELY MISLEADING** | Highest cost of the six |
| **Notifications** (Dashboard) | **DUPLICATE ENTRY POINT** | A working bell and a stub page coexist |
| **Activity** (Dashboard) | **UNRESOLVED IA QUESTION** | Overlaps existing Operational History |
| **Warranty** (Service) | **GENUINE FUTURE CAPABILITY** | No competing surface, no user drawn to it |
| **Demand Planning** (Purchasing) | **GENUINE FUTURE CAPABILITY** | Same |
| **Reporting → Inventory / Purchasing** | **EMPTY IMPLEMENTATION of a built capability** | A real report builder exists elsewhere |

## Back Orders — the only one causing measurable harm

Three separate personas navigated here **while chasing the blocked water inlet valve**,
because the label describes exactly their situation: a part on order that hasn't
arrived. All three found a stub.

> *"For a person actually chasing a missing part, this is the most disorienting dead
> end in the whole app."* — dispatcher
>
> *"'Back Orders' sounds exactly like 'a part we ordered that hasn't arrived' —
> precisely my situation — but it's an unbuilt stub. Actively misleading given the
> label."* — dispatcher, separately

This is **not** the ordinary cost of an honest placeholder. The other five are visited
out of curiosity; this one is visited *by someone with a live operational need it
appears to serve*, and it is the single most-hit stub across the missions.

It is also **entangled with the routed demand-lineage question**: a "back order" is
arguably the very relationship Product has yet to define between a reorder request and
the demand that caused it. Building or hiding it now would pre-empt that decision.

**Recommendation: ROUTE, do not fix.** Its disposition depends on the demand-lineage
model. **Do not relabel it** — the label is accurate to what it will be; the problem is
that it is reachable and empty while a real back-order need exists.

## Notifications — two entry points, one works

The bell shows real content (personas read `PRT-1003 · PENDING REVIEW · MEDIUM` from
it, and a badge count of 2). The nav page for the same concept is a stub. One persona
also reported a **dead badge** over the stub.

**This is a duplicate entry point, not a missing capability.** It is the clearest
candidate of the six for an IA correction — but it belongs with the Notifications
concept as a whole, including the contradiction already recorded (the bell announces a
part the Inventory queue simultaneously reports as absent). **Evidence recorded; not
acted on**, because the fix is a consolidation decision and consolidation is gated.

## Activity — an unresolved question, not a stub to build

Work Orders already carry **Operational History**. Reorder requests carry a
**History** table. An "Activity" destination overlaps both without stating its scope:
whose activity, over what, at what grain?

Notably, a persona went here **looking for the audit trail of the rejected reorder** —
i.e. for provenance that does not exist in canonical data at all. Building an Activity
page cannot satisfy that; the missing data is the routed lineage question again.

**Recommendation: keep as an open IA question.** Do not build, do not hide.

## Warranty and Demand Planning — leave alone

Genuine future capability. No competing surface, no established user need pulling
anyone toward them, no contradiction. Personas visited them while sweeping, not while
working. The placeholder does exactly its job.

**Recommendation: no action.** These are the cases that justify the placeholder
pattern, and they are why "hide every stub" would be wrong.

## Reporting → Inventory / Purchasing — different in kind

A **working, governed report builder exists** (report catalog, query, run outcome,
saved reports — substantial tested code). These two nav entries are empty
implementations of a capability the platform genuinely has, not previews of one it
lacks.

**Recommendation: route to the Reporting owner** as a coverage gap — "these domains
have no report definitions yet" is a different statement from "this area isn't built
yet", and the current copy makes the stronger, wrong claim.

## The cross-cutting finding

Personas reported repeatedly that stubs are **visually indistinguishable in the nav
rail from working destinations**, so the cost is a click-and-wait per discovery:

> *"either gray these out / badge them 'Coming soon' in the nav itself so a busy person
> doesn't waste a click-and-wait cycle finding out, or don't link them yet."*

That is a real, cheap, low-risk improvement — and I am **deliberately not making it**.
Marking nav items is exactly the kind of change §10's standing instruction reserves for
the evidence-driven IA decision, and the six above do **not** want the same treatment:
Warranty is honest, Back Orders is misleading, Notifications is a duplicate, and
Reporting is mislabelled. A single "Coming soon" badge applied uniformly would flatten
four different problems into one cosmetic answer and make the IA decision harder, not
easier.

**Carried into the IA backlog with the classification above.**

## Routed to Product

- **Back Orders' disposition** — depends on the demand-lineage model already routed.
- **Reporting coverage** for Inventory and Purchasing domains.
- **Activity's scope**, if it is to exist at all, given Operational History already exists.
