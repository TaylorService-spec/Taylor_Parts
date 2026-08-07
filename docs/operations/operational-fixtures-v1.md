# Operational Fixtures v1 — production-derived Parts / Inventory / Equipment

A repeatable **production READ-ONLY → sanitize → relationship-closure → manifest → governed sandbox seed**
pipeline. It derives a **bounded, representative, sandbox-safe** fixture set from production operational data
so persona agents, F2 scanning, parts readiness, and workflow tests run against real-shaped structure — not
fabricated demo arrays. **Not a production clone.** Production and sandbox remain isolated (snapshot-derived
fixtures, never a runtime link).

## Pipeline (repeatable tooling)
```
extractProductionFixtures.mjs   (OPERATOR-run, read-only, sanitizes inline)
   → sanitized fixture artifact + manifest.json   (operator-controlled local dir)
   → seedSandboxFixtures.mjs --dry-run             (validates closure; plans)
   → seedSandboxFixtures.mjs --projectId eos-platform-sandbox   (governed, idempotent seed)
   → post-seed verification → persona / F2 testing
```
Modules: `functions/scripts/fixtures/{fixtureSpec,sanitize,relationshipClosure,idMapping}.mjs` (pure,
unit-tested) + the two I/O shells. Tests: `functions/test/fixturePipeline.test.mjs`.

## 1. Canonical authorities (repository-verified — not inferred from UI)
| Domain | Collections (identity) |
|---|---|
| PARTS | `parts`(partId) · `manufacturers`(manufacturerId) · `part_aliases` |
| INVENTORY | `warehouses`(warehouseId) · `stock_locations`(warehouseId+partId+binCode) · `trucks`(truckId) · `mobile_locations`(locationId) |
| EQUIPMENT | `equipment_models`(equipmentModelId) · `equipment_model_aliases` · `equipment_part_compatibility`(modelId+partId) · `equipment`(equipmentId, installed asset) |
Excluded from v1 (deferred): `part_supplier_items` (supplier-confidential terms), `inventory_transactions`
(WO-scoped ledger), `equipment_compatibility_sources` (free-text evidence).

## 2. Representative selection (bounded; `MAX_PER_COLLECTION = 40`)
Per `SELECTION_CRITERIA`: parts — active / inactive / serialized-or-lot / standard / kit-or-service /
has-manufacturer; warehouses — active + distribution; stock_locations — positive + zero qty;
equipment_models — multiple types; equipment — active + non-active. Criteria are best-effort: a criterion
with no production match is skipped and reported, never faked. Required references are then closed.

## 3. Sanitization (`SANITIZER_VERSION 1.0.0`; allowlist — default-drop)
Only explicitly **KEEP** (verbatim) or **TRANSFORM** (deterministic sandbox token) fields survive; every
other field is **REMOVED**. Highlights: part numbers/model ids/serial *formats* kept for realism; customer/
account/location ids, employee/driver identity, notes/free-text, cost/pricing, supplier terms, audit actor
identities, timestamps, external-system ids, secrets → **removed**; `warehouses.address`, `trucks.displayLabel`,
`equipment.serialNumber` → **transformed** to deterministic `SBX-*` tokens (no production value ever emitted).

## 4. Identity rules
Canonical ids reused verbatim where safe (KEEP): `parts, manufacturers, warehouses, equipment_models,
trucks, mobile_locations` — preserving every reference. Remapped deterministically (REMAP): `equipment`
(may encode customer/site context; nothing in-scope references it). **`partId` is always preserved and never
set equal to `sku`/`internalPartNumber`** (`assertPartIdentityIntact` fails closed on conflation). Remap
collisions throw rather than resolve ad hoc; the forward map is recorded in the import mapping.

## 5. Provenance / manifest (OUTSIDE the business documents)
`manifest.json`: fixtureVersion, domains, source {environmentId, projectId, extractionDate, cap},
sanitizerVersion, per-collection {sourceCount, selectedCount, sha256, field classification}. Seeded docs
carry only a `__fixture: "operational-fixtures-v1"` tag — no provenance fields on canonical-shaped records.

## 6. Safety guards (enforced + tested)
- Extractor: **reads only** (a proxy throws on any write method), targets **production explicitly** with a
  required `--confirm-production-read` ack, no embedded credentials (operator ADC), bounded, emits counts +
  sha256. **Never** uses the service-account key in Downloads (rotate/revoke it separately).
- Importer: **refuses production** (`assertSandboxTarget`: role must be `sandbox`; refuses `taylor-parts`/
  unknown), requires `--projectId`, validates closure (dangling required refs → fail closed), fails closed on
  identity/schema mismatch, `--dry-run` plan, idempotent `set/merge` at deterministic doc ids, no unrelated
  deletes.

## 7. F2 scan-identity fixtures (what becomes scannable)
| Entity | Canonical identity | Representative scan token | Resolves to | Persona | Authorized next action |
|---|---|---|---|---|---|
| Part | `partId` | `internalPartNumber` (kept) | the `parts` record | tech / parts | plan / pick / record-used |
| Equipment (installed) | `equipmentId` (remapped) | transformed `SBX-SN-*` serial | the `equipment` record → model | technician | view context / (governed) actions |
| Warehouse | `warehouseId` | warehouseId | the `warehouses` record | warehouse / parts | destination selection |
Resolution + authorized-action separation is F2's job; these fixtures give it real entities to resolve.

## 8. Persona scenarios enabled
Technician (assigned WO + real-shaped equipment + planned parts: one ready / one short / one scannable
serialized asset); Parts/Warehouse (a part across multiple locations + a shortage); Purchasing (a WO-linked
reorder against a real-shaped partId); Receiving (PO receipt → warehouse destination → readiness); Dispatcher
(WOs with differing readiness/equipment). Persona agents then issue FUNCTIONAL + EXPERIENCE verdicts on real data.

---

## OPERATOR PRODUCTION-READ HANDOFF (fill merged commit after merge)
The tooling is repo-only; the **production read is operator-run**. Claude does not run it and does not use
production credentials.

```
Merged commit        : <filled after merge to main>
Command (operator)   : cd functions && node scripts/extractProductionFixtures.mjs \
                         --project taylor-parts --confirm-production-read \
                         --out ./_fixture-export --asOf <YYYY-MM-DD>   [--max N ≤ 40]
Production project    : taylor-parts  (registry role: production)
Read-only scope       : parts, manufacturers, part_aliases, warehouses, stock_locations, trucks,
                        mobile_locations, equipment_models, equipment_model_aliases,
                        equipment_part_compatibility, equipment  (bounded ≤ 40/collection + required closure)
Credentials           : operator ADC (gcloud application-default). NOT the Downloads service-account key.
Output location       : operator-controlled ./_fixture-export (sanitized inline; raw prod values NOT written)
Artifact hash         : manifest.json records per-collection sha256; verify counts before handing back
No writes             : the tool uses a read-only Firestore proxy that throws on any write method
```
After the operator returns the sanitized artifact, Claude continues autonomously: `seedSandboxFixtures.mjs
--dry-run` (verify closure + plan) → seed `eos-platform-sandbox` → verify seeded counts/relationships → run
persona/F2 scenarios. **Refresh is deliberate/versioned (v1 → v2 …), never automatic.**
