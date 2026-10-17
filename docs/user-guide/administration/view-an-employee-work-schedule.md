# View and change an Employee's work schedule

**What this lets you do:** see and change one Employee's working hours and time off (PTO and other exceptions). These are the same records the Dispatch board and placement checks use.

**Two ways in:**
- **From Administration:** Administration → Employees & Users → open the Employee → **Work Schedule** tab (`/administration/users/<employee>?tab=schedule`).
- **From the Dispatch board:** Service → Dispatch Board. Either:
  - click a technician's name, then click **Work schedule** in their review; or
  - click the amber **No schedule** under a technician who has none.

  The Employee record opens on the Work Schedule tab. **Back to the board** (top of the record) returns you to the same date, view, filter and technician review.

  The **Work schedule** link and the clickable **No schedule** only appear if you can open Employee records (see below). Everyone else sees the board exactly as before.

## Who can see it

You need all three of the following. EOS checks them on the server every time.
1. A scheduling role: the ability to schedule or dispatch Work Orders.
2. Permission to read Employee records.
3. Access to that Employee's operating company.

If any one is missing, the tab says the schedule is visible to scheduling roles that can see this Employee's record and operating company. It never shows part of a schedule. Being able to use the Dispatch board does not by itself give you this tab, and having this tab does not give you the board.

## What you see

- **Current Schedule:** the working hours for each weekday, for example *7:00a–12:00p · 30 min break · 12:30p–4:00p*. Also the time zone, the start date, and whether it applies to all companies or only one.
- **Upcoming and History:** schedules that start later, and ones that have ended. A schedule is never edited in place. A new one replaces it from a chosen date, and the old one stays in the history.
- **Exceptions:** PTO, training, meetings and other time away, from the last 30 days and the next 90.
- **No working schedule recorded:** nothing has been recorded for this person. EOS does not assume default hours. The Dispatch board shows them as *No schedule*, and jobs cannot be placed with them until a schedule is recorded.

## Changing working hours and time off

**Where it is switched on.** Changing is on in the **nonprod** environment (the one at `verenwardeos.vercel.app`). In production the tab stays view-only until the Owner turns it on there.

**Who can change.** You need everything under *Who can see it*, **plus** the scheduling permission itself (scheduling Work Orders, not only dispatching). Without it you see the schedule but no change buttons. EOS checks every change on the server: you can only change Employees of your own operating companies.

### Set or change working hours
1. On the Work Schedule tab, click **Record schedule** (no schedule yet) or **Record a new schedule**.
2. Choose **Starts**: the first day the new hours apply, today or later. The current schedule ends the day before and stays in the history.
3. Enter the **Time zone**, for example `America/Phoenix`.
4. For each working day, click **Add interval** and enter a start and end time. For a break, add two intervals with the gap between them, for example 7:00–12:00 and 12:30–16:00. Use **Copy Mon to Tue–Fri** to repeat Monday's hours. Leave a day empty for a day off.
5. Optional: tick **Only for <company> work** if these hours apply only to that company's jobs. Add a **Reason**.
6. Click **Save new schedule**. The tab re-reads and shows the new hours. The Dispatch board uses them right away.

An empty schedule is refused: EOS never assumes default hours.

### Add PTO or other time away
1. Under **Exceptions**, click **Add exception**.
2. Choose the **Kind**: PTO, Lunch, Training, Meeting, Truck service, Unavailable or Company closure.
3. Choose **Starts** and **Ends** (date and time, at most 90 days), and optionally a **Reason**.
4. Click **Record exception**. It appears in the list, and the Dispatch board shows it as hatched *unavailable* time. Jobs cannot be placed over it.

### End time away early, or withdraw it
1. Next to an exception that has not finished, click **End early**.
2. Say **Why**, then click **End exception**. If it had not started yet it is withdrawn; otherwise it ends now.

Nothing is ever deleted. Ended schedules and exceptions stay in the history.

If a change is refused, the reason is shown in words (for example, a start date in the past, overlapping intervals, or an Employee outside your companies) and nothing is saved.

## Related

- [Read the Dispatch & Scheduling board](../dispatch/read-the-dispatch-board.md)
- [Manage employees](manage-employees.md)
