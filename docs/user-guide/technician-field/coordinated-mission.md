# Coordinated Mission (Technician)

**Who this is for:** technicians handling several equipment units for one customer in a single trip.

**Where:** **Service → Technician Workspace → Coordinated Mission** (`/service/coordinated-mission`).

> The page currently shows a **synthetic sample** mission (the C713×5 scenario). The live feed connects in a
> later release. It is read-only — nothing here changes your Work Orders.

## What a coordinated mission is

One customer, one site, **several pieces of equipment** — each on its **own Work Order**. Your Work Orders stay
**independent** (you complete each unit separately), but this page gives you the **one shared picture** so you
don't have to piece it together from separate screens.

## Reading your mission

At the top:

- **Customer / Location** — the one place you're going.
- **Coordinated load** — whether the truck load is verified across all units (or unknown / needs attention).
- **Mission readiness** — the overall state, worst-known first.
- **Overall progress** — e.g. *"3 of 5 complete · 1 blocked · 2 remaining."* The mission is only done when every
  unit is done; each unit is completed on its own.

## Reading each equipment unit

Below, each unit is its own card:

- the **equipment** and its **Work Order number / status**;
- **Parts ready / Parts short / Parts unknown** — honest; if the app doesn't have the evidence it says
  *"unknown"* rather than guessing;
- **Load verified / not verified / unknown**;
- a **material blocker** if the unit is short a part — the part is named, and if the replenishment system isn't
  connected you'll see *"replenishment not connected (routed to Inventory / Purchasing)"* instead of a made-up
  ETA.

If you have more than one coordinated mission, use the buttons at the top to switch between them.

## What this page does not do

It does not complete work orders, verify loads, or change schedules — it's a read-only overview. Complete each
unit in your normal Work Order / Field Mode flow.
