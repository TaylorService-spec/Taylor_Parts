# Request a reorder for a part

**What this lets you do:** Flag a part that's running low so it enters the reorder review queue.

**Who can do it:** Administrators and Dispatchers can open the screen. For parts the app can forecast, anyone with Inventory access can submit with one click. For parts marked **Needs planning** (no usage history), only an Administrator, Parts Manager, or Warehouse Manager can enter a quantity and submit.

## Before you start
- Open **Inventory > Parts**.

## Steps
1. In the **Inventory Operational Queue** near the top of the Parts screen, choose the **Critical & High** or **Needs Planning** tab.
2. Find the part in the queue table. In the **Action** column:
   - If the part shows a **Request Reorder** button, click it. The app uses its recommended quantity. The button changes to **Requesting...** and then the row shows **Requested**.
   - If the part is **Needs planning**, type a whole-number quantity into the **Qty** box, then click **Request Reorder**. If you don't have permission, you'll instead see "Requires Parts Manager or Warehouse Manager".
3. Alternatively, open the part's detail page and use the **Request Reorder** control on the **Stock Position & Reorder Status** card. It works the same way.

After submitting, the request enters review. You can track it in the queues further down the Parts screen and in **History**.

## Tips and common problems
- **Button already says "Requested":** a request for that part is already pending — you can't create a duplicate.
- **Error message under the queue:** the submission failed (for example, a permissions issue). The exact reason is shown; nothing was created.

## Related
- [Review a reorder request](review-a-reorder-request.md)
- [Find a part and check its stock](find-a-part.md)
