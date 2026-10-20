# Issue an invoice

**Status: live on the nonprod EOS build once the release carrying it is deployed; production only when the Owner says so**

**What this lets you do:** Turn a receivable that is ready to bill into an **invoice** with its own number (for example `INV-2026-000001`) and issue date. You do this from **Financials > Receivables**.

**Who can do it:** People whose role can issue invoices (Owner, General Manager, Controller, Accounting Manager, Finance Manager and Administrators), **and** who are assigned to the operating company the sale belongs to. Everyone else sees the Receivables list with no Issue button. Issuing is one step: **it does not need a second person to approve it.**

## What you are issuing
- **One invoice for one receivable.** A receivable is created when a Sales Order is billed in full and its billing package is ready. The invoice is the document for that receivable. It never holds a balance of its own: what is still owed is always the receivable's.
- **The invoice is the package, as it was frozen.** Its lines, discount, shipping, install charge, tax and trade-in credit are exactly what the billing package says. Nothing is priced again, and nothing is typed in.
- **Tax must be known.** If the sale's tax has not been determined, the invoice is refused. An unknown tax is never treated as zero. Fix the tax on the agreement first.
- **Cash is not on the invoice.** Payments are still recorded and applied as **settlements**. Applying one reduces the receivable's outstanding amount and leaves the invoice as it was issued.

## Issue one
1. Open **Financials > Receivables**.
2. Find the Sales Order receivable. Its **Invoice** column says **Not invoiced**. Use the **Company** filter if you work for more than one company.
3. Choose **Issue invoice** in the **Action** column of its row. The button appears only on receivables that have no invoice yet, for companies you may issue for.
4. The **due date follows the customer's payment terms** for that company. Leave the date alone and choose **Issue invoice now**.
5. The page says "Invoice INV-… issued." and the row's **Invoice** column now shows the number and issue date. They also show on the receivable's record.

## When you need a different due date
- You may pick a **later** date than the customer's terms, and you must say **why** in "Reason for that date". An earlier date is refused.
- If the customer has **no payment terms set for that company**, you choose the date and give the reason.
- A later date can be at most 365 days beyond the customer's terms (or beyond today, where there are none).
- The reason is kept with the invoice and in the audit record.
- Once issued, an invoice cannot be changed, and its sale can no longer be re-billed: a mistake is corrected with a credit memo (coming later), not by editing the invoice.

## Things that can go wrong
| What you see | What it means |
|---|---|
| "the billing package's tax is not determined…" | The sale's tax is unknown. Nothing was issued and no number was used. |
| "the billing package is HELD / SUPERSEDED…" | The package is not ready, or a newer version replaced it. |
| "this receivable already has invoice INV-…" | It was issued already (perhaps by someone else a moment ago). |
| "no billing package with that id" | It is not one you can reach: another company's sale looks exactly like one that does not exist. |
| "a due date other than the terms needs a reason" | Add the reason, or clear the date. |

If you press the button twice, or the connection drops and you try again, you get the same invoice back, not a second one. A refused attempt never uses a number, so numbers have no gaps from refusals.

## What this does not do yet
Credits, write-offs, refunds, voiding an issued invoice, and invoicing part of an order are not part of this. Those need a second person's approval and arrive later. Invoices from before EOS are not copied in, and the EOS numbering starts at 000001 for each company and year.
