# Move a work order through its lifecycle (dispatcher)

**What this lets you do:** Advance a work order to its next stage — mark it ready, schedule it, dispatch it to a technician, close it, or cancel it.

**Who can do it:** Admin and dispatcher.

> **Not yet available.** The action buttons appear and are clickable, but the service that records a status change isn't switched on in the live app. Pressing an action shows an error message and the status doesn't change. This guide documents the flow so it's ready for when transitions are turned on.

## Before you start

- Sign in with an admin or dispatcher account.
- Open the work order you want to move (Service > Work Orders, then click its number).

## Steps

1. On the work order detail page, find the status badge and the row of action buttons beneath it. Only the actions that are valid from the current status are shown.
2. Click the action for the next stage:
   - **Mark Ready** — moves a newly created work order to ready-to-dispatch.
   - **Schedule** — sets it as scheduled.
   - **Dispatch** — sends it to a technician. A technician picker appears; choose an **available** technician and click **Confirm Dispatch** (or **Back** to cancel).
   - **Close** — closes a completed work order.
   - **Cancel** — cancels the work order.
3. The work order moves to its new status (once the service is live).

## Tips and common problems

- **No buttons, just a status label.** Once a technician has accepted a work order (Accepted, En Route, Arrived, or Work in Progress), this dispatcher view is read-only on purpose — you can't cancel out from under a technician who's already on it. The same is true for closed and cancelled work orders.
- **The technician list is empty when dispatching.** Only technicians marked **available** appear in the picker.
- Technicians progress their own steps (Accept, Travel, Arrive, Start Work, Complete) from their dashboard — see *Progress your assigned work order (technician)*.

## Related

- View a work order's details
- Progress your assigned work order (technician)
