---
artifact_type: audit-evidence
unit: INV-CONVERGENCE-B — Reconciliation Evidence Unit (READ-ONLY)
gate: Evidence
status: Draft — awaiting Owner and ChatGPT review (docs-only draft PR); no implementation authorized
date: 2026-07-25
owner: Claude Code (Inventory)
baseline: d229af473440abdbc43151a0642452ff6f21d8c8 (origin/main)
closes: UD-1 (exact ten excluded), UD-2/P0 (canonical↔operational identifier join)
authorizes: nothing — no Rules, Firestore writes, source switch, static-catalog edits, or deployment
related_decisions: "DECISIONS.md #37, #40, #42, #43"
---

# INV-CONVERGENCE-B — reconciliation evidence

## 1. Purpose and scope

Close **only** the two evidence blockers recorded by INV-CONVERGENCE-A (Decision #43):

- **UD-1** — the exact ten-record discontinued/excluded manifest behind the 200→190 gap.
- **UD-2 / P0** — proof of which canonical Part identifier provides the operational compatibility key (`partId` / `internalPartNumber` / neither / mixed), i.e. whether the canonical `parts` population joins to the operational SKU-shaped key or requires an alias/adapter.

Out of scope: UD-3, UD-4, UD-5, and any implementation. This unit is read-only; it makes **no** Firestore writes, Rules/Functions/index changes, source switch, static-catalog edits, or deployment.

## 2. Evidence sources and provenance (SHA-256 pinned)

All inputs are read-only and already committed on `origin/main` @ `d229af4`; hashes are recorded in `SHA256SUMS.txt` and reproduced by the generator.

| Role | Path | Evidence class | SHA-256 |
|---|---|---|---|
| **Production read-back** (primary) | `docs/audits/inv1-phase1/create-execution-20260724/postwrite-analyzer/row-results.json` | **production-derived** — zero-write analyzer read of the **live production `parts`** (2026-07-24), 190 rows all `NO_CHANGE`/`IDENTICAL`, `currentSummary` populated per record | `3a68e075…dadad8d` |
| Production write result | `docs/audits/inv1-phase1/create-execution-20260724/execution/per-row-results.json` | production-derived — the actual CREATE execution (190 SUCCESS) | `8afe25ea…bb0a32c1` |
| Migration input (dry-run) | `docs/audits/inv1-phase1/production-dryrun-20260723-01/row-results.json` | **migration-package** corroboration — 190 proposed CREATE rows | `088a7d8f…0d6e998d` |
| Static catalog | `field-ops-app-vite/src/data/partsCatalog.ts` | **repository-derived** — the 200-row comparison population | `4050c214…c2bfb54af1` |

### 2.1 Primary-input note (important — read before relying on the verdict)

The unit specified an **Owner-produced fresh read-only export of the 190 production `parts` documents** as the primary source. **No fresh export was attached to the authorization.** Rather than fabricate one or substitute mere migration-package corroboration, this unit uses the **committed, checksum-verified, sensitive-scan-CLEAN production zero-write read-back** (`postwrite-analyzer/row-results.json`) as the production-derived primary source — it is exactly the privileged evidence class (a direct read of the current production `parts` population), and its provenance is stronger than a hand-produced CSV because it is byte-pinned on `main` (`.gitattributes … create-execution-20260724/** -text`).

Two residual caveats, neither of which changes the operational join (§5):
- **Freshness:** the read-back is dated 2026-07-24. Production `parts` can change only through a trusted `createPart` run; none has been authorized since. A fresh Owner export would confirm zero drift since then.
- **Field coverage:** the read-back's `currentSummary` exposes `partId`, `name`, `stockingUnit`, `status` — but **not** `category` or a separate `internalPartNumber`. Those two columns are marked `NOT_EXPOSED_IN_SOURCE` in `production-parts-export.csv`; a fresh export would populate them.

## 3. Deliverables (this directory)

| File | Rows | Description |
|---|---|---|
| `production-parts-export.csv` | 190 | Production `parts` read-back (partId, internalPartNumber*, name, category*, stockingUnit, status, source_provenance). *`internalPartNumber`/`category` = `NOT_EXPOSED_IN_SOURCE`. |
| `static-catalog-population.csv` | 200 | Repository `PARTS_CATALOG` comparison population (sku, name, category, unit, cost, price, reorderThreshold, warehouseQty). |
| `canonical-operational-join.csv` | 190 | Per canonical record: `partId`, static SKU match, match method/result, name parity, unit parity (raw + normalized), mismatch reason. |
| `excluded-ten-part-manifest.csv` | 10 | The exact static SKUs absent from production, with static descriptive fields and evidence class. |
| `SHA256SUMS.txt` | — | SHA-256 of all inputs and generated outputs. |

## 4. Reconciliation results (deterministic)

- **Population counts:** production `parts` = **190**; static `PARTS_CATALOG` = **200**; migration input (dry-run) = **190**.
- **Identity:** for **all 190** production records, `proposedPartId == normalizedLegacyId` and both match `^TST-\d{4}$`; the production `currentSummary` confirms each live document is keyed on the same `TST-####` string. Every one of the 190 matched exactly one static SKU by exact-string equality (`partId == sku`); **0 unmatched**, **0 production ids absent from the static catalog**.
- **Descriptive parity:** **0 name mismatches** and **0 unit mismatches** across the 190 matched records, after normalizing static unit tokens to the canonical stocking unit (`ea→EACH`, `kit→KIT`, `bottle→BOTTLE`, `tube→TUBE`, …). This confirms the INV-CONVERGENCE-A finding of material descriptive overlap (`name`, `category`, `unit`↔`stockingUnit`).
- **Alias posture:** every record carries an `aliasImplications` of a would-be `LEGACY__TST-####` alias, but production `part_aliases = 0` (create-execution reconciliation). The direct `partId == sku` join **does not depend** on those aliases; the alias is a convenience layer, not a requirement.

### 4.1 UD-1 — the exact ten excluded records

Static 200 minus production 190 = exactly these ten SKUs (present in the repository static catalog, **absent from the 190 production `parts`**, and **absent from the 190-row migration input** — a consistent three-way signal):

| SKU | Name | Category | Unit |
|---|---|---|---|
| TST-1047 | Hopper Agitator - Pro Series | Mix System | ea |
| TST-1070 | Door Gasket - Gen II | Seals & Gaskets | ea |
| TST-1074 | Sanitizer Solution 32oz | Cleaning Supplies | bottle |
| TST-1080 | Syrup Pump - Single Flavor | Mix System | ea |
| TST-1112 | Front Panel Assembly - Countertop | Cabinet Parts | ea |
| TST-1136 | Brush Kit — Large - Single Flavor | Cleaning Supplies | kit |
| TST-1143 | Mix Pump Assembly - HD | Mix System | ea |
| TST-1175 | Auger Shaft - Single Flavor | Drive Components | ea |
| TST-1189 | Brush Kit — Small - Compact | Cleaning Supplies | kit |
| TST-1193 | Compressor 1 HP - Countertop | Compressors | ea |

**Evidence-class distinction:**
- **Production-derived:** these ten have no record in the 190-row production read-back.
- **Repository-derived:** these ten are present in the static 200.
- **Migration-package corroboration:** these ten are absent from the dry-run's 190-row input population.
- **Inference (not raw evidence):** attributing the exclusion to *discontinued/inactive* status is the **policy explanation** from Decision #42 D-M3. A named `discontinued-parts-manifest.csv` (+ SHA-256) as a source-of-record for the *reason per SKU* was **not** transferred into the evidence tree (INV-CONVERGENCE-A UD-1). This unit proves the ten records' **identity** with production+repository+migration evidence; it does not independently prove the per-record *reason*, which remains the Decision #42 policy attribution.

## 5. P0 verdict

**P0 = `JOIN_CLEAN`.**

The canonical operational compatibility key is **`partId`**: the production `parts` document id equals the operational `TST-####` SKU (the same string used by the ledger `partId`, reorder `partId`, and Work Order `inventorySnapshot` `sku`, per INV-CONVERGENCE-A). All 190 canonical records join to the static catalog by exact `partId == sku` equality with full descriptive parity; no alias or adapter mapping is required for identity resolution.

**Which field provides the key:** `partId` (proven). `internalPartNumber` is **not exposed** in the available production evidence, so its parity is not independently confirmed — but it is not the operational join key (the operational surfaces key on `sku`/`partId`), so this does not weaken the `JOIN_CLEAN` result. A fresh Owner export would additionally confirm `internalPartNumber` and `category`.

**Verdict confidence / caveats:** grounded in the production-derived zero-write read-back (§2.1), corroborated by the migration package and repository. The only open items are evidence *freshness* (2026-07-24) and the two unexposed columns — both closable by a fresh export, neither changing the `partId`-based join. If the Owner requires the literal fresh-export primary input before treating P0 as final, record this as **`JOIN_CLEAN` (production-read-back evidence; fresh export pending)**; the reconciliation result itself is unchanged.

## 6. Relationship to prior governance

This evidence **confirms** — does not contradict — Decisions #37/#40/#42/#43: canonical `parts` is the identity authority (ADR-008), the `partId` was grandfathered to the SKU string (ADR-008 §20), and the 200→190 gap is the Decision #42 D-M3 exclusion. No governance rewrite is warranted. (Per this unit's constraints, no claim is made here about inventory-ledger or other inventory-adjacent collection contents; ledger data was not required and was not used.)

## 7. Validation performed

- **Counts / uniqueness:** production 190 (unique partIds), static 200 (unique SKUs), excluded 10; verified deterministically.
- **Reproducibility:** `SHA256SUMS.txt` output hashes verify (`sha256sum -c`); re-running the generator produces byte-identical outputs (empty diff).
- **Sensitive scan:** generated outputs contain no credentials, tokens, UIDs, emails, or unrelated production data (only part descriptive fields and hashes).
- **Diff scope:** strictly `docs/` audit evidence + governance pointers; no code/Rules/Functions/index/data change.

## 8. Method (reproduce)

Outputs were generated by a read-only deterministic script over the four §2 inputs (parse production `currentSummary` → {partId,name,unit,status}; parse static `PARTS_CATALOG`; set-difference and exact-string join; unit normalization). The script performs no network or Firestore access and writes only into this directory.
