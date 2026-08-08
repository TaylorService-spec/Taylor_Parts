# Part.equipmentModelId Migration / Backfill (Assessment)

**Status:** Assessment (Owner §6). No production data touched — backfilling existing Parts is a protected
production migration, gated separately. This assesses HOW to derive `equipmentModelId` for existing
serialized-unit Parts using Option C **only as migration-assistance evidence**, never as runtime authority.

## Principle (Owner §6)

Option C (value-derive `equipmentModelId` from a Part's free-text `manufacturer` + `model`) is a **migration
aid**, not authority. Any backfill must be **deterministic where possible, human/governed-verified where
ambiguous, and auditable**. Canonical relationships must never be established silently from fuzzy text.

## What we can derive deterministically

For a candidate whole-unit Part (`controlType ∈ {SERIALIZED, SERIALIZED_LOT}`), the equipment-model identity is
a pure function of manufacturer + model:

```
candidateId = buildEquipmentModelId(part.manufacturerId, part.model)   // canonical manufacturer--model
```

A candidate is **CONFIRMED-DERIVABLE** iff BOTH:
1. `part.manufacturerId` and `part.model` are present and non-empty, and
2. `candidateId` (or the governed **alias** resolution of `part.model` under `part.manufacturerId`) resolves to
   an **existing** `equipment_models` document.

Otherwise the candidate is **AMBIGUOUS** — missing manufacturer/model, a derived id with no catalog match, or a
model string that only resolves through a non-exact alias. Ambiguous candidates require human/governed review.

## Proposed backfill workflow (repo-only tooling; production write gated)

1. **Extract** (read-only): enumerate Parts with a serialized control type and no `equipmentModelId` yet.
2. **Classify** (pure, deterministic): for each, compute `candidateId`, check catalog existence + alias
   resolution. Emit one of:
   - `CONFIRMED` — exact canonical or exact-alias catalog hit; a single unambiguous `equipmentModelId`.
   - `AMBIGUOUS` — no hit / multiple alias candidates / missing fields. Carries the reason + any near-matches.
   - `NOT_A_WHOLE_UNIT` — the Part isn't a serialized unit (skip; it's a service part).
3. **Report** (auditable artifact): a manifest listing every Part, its classification, the derived candidate,
   and the evidence (which field/alias produced it). No writes.
4. **Human/governed apply**: an authorized operator reviews the manifest and applies `equipmentModelId` (and
   `wholeUnit: true`) **through the governed Part Master write path** (`updatePart`), which re-validates the
   guardrail and **existence-checks** the id (`assertEquipmentModelExists`). CONFIRMED rows may be applied in
   bulk after review; AMBIGUOUS rows are resolved individually. The write path already audits every change
   (auditEvents), satisfying the auditability requirement.

## Guardrails (do NOT)

- Do **not** auto-apply any derived `equipmentModelId` — even a CONFIRMED one — without the human/governed step.
- Do **not** set `equipmentModelId` on a non-whole-unit Part (the validator already forbids it).
- Do **not** treat a fuzzy/near alias match as CONFIRMED; ambiguity routes to review.
- Do **not** invent an `equipment_models` doc to satisfy a derivation; a missing catalog entry is AMBIGUOUS
  (the model may need to be added to the catalog first, itself a governed action).

## Boundary

The classification tooling (extract + pure classify + manifest) is repo-only and buildable when scheduled. The
**apply** step is a production data migration through the governed write path — a **protected** action, gated on
Owner/operator authorization (§9). Nothing here writes production data or changes runtime authority; the runtime
mapping remains the governed FK + alias resolver (Option A), never the value-derivation.
