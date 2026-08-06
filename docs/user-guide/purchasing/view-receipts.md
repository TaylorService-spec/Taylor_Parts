# View receipts

**Status: live**

**What this lets you do:** See the purchase orders that have been received — a focused list of what's already come in. This screen is read-only: you look things up here, you don't receive, create, or change anything on it.

**Who can do it:** Admin and Dispatcher roles.

## Before you start
- Nothing to set up. A purchase order only shows up here once it's actually been received — if none have been received yet, the list will be empty.

## Steps
1. **Open Purchasing > Receipts.** In the top navigation, go to the **Purchasing** area, then the **Receipts** tab.
2. **Read the summary line.** Near the top, a line like "3 received purchase orders" tells you how many rows are in the list.
3. **Read the table.** Each row is one received purchase order:
   - **Part** — click it to open that part's record.
   - **Supplier** — who the order was placed with.
   - **PO #** — the supplier's PO or reference number.
   - **Qty** — quantity ordered.
   - **Ordered** — the date the order was placed.

## What this screen is (and isn't)
- This is the *received* side of the same list you see on [View purchase orders](view-purchase-orders.md) — it's that list filtered down to purchase orders whose status is Received, shown as its own focused view.
- **Actually receiving stock is done elsewhere.** The real receiving action happens in the **Inventory > Receiving** workspace. This screen links to it, but nothing you do here starts or affects a receipt.
- **Governed stock receipts aren't shown here.** The detailed stock-receipt records created when Receiving processes an order live in the backend and aren't readable by this screen — the page tells you so directly, rather than pretending to show them. What you see here is which purchase orders have been closed out as received, not the underlying stock ledger.

## Tips and common problems
- **List is empty ("No receipts yet"):** no purchase order has been received yet. Check [View purchase orders](view-purchase-orders.md) filtered to Open to see what's still waiting.
- **"Receipts unavailable" message:** the screen couldn't load the data — usually a permissions or connection issue. Try again, and if it persists, report it.
- **Loading:** the screen briefly shows "Loading receipts…" while it fetches data.

## Related
- [View purchase orders](view-purchase-orders.md)
- [Receive a purchase order](../inventory/receive-a-purchase-order.md)
- [Mark a reorder request received](../inventory/mark-reorder-received.md)
