# Receiving — North Star P1 Handoff

**Visual source of truth:** `North Star - Receiving P1.dc.html` (frame copy in this folder)
**Behavioral source of truth:** TaylorService-spec/Taylor_Parts (see github.md)
**Brief:** `uploads/receiving_north_star_design_start.md` (Owner design-start document — binding)
**Posture:** presentation/composition only. No backend rebuild. Compose existing authority; never invent it.

## Frames
- **1a Workspace** — Inventory → Receiving. Single page identity; scan-first order entry; one "Awaiting receipt" queue naming each row's journey; the exceptional "A unit the company already owns" section set apart below; Recent receipts slot in honest unavailable state.
- **1b Supplier PO multi-scan session** — scan line, expected-vs-observed reconciliation, blocked-scan attention block, protected Submit with spoken reason.
- **1c Add existing unit** — side sheet, two-stage (Review acquisition → Confirm acquisition), consequence copy, success "Added to company inventory".
- **1d Reorder PO linear journey** — destination → serial capture (serialized only, duplicate shown) → confirm full ordered quantity.
- **1e Truth states** — Not activated / Denied / Locations unreadable / Held-not-received, kept mutually exclusive.
- **1f Handheld 390** — same authority, one column, dock posture.

## Composition map (per brief §17)
| Design element | Existing fact / action | Authority source | Status |
|---|---|---|---|
| Awaiting-receipt queue | fetchReceivablePurchaseOrders + reorder ORDERED candidates (buildPurchaseOrdersView) | existing governed reads; union is client-side composition only | COMPOSE |
| Journey column (Reorder / Supplier) | the two distinct journeys the app already presents as chips | modules/inventory/Receiving.jsx | COMPOSE |
| Receipt progress vs order status | derivedState vs storedStatus (shown as two facts) | purchaseOrderProgressRead | COMPOSE |
| Multi-scan session | receivingScanQueue reconcile/blocked/submittable | domain/receivingScanQueue.js, MultiScanReceiving.jsx | COMPOSE |
| Reorder journey steps | RECEIVE_STEP model, full-quantity v1 contract, serial validation | domain/receiveAgainstPurchaseOrder.js | COMPOSE |
| Receiving location picker | listReceivingLocationOptions (ACTIVE warehouses only) | receivingLocationOptionAdapter + I-LA4 service | COMPOSE |
| Add existing unit (form, reasons, read-back) | acquireSerializedAsset trusted writer; closed 3-reason vocabulary | serializedAssetAcquireForm/Vocabulary, AcquireExistingUnit.jsx | COMPOSE |
| Held-not-received notice | useWarehouseSubmit QUEUED path | offline/useWarehouseSubmit.js | COMPOSE |
| Recent receipts list | **none** — receiving_orders is deny-all with no read callable | — | **AUTHORITY GAP RCV-G1** |
| RO-YYYY-###### labels | receivingOrderNumber declared, numbering lane not built, absent on all documents | metadata/definitions/receivingOrder.js | **AUTHORITY GAP RCV-G2** |

## Gaps / named decisions
- **RCV-G1 — receipt-history read.** No client or callable read of `receiving_orders` exists anywhere in the repo. The workspace preserves the structural slot and renders "Not connected yet". Do not build a list against the raw collection (deny-all is deliberate); this needs a governed read service ruling.
- **RCV-G2 — receiving order numbering.** `receivingOrderNumber` (RO-YYYY-######) is ruled identity but unallocated and absent on every document. Renderers must show an honest placeholder — never the document id — until the numbering lane ships.
- **RCV-D1 — one queue, two journeys.** P1 unions the two candidate reads into one "Awaiting receipt" table with an explicit Journey column, replacing the chip toggle. Each row still routes to its own governed workflow; nothing about either authority changes. If the Owner prefers the two-entry presentation, only frame 1a changes.

## Integration order
1. Workspace shell + queue composition (1a) — reads only.
2. Supplier multi-scan session (1b) — existing MultiScanReceiving behavior re-composed.
3. Reorder journey (1d) — existing RECEIVE_STEP flow re-composed.
4. Add existing unit side sheet (1c) — existing acquire command; add the Review stage (presentation only; same single command).
5. States (1e) + handheld (1f).

## Acceptance checklist (brief §19)
- [ ] Page identity singular; no nested shells or duplicate H1s
- [ ] PO receiving obviously primary; Add existing unit discoverable but clearly exceptional (and ABSENT without capability)
- [ ] Location states truthful and mutually exclusive; no stale default after a failed read
- [ ] Review and Confirm separate; consequence copy before the write; success says "Added to company inventory"
- [ ] No raw IDs promoted as labels; no engineering vocabulary in UI copy
- [ ] Whole-composition side-by-side vs frame 1a–1f, Owner accepted
