# Parts Scanner (Technician Workspace)

> **Demo only — this screen does not save.** The Technician Workspace / Parts Scanner is a preview of how field part scanning will work. Everything you do here changes only what's on your screen for this session. Nothing is recorded to inventory, work orders, or purchase orders, and it all resets when you leave. Do not rely on it for real stock counts.

**What this lets you do (once real):** Scan or look up a part and record a quick inventory action from the field — use it on a work order, load your truck, receive stock, cycle count, or add it to a purchase order.

**Who can see it:** Technician. Open it from **Service > Technician Workspace**.

## Before you start

- This is a walkthrough of the intended flow, not a working tool yet. Treat any "added successfully" message as a demo confirmation, not a real save.
- Camera scanning needs a device with a camera and your permission. If it isn't available, you can still type a part number.

## Steps

1. Open **Service > Technician Workspace**. You'll see the "Scan. Move. Done." workspace with a fixed demo location ("Truck 14 · Taylor Service").
2. Find a part one of three ways:
   - Select **Scan company QR** to open the camera and center a QR code in the frame.
   - Type a QR value, barcode, or SKU in the box and select **Find part**.
   - Select one of the sample SKU buttons under "Try:".
3. When a part is found, its card shows the name, SKU, barcode, and demo on-truck / warehouse counts.
4. Under **What are you doing?**, choose an action: Use on work order, Load my truck, Receive inventory, Cycle count, or Add to purchase order.
5. If you chose **Use on work order**, pick a work order from the list.
6. Set the quantity with the **−** / **+** buttons or by typing.
7. Select **Confirm [action]**. You'll see a confirmation and the on-screen demo totals change. Remember: nothing is saved.

## Tips and common problems

- **"Camera access was not granted"** or **"Camera scanning is not available here"** — type the barcode or SKU instead, or pick a sample SKU.
- **"QR code read, but no part matches"** — the scan worked but that code isn't a known demo part.
- **"Not enough stock on your truck" / "in the warehouse"** — these checks use demo numbers only.
- The work-order list here comes from the older job records, not your dispatched work orders.

## Related

- [See my assigned work orders](./see-my-work-orders.md)
- [Record parts used and work notes](./record-parts-and-notes.md) — the real way to log parts used on your assigned work orders.
