# Assessment — Equipment-Availability Contract for Sales Order Fulfillment

Owner-directed canonical-`equipment`-read assessment for allocating serialized equipment against a Sales
Order (Cycle 5+). **Outcome: equipment availability correctly remains UNKNOWN / fail-closed today** — two
required facts cannot yet be confidently established. This is the ratified behavior (Owner §3 + invariant #2:
"use existing canonical evidence where sufficient; where a required fact cannot yet be established, preserve
the limitation honestly and fail closed"), not a guess or a placeholder for missing work.

## Canonical evidence that DOES exist (reusable)
- **Serialized-asset identity** (`serializedAssetIdentity.js`): `serialNo, partId, currentLocation, state,
  currentEquipmentId`; states include `INSTALLED`. The canonical available predicate
  (`selectAvailableSerializedAssets` / `composeAvailableEquipment`): a serial is available iff
  `availability === true && state !== "INSTALLED" && currentEquipmentId === null` — i.e. company inventory,
  not installed, no active Equipment link. This gives us *not-installed / not-customer-custody* and
  *no-active-install-link* cleanly.
- **`equipment` collection** = customer-**installed** assets (carry `accountId`/`locationId`/`installedDate`)
  — these are explicitly NOT allocatable (customer-owned custody).
- **Other active Sales Order allocations**: nettable from `sales_orders` (already implemented via
  `sumOtherSoCommitments` / `computeEquipmentAvailability`).

## Required facts that CANNOT yet be established → fail closed
1. **Serialized-asset `availability` is INJECTED and not-yet-connected (P1a).** `availability === true` is not
   sourced from a live inventory/location signal yet ("Available Equipment" is an honest not-yet-connected
   surface). Without a trustworthy availability signal, EOS cannot assert a serial is company-controlled AND
   operationally available at an eligible warehouse. ⇒ UNKNOWN.
2. **Ordered-model → allocatable-serial mapping is unresolved.** A Sales Order `EQUIPMENT_MODEL` line's `ref`
   is a model identifier; serialized assets are keyed by `partId` (SKU), with the *model* supplied by Part
   Master (`part.model`), and `equipment_models` is a separate catalog. The relationship
   `ordered EQUIPMENT_MODEL ref ↔ partId(s) ↔ serialized assets` is not cleanly established. Guessing it would
   create a bad authority relationship. ⇒ the model→serial join cannot be safely computed. **This is the key
   modeling question to resolve when the serialized-asset registry connects** (candidate material decision at
   that point — surfaced, not guessed).
3. **Temporary-placement conflict (Owner §9 / roadmap #12).** A serial on an active loaner/evaluation/service
   placement must be excluded, but the Temporary Placement authority does not exist (#12 unresolved). Its
   absence means EOS cannot positively establish "no active temp placement," which — for allocation safety —
   keeps equipment availability UNKNOWN. See the seam below (a real conflict source that is currently empty
   because #12 has no records; its emptiness is **not** treated as proof).

## Decision
`allocateSalesOrder` keeps serialized-equipment lines at **UNKNOWN / fail-closed**. When (1) the serialized-
asset availability signal connects and (2) the ordered-model↔serial mapping is resolved, wire the already-built
pure `computeEquipmentAvailability` (available serials − other-SO-selected − temp-placement-conflicts) to a
canonical read; equipment allocation then auto-activates. The `temporaryPlacementConflict` seam (below) is the
plug point for #12 — kept real, never faked into authority.

## Not blocking the runway
Parts allocation is fully live (Cycle 5). Warehouse pick/prep, SO→Service/Dispatch, field execution, and the
finance seam proceed for the parts/service path and for the coordination structure; serialized-equipment
fulfillment activates once the two substrate facts above are established.
