# Outage Fallback Runbook — Taylor Customer 1

Gate: `C1-CONTINUITY-01` (Taylor interruption fallback). Authority: Verenward +
Taylor.
Status of this document: **drafted from what EOS does; not yet confirmed against
how Taylor actually works. It is not accepted until Taylor has walked it (§7).**

Companion to [`BACKUP_POLICY.md`](./BACKUP_POLICY.md) and
[`RESTORE_TEST_PROCEDURE.md`](./RESTORE_TEST_PROCEDURE.md), which cover data
loss. This document covers the different and far more common problem: the data
is fine, and Taylor cannot reach it.

Scope: what Taylor does during an interruption. Getting the paper back into EOS
afterwards is the post-outage reconciliation procedure, which this document
hands off to at §6 and does not duplicate.

---

## 1. The failure this exists to prevent

An outage does not stop the work. A technician is already at a customer site
with a compressor apart. The failure mode is not "EOS is down for two hours" —
it is "EOS was down for two hours and nobody wrote down what happened," which
turns a two-hour outage into a permanent hole in the operational record.

So every procedure below has the same shape:

1. **Confirm it is actually an outage** (§3) — a fallback started on a bad
   phone signal costs more than it saves.
2. **Keep working on paper** (§5) — the job still gets done.
3. **Capture the same fields EOS would have captured** (§4) — this is the part
   that gets skipped under pressure, and it is the only part that matters later.
4. **Hand the paper to reconciliation** (§6) — an uncollected paper record is
   the same as no record.

The single rule, and the one to put on the paper form itself:

> **Write it down as if EOS were watching. If it was not written down, it did
> not happen, and nobody will be able to reconstruct it a week later.**

---

## 2. Roles during an outage

| Role | Who | Responsibility during an outage |
|------|-----|-------------------------------|
| **Outage lead** | `PENDING-TAYLOR-LEAD` — one named Taylor person, with one named backup | Declares the outage, tells everyone, decides fallback is on, declares it over, owns the paper until reconciliation takes it |
| **Dispatcher** | Whoever is dispatching that day | Runs §5.1; holds the day's schedule on paper |
| **Technician** | Each technician in the field | Runs §5.2 for their own jobs |
| **Verenward on-call** | `PENDING-OWNER-ONCALL` — contact route and expected response window | Diagnoses and restores EOS; tells the outage lead when it is back |

Exactly one person declares the outage and exactly one declares it over. Two
people making that call independently is how half the crew ends up on paper and
half in the app, writing conflicting records of the same job.

---

## 3. Declaring an outage

Not every failure is an outage. Check in this order — the first three take under
a minute and rule out the common causes.

1. **Is it one device?** Have a second person on a different device and network
   try. One device failing is a device problem, not an outage.
2. **Is it the network?** A technician on bad cell coverage sees something that
   looks identical to a total outage. Confirm from a known-good connection.
3. **Is it one screen or everything?** One page erroring while the rest of EOS
   works is a defect to report, not an outage. Keep using the rest.
4. **Otherwise it is an outage.** The outage lead declares it, notifies everyone
   on the `PENDING-TAYLOR-NOTIFY` channel, contacts Verenward on-call, and
   starts the outage log (§4.1).

Declare early. The cost of ten minutes of unnecessary paper is trivial next to
the cost of an hour of work nobody recorded.

### 3.1 Partial outages

If EOS reads but will not save, treat it as a **full** outage for anything that
writes. A save that appears to succeed and does not persist is worse than an
outright failure, because nobody writes it down. Reading the schedule from a
still-working screen is fine and encouraged — copy it onto paper immediately,
while it is still readable.

---

## 4. What gets written down

### 4.1 The outage log — one per outage, held by the outage lead

    OUTAGE LOG
    Declared by:                    Date/time declared:
    What was observed (symptom):
    Checks from §3 that were run:
    Verenward on-call notified at:        By whom:
    Who was told fallback is on, and how:
    People working on paper (names):
    Declared over by:               Date/time over:
    Paper handed to reconciliation on:    Received by:

### 4.2 Field capture rules

These apply to every paper record below and are what make reconciliation
possible instead of guesswork:

- **Real clock times, written when the thing happened.** Not reconstructed at
  the end of the day. Arrival and departure times reconstructed from memory are
  the single largest source of wrong labor records.
- **Identify records the way EOS does.** Work order number, customer name, unit
  or serial number, part number. "The Smith job" is not an identifier; there may
  be four.
- **Name yourself on every sheet.** The person who did the work is the only one
  who can answer a reconciliation question about it.
- **Write what you did not do, too.** A part you needed and did not have, a
  signature you could not collect. Absences do not survive memory.
- **Keep the sheet even if the job was abandoned.** An abandoned job is an
  operational fact.

Paper form templates live in `PENDING-TAYLOR-FORMS` — where the blank forms are
physically kept, and who is responsible for a stocked supply in each truck and
at the office. A runbook that assumes a printer works during an outage has not
thought about outages.

---

## 5. Fallback procedures per operation

The operations below are the ones EOS covers that cannot wait out an outage.
Which of these is in Taylor's Day-1 scope is `PENDING-TAYLOR-DAY1`; that scope
is frozen by gate `C1-SCOPE-01`, not by this document. Anything not on that
list, and anything not listed here at all — reporting, invoicing, quoting,
purchasing approvals, master-data edits — **waits for EOS to come back.** Do not
build a paper shadow of the whole system. The narrower this list stays, the more
likely the paper actually gets filled in.

### 5.1 Dispatch and scheduling — dispatcher

Losing the schedule is the failure that stops everything else, because nobody
knows where to go.

1. If any screen still reads, print or hand-copy today's and tomorrow's schedule
   immediately. Do this first, before diagnosing anything.
2. If nothing reads, rebuild the day from the last known copy — see
   `PENDING-TAYLOR-SCHEDCOPY`, the standing arrangement that guarantees a copy
   of the day's schedule exists outside EOS.
3. Run dispatch by phone. For every assignment made or changed, record: work
   order number (or `NEW` plus customer and description if it does not exist
   yet), technician, customer, site, time assigned, and what the technician was
   told.
4. Keep one master sheet. The dispatcher's sheet is the authoritative record of
   the outage's dispatch decisions; technicians' sheets record execution.
5. New calls arriving during the outage get a paper intake line — customer,
   contact, site, problem, urgency, time received. These have no work order
   number yet, and reconciliation creates it.

### 5.2 Technician work execution — technician

The work continues. Only the recording changes. Per job, on one sheet:

- Work order number (or the customer and site if dispatched as `NEW`).
- Arrival time and departure time, written at the time.
- Equipment worked on, identified by unit or serial number.
- What was found, what was done, and whether the job is complete or needs a
  return visit.
- Parts used (§5.3).
- Customer signature or acknowledgement if the job would normally take one —
  and if it cannot be collected, write down that it could not, and why.

Do not wait for EOS to come back before starting a job. Do not re-key from
memory later — reconciliation works from the sheet.

### 5.3 Parts consumption — technician

The parts you take off the truck during an outage are invisible to inventory
until someone writes them down. This is the record most often lost, and it is
the one that makes the next technician arrive without the part they were told
was in stock.

Per job: part number, quantity, and which truck or location it came from. If the
part number is not legible or known, describe the part and record the equipment
it went into — an ambiguous line reconciliation can chase beats a missing one.

### 5.4 Receiving — whoever receives

Do not turn a delivery away because EOS is down. Sign for it, keep the packing
slip, and write on the slip: date and time received, who received it, and where
the goods were physically put. The packing slip plus that annotation is the
receiving record; it goes into the outage paper pile intact rather than being
summarized onto another sheet.

### 5.5 What explicitly waits

Anything financial or authority-bearing: invoicing, payment, credit decisions,
pricing changes, user or permission changes, purchase-order approvals. These
have no safe paper fallback because there is no way to check on paper what the
system would have checked. They wait. If one genuinely cannot wait, it is an
Owner decision at the time, not a procedure written in advance.

---

## 6. When EOS comes back

1. Verenward on-call tells the outage lead EOS is available.
2. The outage lead confirms independently — a login and a real read on a device
   that had failed — before telling anyone else.
3. The outage lead declares the outage over on the same channel used to declare
   it, and states plainly: **stop writing on paper, do not start entering the
   backlog yet.**
4. The outage lead collects every sheet, counts them against the list of people
   who were working on paper (§4.1), and completes the outage log.
5. The paper goes to the post-outage reconciliation procedure, which is where
   entry happens and in what order.

Step 3 matters. Uncoordinated catch-up entry — several people typing in the same
outage's work at once — produces duplicate work orders and double-counted parts,
and it is a self-inflicted wound after the outage is already over.

---

## 7. How this becomes real

This runbook is written from what EOS does. It is not yet grounded in how Taylor
actually operates, and until it is, it is a draft that reads well rather than a
procedure that works.

To close `C1-CONTINUITY-01`, this must be:

1. Resolved on every pending-decision key in §8 —
   several are names of people and physical arrangements, and no procedure works
   without them.
2. **Walked once by Taylor, not merely read** — a dispatcher and a technician
   run §5.1 and §5.2 on a real job with EOS pretend-unavailable. Every question
   they have to ask is a defect in this document; fix it and note it.
3. Paired with the post-outage reconciliation procedure, since §6 hands off to it
   and a fallback with no way back in is half a procedure.

The test of this document is the one in the lane charter: another person can
execute it without asking the author a question.

---

## 8. Pending decisions

| Key | Decision needed | Authority | What it blocks |
|-----|-----------------|-----------|----------------|
| `PENDING-TAYLOR-LEAD` | Who declares an outage, and their named backup. | Taylor | §2, §3 — no procedure starts without this |
| `PENDING-TAYLOR-NOTIFY` | The channel that reaches everyone in the field when EOS is down, and that does not depend on EOS. | Taylor | §3.4, §6.3 |
| `PENDING-OWNER-ONCALL` | The Verenward on-call contact route and expected response window. | Owner | §2, §3.4, §6.1 |
| `PENDING-TAYLOR-FORMS` | Where blank paper forms are kept and who keeps them stocked in trucks and at the office. | Taylor | §4.2 — assumes no working printer |
| `PENDING-TAYLOR-SCHEDCOPY` | The standing arrangement guaranteeing a copy of the day's schedule exists outside EOS. | Taylor | §5.1 step 2 |
| `PENDING-TAYLOR-DAY1` | Which of the §5 operations are in Taylor's Day-1 scope. | Taylor + Verenward, via gate `C1-SCOPE-01` | Which fallback procedures are launch-critical |
