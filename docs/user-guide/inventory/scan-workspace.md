# The Scan workspace

**Status: partly live.** Looking a part up works as soon as the app is released — it needs nothing
switched on. **Supplier receiving** through this screen cannot run until the receiving backend is
deployed and switched on.

---

## What it is

**Service > Scanning > Scan** is one place to scan, shared by everyone who scans — a parts associate
receiving a delivery at the dock, and a technician recording a part on the job they are working.

You do not pick a mode and you do not need to know which screen your job lives on. The workspace asks
one question — *what are you here to do?* — and lists only the scanning workflows you can actually
complete right now. If a workflow is not listed for you, it is either not built yet, not switched on,
or not something your access allows; the screen says which.

## Getting there

**Service > Scanning > Scan.**

Technicians can also still reach the parts scanner the way they always have, at **Service >
Technician Workspace > Scan**. Nothing moved. The Scan workspace is an additional door to the same
scanner, not a relocation, so if you have a shortcut or a habit, it still works.

## What you can do here

### Look something up

Scan a part label, or type a part code, and see what the part is: its part number, name,
description, category, catalog status, control type, stocking class and unit.

**This changes nothing.** There is no quantity box and no submit button. Looking a part up does not
move it, count it, reserve it or receive it.

Some rows on the result say **Not switched on** or **Not available yet** rather than showing a
value — serialized units, location and quantity on hand. That is deliberate: those readings are not
available to this screen yet, and showing a blank would look like the part has none of them.

**You need:** permission to read the part catalog. If you do not have it, the screen says so
plainly rather than telling you the part does not exist.

### Receive a supplier purchase order

Scan a whole delivery against one supplier purchase order: see the ordered lines with their
outstanding quantities, scan continuously as you unload, reconcile what arrived against what was
ordered, correct mistakes before you commit, and submit one atomic receipt.

Partial deliveries are normal. Receiving less than was ordered leaves the short lines open for a later
delivery — it does not close them, and it does not require a separate purchase order.

The full journey is documented in
[Receive a supplier purchase order (multi-scan)](receive-a-multi-line-purchase-order.md). Launching it
from the Scan workspace is exactly the same screen with exactly the same behaviour.

**You need:** authority to receive stock, and receiving switched on in your environment.

### Scan parts for my work order

Scan a part to record that you used it on the job you are working. This is the existing parts scanner,
unchanged — see [Parts scanner](parts-scanner.md).

**You need:** to be a technician, with a technician record, and at least one assigned work order.

## What is *not* here

Put-away, picking, staging, transfers, returns, cycle counting and truck handoffs are **not** on this
screen — not greyed out, not "coming soon", simply absent. Those operations are not built yet, and
showing you a disabled button would suggest they exist and that you merely lack permission.

Looking a part up by **barcode** is not here yet either — today lookup matches on the part code
(either the part number or the part ID), not on a scanned barcode value. Barcode matching needs the
identifier administration feature to be switched on first.

## If a workflow you expected is missing

You will always have at least **Look something up**. Anything else you expected but cannot see is
listed under **Not available to you**, with the reason — and each reason has a different fix:

| What it says | What it means | What fixes it |
| --- | --- | --- |
| You are not authorized to receive stock | Your account does not hold the receiving authority | An administrator grants it |
| Receiving is built and you are authorized, but it is not switched on in this environment yet | Nothing is wrong with your access — the receiving backend has not been deployed and enabled here | Deployment and activation, which is an operator action |
| Work order scanning is for technicians working an assigned job | You are not a technician, or your account has no technician record | An administrator links your account to a technician record |
| You have no assigned work orders to scan against right now | You are a technician, but nothing is assigned to you | A dispatcher assigns you work |

The distinction between the first two rows matters: being told you lack permission when the real
reason is that a feature is switched off would send you to ask for access you may already have.

Lookup is different — it does not check your access up front, it simply tries. If you are not
allowed to read the part catalog, the lookup screen tells you that directly, and it never disguises
a refusal as "no such part".

## On a phone

The workspace is built for a phone held one-handed in a warehouse. Workflow cards are large targets,
and every control is a real button, so it is reachable by keyboard and by screen reader as well as by
thumb.
