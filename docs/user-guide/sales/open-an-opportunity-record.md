# Open an opportunity's record page

**Status: built, not yet live in any environment** · Sales > Opportunities

Every opportunity now has its own page and its own web address. Before this, a deal could only be
looked at inside the pipeline — you had to load the list, find the row, and click it. You could not
send someone a link to a deal, and a link from a Sales Order back to the opportunity it came from
had nowhere to go.

> **Not switched on yet.** This page needs a new server function to be deployed before it will
> load. Until then, opening the address shows *"Couldn't load this opportunity."* with a
> **Try again** button. That message is accurate — nothing is broken and nothing you did caused it.

## Who can see it

Anyone whose role grants **opportunity.read**. If yours doesn't, the page tells you so in a
sentence rather than showing you an empty screen — you'll see *"Opportunities are not available to you."* and a note to ask an administrator. You are never shown a blank page in place of a
permission.

## How to get there

1. Go to **Sales > Opportunities**.
2. Click any opportunity in the pipeline table. Its summary opens in the panel on the right.
3. At the top of that panel, click **Open OPP-2026-000123** (or **Open the full record**, if the
   deal is old enough that it has no reference number).

You can also reach it from a **Sales Order**: on a Sales Order page, the *Lineage* panel names the
opportunity the order came from.

Once you're there, the address bar holds a link you can copy and send to a colleague. It will take
them to the same deal.

## What the page shows you

**The heading** is the opportunity's reference — `OPP-2026-000041` — with the channel above it and,
underneath, the customer need in the larger serif type. If the deal is old enough to predate
reference numbers, the heading says "Opportunity — not numbered" rather than showing an internal id.

**The fact row** carries the state in words ("Decision — awaiting customer decision"), the customer,
the expected value, when it closes and how long it has been open, the owner, and — only when one
exists — the sales agreement.

> **About the value.** It shows as a plain number like `41,000` followed by *(no currency
> recorded)*. That is deliberate. The system stores this as a bare number with no currency attached,
> so putting a "$" on it would be inventing something nobody entered. The sales agreement's total
> *does* have a currency, which is why that one shows as real money.

**The stage row** shows the six governed stages — Identified, Qualifying, Solution, Quoting,
Customer review, Decision — with completed ones ticked and the current one filled. Exactly one stage
is ever clickable: the next legal one. On a phone the row becomes words instead ("Decision · stage 6
of 6").

**The attention strip** appears only when something needs you. It states what is owed, whether the
close date is near or past, and the next action on file — with a link to update it. It is a plain
reading of facts the system already tracks, not a prediction.

**Customer need** and **Solution** are the deal itself: what they want and what you would sell.
Solution lines carry no prices, because pricing on an opportunity is the single estimated value
above. "Quoting" is a stage, not a document — there is no quote object in the system, so there is no
quote list.

**Sales agreement** is the commercial commitment, and it is a *related record* — never a stage of
this lifecycle. See the section below.

**When this closes** states both governed paths in plain language, so nobody has to guess which one
applies.

**Activity** tells you honestly that no history can be shown yet: stage changes and edits are
recorded server-side, but nothing serves them to this page, and notes and calls have no home on an
opportunity.

**The right-hand rail** carries the customer, the commercial details (channel, value, close date,
owner — editable), the qualification slot (not configured yet), and the record's own dates.

## The sales agreement section

An opportunity may have one sales agreement. What you see depends on the real situation, and the
page keeps these apart rather than showing one generic message:

| What you see | What it means |
|---|---|
| The agreement's number, state, line count, total and a **View agreement** link | There is one. Draft agreements say "awaiting acceptance"; if lines still need prices, it names them. |
| "No sales agreement associated" + **Create Sales Agreement** | There isn't one, and you're allowed to create one. |
| "No sales agreement associated" with no button | There isn't one, and your role doesn't include creating them. |
| "Sales agreements aren't enabled in this environment yet" | The feature isn't switched on here. Not a permission problem. |
| "Not available to you" | Your role doesn't include reading agreements. |
| "Couldn't load the agreement — try again" | The read failed. The rest of the page is fine. |

Accepting an agreement, pricing its lines and editing its terms all happen on the agreement itself,
not here.

**An agreement is never required before you can mark a deal Won.** Both routes are real:

- **Mark Won** creates the Sales Order directly, in the same step, from this opportunity's lines.
- **An accepted agreement** creates a priced Sales Order from its own committed lines.

The page states both and never implies you must do one before the other.

## What you can do from here

The buttons at the top right are the governed lifecycle actions:

- **Mark Won → creates the Sales Order** — only at the Decision stage, and only when the lines carry
  quantities. It creates the order in the same transaction and cannot be undone.
- **Mark Lost** — available from any open stage.

To move a deal forward a stage, click the next stage in the row ("Advance to Customer review"). Only
one stage is ever clickable, because only one advance is ever legal.

If your role doesn't grant **opportunity.write**, these are visible but switched off with the reason
shown. A closed deal says "Closed — no further lifecycle actions".

## Editing

Each editable section has its own **Edit** button — customer need, solution, next action, and the
commercial details in the rail. Editing is deliberate: you open one section, change it, and Save or
Cancel. The rest of the page stays as it is.

If somebody else saved while you had a section open, your save is refused with an explanation rather
than quietly overwriting their change. Closed opportunities cannot be edited at all — a won deal's
terms are what its Sales Order was built from.

## What you cannot do here — yet

**Agreement work.** Accepting an agreement, pricing its lines, amendments and terms all live on the
agreement's own surface. **View agreement** takes you there.

**Activity and contacts.** There is no activity timeline yet, and the customer's primary contact is
not shown on this page. Both are known gaps, stated on the page rather than faked.

## When something's wrong

- **"No opportunity exists for this address"** — the link is wrong, or the deal was never created.
  This is different from a failure: the system looked and there's genuinely nothing there.
- **"Couldn't load this opportunity"** — the read failed. Press **Try again**. Your work
  elsewhere is unaffected.
- **"Customer — name unavailable"** — the deal is attached to a customer whose name couldn't be
  looked up. The deal itself is fine.

## Related

- [Edit an opportunity's details](./edit-an-opportunity.md)
- [Mark an opportunity Won](./mark-an-opportunity-won.md)
- [Record a sales agreement](./record-a-sales-agreement.md)
