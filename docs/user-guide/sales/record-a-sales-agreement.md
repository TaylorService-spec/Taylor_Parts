# Record a Sales Agreement

A Sales Agreement is where you write down what the customer actually agreed to: what you are
selling them, what each item costs, and the terms. It sits between an Opportunity and a Sales Order.

**You need one before you can mark an Opportunity Won.** Marking an Opportunity Won creates a Sales
Order, and that order takes its prices from the accepted agreement. Without one there is nowhere for
the prices to come from, so the Won button will refuse and tell you so.

---

## Where to find it

Open **Opportunities**, select the opportunity you are working on, and look at the detail panel on
the right. **Sales Agreement** sits directly under **Lifecycle**.

If there is no agreement yet, you will see a short form to create one. If there is, you will see it.

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

## If something does not work

| What you see | What it means |
|---|---|
| "You do not have permission to create Sales Agreements" | Your role does not include this. Ask an administrator. |
| "You do not have permission to accept Sales Agreements" | You can draft terms but not commit to them. |
| "Every line needs a price before this can be accepted" | Exactly that — the missing lines are named. |
| "Amounts must look like 1250.00" | Use dollars and cents, digits only, no `$` or commas. |
| "This opportunity already has a Sales Agreement" | There is one already — edit it rather than starting another. |
| "That did not go through. Try again." | A connection problem. Pressing the button again is safe: it will not create a second agreement. |
