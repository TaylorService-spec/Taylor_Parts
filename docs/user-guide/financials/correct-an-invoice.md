# Correct an issued invoice: credits, write-offs, adjustments, refunds and voids

**Status: the rules and the commands are built; the screen is still to come. Live on the nonprod EOS build only once the release carrying them is deployed and the approval permissions are granted; production only when the Owner says so.**

**What this covers:** Changing what a customer owes after an invoice has been issued. An issued invoice is never edited. Every change is its **own record**, linked to the invoice, and the invoice keeps its original number, lines and total. What is still owed is always read from the invoice's receivable.

**Where you do it:** **Financials > Credits & Adjustments** will carry the request and approve screens. Until it does, **New Correction** stays switched off there; the same steps are available to Finance as the two commands "request an invoice correction" and "decide an invoice correction", and the register is the "invoice corrections" list.

## The rule: two different people, always
- **One person asks. A different person decides.** Every credit, write-off, debit adjustment, refund and void needs a second, separate **Employee** to approve it. There is no minimum amount: even one cent waits for approval.
- **You cannot approve your own request**, even if your role could approve other people's. This is checked by Employee, not just by login. If your Employee record is moved to a new login, the new login is still you and still cannot approve what you asked for.
- **Both people must be Employees** in the system, and both must be assigned to the **operating company** of the invoice. Another company's invoice looks exactly like one that does not exist.
- The approver states the **amount** they are approving, and a **reason**. Approving 100 is not approving 150.

## What each correction does once approved
| Request | Effect on what is owed | The invoice |
|---|---|---|
| **Credit memo** | Lowers the receivable by the amount. Never more than is outstanding. | Unchanged |
| **Write-off** | Lowers the receivable by the amount. Never more than is outstanding. | Unchanged |
| **Debit adjustment** | Raises the receivable by the amount (for example a late fee). | Unchanged |
| **Refund** | Takes the refunded amount back out of a payment that was applied to this invoice, so the receivable owes it again, and **records** that the refund is owed. | Unchanged |
| **Void** | Cancels the invoice and its receivable together. Only if **no money has moved**. | Marked void; its number is kept and never used again |

A receivable credited down to nothing shows as **Settled**.

## A refund is a record, not a payment
Approving a refund records the refund and lets Finance reconcile it. The result says "refund recorded; no payment has been sent". **A refund record is an accounting fact, not evidence that cash was sent.** No money is sent, no payment is started, and nothing is queued for an accounting provider; there is no payout provider or bank instruction in the system. The payment the customer originally made is shown as partly refunded, and the refund appears as a **Customer Refund (Record)** on the Payments page. Paying the customer is a separate step outside this system.

## What is not finished
- **Accounting integration is not complete.** An invoice that is sent to the accounting provider is still sent for the **original** amount it was issued for; a credit, write-off or debit never blocks that. Sending the **correction itself** (a credit note, write-off or debit) to the accounting provider is **not built yet**. It is an explicit, tracked, unfinished requirement, so corrections are not yet visible to the accounting provider.
- A voided invoice can be billed again: the sale is prepared again, which produces a new billing package and a **new invoice number**. The voided invoice keeps its own number.

## When a void is allowed
A void is allowed only **before any payment or adjustment has been applied** to the invoice, and it needs a reason and two people. If **any** payment has been applied (even one that was later reversed), or any credit, write-off or adjustment has been approved, the invoice cannot be voided: use a credit memo instead. An invoice already sent on to an accounting provider cannot be voided here either.

## Asking for a correction
1. Open the invoice's receivable and choose the kind of correction.
2. Enter the **amount** (a void takes none: it is the whole invoice), and the **reason**. A refund also names the payment application it returns.
3. The request is saved as **Pending**. Nothing has changed yet. You can **withdraw** it yourself while it is pending.

## Deciding a correction
1. Open a pending request from the register.
2. Check the invoice, the amount and the reason.
3. **Approve** (confirm the amount and give your reason) or **Reject** (give your reason). Only someone other than the requester can do either.
4. An approval re-checks everything at that moment. If the situation has changed (for example, another credit already used up the balance), it is refused and the request stays pending so it can be rejected.

## Things that can go wrong
| What you see | What it means |
|---|---|
| "a correction is decided by a different Employee than the one who requested it" | You asked for this one. Ask a colleague who can approve it. |
| "this account is linked to no access-eligible Employee" | Approvers and requesters must be Employees. Ask an Administrator to link you. |
| "the amount exceeds the outstanding" | You cannot credit or write off more than is owed. |
| "approving one amount is not approving another" | The amount you typed is not the amount requested. |
| "money has been applied to this invoice" / "an adjustment has been applied" | Too late to void. Raise a credit memo. |
| "the refund exceeds the amount applied" | A refund returns only what was applied to this invoice. |
| "no invoice correction with that id" / "no issued invoice with that id" | Not one you can reach: another company's record looks exactly like a missing one. |

If you press the button twice, or the connection drops and you try again, you get the same result back, not a second correction. A refused attempt leaves nothing behind.

## Who can do it
- **Ask:** the people who can already record adjustments or refunds (Owner, General Manager, Controller, Accounting Manager, Finance Manager).
- **Approve:** only people the Owner gives the new approval permissions to (**approve invoice adjustments**, **approve refund records**, **approve invoice voids**). **Nobody has them yet.** The Owner has not decided who approves corrections, so until an Administrator grants a permission on the Owner's explicit instruction, no correction can be approved. The Owner can never approve a correction the Owner asked for. The Parts Manager role stays without any Finance execution.
- Neither is enough without being assigned to the invoice's operating company.
