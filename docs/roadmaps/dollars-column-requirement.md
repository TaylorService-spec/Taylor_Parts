# Sales Order and Purchase Order — discrete `Dollars` column

**Recorded 2026-08-23 during WO-04. NOT implemented, and deliberately so.** Work begins after WO-05.

---

## The requirement

The Sales Order list requires a discrete **Dollars** column, backed by the authoritative Sales Order
total. The Purchase Order list requires the same, backed by the authoritative Purchase Order total.

These are **independent financial fields**, subject to the
[EOS Structured Object Presentation Standard](../design/eos-structured-object-presentation-standard.md):
separately addressable through storage, projection, read model, UI, filtering, sorting, reporting and
analytics. Not prose, and not a value folded into a description line.

## The constraint that makes this non-trivial

> **Do not create a generic stored `dollars` field.**

The UI label may read "Dollars". The domain must retain its precise semantics underneath, because a
sales order total and a purchase order total are *different facts* that happen to share a unit:

- a Sales Order total is what a customer is being asked to pay
- a Purchase Order total is what the business has committed to a supplier

A shared, generically-named stored field would let those two drift into being treated as one number,
and would invite a third caller to write something else into it. The column is a **projection of an
authoritative total**, resolved per document type — not a new denormalised amount.

The same trap as `workOrder.laborHours` (see the Technician Labor Domain V1 note §9): a denormalised
total drifts from the records it came from the moment one of them changes, and then two numbers
disagree with nobody able to say which is right.

## Open questions for the implementing slice

1. **Which total is authoritative** for each document, and does it already exist as a stored value or
   must it be derived from lines?
2. **Currency.** Single-currency today; the field should not foreclose otherwise.
3. **Tax, freight and discounts** — in or out of the displayed figure, stated explicitly.
4. **Authority.** Who may see order values at all? A discrete column makes a number visible in a list
   where it previously was not, and that is an access decision, not a layout one.
5. **Rounding and precision** at the boundary between storage and display.

## Sequence

`WO-05 — Warehouse / Parts Offline Runtime`
→ **Site-wide Structured Object UX + Reporting preparation**, which includes:

- discrete Status fields across surfaces
- discrete object attributes generally
- the Sales Order Dollars column
- the Purchase Order Dollars column
- reporting-friendly object presentation
