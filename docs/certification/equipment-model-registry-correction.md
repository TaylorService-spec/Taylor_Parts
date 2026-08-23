# Equipment models are registry records — and the live sandbox no longer matches

**Status:** repo-complete, **NOT installed**. Certification World `1.6.0`.
**Blocks:** any additive install into `eos-platform-sandbox` that touches `equipment_models` or `equipment`.

---

## 1. What was wrong

`equipment_models` is not a collection the Certification World invented. It is the **Equipment
Compatibility registry** (`functions/src/equipmentCompatibility/repository.ts`), and in that registry
the document id **is** the domain identity:

```
TAYLOR--C713          buildEquipmentModelId(manufacturer, modelNumber)
```

The certification builder minted its own identity instead — `cw-model-taylor-c713` — and wrote a
record shape the registry's own validator refuses on its **first** check, before it even looks at the
id:

```
validateEquipmentModel({ modelNumber, manufacturer, family, configuration,
                         lineOfBusiness, status, fieldProvenance, publicSource })
  -> { valid: false, reason: "unknown_field" }
```

48 model documents were wrong, and 278 equipment records pointed at them.

**Nothing complained for the entire program**, because no consumer had ever read an equipment model
*through* the registry. This is the same silence that hid the missing Part `version`/`createdBy`
metadata until receiving became the first consumer to go through the real Part authority — the fourth
time in this program a fixture has been internally consistent and wrong, and the fourth time only a
real adapter said so.

## 2. Why it stopped being ignorable

Whole-unit Parts. Part Master refuses an `equipmentModelId` that is not canonical:

```
equipmentModelId  INVALID_FORMAT  "equipmentModelId must be a canonical equipment_models id"
```

So a whole-unit Part **could not have been written at all** while the registry carried `cw-model-`
ids. The correction is a prerequisite of the catalog, not a tidy-up alongside it.

## 3. What changed

| | before | after |
|---|---|---|
| model doc id | `cw-model-taylor-c713` | `TAYLOR--C713` |
| record shape | 8 fields, none required by the registry | the registry's 11 + `lineOfBusiness` |
| public citation | `publicSource` | `sourceAuthority` (the field that exists for it) |
| configuration | `configuration` | `subtype` |
| equipment back-refs | inline second derivation | `modelIdOf()`, the one derivation |
| expected records | 1084 | 1092 |

`lineOfBusiness` is kept although the registry does not define it: the reader selects fields by name
rather than rejecting extras, and it is the field the Taylor/Ventana reporting separation is measured
on.

Both derivations of the canonical id — the fixture's (pure, no compile step) and the product's — are
asserted equal for **every** model in `certificationEquipmentModelContract.test.mjs`. They cannot
drift without CI saying so.

## 4. THE LIVE DIVERGENCE — this is a stop, not an oversight

The live sandbox holds Certification World **1.5.0**, installed static and verified COMPLETE. Every
one of its 48 model documents is at an id that no longer exists in 1.6.0, and every one of its 278
equipment records carries a `equipmentModelId` that now points at nothing.

That makes 1.6.0 **not an additive install**. Bringing the sandbox to it means:

- creating 48 documents at new ids,
- updating 278 existing equipment records' `equipmentModelId`,
- deleting 48 documents at the old ids.

Updating and deleting records that already exist live is outside the bounded additive contract, and
outside anything currently authorized. It is recorded here and **not executed**.

Note that leaving it uncorrected has a cost too: the 278 back-references in the live sandbox are
already dangling with respect to the registry contract — they were dangling before this change, they
just pointed at documents that existed in the same wrong shape. Neither state is correct live.

**Options, for the Owner:**

1. **Bounded corrective migration** — a named, idempotent, dry-run-first script that rewrites exactly
   those 326 documents and deletes exactly the 48 superseded ids. Reversible in the sense that the
   1.5.0 shape is fully reconstructible from the fixture.
2. **Leave live at 1.5.0** — the sandbox keeps working exactly as it does now (no live consumer reads
   models through the registry today, which is why the defect survived). 1.6.0 lands on the next
   deliberate world install.
3. **Neither yet** — repo stays correct, live stays as-is, decision deferred until the unassigned
   cohort is ready to install, at which point one operation covers both.

No option is taken here.

## 5. Files

- `functions/scripts/certificationWorld/data/equipmentMasters.mjs` — `canonicalEquipmentModelId`, the one derivation
- `functions/scripts/certificationWorld/build.mjs` — the registry-shaped record
- `functions/scripts/certificationWorld/data/equipmentAssets.mjs` — back-reference through `modelIdOf`
- `functions/test/certificationEquipmentModelContract.test.mjs` — the real reader, plus mutation proofs
