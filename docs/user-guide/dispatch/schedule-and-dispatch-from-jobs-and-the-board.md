# Jobs and the Dispatcher Board share one scheduling path

**What this lets you do:** Know what to expect when you schedule, move, reassign, return or dispatch a Work Order, whichever screen you use. **Service > Dispatch > Jobs** and **Service > Dispatch > Dispatcher Board** do these the same way.

**Who can do it:** Admin and Dispatcher. Which buttons you see depends on your access (scheduling, and separately dispatching).

## What is the same on both screens

- **The Schedule window is the same.** On the Jobs screen the **Schedule…** button, and on the board the **Schedule…** button in the Ready to Schedule queue, open **Schedule This Work Order** with **Technician**, **Starts** and **Length**.
- **It starts on a valid future time.** The window asks for the earliest open time, and fills it in. It no longer opens on a time that has already gone. Past times cannot be chosen.
- **Times are in the company's business time zone.** The window says "Times are in <zone>." If it could not read the company's zone, it says it is using your browser's zone.
- **Moves and reassignments need a reason.** Scheduling a waiting Work Order does not.
- **Dispatching is the same step on both screens.** Jobs dispatches to the technician the Work Order is scheduled for; the board's **Dispatch to…** picker lets you choose a technician. The same messages appear: "<number> scheduled.", "moved.", "reassigned.", "dispatched." Warnings about a successful placement (for example outside working hours) are shown after the message rather than as a failure.
- **The server decides.** Both screens ask, and the server re-checks every action. If it refuses, you get a sentence saying why, the window stays open so you can correct it, and nothing has changed.
- **Your access decides what you are offered.** Without scheduling access you do not get Schedule…, Move…, Reassign… or board drag. Without dispatch access the Jobs screen does not offer Dispatch to…. Each screen says when scheduling or dispatching is not part of your access.

## What differs

- **Return to queue** is on the board only (drag a scheduled chip back to the queue).
- **Dragging, resizing and the day / week / 2 weeks views** are on the board only. Jobs is a list.
- **Cancel.** Neither screen has a button that cancels a Work Order. Cancelled Work Orders appear on Jobs under **Finished or cancelled**.

## You see only your own companies' work and technicians

Jobs, the Dispatcher Board, the Work Orders list and My Work show only the companies your login is linked to. Your company comes from your employee record (and any company an administrator has assigned you). You never pick it on the screen.

- **Work Orders:** another company's Work Orders are never listed, and no filter, search or sort can bring them up.
- **Technicians and their schedules:** the Board's lanes, working hours, blocked time and "available slots" cover only your companies' technicians. A dispatcher at one company does not see another company's technicians.
- **If your login is not linked to a company,** these screens do not show an empty list. They say: **"No operating company is linked to your login, so no company's work orders can be shown. An administrator can link your login to your employee record, or assign you an operating company."** On the Board, each lane then says **Schedule unavailable** (not "No schedule"). On My Work, the dispatch section says **"Not available to you — …"**. Ask an administrator to link your login to your employee record.
- **If your access does not include reading Work Orders at all,** the screen says you do not have permission. That is a different fix (an access change), not a company link.

## Related
- [Schedule and dispatch jobs (Jobs screen)](./assign-a-job-on-the-dispatch-screen.md)
- [Schedule, move and dispatch on the Dispatcher Board](./dispatch-a-work-order-on-the-dispatcher-board.md)
- [Read the Dispatch & Scheduling board](./read-the-dispatch-board.md)
