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
