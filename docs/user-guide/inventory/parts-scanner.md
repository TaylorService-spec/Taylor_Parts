# Parts scanner (Technician Workspace)

**What this lets you do:** Scan or look up a part on a phone and pick an action — receive a
purchase order, use it on a work order, load your truck, cycle count, or add it to a purchase
order draft.

**Mostly a demo — with one real, governed exception.** This scanner runs on sample parts held in
memory. Quantities, truck/warehouse counts, cycle counts, and purchase-order drafts reset when
you reload and are never stored or shared — treat those as a preview of the mobile workflow, not
a live inventory tool. **"Receive a purchase order" is different: it's the real receiving
transaction**, currently fail-closed until it's activated — see
[Receive a purchase order](receive-a-purchase-order.md).

**Who can do it:** Technicians (and anyone with the Technician Workspace). You reach it from
**Service > Technician Workspace**, not from the Inventory area.

## Steps
1. Under **Scan a part**, either tap **Scan company QR** to use the camera, or type a QR value, barcode, or SKU and tap **Find part**. You can also tap one of the sample SKUs under "Try:".
2. When a part is found, its card shows on-truck and warehouse quantities (sample values).
3. Under **What are you doing?**, pick an action: **Receive a purchase order**, **Use on work order**, **Load my truck**, **Cycle count**, or **Add to purchase order**.
4. **Receive a purchase order** opens the real receiving workflow — see
   [Receive a purchase order](receive-a-purchase-order.md) for its own steps. For the other,
   demo actions: choose a work order if relevant, set the **Quantity** with the − / + buttons or
   by typing, then tap **Confirm**. A confirmation message appears and the demo tallies update on
   screen only.

## Tips and common problems
- **Camera won't open:** camera scanning needs device permission and a supported browser. If it's unavailable, type the SKU or barcode instead.
- **"No part matches":** the scanner only knows the sample parts. Try one of the suggested SKUs.
- **Changes disappeared (except receiving):** expected — every action here except "Receive a purchase order" is demo-only and doesn't save anything.

## Related
- [Receive a purchase order](receive-a-purchase-order.md) — the one real action in this tool
- [Find a part and check its stock](find-a-part.md) (the real, saved parts workspace)
