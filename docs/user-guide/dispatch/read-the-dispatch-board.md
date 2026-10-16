# Read the Dispatch & Scheduling board

**What this lets you do:** tell at a glance, on each technician's lane, which time is booked, which is still bookable, and which is not. It also covers keeping your place on the board when you leave it and come back.

**Where:** Service → Dispatch Board (`/service/dispatcher-board`). You need the dispatch surface to open it.

## What the lane colours mean

The legend above the board uses the same styles as the lanes.

| On the lane | Meaning | Can you drop work here? |
|---|---|---|
| Dark green chip | **Booked**: a scheduled Work Order. | Drop on an empty spot instead; the server refuses overlaps. |
| Diagonal hatch | **Unavailable**: PTO, training, a meeting, truck service, a closure. Each is a recorded entry, never a Work Order. | No. The drop is refused. |
| Pale fill | **Not working**: the technician's recorded schedule says they are off (before or after the shift, or a break). | No. The server refuses placements outside recorded working hours. To schedule emergency work outside them, a scheduler first records the hours. |
| Dashed lane edge, with **No schedule** in amber under the name | **No schedule recorded** for this person. EOS never assumes default hours. | No. Placements are refused until a schedule is recorded. |
| Grey veil on the left | **Elapsed**: time already past today. | No. A job cannot start in the past. |
| Thin bronze vertical line | **Now**: the current time. It moves each minute. | — |

The line under each name shows that day's recorded hours (for example *7a–4p*), then *% booked* and any blocked hours. *Not working today* means a schedule exists and the person is off that day. *No schedule* means nothing is recorded, so no percentage is shown. A percentage over unknown hours would be invented.

**Week** and **2 weeks** use the same states for whole days: *open*, *off*, *no schedule*, and greyed days already past. On **2 weeks**, each day's percentage is booked time divided by **that day's** available hours.

## Keep your place

The view (Day, Week, 2 weeks), the date and the technician filter are part of the page address. So:
- **Back** from a Work Order returns you to the same day, view and filter.
- Refreshing the page keeps them.
- Copying the address shares exactly what you are looking at.

## Map

**Map · not available** is shown on purpose. No map provider or job-location coordinates are set up in EOS yet, so the button does nothing; hover over it, or use a screen reader, to hear why. Use Day, Week and 2 weeks to schedule.

## Related

- [Schedule work orders](schedule-work-orders.md)
- [Return a work order to the queue](return-a-work-order-to-the-queue.md)
