# Schedule, move and dispatch on the Dispatcher Board

**What this lets you do:** Put Work Orders on a technician's day, move or reassign them, return them to the queue, and dispatch them, all from one board.

**Who can do it:** People with dispatch access, normally Admin and Dispatcher, can open the board. Changing the schedule (Schedule…, drag, keyboard move/resize, reassign) is shown only to people whose access includes scheduling. Everyone else can look but not change anything (see "If you cannot schedule" below). Technicians do not see the board.

**Before you start**
- Open **Service > Dispatch > Dispatcher Board**. The page is titled **Dispatch & Scheduling**.
- A Work Order must be waiting in the **Ready to Schedule** queue under the grid to be scheduled.
- Read the line under the title: **Times are in <zone>.** Every day, hour and date on this board is drawn in your company's business time zone, not your computer's. If your companies keep different zones, or the company's zone could not be read, the line says so ("your browser's zone; your companies keep different business time zones" or "your browser's zone; the company's could not be read") and the board uses your computer's zone instead.

## Schedule a Work Order from the queue

1. In **Ready to Schedule**, click **Schedule…** on the Work Order's card. The **Schedule This Work Order** window opens.
2. The window looks up the earliest open time and fills it in, with a technician if you had none. While it looks, it says "Finding the earliest open time…". Change **Technician**, **Starts** or **Length** if you want something else.
3. Click **Schedule**. The Work Order moves onto that technician's lane, and the board says "<number> scheduled."

Or drag the card from the queue onto a technician's lane. Dropping on the lane schedules it straight away at the spot you dropped it, with no extra window. The technician lanes scroll inside their own area, so the queue stays on screen beneath them while you drag; scroll the lanes with the mouse wheel if the technician you want is out of view.

**Without dragging (touch screen, trackpad):** click **Place on a lane** on the card. The board says "Placing <number>: click a time on a technician's lane (day view). Esc cancels." (the board switches to Day view if you were on another). Click the spot on the technician's lane where the work should start. It is scheduled exactly as a drop would schedule it. Press **Esc** or click **Cancel** to stop placing. **Schedule…** is the keyboard path.

**In Week view,** dropping a card on a technician's day does not schedule it straight away. It opens the same window (for example **Schedule This Work Order**) set to that day, and you choose the hour in the **Starts** field before confirming. When the drop is a reassignment, the window asks for the reason and keeps the current time.

## Move, resize or reassign a scheduled Work Order

1. Drag the Work Order's chip along its lane to move it, drag its trailing edge to change its length, or drag it onto another technician's lane to reassign it. By keyboard, focus the chip and press the arrow keys (15 minutes each; hold Shift for 1 hour), or Alt plus an arrow to resize. To move work to a different technician, drag the chip onto that technician's lane, or use **Place on a lane** (below). The **R** key does not choose another technician: it opens the reason prompt for the same technician the Work Order is already with.
   Without dragging: select the chip, click **Place on a lane** in its details below the board, then click the new time (same lane to move it, another technician's lane to reassign it).
2. A small window asks for **Reason for Schedule Change** (a reason is required). Type it and press Enter, or click **Move** or **Reassign**.
3. The chip moves. A reassignment keeps the job's current time.

## Return a Work Order to the queue

1. Drag a **Scheduled** chip back onto the queue.
2. Type why in the **Return This Work Order to the Queue** window and click **Return to queue**.
3. Once a Work Order has been dispatched there is no way back from here. See [Return a work order to the queue](./return-a-work-order-to-the-queue.md).

## Dispatch a scheduled Work Order

1. Click a Work Order to select it. Its details open below the board.
2. If it can be dispatched, open the **Dispatch to...** list, pick a technician and click **Dispatch**. The board says "<number> dispatched." The list needs dispatch access and at least one recommended technician for the Work Order (the details show "Recommended Technicians (Top 3)"); without one it is not shown.

## Review one technician's schedule and work

1. Click a technician's name at the left of a lane (Day view) or a row (Week view).
2. The board switches to that technician's week: their working hours, blocked time and scheduled work, with a list of their scheduled Work Orders under **<name> — schedule and work**. Click a Work Order number to see its details.
3. Click **Back to the board** to return. The board comes back on the same date, view and technician filter you had before.

This review shows only what the board already shows you.

**To change working hours or enter PTO** for that technician, click **Work schedule** in the review. You can also click the amber **No schedule** under a technician who has none. The Employee record opens on its Work Schedule tab. There:
- **Record schedule** / **Record a new schedule** sets working hours;
- **Add exception** enters PTO or other time away;
- **End early** ends or withdraws it.

**Back to the board** brings you back to the same date, view, filter and review.

The **Work schedule** link appears only if you can open Employee records (Administration access and permission to read employee records). Changing is switched on in nonprod. See [View and change an Employee's work schedule](../administration/view-an-employee-work-schedule.md).

## If you cannot schedule

When your access does not include scheduling, the board shows: **You can see the board, but scheduling is not part of your access.** The grid, queue and Work Order details still work. Drag handles, **Schedule…**, **Place on a lane**, keyboard move/resize and reassign are not offered. While your access is still loading, or if reading it fails, these controls are also hidden and no notice is shown. Ask an administrator if you need scheduling added.

## Tips / common problems

- **"That time has already passed."** A start in the past is refused, and the board will not shift it forward for you. Pick a later slot.
- **A move is refused and the chip stays put.** Nothing is written until the server accepts it. The reason (overlap, blocked time, a technician who cannot be scheduled) is shown in words. The server re-checks every action, even ones the board let you try.
- **Dispatch to... does not appear.** The Work Order is not in a state that can be dispatched, your access does not include dispatching, or there is no recommended technician to show for that Work Order.
- **"Refused — that window falls outside <name>'s working hours."** The time you chose is outside the technician's recorded working hours. EOS refuses it rather than warning you; pick a time inside their hours.
- **"Refused — no operating company is linked to your login…"** Your login is not linked to an employee record with a company, so the server will not let you schedule. An administrator can link it. Nothing was changed.
- **A drag does nothing.** Check the line above the board: if it says scheduling is not part of your access, dragging is turned off for you. Late in the day every slot on today's grid is already past; move to a later day with **›**.
- **Scheduled Without a Window.** If a scheduled Work Order has no start and end it cannot be drawn on a lane. It is listed under that heading; open it to give it a time.
- The board refreshes every 30 seconds and right after your own changes.

## Related
- [Read the Dispatch & Scheduling board](./read-the-dispatch-board.md) (colours, Day / Week / 2 weeks, keeping your place)
- [Schedule and dispatch from Jobs and the board](./schedule-and-dispatch-from-jobs-and-the-board.md)
- [Return a work order to the queue](./return-a-work-order-to-the-queue.md)
