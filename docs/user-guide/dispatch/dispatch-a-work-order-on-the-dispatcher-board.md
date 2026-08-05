# Dispatch a Work Order (Dispatcher Board)

**What this lets you do:** Review the Work Order queue with technician recommendations, then send a scheduled Work Order to the technician you choose.

**Who can do it:** Admin and Dispatcher. (Technicians do not see the Dispatcher Board.)

**Before you start**
- Open **Service > Dispatcher Board** from the left navigation.
- At least one Work Order must exist. If none do, create one from the Work Orders tab first — the board shows a "No work orders exist yet" message otherwise.
- Only Work Orders in **SCHEDULED** status can be dispatched here. Others still appear in the queue but cannot be dispatched from this screen.

**Understanding the layout**
The board has three columns:
- **Work Order Queue** (left): every Work Order, with its status, priority, customer, type, age, and — if unassigned — a starred recommended technician.
- Center pane: details of the selected Work Order plus the **top 3 recommended technicians** and a **Dispatch to…** control.
- **Technicians** (right): every technician with a capacity card and, once a Work Order is selected, a match score.

**Steps**
1. (Optional) Narrow the list. Use the search box to match a Work Order number, customer, or type, and the status dropdown to filter (for example, choose **SCHEDULED** to see only dispatchable ones).
2. Click a Work Order card in the queue. Its details load in the center pane. You can also move through the queue with the Up/Down arrow keys, or press Escape to clear the selection.
3. Review the recommendations. In the center pane, click any of the top-3 technicians to expand a score breakdown (workload, past similar assignments, availability, territory).
4. Dispatch it, one of two ways:
   - **Pick from the list:** in the center pane, open **Dispatch to…**, choose a technician, and click **Dispatch**. The button reads "Dispatching…" while it saves.
   - **Drag and drop:** drag the Work Order card from the queue onto a technician column on the right. Only valid target columns highlight as you drag.
5. When it succeeds, the board refreshes on its own and the Work Order shows its new status and assigned technician.

**Tips / common problems**
- **No Dispatch control appears and the columns won't accept a drop.** The selected Work Order is not SCHEDULED. The pane tells you its current status; only SCHEDULED Work Orders can be dispatched here.
- **You get a red banner "Cannot dispatch …: only SCHEDULED work orders can be dispatched."** Same cause — the status changed or you selected a non-scheduled order.
- **Drag-and-drop won't work on a phone or by keyboard.** That's expected. Use the **Dispatch to…** picker instead — it does exactly the same thing.
- **The "Recent Activity (this session)" strip empties when you reload.** It only tracks changes made during your current session; it is not a permanent history.

**Related**
- Dispatch screen (a simpler one-click job-to-technician assignment)
- Control Tower (read-only overview and recommended dispatch queue)
