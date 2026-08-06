# View inventory transfers

**What this lets you do:** See inventory transfers between locations — what part is moving, where it's coming from and going to, and its current status. This is a read-only view; you don't create or change transfers here.

**Who can do it:** Admin and Dispatcher.

## Before you start

- Nothing to set up. Transfers are created by Field Ops' backend processes, not from this screen, so this page just shows you what already exists.

## Steps

1. **Open the workspace.** Go to **Inventory > Transfers**. You'll see a table of transfers, a summary line, and a set of filters.
2. **Check what's in flight.** Near the top, a line tells you how many transfers are "in flight" (Requested or In transit right now), and breaks out how many are In transit specifically.
3. **Filter the list.** Use the filter bar to narrow the table:
   - **Active** (default) — Requested and In transit together.
   - **In transit** — only transfers currently moving.
   - **Completed** — transfers that have finished.
   - **Cancelled** — transfers that were called off.
   - **All** — every transfer, regardless of status.
   Each filter shows a count so you know how many transfers are in that group before you click it.
4. **Read a row.** Each row shows:
   - **Part** — click it to open that part's record.
   - **From → To** — the origin and destination. Warehouse locations show the warehouse's name. Other kinds of locations (for example a technician's truck) show their raw location ID with a small type tag, like "mobile."
   - **Status** — Requested, In transit, Completed, or Cancelled.

## Tips and common problems

- **"No transfers yet"** means there are no transfer records at all — nothing to do here.
- **"No matching transfers"** means the list has transfers, just none in the filter you picked. Try **All**.
- **A warning about records that couldn't be displayed:** if you see a line noting that some transfer records couldn't be shown due to a data issue, that's a data problem, not something you can fix from this screen — report it if it keeps happening.
- **"Transfers unavailable":** the page couldn't load, usually a permissions or connection issue. Try again, and let an administrator know if it persists.
- **Can't find a Request or Create button:** that's expected — this workspace only shows transfers; it doesn't create or edit them.

## Related

- [Find a part and check its stock](find-a-part.md)
- [View purchase orders](../purchasing/view-purchase-orders.md)
