# Record a Sales Agreement

A Sales Agreement is where you write down what the customer actually agreed to: what you are
selling them, what each item costs, and the terms. It sits between an Opportunity and a Sales Order.

**You need one before you can mark an Opportunity Won.** Marking an Opportunity Won creates a Sales
Order, and that order takes its prices from the accepted agreement. Without one there is nowhere for
the prices to come from, so the Won button will refuse and tell you so.

---

## Where to find it

There are two places, and they do different jobs.

**The opportunity's record page** — open **Opportunities**, click the deal's row, and find the
**Sales agreement** card. If there is no agreement yet, this is where you create one. This is the
only place you can, because an agreement is created *for* an opportunity and there is nothing to
open until it exists.

**The agreement's own page** — every agreement has its own address, so you can link to it, bookmark
it, and come back to it without going through the opportunity first. Open it from the **Sales
agreement** card, or from a Sales Order's **Priced from the sales agreement** link. This is where
you do the work: pricing the lines, editing the terms while you negotiate, and accepting it. It is
also the read surface — what was agreed, what it is worth, what was accepted and by whom, and where
it went next.

> **Pricing moved here.** Line pricing used to live only in a panel on the Opportunities screen.
> That panel is gone, and pricing now lives on the agreement's own page — the record that actually
> owns the prices. It is the same editor, so nothing about how you price a line has changed.

---

## 1. Create the draft

Fill in one row per thing you are selling:

| Column | What to enter |
|---|---|
| Kind | Equipment model, Part, or Service |
| Item | The model number, part number, or service — for example `C713` |
| Qty | A whole number, at least 1 |
| Price | The unit price, like `4750.00` — or **leave it blank if you do not know it yet** |

Use **Add line** for more rows and **Remove** to take one away.

You can also record the **Customer PO** and whether you are delivering, installing, or both.

Choose **Save draft agreement**.

> **Leaving a price blank is allowed on purpose.** A draft is a negotiation in progress. You just
> cannot *accept* it until every line has a price — see step 3.

---

## 2. Change the draft while you negotiate

While the agreement says **Draft** you can keep changing it.

- **Edit lines** — change what you are selling, the quantities, or the prices.
- **Edit terms** — customer PO, deliver/install, lease, ship via, shipping and special
  instructions, and the charges: shipping, install, tax, down payment and trade-in.

A few things you cannot change, and it is worth knowing why:

- **The customer.** It comes from the opportunity. An agreement that could change customer would be
  a different agreement using the same number.
- **The agreement number.** Assigned once, so it always means the same document.
- **The totals.** They are worked out from your lines and charges. If a total looks wrong, a line or
  a charge is wrong — fix that and the total follows.

Enter every amount in dollars and cents, like `1250.00`.

---

## 3. Accept it

**Accept agreement** is the moment the business is committed. It is deliberately separate from
everything above it, because unlike the edits, it cannot be undone.

Before you can accept, **every line needs a price.** If any is blank the button stays unavailable
and names the lines that are missing one — so you can go straight to them.

A price of `0.00` counts as priced. Giving something away free is a real decision, and the system
treats it as one; leaving the box empty means "not decided yet", which is different.

Once accepted:

- the prices are locked, and the agreement can no longer be edited;
- marking the opportunity **Won** creates a Sales Order carrying exactly these lines and prices;
- the agreement records who accepted it and when.

If terms genuinely change after acceptance, that is a new commercial conversation — talk to your
manager rather than looking for a way to edit it.

---

## 4. After the sale

Once the opportunity is Won, the agreement shows a link: **View the Sales Order this became**. The
order carries your prices, your customer PO, and the delivery location.

---

## The agreement’s own page

Its address looks like `/customers/opportunities/sales-agreement/…`, and the page is titled with the
agreement number — `SA-2026-000003`. An agreement written before numbering existed is titled
**Sales Agreement**; you will never see a database id used as its name.

### What it shows

| Section | What it tells you |
|---|---|
| Heading | The agreement number, its state (Draft, Accepted or Declined), the customer, and what it is worth |
| What we committed to sell | One row per line: the item reference, quantity, unit price and committed amount |
| Sale composition | Subtotal, shipping, installation, tax, and **Total committed** |
| Credits recorded at commitment | Down payment, trade-in, and the balance after them |
| Acceptance | Whether it was accepted, when, and who ran the action |
| What this agreement became | The Sales Order, once one exists |
| Commercial terms (right) | Customer PO, lease, fulfillment, ship via, currency, instructions |

**Amounts you do not know stay unknown.** An unpriced line reads *Not priced* — never `$0.00`,
which would say you are giving it away. While any line is unpriced the page claims no subtotal,
total or balance at all, and says so: *No subtotal, total or balance is claimed while a line is
unpriced.* A partial sum is a real number that is not the price of the agreement, and it is worse
than nothing because it looks credible.

**Items are shown by their reference** — `TAY-C712`, `X49463-3`. The agreement stores the reference
and not a product name, so a name is only ever shown beside the reference when it can genuinely be
looked up. The reference is the identity.

### What you can do from it

- **Edit draft** — opens the commercial terms for editing in place: customer PO, lease,
  fulfillment, ship via, and the two instruction fields. Available only while the agreement is a
  Draft and only if your role includes editing agreements.
- **Record acceptance** — the same governed acceptance described in step 3. Available only when
  every line has a price and your role includes accepting agreements.

> **Line prices are edited in the opportunity workspace, not here.** If acceptance is blocked
> because a line has no price, the page names the line — go back to the opportunity’s **Sales
> Agreement** panel and price it there. Pricing lines from this page is not built yet.

An **Accepted** or **Declined** agreement shows no editing controls at all. They are not greyed
out; they are absent, because the record genuinely cannot be edited any more — that is a fact
about its state, not about your permissions.

### What “Accepted” means here, exactly

Accepted means **the governed accept action was run inside EOS**, and the page shows the three
things EOS records: the state, when it was recorded, and who ran the action.

It does **not** mean EOS holds a signature. The page says so plainly: *No customer-signature
evidence is stored on this Agreement.* If your process needs signed paper or an e-signature, that
lives outside EOS today — the system is not claiming to have it.

If the person who ran the action cannot be looked up, you will see **Unknown user** rather than a
database id.

### A Sales Order is not created by accepting

The page says: *No Sales Order. One is created when the Opportunity is closed as won, which
requires this agreement to be accepted first.*

Read that literally. Accepting is a **precondition**; the order is produced when someone closes the
opportunity as **Won**, and that step can still refuse — for example if the agreement belongs to a
different customer than the opportunity. There is no button on this page that creates an order.

### When the page cannot show you the agreement

| What you see | What it means |
|---|---|
| “No sales agreement matches this address.” | The link or bookmark points at something that is not there. It does **not** mean the opportunity has no agreement — that is a different message, on the opportunity. |
| “You do not have permission to view Sales Agreements.” | Your role does not include reading agreements. |
| “Sales agreements aren’t enabled in this environment yet.” | The feature is not switched on here. Not a permissions problem. |
| “We couldn’t reach this sales agreement just now.” | A connection problem. **Try again** is safe — it only reads. |

---

## What this page does not do

Stated so you do not go looking:

- there is **no list of agreements** — you reach one through its opportunity, a Sales Order, or a link
- there is **no Decline button**. Declined exists as a state in the data model, but nothing in the
  application produces it
- there is **no way to revise, reopen, supersede or replace** an accepted agreement, and no way to
  create a second one for the same opportunity. If agreed terms must change after acceptance, that
  is a conversation to have with your manager, not a screen to look for
- there is **no send-to-customer, present, or e-signature** step
- **line prices are not edited here** — use the opportunity workspace panel

---

## If something does not work

| What you see | What it means |
|---|---|
| "You do not have permission to create Sales Agreements" | Your role does not include this. Ask an administrator. |
| "You do not have permission to accept Sales Agreements" | You can draft terms but not commit to them. |
| "Every line needs a price before this can be accepted" | Exactly that — the missing lines are named. |
| "Amounts must look like 1250.00" | Use dollars and cents, digits only, no `$` or commas. |
| "This opportunity already has a Sales Agreement" | There is one already — edit it rather than starting another. |
| "That did not go through. Try again." | A connection problem. Pressing the button again is safe: it will not create a second agreement. |
