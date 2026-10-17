# Log an inventory action (receive, adjust, or correct)

**What this lets you do:** Record an audit note against a part — that stock was received, adjusted, or a mistake corrected.

**Important — this is a note only. It does not change stock counts.** These entries are kept as an audit record. Applying them to your real on-hand numbers is a separate step that is **not yet available**. The screen labels every option "(log only)" to make this clear.

**Who can do it:** Administrators and Dispatchers.

## Before you start
- Open the part's detail page from **Inventory > Parts**.

## Steps
1. Scroll to the **Inventory Action Log** card.
2. Choose an **Action type**: **Stock Received (log only)**, **Stock Adjustment (log only)**, or **Correction Note (log only)**.
3. Enter a **Quantity for this note**. (This is recorded on the note; it is not applied to stock.)
4. Enter a **Reason** and **Notes**. For a Correction Note both are required; for the other types they're optional.
5. Click **Log Action**. The entry appears in **Recent Logged Actions** below, showing who logged it and when.

## Tips and common problems
- **Stock didn't change:** expected — this is an audit log only.
- **Correction Note won't submit:** a Correction Note requires both a reason and notes.

## Where a part's history is now
- **Part detail > Activity** lists the part's stock movements from the inventory ledger, newest first. That is the record of what actually moved.
- **Warehouse Manager home > View Activity** (next to a part) opens the same movements for that part, limited to the warehouses you work in: the movement, the quantity, the work order if there is one, and when. If the list cannot be loaded it says so; it never shows an empty list in place of a failure.
- The old **Inventory Action History** notes on Part detail and Warehouse Manager home are shown only in environments that still run on the old data store. In the current environment they are not shown, and they were never a record of stock movement.

## Related
- [Find a part and check its stock](find-a-part.md)
- [Mark a reorder request received](mark-reorder-received.md)
