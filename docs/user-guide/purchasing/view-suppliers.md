# View suppliers

**Status: live**

**What this lets you do:** Look up the company's suppliers and their status — name, vendor number, contact info, and whether they're active for purchasing. This screen is read-only: you look things up here, you don't add, edit, activate, or deactivate a supplier from it.

**Who can do it:** Admin and Dispatcher roles.

## Before you start
- Nothing to set up. If no suppliers are recorded yet, the list will be empty.

## Steps
1. **Open Purchasing > Suppliers.** In the top navigation, go to the **Purchasing** area, then the **Suppliers** tab.
2. **Read the summary line.** Near the top, a line like "12 suppliers · 9 active · 2 inactive" tells you how many suppliers exist and how many are in each state.
3. **Read the table.** Each row is one supplier:
   - **Supplier** — the supplier's name.
   - **Vendor #** — their vendor number, if one is recorded (shown as "—" if not).
   - **Contact** — the best available contact info (email, phone, or a contact name), whichever is recorded first, or "—" if none is on file.
   - **Status** — Active, Inactive, or Ungoverned (see below).
4. **Filter by status.** Use the **All / Active / Inactive / Ungoverned** filter bar at the top of the list; each option shows a count.

## What the statuses mean
- **Active** — selectable for purchasing.
- **Inactive** — kept for history, but not selectable for new purchasing.
- **Ungoverned** — an older record that predates the company's formal supplier setup and has no set status. It's shown with an amber flag because it needs attention: it's not selectable for purchasing until someone brings it under proper governance. If any suppliers are ungoverned, a warning line above the table tells you how many, and the **Ungoverned** filter is the fastest way to find them.

## Tips and common problems
- **You can't add, edit, activate, or deactivate a supplier from this screen.** Those are back-office actions handled outside this workspace.
- **"Suppliers unavailable" message:** the screen couldn't load the data — usually a permissions or connection issue. Try again, and if it persists, report it.
- **List is empty:** no suppliers are recorded yet, or none match your current filter — try switching to **All**.
- **Looking for orders placed with a supplier?** Those appear under [View purchase orders](view-purchase-orders.md), not here.

## Related
- [View purchase orders](view-purchase-orders.md)
- [View receipts](view-receipts.md)
