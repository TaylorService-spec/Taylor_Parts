# Receive a supplier purchase order (multi-scan)

**Status: built, not yet switched on** · Inventory > Receiving > Supplier purchase order

Scan a whole delivery against one supplier purchase order, check what arrived against what was
ordered, fix mistakes, and submit it as one receipt.

## Right now this screen is unavailable

Receiving is built and governed but has not been switched on in this environment. The screen says so
rather than showing an empty list of orders — an empty list would claim there is nothing awaiting
receipt, which is not something it can currently know.

Everything below is exactly how it will work once it is switched on.

## Which journey to use

**Inventory > Receiving** offers two, because they are genuinely different things:

| | Reorder purchase order | Supplier purchase order |
|---|---|---|
| Parts | one | several |
| Quantity | the full ordered amount, once | partial receipts, over time |
| Scanning | pick from a list | scan continuously |

If your paperwork says one part and one quantity, use **Reorder purchase order** — that journey is
unchanged. This guide covers the other one.

## Who can use it

You need **inventory.stock.receive** — Administrator, Dispatcher, or Owner. If you don't have it,
the screen tells you plainly rather than showing an empty screen.

## Steps

1. Go to **Inventory > Receiving** and choose **Supplier purchase order (multi-scan)**.
2. Scan the purchase order, or pick it from the list of orders awaiting receipt.
3. Check the table. For every line it shows what was **ordered**, what was **already received** on
   earlier deliveries, and what is **outstanding**.
4. **Scan the parts.** The box stays focused, so you can go straight from one item to the next with a
   hardware scanner. Scan a serialized item's **serial**, not just the part.
5. Watch the **Scanned now** and **Remaining after** columns as you go.
6. Fix anything in **Needs attention** (see below).
7. Choose the **receiving location**.
8. Select **Submit receipt**.

You'll get a per-line receipt: what was received, what is still outstanding, and the order's new
progress.

## Scanning moves nothing

A scan records what you saw. Nothing leaves your screen until you press Submit, and submission is one
all-or-nothing receipt — either every line records or none does.

## Counting

- Scanning the same part again **adds one**.
- Use **+1** / **−1** on a queued line to correct a count without rescanning.
- **Undo last scan** removes the most recent one; **Remove** removes any single entry.
- **Clear queue** starts the count again.

**Serialized items are never combined.** Each serial is its own line of one unit, because each serial
is one physical machine.

## Needs attention

Anything the system can't accept appears here, and **it is never silently dropped or silently
included** — you resolve it before submitting.

| Message | What happened | What to do |
|---|---|---|
| "More than the outstanding quantity…" | You scanned more than is still owed on that line. | Remove the extra scan, or correct the count. |
| "This part is not on this purchase order." | The item belongs to a different order. | Remove it and receive it against the right order. |
| "This serial was already scanned…" | The same unit was scanned twice. | Remove the duplicate. |
| "This line has already been received in full." | An earlier delivery completed it. | Remove the scan. |
| "This part is serialized. Scan the unit's serial…" | A serialized part needs its serial. | Rescan with the serial. |
| "This part is not serialized…" | A serial was entered for a plain part. | Remove and rescan without it. |

If a part shows as **unknown part**, its record couldn't be read, so whether it needs a serial isn't
known. Check the part before receiving against that line.

## Partial deliveries

Receive what actually arrived. A line that is still short **stays open**, and the order stays open
with it — you receive the rest whenever it turns up, on a later delivery, against the same order.

The order is only marked received when **every** line has been satisfied.

## What this screen cannot do

It does not put stock away into bins, transfer it, take returns, close a short line, or change a
purchase order. Those are separate pieces of work that don't exist yet — so the screen has no
controls for them at all, rather than controls that look available and refuse.

## If something goes wrong

If a receipt is refused, **nothing was received**. Reload the order and try again — you'll see the
current outstanding quantities.

If someone else received against the same order while you were counting, your submission is refused
rather than applied against figures you never saw. Reload and recount.

## Related

- [Receive a purchase order](receive-a-purchase-order.md) — the single-part reorder journey
- [Add and manage a part's barcodes and identifiers](manage-part-identifiers.md) — what makes a scan resolve
