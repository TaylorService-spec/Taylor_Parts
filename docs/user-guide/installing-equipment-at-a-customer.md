# Install equipment at a customer

**What this lets you do:** Take a unit the company already has in stock and record it as installed at a specific customer's location, creating that machine's permanent Equipment record.

**Who can do it:** Only people whose role includes equipment installation authority (the **Equipment Installer** role). If your account does not have this, the **Install / Assign to Customer** button does not appear on the screen at all — there is no greyed-out version of it to ask about. If you need this and don't have it, ask an administrator to add the Equipment Installer role to your account.

## Before you start

- **This cannot be undone.** Once you confirm an installation, the unit is permanently linked to that customer and that location. There is no uninstall, no "move to a different customer," and no recovery option in the app. Double-check the unit, the customer, and the location before you confirm.
- The unit must already be in the company's available inventory (it must show up under **Available Equipment**). Bringing a brand-new serialized unit into inventory in the first place is a separate job done by different people (Serialized Asset Acquirer) — you can't do that from this screen.
- The customer must already exist in the system, and the customer must already have at least one location on file. If a customer has no locations recorded, you'll need to add one first (see **Add a location to a customer**) before you can install a unit there.

## Steps

1. Go to **Equipment** in the left navigation, then open the **Available Equipment** tab.
2. Units are grouped into two sections — **Taylor** and **Ventana / Icetro** — based on the manufacturer. Find the unit you want to install. Each row shows the product name and serial number, plus its condition/status and current location.
3. Click **Install / Assign to Customer** on that unit's row. This opens the **Install at customer** dialog, which shows a summary of the unit (serial, model, line of business, current location) at the top.
4. Choose the **Customer** from the dropdown.
5. Choose the **Customer location** from the dropdown. Only locations belonging to the customer you just picked are listed. If you change the customer after picking a location, the location selection is cleared automatically — you'll need to pick it again.
6. Read the confirmation line that appears once both a customer and a location are selected. It states the unit, the customer, and the location, and reminds you: "This cannot be undone."
7. Click **Install at customer**. The button shows **Installing…** while the request is in progress.
8. On success, the app takes you directly to the new Equipment record for that unit.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| No **Install / Assign to Customer** button on a unit | Your account doesn't have equipment installation authority | Ask an administrator to grant you the Equipment Installer role |
| Button is greyed out, tooltip says "You are not authorized to install equipment at a customer." | Your access hasn't loaded yet, or was just changed | Wait a moment and try again; if it persists, check with an administrator |
| "That unit is no longer available to install." | Someone else already installed or reassigned this unit while you had the dialog open | Close the dialog and refresh the Available Equipment list — the unit will no longer be there if it's installed |
| "Choose a unit to install." / "Choose the customer this unit is for." / "Choose the customer location where it is installed." | A required field is empty | Fill in the missing selection |
| "This customer has no locations recorded. A unit can only be installed at a location." | The customer you picked has no locations on file | Add a location to that customer first, then come back and try again |
| "That location belongs to a different customer." or "That location is not one of this customer's locations." | The location no longer matches the chosen customer (can happen if data changed elsewhere) | Re-pick the customer and location |
| "That unit is already installed at a customer. It cannot be installed again." | The unit was already installed — sometimes shown after a second click or a page reload of the same request | Nothing to do; the existing Equipment record is the correct one. Look it up under Customer Equipment |
| "The installation could not be completed." | An unexpected error on the server side | Try again; if it keeps happening, report it |

## Tips

- Take your time on the confirmation screen. Because this cannot be reversed, it's worth reading the unit, customer, and location back to yourself before clicking **Install at customer**.
- If you click **Install at customer** and your connection hiccups, it's safe to retry — the app won't create a duplicate machine record for the same attempt. If the unit turns out to already be installed, you'll be told plainly rather than left guessing.

## Related

- [Add a location to a customer](accounts-customers/add-a-location-to-a-customer.md)
- [Browse and search customers](accounts-customers/browse-and-search-customers.md)
