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
**Asserted by:** `test/accountNorthStarP1.test.jsx` ("the freshness wording is honest and there is NO
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
**Asserted by:** `test/accountNorthStarP1.test.jsx` ("a denied AR read keeps the financial geography
on the page"), plus the standing-strip tests that prove DENIED is worded differently from
UNAVAILABLE and from a real zero.

### A-D3 — Archived account editing — **RESOLVED: Edit stays offered**

**Answer:** the composition is unchanged for an archived account and Edit remains available, because
that is current governed EOS behavior — no rule forbids editing an archived account.
**The line it does NOT cross:** making archived actually lock is a behavioral change (new
enforcement), not a presentation one, and is not in this package.
**Asserted by:** `test/accountNorthStarP1.test.jsx` ("an archived account keeps the same composition
and keeps Edit offered").

### A-D4 — Prospect composition — **RESOLVED: the same page**

**Answer:** prospects use the Account composition, with honest empties where AR and service activity
are absent. No prospect-specific page architecture.
**The line it does NOT cross:** a pipeline-led prospect composition would need the account-scoped
opportunity read active; that is a separate, later question.
**Asserted by:** `test/accountNorthStarP1.test.jsx` ("a prospect uses the same composition and
renders honest empties, not a separate page").

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
