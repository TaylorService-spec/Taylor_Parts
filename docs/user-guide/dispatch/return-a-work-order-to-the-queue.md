# Return a work order to the queue

Sometimes a job you scheduled needs to come off the calendar — the customer pushed it, the part did
not arrive, the day fell apart. This puts the work order back in **Ready to schedule** so anyone can
place it again, without cancelling it and starting over.

**Who can do this:** dispatchers and administrators.

## Before you start

You can only do this while the work order is still **Scheduled**. Once you have dispatched it to a
technician, the job is committed — the button is not there any more. If you need to stop a dispatched
job, cancel it instead, and that is a different decision.

## Steps

1. Open the work order.
2. In the action row, choose **Return to queue**.
3. Type why. This is required — a one-line note like "customer moved to next week" or "compressor
   backordered" is enough.
4. Choose **Return to queue** to confirm, or **Keep the schedule** to back out.

The work order goes straight back to **Ready to schedule**, and the technician and time you had
chosen are cleared.

## What happens to the old schedule

The technician and time are removed from the work order itself, so the calendar frees up immediately
and that technician's slot is available to someone else.

They are **not** lost. The previous technician, the previous time, who returned it, when, and the
reason you typed are all kept in the work order's audit record. Nobody has to reconstruct what
happened from memory.

## If something goes wrong

**"Return to queue" is not showing.** The work order is probably past **Scheduled** already — check
the status at the top. It only appears on a scheduled job, and only for dispatchers and
administrators.

**The confirm button stays greyed out.** The reason box is empty. Type something and it will enable.

**You get an error after confirming.** Someone else may have moved the job while you had it open.
Reload the work order and look at where it actually stands before trying again.

## Related

- [Schedule work orders](./schedule-work-orders.md)
- [Dispatch a work order on the dispatcher board](./dispatch-a-work-order-on-the-dispatcher-board.md)
- [Move a work order through its lifecycle](../work-orders/move-work-order-through-lifecycle-dispatcher.md)
