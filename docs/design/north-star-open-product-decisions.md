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

### ND-8 — A Sales Order records no lifecycle stage times

**Raised:** 2026-08-26, Sales Order family (family 2)
**Design holds:** the lifecycle band is clickable, and each stage discloses one line of recorded
fact about what happened *at that stage* — the treatment approved for the Work Order and carried
into every subsequent family.
**Behavioral holds:** a Sales Order document stores `createdAt` and `updatedAt`, and nothing else.
`functions/src/salesOrder/salesOrderReadService.ts` projects exactly those two, because they are all
the write path has ever written. There is no `confirmedAt`, no order-level `allocatedAt`, no
`fulfilledAt`, `closedAt` or `cancelledAt`.
**The conflict:** the composition asks each stage when it happened, and for three of the four stages
the system genuinely does not know.
**Shipped meanwhile:** the band, unchanged in structure. The Confirmed stage states its time from
`createdAt`; every other stage states the absence in words and adds the quantity fact it *can*
prove ("2 of 3 lines allocated, 1 fully fulfilled"). `updatedAt` is rendered ONLY in the milestone
list, labelled "Last changed", because it is the time of the last write of any kind and presenting
it as a stage time would be a fabricated fact about a sale.
**What is blocked:** nothing on the page. What is blocked is the *answer* to "when did this order
enter fulfillment", which no surface can give today.
**The decision:** whether Sales Order lifecycle transitions should record stamps the way Work Order
transitions do. That is a behavioral/product question — it changes what is recorded — and it is not
a composition question. Answering it lights the existing band up with no further design work.
**Asserted by:** `test/salesOrderNorthStar.test.mjs` ("only the Confirmed stage states a time"),
which fails if any stage borrows `updatedAt`.

### ND-9 — A Sales Agreement has no resolvable reference

**Raised:** 2026-08-26, Sales Order family (family 2)
**Design holds:** lineage names what a record came from.
**Behavioral holds:** `sourceAgreementId` is projected and carried, and nothing anywhere resolves a
Sales Agreement to a business reference.
**The conflict:** the edge is real and cannot be named.
**Shipped meanwhile:** the edge renders as UNRESOLVED — it names the entity ("Sales agreement") and
states that the reference is unavailable. The document id is not printed, in either branch
(DECISIONS #106, R03).
**The decision:** whether Sales Agreements get a governed reference of their own. Until then this
edge is permanently unresolvable, and the register should say so rather than the page implying a
read is merely slow.

### ND-10 — The Sales Order page cannot claim to be live

**Raised:** 2026-08-26, Sales Order family (family 2)
**Design holds:** the record surface carries a live indicator — the concept's one intelligence
affordance that shipped whole on the Work Order.
**Behavioral holds:** `useWorkOrder` is an `onSnapshot` subscription and the claim is true there.
`useSalesOrder` is a ONE-SHOT callable read with an explicit `refetch`; the same badge here would be
false about the record in front of the reader.
**Shipped meanwhile:** no live indicator. The utility line states what is actually true — "Read once
— refreshed when you act" — rather than going silent, so the reader knows what they are looking at.
**The decision:** whether the Sales Order read becomes a live subscription. That is a cost and
authority question (the trusted read exists partly to avoid unrestricted client reads), not a design
one. If it does, the badge returns with no other change.
**Asserted by:** `test/salesOrderNorthStarPage.test.jsx` ("the page does NOT claim to be live"),
which fails the moment the claim is made without the subscription behind it.

### ND-11 — An Account has no lifecycle to make visible

**Raised:** 2026-08-26, Account family (family 3)
**Design holds:** NS-P1 — the lifecycle spine is visible and navigable on every record page. It was
named as a critical absence in all five pilot audits.
**Behavioral holds:** an Account has four status values (ACTIVE / INACTIVE / PROSPECT / ARCHIVED)
and **no transition command anywhere**. `status` is an ordinary editable field — it is in
`accountRecordPage.editableFieldIds` and is written through `updateAccount` exactly like `name` or
`notes`. There is no `transitionAccount`, no account lifecycle module, and nothing that constrains
which value follows which.
**The conflict:** the four values *look* like a progression. Drawn as four chevrons, the page would
assert that an account moves Prospect → Active → Inactive → Archived and does not go back. Nothing
enforces that: an archived account can be edited straight to Prospect and no guard would object.
**Shipped meanwhile:** **no spine.** The status is rendered as a sentence, and the page states the
reason in words — "An account has no lifecycle to show. Its status is a field someone sets, not a
stage it moves through" — rather than leaving an unexplained difference from the other two record
families.
**The decision:** whether an Account *should* have a governed lifecycle — a transition command, an
allowed-transition map, and a recorded history. That is a behavioral/product question about what the
business wants to enforce, not a composition question. If the answer is yes, the spine follows for
free.
**Asserted by:** `test/accountNorthStar.test.mjs` — including a test that fails the moment `status`
leaves `editableFieldIds`, so this decision cannot quietly outlive its own premise.


### A-NS-1 — The approved Account design says `useAccount` is not a subscription; it is one

**Raised:** 2026-08-26, Account North Star P1 reconciliation
**Design holds:** the Account page must not claim liveness — no live badge — and should state honest
freshness instead: "Read-checked *time* · Refresh". Its stated reason: *"useAccount is not a
subscription."*
**Behavioral holds:** `hooks/useAccount.js` uses `onSnapshot(doc(...))`. It is a live single-document
subscription, and has been since Sprint 2.0.2.
**The conflict:** only the premise. The design's *conclusion* is implemented exactly as written,
because the wording is true under either premise — the data is at least as fresh as the stamp, so
"read-checked at 9:12" understates rather than overstates. A live badge would be defensible here on
the repository's facts; the design asks for the quieter claim, and the quieter claim is never wrong.
**Shipped meanwhile:** the honest wording, `checkedAt` stamped on every snapshot delivery (a snapshot
OR an error), and Refresh wired to `useAccount`'s own `retry`. A page with no answer yet says nothing
rather than stamping a time it cannot evidence.
**The decision:** none required. This is recorded because a design note asserting something false
about the repository is worth someone noticing before it is quoted as a fact somewhere consequential
— not because anything needs ruling. It changes no business behavior.
**Asserted by:** `test/accountNorthStarPage.test.jsx` ("the freshness wording is honest and there is NO
live badge").

---
---

## Resolved by the Account North Star P1 design package (Owner ruling, 2026-08-26)

Four decisions the Account design package raised, all closed for P1. They are recorded here in full
because each one is a rule about what the page may SAY, and each is asserted by a test rather than
left to a reviewer to remember.

### A-D1 — Attention silence — **RESOLVED: silence**

**Answer:** when both attention sources are READY and empty, the surface is **absent entirely**. No
green all-clear, no "Nothing needs attention" receipt. That receipt used to render and has been
removed.
**Why it is the right answer:** a reader scanning for what needs them should find empty space where
trouble would have been. A line confirming the absence of trouble is one more thing to read on every
healthy customer, and it competes with the facts that are real.
**The line it does NOT cross:** silence is earned by a CONFIRMED-healthy read only. A source that
could not be confirmed — denied, unavailable, loading, truncated — still speaks, in its own note.
**Asserted by:** `test/accountAttentionSection.test.jsx` ("a fully-healthy account renders NOTHING")
and the two degraded-source tests beside it.

### A-D2 — AR denied presentation — **RESOLVED: preserve the geography**

**Answer:** a `finance.read` denial keeps the Accounts receivable section on the page, with its
title, and renders **"Not available to you"** in it. Never zero, never empty, never absent.
**Why it is the right answer:** `MetadataRecordPage` hides a gated section by rendering nothing,
which on this page removes the financial region entirely for a salesperson. A customer record with
no financial region reads as a customer who owes nothing — the one thing this page must never imply.
**The line it does NOT cross:** the page renders the denial, it does not decide it. The decision is
the same fail-closed capability answer, read once (`accountArGranted`, which reads the requirement
off `accountRecordPage` rather than naming a capability id).
**Asserted by:** `test/accountNorthStarPage.test.jsx` ("a denied AR read keeps the financial geography
on the page"), plus the standing-strip tests that prove DENIED is worded differently from
UNAVAILABLE and from a real zero.

### A-D3 — Archived account editing — **RESOLVED: Edit stays offered**

**Answer:** the composition is unchanged for an archived account and Edit remains available, because
that is current governed EOS behavior — no rule forbids editing an archived account.
**The line it does NOT cross:** making archived actually lock is a behavioral change (new
enforcement), not a presentation one, and is not in this package.
**Asserted by:** `test/accountNorthStarPage.test.jsx` ("an archived account keeps the same composition
and keeps Edit offered").

### A-D4 — Prospect composition — **RESOLVED: the same page**

**Answer:** prospects use the Account composition, with honest empties where AR and service activity
are absent. No prospect-specific page architecture.
**The line it does NOT cross:** a pipeline-led prospect composition would need the account-scoped
opportunity read active; that is a separate, later question.
**Asserted by:** `test/accountNorthStarPage.test.jsx` ("a prospect uses the same composition and
renders honest empties, not a separate page").

### ND-12 — An Opportunity records no stage times except the close — **WITHDRAWN 2026-08-26**

**Withdrawn, not resolved.** This decision was raised while the Opportunity family was being built
*blind* — before any design artifact for it existed in this repository. The blind build drew a
lifecycle **band** that opened one line of recorded fact per stage, which created a slot that needed
a time, which made the absence of stage timestamps a product question.

`North Star - Opportunity P1v2.dc.html` draws **chevrons**, not a band. Chevrons state position, not
history. There is no per-stage fact slot, so there is nothing for a stage time to be missing from,
and the question the decision was asking stopped existing.

The underlying data fact is unchanged and still true: an Opportunity stores `createdAt`, `updatedAt`
and — on an outcome transition only — `closedAt`, and nothing about when it entered Qualifying. If a
future surface ever wants stage durations, this entry is the record that the data is not there.

`closedAtMillis`, added to the governed projection during the blind build, is kept: it is a real
fact the transition writes that was projected to nobody, and the Activity section states it honestly.

### ND-13 — The Opportunity has two compositions, and only one of them is the record — **RESOLVED 2026-08-27: the pane is retired**

**Raised:** 2026-08-26 · **Narrowed by P1v2 the same day**
**Design holds:** one record, one record page.
**Behavioral holds:** the workspace's master-detail pane is where an Opportunity is **edited**, and
the record page is the **read** surface with the governed lifecycle actions.
**What P1v2 changed:** the design's own decision O5 asks for the per-record route precisely so the
Account related-lists and the Sales Order back-link can navigate to it, and the README describes the
P1v2 composition as the one that "currently lives as the workspace's detail pane". So the two are
explicitly the same composition in two places, not two competing designs — and both now consume one
derivation, one section model and one editing component (`opportunitySections.jsx`, extracted for
exactly this reason).
**Shipped meanwhile:** both, with the pane linking to the record page and the record page offering
the same version-checked section editing.
**The decision:** whether the pane is retired in favour of the record page once the Sales Agreement
North Star run gives the agreement its own surface. Still open, and still the question that decides
whether EOS workspaces keep detail panes at all.
**Asserted by:** `test/opportunityNorthStarPage.test.jsx` and `test/salesWorkspace.test.jsx`, which
between them prove the two surfaces read one derivation and one save path.

**RESOLVED 2026-08-27 (Owner, PR #1545 — North Star P1v4).** The pane is retired. `/customers/opportunities`
renders a collection whose only job is finding one opportunity; the record is reached, not embedded.

The general question this entry says it decides — *"whether EOS workspaces keep detail panes at
all"* — is answered for this family and, on the reasoning, for any family whose record has its own
route: **a pane that previews a page which already exists is a second, lesser copy of it.** The
constraint was never the composition, it was the capability. Retiring a surface deletes whatever only
that surface offered, which is why the sequence ran Sales Agreement record (family 5) → SA-G7 line
pricing (#1544) → collection (#1545), and why the create form moved onto the collection in the same
change. The lesson generalises even where the ruling does not: **check what only the pane offers
before removing it, not after.**

Answered by DECISIONS #135. Superseded design: Workspace P1v3, which was never built.

---

### ND-17 — The retired workspace is unrouted but still in the tree

**Raised:** 2026-08-27, by the Owner's scope ruling on PR #1545
**Owner ruling:** *"The Opportunity P1v4 acceptance condition is that the legacy workspace is no
longer routed as the Opportunity entry experience. Physical deletion is not required."*

**State:** `SalesWorkspace.jsx` is mounted nowhere in the app and is unreachable from the product.
Its module and its tests remain in the tree.

**Why it was not deleted with the migration, and this is the substance of the item rather than
housekeeping:** `test/salesWorkspace.test.jsx` and `test/salesWorkspaceDate.test.jsx` still assert
shared domain behaviour that has **no other coverage home** — among them the derivation and save
path ND-13 above cites as proof the two surfaces agreed. Deleting the component and its tests during
a presentation migration would have bundled unrelated cleanup into an accepted change and traded
away real regression coverage for a tidier directory.

**What closing this actually requires**, in order:

1. Enumerate what those suites uniquely cover — not what they *run*, but what would stop being
   asserted anywhere if they were deleted.
2. Give each surviving assertion a home on a surface that still exists (the record, the collection,
   or a domain suite), and prove the new home fails when the behaviour breaks.
3. Only then remove the module and its tests.

**Not urgent, and deliberately so.** An unrouted module costs a little bundle weight and some
reader confusion; deleting it early costs coverage. The order matters more than the timing.

**Related:** DECISIONS #135, ND-13.

---

### ND-14 — `DECLINED` is a modelled Sales Agreement state that nothing can produce

**Raised:** 2026-08-26, by the Sales Agreement North Star P1v2 design pass (SA-G5)
**Design holds:** a state the model names is a state the record page must be able to render
honestly, so P1v2 designs it — as a compact state study, explicitly labelled *modelled, currently
unreachable*.
**Behavioral holds:** `salesAgreementLifecycle.ts` declares `DECLINED` in `SALES_AGREEMENT_STATES`,
`checkAgreementTransition` permits `DRAFT → DECLINED`, and `salesAgreement.js` carries its label
"Declined". But `functions/src/index.ts` exports exactly three Agreement commands — `create`,
`updateDraft`, `accept`. **No callable produces `DECLINED`.** The state is reachable only by a
direct document write.
**Why it is not a bug to be fixed by the implementation pass:** creating a decline command is a new
governed action with its own capability, audit event and refusal rules. That is a product decision,
not a gap in a design.
**Shipped meanwhile:** nothing. Decline is **never** offered as an available user action; the state
study documents the condition and stops there.
**The decision:** should EOS support a governed decline action — or should the unreachable
`DECLINED` model state be removed and reconciled? Answering "remove it" is as legitimate as
"build it"; what is not legitimate is leaving a vocabulary the system cannot reach.

---

### ND-15 — Commercially agreed terms cannot change after an Agreement goes terminal

**Raised:** 2026-08-26, by the Sales Agreement North Star P1v2 design pass (SA-G6)
**Design holds:** a commercial commitment object must be able to answer "the customer wants
different terms" with something. P1v2 answers it with silence, deliberately, because the engine
answers it with a refusal.
**Behavioral holds:** two independent refusals compose into a dead end.
`buildUpdateSalesAgreementDraft` is DRAFT-only and `checkAgreementTransition` makes `ACCEPTED` and
`DECLINED` terminal, so the record cannot be edited. And `persistCreateSalesAgreement` step 3 does
an in-transaction duplicate check that **refuses a second Agreement** for the same Opportunity:
*"Opportunity X already has a Sales Agreement. Edit that draft rather than creating a second."*
Editing is forbidden and creating is refused, so under current authority there is **no governed
path** for changing commercial commitment after terminal acceptance.
**What this corrects:** P1v1's copy asserted "a changed mind is a new agreement" and "a new
conversation is a new agreement, drafted from the opportunity". Neither is supported. Both were
removed from visual authority.
**Shipped meanwhile:** nothing, and nothing may be invented. No **revise**, **supersede**,
**duplicate**, **reopen**, **replace agreement**, or **create a second Agreement** affordance
appears in the design, and none is in the implementation pass's scope.
**The decision:** what is the governed business process when agreed terms must change after an
Agreement reaches a terminal state? This needs deliberate domain design — amendment records,
supersession lineage, or a relaxed one-per-Opportunity rule are materially different answers with
different consequences for the Sales Order created from the superseded prices. **It must not be
accidentally solved in the presentation layer**, which is exactly what P1v1's sentence did.

---

### ND-16 — The Sales Agreement design and the shipped record grammar disagree on three widths

**Raised:** 2026-08-26, while preparing the Sales Agreement implementation work order
**Design holds:** 1A composes **224px** application nav, a **300px** contextual rail and a **40px**
gap, yielding an 820px commercial table inside a true 1440 frame. This was not arbitrary: the
Owner's correction order §9 named these exact levers — "slightly narrower contextual rail, smaller
gap, more compact application navigation" — because the agreed lines are the dominant content and
must not be squeezed to preserve a rail number.
**Behavioral holds:** `index.css` ships `--rail-width: 252px`,
`.ns-page { max-width: 1360px; padding: 0 32px }` and
`.ns-record-body { grid-template-columns: minmax(0, 1fr) 340px; gap: 0 56px }`. **`.ns-record-body`
is shared by every North Star family** — Work Order, Sales Order, Account and Opportunity all
compose through it. Its own comment records that the split is deliberately container-driven rather
than viewport-driven, because "the application rail takes ~250-300px before this page gets any
width" — a lesson learned from measuring the real shell, which a mockup cannot show.
**So this is not a design error or an implementation error.** It is two authorities that each
reasoned correctly from what they could see, reaching different numbers.
**Owner ruling, 2026-08-26 — build to the shipped grammar:** the Sales Agreement implementation
composes the **existing** 252 / 340 / 56 grammar, so the new family matches the four already
shipped. The artifact's 224 / 300 / 40 stand as **stated design intent**, not as measurements the
implementation must reproduce. Nothing accepted is re-opened and no family drifts.
**The decision still open:** should the shared grammar move toward the design's proportions for
*all* families — a narrower rail and tighter gap give every record's main column back ~56px — or is
340/56 the right long-term split and the Sales Agreement artifact should be amended to match? The
first re-opens four families' visual acceptance; the second costs the table width §9 asked for.
**Blocked on this:** the correction of the Opportunity P1v2 artifact's own dimensional defect
(its 1440-labelled frame renders at roughly 1640, drawing the composition at `.ns-page`'s 1360
max-width). Deferred by the Owner the same day, because the right artboard to draw depends on which
way this resolves.

---

## The Opportunity design's own product decisions (O1–O6, from the P1v2 handoff)

These are **Design's** register, carried here so they are visible alongside the programme's. They
are not implementation gaps to be closed by code — each is a question for the Owner, and each has a
truthful rendering shipping meanwhile.

| # | Question | What ships today |
|---|---|---|
| **O1** | `expectedValue` has no governed currency. Ratify one and store it, or keep the annotation? | A bare grouped number + "(no currency recorded)". A fabricated `$` was **found live on the pipeline surface** and removed. |
| **O2** | Resolve the customer name in the governed read, or denormalise at write? | **Addressed for this surface:** `getOpportunityContext` resolves the name server-side via the existing `resolveAccountNames`. Where it still cannot resolve, "Customer — name unavailable" renders with the account link live. |
| **O3** | Expose a bounded Opportunity activity read (stage changes, edits, Won/Lost)? | The Activity section states the gap in words and fabricates nothing. |
| **O4** | Compose the Account's primary contact into the rail? It adds a read to this surface. | **DECLINED by the Owner, 2026-08-27** — *"leave the customer card as is"*. Not composed, and the rail no longer explains that it isn't (DECISIONS #137): the card shows the customer and stops. Do not re-propose without a fresh Owner ask — it was raised, recommended and declined. |
| **O5** | Give the family a real per-record route. | **Done** — `/customers/opportunities/:opportunityId` over a new per-id governed read. |
| **O6** | Should the two Sales Order creation paths converge? Is multi-agreement ever a requirement? | Neither converged nor pre-decided — unchanged. The section that STATED both paths in prose ("When this closes") was removed as documentation-inside-a-record (DECISIONS #137); the paths themselves are untouched, and the order each produces is now reported as a header fact on the record that owns it. The card still reads the one governed agreement per opportunity. |

---

## Resolved

*(none yet)*

---

## Resolved by P1v2 (Owner ruling, 2026-08-25)

### ND-3 — A dispatched Work Order offers no transition — **ANSWERED, behavior deferred**

**Answer:** the approved composition's actions hold their positions **disabled and explicitly
unavailable**, so the action architecture matches the North Star now and lights up when the
behavior ships. Rendering them is presentation; building them is not.

**Standing risk, deliberately named:** the answer holds only if **B1** is actually built. A
placeholder that never becomes a button is permanent furniture advertising an action that does not
exist. B1 is approved as a separate future package — governed Reschedule command, DISPATCHED →
SCHEDULED semantics, capability/role eligibility, audit event, scheduling constraints, tests, UI
activation — and is out of scope for #1494 in full. **B2** (message technician) has no governed
messaging capability at all and stays disabled until a channel and its command exist.

**Not resolved by this:** whether "dispatched is committed until cancelled" is the intended
operating rule. That is what B1 decides.

### ND-7 — Status: pill with a glyph, or plain coloured text — **RESOLVED: sentence**

**Answer:** plain weighted text, as the concept draws it — and safely, because P1v2 writes the state
as a **clause** ("Dispatched — awaiting technician acceptance") rather than a label. A sentence
carries its meaning in words, so colour is emphasis rather than the carrier; a bare coloured word
could not have cleared the "never colour alone" rule. `workOrderStatusSentence` extends the existing
`STATUS_WORDS` vocabulary rather than forking it, so the header and the spine cannot drift.

---

## Still open after P1v2

ND-1 (which model owns Work Order history), ND-2 ("Repair" is not a governed type), ND-4 (the shell
and the record both claim `h1`), ND-5 (two approved colours under the contrast floor), ND-6 (the
40px shared button primitive).

**ND-2 now has a visible consequence.** The approved render writes `Work Order · Repair · P2 High`;
the running page writes `Work Order · Service Call · High (2)`, because those are the governed
vocabularies. The composition is unchanged — the words differ, and they will keep differing until
the question is answered.


---

## Open — raised by the Dispatch & Scheduler build handoff (2026-08-27)

Full evidence for all six lives in
[`dispatch-scheduling-authority-map.md`](./dispatch-scheduling-authority-map.md). Each clears the
bar in "How an entry gets here": each would change *what the business can do*, and none can be
answered by reading the code — because the thing they ask about does not exist in it.

### ND-18 — May a scheduled Work Order return to the queue?

**Raised:** 2026-08-27, Dispatch & Scheduler reconnaissance
**Design holds:** the Dispatch board returns a scheduled job to the Ready queue by dragging it there.
**Behavioral holds:** `transitionEngine.ts`'s `TRANSITIONS` table is strictly forward plus
`CANCELLED`. `SCHEDULED → {DISPATCHED, CANCELLED}` is the entire outgoing set. There is no backward
edge anywhere in ADR-002, and `canTransition` is a pure table lookup, so there is no back door either.
**The conflict:** an `Unschedule` command would be the **first reverse transition in the governed
lifecycle**. The alternative reading is that scheduling is a commitment, undone only by `Cancel` plus
a new Work Order.
**Shipped meanwhile:** nothing. The day board schedules `READY_TO_DISPATCH` work only and never
offers to un-place a job.
**The decision:** is un-scheduling a legitimate operating action, or is a scheduled job committed?
**Blocked on it:** the Ready-queue return interaction, and the precedent for every future reverse edge.

### ND-19 — Is `Reschedule` a lifecycle transition or a governed field command?

**Raised:** 2026-08-27, Dispatch & Scheduler reconnaissance
**Design holds:** a dispatcher drags a placed job to a new time and it moves.
**Behavioral holds:** the scheduled window lives in three *planning* fields (`scheduledStart`,
`scheduledEnd`, `scheduledTechId`) that `transitionEngine.ts` deliberately excludes from
`ACTION_TIMESTAMP_FIELD` precisely because they are mutable planning values, not execution facts.
**The conflict:** as a `SCHEDULED → SCHEDULED` self-transition, `Reschedule` edits ADR-002's table
and its client mirror (`workOrderWorkflow.js`), and introduces the first self-edge. As a separate
trusted callable rewriting planning fields under an unchanged status, it touches neither. Both are
defensible; the second is materially smaller and matches how the fields are already described.
**Shipped meanwhile:** nothing. `SchedulingWorkspace` explicitly refuses to fabricate a reschedule
(see `work-order-scheduling-workspace.md`, "Deliberate boundaries").
**Blocked on it:** the shape of the whole command family — `reassignScheduledWorkOrder` and
`unscheduleWorkOrder` follow whichever answer this gets.
**Relates to:** ND-3's package **B1**, which already names a governed `Reschedule` with
`DISPATCHED → SCHEDULED` semantics as approved-in-principle and separately scoped.

### ND-20 — Which scheduling conditions refuse, which warn, and which allow with a reason?

**Raised:** 2026-08-27, Dispatch & Scheduler reconnaissance
**Design holds:** the board shows conflict feedback.
**Behavioral holds:** exactly one rule is settled and shipped — overlapping the **same technician**
**refuses**, server-side, inside the transaction (`findScheduleConflict`, `failed-precondition`).
**The conflict:** four further conditions have no policy at all: scheduling outside a technician's
working hours, scheduling into blocked time, scheduling in the past, and scheduling an ineligible
technician. Each could reasonably refuse, warn, or allow with a recorded reason, and the answers are
not interchangeable. Field service legitimately schedules emergency work at 02:00, so a blanket
refusal on working hours is a real operating change rather than a safe default.
**Shipped meanwhile:** the one settled rule, unchanged.
**Blocked on it:** every validation branch in the new scheduling commands. Guessing here would bury
business policy in implementation, which the build handoff explicitly forbids.

### ND-21 — Does a Work Order carry an estimated duration?

**Raised:** 2026-08-27, Dispatch & Scheduler reconnaissance
**Design holds:** duration-based placement and percent-booked capacity indicators.
**Behavioral holds:** no estimated-duration or estimated-effort field exists on either the server or
client Work Order type. `durationMinutes` is derived from `scheduledEnd − scheduledStart` — a fact
about an *already-placed* job, never an estimate. This was audited once already and recorded in
`dispatchSchedulingBoard.js`, which groups the ready queue by `priority` for exactly this reason.
**The conflict:** without an estimate, a drag from the queue cannot propose an end time (the
dispatcher must state one), and "percent booked" has a numerator that only exists after the fact.
**Shipped meanwhile:** the ready queue groups by priority, and the drop handler proposes a default
60-minute slot as a *suggestion the dispatcher confirms*, never an inferred fact.
**The decision:** does a Work Order gain an estimated duration at creation — with the real
data-entry cost that carries — or does the board keep asking?
**Blocked on it:** truthful duration-based placement and any capacity arithmetic.

### ND-22 — Are recurring working hours and one-off exceptions one authority or two?

**Raised:** 2026-08-27, Dispatch & Scheduler reconnaissance
**Design holds:** technician lanes shade non-working time, and blocked time (PTO, lunch, training,
meetings, truck service, company closure) appears on the timeline.
**Behavioral holds:** `fieldops_technicians` carries a single **live** `status` of
`available | on_job | off_shift` and nothing else. There is no shift model, no calendar, and no
exception model anywhere in the repository.
**The conflict:** the build handoff says not to conflate a recurring weekly schedule with one-off
exceptions "unless repository architecture clearly favours that model". Nothing in the repository
favours either, because neither exists — so the question cannot be answered by precedent and has to
be decided.
**Shipped meanwhile:** the day board exposes `tech.status` so an `off_shift` row reads as
non-work-available, and draws no time blocks at all.
**Blocked on it:** the shape of the availability authority, its Rules blocks (Tier 2 either way), and
whether availability validation reads one collection or two.

### ND-23 — The Dispatch North Star design package is not in the repository

**Raised:** 2026-08-27, Dispatch & Scheduler reconnaissance
**Design holds:** *Dispatch and Schedule North Star P1v1* is the visual authority for this family.
**Behavioral holds:** `docs/north-star/` contains `lists`, `opportunity` and `sales-agreement`. No
Dispatch artifact has been handed to this repository.
**The conflict:** none of substance — this is a **recorded gap**, not a disagreement. It is here so
it is found now rather than at composition time, and so the family-2 precedent applies knowingly: a
family composed without its artifact makes Owner visual acceptance load-bearing rather than
confirmatory.
**Blocked on it:** step 14 onward (North Star Dispatch composition). Backend scheduling authority is
not blocked by it.

**Update, 2026-08-27 (live Scheduling Functional Gate):** the artifact was searched for again before
composition and was **not found anywhere reachable** — not in `docs/north-star/` (which holds
`lists`, `opportunity` and `sales-agreement`), not in the delivery folders the Opportunity and Sales
Agreement packages arrived through, and not in the published-artifact gallery. It has not been handed
over in any form. ND-23 therefore still stands open in its original terms, and its blocking effect on
composition is unchanged.

### ND-24 — The collision policy is enforced on one placement path and not the other — **RESOLVED 2026-08-27: ratified, and closed structurally**

**Owner ruling:** initial `Schedule` MUST enforce the same governed placement policy Reschedule
already enforces. Explicitly *not* a new product decision — ND-20 established the policy for the
scheduling domain, and this was a defect in how completely it was implemented. The Owner also
directed the *shape* of the fix: **do not implement a second copy of the validation table inside
`transitionWorkOrder`** — find the shared validation and make the existing path consume it.

**What shipped:** the policy moved out of `schedulingCommands.ts`, where it had been a private
function, into `functions/src/scheduling/placementPolicy.ts`. Both placement paths import and call
it. The sanitized `SchedulingError → HttpsError` table moved to `scheduling/errorMapping.ts` for the
same reason — `transitionWorkOrder` now raises those refusals and must not import a module whose top
level defines seven `onCall` handlers to reach an error table.

`Schedule` now refuses a past start, blocked time, an ineligible technician and an unknown one;
overlap is unchanged; outside-working-hours **warns and commits**, with the warnings returned on the
response as they already were for reschedule. The lifecycle meaning of `Schedule` is untouched —
`READY_TO_DISPATCH → SCHEDULED`, still a transition. Only its placement validation changed.

**Why it is closed structurally rather than merely fixed.** Nobody had written a disagreeing policy.
`checkPlacement` was private to one module, so it was reachable only by the callers that happened to
live there — the policy and the path that needed it were each correct and were never introduced to
each other. A behavioural test would have caught the symptom and not the shape, so
`test/schedulingPlacementAuthorityContract.test.mjs` reads the source and fails if a second
definition of the policy appears, if a placement path stops calling it, if one starts raising a
refusal the policy owns, or if `Schedule` discards the warnings. Adding a placement path means adding
one line to that suite's list; forgetting is a red test rather than a defect a live gate finds later.

**One behavioural consequence worth recording.** Two pre-existing emulator suites began failing on
the fix, because their fixtures seeded a technician *persona* without a governed
`fieldops_technicians` record and then scheduled onto it. `testKit.mjs`'s own comment described that
asymmetry as deliberate; it was not, it was the defect. The fixtures were corrected and the comment
rewritten. Placement now requires a governed technician record — a real narrowing, and the intended one.

Evidence: emulator E2E suite 50/50 (12 new symmetry checks), scheduling domain lane 40/40, transition
emulator suites 16/16, and the
live Scheduling Functional Gate at **32/32 PASS** after redeploying `transitionWorkOrder` alone.

<details>
<summary>The finding as originally raised (2026-08-27)</summary>


**Raised:** 2026-08-27, first run of the live Scheduling Functional Gate
(`scripts/schedulingFunctionalGate.mjs`, 29/32 against the deployed sandbox).

**What the gate found:** `transitionWorkOrder` action `Schedule` — the initial placement path —
validates overlap only. `rescheduleWorkOrder` and `reassignScheduledWorkOrder` validate the full
ND-20 table through `checkPlacement`. Live in the sandbox, a dispatcher can **Schedule** a Work Order
to start in the past (gate `E1`) or into a technician's blocked time (gate `H4b`), and be refused for
both if they instead **Reschedule** into the same window. Eligibility falls out of the same gap.

**Why this is recorded rather than fixed in place:** two halves that point different ways.

*Not a product question.* ND-20 already decided the policy, for the domain rather than for one entry
point, and `checkPlacement`'s own comment asserts the symmetry that turns out to be missing — *"a
window this command accepts is one Schedule would have accepted and vice versa"* is true for overlap
and false in the reverse direction for everything else. Completing an existing ruling is not making a
new one, so the direction of the fix is not in doubt.

*But the blast radius is an Owner boundary.* Closing it changes the behavior of `transitionWorkOrder`
— the platform's most sensitive transaction — and needs a Functions deploy. It also **narrows what a
dispatcher can do today**: back-dating a placement and scheduling over PTO both stop working. Neither
is obviously a loss, and ND-20 says both should already be refused, but withdrawing a capability that
currently exists in a running environment is the Owner's call to make knowingly rather than an
implementation detail to absorb.

**Decisions actually needed:**
1. Confirm `Schedule` should enforce the full ND-20 table (past start, blocked time, eligibility) —
   or record the exception and narrow ND-20's table to say it applies to changes only.
2. Authorize the Functions deploy that makes it live.

**Blocked on it:** the Scheduling Functional Gate passing, and therefore — together with ND-23 —
the North Star Dispatch composition. Full evidence:
[`scheduling-functional-gate-findings.md`](./scheduling-functional-gate-findings.md).

</details>

**Composition remains blocked, on ND-23 alone.** The Scheduling authority is certified; the design
source still has not been transferred.

---

## Resolved by the Dispatch & Scheduler build direction (Owner ruling, 2026-08-27)

All six questions raised by the Dispatch & Scheduler reconnaissance were answered in one sitting.
Recorded here in full rather than in the PR that acts on them, per this file's own reason for
existing.

### ND-18 — May a scheduled Work Order return to the Ready queue? — **RESOLVED: yes, from `SCHEDULED` only**

**Answer:** `unscheduleWorkOrder` performs a controlled `SCHEDULED → READY_TO_DISPATCH` transition —
the first reverse edge in ADR-002's table, deliberately admitted and deliberately narrow. It
requires the current state to be exactly `SCHEDULED`, an authorized role, and a reason; it clears the
scheduling projection, preserves the prior technician and window in audit, and returns the job to the
Ready queue.

It **refuses** from `DISPATCHED`, `ACCEPTED`, `EN_ROUTE`, `ARRIVED`, `WORK_IN_PROGRESS` or any later
state. The Owner's reasoning, recorded because it is the load-bearing part: unlike Reschedule, this
genuinely *does* affect lifecycle — returning a scheduled job to the queue changes its operational
readiness — so it belongs in the state machine rather than beside it. Once a technician has been
sent, the job is committed.

**The precedent, named:** ADR-002's table may now run backwards. It does so at exactly one edge,
from exactly one state, and any future reverse edge is its own decision rather than an appeal to this
one.

### ND-19 — Is `Reschedule` a lifecycle transition or a governed field command? — **RESOLVED: a separate trusted callable**

**Answer:** `rescheduleWorkOrder` rewrites `scheduledStart` / `scheduledEnd` / `scheduledTechId`
under an **unchanged** `SCHEDULED` status. It touches neither `TRANSITIONS` nor the client mirror.

This matches how those three fields are already described in `transitionEngine.ts` — mutable
*Planning* values, deliberately excluded from `ACTION_TIMESTAMP_FIELD` because they are a
dispatcher's chosen future window, not the instant an action ran. Re-timing a job changes the plan;
it does not change what has happened to the job.

### ND-20 — Which scheduling conditions refuse, which warn? — **RESOLVED: one warns, three refuse**

**Answer**, on top of the already-shipped same-technician overlap refusal:

| Condition | Outcome |
|---|---|
| Same technician, overlapping window | **REFUSE** (already shipped) |
| Outside the technician's working hours | **WARN** — allowed, surfaced |
| Blocked time (PTO, training, closure…) | **REFUSE** |
| Start time in the past | **REFUSE** |
| Ineligible technician | **REFUSE** |

Working hours are a planning aid, not a gate: field service legitimately schedules emergency work
outside them, and a system that refused would be refusing real business. Blocked time is a
commitment and is enforced as one.

### ND-21 — Does a Work Order carry an estimated duration? — **RESOLVED: yes, `estimatedDurationMinutes`**

**Answer:** an additive, **optional** planning estimate on the Work Order, settable at creation and
editable through governed Work Order behavior.

Bounded explicitly by the ruling, and these bounds are the decision:

- It is **not** an execution timestamp.
- It is **not** actual labor duration.
- It is **not** billing authority.

It exists to propose a schedule placement, suggest an end time, drive Day / Week / 2-Week geometry,
feed technician capacity, and inform scheduling recommendations. Scheduling authority still stores
`scheduledStart` and `scheduledEnd` as the placed fact; actual execution timestamps remain entirely
separate. An estimate that later contradicts what happened is not wrong — it was an estimate.

### ND-22 — One availability authority or two? — **RESOLVED: two collections**

**Answer:** a recurring per-technician working schedule, and a separate dated blocked-time /
exception record. They have different shapes and different lifecycles; folding them together would
make every lunch break carry a recurrence rule it does not need.

### ND-23 — The Dispatch North Star design package is not in the repository — **STANDS OPEN**

Not answered, and correctly so — it is a recorded gap, not a question. Backend authority proceeds
without it. Composition does not.

---

### Two consequences of these answers, recorded so they are not rediscovered

**Authorization follows the existing pattern, not a new one.** `schedule`, `reschedule`,
`unschedule` and `reassign` are all gated role-based through `ACTION_PERMISSIONS` (admin/dispatcher),
exactly like the deployed `Schedule` and `Dispatch`. No new capability family is registered: doing so
would introduce a second authorization pattern before any demonstrated need for finer separation.

**The availability collections deny client reads as well as writes**, matching the
`sales_orders` / `opportunities` posture. The Dispatch board therefore cannot read them directly —
lane shading and capacity must arrive through a trusted read path, the same way the Sales Order read
model works. The Rules blocks are authored in-repo and **not deployed**; `firestore.rules` has no CI
deploy, so merged is not live until `firebase deploy --only firestore:rules` is run by the Owner.

---

## Resolved by the Service Operations P1 build direction (Owner ruling, 2026-08-30)

Nine conflicts between the Service Operations North Star P1 artifact and governed behavioral truth.
The Owner's standing ruling for all nine: **where the design artifact conflicts with governed
behavioral truth, governed behavioral truth wins — do not invent semantics in order to reproduce a
mockup.** Full reconciliation in
[`service-operations-north-star-composition-map.md`](./service-operations-north-star-composition-map.md).

Recorded here so a later session finds them answered rather than reopening them as design questions.
Each is pinned by a test in `test/serviceOperationsNorthStar.test.jsx`.

### SO-N1 — Attention must not borrow risk-severity vocabulary — **RESOLVED: they stay separate**

**Design held:** attention rows carry severity words — Urgent, Stalled, Parts blocked.
**Behavioral held:** `workOrderAttentionProjection` assigns no severity, deliberately. Its header
warns that a shared badge vocabulary across attention and risk creates "same badge, different
meaning" confusion.
**Resolved:** attention keeps its governed two-value taxonomy (ACTION_ITEM / NOTIFICATION → "Action
needed" / "In progress") and its four governed section labels. Risk severity belongs to the At risk
table and is derived only through `detectStalledJobs`. **No shared badge vocabulary across the two.**

### SO-N2 — No new "Urgent" attention section — **RESOLVED: governed sections only**

**Design held:** fold `unfinished && !assignedTechId` into attention as an Urgent section.
**Behavioral held:** the governed sections are Ready to Schedule, Past Due, Scheduling Conflict, Parts
Blocked. Unassigned work needing a dispatcher is already Ready to Schedule.
**Resolved:** no Urgent section and no second derivation — it would double-count one work order under
two names and return business logic to JSX. A real operational condition the projection does not
represent is recorded as a domain gap, never patched in locally.

### SO-N3 / SO-G6 — Activity must not show fabricated event times — **RESOLVED: no clock time**

**Behavioral held:** `timelineBuilder` stamps every milestone with the work order's `createdAt`; there
are no per-transition timestamps. Three milestones would render one identical time.
**Resolved:** render the event and its `describeEvent` description; omit per-entry clock time; keep
the provenance disclosure that this is snapshot-derived and not an audit log. **SO-G6** records the
underlying gap — authoritative per-transition timestamps do not exist — and is not part of a
presentation migration.

### SO-N4 — Attention has no owner — **RESOLVED: omit**

`recipientRole` is a role such as `DISPATCHER`. It is not a person and must never be presented as one.
Routing language may state the audience truthfully; "Owner: Dispatcher" and any fabricated employee
identity may not. No ownership derivation is authorized by this migration.

### SO-N5 — Activity has no actor — **RESOLVED: omit**

The event model contains no actor identity. No technician, dispatcher, employee or "System" may be
inferred. The design's actor label is omitted for P1.

### SO-N6 — No technician-preselected board deep link — **RESOLVED: navigate only**

`TechnicianFilter` receives its selection through props and has no governed URL-param seam. The
Technician load row action navigates to the existing Dispatcher Board and its wording says so —
"Open board →", not a preselection promise. Governed URL-filter semantics are separately scoped.

### SO-N7 — "Technicians on shift" — **RESOLVED: exclude OFF_SHIFT**

`technicians.length` counts off-shift staff under a label saying they are working. The count is
`status !== TECH_STATUS.OFF_SHIFT`. Overload continues to derive through the existing domain function;
no second interpretation of technician status is created.

### SO-N8 — Work Order route — **RESOLVED: the existing governed route**

`/service/work-orders/:id`, via `item.deepLink`. `/work-orders/:id` does not exist and must not be
introduced. Link-integrity coverage is retained because the route is permission-gated.

### SO-N9 — "past readiness" is not a fact — **RESOLVED: do not ship it**

No such repository or domain concept exists under any name. Awaiting dispatch uses the existing
`AWAITING_DISPATCH` snapshot count; its secondary fact is the governed Ready to Schedule attention
count, named exactly that. Not "past readiness", not "late readiness", not any new business concept.

### SO-G5 — Parts readiness — **UNCHANGED, separately scoped**

The projection defines Parts Blocked; ControlTower supplies no `partsReadinessByWorkOrderId`. The read
is **not** added. Where an attention block renders, the boundary is stated: *"Parts readiness isn't
connected to this page yet."*

---

## Open — raised by the Service Operations P1 build (2026-08-30)

### SO-G7 — An unreadable `createdAt` hides a work order from At risk

**Raised:** 2026-08-30, Service Operations North Star P1 implementation.
**Design holds:** R23, lossless composition — an exception record never disappears because it lacks a
field. The artifact draws the "age unknown" row for exactly this case.
**Behavioral holds:** `jobRiskScoring` scores an unusable `createdAt` as 0 for both the age and
stagnation factors. The total falls to `LOW`, and `detectStalledJobs` returns only `HIGH` and
`CRITICAL` — so the work order is dropped from the table entirely.
**The conflict:** the work order the system knows least about is the one it surfaces least. Missing
data makes an exception invisible rather than visible-with-an-unknown, which inverts R23.
**Shipped meanwhile:** nothing was widened. The projection's null-age handling is implemented and
tested, so the rows render correctly the day the scoring changes; the current behaviour is pinned by
`test/serviceOperationsNorthStar.test.jsx` so it stays visible rather than becoming folklore.
**The decision:** should an unscoreable work order be surfaced as an exception in its own right
(severity unknown), or is silence correct because nothing is known about it? Answering it means
changing risk scoring — a domain authority change with its own consequences — **not** something a page
may close.

---

## Open — raised by the Parts P1 composition map (2026-08-30)

Full reconciliation: [`parts-north-star-composition-map.md`](./parts-north-star-composition-map.md).
Design authority: [`docs/north-star/parts/`](../north-star/parts/).

### ND-25 — May a Parts surface show a quantity at all today, and which one? — **CLOSED 2026-08-30: Option (b), truthful absence**

**Raised:** 2026-08-30, reconciling the Parts P1 artifact against the shipped Parts surfaces.
**Design holds:** frame 1a gives the workspace an **On hand** column and frame 1b gives the record
header *"3 on hand across 2 locations"*. The handoff names the source explicitly — `warehouseQty`,
whose provenance is `STATIC_FALLBACK` — and asks that the provenance marker be shown rather than the
value hidden.
**Behavioral holds:** that value comes from `src/data/partsCatalog.ts`, whose own header reads
*"METADATA ONLY — NO STOCK AUTHORITY … generated from a synthetic test dataset … NOT authoritative."*
The Owner ruled on this exact cell on **2026-08-24**, and the ruling is preserved above the cell it
governs in `PartsList.jsx`: *"A figure that is not a live warehouse count, sitting under a heading
that reads as one, is FALSE_COMFORT on the exact column people scan when deciding what to reorder."*
The column therefore answers **"Not known"** where no ledger has spoken.
**The conflict has a second edge.** What the column shows *instead* today is `availableStock`,
derived client-side from `inventory_transactions` by `inventoryAnalyticsEngine` — an **available**-shaped
number, which is precisely the column the design deliberately refuses to draw on the grounds that no
availability authority exists. So design and shipped ruling disagree about both the value and its
name, in opposite directions.
**And the governed answer is switched off.** `getPartBalance` returns on-hand, reserved, available and
on-order from fulfillment's ratified functions. `inventory.balance.read` is registered `active: false`
and granted to no role, and the callable is exported but not deployed — so it is **capability
inactive**, not authority-missing. It is also single-part (`PART_LIST_BALANCE_N1_GAP`), so it could
serve the record long before it could serve the list.
**Shipped meanwhile:** nothing. The Parts North Star migration renders no number under a quantity
heading until this is answered.
**The decision:** three coherent answers. Keep the derived available figure and let the design's
no-Available rule yield to the earlier Owner ruling; show nothing quantitative on either surface until
`getPartBalance` is activated; or show the derived figure under a heading that names its derivation.
A build may not choose between an Owner ruling and an Owner design.

### ND-26 — Which string is "the part number"? — **CLOSED 2026-08-30: internalPartNumber**

**Raised:** 2026-08-30, same reconciliation.
**Design holds:** the part number is the governed identity, the record title and the breadcrumb leaf,
and *"document ids never render."*
**Behavioral holds:** `partId` is the immutable document id — `toPartView` requires `partId === docId`,
and `sku === key === partId` throughout `partsCompatibilityAdapter`. `internalPartNumber` is a
**separate** canonical field that is **mutable under governance**; when it changes, its previous value
is backfilled as a historical alias (`functions/src/partMaster/partMasterCommands.ts:293`). They are
definitively two different things.
**The conflict:** today `PartsList.jsx:797` heads a column *Part Number* and renders `part.sku` into
it, under a comment asserting *"A BUSINESS IDENTIFIER, not a document id."* It is the document id. The
real part number is carried by the adapter one field away and unused. Rendering `internalPartNumber`
instead satisfies the directive — but it makes the record's page title mutable, and makes the URL key
and the displayed identity two different strings.
**Shipped meanwhile:** nothing changed. The defect is recorded in the composition map rather than
fixed under a styling migration.
**The decision:** does the Parts record title, breadcrumb and workspace column read
`internalPartNumber` — accepting a mutable title and a title/URL divergence — or does `partId` stay on
screen with the "Part Number" heading corrected to say what it actually is?

### ND-27 — May the legacy static cost be displayed on the Parts record? — **CLOSED 2026-08-30: refuse display**

**Raised:** 2026-08-30, same reconciliation.
**Design holds:** the rail's Purchasing context opens with **Cost — $2,480.00**, marked *baseline*, on
the principle that provenance should be shown rather than the value hidden.
**Behavioral holds:** `src/metadata/definitions/part.js` declares `unitCost` `displayable: false`,
`reportable: false` **and** `exportable: false` — *"BLOCKED — the canonical Part carries no cost of any
kind"* (`PART_INVENTORY_VALUATION_AUTHORITY_GAP`). The register blocks all three together deliberately,
because *"blocking a column and leaving the CSV open is the same field reaching the same person by a
longer route."* The drawn figure is the legacy static catalogue's, from the same non-authoritative file
as ND-25's.
**Shipped meanwhile:** the row is not rendered.
**The decision:** does the register's refusal stand, so the Purchasing block loses its first row — or
does the Owner rule that a legibly-marked legacy value is acceptable on this one surface, which
re-opens a refusal that was made deliberately and made total?

### ND-28 — Does ND-25 remove the ledger-derived stock forecast, and the reorder request with it? — **CLOSED 2026-08-30: keep both**

**Raised:** 2026-08-30, composing the Parts North Star record under ND-25.
**The ruling says:** quantitative inventory facts may appear only through the governed
`getPartBalance` authority once its capability is intentionally activated, and a client-derived
`availableStock` may not be substituted or renamed to satisfy the design.
**What that collides with:** the **Stock Position** card is built entirely on
`inventoryAnalyticsEngine`'s client-side derivation over `inventory_transactions` — ledger-derived
stock, average daily usage, days remaining, reorder point, recommended quantity — and
`RequestReorderControl` is gated on `health.recommendation`. That control is the entry point to the
**governed reorder-request workflow**, which is live and working. Read literally, ND-25 deletes a
working command surface.
**Shipped meanwhile,** on the reading that the ruling prohibits *substitution into the identity
layer* rather than the forecast's existence: the card stays, renamed **Stock forecast**, its heading
naming its derivation (*"Derived from this part's movements in the work-order and receiving ledger —
not a governed stock position"*), and `Available (ledger-derived)` renamed **Ledger-derived stock** so
no cell carries the word the ruling reserves. It is absent from the record header, which is where
ND-25's prohibition bites. A part with no ledger movements gets a sentence saying no forecast can be
made, explicitly *"not a statement about how many exist"*.
**The decision:** is that reading correct — or does ND-25 mean the forecast card should go, taking
the reorder request's entry point with it until `getPartBalance` is activated and can gate it
instead? A build may not remove a working governed workflow on its own reading of a ruling aimed at a
different surface.

**Owner ruling, 2026-08-30 — the shipped interpretation is correct. KEEP the Stock forecast card and
KEEP `RequestReorderControl`.**

ND-25 prohibits `warehouseQty` as authoritative on-hand, a client-derived quantity *disguised* as
governed stock truth, quantitative inventory in the record header without the governed balance
authority, and a workspace quantity column unsupported by list-scale authority. It does **not**
prohibit clearly identified derived informational facts, an existing governed command surface, or the
live reorder-request workflow.

**The separation that makes this coherent, in the Owner's words:**

> INFORMATION: Stock forecast may compose clearly identified derived information.
> COMMAND: `RequestReorderControl` remains governed by its existing EOS command authority.
> The informational number does not become the authority for the command merely because they share a
> card.

Kept: the Stock forecast card, `RequestReorderControl`, the governed reorder-request workflow, the
"Ledger-derived stock" terminology, and explicit derivation context on every displayed forecast value.
Refused: calling the value On hand; calling it Available where that implies `getPartBalance`
authority; promoting it into the record header or the workspace principal quantity column; making the
reorder command depend on a newly invented stock authority; implying the forecast value authorizes or
validates the reorder.

**ND-28-F — the follow-up this closure creates, and does not discharge.** When `getPartBalance` is
intentionally activated, the Stock forecast composition must be **reconciled against that governed
balance source** as an explicit authority/composition change with its own tests: whether the governed
balance should *replace*, *supplement*, or *remain distinct from* the ledger-derived forecast is an
open question, and semantics must not change silently when the capability flips. Recorded here rather
than left to be rediscovered by whoever performs the activation.

### ND-29 — "Reorder point 0" beside "Insufficient usage history" — **CLOSED 2026-08-30 on arrival: Not established**

**Raised:** 2026-08-30, by this build, from the live Quick Gate render — reported as an observation
rather than changed unilaterally, because no ruling covered it.
**Owner ruling, same day:** a reorder point must not be presented as an operationally meaningful
number when the same state says *"Insufficient usage history"*. A calculated/default zero and a
genuinely governed reorder point of zero **are not the same business fact**. Show
`Reorder point — Not established` (or an equivalent truthful unavailable treatment) unless EOS can
establish that zero is itself the actual governed value. **Do not invent a reorder calculation as
part of the correction.** Classified as a Parts presentation/derivation-semantics follow-up, not an
inventory-authority change.

**The escape clause is closed, by arithmetic.** `calculateReorderPoint` is
`avgDailyUsage * leadTimeDays + avgDailyUsage * safetyFactor`, i.e.
`avgDailyUsage * (leadTimeDays + safetyFactor)`, and `avgDailyUsage = totalConsumed / windowDays`.
So `reorderPoint === 0` **⟺** `totalConsumed === 0` **⟺** `hasUsageHistory === false`. The three are
identical conditions, not correlated ones. And the metadata register agrees from the other side —
`PART_REORDER_POINT_IS_DERIVED`: *"calculated from usage, NOT stored on the Part"*. **There is no
stored reorder point anywhere for a governed zero to come from.**

**Shipped:** `partReorderPointDisplay` in `src/domain/partsNorthStar.js` — a pure chooser between the
existing derived number and a sentence. It computes nothing, adjusts nothing and defaults nothing.
It keys on **the input being absent**, not on the output happening to be zero, so it stays correct if
the derivation ever grows a floor or a default.

**Proof:** `test/partsReorderPointSemantics.test.jsx` (6) proves the arithmetic identity against the
**real** engine across seven consumption patterns, plus the display rule; the record suite proves the
render. Four mutation proofs, all caught.

### ND-30 — Frame 1a has no surface, and the workspace scope ruling is why — **CLOSED 2026-08-30: Option (b), Frame 1a inside `/inventory`**

**Raised:** 2026-08-30, when the Owner opened the deployed sandbox at `/inventory` and said it looks
nothing like the design view. It does not, and it was never going to.

**How this happened, plainly.** The **PartsList scope ruling** of the same day left the pre-North-Star
multi-panel role home alone — a scope *this build asked for* and the Owner agreed to. The consequence
was never stated where it mattered: **frame 1a was therefore not built at all**, and the closeout then
offered `/inventory` as an acceptance surface against frames 1a–1d. That is the error. Not the scope
— the invitation to accept a surface that was deliberately excluded from the thing being accepted.

**Where the product actually stands.** Two Parts collection surfaces exist and neither is 1a:

| Surface | What it is | Distance from 1a |
|---|---|---|
| `/inventory` ("Parts Catalog") | The role home: Work / Parts / Flow groups, reorder queues above a catalogue table | Far. Not a collection page at all. |
| `/inventory/part-master` ("Catalog Admin") | A flat admin table — Part Number, Name, Category, Control Type, Stocking Class, Unit, Status | Closer on **columns**; no serif header block with counts, no view chips, no toolbar with Scan, no Attention column, not a North Star page shell. |

**What frame 1a asks for** that neither provides: the serif *Parts* title block with governed counts,
the view chips, the toolbar (Search / Filter / Sort / Scan), and a single operational table reading
Part · Manufacturer · Category · Control · Status · Attention. Every one of those facts is now
available to the projection after #1593 — **except On hand, which ND-25 forbids.** So 1a is buildable
as a presentation change, minus its quantity column.

**The decision, which this build will not make:**

- **(a) Accept the record family only.** 1b/1c/1d are migrated, gated 20/20 and ready. Frame 1a is
  recorded as deliberately not migrated, and Parts P1 closes without it.
- **(b) Bring the catalogue panel inside `/inventory` up to 1a** — serif header block with counts,
  view chips, toolbar with Scan, the 1a columns minus On hand — while leaving the Work and Flow
  groups in place. Presentation-only, medium size, does not touch the governed reorder queues.
- **(c) Full Lists P2 recomposition of `/inventory`** into a collection page, relocating the reorder
  queues. Largest, and it touches governed queue surfaces.
- **(d) Make `/inventory/part-master` the 1a surface** and leave `/inventory` as the role home. Cheapest
  route to something that looks like the design — but it collides with the nav labels the Owner set on
  2026-08-30, so it is a product decision about which surface is *the* Parts list, not a styling one.

**Shipped meanwhile:** nothing changed. The ledger's acceptance surfaces are corrected to the record
family only, so no one is asked to accept `/inventory` against a frame it was never built to.
