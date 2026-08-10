# TAYLOR PARTS / EOS
## Ventana Ice Machine — Commercial & Inventory Lifecycle
### Business Process Definition — Discovery Baseline

**Status:** Discovery Baseline<br>
**Scope:** Business process only<br>
**Architecture status:** Not yet determined<br>
**Implementation status:** Not authorized by this document

## 1. Purpose

Records an Owner-confirmed business fact about how ice machines reach Taylor customers,
so that future work does not have to rediscover it or depend on Owner recall.

**This is a sibling to [Cross-Franchise Equipment Receiving & Installation](./cross-franchise-equipment-receiving-installation.md),
not a replacement for it.** That document governs one Taylor organization fulfilling for
another. This one governs Ventana as the upstream source. Where the two overlap, §6
states exactly what carries over and what does not.

Like its sibling, this defines no EOS data model, authority, API or lifecycle
implementation, and authorizes no software change.

## 2. Owner-confirmed facts

1. **Ventana is the upstream seller/source for ALL ice machines Taylor sells.**
2. When Taylor needs to sell an ice machine to a customer, **Taylor purchases that
   machine from Ventana**.
3. Once Taylor purchases/receives the machine into Taylor's control, **the machine
   becomes subject to Taylor inventory controls**.
4. **Taylor inventory control continues through fulfillment and installation until the
   ice machine is installed AND the associated sale closes.**

## 3. Lifecycle

```
customer demand / sale
  → ice machine required
  → Taylor purchases from Ventana
  → Taylor inventory control BEGINS
  → receiving / serialized identity / custody / location
  → allocation / staging / fulfillment
  → delivery / installation
  → installation complete  AND  sale closes
  → Taylor inventory control ENDS
  → installed customer equipment / asset lifecycle
```

## 4. What must NOT be assumed

The confirmed rule is that inventory control persists until **installation AND sale
close**. None of the following ends it on its own:

| Do NOT assume | Because |
|---|---|
| ordered = Taylor inventory | control begins on purchase/receipt into Taylor's control, not at order |
| allocated = removed from inventory | allocation is a commitment, not an exit |
| delivered = sale closed | delivery is a physical event; closing is commercial |
| installed = sale closed | installation is one of **two** required conditions |
| invoiced = inventory responsibility ended | invoicing is neither of the two conditions |

## 5. The two-condition rule is the point

Every stage above is individually insufficient. A machine that is installed but whose
sale has not closed **is still under Taylor inventory control**, and so is one whose sale
closed before installation. Any surface, projection or report that treats a single event
as the end of inventory responsibility contradicts this rule.

## 6. Relationship to the cross-franchise baseline

That document's confirmed invariants establish that these concepts are **independent**
and must never be collapsed: ownership · physical custody · inventory location ·
commercial seller · fulfillment · installation · service · warranty · billing.

Two of them resolve an apparent conflict here:

- **INV-4 — operational controls do not establish ownership.** Applying receiving,
  inventory, HOLD, Work Order, picklist, shop or dispatch controls does not change who
  owns the equipment.
- **INV-10 — ownership changes independently of service responsibility**, and its §20
  table has the customer owning the equipment *after delivery*.

So "customer owns it after delivery" and "Taylor inventory control persists until
install **and** sale close" are **not in conflict** — they are different axes.
**Ownership (title) and inventory control are separate**, exactly as INV-1/INV-4 require.
A surface that renders "inventory control ended" as "the customer now owns it", or the
reverse, has collapsed two independent facts.

**What does NOT automatically carry over.** The sibling document governs Taylor↔Taylor.
**Ventana is a separate operating company**, and whether its invariants apply to the
Ventana→Taylor relationship is **not established by either document**. The structural
analogy is strong enough to be worth testing and too weak to assume — routed in §8.

## 7. UX implications

UX's question at every stage is: *can a user tell where a specific ice machine is, who
controls it, which customer and job it belongs to, and what must happen next?*

1. **A single event must never render as lifecycle completion.** Delivered, installed and
   invoiced are each insufficient. This is the same honesty rule the vocabulary sweep
   applied to derived signals, now at the lifecycle level.
2. **Two conditions means two indicators.** A surface reporting "complete" against one
   condition is overclaiming. Partial states must stay legible — *installed, sale open*
   is a real and expressible state.
3. **"In inventory" must not be read as "available".** Cross-franchise INV-2 already
   establishes that presence ≠ availability; a machine committed to a customer sale is
   present and unavailable.
4. **Terminology must not drift across Sales, Purchasing, Receiving, Warehouse, Work
   Order and Equipment.** These six surfaces each touch the same machine at a different
   stage; the sweep has already found this failure mode four times in other domains.
5. **Custody handoffs need a visible holder.** Warehouse → staging → truck → technician →
   customer site is a custody chain, and existing evidence shows technicians and
   warehouse roles cannot currently see each other's half.

**UX must not create the missing commercial or accounting policy**, and nothing here
authorizes doing so.

## 8. Routed — genuine unknowns, not guesses

Checked against both business-process documents first; none of these is answered there.

| Question | Route to |
|---|---|
| Do the cross-franchise invariants (INV-1…INV-10) apply to **Ventana**, a separate operating company? | Product |
| Exact ownership/title transfer point in the Ventana → Taylor → customer chain | Product / Finance |
| Exact **sale-close criteria** — the second of the two conditions is undefined | Product / Sales |
| Drop-ship scenarios (Ventana direct to customer): does Taylor inventory control ever begin? | Product |
| Serial capture point, and receiving procedure for Ventana-sourced machines | Materials / Purchasing |
| Allocation/reservation mechanism, and whether allocation is visible as a commitment | Materials |
| Invoicing/payment timing relative to the two conditions | Finance |
| Freight and warranty responsibility | Product |
| Cancellation, return and damaged-machine handling | Product / Materials |

## 9. Existing UX findings this narrows

- **C713×5 coordinated install** — five ice machines at one customer *is this lifecycle*.
  The journey's "4 complete / 1 blocked" is a two-condition problem, and Round 3 should
  test whether the coordinated projection expresses *installed but not closed*.
- **Equipment renders `ACTIVE` for an uncommissionable unit** — confirmed twice by
  personas. This fact sharpens it: `ACTIVE` collapses several lifecycle stages, and the
  Equipment record has no way to express which of the two conditions is unmet.
- **Billing eligibility (`PARTIALLY_ELIGIBLE`)** — consistent with the rule. Worth
  re-reading against §4 once sale-close criteria are defined.
- **Warehouse/Parts cannot reach any Work Order (`#226` / R-1)** — the custody chain in
  §7.5 cannot be shown while half of it is unreachable.

## 10. Status

Owner-confirmed facts recorded. Business-process discovery only. **No EOS data model,
authority, or implementation is defined or authorized here**, and no UX change was made
on the strength of this document alone.
