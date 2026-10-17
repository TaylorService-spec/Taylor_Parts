# Schedule and dispatch jobs (Jobs screen)

**What this lets you do:** Work through the list of Work Orders by what needs doing next: schedule the waiting ones, move or reassign the scheduled ones, and dispatch them to the technician.

**Who can do it:** People with dispatch access, normally Admin and Dispatcher, can open the screen. Each button appears only if your access allows it: **Schedule…**, **Move…**, **Reassign…** need scheduling access, and **Dispatch to …** needs dispatch access. Technicians do not see this screen.

**Before you start**
- Open **Service > Dispatch > Jobs**. The page heading reads **Dispatch**. (Do not confuse it with **Job Assignments** under Work Management, which is a read-only list.)
- The screen groups Work Orders under headings, in the order you would work them: **Scheduled — ready to dispatch**, **Waiting to be scheduled**, **In the field**, **Not ready to schedule yet**, **Finished or cancelled**. Empty groups are not shown.

## Schedule a waiting Work Order

1. Under **Waiting to be scheduled**, find the card and click **Schedule…**. The **Schedule This Work Order** window opens.
2. Wait for "Finding the earliest open time…" to finish. The **Starts** field is filled with the earliest valid future time, and a technician is filled in if you left it blank. You can change **Technician**, **Starts** and **Length** (30 minutes up to 8 hours).
3. Click **Schedule**. The card moves to **Scheduled — ready to dispatch** and the screen says "<number> scheduled."

This is the same window and the same rules as scheduling on the Dispatcher Board. See [Jobs and the board share one scheduling path](./schedule-and-dispatch-from-jobs-and-the-board.md).

## Dispatch a scheduled Work Order

1. Under **Scheduled — ready to dispatch**, the card says "Scheduled for <technician>".
2. Click **Dispatch to <technician>**. The screen says "<number> dispatched." and the card moves to **In the field**.

## Move or reassign a scheduled Work Order

1. Click **Move…** to pick a new time, or **Reassign…** to pick a different technician. If the card says "Scheduled, but no technician is recorded", click **Choose technician…** instead.
2. In the window, fill in what changes and type the reason (required; the confirm button stays off until you do). The buttons read **Confirm new time** or **Confirm reassignment**.
3. Click the confirm button. A reassignment keeps the job's current time. The screen says "<number> moved." or "<number> reassigned."

## Tips / common problems

- **The Starts time says "Times are in <zone>".** The window uses your company's business time zone. The date and time printed on the cards use your computer's own clock, so they can differ if your computer is in another zone.
- **"That start time has already passed. Choose a later time."** Past times cannot be chosen, and nothing is moved forward for you. If the window sat open until its time passed, it looks up a fresh earliest time and asks you to check it and submit again.
- **No open time found.** The window says why (no technician has an open window, the technician has no working hours recorded, or they cannot be scheduled for this job) and offers the earliest alternative with **Use this time**. You can also type a time and try; the server checks it on submit.
- **The window stays open with a red sentence.** The server refused the change. Adjust and try again, or **Cancel**.
- **No buttons on a card.** You may not have that access. If you have neither scheduling nor dispatch, the screen says: "You can see these jobs, but scheduling and dispatching are not part of your access."
- **"Technicians could not be loaded."** Schedule…, Move… and Reassign… are unavailable until it works. Dispatching to the already scheduled technician still works if you have dispatch access.
- **Cancelling a Work Order.** There is no cancel button on this screen. Cancelled Work Orders show a **Cancelled** chip under **Finished or cancelled**. "Open work order" on any card takes you to the Work Order.
- **Returning a job to the queue** is done on the Dispatcher Board, not here.

## Related
- [Schedule, move and dispatch on the Dispatcher Board](./dispatch-a-work-order-on-the-dispatcher-board.md)
- [Jobs and the board share one scheduling path](./schedule-and-dispatch-from-jobs-and-the-board.md)
- [Control Tower](./monitor-operations-in-control-tower.md)
