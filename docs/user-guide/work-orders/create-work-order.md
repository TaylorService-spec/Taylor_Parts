# Create a work order

**What this lets you do:** Walk through a four-step form to raise a new work order for a customer.

**Who can do it:** Admin and dispatcher.

> **Not yet available.** You can open the wizard and fill in every step, but the final **Create Work Order** step can't finish yet — the service that saves work orders isn't switched on in the live app. When you press **Create Work Order** you'll see: *"Work Order creation service is not currently available in this environment."* Nothing is saved. This guide documents the flow so it's ready for when creation is turned on.

## Before you start

- Sign in with an admin or dispatcher account.
- The customer must already exist, and ideally have a location. If the customer has no locations, add one from the Customer Detail page first.

## Steps

1. Open **Service > Work Orders**, then click **+ New Work Order**. The wizard opens at **Step 1 of 4**.
2. **Step 1: Customer.** Type in **Search customers...** and click the customer you want. The wizard moves to Step 2.
3. **Step 2: Location.** Pick the site from the **Select a location...** list, then click **Next**.
   - If you see "This customer has no locations yet," add one on the Customer Detail page first, then start over.
4. **Step 3: Service Details.** Set the **Priority** (1 Emergency to 4 Low). Then either pick a **Type** (Service Call, PM, Install, Warranty, Inspection) or, if you leave Type blank, type a **Complaint** — one of the two is required. **Severity** is optional. Click **Next**.
5. **Step 4: Review & Create.** Check the summary, then click **Create Work Order**.

## What happens now

- Because the create service isn't live, Step 4 shows the "not currently available" message and no work order is created. Everything up to that point works normally.

## Tips and common problems

- **Next is greyed out on Step 3.** You must choose a Type *or* enter a Complaint before you can continue.
- Use **Back** at any step to change an earlier answer without losing the rest.

## Related

- Browse and find work orders
- Move a work order through its lifecycle (dispatcher)
