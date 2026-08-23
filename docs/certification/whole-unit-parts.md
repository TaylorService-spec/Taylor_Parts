# Whole-unit Parts — the machine as something inventory can hold

**Status:** repo-complete, **NOT installed**. Certification World `1.6.0`.

---

## 1. Why a machine has to be a Part

Every other Part in the Certification World is a component a machine *consumes*: a drive belt, a
control board, a door gasket. A whole-unit Part is the opposite — it **is** the machine.

It exists because the platform has no other way to say *"we hold two uninstalled C713s in the main
warehouse"*:

- stock lives on Parts,
- serialized identity is scoped to `(partId, serialNo)`,
- acquisition, receiving and install **all** take a `partId`.

Without a Part for the model, an unassigned machine has nothing to be a unit **of**. That is why this
catalog precedes the ~30-unit cohort rather than accompanying it.

## 2. One Part per MODEL, not per unit

The Owner's decision, and it is the distinction the rest of the catalog already makes: a Part is a
**kind** of thing, a serialized asset is an **instance** of it.

One Part per physical machine would put instance identity in two places at once — in the Part id and
in the serial — and every count, reorder point and compatibility link would be a count of one.

`CW-WU-TAYLOR--C713` names the model. The five C713s the company owns are five `serialized_assets`
under it, each with its own serial.

## 3. The eight

| partId | model | line | cohort units |
|---|---|---|---|
| `CW-WU-TAYLOR--C161` | Taylor C161 — multi flavor, countertop, gravity | TAYLOR | 4 |
| `CW-WU-TAYLOR--C709` | Taylor C709 — single flavor, countertop, heat treatment | TAYLOR | 4 |
| `CW-WU-TAYLOR--C712` | Taylor C712 — multi flavor, combo milkshake, floor standing | TAYLOR | 4 |
| `CW-WU-TAYLOR--C713` | Taylor C713 — multi flavor, floor standing, gravity | TAYLOR | 5 |
| `CW-WU-ICETRO--ISI-203SN` | Icetro ISI-203SN — multi flavor, floor standing, gravity | VENTANA | 3 |
| `CW-WU-ICETRO--ISI-301TH` | Icetro ISI-301TH — single flavor, countertop, heat treatment | VENTANA | 3 |
| `CW-WU-ICETRO--IM-0460-AH` | Icetro IM-0460-AH — modular ice head, half cube, air-cooled, 460 lbs | VENTANA | 4 |
| `CW-WU-ICETRO--IU-0070-OU` | Icetro IU-0070-OU — undercounter ice, gourmet cube, 70 lbs | VENTANA | 3 |

**17 Taylor / 13 Ventana**, matching the authorized cohort.

Eight, not forty-eight. The registry holds 48 models; forty of them are machines the installed base
*runs* and the company does not stock as new units. A Part for each would be forty Parts with no unit
under them — a catalog padded to look complete.

Both Icetro **families** are present on purpose. Ventana's business is ice machines, so a whole-unit
catalog carrying only Icetro soft serve would leave that line nothing to sell and make the
Taylor/Ventana split unmeasurable on the uninstalled pool.

## 4. The guardrails are the product's

Part Master enforces four rules, and this catalog satisfies them rather than restating them:

| rule | why it matters |
|---|---|
| `wholeUnit` is **declared**, never inferred from `equipmentModelId` | otherwise any Part gains a machine's semantics by acquiring a model link |
| `equipmentModelId` is refused on a Part that has not declared `wholeUnit` | the FK cannot smuggle in the classification |
| a whole-unit Part must be `SERIALIZED` | a quantity-tracked machine cannot carry a serial, and acquisition/install/custody are all keyed on one |
| a whole-unit Part is never `SERVICE` | a service class has no unit to hold |

`certificationWholeUnitParts.test.mjs` proves each by **mutation** against the real validator: break
the rule, and the same validator that just accepted eight Parts refuses.

It also runs the real fulfillment resolver (`resolveEligibleWholeUnitParts`) — what an order for
"a C713" actually calls — and asserts that a model with no whole-unit Part resolves to **nothing**
rather than to something close.

## 5. What is deliberately absent

- **No reorder point.** A machine is not reordered off a shelf threshold; it is bought against a
  sale. A reorder point here would feed a demand signal that means nothing for this class of Part.
- **No stock.** These Parts hold no units yet. The cohort is the next slice, built through the
  acquisition authority (`inventory.serializedAsset.acquire`) — not by direct write.
- **No live install.** See [equipment-model-registry-correction.md](equipment-model-registry-correction.md) §4.

## 6. Files

- `functions/scripts/certificationWorld/data/wholeUnitParts.mjs`
- `functions/test/certificationWholeUnitParts.test.mjs`
