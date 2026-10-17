# View an Employee's work schedule

**What this lets you do:** see the governed working hours and time off for one Employee, on the same records the Dispatch board and placement checks use.

**Where:** Administration → Users → open an Employee → **Work Schedule** tab (`/administration/users/<employee>?tab=schedule`).

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

## Changing a schedule

Recording a new schedule and adding or ending an exception are **not switched on yet**. They will appear on this tab for people with scheduling permission once the Owner turns them on. Until then, this tab is read-only.

## Related

- [Read the Dispatch & Scheduling board](../dispatch/read-the-dispatch-board.md)
- [Manage employees](manage-employees.md)
