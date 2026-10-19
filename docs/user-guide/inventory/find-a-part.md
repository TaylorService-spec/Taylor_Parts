# Find a part and check its stock

**What this lets you do:** Look up any part, see how much is available, and check whether it needs reordering.

**Who can do it:** Administrators and Dispatchers. (Technicians don't have the Inventory area; they use the Technician Workspace scanner instead.)

## Before you start
- Sign in and open **Inventory > Parts** from the main navigation.

## Steps
1. On the **Parts** screen, type into the **Search parts...** box at the top, or scroll the **Parts Catalog** table near the bottom of the page. You see each part's name, SKU, category, available quantity, and a risk badge.
2. Use the **All Categories** filter buttons above the catalog table to narrow the list to one category. The list updates immediately.
3. Use **Previous** / **Next** below the table to page through the catalog (25 parts per page).
4. Click a part's name to open its detail page. You see the **Catalog** card (cost, price, warehouse baseline, reorder threshold) and, if the part has activity, a **Stock Position & Reorder Status** card with available quantity, average daily usage, days remaining, reorder point, and a recommended reorder quantity.
5. Scroll down on the detail page to **Recent Transactions** to see the most recent stock movements tied to work orders.

## Tips and common problems
- **"No ledger activity" / "Needs planning" badge:** the part hasn't had enough recorded usage yet, so the app can't forecast it. The catalog quantity shown is a static baseline, marked "(baseline)", not a live count.
- **Available quantity looks off:** available figures come from recorded work-order transactions, not from manual counts. Manual "Inventory Action Log" notes and "Mark Received" do **not** change these numbers (see the related guides).

## Related
- [Request a reorder](request-a-reorder.md)
- [Log an inventory action](log-an-inventory-action.md)

## The governed stock position (where it is switched on)

In an environment where the stock-balance read is switched on (the nonprod environments), a part's detail page and the **Scan > Look up** screen show the part's **On Hand**, **Reserved**, **Available** and **On Order**, and on the part page where the on-hand sits, warehouse by warehouse.

- **On Hand** is the stock in the warehouses (and their bins) you work in, for your company. A truck is not warehouse stock and is never counted here.
- **Reserved** is what open work orders have claimed, for your company. It is not tied to a place, so it is shown once, not per warehouse.
- **Available** is On Hand minus Reserved, never below zero.
- **On Order** is what is still on its way: reorder purchase orders not yet received (in your warehouses) plus the part of each supplier purchase order that has not been received.
- **Unknown** means nothing has been recorded that could answer. It is **never** a zero. A serialized part shows **Counted by unit**: its units are tracked one by one, not as a quantity.
- If you are not allowed to read balances, or the read failed, the page says that in words instead of showing a number.
