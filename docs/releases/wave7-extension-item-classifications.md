# Wave 7 extension — item classifications and boundaries

Evidence-based classification of the extended Wave 7 backlog. Every "blocked" claim below cites the
code that blocks it, so the classification is auditable rather than asserted. An item is only blocked
when building it would require inventing an authority the repository does not have — never because it
is merely large.

Companions: [`wave7-sandbox-manifest.md`](wave7-sandbox-manifest.md) (deploy ledger) and
[`serialized-asset-registry-slice-b-boundary.md`](serialized-asset-registry-slice-b-boundary.md).

---

## Part 3 — Truck inventory integration: **BLOCKED** on Enterprise Inventory Phase 4

**Not blocked, and already built:** the Truck *Registry* (create / assign driver / reassign / unassign /
change status / change home warehouse / deactivate / reactivate / delete) —
`functions/src/truckRegistry/truckRegistryCommands.ts`, exported from `functions/src/index.ts`. Its own
header is explicit that the business record **is not custody authority**.

**What blocks the inventory integration:** there is no governed writer that can place stock at a MOBILE
(truck) location on the canonical ledger.

- `receiveInventoryStock` accepts **WAREHOUSE destinations only** — `receivingCallables.ts` rejects any
  `receivingLocation.type !== "WAREHOUSE"`. Receiving cannot put stock on a truck.
- **No Transfer Orders module exists.** `TRANSFER_ORDERS_COLLECTION` appears in
  `functions/src/constants/collections.ts` as a name only; no command, callable or repository
  implements it.
- Consequence: **no ledger event can ever carry `location.type === "MOBILE"`**, so
  `field-ops-app-vite/src/domain/serializedAssetInventoryLocation.js`'s MOBILE filter and
  `mobileLocationInventoryProjection.js` would project zero rows even if wired to a live source.
  `truckInventorySource.js` is INERT by design and already reports an honest "not connected" state —
  it is not lying to anyone today.
- `functions/src/truckRegistry/operationalReferenceProbe.ts` records the same fact from the other
  direction: no serialized-asset-on-truck, truck-custody-history, receiving, reconciliation,
  cycle-count, RMA or scrap collection keyed by a MOBILE location or truck exists.

**Deliberately not done:** no second truck registry, no second quantity authority, no parallel movement
ledger, and **no Transfer Orders** — a closed boundary that must not be implemented silently.

**Smallest unblocking decision:** authorize Enterprise Inventory Phase 4 (Transfer Orders). Every
truck-stock capability — warehouse→truck, truck→warehouse return, truck→truck — depends on that single
writer, as does the truck-deletion reference probe.

---

## Part 7 — Cycle Count: **BLOCKED** on adjustment authority plus an Owner decision

Confirmed placeholder: PR #993 only set `navHidden: true` in
`field-ops-app-vite/src/navigation/navConfig.js`; the route still renders the generic
`PlaceholderPage.jsx`. No domain module, collection or engine sits behind it.

**Why no safe first slice exists today:**

1. **No live adjustment/variance write path.** `functions/src/inventoryLedger/operationalMovementTypes.ts`
   does define `ADJUSTED` and `COUNTED` — but that module is **INERT by its own header**: not exported
   from `functions/src/index.ts`, no callable, no client writer, no caller anywhere. The live ledger
   (`functions/src/inventoryService.ts`) writes only `RESERVED` / `RELEASED` / `CONSUMED`. A governed
   count variance has no writer.
2. **No settled "expected quantity" authority to count against.** Two numbers exist and disagree:
   `stock_locations.quantity` (read by Sales Order allocation, ACTIVE warehouses only) and the static
   `warehouseQty` baseline in `data/partsCatalog.ts`, which is documented in-code as **"METADATA ONLY …
   has NO stock authority"**. Which one a physical count reconciles against is a business decision.

Building anyway would mean creating a new adjustment authority **and** picking an expected-quantity
authority by inference — exactly the "do NOT directly overwrite inventory quantities from a manual
count screen" failure the package warns against.

**Scanner-first is preserved:** `domain/scanActions.js` deliberately reduced the scanner to one
governed action (`RECORD_PART_USAGE`); cycle count was removed from that menu on purpose, and nothing
here re-adds it.

**Smallest unblocking decision:** (a) authorize a governed count/adjustment command, activating the
inert `COUNTED`/`ADJUSTED` vocabulary behind a capability; and (b) rule which number is the
authoritative expected on-hand that a count reconciles against.

---

## Part 6 — Purchasing / PO: **LARGELY ALREADY COMPLETE**

| Capability | Status |
| --- | --- |
| View POs across requests (index, filters, honest orphan rows) | **ALREADY COMPLETE** — `modules/purchasing/PurchaseOrders.jsx` |
| View receipts | **ALREADY COMPLETE** — `modules/purchasing/Receipts.jsx` |
| Create a PO from an eligible Reorder Request | **ALREADY COMPLETE** — `domain/reorderPurchaseOrders.js` `recordPurchaseOrder()`, Rules-governed, invoked from PartDetail |
| Void a PO | **ALREADY COMPLETE** (append-only `reorder_purchase_order_voids`), but only from PartDetail — surfacing it on the PO list is **UX MISSING** |
| Receive against a PO | **IMPLEMENTED** and deployed; client transport gated by `RECEIVING_TRANSPORT_READY` |
| Supplier create/update/activate from UI | **UX MISSING + grant required** — commands exist and are exported; `inventory.catalog.activate` is carried only by `inventoryCatalogAdministrator`, granted to nobody yet |
| Part↔supplier procurement terms UI | **BOUNDARY** — `part_supplier_items` is `allow read, write: if false` for **all** clients including admin. Even a read-only UI needs a Rules change (protected) or a new trusted read projection |
| Standalone generic "New Purchase Order" (Epic-5 `purchase_orders` shape) | **GREENFIELD + BOUNDARY** — `procurementService.ts`'s create/update are neither exported nor deployed, and `purchase_orders` is closed to clients by Rules |

**Conclusion:** the minimum governed PO create/manage UX supported by existing authority **already
exists**, via the Reorder-Request-linked path. The remaining gaps require a Rules change or a Role
grant — both protected actions, not repo-safe implementation work.

---

## Part 8 — Back Order: **PARTIAL — truthful only for Sales Orders**

- **Sales Order back-order is real, governed and already computed.** `allocateSalesOrder` writes
  `fulfillmentReadiness` and `fulfillmentReadinessCounts` (including a `BACKORDERED` tally) onto the
  Sales Order document; `functions/src/fulfillment/allocationProjection.ts` defines `ALLOCATION_STATES`
  and derives `BACKORDERED` when an allocatable quantity is zero. Supply comes from `stock_locations`
  via `sumEligibleOnHand`. A Sales-Order-scoped Back Order view is therefore buildable **truthfully**
  from existing authority.
- **Work Order parts demand has NO back-order computation.** `inventoryService.ts` reserves against the
  non-authoritative static `warehouseQty` baseline and never classifies a shortfall as backordered.
- **No expected-arrival date exists anywhere.** `reorder_purchase_orders` carries `orderedQuantity` but
  no ETA field exists in the repository. Any "backordered, arriving on X" statement would be fabricated.

**Conclusion:** a Back Order surface must be scoped to Sales Orders and must not display an ETA.
Extending it to WO parts demand, or showing expected arrival, requires authority that does not exist —
recorded here rather than invented.

---

## Part 1.7 — Marketing seam: **provider-neutral, nothing built**

No native EOS Marketing is built or started. No vendor is hard-coded (verified: no Pardot / Seismic /
HubSpot reference in application code), no vendor-specific CRM field is added, and no campaign
persistence is introduced. With no Marketing provider configured the seam contributes no section rather
than a permanent placeholder, and core CRM does not depend on it.

---

## Part 1.5 — Follow-up / Next Action: **BOUNDARY-BLOCKED** (dependency, not difficulty)

A dated follow-up cannot be built here without prematurely creating the roadmap capability
**Exception Ownership / Operational Accountability**.

**What was checked first, and what exists:** an exhaustive search for any existing task / follow-up /
reminder / next-action authority found **none** — no collection, no trusted command, no capability,
no domain module. The nearest things are `domain/timelineBuilder.js` (a *derived, non-persisted*
Work-Order timeline) and `account.notes` (a single mutable blob). Neither is a follow-up authority,
and repurposing either would create exactly the competing generic task engine the package forbids.

**Why CRM Activity is not the answer.** The Wave 7 CRM Activity authority records *what happened* —
an immutable, attributed interaction. A follow-up is *what must happen next*, and needs an owner, a
due date, and a completion state. Adding those three fields to the activity record would silently
convert an append-only history into the global task authority, which the Owner explicitly ruled out.
The CRM Activity record therefore carries **no assignee, no due date, and no completion state**, and
that omission is deliberate rather than incidental.

**Seam preserved:** the Activity & Notes UX is the natural host for a future "add follow-up" action,
and the Account Attention projection already has a documented slot for a `CRM follow-up` signal that
is currently omitted because no authority backs it. Neither fabricates one in the meantime.

**Smallest unblocking decision:** authorize the Exception Ownership / Operational Accountability
capability — the owner + due date + completion-state model — as its own governed authority. Sales
follow-up then becomes one consumer of it rather than a private CRM task engine.
