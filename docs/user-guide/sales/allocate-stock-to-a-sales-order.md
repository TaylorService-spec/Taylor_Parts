# Allocate stock to a Sales Order

**Status: built, not yet switched on** (owner, admin, general manager, warehouse manager, service manager, parts manager and dispatcher, once the company's stock reservation is activated) · Sales > Sales Orders > open an order > **Allocation**

Allocating sets aside stock for one line of a Sales Order, at a warehouse **you choose**. While it is
set aside, nobody else can allocate it to another order, so the same bin of parts is never promised
twice. Allocating does **not** move or remove the parts, and it does not change the order's price or
terms.

## Who can do this

The people who can allocate are the **Owner, Administrator, General Manager, Warehouse Manager,
Service Manager and Parts Manager**, plus the **Dispatcher**. Having the role is only the first of
three things, and **a warehouse scope is still required**: holding the permission does not let you
allocate from a warehouse that is not yours. You need, checked in this order:

1. The **Sales Order fulfillment** permission (`salesOrder.fulfill`), which the roles above hold.
2. Authority over the order's **company** (Taylor or Ventana). You never pick the company: it is the
   order's own, and the page sends it along with the warehouse you chose. A warehouse of a different
   company is refused.
3. The **warehouse** has to be one of yours (your warehouse scope). The warehouse list only offers
   the warehouses you can use.

If you can open the order but don't hold the permission, the **Allocation** section still shows what
is allocated, with a note that allocating needs the permission. You'll see no buttons.

## Steps

1. Open the Sales Order. The **Allocation** section appears when the order has a **part** line
   (service lines aren't stock, so they don't appear).
2. Under **Warehouse**, choose where the stock should come from.
3. On the line, type a **Quantity** and click **Allocate**.

The line's **Allocated** figure goes up, and the **At** column shows how much of it sits at the
warehouse you chose. If part of a line is held at a warehouse outside your scope, you see the number
("2 at warehouses outside your scope") but not where.

## What the system will not let you do

The page shows the system's own words when it refuses. Common ones:

- **More than the line ordered.** A line can hold at most what was ordered, counting every warehouse.
  ("The line orders 6 and already holds 2; at most 4 more can be allocated.")
- **More than the warehouse has.** You can't allocate stock that isn't there, or that is already set
  aside for another order. If the system has no stock record for the part at that warehouse, it says
  it doesn't know rather than guessing.
- **A closed, cancelled or fulfilled order.** Only an order that is **Confirmed** or **In
  fulfillment** takes new allocations.
- **A part that isn't active**, or a part tracked by serial number (serialized equipment). Those
  can't be allocated by quantity.
- **A second allocation of the same line at the same warehouse.** Release it and allocate again with
  the new quantity.
- **A company that hasn't been switched on for stock reservation.** The operator switches this on
  per company.

If the request fails for any other reason (network, a server problem) you see a general "could not be
completed, try again" line. Trying again is safe: the page reuses the same request, so a retry can't
reserve the stock twice.

## The progress tracker follows the Allocation section

The **Inventory Allocated** step in **Fulfillment & Installation** uses the same figures the
Allocation section shows ("2 of 6 allocated"). If the Allocation section can't be read (for example
you aren't allowed to see it), the tracker says **Not read yet** instead of guessing.

## Release stock

To give stock back, type the quantity (or leave it **blank to release everything the line holds at
that warehouse**), enter a **Reason**, and click **Release**. The reason is required and is recorded.
You can only release at a warehouse you have scope over, and never more than the line holds there.

## It releases itself when the order ends

If the order is **cancelled**, **marked fulfilled** or **closed**, everything it still holds is
released in the same step. You don't have to remember to give the stock back.

## What this does not do yet

- It does not deliver or remove the parts, and it does not send a Work Order to a warehouse. Which
  warehouse a dispatched job takes its parts from is a separate decision.
- It does not create the service Work Order for the order.
- Serialized equipment (a specific unit with a serial number) isn't allocated here.

Every allocation and release is recorded with who did it, when, and why.
