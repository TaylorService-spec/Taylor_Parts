# Which sales records you can see: your company comes first

**Status: built, not yet live in any environment** · Sales > Opportunities, Sales Agreements, Sales Orders

Taylor and Ventana run on the same system, but a sales record belongs to **one operating company**.
What you can see and change is decided in this order: first whether your role allows the action at
all, then **whether the record is in a company you work for**, and only then your sales channel
(for example Retail or National Accounts).

## What you will notice

- **A record of another company simply is not there.** It is missing from lists and counts, and if
  you open a link to it the page says it does not exist. This is deliberate: the system never
  confirms that another company's deal, agreement or order exists.
- **The same applies to changing things.** Editing, moving, accepting, approving a trade-in value or
  advancing an order for a record in another company is refused as "does not exist". Nothing is
  saved, numbered or logged for the attempt.
- **You cannot start a record in a company you do not work for.** Choosing one is refused with
  *"operating company ... is not governed in this tenant"*, the same words as a company that does
  not exist.
- **National Accounts is a sales channel, not a company.** Holding the National Accounts channel
  never lets you see another company's record.
- **The same rule applies everywhere a record can appear:** the site-wide search (a record of another company is not found, and neither is any text inside it), "Records I own" and "Records I am accountable for" on My Work, an employee's owned-records and accountability lists, the sales order reference shown on a coordinated visit, and the opportunity or sales order you link a customer note to.
- **A record you can see never reveals another company's record it is linked to.** If a record with no company yet points at an opportunity, agreement or order of a company you do not work for, that link is simply not shown: no number, status or customer detail, and the same on customer notes.
- **An agreement always carries its opportunity's company.** You cannot give an agreement a different company from the opportunity it comes from.
- **Everything in your own company works as before.** Your role and channel limits still apply
  inside it.

## Which companies are yours

Your own company is the one on your employee record. An administrator can give you additional
companies (an explicit company-access grant) or assign you a role at another company. If a deal you
expect is missing, ask an administrator which companies your sign-in reaches; do not look for a
setting on the screen.

## Records with no company yet

A new Opportunity or Sales Agreement can be saved before a company is chosen. Until one is set, it is
visible only to the person who **owns** it, the person who **created** it, the Administrator and the
Owner. Everyone else, even in the same company, will not see it. Once a company is set, the normal
company rule above applies and the owner and creator keep access only if they work for that company.
Sales Orders always have a company.

## Administrators and the Owner

The protected Administrator sees and can act on every company's records, exactly as before. The
Owner sees the records of the companies the Owner works for, plus any record that has no company yet.

## Stock allocation follows the same rule

If you cannot see a Sales Order, you cannot allocate stock to it or see its allocations either: it
reads as *"no such Sales Order"* there too.
