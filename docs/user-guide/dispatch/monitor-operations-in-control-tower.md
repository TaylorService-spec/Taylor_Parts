# Monitor operations (Service Operations)

**What this lets you do:** See what needs a decision across the whole service operation, in one read
— what needs attention right now, what is at risk, how loaded your technicians are, and who the
system suggests for the work waiting to be dispatched.

**Who can do it:** Admin and Dispatcher. (Technicians do not see this screen.)

**Before you start**
- Open **Service Operations** from the left navigation. It sits near the top, above Equipment and
  Service.
- This screen only shows information. Nothing on it changes data — to schedule, assign or dispatch,
  use the Dispatch Board or open the work order itself.

## What you see, top to bottom

1. **Needs attention** — the first thing on the page, and it only appears when something actually
   needs you. Rows are grouped the way the system groups them:
   - **Ready to Schedule** — the work order is ready and nobody has scheduled it.
   - **Past Due** — it was scheduled to start before today and still hasn't.
   - **Scheduling Conflict** — a technician is double-booked.
   - **Parts Blocked** — see the note under "Tips" below.

   Each row says whether it needs an action from you ("Action needed") or is already moving without
   you ("In progress"), and links straight to the work order.

2. **Four numbers** — Awaiting dispatch, In progress, Technicians on shift, Completed. Every number
   is clickable, and where there's an exception behind it, it says so underneath — for example
   "3 ready to schedule" or "2 at risk" — and clicking that takes you to those exact rows.

3. **At risk** — work orders the system scores as going wrong, most severe first. You can re-sort by
   age. Each row shows the account, how severe it is, roughly how old it is, why it was flagged, and
   who's on it.

4. **Technician load** — one row per technician: their status, how many active work orders they're
   carrying, and whether that counts as overloaded.

5. **Recommended dispatch** — for each work order waiting on a technician, who the system suggests
   and why. **Suggestions only.** You can collapse this band if you don't want it.

6. **Activity** (right-hand column) — what has been happening across the work orders currently
   loaded. You can filter it.

## Steps

1. Start at **Needs attention**. If it isn't there, nothing is waiting on you.
2. Scan the four numbers for the shape of the day, and click any exception count to jump to its rows.
3. Work down **At risk** for anything going wrong that nobody has flagged.
4. Use **Recommended dispatch** to see who the system would put on the open work.
5. Go to the **Dispatch Board** (button at the top right) or open a work order to actually act.

## Tips / common problems

- **"Needs attention" isn't showing at all.** That's the point — when nothing needs attention, the
  section is absent rather than showing you an empty box. Nothing is broken.
- **"Parts readiness isn't connected to this page yet."** This screen does not yet read parts
  availability, so it cannot tell you whether a work order is short of parts. It says so rather than
  leaving the section out and letting you assume there are no parts problems. Check parts on the work
  order itself.
- **Activity doesn't show times.** The system records when a work order was created, but not a
  separate time for each step afterwards. Showing a time next to each entry would repeat the same
  clock time on every step and look like they all happened at once, so the list shows the order
  things happened in and no times. It also isn't an audit log — it's built from the work orders
  currently loaded.
- **"Technicians on shift" doesn't match your headcount.** It counts technicians who are available or
  on a job. Anyone off shift isn't counted.
- **A number says "unavailable" instead of a figure.** The screen could not read that information
  this time — it is not zero, and the difference matters. Everything else on the page is unaffected.
- **You can't assign from a recommendation.** By design. Assignment is a governed action with its own
  checks, and it lives on the Dispatch Board.
- **You can't change a work order from this screen any more.** Also by design — open the work order
  and act there, where you can see its full state before you change it.

## Related

- Dispatch Board (dispatch or schedule a work order)
- Assign a job on the Dispatch screen
- Work order detail (the record itself)
