# Parts scanner (Technician Workspace)

**What this lets you do:** Scan or look up a part on a phone and pick an action — use it on a work order, load your truck, cycle count, add it to a purchase-order draft, or **receive a purchase order**.

**Mostly a demo — with one real action.** The scan and lookup are real, and **Receive a purchase order** is the real governed receiving transaction (see [Receive a purchase order](receive-a-purchase-order.md); it's fail-closed until receiving is activated). The other actions (use / load / cycle count / purchase-order draft) run on sample parts held in memory — those quantities, counts, and drafts reset when you reload and are never stored or shared. Treat everything except **Receive a purchase order** as a preview, not a live inventory tool.

**Who can do it:** Technicians (and anyone with the Technician Workspace). You reach it from **Service > Technician Workspace**, not from the Inventory area.

## Steps
1. Under **Scan a part**, either tap **Scan company QR** to use the camera, or type a QR value, barcode, or SKU and tap **Find part**. You can also tap one of the sample SKUs under "Try:".
2. When a part is found, its card shows on-truck and warehouse quantities (sample values).
3. Under **What are you doing?**, pick an action: **Use on work order**, **Load my truck**, **Receive inventory**, **Cycle count**, or **Add to purchase order**.
4. For a work-order action, choose the work order. Set the **Quantity** with the − / + buttons or by typing.
5. Tap **Confirm**. A confirmation message appears and the demo tallies update on screen only.

## Tips and common problems
- **Camera won't open:** camera scanning needs device permission and a supported browser. If it's unavailable, type the SKU or barcode instead.
- **"No part matches":** the scanner only knows the sample parts. Try one of the suggested SKUs.
- **Changes disappeared:** expected — this screen doesn't save anything.

## Related
- [Find a part and check its stock](find-a-part.md) (the real, saved parts workspace)
