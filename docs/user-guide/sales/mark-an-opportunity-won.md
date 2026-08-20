# Mark an opportunity Won (and get its Sales Order)

**Status: live** (admin, dispatcher, owner) · Sales > Opportunities

Winning a deal does two things at once: it closes the opportunity, and it creates the Sales Order
that the rest of the business works from. You do it in one click, and you can't end up with only
half of it.

## Who can do this

You need both **opportunity.write** and **opportunity.createSalesOrder**. If you're missing either,
the **Mark Won** button is greyed out and tells you so.

## Before you start

**Mark Won** only appears once the opportunity reaches the **Decision** stage. Before that, the
lifecycle row offers the one legal next step ("Advance to Quoting", and so on) — you walk the deal
forward one stage at a time.

Every solution line needs a quantity before a deal can be won. If one doesn't have one, the win is
refused and you're told why.

## Steps

1. Go to **Sales > Opportunities** and click the opportunity.
2. In the **Lifecycle** section of the detail panel, check the stage row reads **Decision**.
3. Click **Mark Won**.

You'll see a confirmation naming the Sales Order that was just created, with a link straight to it:

> Won. Sales Order **SO-2026-0042** was created.

Click the number to open the order.

## Why it's one action, not two

Closing the deal and creating the order happen in a single transaction. Either both succeed or
neither does. There is no way to finish with an opportunity that's Won but has no order behind it,
and no way to accidentally create a second order for a deal you already won — if an order already
exists, you're shown that one rather than given a duplicate:

> This Opportunity was already won. Its Sales Order is **SO-2026-0007**.

Nothing happens automatically. A person clicks the button, and the system checks that person is
allowed to, every time.

## After the win

The opportunity is now **closed**. Its stage row reads "Closed — no further lifecycle actions",
its detail sections can no longer be edited, and it drops out of the open pipeline list — the
pipeline shows work in progress, and a won deal isn't in progress any more.

Its Sales Order is where the work continues. The detail panel keeps a permanent **Sales Order**
link so you can always get from the deal to what it became.

## Marking a deal Lost

**Mark Lost** is available from any open stage — you don't have to walk a dead deal to Decision
first. It closes the opportunity and creates nothing, because a lost deal has nothing to fulfill.

## What you might see

| Message | What it means | What to do |
|---|---|---|
| "That action isn't allowed for this Opportunity's current state." | It's already closed, or it isn't at Decision yet, or a line has no quantity. | Reload to see the current state. |
| "You are not authorized…" | You're missing one of the two capabilities. | Ask an administrator. |
| "Already recorded (no change)." | The click was already applied — usually a double-click or a retry. | Nothing to do. It worked once, and only once. |

## Related

- [Edit an opportunity's details](edit-an-opportunity.md)
