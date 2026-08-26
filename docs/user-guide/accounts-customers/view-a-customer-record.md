# View a customer's record

**What this lets you do:** See everything about one customer on a single page — who they are, what needs your attention, what they owe, what work is open, and who to call.

**Who can do it:** Admin and Dispatcher.

**Before you start:** Open the **Customers** list and click a customer's name.

## What you see

The page answers questions in the order you usually ask them.

1. **The customer's name**, in large type, with a line above it saying what kind of account this is (for example *Customer · Taylor*). Underneath: the status as a sentence ("Active — trading normally"), the account owner, the billing address, the customer number, and the payment terms.
2. **Standing** — one line with the three numbers there is a real answer for: **Open work orders**, **Outstanding AR**, and **Past due**.
3. **Attention** — a boxed area listing overdue invoices and past-due work orders, each with a link to go and deal with it. **If nothing needs attention, this box isn't there at all.** An empty page here is good news.
4. **Commercial activity** — opportunities and sales orders for this customer.
5. **Accounts receivable** — every invoice, its position (Overdue, Current, Settled) and what's outstanding.
6. **Service activity** — work orders with their status, schedule and technician.
7. **On the right-hand side:** **Contacts** first, then **Locations**, then **Commercial profile** (terms, tax status, invoicing, currency), then **Notes & identifiers**, which stays collapsed until you click it.

At the very top left is the trail back to **Customers**. At the top right it tells you when the page last checked for data, with a **Refresh** link.

## On a phone

The page rearranges rather than shrinking. You get, in order: the name, anything needing attention, the three standing numbers as tiles, the **primary contact with a Call button**, and then activity. Everything else — the commercial profile, the receivables table and the notes — sits behind a **More** heading you can tap open.

Tapping **Call** hands the primary contact's stored phone number to your phone. Your phone then shows the number and asks whether to dial it — the app never places a call itself.

## Steps

1. From **Customers**, click a customer's name to open the record.
2. Read down the page, or on a phone tap **More** for the reference sections.
3. Click **Edit customer** to change any stored detail, or **&larr; Back to Customers** to return to the list.

## Tips and common problems

- **"Not available to you"** means there is an answer but your role can't see it — usually the financial figures, which need finance access. It does **not** mean zero.
- **"Couldn't be read"** means something went wrong fetching that number. Try **Refresh**.
- **A blank Attention area is normal.** The page only shows that box when something genuinely needs a person.
- **Outstanding AR in more than one currency** is listed one currency at a time, separated by a dot. The amounts are never added together, because two currencies don't add up to anything you could collect.
- **Tax status always shows something.** If nobody has set it, it says **Unknown** — it never quietly assumes Taxable.
- **If several contacts are marked primary**, the page says so and refuses to pick one. Open **Edit** on the contacts and leave just one marked primary. Until then, no **Call** button appears.
- **If the primary contact has no phone number on file**, there's no **Call** button — the app won't dial a different person's number instead.
- **Opportunity rows don't open.** There is no opportunity page yet, and the page says so rather than giving you a link that goes nowhere. Sales order rows do open.
- **Equipment isn't listed here.** There's no per-customer equipment list yet, so rather than show a partial one, the page links you to the Equipment workspace.
- If the page says "This customer could not be found.", the record may have been removed or the link is stale — use **Back to Customers**. That's different from "Customer unavailable", which means the record couldn't be read and offers a **Retry**.

## Related
- Edit a customer
- Add a contact to a customer
- Add a location to a customer
- See a customer's work orders and activity
