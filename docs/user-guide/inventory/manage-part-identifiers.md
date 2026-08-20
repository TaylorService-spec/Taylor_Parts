# Add and manage a part's barcodes and identifiers

**Status: built, not yet switched on** · Inventory > Parts > (a part) > Barcode & Identifiers

Register the barcodes and part numbers a part is also known by, so scanning one resolves to the
right part.

## Right now, this screen is unavailable

The commands behind it are built, governed, and tested — but they have not been deployed or turned
on in this environment. The section tells you so directly rather than showing an empty list, because
an empty list would claim this part has no identifiers, and that is not something the screen can
currently know.

Everything below is exactly how it will work once it is switched on.

## Who can use it

You need **inventory.catalog.manage** — the same authority that creates and edits parts. There is no
separate identifier permission; managing a part's identifiers is part of managing the part.

## What an identifier is

An identifier is another name for a part: a UPC/EAN/GTIN barcode, a manufacturer part number, a
supplier SKU, a legacy internal number, a customer or vendor reference.

Each one resolves to **exactly one** part, so a scan can never be ambiguous about what it found.

An identifier **grants nothing and moves nothing**. Scanning tells the system *which part you are
holding* — what you are allowed to do with it is a completely separate question.

## Add an identifier

1. Open the part, and find **Barcode & Identifiers**.
2. Choose the **Type**.
3. Scan into the **Value** box, or type it.
4. For a **manufacturer part number** only, you'll also be asked for the manufacturer — the same
   part number from two manufacturers is two different identifiers.
5. Select **Add identifier**.

Barcode types are checked before anything is sent: a UPC must be 12 digits, an EAN 13, a GTIN 8, 12,
13 or 14. Spaces and hyphens are fine and are ignored. Leading zeros matter and are kept.

## Test a scan before you trust it

**Test this scan** looks up the value exactly as the scanner would, and changes nothing. Use it to
confirm you registered something correctly. It tells you one of:

| Result | Meaning |
|---|---|
| Resolves to **this** part | Correct. |
| Resolves to a **different** part | The value belongs to something else — it names which. |
| Registered but **inactive** | It exists on this part but is switched off, so a scan won't find it. Reactivate it. |
| Nothing registered | A scan would not find it. Add it. |
| Not a usable identifier | The value doesn't fit the type you chose. |

## Deactivate and reactivate

**Deactivate** switches an identifier off. A scan stops resolving it, but **nothing is deleted** —
the record stays so the history is intact, and it keeps showing in the list marked *Identifier
inactive*.

**Reactivate** switches it back on.

Inactive identifiers are shown on purpose. If you try to add one that already exists as inactive,
you'll be told it's already recorded — and being able to see it is what makes that message make
sense.

## There is no edit

An identifier's identity **is** its type and value, so changing the value makes it a different
identifier. To correct one: deactivate the wrong one, add the right one. Both stay on the record.

## What you might see

| Message | What it means | What to do |
|---|---|---|
| "That identifier is already recorded." | The value exists — on this part (possibly inactive), or on another part. | Check the list. If it's inactive here, reactivate it. If another part owns it, the value is wrong. |
| "Someone else changed this identifier…" | A colleague changed it while your page was open. | Reload and try again. |
| "…must be 13 digits — that one has 5." | The value doesn't match the barcode type. | Fix the value, or change the type. |
| "A manufacturer part number needs the manufacturer…" | That type is scoped per manufacturer. | Fill in the manufacturer. |
| "You are not authorized…" | You don't hold inventory.catalog.manage. | Ask an administrator. |
| "Showing the first 200… not complete" | This part has an unusual number of identifiers. | That's a data-quality problem worth investigating. |

## What this is not

- **Not a serialized unit tag.** A serial or RFID tag identifying one physical machine belongs to
  the serialized-asset registry, not here.
- **Not a location barcode.** Those belong to the warehouse/location authority.

These are deliberately not interchangeable.

## Related

- [Find a part and check its stock](find-a-part.md)
- [Parts Scanner](parts-scanner.md) — what a registered identifier makes possible
