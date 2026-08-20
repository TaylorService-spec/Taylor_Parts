# See what a role can actually do

**Status: live** (admin, dispatcher) · Administration > Roles & Permissions

Pick a role, and the screen tells you exactly what that role gets — read from the system's live
access rules, not from a spreadsheet of what someone intended.

## Why this screen exists

"What can a Sales Manager do?" used to be answerable only by reading code. That gap is how an
Administrator ended up holding 50 of the system's 110 capabilities without anyone noticing.

## Steps

1. Go to **Administration > Roles & Permissions**.
2. Click a role along the top. Administrator is selected by default.
3. Read down the page.

## What the sections mean

**Can actually do** — the capabilities this role holds *and* that are switched on. This is the
real answer to "what can they do today", grouped by area.

**Granted, but denies anyway** — the important one. A capability can be given to a role and still
be switched **off system-wide**, in which case it denies for *everyone*. The role carries the
grant and still cannot do the thing.

If someone reports they can't do something their role supposedly allows, **look here first**.
Granting it again will not help — it has to be activated, which is a separate decision.

**Grants the catalog does not define** — the role names a capability that doesn't exist. Normally
empty. If something appears here, it's a typo or a leftover from a removed capability.

**Business objects** — the same Create / Read / Edit / Delete grid the **Objects** tab shows, read
from this role's side.

- ✓ means granted
- blank means not granted
- **—** means *no permission exists for this at all* — it cannot be granted to anyone, so don't
  raise a request for it

## System diagnostics

Click **Show diagnostics** for findings you can't see from any single role:

- **Capabilities nobody can use** — defined in the system but given to no role on the roster.
- **Grants that deny anyway** — every granted-but-switched-off pairing, across all roles.
- **Roles granting nothing** — sometimes correct (a deliberately minimal role) and sometimes a
  role someone created and never finished. The screen can't tell which; you can.

## What this screen cannot do

It shows **what a role gets**, not **who holds that role**. Listing real people and their
assignments needs a trusted read path that isn't deployed yet, which is why the **Assign Role**
form at the bottom stays disabled. The form is left visible on purpose — the capability exists,
it just isn't reachable from here yet.

Nothing on this screen changes anything. Role definitions live in code today.

## Related

- **Administration > Objects** — the same information organised by object instead of by role.
