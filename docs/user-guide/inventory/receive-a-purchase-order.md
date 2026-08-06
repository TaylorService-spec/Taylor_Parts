# Receive a purchase order

> **Status: real, governed transaction — fail-closed until activated.** Unlike the rest of the
> Parts Scanner (which is a demo preview), "Receive a purchase order" is the real receiving
> transaction. It is not turned on in this environment yet, so right now the last step will tell
> you receiving isn't activated and nothing gets submitted. Nothing about the steps below is a
> preview — this is exactly how it will work once it's switched on.

**What this lets you do:** Receive a specific ordered purchase order into a warehouse location.
This is not a general "add stock" action — it only works against a purchase order that has
already been placed and is waiting to be received.

**Who can do it:** Receiving is limited to Admin, Dispatcher, and Owner. The action is reachable
from any Technician Workspace session, but a Technician who submits it will be told they don't
have permission (once receiving is activated). Today, everyone sees the same "not activated"
result regardless of role, because receiving isn't switched on yet.

## Before you start
- The part must have a purchase order that's been placed and is in the **Ordered** state — see
  [Place the order and track purchasing](place-the-order.md). If nothing has been ordered yet,
  there's nothing to receive.
- Open **Service > Technician Workspace** (Field Mode).

## Steps
1. In the **Parts Scanner** tool, find the part — scan its company QR code, type its SKU/barcode,
   or pick it from the "Try" list. See [Parts Scanner](parts-scanner.md) for how scanning works.
2. Under **What are you doing?**, choose **Receive a purchase order**.
3. **Choose the purchase order.** You'll see the open purchase orders awaiting receipt for this
   part — each row shows the supplier, PO number, and ordered quantity. Select the one you're
   receiving.
4. **Choose a receiving location.** Pick where the stock is going from the **Receiving location**
   list, then select **Continue**.
5. **Confirm.** The confirmation screen shows the part, the purchase order, the quantity to
   receive, and the location. The quantity is always the full amount that was ordered — you
   can't edit it or receive a partial quantity in this version. Select **Confirm receipt**.
6. You'll land on a result screen telling you what happened (see below).

## What the result means
- **Receipt recorded** — success. The purchase order was received into inventory.
- **Already received** — this exact receipt was already recorded; nothing was submitted a second
  time, and no duplicate stock was added. Safe to leave as-is.
- **Not permitted** — you don't hold the receiving permission. This action is limited to Admin,
  Dispatcher, and Owner; ask one of them to receive it.
- **Can't receive right now** — the purchase order isn't in a state that can be received (for
  example, it may already be received or it was voided).
- **Purchase order not found** — the purchase order or a related record couldn't be found. Go
  back and re-select it.
- **Couldn't submit** — the details were rejected. Go back, re-select the purchase order, and try
  again.
- **Sign in required** — your session isn't authenticated. Sign in again and retry.
- **Receiving not available** — receiving isn't activated in this environment yet. Nothing was
  submitted. This is the result you'll see today for every purchase order, until receiving is
  turned on.

## Tips and common problems
- **No purchase orders show up when you choose the action:** either nothing has been ordered for
  that part yet, or everything for it has already been received. Check
  [Place the order and track purchasing](place-the-order.md).
- **You get "Receiving not available" at the location step:** expected right now — receiving
  hasn't been activated in this environment. Nothing you did was lost or submitted; you can back
  out with the **Done** button.
- **Quantity looks wrong:** it isn't editable on purpose — receiving always records the full
  ordered quantity in this version. If the physical count differs, that reconciliation isn't part
  of this workflow yet.

## Related
- [Place the order and track purchasing](place-the-order.md)
- [Mark a reorder request received](mark-reorder-received.md) — the separate closeout note, not
  the same as this receiving transaction
- [Parts Scanner](parts-scanner.md) — the tool this workflow launches from
- [Reorder Requests](../reorder-requests.md) — the full request-to-received journey
