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
  Being assigned a job lets the technician do the field work on that job only (see it, accept it, travel,
  arrive, work it, record parts and time, install equipment, complete it). It does not let the technician
  schedule, dispatch, cancel or bill it, and it does not put another company's job into the office lists.
  An assignment that has ended or moved to someone else no longer opens the job.
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

## A seller sees the progress of the work done for its sale

When one company sells and another company does the service work under the seller's service-provider
authorization, the seller can open a **read-only view** of that work from its own sales order. It shows
the work order number, the sales order, the company doing the work, the type of service, the status, the
scheduled window, how far along it is, and the outcome the customer is told about. It does **not** show
technician notes, labor rates or costs, restricted attachments, security details or the servicing
company's finances, and the seller cannot change, schedule, dispatch, reassign, complete or cancel the work.
The same read-only line appears on the seller's coordinated visits list while the authorization is active.
It is shown only for work orders linked to that sales order, never for a customer's other work, and only while the authorization is active and covers that type of work: once it is revoked or narrowed, the seller no longer sees that work.

## The Administrator and the Owner

The Administrator can **read** work orders for every company in the tenant (Taylor and Ventana alike):
the work order list, the Service Office list, the technician picker, schedule views, reports, search and
the detail page. What the Administrator can **change** is unchanged: every action still needs its own
permission, the same lifecycle rules, and the same company limits it had before. The Owner follows the
companies it has been given through governed company access.
