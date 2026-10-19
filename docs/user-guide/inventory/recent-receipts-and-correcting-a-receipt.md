# Recent receipts, and correcting a receipt that was recorded wrong

**Status: live where the EOS service is in use (nonprod); not shown elsewhere** · Inventory > Receiving > Recent Receipts

**What this lets you do:** see what was received, for both kinds of purchase order, and — if you hold the receipt-correction permission — take back a receipt that was recorded wrong.

## Recent Receipts

At the bottom of **Inventory > Receiving**, **Recent Receipts** lists the 25 most recent receipts in the warehouses you work in:

| Column | What it is |
|---|---|
| **Receipt** | The receiving number (RO-…). A receipt made before numbering existed says "No receipt number recorded"; it never shows an internal id. |
| **Journey** | **Reorder PO** (one part, the full quantity) or **Supplier PO** (several lines, partial receipts). |
| **Order** | The purchase order's own number, or "No order number recorded". |
| **Received** / **Into** | When, and the warehouse it went into. |
| **Lines · Units** | How many lines and how many units the receipt added. |
| **Status** | **Recorded**, or **Voided (corrected)** once it was corrected. A voided receipt stays in the list: history is evidence. |

A supplier receipt is shown only to people who work for that purchase order's company. If the list cannot be read, the screen says so; it never shows an empty list for a failed read.

## Correct a receipt

**Who:** people granted **inventory.receipt.correct**. Nobody holds it until an Administrator grants it, so most people will not see the **Correct…** button at all.

Use it only when the receipt was **recorded wrong** (a wrong count, the wrong delivery, the wrong warehouse). It is **not** a vendor return and **not** a stock count.

1. On the receipt's row, choose **Correct…**.
2. For a **Reorder PO** receipt choose what happened: it **did not happen as recorded** (void it), or it **went to the wrong place** (void it and receive it again into another location). A **Supplier PO** receipt can only be voided — to record the right quantity, receive the order again afterwards; it counts only what is still outstanding.
3. Type **why**. It is required, and it is kept with the correction.
4. Choose **Void this receipt** (or **Void and receive again**).

What happens: the receipt is **cancelled, never deleted**; the stock it added is taken back out through a recorded adjustment; its cost consequence is reversed; and if the receipt had completed a supplier order, the order is open for receiving again. Pressing the button twice, or retrying after a lost answer, is the same correction — it is never applied twice.

## When it says no

The screen shows the platform's own reason and **Nothing was changed**. The common ones:

- **Only N of the M received remain at the receipt location.** The stock has since been used, transferred or moved. Correct that first.
- **A serialized receipt cannot be corrected here yet.** Serialized units have no "never arrived" state.
- **Outside your warehouse.** You need to work in the warehouse the receipt went into.
- **Already corrected / already cancelled.** A receipt is corrected once.
