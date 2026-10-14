# Parts Scanner (Technician Workspace)

> **Mostly a demo, with one real exception.** Most of the Technician Workspace / Parts Scanner is
> a preview of how field part scanning will work — those actions change only what's on your
> screen for this session and reset when you leave. **"Receive a purchase order" is the
> exception: it's the real, governed receiving transaction**, currently fail-closed until it's
> activated in this environment. See
> [Receive a purchase order](../inventory/receive-a-purchase-order.md) for that workflow's own
> steps and outcomes.

**What this lets you do:** Scan or look up a part and record a quick inventory action from the
field — receive a purchase order (real), use it on a work order, load your truck, cycle count, or
add it to a purchase order (demo).

**Who can see it:** Technician. Open it from **Service > Technician Workspace**.

## Before you start

- Everything here except "Receive a purchase order" is a walkthrough of the intended flow, not a
  working tool yet — treat any "added successfully" message from those actions as a demo
  confirmation, not a real save.
- Camera scanning needs a device with a camera and your permission. If it isn't available, you can still type a part number.

## Steps

1. Open **Service > Technician Workspace**. You'll see the "Scan. Move. Done." workspace with a fixed demo location ("Truck 14 · Taylor Service").
2. Find a part one of three ways:
   - Select **Scan company QR** to open the camera and center a QR code in the frame.
   - Type a QR value, barcode, or SKU in the box and select **Find part**.
   - Select one of the sample SKU buttons under "Try:".
3. When a part is found, its card shows the name, SKU, barcode, and demo on-truck / warehouse counts.
4. Under **What are you doing?**, choose an action: Receive a purchase order, Use on work order, Load my truck, Cycle count, or Add to purchase order.
5. **Receive a purchase order** takes you into the real receiving workflow — see
   [Receive a purchase order](../inventory/receive-a-purchase-order.md). For the other, demo
   actions: if you chose **Use on work order**, pick a work order from the list; set the quantity
   with the **−** / **+** buttons or by typing; then select **Confirm [action]** — you'll see a
   confirmation and the on-screen demo totals change. Remember: nothing there is saved.

## Tips and common problems

- **"Camera access was not granted"** or **"Camera scanning is not available here"** — type the barcode or SKU instead, or pick a sample SKU.
- **"QR code read, but no part matches"** — the scan worked but that code isn't a known demo part.
- **"Not enough stock on your truck" / "in the warehouse"** — these checks use demo numbers only, and don't apply to receiving.
- The work-order list here comes from the older job records, not your dispatched work orders.

## Related

- [Receive a purchase order](../inventory/receive-a-purchase-order.md) — the one real action in this tool
- [See my assigned work orders](./see-my-work-orders.md)
- [Record parts used and work notes](./record-parts-and-notes.md) — the real way to log parts used on your assigned work orders.
