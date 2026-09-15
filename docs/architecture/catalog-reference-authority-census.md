# Catalog reference authority — census and PostgreSQL target (Lane D)

Baseline: main `799bccba`. Scope: the PART and EQUIPMENT_MODEL identities the C2 Commercial command layer
validates through `CommercialCatalogAuthority.verifyReferences` (`functions/src/eosCommercial/commands/commercialCommandKernel.ts`).

Classes: **A** canonical PostgreSQL authority · **B** PostgreSQL schema exists, not authoritative / not populated ·
**C** Firestore-only authority · **D** derived · **E** legacy defect · **F** Owner decision.

## 1. PART

| Surface | Evidence | Class |
|---|---|---|
| Firestore `parts/{partId}` — Part Master record; doc id IS `Part.partId` (== operational SKU, Decision #44); no physical delete, lifecycle status only (`DRAFT/ACTIVE/INACTIVE/SUPERSEDED/DISCONTINUED`); no tenant field | `functions/src/partMaster/partMasterRepository.ts`, `types.ts`, `validation.ts` (`parsePartId` = `/^[A-Za-z0-9_-]{1,64}$/`) | **C** |
| Part Master writer (create/update, alias backfill) | `functions/src/partMaster/partMasterCommands.ts`, `partMasterCallables.ts`; data import `functions/src/dataImport/firestoreDataImportAdapters.ts` | **C** |
| PostgreSQL `parts` table | none before this change; migration 006 carries `supplier_catalog_items.part_id` unjoined "because Part remains Firestore-authoritative" | — |
| eos_ops `part_id` columns (cycle counts, movements, supplier catalog items, purchasing) | migrations 1758499200000, 1758672000000 and earlier; gate `functions/src/eosOps/migration/partIdContract.ts` | **B** (format-gated, unjoined) |
| Static `functions/src/data/partsCatalog.ts` | its own header: metadata, no identity authority | **E** |
| Consumers: WO parts plan / consumption / install, scanner lookup, SO allocation (`fulfillment/allocateSalesOrder.ts` by PART ref), product picker | `grep PARTS_COLLECTION` | **D** |

## 2. EQUIPMENT_MODEL

| Surface | Evidence | Class |
|---|---|---|
| Firestore `equipment_models/{equipmentModelId}` — canonical `{manufacturerId}--{modelNumber}`; status `DRAFT/ACTIVE/INACTIVE/RETIRED` | `functions/src/equipmentCompatibility/domain/equipmentModel.ts`, `equipmentModelRepository.ts`, writer `commands.ts` | **C** |
| `eos_ops.equipment_models` — PK `(tenant_id, id)`, canonical-shape CHECK, status enum | migration `1758585600000_equipment-and-installed-custody.sql` | **B** (unwired repository writer `functions/src/eosOps/equipmentCustody.ts#recordEquipmentModel`; populated by nothing) |
| `parts.equipmentModelId` (whole-unit link), `eos_ops.equipment.equipment_model_id` | `partMaster/types.ts`, migration 008 | **D** |

## 3. What a Commercial line `ref` points at today

- Sales Agreement create / draft edit / accept: `functions/src/salesAgreement/salesAgreementLineReferences.ts` resolves
  PART → `parts/{ref}`, EQUIPMENT_MODEL → `equipment_models/{ref}` inside the committing transaction. Rules:
  **existence and kind only** (explicitly no sellability / status rule), own kind first, then the other collection
  for a WRONG_KIND message. SERVICE has no authority.
- Firestore Opportunity and Sales Order builders check only that `ref` is non-empty
  (`opportunity/opportunityCommands.ts:135`, `salesOrder/salesOrderCommands.ts:144`) — **E** (unvalidated legacy refs;
  a C5 data copy must resolve them rather than assume).
- PostgreSQL line tables store `ref TEXT` with no catalog key (migration 022). C2 validates every new PART /
  EQUIPMENT_MODEL ref through the port.

Settled from repository truth (no Owner semantic decision needed): PART ref = `Part.partId` verbatim; EQUIPMENT_MODEL
ref = canonical `equipmentModelId` = `eos_ops.equipment_models.id`; the two kinds are separate namespaces (two
collections, nothing forbids one string in both) so WRONG_KIND is "not own kind, but other kind", own kind first;
PostgreSQL catalog identity is tenant-scoped (008's composite key); lifecycle status does not change a reference
verdict.

## 4. PostgreSQL target built here

- Migration `1759708800000_catalog-part-identity-reference-authority.sql` (025): `eos_ops.parts (tenant_id, id)` —
  the canonical Part identity only (format CHECK, tenant FK, actor). No status, no descriptive fields, no data, no
  writer, no sync, no FKs from existing `part_id` columns. Down refuses while rows exist.
- `functions/src/catalogAuthority/postgresCatalogReferenceAuthority.ts`: one frozen object, one method, one fixed
  parameterized read over `eos_ops.parts` and `eos_ops.equipment_models`, on the command's own transaction client.

## 5. Not done here

- Part Master and Equipment Model catalog writers still write Firestore; both PostgreSQL tables are empty in every
  environment. A composed PostgreSQL catalog authority therefore answers NOT_FOUND (fail-closed) until a governed
  catalog cutover (copy once → verify → reconcile → cut over writer). Owner ruling D2 (2026-09-14) excluded catalog
  migration from the Commercial wave — **F**.
- Composition into `functions/src/eosApi/server.ts` — CATALOG_CUTOVER_TAIL, gated on proven population and
  reconciliation; a static ratchet (`functions/test/catalogReferenceAuthority.test.mjs`) keeps it absent until then.
