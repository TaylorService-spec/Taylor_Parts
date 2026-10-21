# Set the company on a record that has none

**Status: built, not yet live in any environment** · Sales > Opportunities and Sales Agreements

A new Opportunity or Sales Agreement can be saved before an operating company is chosen. Until one is
set, only the person who **owns** it, the person who **created** it, the Administrator and the Owner can
see it (see [Which sales records you can see](./which-sales-records-you-can-see.md)). This page is how a
record gets its company afterwards.

## Who can do it

Setting a company is a permission of its own, **Set Operating Company**, and **nobody has it until an
administrator grants it to them by name**. That includes the Administrator and the Owner. If you do not hold it, the
control described below never appears on your screen; ask an administrator.

You also need to be able to **see the record** (you own it, you created it, or you are the
Administrator or the Owner) and to **work for the company you are setting**. You cannot set a company you
do not work for: it is refused as *"operating company ... is not governed in this tenant"*, the same
words as a company that does not exist.

## Set it

1. Open the record. If it has no company and you may set one, a band at the top says
   **Operating company: Not set** and offers **Set operating company**.
2. Choose the company. The list holds only the companies you may choose.
3. Write the **reason** (required, up to 500 characters). It is kept in the audit trail with who did it and when.
4. Choose **Set operating company**. The page reloads with the company set and the band gone.

## What to know before you do it

- **It can be set once.** The company cannot be changed or cleared afterwards, from this screen or
  any other. The screen says so before it asks.
- **After it is set, the normal company rule applies.** People who work for that company can see the
  record. Its owner keeps it **only if they work for that company too**. The company you set must be one the
  record's **creator** works for (or has been given access to), and this applies to everyone, including the
  Administrator; otherwise the system refuses and nothing is saved.
- **An agreement always carries its opportunity's company.**
  - Setting the company on an **Opportunity** also gives it to the Opportunity's Sales Agreement **if the
    agreement has none**, in the same step. The result lists the agreement, and the agreement gets its own
    audit entry ("inherited from Opportunity ..." with your reason). Nothing else about the agreement changes.
  - An agreement that **already has the same company** is left exactly as it is.
  - An agreement that has a **different** company stops the whole change: nothing is saved, and the message
    says so (or, if you cannot see that agreement, that the company of a related record cannot be confirmed
    from here: ask someone who can see it).
  - A **Sales Agreement** on its own can be given only its Opportunity's company, and only once the
    Opportunity has one; otherwise the system refuses and says to set the Opportunity first.
- **Sales Orders always have a company**, so there is nothing to set on them.

## What the system refuses

| You see | Why |
| --- | --- |
| No "Set operating company" band | The record already has a company, you do not hold the permission, no company is open to you, or (for an agreement) its Opportunity has no company yet. |
| *The Opportunity / Sales Agreement does not exist* | You cannot see the record. This is the same answer as a record that is not there. |
| *This record already has an operating company* | Someone set it first (two people trying at once: exactly one succeeds). It is not changed. |
| *This Sales Agreement's Opportunity has no operating company yet ...* or *... is in operating company X, not Y* | An agreement and its opportunity must agree. Set the Opportunity first, then the agreement to the same company. |
| *This Opportunity's Sales Agreement is already in ...* or *the company of a related record cannot be confirmed from here* | The agreement already has a different company. Nothing is saved or overwritten. Choose the agreement's company, or ask someone who can see it. |
| *The person who created this record does not work in that company ... needs a separate decision* | You can only set a company that the record's **creator** works for (or holds access to), even if you are the Administrator. Moving a record into any other company is a separate decision this screen does not make; nothing is saved. |
| *Say why the operating company is being set* | The reason is required. |

A refused attempt changes nothing and leaves no record, number or audit entry. If a click is repeated
(for example after a dropped connection), the second one is recognised and does not apply twice.
