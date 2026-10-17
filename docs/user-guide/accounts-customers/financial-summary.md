# Financial figures on a customer's record

**What this lets you do:** See what a customer owes, invoice by invoice — and understand which financial figures are not available yet.

**Who can do it:** Admin and Dispatcher, with finance access.

## What IS available: Accounts receivable

The customer's record has its own **Accounts receivable** section listing every invoice with:

- the **invoice number**,
- its **position** — Overdue (with how many days), Current, Settled or Void,
- the amount **outstanding**.

Anything overdue also appears at the top of the page in the **Attention** box, with a link straight down to this section. The **Standing** line near the top shows the overall **Outstanding AR** and **Past due** count.

Two rules worth knowing:

- **Balances in more than one currency are listed separately**, joined by a dot — never added together. Two currencies don't add up to an amount anybody could collect.
- **A day count only appears on invoices that are actually overdue.** A current invoice shows no "days" figure.

## Where your company runs on EOS (the non-production environment)

There the same section reads the **Finance register** instead of issued invoices, so what you see changes in four ways:

- Each row is a **receivable** — money Finance has recorded as owed for a billing package — not an invoice. The column and the sentences say **Receivable**, and the reference shown is the register's own record id. There is no invoice number.
- An overdue receivable says **Overdue**. It does not show a day count.
- You see the receivables of **the companies you are assigned to in Finance**, and only those. Finance access alone is not enough: a person with finance access and no company assignment sees **Not available to you**. Ask an administrator for the Finance company assignment.
- If the list may be longer than the register can return in one read (200 per company), the section says it could not be read rather than show a partial balance.

The Outstanding AR and Past due figures at the top, and the overdue rows in the Attention box, come from the same Finance register.

## If it says "Not available to you"

The receivables section, and the Outstanding AR and Past due figures, need finance access. Without it the section stays on the page and says **Not available to you**.

That is deliberate. It means *there is an answer and it isn't yours to see* — it does **not** mean the customer owes nothing. If you need these figures, ask an administrator about finance access.

## What is NOT available yet

Credit, forecast and sales-summary figures need a connected financial data source, and none is connected. Where those would go, the page says so in one line:

> Credit, forecast and summary figures need a connected financial data source. Receivables above are live and unaffected.

No dollar amounts are invented to fill the gap, and nothing can be entered there.

Note: the **Service activity** section on the same record shows live work order counts. Those are operational counts, not financial figures. See *See a customer's work orders and activity*.

## Related
- View a customer's record
- See a customer's work orders and activity
