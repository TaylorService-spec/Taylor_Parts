# View manufacturers (read-only)

**What this lets you do:** See the list of manufacturers that Parts link to, with each one's status.

**Who can do it:** It depends on your EOS environment.

- **In some EOS environments, nobody can open this page.** Every account, including administrators, sees **"Manufacturers isn't available to your role"**. Access to the page has not been connected yet, and that decision is pending. If you see this message, there is nothing you can change on your side.
- **In other environments,** the page is open to Admin and Dispatcher, and only if your access includes reading the parts catalog. If it does not, the page says so (see below).

The rest of this guide describes what the page shows when it does open.

**Before you start**
- The Manufacturers page has no entry in the left navigation. Reach it at **Inventory > Manufacturers** (web address `/inventory/manufacturers`), for example from a bookmark or a link.

## Steps

1. Open the page. The title is **Manufacturers**, with a count such as "12 manufacturers" once the list has loaded.
2. Read the table. It has two columns, **Name** and **Status**.
3. To reorder the list, click the **Name** or **Status** column heading. Click again to reverse the order.

## What you can and cannot do here

- **You can:** look at every manufacturer and sort by name or status.
- **You cannot:** add a manufacturer, rename one, or change its status. There are no buttons for these, because the page is read-only. The page says: "Governed manufacturer reference records that Parts link to. This page is read-only."
- **You cannot** open a manufacturer. Rows do not click through to a detail page, and there is no "load more" (the whole list is shown at once).
- Adding and editing manufacturers is **not yet available**. It is planned to return later; ask an administrator if you need a manufacturer changed.

## Tips / common problems

- **"Manufacturers isn't available to your role"** (instead of the page). In your environment the page is not open to anyone yet. See "Who can do it" above.
- **"No manufacturers are recorded yet."** The list loaded and is empty.
- **"You do not have access to Manufacturers. Contact an administrator if you believe this is an error."** Your account cannot read the parts catalog.
- **"Manufacturers are currently unavailable. Try again later."** The list could not be loaded. Click **Try again**, or come back later.
- **"N malformed records excluded."** Some records were unreadable and are left out of the list and the count. They need to be reviewed by an administrator.

## Related
- [Manage part identifiers](./manage-part-identifiers.md) (manufacturer part numbers are tied to a manufacturer)
- [Find a part](./find-a-part.md)
