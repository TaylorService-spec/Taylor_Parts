# Equipment Installation Recording Policy

**Owner decision, 2026-08-23. Settled.**

---

## The decision

An equipment installation may be recorded by **either**:

1. an authorized **Field/Service Manager**, through the general Equipment → Available Equipment
   workflow; or
2. an authorized **Technician**, as part of the Work Order completion/closeout workflow.

Authority is governed by **`equipment.install`** — not by job title, not by which screen someone can
reach, and not by which application they are using.

## What this closes

It answers the question raised by `TECHNICIAN HOLDS INSTALL CAPABILITY / EQUIPMENT DOMAIN UI NOT
EXPOSED`: *does the person who physically installs the machine record the installation, or does
someone else record it on their behalf?*

**Both, depending on who is there.** The two technicians holding `equipmentInstaller`
(cw-emp-013, cw-emp-017) keep their grants and gain a path to use them — through the Work Order they
are already working, not through the Equipment management surface.

## The access consequence, stated as an invariant

> Holding `equipment.install` does **not** grant general Equipment navigation, arbitrary Equipment
> customer search, or full installed-base reads.

A technician does not need the Equipment domain to record an installation. The Work Order already
knows the customer and the location; the only thing the technician supplies is **which machine**.

So the technician path exposes exactly:

- their own Work Order
- the installable serialized assets that workflow requires
- the resulting Equipment context needed to finish the job

and nothing else. Field/Service Managers retain the broader Equipment management surface, because
managing an installed base is genuinely their job.

This is a **reduction** in access relative to the manager path, not an expansion. The technician
never sees a customer picker, because the Work Order owns the customer.

## One authority, two entry points

Both paths invoke the **same** `installSerializedAsset` command. There is no second install
implementation, and there must never be one: two commands would be two answers to "what does
installing mean", and the second would drift.

The paths remain distinguishable in the audit trail without any flag, because the **authenticated
actor differs** — a manager's uid or a technician's uid, never a value taken from a client payload.

## What this does not decide

- Whether technicians should have any broader Equipment visibility. Unchanged, and out of scope.
- Rules. Untouched: technician Equipment reads remain denied.
- `SERIALIZED INSTALLED LOCATION SEMANTIC GAP` and `EQUIPMENT RECOVERY AUTHORITY GAP` — both still
  open, both separate decisions.
