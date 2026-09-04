# Outage Paper Forms — Taylor Customer 1

Gate: `C1-CONTINUITY-01` (Taylor interruption fallback). Authority: Verenward +
Taylor.
Status of this document: **forms drafted from the fields reconciliation needs;
not yet used by Taylor in a walk (`OUTAGE_FALLBACK_RUNBOOK.md` §7).**

These are the blank forms [`OUTAGE_FALLBACK_RUNBOOK.md`](./OUTAGE_FALLBACK_RUNBOOK.md)
§4.2 assumes exist. That section answers *where the blank forms are kept*
(`PENDING-TAYLOR-FORMS`); it never said what is printed on them. This document
is what is printed on them.

Two log forms are **not** repeated here and are not part of the truck pack:
the outage log lives in `OUTAGE_FALLBACK_RUNBOOK.md` §4.1 and the reconciliation
log in [`POST_OUTAGE_RECONCILIATION.md`](./POST_OUTAGE_RECONCILIATION.md) §7.
Both are held by one named person at the office, not carried in the field.

---

## 1. Why the fields are the ones they are

Every field below exists because some step of post-outage reconciliation cannot
be completed without it. Nothing is here because it seemed useful. That
constraint is checkable, and it is checked:

    node scripts/customer1-continuity/check-forms.mjs

That script fails if a field reconciliation depends on has gone missing from a
form. It proves the forms and the procedures agree with each other. It proves
nothing about whether the forms work in Taylor's hands — only §5 does that.

The header block is identical on all four forms on purpose. Under pressure,
people fill in the top of a page without reading it; making the top of every
page the same means they fill it in correctly.

---

## 2. Printing and stock

- **Print single-sided.** The back of a sheet is where information goes to be
  lost.
- **One job per sheet**, even a ten-minute job. Two jobs on one sheet cannot be
  handed to two different entrants in reconciliation §3.2.
- Keep a stocked supply in every truck and at the office, replenished by whoever
  `PENDING-TAYLOR-FORMS` names. A runbook that assumes a working printer during
  an outage has not thought about outages.
- Print in pads or on a clipboard, not loose. Loose sheets in a truck cab are
  the sheets that never reach the office.

---

## 3. The forms

### 3.1 Header block — the top of every form

    OUTAGE PAPER — <FORM NAME>                    Sheet ____ of ____
    Your name:                                    Date:
    Outage declared at:                           EOS back at (if known):

    WRITE IT DOWN AS IF EOS WERE WATCHING. If it was not written down, it did
    not happen, and nobody will be able to reconstruct it a week later.

    Office use only — reconciliation
    EOS work order no.:            Entered by:            Entered on:

The "office use only" line is filled in during reconciliation §3.1, which writes
the new work order number back onto the sheet. It is the only thing that ties
paper to system afterwards, so it is printed on the form rather than left to a
margin.

### 3.2 Dispatch master sheet — dispatcher, one per outage

The authoritative record of what was assigned. Reconciliation §3.1 works from
this sheet and no other.

    [header block]

    ASSIGNMENTS — one line per assignment made or changed

    WO no. (or NEW)  Technician  Customer  Site  Time assigned  What tech was told
    ______________  __________  ________  ____  _____________  __________________
    ______________  __________  ________  ____  _____________  __________________
    ______________  __________  ________  ____  _____________  __________________

    NEW CALLS RECEIVED DURING THE OUTAGE — these have no WO number yet

    Time received  Customer  Contact  Site  Problem  Urgency  Assigned to
    _____________  ________  _______  ____  _______  _______  ___________
    _____________  ________  _______  ____  _______  _______  ___________

    Schedule copy source (how today's schedule was obtained):
    Sheets handed to reconciliation on:            Received by:

### 3.3 Technician job sheet — one per job

    [header block]

    WO no. (or NEW — customer and site below):
    Customer:                              Site:
    Arrival time (write on arrival):       Departure time (write on leaving):
    Equipment worked on — unit or serial no.:

    What was found:


    What was done:


    Job state:   [ ] Complete   [ ] Return visit needed   [ ] Abandoned
    If return visit or abandoned, why and what is needed:

    Customer signature or acknowledgement:
    If not collected, why not:

    What I needed and did not have:

    Parts used — see parts sheet:   [ ] attached   [ ] none used

Arrival and departure are the two fields written at the moment they happen.
Reconstructed at the end of the day, they are the single largest source of wrong
labor records — which is why they sit at the top, not buried after the
narrative.

An abandoned job still gets a sheet. An abandoned job is an operational fact.

### 3.4 Parts used sheet — one per job, attached to its job sheet

    [header block]

    WO no. (or NEW — customer and site):

    Part no.       Description (if no. unknown)  Qty  From truck/location
    ____________  ____________________________  ___  ___________________
    ____________  ____________________________  ___  ___________________
    ____________  ____________________________  ___  ___________________

    For any line with no part number, the equipment it went into:

If the part number is not legible or not known, describe the part and record the
equipment it went into. An ambiguous line reconciliation can chase beats a
missing one; a blank line is a part that silently leaves inventory and is not
there when the next technician is told it is.

### 3.5 Receiving annotation — written on the packing slip itself

There is no separate receiving form. The annotated packing slip **is** the
receiving record, and it goes into the outage paper pile intact rather than
being summarized onto another sheet — a summary loses the line detail
reconciliation §3.4 enters from.

Write on the slip, legibly, in this order:

    OUTAGE RECEIVING
    Date and time received:
    Received by (name):
    Where the goods were physically put:
    Anything missing, damaged, or not matching the slip:

Do not turn a delivery away because EOS is down.

---

## 4. What has no form, on purpose

Invoicing, payments, pricing changes, credit decisions, purchase-order
approvals, and user or permission changes have no paper form here. Per
`OUTAGE_FALLBACK_RUNBOOK.md` §5.5 they wait, because there is no way to check on
paper what the system would have checked. Printing a form for one of these would
be an invitation to do it.

Do not add a form to this pack without adding the reconciliation step that
consumes it. A form nobody enters is a pile of paper that makes the record look
more complete than it is.

---

## 5. How this becomes real

These forms close no gate on their own. They become real when:

1. `PENDING-TAYLOR-FORMS` is resolved — where the pads are kept and who keeps
   them stocked. Forms that exist only in this repository are not forms.
2. They are **used, not read**, in the Taylor walk of `OUTAGE_FALLBACK_RUNBOOK.md`
   §7 — a dispatcher and a technician fill these in on a real job with EOS
   pretend-unavailable.
3. The paper that walk produces is reconciled through
   `POST_OUTAGE_RECONCILIATION.md` §3. Any field the entrant needed and the form
   did not have is a defect in this document; add it and re-run the §1 check.

The forms are the part of the fallback Taylor actually touches. Every other
document in this lane is read once; these are held in a truck.
