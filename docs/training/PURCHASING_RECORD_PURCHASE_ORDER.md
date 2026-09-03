# Purchasing — Recording a Purchase Order — EOS User Guide

**Audience:** the person assigned to a Reorder Request (purchasing)
**Applies to:** Inventory → Part → Reorder Request → **Record Purchase Order**
**Training represents:** `b19a7486` (merged; see *Verification receipt* for deployment status)
**Effective date:** 2026-09-02
**Environment:** sandbox training — **not yet deployed to any environment**
**Owner:** Verenward product training

## What this guide helps you do

Record the purchase order you placed with a supplier, including **what you agreed to pay per unit**.

From this release onward EOS keeps a permanent record of what purchased parts actually cost. That
record is created from the price you enter here, so this screen is now the point where the cost of
your inventory is established.

## Before you start

- You must be the person **assigned** to the Reorder Request. Others do not see this form.
- The Reorder Request must be in **Purchasing in progress**.
- You need the supplier's **agreed unit price** and the **currency** it is in.
- The supplier must exist as an **active** supplier in EOS — the form will not accept a typed name.

## Normal workflow

1. Open the Part, find its Reorder Request, and locate **Record Purchase Order**.
2. Choose the **Supplier**.
3. Enter the **External PO/reference number** — your supplier-facing PO number.
4. Enter the **Ordered quantity**.
5. Enter the **Unit purchase price** — the amount per unit, as agreed with the supplier. Type it the
   normal way, for example `19.99`.
6. Check the **Currency**. It starts as `USD`. Change it if you ordered in another currency.
7. Enter the **Ordered date**, and the **Expected arrival date** if you know it.
8. Select **Record Purchase Order**.
9. The Reorder Request moves to **Ordered** and the purchase order details appear.

## What EOS does automatically

- **Locks the price to this purchase order.** Once recorded, the purchase order cannot be edited. The
  price you entered is the price EOS will use for everything that follows.
- **Creates the cost record when the parts are received.** When someone receives against this purchase
  order, EOS records what that received quantity cost. **You do not enter a price again at receiving,
  and the receiver cannot change it.**
- **Prices only what actually arrives.** If you order 10 and 4 are received now, the cost record
  covers those 4. The remaining 6 get their own record when they arrive.
- **Records which company the purchase belongs to** (Taylor or Ventana), taken from the Reorder
  Request. You do not choose it and cannot change it.
- **Keeps the exact amount.** `19.99` is stored exactly, never rounded.

## Warnings and exceptions

**The price is required.** The form will not submit without it. This is deliberate: a purchase order
with no price gives EOS no way to know what the parts cost.

**Enter `0` for a no-charge line.** A warranty replacement, a free sample, or a supplier making good is
a real price of zero — type `0`. **Do not leave the field empty to mean "free".** Empty is refused, and
if it were accepted EOS could not tell "this cost nothing" apart from "nobody recorded a price".

**Only as many decimal places as the currency allows.** For USD that is two. `19.999` is refused rather
than quietly rounded — EOS will not commit a price you did not type.

**Enter the amount only.** No currency symbol, no thousands separators. `1999.00`, not `$1,999.00`.

**Currency must be a 3-letter code**, such as `USD` or `CAD`. EOS never assumes one, and it does not
convert between currencies.

**Purchase orders recorded before this release have no price, and that is correct.** They can still be
received exactly as before. Their cost is recorded as **unknown** — never as zero — and no cost record
is created for them. **Nothing needs to be done to those older purchase orders, and prices must not be
added to them after the fact.**

**There is no supplier quote shown on this screen.** Enter the price you actually agreed. If your
supplier's quoted price is held elsewhere in EOS, it is not displayed here and is not used.

## If something looks wrong

- **"Unit purchase price is required"** — the field is empty. Enter the amount, or `0` for no charge.
- **"Enter the unit purchase price as an amount in USD, for example 19.99"** — the value is not a plain
  amount. Remove any symbols, separators, or extra decimal places.
- **"Currency is required (a 3-letter code such as USD)"** — the currency box is blank or not three
  letters.
- **The price was recorded incorrectly.** A purchase order cannot be edited. Contact your Taylor EOS
  Administrator — the existing **void** path is the governed way to withdraw a purchase order.
- Anything else: contact your Taylor EOS Administrator. Do not attempt to change records directly.

## Administrator notes

Correcting a committed price is **not** self-service and no correction mechanism exists yet. A
purchase order is immutable once recorded; use the governed void path and record a new one.

## Changes in this release

- **New required fields:** *Unit purchase price* and *Currency* on Record Purchase Order.
- **New responsibility:** the purchasing user now establishes the cost basis for received inventory.
  The receiver does not enter or change a price.
- **Known limitation:** no supplier-quote prefill. The price is entered manually every time.
- **Known limitation:** a recorded price cannot be corrected — only voided and re-recorded.
- **Unchanged:** who may record a purchase order, supplier selection, and every other field.

## Verification receipt

- Training checked against deployed release/SHA: **NOT DEPLOYED.** Written against merged `b19a7486`.
- Workflow exercised/visually verified: **NO** — the sandbox is at `5eaa403a`, which predates this
  change, so the screen described here cannot yet be exercised in any deployed environment.
- Screenshots current where used: not applicable — none used.
- Known sandbox-only or future behavior present in guide: **YES** — this guide describes merged but
  undeployed behavior in its entirety.
- Training status: **DRAFT — PENDING DEPLOYMENT VERIFICATION.** It becomes `COMPLETE` only after the
  release is deployed and the workflow is exercised against it, per `docs/training/README.md`.
