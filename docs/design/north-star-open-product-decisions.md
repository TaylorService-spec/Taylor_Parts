# North Star — open product decisions

Status: **LIVE REGISTER.** Append-only in the same sense as `docs/DECISIONS.md` — a decision that is
made moves to RESOLVED with the answer and a pointer, and is never deleted.

## Why this file exists

The three-authority model (see [`eos-north-star-sources.md`](./eos-north-star-sources.md)) ends with
a rule that only works if something records its output:

> When Design and behavioral reality conflict, neither silently wins. The conflict is surfaced as a
> **named product decision**.

Named, and then written down somewhere a later session will find it. A conflict resolved in a PR
description is resolved for the length of one review; a conflict resolved in a chat transcript is
one cleared cache from being re-litigated. Both of those have already happened to this programme
once — the North Star artifacts themselves were nearly lost that way.

A decision here is not a defect and not a TODO. It is a question that **cannot be answered by
reading the code or the mockup**, because the two disagree and both are authoritative in their own
domain.

## How an entry gets here

Anyone — Design, Code, or the Owner — may open one. The bar is the practical test from the
authorities doc:

- Would resolving it change **what the business can do**? → product decision, it belongs here.
- Would it only change **how something already permitted is drawn**? → Design decides, not here.
- Would it change **who may do what, or what is recorded**? → Behavioral decides and says so, not here.

An entry states the conflict, what each authority currently holds, what shipped in the meantime, and
what is blocked until it is answered. It does not recommend an answer unless asked — the point is to
put the question in front of the person who can answer it, not to pre-decide it.

---

## Open

### ND-1 — Which model owns Work Order history

**Raised:** 2026-08-25, Work Order family review (#1494)
**Design holds:** the record shows a timeline of what happened, newest first, in the Work Order's
own vocabulary.
**Behavioral holds:** `domain/timelineBuilder.js` is the canonical activity-feed model, shared with
Control Tower and the Activity Timeline panel.
**The conflict:** measured on a `DISPATCHED` record carrying a real `createdAt` and a real
`dispatchedAt`, `buildTimeline([workOrder])` returns four events **all stamped `createdAt`**, one of
which (`READY`) the record never reached, while `dispatchedAt` does not appear at all. `jobEvents()`
stamps every event it derives `toMillis(job.createdAt)`. The shared model is authoritative for
*jobs*; a Work Order is not a job, and its own lifecycle timestamps are the record of when.
**Shipped meanwhile:** the Work Order page reads its own governed lifecycle timestamps.
`buildTimeline` is untouched and still authoritative where its inputs are jobs.
**The decision:** does the Work Order own its history, or does the activity feed — and if the feed,
does it stop inferring events it cannot time? Until answered, two surfaces can describe one record's
past differently.
**Blocked on it:** nothing ships blocked. Sales Order will hit the same question.

### ND-2 — "Repair" is not a governed Work Order type

**Raised:** 2026-08-25, Work Order family review (#1494)
**Design holds:** the approved composition writes `Work Order · Repair · P2 High`.
**Behavioral holds:** the governed set is `SERVICE_CALL / PM / INSTALL / WARRANTY / INSPECTION`.
There is no `REPAIR`.
**The conflict:** either the concept means `SERVICE_CALL` and the mockup is using trade shorthand,
or the business genuinely distinguishes a repair from a service call and the engine does not model
it.
**Shipped meanwhile:** the kicker renders the governed vocabulary; a type outside the set drops out
of the kicker rather than being title-cased into something that looks governed.
**The decision:** shorthand, or a missing type? The second is a data-model change with migration
consequences and is not a UI question.

### ND-3 — A dispatched Work Order offers no transition

**Raised:** 2026-08-25, Work Order family review (#1494)
**Design holds:** the record header carries exactly one filled button — the transition a dispatcher
almost always wants next. The composition draws *Re-dispatch* and *Reschedule* on a dispatched
record.
**Behavioral holds:** measured across every status and role, `DISPATCHED` allows **no**
non-destructive action to anyone. Only Cancel.
**The conflict:** the composition's primary affordance never appears on the state where it was
drawn. More broadly, once dispatched, nobody can reschedule or re-dispatch without cancelling.
**Shipped meanwhile:** the header renders what the engine allows. Nothing was widened.
**The decision:** is "dispatched is committed until cancelled" the intended operating rule, or is
this a gap in the transition engine? If the latter it is an engine change with Rules and audit
consequences — **not** something a page may close.

### ND-4 — The application shell and the record both claim `h1`

**Raised:** 2026-08-25, Work Order family review (#1494)
**Design holds:** the record's governed reference is the page's title.
**Behavioral holds:** the shell renders a visually-hidden `h1` naming the current domain
("Service"), on every page in the product.
**The conflict:** two `h1`s in one document. Permitted by HTML; a screen-reader user navigating by
heading hears the section and the document as peers. The shell heading names a *landmark*; the
record's names the *document*.
**Shipped meanwhile:** nothing. The record title was deliberately **not** demoted to satisfy a
heading count — that would trade a real information hierarchy for a passing test.
**The decision:** does the shell heading become an `h2`, or an `aria-label` on its landmark? Either
answer changes every page in the product, so it is a shell decision, not a page-family one.

### ND-5 — Two approved colours do not clear the contrast floor

**Raised:** 2026-08-25, Work Order family review (#1494)
**Design holds:** the bronze kicker is `#B08A55` on the paper ground, and a reached lifecycle stage
is `#237A45` on `#EDE8DE`. Both are drawn that way in the approved artifacts.
**Behavioral holds:** the codebase tracks contrast ratios in its own tokens and asserts state is
never carried by colour alone.
**The conflict:** measured live, the kicker is **2.79:1** and a completed chip is **4.36:1**. AA
wants 4.5:1 for text this size. The chip is 0.14 short and its state is *also* carried by a check
glyph; the kicker is not close.
**Shipped meanwhile:** both left exactly as the composition draws them, and reported rather than
restyled. Every other pair on the surface was brought to AA, including six classes that had picked
up a dark-rail colour on paper and measured **1.61:1** — invisible text, fixed.
**The decision:** darken the bronze, accept the ratio as a documented exception, or change what the
kicker carries so it is decorative rather than informational.

### ND-6 — The shared button primitive is four pixels under the touch floor

**Raised:** 2026-08-25, Work Order family review (#1494)
**Design holds:** a 44px minimum for anything a thumb touches.
**Behavioral holds:** `.fo-button` renders 40px tall, app-wide, on every surface.
**The conflict:** every handheld surface in the product is four pixels short, not just this one.
**Shipped meanwhile:** raised below 768px **for the Work Order record header only**. A shared
primitive is not a page-family PR's to change.
**The decision:** raise the primitive product-wide, which reflows every dense screen, or keep
per-surface overrides.

### ND-7 — Status: pill with a glyph, or plain coloured text

**Raised:** 2026-08-25, Work Order family review (#1494)
**Design holds:** the composition writes the status as bold coloured text in the fact row.
**Behavioral holds:** the codebase's `StatusPill` pairs every state with a glyph, on the stated rule
that state is never conveyed by colour alone.
**The conflict:** the approved treatment and the accessibility rule want different things in the
same place.
**Shipped meanwhile:** the pill, because the accessibility rule is the older and more specific
commitment.
**The decision:** Design's call, once it has seen it running — a glyph can be added to plain text,
which may satisfy both.

---

## Resolved

*(none yet)*
