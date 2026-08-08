# Ordered-Model ↔ Eligible-Serial Mapping (Assessment — material decision)

**Status:** Assessment. Repository authority investigated first (per the autonomy directive). **Outcome:
multiple legitimate models remain → returning with evidence + options for the material decision.** No code
changed; no authority introduced; the equipment-availability contract stays fail-closed / UNKNOWN.

## The question

To allocate a serialized equipment line (`C713 × 5` = one commercial line qty 5 → five serialized units at
fulfillment), the platform must answer: **for an ordered `EQUIPMENT_MODEL` line `ref`, which serialized assets
are eligible to fulfil it?** The equipment-availability contract
(`functions/src/fulfillment/equipmentAvailabilityContract.ts`) returns UNKNOWN today partly because this
`ordered-model → allocatable-serial` join "is not cleanly established." This assessment establishes exactly why,
from repository authority, and what the legitimate ways to resolve it are.

## Repository evidence (verified)

Three authorities exist; **no stored foreign key connects them for whole-unit fulfilment:**

1. **`equipment_models`** (Equipment Compatibility catalog) — `equipmentModelId` = canonical
   `buildEquipmentModelId(manufacturerId, modelNumber)` (`manufacturer--model`), plus `modelNumber`,
   `displayName`, `family`, `status`, and a governed **alias** mechanism (`MODEL_ALIAS`: `{aliasType,
   manufacturerId, rawValue → equipmentModelId}`) that resolves alternate model strings to the canonical id.
   **It has no `partId`/SKU field.** (`functions/src/equipmentCompatibility/domain/equipmentModel.ts`,
   `equipmentModelRepository.ts`.)
2. **`equipment_compatibility`** — a governed **model ↔ part** relationship, but its `compatibilityType` is
   `DIRECT_FIT | APPROVED_ALTERNATE | OPTIONAL_ACCESSORY | CONSUMABLE` — i.e. **service/repair parts that fit a
   model**, not the whole-unit SKU that *is* the model. Using it for allocation would return compatible service
   parts, not sellable units. (`functions/src/equipmentCompatibility/domain/compatibility.ts:21,142`.)
3. **Part / serialized-asset** — a serialized asset holds only `{serialNo, partId, currentLocation, state,
   currentEquipmentId}` and **never** stores Part authority; Part Master **supplies** descriptive
   `{manufacturer, model, category, type, trackingMode}` **keyed by `partId`**, where `manufacturer`/`model` are
   **nullable free-text strings**, and **a Part carries no `equipmentModelId`**.
   (`field-ops-app-vite/src/domain/serializedAssetIdentity.js:51-109`.)

And the commercial input:

4. **Ordered `EQUIPMENT_MODEL` line `ref`** is a **free trimmed string** — not validated as an `equipmentModelId`
   nor a `partId` (`functions/src/opportunity/opportunityCommands.ts:84`; `salesOrder/salesOrderCommands.ts`).
   Fixtures use model-ish strings ("Taylor-C723", "WIC-8x10").

**Conclusion:** there is **no canonical `ordered ref → equipmentModelId → unit partId → serialized asset`
path**. The compatibility catalog is a false lead (service parts). Every viable mapping requires **introducing a
new governed relationship or resolution rule** — a material decision. The prior assessment's warning holds:
guessing the join "would create a bad authority relationship."

## Options (each is a legitimate model; all keep allocation fail-closed until chosen)

### Option A — `Part.equipmentModelId` FK on the serialized **unit** Part *(recommended)*
A sellable equipment model corresponds to a serialized **unit SKU** (a Part with `trackingMode = SERIALIZED`).
Add ONE governed reference `Part.equipmentModelId → equipment_models`. Resolution:
`ordered ref → equipmentModelId (direct or via the existing alias mechanism) → Parts with that
equipmentModelId → serialized assets by partId`, then the already-built `computeEquipmentAvailability`
(available serials − other-SO-selected − temp-placement conflicts) at eligible warehouses.
- **Pros:** reuses both canonical authorities; ONE new FK; ordered-ref resolution reuses governed aliases;
  cleanly supports "one model → several unit SKUs / revisions."
- **Cost / decision:** a Part Master schema + governance change (new field, ADR/Decision), and a rule that the
  ordered `EQUIPMENT_MODEL` ref must resolve to a canonical `equipmentModelId`.

### Option B — Ordered `ref` = unit **partId** (SKU) directly
Tighten the commercial `EQUIPMENT_MODEL` line so `ref` is the unit SKU; serials join directly by `partId`;
`equipment_models` stays descriptive.
- **Pros:** no new FK; simplest join.
- **Cons:** pushes SKU identity into the **commercial** authority (Opportunity/SO line validation), asserts
  "a sellable model = exactly one SKU" (breaks on model revisions / multiple SKUs), and weakens the
  model-level pre-commitment semantics (Opportunity is product/model-level, serialization at fulfilment).

### Option C — Value-join `manufacturer + model` → `equipmentModelId`
Compose `buildEquipmentModelId(part.manufacturer, part.model)` and match a normalized ordered ref.
- **Pros:** no stored field.
- **Cons:** relies on **free-text, nullable** Part fields being clean and on the ordered ref being a resolvable
  model identifier; brittle, non-authoritative — the "bad authority relationship" the prior assessment warned
  against. Not recommended as the authority (acceptable only as a migration aid to *populate* Option A's FK).

### Option D — New explicit `equipmentModelId → [unit partId]` fulfilment authority
A governed mapping object distinct from compatibility.
- **Pros:** most explicit; supersets A.
- **Cons:** a whole new authority/collection for what Option A expresses with one field; heavier governance.

## Recommendation

**Option A.** It is the smallest change that yields a *canonical* mapping, reuses the equipment_models alias
resolution already built, and preserves model-level commercial semantics with serialization at fulfilment.
Option C is viable **only** as a one-time migration heuristic to seed Option A's `equipmentModelId` on existing
serialized-unit Parts (human-verified), never as the runtime authority.

## Why this is a return point (not a manufactured checkpoint)

Introducing `Part.equipmentModelId` (or any of B/C/D) is a **new canonical authority relationship** and, for
B, a change to **commercial line-ref semantics** — both explicit stop conditions. Repository evidence does not
resolve the mapping; it proves no canonical link exists. So this returns with evidence + options.

## What proceeds regardless of the decision (no material choice baked)

- The equipment-availability contract stays **fail-closed / UNKNOWN** for serialized-equipment lines; the
  parts/service allocation path, coordination structure (visits/missions), obligation attention, and the
  finance-eligibility seam are unaffected and already live.
- The pure `computeEquipmentAvailability` (available − other-SO-selected − temp-placement) is already built and
  waits only on: (1) the serialized-asset **availability signal** connecting (P1a, a separate substrate/data
  connection), (2) **this mapping** decision, and (3) **#12 Temporary Placement** authority.
- Once Option A is ratified, the wiring is: add the FK (Part Master) → resolve ordered ref to `equipmentModelId`
  (alias-aware) → `readEquipmentAvailability` reads serialized assets for the model's unit partId(s) → net
  other-SO selections and (only when `temporaryPlacementConflict().available`) temp-placement conflicts.

## Boundary

No capability grant, callable deploy, Rules change, or production action. Choosing an option is an
Owner/architecture decision; implementation (schema field, resolution rule, tests) then proceeds autonomously.
