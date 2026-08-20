# The Scan workspace

**Status: built, not switched on.** The screen described here exists in the application, but supplier
receiving through it cannot run in your environment until the receiving backend is deployed and
switched on. Everything on this page describes what the screen does once that happens; the
"[If you see nothing here](#if-you-see-nothing-here)" section describes what you see before it.

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

Scanning a part just to look it up is also not here yet. It is the next thing planned for this screen.

## If you see nothing here

If the workspace tells you no scanning workflows are available, nothing is broken. It lists the reason
for each workflow you might have expected, and each reason has a different fix:

| What it says | What it means | What fixes it |
| --- | --- | --- |
| You are not authorized to receive stock | Your account does not hold the receiving authority | An administrator grants it |
| Receiving is built and you are authorized, but it is not switched on in this environment yet | Nothing is wrong with your access — the receiving backend has not been deployed and enabled here | Deployment and activation, which is an operator action |
| Work order scanning is for technicians working an assigned job | You are not a technician, or your account has no technician record | An administrator links your account to a technician record |
| You have no assigned work orders to scan against right now | You are a technician, but nothing is assigned to you | A dispatcher assigns you work |

The distinction between the first two matters: being told you lack permission when the real reason is
that a feature is switched off would send you to ask for access you may already have.

## On a phone

The workspace is built for a phone held one-handed in a warehouse. Workflow cards are large targets,
and every control is a real button, so it is reachable by keyboard and by screen reader as well as by
thumb.
