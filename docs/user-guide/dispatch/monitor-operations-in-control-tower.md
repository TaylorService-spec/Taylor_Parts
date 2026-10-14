# Monitor operations (Control Tower)

**What this lets you do:** See the whole operation at a glance — open vs. in-progress vs. completed work, technician availability and load, at-risk items, and a suggested dispatch queue — all on one read-only screen.

**Who can do it:** Admin and Dispatcher. (Technicians do not see Control Tower.)

**Before you start**
- Open **Service > Control Tower** from the left navigation.
- This screen only shows information. Nothing here changes data — to actually assign or dispatch, use the Dispatch screen or the Dispatcher Board.

**What you see**
1. **Top counters:** Open Work Orders, In Progress, Completed, Techs Available, and Techs On Work Order. These update live as work moves.
2. **Missing-assignment warning:** if any jobs have no Work Order attached, a "Jobs missing Work Order assignment" banner shows the count.
3. **Work Order detail cards:** one per Work Order, each with its operational history.
4. **Technician Load:** a per-technician count of how many jobs each one is carrying (plus an "Unassigned" bucket).
5. **Intelligence panels:**
   - **At Risk** — Work Orders/jobs flagged as needing attention.
   - **Recommended Dispatch Queue** — open jobs paired with a suggested technician and a short reason. This is a suggestion only; picking one does not happen here — do the actual assignment on the Dispatch screen.
   - **Overloaded Technicians** — technicians carrying too much.
   - **Activity Timeline** and **Parts Overview.**

**Steps**
1. Scan the top counters for the current state of the operation.
2. Check the **Recommended Dispatch Queue** panel to see which open jobs need a technician and who the system suggests.
3. Switch to **Service > Dispatch** (or the Dispatcher Board) to act on what you found — Control Tower itself has no assign buttons.

**Tips / common problems**
- **A counter or panel looks empty.** There is simply no data in that category right now (for example, no open jobs awaiting dispatch). It is not an error.
- **You can't click to assign from a recommendation.** By design — Control Tower is read-only. Recommendations point you to the Dispatch screen.

**Related**
- Dispatch screen (assign a job to a technician)
- Dispatcher Board (dispatch a scheduled Work Order)
