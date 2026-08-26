# Open an opportunity's record page

**Status: built, not yet live in any environment** · Sales > Opportunities

Every opportunity now has its own page and its own web address. Before this, a deal could only be
looked at inside the pipeline — you had to load the list, find the row, and click it. You could not
send someone a link to a deal, and a link from a Sales Order back to the opportunity it came from
had nowhere to go.

> **Not switched on yet.** This page needs a new server function to be deployed before it will
> load. Until then, opening the address shows *"This Opportunity is currently unavailable"* with a
> **Try again** button. That message is accurate — nothing is broken and nothing you did caused it.

## Who can see it

Anyone whose role grants **opportunity.read**. If yours doesn't, the page tells you so in a
sentence rather than showing you an empty screen — you'll see *"You are not authorized to view
Opportunities"* and a note to ask an administrator. You are never shown a blank page in place of a
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

**The heading** is the opportunity's reference — `OPP-2026-000123`. Underneath it, in words rather
than codes: where the deal stands and what it's waiting on ("Quoting — next stage Customer review"),
the customer, the owner, the channel, the expected close date, and the expected value.

**The lifecycle band** is the row of stages beneath the heading: Identified, Qualifying, Solution,
Quoting, Customer review, Decision. Completed stages carry a tick, the current one is filled. A
won or lost deal shows its outcome as a badge on the end rather than as another stage — because it
didn't pass *through* Won, it *ended* there.

**Click any stage** to see the one line of recorded fact behind it. Most stages will tell you that
no time is recorded, and that's the truth rather than a gap in the page: the system stores when an
opportunity was created, when it closed, and when it was last changed. It doesn't record the moment
a deal moved into Quoting, so the page won't pretend to know.

**The attention band** appears only when something needs you, and it lists everything at once
rather than one thing at a time. It will tell you if:

- the deal has no solution lines, or a line with no quantity — either of which will **stop you
  marking it Won**, so it's better to know now than at the moment you try;
- the expected close date has passed;
- there's no next action recorded.

If none of that applies, the band isn't there at all. Its absence is the "all clear".

**Solution** lists what's being sold — models, parts, services, and quantities. A line missing its
quantity says *not recorded* rather than showing a dash or a zero, because that missing number is
what blocks the deal from being won.

**Need** and **Next action** are the free-text notes, shown as prose.

**On the right: Lineage** — the customer, the sales order this deal became (if it's been won), and
the sales agreement. Anything the system can't name is shown as *reference unavailable* rather than
as an internal document number. **Milestones** — when it was created, when it closed, when it was
last changed.

## What you can do from here

The buttons at the top right are the same governed actions the pipeline offers:

- **Advance to <next stage>** — moves the deal one stage forward. Only one advance is ever offered,
  because only one is ever legal.
- **Mark Lost** — available from any open stage.
- **Mark Won** — available only from **Decision**, and only once the deal has solution lines with
  quantities. Marking a deal Won creates its Sales Order in the same step and cannot be undone.

If your role doesn't grant **opportunity.write**, these buttons are visible but switched off, and
hovering one tells you why. A closed deal shows *"Closed — no further lifecycle actions"* instead.

## What you cannot do here — yet

**Editing.** This page reads the deal; it doesn't edit it. To change the channel, value, close
date, need, solution lines, or next action, go back to **Sales > Opportunities** and use the
Edit buttons in the panel there. See [Edit an opportunity's details](./edit-an-opportunity.md).

Whether editing eventually moves onto this page is an open product question, deliberately not
decided by building it one way.

## When something's wrong

- **"No Opportunity exists for this address"** — the link is wrong, or the deal was never created.
  This is different from a failure: the system looked and there's genuinely nothing there.
- **"This Opportunity is currently unavailable"** — the read failed. Press **Try again**. Your work
  elsewhere is unaffected.
- **"Customer — name unavailable"** — the deal is attached to a customer whose name couldn't be
  looked up. The deal itself is fine.

## Related

- [Edit an opportunity's details](./edit-an-opportunity.md)
- [Mark an opportunity Won](./mark-an-opportunity-won.md)
- [Record a sales agreement](./record-a-sales-agreement.md)
