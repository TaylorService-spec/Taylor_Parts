# View and manage manufacturers

**What this lets you do:** See the manufacturers that Parts link to, add a new one, correct a name, and make one Active or Inactive.

**Who can do it:**
- **Opening the page:** anyone whose access includes reading the parts catalog (the same access that opens **Inventory > Parts**).
- **Seeing the list:** you also need manufacturer read access. Without it the page opens but says **"You do not have access to Manufacturers."**
- **Adding a manufacturer or correcting a name:** you also need catalog management access.
- **Making a manufacturer Active or Inactive:** you also need catalog activation access.

Every change is checked by the server. If your access does not include it, the page tells you, and nothing changes.

**Before you start**
- The Manufacturers page has no entry in the left navigation. Reach it at **Inventory > Manufacturers** (web address `/inventory/manufacturers`), for example from a bookmark or a link.

## See the list

1. Open the page. The title is **Manufacturers**, with a count such as "12 manufacturers" once the list has loaded.
2. Read the table. It has two columns, **Name** and **Status**.
3. To reorder the list, click the **Name** or **Status** column heading. Click again to reverse the order.

## Add a manufacturer

1. Click **New Manufacturer** (top right).
2. Enter the **Manufacturer ID** (the identifier Parts use to refer to it) and the **Name**.
3. Click **Create Manufacturer**. On success the panel closes, the list reloads and the page says **Saved.** A new manufacturer starts as **Active**.

## Correct a manufacturer's name

1. On the manufacturer's row, click **Rename**.
2. Change the **Name** and click **Save Name**. If the name is unchanged, the page says **No changes to save.**

## Make a manufacturer Active or Inactive

1. On the manufacturer's row, click **Status**. The panel shows the current status.
2. Click **Make Inactive** (or **Make Active**).

An Inactive manufacturer is kept, because Parts and equipment may still refer to it. It is no longer offered when you pick a manufacturer for a Part. Manufacturers are never deleted.

## Tips / common problems

- **"You are not authorized to make this change."** Your access lets you see manufacturers but not make this change. Ask an administrator.
- **"This manufacturer changed since you loaded it, or that identifier is already in use. Reload and retry."** Someone else changed it first, or the Manufacturer ID you entered already exists. Reload the page and try again.
- **"Some fields are missing or invalid."** Both fields are required, and a name can be at most 200 characters.
- **"Already recorded (no change)."** The same change had already been saved, for example after a retry.
- **"Manufacturers isn't available to your role"** (instead of the page). Your access does not include reading the parts catalog.
- **"No manufacturers are recorded yet."** The list loaded and is empty. Use **New Manufacturer** to add the first one.
- **"You do not have access to Manufacturers."** Your account cannot read the manufacturer list.
- **"Manufacturers are currently unavailable. Try again later."** The list could not be loaded. Click **Try again**, or come back later.
- **"More manufacturers exist than this list shows."** The list has reached its size limit, so no count is printed. Ask an administrator.

## Related
- [Manage part identifiers](./manage-part-identifiers.md) (manufacturer part numbers are tied to a manufacturer)
- [Find a part](./find-a-part.md)
