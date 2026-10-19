# View inventory transfers

**What this lets you do:** See inventory transfers between locations — what part is moving, where it's coming from and going to, and its current status — and, if you hold the matching permission, create, dispatch, receive or cancel one.

**Who can do it:** anyone who can open Inventory > Transfers can review. Each button appears only if you hold its permission: **New Transfer** (create), **Dispatch**, **Receive** and **Cancel**. If you hold none of them the page says so and shows the list only.

## Before you start

- Nothing to set up. You see only transfers of the companies you have access to.

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
   - **Part** — the part's name; click it to open that part's record.
   - **From → To** — the origin and destination, each by name: the warehouse's name, or a truck's name with a small type tag. If a name cannot be read, the location's ID is shown instead.
   - **Status** — Requested, In transit, Completed, or Cancelled.

## Tips and common problems

- **"No transfers yet"** means there are no transfer records at all — nothing to do here.
- **"No matching transfers"** means the list has transfers, just none in the filter you picked. Try **All**.
- **A warning about records that couldn't be displayed:** if you see a line noting that some transfer records couldn't be shown due to a data issue, that's a data problem, not something you can fix from this screen — report it if it keeps happening.
- **"Transfers unavailable":** the page couldn't load, usually a permissions or connection issue. Try again, and let an administrator know if it persists.
- **Can't find New Transfer, Dispatch, Receive or Cancel:** you don't hold that permission. Ask an administrator.
- **New Transfer — where to:** the origin is a warehouse you work in. The destination can be any active warehouse of your companies, including ones you don't work in (for example Main → Service). A destination in a company you don't have access to is not offered.

## Related

- [Find a part and check its stock](find-a-part.md)
- [View purchase orders](../purchasing/view-purchase-orders.md)
