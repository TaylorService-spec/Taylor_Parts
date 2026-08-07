# Schedule Work Orders (Scheduling workspace)

**What this lets you do:** See the week ahead across every technician, and put a date, time, and technician on Work Orders that are ready to schedule.

**Who can do it:** Admin and Dispatcher. (Technicians do not see the Scheduling workspace.)

**Before you start**
- Open **Service > Scheduling** from the top navigation.
- A Work Order must be in **Ready to dispatch** status to be scheduled here. If none are, the "Ready to schedule" list will say so.
- At least one technician must exist. If none do, the board shows "No technicians exist yet. Add technicians in Administration to schedule work."

**Understanding the layout**
The workspace opens on the **Week** view: a grid of technicians (rows) by day, Monday through Sunday (columns). Each scheduled Work Order shows as a small chip with its Work Order number and time. A summary line above the grid shows how many jobs are scheduled this week, how many are ready to schedule, how many technicians you have, and — only when there is a problem — how many jobs need attention.

Down the side, a **Ready to schedule** list shows every Work Order waiting for a slot.

**Steps — schedule a waiting Work Order**
1. In the **Ready to schedule** list, find the Work Order you want to place. Each row shows its number, priority, and type.
2. Click **Schedule** on that row. A small form opens with four fields: **Date**, **Start**, **End**, and **Technician**.
3. Fill in the date and the start/end times, and choose a technician from the dropdown (it lists every technician, not just ones free at this exact moment — you're planning ahead, not dispatching now).
4. Click **Schedule**. While it saves, the button reads "Scheduling…". If the end time isn't after the start time, or a field is missing, the form tells you what to fix and does not submit.
5. When it succeeds, the form closes and the job appears as a chip on the week board, in that technician's row and day.

**Steps — look at the week**
1. Use **‹ Previous week**, **This week**, and **Next week ›** to move between weeks. The date range shown updates as you navigate.
2. Click a job chip anywhere on the board to open its details: status, date/time, technician, priority, type, customer, and location. This is read-only — it's for checking, not editing. Click **Close** to dismiss it.
3. Click a day heading (for example "Mon 10") to drill into that single day. The **Day** agenda lists every technician's jobs for that day, which is easier to read on a phone. Click **Back to week** to return, or use **Week** in the view toggle at the top.

**Steps — handle jobs that need attention**
1. If the summary line shows a "need attention" count, look at the **Needs attention** list on the side. It flags two things: jobs that overlap another job for the same technician, and jobs still scheduled for a time that has already passed.
2. Click a flagged Work Order number to open its read-only details and confirm what's going on.
3. To actually fix it — move the time, reassign it, or cancel it — open that Work Order from **Service** (Work Orders, the Dispatcher Board, or the Dispatch screen). The Scheduling workspace does not have a way to change a job's time once it's scheduled.

**Tips / common problems**
- **There's no way to reschedule an already-scheduled job here.** That's expected in this release — Scheduling only places Work Orders that are still **Ready to dispatch**. To change the time of a job that's already scheduled, or to cancel it, open it from the Work Orders list, the Dispatcher Board, or Dispatch.
- **A job shows a warning triangle on its chip.** It overlaps another job for the same technician — check "Needs attention" for the full list.
- **A Work Order won't schedule and the form shows an error.** Confirm you picked a date, a start time, an end time, and a technician, and that the end time is after the start time — all four are required.
- **"Scheduled, no matching technician" appears in the side panel.** A job is scheduled to a technician ID that no longer matches anyone in the technician list (for example, someone was removed). Open the job to see what's recorded, and reassign it from the Work Order itself if needed.
- **The board looks squeezed on a narrow screen.** Scroll the grid sideways, or switch to the **Day** view for a single day at a time — it's built for phones.

**Related**
- Dispatcher Board (send a **Scheduled** Work Order to a technician)
- Dispatch screen (a simpler one-click job-to-technician assignment)
- Control Tower (read-only overview and recommended dispatch queue)
