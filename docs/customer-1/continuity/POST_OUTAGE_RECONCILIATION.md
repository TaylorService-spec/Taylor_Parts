# Post-Outage Reconciliation Procedure — Taylor Customer 1

Gate: `C1-CONTINUITY-01` (Taylor interruption fallback). Authority: Verenward +
Taylor.
Status of this document: **drafted from what EOS does; not yet confirmed against
how Taylor actually works. It is not accepted until Taylor has walked it (§8).**

Companion to [`OUTAGE_FALLBACK_RUNBOOK.md`](./OUTAGE_FALLBACK_RUNBOOK.md), which
covers what Taylor does *during* an interruption and hands off to this document
at its §6. This document starts where that one stops: EOS is back, the work is
done, and it exists only on paper.

Scope: getting outage paper into EOS correctly, and proving it got there. Data
loss from a disaster is a different problem, covered by
[`BACKUP_POLICY.md`](./BACKUP_POLICY.md) and
[`RESTORE_TEST_PROCEDURE.md`](./RESTORE_TEST_PROCEDURE.md).

---

## 1. The failure this exists to prevent

The outage ends and everyone feels finished. The work was done, the customer is
happy, and the paper goes in a pile on a desk. Two weeks later inventory is
wrong, a job was invoiced twice, and one work order was never entered at all.

Reconciliation is not data entry. It is data entry plus an accounting: **every
sheet that was written is either entered or explicitly written off, and someone
can say which.** A sheet nobody can account for is the same defect as a sheet
nobody entered.

Three rules govern everything below:

> **One entrant per record.** Two people entering the same outage produce
> duplicates, and duplicates are harder to remove than the original entry was to
> make.
>
> **The sheet is the source, not memory.** If the sheet does not say it,
> reconciliation does not invent it — it raises a question (§6).
>
> **Entry time is not event time.** Recording a job entered Thursday as having
> happened Thursday, when it happened Tuesday, corrupts labor, response-time,
> and inventory history permanently. See §4.

---

## 2. Entry conditions

Do not start until all of these are true:

1. The outage lead has **declared the outage over** and independently confirmed
   EOS reads and writes (`OUTAGE_FALLBACK_RUNBOOK.md` §6).
2. Every sheet has been **collected and counted** against the list of people who
   were working on paper, recorded in the outage log §4.1.
3. A **reconciliation owner** is named for this specific outage —
   `PENDING-TAYLOR-RECON-OWNER`. One person owns the whole reconciliation even
   when several people do the typing.
4. Nobody has started entering anything yet.

If sheets are missing, do not wait for them. Start §3 with what exists, and open
a line in the reconciliation log (§7) for each person whose sheets have not
arrived. A missing sheet is a tracked gap, not a reason to stall.

---

## 3. Order of entry

Order is not a preference. Each step below creates the records the next step
attaches to, and doing them out of order produces orphaned entries that have to
be redone.

### 3.1 Work orders first — reconciliation owner or dispatcher

Work from the dispatcher's master sheet, which is the authoritative record of
what was dispatched.

1. For every job dispatched against an **existing** work order number: confirm
   the work order still exists in EOS and is in the state the sheet implies.
2. For every paper intake line and every job dispatched as `NEW`: **check first
   whether a work order already exists** for that customer and site in that time
   window. Someone may have created one before the outage, or after it and
   before reconciliation started. Create only if none exists.
3. Write the new EOS work order number back onto the paper sheet. From here on,
   the sheet carries the identifier that ties paper to system, and every later
   step depends on it.

No technician sheet is entered until its work order number exists on the sheet.

### 3.2 Work execution — the technician who did the work

Each technician enters their own jobs, from their own sheets. This is slower
than handing the pile to one person and it is worth it: the technician is the
only one who can resolve an illegible line or a missing time without guessing.

Per sheet, enter arrival and departure times, equipment worked on by unit or
serial number, findings and work performed, and completion state. If the sheet
says a return visit is needed, create it in EOS as part of entry, not later.

Where a customer signature could not be collected during the outage, do not
enter one. Record that it was not collected and why — the sheet says why.

### 3.3 Parts consumption — after 3.2

Parts posted against a work order that does not exist yet, or against the wrong
one, are the hardest error to unwind. Post parts only after §3.2 for that job.

Per line: part number, quantity, and the truck or location it came from. For a
line that describes a part rather than naming a number, the reconciliation owner
resolves it to a real part number before posting — with the technician, using
the equipment it went into. An unresolvable line goes to §6; it is not posted as
a guess and it is not silently dropped.

After all parts are posted, whether a physical count of the affected trucks is
required — and above what outage length — is `PENDING-TAYLOR-INVCOUNT`.
Consumption recorded on paper under pressure is the least reliable record the
outage produces, and it is the one that determines whether the next technician
finds the part.

### 3.4 Receiving — independent of the above

Enter from the annotated packing slips. What was received, when, who received
it, and where it was physically put. Receiving does not depend on work-order
entry and can run in parallel with §3.1 through §3.3 if a second person is
available.

### 3.5 Everything that waited

Work deliberately deferred during the outage — invoicing, payments, pricing,
approvals, permission changes (`OUTAGE_FALLBACK_RUNBOOK.md` §5.5) — is done
normally in EOS once §3.1 through §3.4 are complete for the jobs it touches.
Invoicing a job whose parts have not been posted invoices the wrong amount.

---

## 4. Event time versus entry time

Every record entered here happened before it was entered. That gap is the
outage, and it is the thing most likely to be recorded wrongly.

Whether EOS accepts an event time distinct from the entry time, on which record
types, and who is permitted to set it, is `PENDING-OWNER-BACKDATE`. This is a
statement about the system, to be confirmed by Verenward — not a Taylor
preference and not something this document may assume.

Until it is confirmed, reconciliation follows the safe rule: **enter the real
times from the sheet in the record's own time fields where EOS has them, and
where it does not, state the real date and time in the record's notes in
addition to whatever timestamp EOS assigns.** A note is a poor substitute for a
correct field, and it is far better than a silently wrong history.

Every record entered during reconciliation is marked as outage-entered, so a
later reader can tell reconstructed history from live history. The mechanism —
a note convention, a tag, or a field — is `PENDING-OWNER-OUTAGEMARK`.

---

## 5. Proving it is done

Reconciliation is complete when the reconciliation owner can show, per sheet:

| Check | What proves it |
|-------|----------------|
| Every collected sheet is accounted for | Each sheet is marked with its EOS work order number, or written off with a reason (§6) |
| Sheet count matches the outage log | The §4.1 people-on-paper list has no name whose sheets were never collected or explained |
| Each entered job exists once | The work order was opened and read back in EOS after entry — not assumed from a save that appeared to succeed |
| Parts are posted or escalated | Every parts line is posted, or is an open question in §6 |
| Deferred work is released | Nothing from §3.5 is still waiting on reconciliation |

The middle row is the point of the whole procedure. "I entered everything" is a
claim; a sheet count that reconciles is evidence. Consistent with this lane's
standing rule, a completed entry is not proof of a correct entry — the record is
read back in EOS, not inferred from the act of saving it.

---

## 6. Questions, conflicts, and write-offs

Three things reconciliation will hit, and what happens to each:

- **An illegible or ambiguous line.** Goes back to the person who wrote it. If
  they cannot resolve it either, it becomes a write-off with a stated reason —
  entered as a note on the work order, not as invented data.
- **A conflict between two sheets** — the dispatcher's master sheet and a
  technician's sheet disagree. The technician's sheet governs what was *done*;
  the dispatcher's sheet governs what was *assigned*. If they cannot both be
  true, the reconciliation owner decides and records the decision and its
  reason.
- **Anything financial, authority-bearing, or customer-facing** that cannot be
  resolved from the sheets — an amount, a commitment made verbally to a
  customer, a credit. The reconciliation owner does not decide these. They are
  escalated to Taylor management, and reconciliation records the escalation
  rather than blocking on it.

Nothing is discarded quietly. A write-off is a recorded outcome with a name and
a reason attached.

---

## 7. The reconciliation log

One per outage, filed with that outage's outage log. It is the artifact that
turns "we caught up" into something checkable a month later.

    RECONCILIATION LOG
    Outage log reference:                 Reconciliation owner:
    Started:                              Completed:
    Sheets collected (count):             From whom:
    Sheets expected but not received:     Why:
    Work orders created during entry:
    Work orders matched to existing:
    Parts lines posted:                   Parts lines escalated:
    Receiving records entered:
    Write-offs (sheet, reason, decided by):
    Escalations raised (what, to whom, outcome):
    Deferred work released (§3.5):
    Signed off by:                        Date:

How long the paper sheets are kept after entry is
`PENDING-TAYLOR-PAPER-RETENTION`. The reconciliation log itself is kept for as
long as the outage it describes could be questioned; the paper it summarizes may
have a shorter life.

The reconciliation must be finished within `PENDING-TAYLOR-RECON-WINDOW` of the
outage being declared over. Paper decays fast — not physically, but in the
memory of the person who wrote it, which is what resolves every ambiguous line
in §6.

---

## 8. How this becomes real

Like its companion runbook, this is written from what EOS does and is not yet
grounded in how Taylor operates.

To close `C1-CONTINUITY-01`, this must be:

1. Resolved on every pending-decision key in §9.
2. **Walked once by Taylor, not merely read** — the same simulated outage used
   to walk `OUTAGE_FALLBACK_RUNBOOK.md` §7 produces real paper, and that paper
   is reconciled through this procedure end to end. Reconciling invented sheets
   proves nothing; the walk is only meaningful if it consumes the output of the
   fallback walk.
3. Checked against the §5 table by someone who was not the entrant. If the
   sheet count does not reconcile in a rehearsal, it will not reconcile in a
   real outage.

Every question the walkers have to ask is a defect in this document.

---

## 9. Pending decisions

| Key | Decision needed | Authority | What it blocks |
|-----|-----------------|-----------|----------------|
| `PENDING-TAYLOR-RECON-OWNER` | Who owns reconciliation after an outage, and their named backup. | Taylor | §2 — reconciliation cannot start unowned |
| `PENDING-TAYLOR-RECON-WINDOW` | The deadline by which outage paper must be entered and the reconciliation signed off. | Taylor | §7 |
| `PENDING-TAYLOR-INVCOUNT` | Whether a physical count of affected trucks follows an outage, and above what outage length. | Taylor | §3.3 |
| `PENDING-TAYLOR-PAPER-RETENTION` | How long outage paper is kept after entry. Related to the open backup-retention question; the answers need not match. | Taylor | §7 |
| `PENDING-OWNER-BACKDATE` | Whether EOS accepts an event time distinct from entry time, on which record types, and who may set it. | Owner / Verenward | §4 — determines whether outage history is recorded correctly or only described in notes |
| `PENDING-OWNER-OUTAGEMARK` | How a record entered during reconciliation is marked as outage-entered. | Owner / Verenward | §4 |
