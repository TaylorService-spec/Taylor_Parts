# Which work orders you can see: your company comes first

**Status: built, not yet live in any environment** · Service > Work Orders, the Dispatcher Board, My Work, Search, coordinated visits

Taylor and Ventana run on the same system, but a work order belongs to **one operating company**. What
you can see and do is decided in this order: first whether your role allows the action at all, then
(for a technician) whether the job is **assigned to you**, and then **whether the work order is in a
company you work for**.

## What you will notice

- **A work order of another company simply is not there.** It is missing from the work order list, the
  Dispatcher Board, a technician's assigned work, search results (and the words inside it are not
  searched either), the Employee record's assigned-work list, the coordinated visits list and the
  figures on the dispatch reports. If you open a link to one, the page says **"Work order not found"**,
  exactly as it does for a number that never existed.
- **The same applies to doing things.** Marking ready, scheduling, moving, dispatching, accepting,
  starting travel, arriving, starting work, recording parts or time, planning parts, setting an
  estimate, installing equipment, completing, closing, cancelling and sending a customer a scheduling
  link are all refused as "not found" for a work order in a company you do not work for. Nothing is
  saved, numbered or logged for the attempt.
- **Technicians keep every job assigned to them.** A technician sees and works every work order it is
  assigned to, and every work order of the companies it works for. Nothing a technician legitimately
  does changes. A technician cannot see another company's work orders that are not assigned to it.
- **Coordinated visits show only your companies' work orders.** A work order of another company is
  dropped from the list completely, together with the sales order it belongs to.
- **Everything in your own company works as before.** Your role and your assignments still apply
  inside it.

## Which companies are yours

Your own company is the one on your employee record. An administrator can give you additional companies
(an explicit company-access grant) or assign you a role at another company. If a work order you expect is
missing, ask an administrator which companies your sign-in reaches; do not look for a setting on the screen.

If your sign-in reaches no company at all, work order screens say **"no operating-company authority"**
instead of listing anything.

## Work performed for another company's sale

When a Ventana sale is serviced by Taylor under the seller's service-provider authorization, the
**work order is Taylor's** (the company performing the work) and is seen and worked by Taylor's people.
The authorization lets Taylor create and complete that work against the Ventana sales order; it does not
open Taylor's work order to Ventana's people.

## The Administrator and the Owner

The Administrator's reach on work orders is unchanged. Where the Administrator could already act on any
company's work order, it still can; where the work order list or the scheduling actions were already limited
to the Administrator's own companies, they still are. The Owner follows the companies it has been given
through governed company access.
