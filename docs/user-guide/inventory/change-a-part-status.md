# Change a part's status

**What this lets you do:** Move a part to its next allowed status (for example from Draft to Active), from the Parts list or from the part's detail page.

**Who can do it:** Parts Managers and administrators. The control is **Status** on the Parts list and **Change Status** on the part's detail page. You see it only if your access includes part and manufacturer status. If you do not hold that access, the control is not on your screen.

This is the same permission that makes a manufacturer Active or Inactive (see [View and manage manufacturers](./view-manufacturers.md)). It is separate from the permission to activate or deactivate a supplier: holding one does not give you the other.

**Before you start**
- Open **Inventory > Parts**, or open a part from the list.

## Change the status

1. On the Parts list, click **Status** on the part's row. Or open the part and click **Change Status**.
2. The panel shows the part's current status and one button for each change the rules allow, each starting with an arrow. If no change is allowed from the current status, the panel says so.
3. Click the status you want. The panel closes and the part shows its new status.

Every change is checked by the server again when you click. If someone else changed the part after you opened it, the change is refused and you are asked to reload the part and decide again. If the Catalog is paused for changes, the control stays on the screen but is switched off, and it says why.
