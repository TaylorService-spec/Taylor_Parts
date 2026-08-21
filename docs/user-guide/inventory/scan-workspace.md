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

Scan a part label or barcode, or type a part code, and see what the part is: its part number, name,
description, category, catalog status, control type, stocking class and unit.

It matches on the part's own code **and** on any identifier registered for it — barcode, UPC, EAN,
GTIN, supplier SKU, manufacturer part number, legacy or customer reference. When a scan matches a
registered identifier rather than the part's own code, the result says so, so a barcode registered
against the wrong part does not quietly look like a correct scan.

If the same value means two different things — one part's number and another part's barcode — the
screen shows both and resolves neither. That is a data problem to fix, not a choice to guess at.

**This changes nothing.** There is no quantity box and no submit button. Looking a part up does not
move it, count it, reserve it or receive it.

The result also shows what you have and where: **serialized units**, **location**, **on hand**,
**reserved**, **available** and **on order**.

Those six rows read live inventory, and that reading is **not switched on yet** — so today each of
them says exactly that rather than showing a number. It is deliberate. A blank would look like the
part has none, and a zero would be worse: "nothing has ever been recorded for this part" and "there
are none on the shelf" are different facts, and this screen will never show you one when it means
the other.

When a row cannot answer, it tells you which kind of nothing it is:

| It says | It means |
| --- | --- |
| **Not switched on** | The reading is built and governed, but not enabled here yet |
| **Reading…** | It is being fetched right now |
| **Could not be read** | It was tried and failed — worth retrying |
| **Unknown** | It was read, and there is genuinely no record to report |
| **Not applicable** | The question does not apply — e.g. a non-serialized part has no serial units |

Serialized parts are counted **individually**, not as a quantity, so they show a unit count rather
than an on-hand number.

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

### Send or receive a transfer

Check a transfer against what you are physically holding, then send it or receive it. Sending happens
at the origin, receiving at the destination — the screen asks which you are at, and will not let you
commit from the wrong end.

A transfer to a **truck** works the same way and reads as a truck: the warehouse sends it, and the
technician accepts it at their van.

**You need:** authority to send or receive transfers.

### Count what is on the shelf

Scan everything you can find of one part at one location, then submit what you saw.

**You will not be shown what was expected until after you submit.** That is deliberate — knowing the
number first tells you when to stop looking. Counting changes nothing on its own; a manager reviews
any difference separately.

**You need:** authority to start and submit counts.

### Put stock away

Scan the bin you are stowing into, scan what goes in it, confirm.

**Stock counts do not change.** Putting something away records *where it is*, not *what there is* —
the warehouse still owns it either way.

**You need:** authority to record placements, and to look up bins.

### Pick and stage for a job

Gather what a job asked for and stage it where the driver will find it. Short is fine and gets
recorded — the button tells you exactly what it is about to do, and you can say why.

**Picking does not hold the stock.** It stays available to other jobs until this one is dispatched.

**You need:** the same authority as put-away.

### Scan parts for my work order

Scan a part to record that you used it on the job you are working. This is the existing parts scanner,
unchanged — see [Parts scanner](parts-scanner.md).

**You need:** to be a technician, with a technician record, and at least one assigned work order.

## What is *not* here

**Returns** and **serialized install or removal** are not on this screen — not greyed out, not
"coming soon", simply absent. Returns can be *taken in* (that is a returns desk, not a scanning job),
but deciding what happens to a returned item is a separate step that does not exist yet. Serialized
install and removal have no command behind them at all.

Showing you a disabled button for either would suggest it exists and that you merely lack permission.

Barcode matching is **built but not switched on**. Until it is, scanning a barcode tells you that
identifier lookup is unavailable in this environment — it does *not* tell you the barcode is
unregistered, because it was never checked.

When it is switched on, these are the answers you may see, and none of them means "no such part":

| What it says | What it means | What to do |
| --- | --- | --- |
| Registered but no longer active | The barcode was retired on purpose | Ask whoever manages identifiers whether it should come back |
| Registered against more than one part | Two parts claim the same barcode | The identifier data needs correcting — do not guess |
| A part number AND an identifier for a different part | Same problem, from the other direction | The identifier data needs correcting |
| Points to a part that could not be read | The barcode is fine; you cannot see that part | Ask an administrator about access to that part |
| You are not authorized to look up identifiers | Your account cannot resolve barcodes | An administrator grants identifier lookup |

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

The workspace is built for a phone held one-handed in a warehouse. Every control is at least 48
pixels tall — bigger than the usual guideline, because that one assumes a bare fingertip and a
warehouse in winter does not have one — and every control is a real button, so it is reachable by
keyboard and by screen reader as well as by thumb.

**It remembers where you were.** If your phone locks or the browser reloads, you come back to the
workflow you were in rather than to the menu. Only the *choice* is remembered — anything you had
half-scanned is not, because the shelf has moved on even if you have not.

### Scanning

Three ways in, and all of them work:

- **A hardware scanner** that types and presses Enter — nothing to set up.
- **The camera**, which keeps scanning so you can work through a pallet without reopening it.
- **Typing**, always available, for a label that is too damaged to read.

Every scan tells you what happened three ways at once — a sound, a buzz, and a line of text naming
the code — because a warehouse defeats any one of them on its own. A rejected scan sounds different
from an accepted one.

If your scanner double-fires, the second one is ignored. Scanning the same part twice on purpose is
**not** ignored — that is how you count two.

### Notes

Where a screen offers a note, you can **type it or dictate it**. Dictation puts words in the box and
nothing more: it never sends anything, never interprets what you said, and never decides anything.
Check the text and correct it before you save — what gets saved is what you read.
