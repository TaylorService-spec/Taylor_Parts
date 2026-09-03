# Technician — Recording parts used on a Work Order — EOS User Guide

**Audience:** technicians recording parts used in the field
**Applies to:** Work Order → Execution capture → **Parts Used**
**Training represents:** Decision #168 (merged)
**Effective date:** 2026-09-02
**Environment:** none — **this behaviour is NOT ACTIVE in any environment**
**Owner:** Verenward product training

> **READ THIS FIRST — NOTHING HAS CHANGED FOR YOU YET.**
>
> The behaviour described here is built and merged but **switched off**. Today, recording parts used
> works exactly as it always has: **+** and **−** per planned part, and nothing asks you where the
> part came from.
>
> This guide exists so the procedure is written down before it is switched on, not because you need
> to do anything differently now. **Do not train against it yet.** See *Verification receipt*.

## What this guide will help you do

Record which parts you actually used on a job — and, once this is switched on, **where each part came
from**.

## Why EOS will ask where the part came from

Today EOS knows a part was used but not where it left from, so the stock stays counted as if it were
still on the shelf. Someone else can then be promised a part that is already fitted to a customer's
machine.

Saying where it came from is what stops that. It is one answer per part, and often EOS already knows
it and will not ask at all.

## Normal workflow (once active)

1. Open your Work Order and go to **Parts Used**.
2. Press **+** for each unit of a planned part you fitted.
3. **If the parts were picked for this job**, EOS already knows the source and shows it — for example
   *Source: Phoenix Warehouse — from Work Order pick*. Nothing more to do.
4. **If EOS does not know**, it asks for an **Inventory source** before it will record the usage.
   Choose where the part actually came from — a warehouse, or your truck.
5. The usage is recorded and the stock leaves that location.

## When you must change the source

**Change the source when the part did not come from where EOS thinks it did.** The most common case:
parts were picked for the job at a warehouse, but you fitted an equivalent unit **already on your
truck**. Select your truck.

This matters. If you leave the warehouse selected, EOS removes stock from a shelf that still has it,
and the unit on your truck stays counted as available. Both numbers end up wrong.

Changing the source does not erase the pick record — it stays as the record of what was gathered.

## Serialized units

For a serialized unit EOS uses the unit's own recorded location and **does not ask you**. There is
nothing to select.

If EOS does not know where a serialized unit currently is, it will not let the usage be recorded.
That is deliberate: guessing would put a specific, tracked unit in the wrong place. Contact your
Taylor EOS Administrator.

## Correcting a mistake

Press **−** to reduce a quantity you recorded by mistake.

EOS returns the stock **to wherever it originally came from**. You are not asked to choose — and that
is on purpose, because choosing would let a correction move stock somewhere it had never been.

You cannot give back more than was recorded as used. **A correction is not a parts return** — if a
part is genuinely going back to a supplier or a customer is returning one, that is a different
process.

## Warnings and exceptions

- **"Select where this part came from before recording usage."** EOS has no pick record for this
  part. Choose the source and try again.
- **"This part was picked from more than one place."** The job was picked from two locations, so EOS
  will not guess which units you fitted. Choose the one you actually used.
- **"That inventory location is not available for this job."** The location you chose is not one you
  are permitted to use for this job.
- **Do not pick a location just to clear the message.** A wrong source is worse than a delayed entry:
  it makes two stock figures wrong instead of one, and nothing later will detect it.

## If something looks wrong

Check the source shown against where you physically took the part from. If they differ, change it. If
you cannot record usage at all, or a serialized unit is refused, contact your Taylor EOS
Administrator — do not work around it.

## Changes in this release

- **New:** where a part came from is recorded when usage is recorded.
- **New:** EOS fills the source in automatically when the parts were picked for the job.
- **New:** you can change the source when the part actually came from elsewhere, including your truck.
- **New:** reducing a recorded quantity returns the stock to its original source automatically.
- **Unchanged:** who may record usage, and the **+**/**−** interaction itself.
- **Known limitation:** the source picker requires location-selection authority that does not yet
  exist for technicians. **This is why the feature is off.**

## Verification receipt

- Training checked against deployed release/SHA: **NOT DEPLOYED, AND NOT ACTIVE.**
- Workflow exercised/visually verified: **NO.** `PHYSICAL_CONSUMPTION_ACTIVE = false`, so the
  workflow described here cannot be exercised anywhere — not even in sandbox.
- Screenshots current where used: not applicable — none used.
- Known sandbox-only or future behavior present in guide: **YES — the entire guide.**
- Training status: **DRAFT — PENDING AUTHORITY.** It cannot become `DRAFT — PENDING DEPLOYMENT
  VERIFICATION` until `CONSUMPTION_SOURCE_SELECTION_AUTHORITY_REQUIRED` is ruled and the feature is
  activated, and cannot become `COMPLETE` until it is verified against a real deployment.
