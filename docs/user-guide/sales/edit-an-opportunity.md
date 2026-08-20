# Edit an opportunity's details

**Status: live** (admin, dispatcher, owner) · Sales > Opportunities

Deals change. The customer wants two units instead of one, the close date slips, the estimated
value firms up. This is how you correct an opportunity's details without starting over.

## Who can do this

Anyone whose role grants **opportunity.write** — today that's Administrator, Dispatcher, and
Owner. If you don't have it, the **Edit** buttons are still visible but greyed out, and hovering
one tells you why. Nothing is hidden from you; you're told what you'd need.

## Before you start

You can only edit an **open** opportunity. Once it's marked Won or Lost it becomes a historical
record and the Edit buttons turn off, with the reason shown. That's deliberate: a won deal's terms
are what its Sales Order was built from, and quietly changing them afterwards would leave the two
disagreeing with no record of which is right.

## Steps

1. Go to **Sales > Opportunities**.
2. Click the opportunity in the pipeline table. Its details open in the panel on the right.
3. Find the section you want to change and click its **Edit** button. Sections are:
   - **Commercial details** — channel, estimated value, expected close date, owner
   - **Customer need** — the free-text description of what they're trying to solve
   - **Solution** — the lines: models, parts, and services, with quantities
   - **Next action** — what you're doing next on this deal
4. Change what you need to. Only the section you opened becomes editable — the rest stays
   readable, so you keep your context.
5. Click **Save**.

That's it. The panel returns to the read view and the pipeline refreshes with your change.

## Changing the owner

The **Owner** field in Commercial details is a picker of employees. If your role can't browse the
employee directory, you'll see the owner's employee id in a plain text box instead, with a note
explaining why — you can still change and save it, you just won't get names to choose from.

An owner who's no longer in the directory still shows up in the list, marked *(not in directory)*,
so you're never forced to reassign a deal just to save an unrelated edit.

## Editing solution lines

Solution lines reference a **product, model, or part** — never one specific serialized unit. Which
actual machine goes to the customer is decided at fulfillment, not while you're still selling.

Use **Add line** to add one, the Remove button to drop one, and edit kind, reference, and quantity
in place. Saving replaces the whole list at once.

## What you might see

| Message | What it means | What to do |
|---|---|---|
| "Someone else saved this Opportunity while you were editing." | A colleague saved changes after you opened the form. | Your typed changes are still on screen. Reload to see theirs, then reapply yours. |
| "No changes to save." | You pressed Save without changing anything. | Nothing went wrong. Change something or press Cancel. |
| "This Opportunity is closed…" | It was marked Won or Lost, possibly by someone else, while you had it open. | Reload. Closed opportunities can't be edited. |
| "An Opportunity must have an owner." | You cleared the Owner field. | Put an owner back. |
| "One of the solution lines is incomplete." | A line is missing its kind or reference. | Fill in the blank line or remove it. |
| "You are not authorized to write Opportunities." | Your role doesn't grant opportunity.write. | Ask an administrator. |

**Cancel** always discards your edits and returns to the read view without saving anything.

## Related

- [Mark an opportunity Won](mark-an-opportunity-won.md)
