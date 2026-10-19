# Raise, approve and send a supplier purchase order

**Status: live on the nonprod EOS build; production only when the Owner says so**

**What this lets you do:** Put several purchasing requests you are working on into **one** purchase order to **one** supplier, get it approved by someone else, mark it as sent, and then receive it in Inventory. Receiving a line of the order completes the request behind it.

**Who can do it:**
- **Raise a draft and mark it sent:** Parts Associate and Purchasing Manager.
- **Approve:** Parts Manager, Owner and General Manager. You can never approve an order you raised yourself, even if your role allows approving.
- **Cancel:** Parts Manager, General Manager and Owner.
- **See the list:** everyone who can raise, approve, send or cancel, and everyone who could already see purchase orders.
- Administrators can do all of it.

If you cannot do a step, you will not see its button at all.

## Before you start
- The requests you want to order must be **assigned to you** and **in progress** (you have started purchasing on them). See [Place the order and track purchasing](../inventory/place-the-order.md).
- Every request on one order is for the **same receiving warehouse**, and the order is for **one supplier**. Requests for another warehouse or supplier go on a separate order.
- You must work in that warehouse (it is one of the warehouses you are assigned to).

## Raise an order
1. Open **Purchasing > Purchase Orders** and choose **Supplier purchase orders** at the top.
2. Choose **Raise supplier purchase order**.
3. Pick the **Supplier**.
4. Tick the requests to put on the order. The first request you tick fixes the warehouse; requests for other warehouses are greyed out.
5. For each request, check the **Quantity** (it starts at the quantity requested). Enter a **Unit price** in dollars and cents, such as `12.50`, with its currency, or leave it blank:
   - If you are allowed to see the part's supplier terms, a blank price uses the terms' price (shown in grey as a hint).
   - Otherwise a blank price is saved as **Price not stated**. It is never saved as zero.
6. Choose **Raise order**. The order is created as a **Draft** with its own number (for example `SPO-2026-000001`), and the requests move to **Ordered**.

## Approve and send
1. Open the order from the list.
2. Someone other than the person who raised it chooses **Approve**. The order becomes **Approved**.
3. Choose **Mark as sent** once the order has gone to the supplier. The order becomes **Sent**.

## Receive it
Approved and sent orders appear in **Inventory > Receiving** (see [Receive a multi-line purchase order](../inventory/receive-a-multi-line-purchase-order.md)). You can receive part of a line now and the rest later. When a line has been received in full, the request behind it is closed automatically. When every line is received, the order is **Received**. If a receipt is later voided so a line is no longer complete, its request goes back to **Ordered**.

## Cancel
Choose **Cancel order**, say why, and confirm. You can cancel until something has been received. The requests go back to **in progress** so they can be put on another order. If goods were already received, correct the receipt first.

## Tips and common problems
- **"This request is already on a purchase order"**: it is on another supplier order, or a purchase order was already recorded for it. A request is on one order only.
- **"Only the Employee a Reorder Request is assigned to may put it on a purchase order"**: the request is assigned to someone else.
- **"The purchase order changed since it was read"**: someone else changed the order while you had it open. Open it again and retry.
- **Nothing to order**: you have no requests that are assigned to you, in progress, and in your warehouses.
- **A request that was recorded the older way** (the *Recorded orders* view) is not on a supplier order and does not appear here.

## Related
- [View purchase orders](view-purchase-orders.md)
- [Place the order and track purchasing](../inventory/place-the-order.md)
- [Receive a multi-line purchase order](../inventory/receive-a-multi-line-purchase-order.md)
- [Recent receipts and correcting a receipt](../inventory/recent-receipts-and-correcting-a-receipt.md)
