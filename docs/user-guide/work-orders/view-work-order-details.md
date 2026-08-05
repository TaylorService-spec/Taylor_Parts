# View a work order's details

**What this lets you do:** Open one work order and see its full picture — customer, location, priority, complaint, timestamps, planned parts, and history.

**Who can do it:** Admin and dispatcher.

## Before you start

- Sign in with an admin or dispatcher account.
- Have at least one work order to open (from the Work Orders list).

## Steps

1. Open **Service > Work Orders**.
2. Click a work order number in the **WO #** column. The detail page opens.
3. Review the header: the work order number and its current **status** badge (plus a **CANCELLED** badge if it was cancelled).
4. Below that you'll see:
   - **Priority**, **Severity** (if set), and **Type**.
   - **Customer** and **Location** (shown by name).
   - A timestamp row — **Scheduled / Dispatched / Accepted / En Route / Arrived / Work Started / Completed / Closed** — showing only the stages this work order has actually reached.
   - **Complaint**, **Diagnosis**, and **Resolution**, when those have been filled in.
5. If the work order lists parts, an **Inventory** section shows **Planned Parts** and **Used Parts**.
6. Click **← Back to Work Orders** to return to the list.

## Tips and common problems

- **"Work order not found."** The link is stale or the work order was removed. Use the button to go back to the list.
- The **Inventory** section is labeled "Visual only — no inventory engine connected yet." Planned parts are shown for reference; they don't reserve or move stock.
- The lifecycle action buttons on this page (Mark Ready, Schedule, Dispatch, etc.) are covered in *Move a work order through its lifecycle*. They can't complete yet — see that guide.

## Related

- Browse and find work orders
- Move a work order through its lifecycle (dispatcher)
