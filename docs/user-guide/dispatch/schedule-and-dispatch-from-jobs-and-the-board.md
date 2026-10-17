# Jobs and the Dispatcher Board share one scheduling path

**What this lets you do:** Know what to expect when you schedule, move, reassign, return or dispatch a Work Order, whichever screen you use. **Service > Dispatch > Jobs** and **Service > Dispatch > Dispatcher Board** do these the same way.

**Who can do it:** People with dispatch access, normally Admin and Dispatcher. Which buttons you see depends on your access (scheduling, and separately dispatching). The Jobs screen is titled **Dispatch** on the page itself; in the left navigation it is **Jobs**.

## What is the same on both screens

- **The Schedule window is the same.** On the Jobs screen the **Schedule…** button, and on the board the **Schedule…** button in the Ready to Schedule queue, open **Schedule This Work Order** with **Technician**, **Starts** and **Length**.
- **It starts on a valid future time.** The window asks for the earliest open time, and fills it in. It no longer opens on a time that has already gone. Past times cannot be chosen.
- **Times are in the company's business time zone.** The window says "Times are in <zone>." If it could not read the company's zone, it says it is using your browser's zone.
- **Moves and reassignments need a reason.** Scheduling a waiting Work Order does not.
- **Dispatching is the same step on both screens.** Jobs has a **Dispatch to <name>** button for the technician the Work Order is scheduled for; the board's **Dispatch to...** picker (in the details below the board) lets you choose a technician. The same messages appear: "<number> scheduled.", "moved.", "reassigned.", "dispatched."
- **Working hours are enforced, not just flagged.** If the time you choose falls outside the technician's recorded working hours, the server refuses it with a sentence such as "Refused — that window falls outside <name>'s working hours." Nothing is scheduled; pick a time inside their hours. The same applies to a technician with no working hours recorded and to time they are marked unavailable.
- **The server decides.** Both screens ask, and the server re-checks every action. If it refuses, you get a sentence saying why, the window stays open so you can correct it, and nothing has changed.
- **Your access decides what you are offered.** Without scheduling access you do not get Schedule…, Move…, Reassign… or board drag. Without dispatch access neither screen offers **Dispatch to…**. The Jobs screen says "You can see these jobs, but scheduling and dispatching are not part of your access." when you have neither. The board's notice covers scheduling only: "You can see the board, but scheduling is not part of your access."

## What differs

- **Return to queue** is on the board only (drag a scheduled chip back to the queue).
- **Dragging, resizing and the day / week / 2 weeks views** are on the board only. Jobs is a list.
- **Cancel.** Neither screen has a button that cancels a Work Order. Cancelled Work Orders appear on Jobs under **Finished or cancelled**.

## Your companies' work

Your company comes from your employee record (and any company an administrator has assigned you). You never pick it on the screen.

- **Work Orders:** the Work Orders list and the Work Orders on Jobs and the board show only your companies' work. No filter, search or sort can bring up another company's Work Orders.
- **Technicians' working hours, blocked time and the earliest-time suggestion** are limited to your companies.
- **Technicians are limited to your companies too.** The board's technician lanes and the technician pickers list only your companies' technicians. For one Work Order, the picker lists only that Work Order's company's technicians. The server still checks every scheduling request: it refuses another company's work, and refuses a technician who is not eligible for the Work Order's company.
- **If your login is not linked to a company,** these screens do not show an empty list. They say: **"No operating company is linked to your login, so no company's work orders can be shown. An administrator can link your login to your employee record, or assign you an operating company."** On the Board, each lane then says **Schedule unavailable** (not "No schedule"). On My Work, the dispatch section says **"Not available to you — …"**. Ask an administrator to link your login to your employee record. The technician lanes and pickers are not available either, until your login is linked.
- **If your access does not include reading Work Orders at all,** the screen says you do not have permission. That is a different fix (an access change), not a company link.

## Related
- [Schedule and dispatch jobs (Jobs screen)](./assign-a-job-on-the-dispatch-screen.md)
- [Schedule, move and dispatch on the Dispatcher Board](./dispatch-a-work-order-on-the-dispatcher-board.md)
- [Read the Dispatch & Scheduling board](./read-the-dispatch-board.md)
