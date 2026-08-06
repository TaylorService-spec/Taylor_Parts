# View warehouses

**What this lets you do:** See the company's warehouses, whether each one is Active or Inactive, and whether it's eligible to receive inventory. This is a read-only view — you don't create, edit, activate, or deactivate warehouses here.

**Who can do it:** Admin and Dispatcher.

## Before you start

- Nothing to set up. Warehouses are set up separately, not from this screen, so this page just shows you what already exists.

## Steps

1. **Open the workspace.** Go to **Inventory > Warehouses**. You'll see a summary line, a set of filters, and a table of warehouses.
2. **Read the summary.** Near the top, a line tells you the total number of warehouses, how many are eligible to receive, and (if any) how many are inactive — for example, "4 warehouses · 3 eligible to receive · 1 inactive."
3. **Filter the list.** Use the filter bar to narrow the table:
   - **All** (default) — every warehouse.
   - **Active** — only Active warehouses.
   - **Inactive** — only Inactive warehouses.
   Each filter shows a count so you know how many warehouses are in that group before you click it.
4. **Read a row.** Each row shows:
   - **Warehouse** — the warehouse's name.
   - **Status** — Active or Inactive.
   - **Receiving** — Eligible or Not eligible. A warehouse is eligible to receive when it's Active (not marked inactive); an Inactive warehouse is not eligible. This is exactly the same rule Receiving uses to decide which warehouses you can pick as a destination — see [Receive a purchase order](receive-a-purchase-order.md).
5. **Look for bin-level detail.** This screen doesn't show bin-level stock or reconciliation for a warehouse — for that, see the Operations overview, linked at the bottom of the page.

## Tips and common problems

- **"No warehouses"** means there are no warehouse records at all — nothing to do here.
- **"No matching warehouses"** means the list has warehouses, just none in the filter you picked. Try **All**.
- **"Warehouses unavailable"**: the page couldn't load, usually a permissions or connection issue. Try again, and let an administrator know if it persists.
- **Can't find a create/edit/activate button:** that's expected — this workspace only shows warehouses; it doesn't create, edit, activate, or deactivate them.
- **A warehouse shows "Not eligible" but you expected it to receive stock:** check its Status column — only Active warehouses are eligible to receive. If it should be Active, ask an administrator, since status isn't changeable from this screen.

## Related

- [Receive a purchase order](receive-a-purchase-order.md)
- [View inventory transfers](view-transfers.md)
- [Find a part and check its stock](find-a-part.md)
