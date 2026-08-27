# Find an opportunity

**Status: built, not yet live in any environment** · Sales > Opportunities

**Sales > Opportunities** is a list. Its whole job is helping you find one deal and open it. It
does not show you a deal's details — clicking a row takes you to that opportunity's own page, which
has room to show everything properly.

> **What changed.** This screen used to be split: a list on the left and a cramped summary of the
> selected deal on the right. That summary was a smaller copy of a page that already exists, so it
> is gone. You now get the full list, and then the full record. Any old link containing
> `?opportunity=` still works — it just lands you on the list.

## Who can see it

Anyone whose role grants **opportunity.read**. If yours doesn't, the screen says
*"Opportunities are not available to you"* and shows no counts at all — you are told about your
permission rather than shown an empty list that would suggest your company has no deals.

## The views along the top

The row of tabs is not a filter — each one is a different question about your pipeline, and each
carries its own count so you can see the answer before you click.

| View | What it holds |
| --- | --- |
| **Open** | Every deal still being worked. This is where you start. |
| **My opportunities** | The open deals assigned to you. |
| **Needs attention** | Open deals that are overdue, awaiting a decision, or have no next action recorded. |
| **At decision** | Open deals sitting at the final stage, waiting on the customer. |
| **Won** / **Lost** | Closed deals. They are read-only history. |
| **All** | Everything, open and closed. |

The view you pick is kept in the address bar, so a link you send a colleague opens on the same view
you were looking at.

> **If "My opportunities" says it can't tell.** You'll see *"We can't tell which opportunities are
> yours — your sign-in isn't linked to an employee record."* and the tab shows no number. That is
> not the same as having no deals, which is why it doesn't just show you an empty list. Ask an
> administrator to link your sign-in to your employee record.

## Searching and filtering

The **search box** matches the reference, the customer need, the customer name and the owner. The
**Filter** button opens a list of the six stages as checkboxes.

Both of these narrow **what is already on screen** — they don't go and fetch more. The line above
the table tells you exactly what happened: *"Showing 1 of 12 opportunities in open — narrowed by a
search"*. If you narrow it down to nothing, you get *"No opportunities match this view"* and a
**Clear filters** button, so you're never left wondering whether the pipeline is empty or your
search is too specific.

Searching for an internal id will not find anything. That's on purpose — the reference
(`OPP-2026-000041`) is the number to quote, and it is searchable.

## Reading a row

| Column | What it tells you |
| --- | --- |
| **Opportunity** | The reference, with the customer need underneath. |
| **Customer** | The customer name and the channel. |
| **Stage** | The stage in words, and how far along it is ("4 of 6"). |
| **Attention** | Why this deal needs looking at — or a dash if it doesn't. |
| **Est. value** | A plain number. |
| **Expected close** | The date, with the days remaining when it's close. Overdue dates stand out. |
| **Agreement / Order** | Whether a sales agreement exists, and whether a sales order has been created. |
| **Owner** | Who is responsible. |

> **Why the value has no "$".** The system stores the estimated value as a bare number with no
> currency recorded against it, so showing a currency symbol would be inventing something nobody
> entered. When nothing has been estimated at all, the cell says *"Not estimated"* rather than
> showing `0` — a deal nobody has sized yet is not a worthless deal.

> **Why the Agreement column doesn't name the agreement.** The list knows *whether* an agreement
> exists, but not its reference number. Rather than show you an internal id, or slow the whole
> screen down by looking each one up, it tells you the truthful thing: **Agreement** or **No
> agreement**. Open the opportunity to see which agreement, and to follow it through.

**Where a name is missing**, you'll see what is actually missing — *"Customer — name unavailable"*,
*"Unassigned"* (nobody owns this deal), or *"Unresolved"* (somebody owns it but we couldn't look up
their name). Those last two mean different things: the first needs someone assigned, the second is a
data problem and not yours to fix.

## Opening a deal

Click anywhere on the row. To open it in a new tab, ⌘-click (Ctrl-click on Windows) or middle-click
the reference — it's a normal link and behaves like one, so you don't lose your place in the list.

That takes you to [the opportunity's record page](./open-an-opportunity-record.md), and from there
you can follow the chain: **Opportunity → Sales Agreement → Sales Order.**

## Creating one

**New Opportunity** sits at the top right. If your role can't create opportunities the button is
still there, greyed out, with the reason written beside it — you're told what you'd need rather than
shown nothing at all.

After it's created you land straight on the new opportunity's page, which is where the next thing
you'll want to do lives.

## When something isn't right

The screen tells you which of these happened, in words, and never shows you an empty table in place
of a problem:

- **Loading** — the list is on its way.
- **No opportunities yet** — the pipeline is genuinely empty.
- **No open opportunities** — there are deals, but they're all closed. Switch to Won or Lost.
- **No opportunities match this view** — your search or filters are hiding them. **Clear filters.**
- **Opportunities are not available to you** — a permission, not an error.
- **Couldn't load opportunities** — something went wrong reading. Nothing was changed.
