# View purchase orders

**Status: live**

**What this lets you do:** Browse every purchase order that's been placed against a reorder — see who ordered what, from which supplier, when it was ordered, when it's expected, and whether it's still open, received, or voided. This screen is read-only: you look things up here, you don't create or change anything on it.

**Who can do it:** Admin and Dispatcher roles.

## Before you start
- Nothing to set up. A purchase order only shows up here once a Parts Associate has [placed an order for a reorder request](../inventory/place-the-order.md) — if none exist yet, the list will be empty.

## Steps
1. **Open Purchasing > Purchase Orders.** In the top navigation, go to the **Purchasing** area — **Purchase Orders** is the first tab, so it's what you land on.
2. **Read the table.** Each row is one purchase order:
   - **Part** — click it to open that part's record.
   - **Supplier** — who the order was placed with.
   - **PO #** — the supplier's PO or reference number.
   - **Qty** — quantity ordered.
   - **Ordered** — the date the order was placed.
   - **Expected** — the expected arrival date, if one was given.
   - **Ordered by** — who recorded the order.
   - **Status** — Open, Received, Voided, or Needs attention (see below).
3. **Filter by status.** Use the **Open / Received / Voided / All** filter bar at the top of the list; each option shows a count. Open is selected by default, since that's what most people are checking on.
4. **Check receiving details on an Open order (optional).** On an Open row, expand **Receipt source** to see the Reorder Request ID and Purchase Order ID. This is the reference an authorized operator uses to receive the order into stock — you don't need it for anything yourself; it just confirms the order is ready and waiting to be received.

## What the statuses mean
- **Open** — the order has been placed and hasn't been received yet. It's waiting to be received into stock.
- **Received** — the order has been closed out; nothing more happens to it here.
- **Voided** — the order was cancelled after being placed.
- **Needs attention** — the reorder request says it was ordered, but its purchase order details couldn't be loaded. This shouldn't normally happen — report it if you see it.

## Tips and common problems
- **Receiving stock isn't done here.** This screen only shows purchase orders; actually receiving stock into inventory is a separate action performed by an authorized operator elsewhere. Nothing you do on this screen changes stock counts.
- **You can't create or edit a purchase order from this screen.** A purchase order is created when a Parts Associate places the order during the reorder flow — see [Place the order and track purchasing](../inventory/place-the-order.md).
- **"Purchase Orders unavailable" message:** this means the screen couldn't load the data — usually a permissions or connection issue. Try again, and if it persists, report it.
- **List is empty:** no purchase orders exist yet, or none match your current filter — try switching to **All**.

## Related
- [Place the order and track purchasing](../inventory/place-the-order.md)
- [Mark a reorder request received](../inventory/mark-reorder-received.md)
- [Cancel or void a reorder request](../inventory/cancel-or-void-a-reorder.md)
