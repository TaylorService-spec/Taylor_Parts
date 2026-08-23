# Equipment models are registry records — and the live sandbox no longer matches

**Status:** repo-complete and **MIGRATED LIVE 2026-08-23** (see §4). Certification World `1.6.0`.

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

## 4. THE LIVE DIVERGENCE — raised as a stop, then authorized and closed

The live sandbox holds Certification World **1.5.0**, installed static and verified COMPLETE. Every
one of its 48 model documents is at an id that no longer exists in 1.6.0, and every one of its 278
equipment records carries a `equipmentModelId` that now points at nothing.

That makes 1.6.0 **not an additive install**. Bringing the sandbox to it means:

- creating 48 documents at new ids,
- updating 278 existing equipment records' `equipmentModelId`,
- deleting 48 documents at the old ids.

Updating and deleting records that already exist live was outside the bounded additive contract and
outside anything authorized at the time, so it was raised rather than done. The Owner authorized it
on 2026-08-23; the outcome is below.

Note that leaving it uncorrected has a cost too: the 278 back-references in the live sandbox are
already dangling with respect to the registry contract — they were dangling before this change, they
just pointed at documents that existed in the same wrong shape. Neither state is correct live.

### RESOLVED 2026-08-23 — option 1, executed

The Owner authorized the bounded migration. It ran against `eos-platform-sandbox` and completed:

```
created    : 48 canonical model documents
verified   : 48/48 canonical models read back through the registry
repointed  : 278 equipment back-references
resolved   : 278/278 in-scope equipment records resolve through the registry
deleted    : 48 superseded legacy model documents
out of scope: 8 (pre-existing sandbox equipment with no model reference at all)
```

Verified independently afterwards, not read from the migration's own output:

| invariant | before | after |
|---|---|---|
| equipment total | 286 | 286 |
| certification equipment | 278 | 278 |
| Taylor / Ventana | 157 / 121 | 157 / 121 |
| status ACTIVE/RETIRED/INACTIVE | 273 / 7 / 6 | 273 / 7 / 6 |
| distinct serials | 286 | 286 |
| canonical model refs | 0 | 278 / 278 |
| dangling model refs | 278 | 0 |
| non-canonical model documents | 48 | 0 |
| duplicate canonical models | — | 0 |
| models readable by the registry | 0 | 48 / 48 |

All 278 records were then compared **field by field against the fixture** —
`accountId`, `locationId`, `serialNumber`, `name`, `manufacturer`, `model`, `installedDate`,
`warrantyExpiresDate`, `status`, `lineOfBusiness`, `assetTag` — with **zero drift**, and every
location still belongs to its account.

A second apply was a true no-op: **0 created, 0 repointed, 0 deleted**, 278/278 still resolving.

The 8 out-of-scope records (`eq-c713-1..5`, `eq-cool-001`, `eq-ice-001`, `eq-ice-002`) predate both
the certification world and the equipment-model link. They carry no model reference, were named
individually rather than summarised away, and were not touched.

G10 and G11 are Work Order scenarios keyed on `equipmentId`. The migration changed no equipment id
and no work order, and the live sandbox holds 0 certification work orders, so they are unaffected.

The options below are retained as the record of what was decided against.

**Options, as presented:**

1. **Bounded corrective migration** — a named, idempotent, dry-run-first script that rewrites exactly
   those 326 documents and deletes exactly the 48 superseded ids. Reversible in the sense that the
   1.5.0 shape is fully reconstructible from the fixture.
2. **Leave live at 1.5.0** — the sandbox keeps working exactly as it does now (no live consumer reads
   models through the registry today, which is why the defect survived). 1.6.0 lands on the next
   deliberate world install.
3. **Neither yet** — repo stays correct, live stays as-is, decision deferred until the unassigned
   cohort is ready to install, at which point one operation covers both.

Option 1 was chosen.

## 5. Files

- `functions/scripts/certificationWorld/data/equipmentMasters.mjs` — `canonicalEquipmentModelId`, the one derivation
- `functions/scripts/certificationWorld/build.mjs` — the registry-shaped record
- `functions/scripts/certificationWorld/data/equipmentAssets.mjs` — back-reference through `modelIdOf`
- `functions/test/certificationEquipmentModelContract.test.mjs` — the real reader, plus mutation proofs
