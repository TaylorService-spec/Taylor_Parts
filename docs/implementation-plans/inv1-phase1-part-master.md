---
artifact_type: implementation-plan
gate: Implementation Plan
status: Approved — Owner decisions O-1…O-12 (2026-07-22), recorded in DECISIONS.md #40
date: 2026-07-22
owner: Claude Code (Inventory)
related_adrs:
  - docs/architecture/ADR-008-part-master.md
depends_on:
  - docs/assessments/part-master-architecture.md
  - docs/specifications/part-master-architecture.md
  - docs/implementation-plans/enterprise-inventory-architecture.md
implements: Owner authorization "INV-1 Phase 1 — Part Master ADR & authorization review" (2026-07-22)
supersedes: none
superseded_by: none
related_pr: TBD (this PR)
target_release: none — governance artifact only
---

# Implementation Plan: INV-1 Phase 1 — Part Master

**This Plan authorizes NO implementation.** Every PR below requires its own Owner go-ahead; every PR stops for Owner review before merge; Rules and index changes are Tier 2; deploys carry separate authorize→deploy→verify gates. Verified against `origin/main` @ `8147c1a`.

## 1. Scope

Phase 1 of the adopted enterprise inventory architecture (Decision #37), gated on ADR-008 acceptance (D-4). Delivers the governed Part Master foundation: types/domain model, trusted write service, alias lookup, supplier-catalog normalization, unit conversion, reference compatibility, CSV dry-run tooling, and a read-path UI foundation. Excludes: serial/lot capture (Phase 6), receiving/warehouse activation (Phase 2), PO unification implementation (Phase 3), AI (Phase 7), tenant enforcement (#140).

## 2. Bounded PR sequence (all NOT AUTHORIZED)

| PR | Objective | Likely files | Depends | Tests | Rules | Indexes | Migration | Rollback |
|---|---|---|---|---|---|---|---|---|
| **1.1** | Part Master types, validators, pure domain model (identity, alias normalization, control classification, full field-authority table) | `functions/src/partMaster/types.ts`, `partMasterValidation.ts` (+ client mirrors per house convention) | ADR-008 accepted | pure unit suites | none | none | none | revert |
| **1.2** | Canonical Part repository + trusted write service (create/update/status, capability checks, idempotency, atomic audit; collections `parts`, `manufacturers`) | `functions/src/partMaster/partMasterCommands.ts` (+ inert exports) | 1.1 | command tests w/ atomicity-failure seams | closed-collection blocks (Tier 2, deploy-gated) | none | none | revert; Rules block inert until deploy gate |
| **1.3** | Identifier alias lookup + conflict handling (`part_aliases`, structural uniqueness, resolution order, conflict surfacing) | `partAliasCommands.ts`, `partAliasResolution.ts` | 1.2 | uniqueness/conflict/normalization suites | closed block | alias indexes (gated) | none | revert |
| **1.4** | Supplier catalog normalization (`part_supplier_items`; preferred-supplier invariant; dormant `supplier_catalog` marked superseded — no deletion, per D-3) | `partSupplierItemCommands.ts` | 1.2 | command tests | closed block | supplier-item indexes (gated) | none | revert |
| **1.5** | Unit conversion model (pure module + precision/rounding config; client mirror) | `unitConversion.ts` | 1.1 | property tests (round-trip, precision) | none | none | none | revert |
| **1.6** | Inventory-ledger reference compatibility: availability path reads Part records (replacing the static `warehouseQty` baseline with a governed baseline/aggregate); catalog lookups route through Part Master with static-catalog fallback | `inventoryService.ts` (bounded change), analytics engines | 1.2 | regression + parity tests vs current behavior | none | none | none | flag-guarded fallback to static catalog |
| **1.7** | Work Order snapshot compatibility: snapshots keep historical shape, gain canonical `partId` passthrough; no history rewrite | WO wizard + snapshot types (bounded) | 1.6 | WO engine regression (29/29 baseline) | none | none | none | revert |
| **1.8** | CSV dry-run migration tooling (contactCsvImport pattern; dry-run default; row-level report artifact; operator-invoked only) | `functions/scripts/importPartMasterCsv.js` + tests | 1.3, 1.4 | parser/mapping/dry-run suites | none | none | dry-run only | revert |
| **1.9** | UI read path + management foundation (Parts surfaces read from `parts` with static-catalog fallback; management screens read-only until write gates) | inventory module components (bounded) | 1.6 | verify-* suites | none | none | none | revert |
| **1.10** | Migration evidence + cutover preparation (seed/backfill runbook + operational handoff, validation gates, cutover checklist) — **execution is its own Owner gate** | docs + operator handoff | 1.1–1.9 | n/a (docs) | none | none | plan only | n/a |

Merge gate per PR: Owner review. Deployment gates: Rules (1.2–1.4 blocks) and indexes (1.3–1.4) deploy in one authorized batch after 1.4, verified per the Rows-19–22 house pattern; Functions exports stay inert ("export is not deployment") until their own authorization; production verification per deploy gate.

## 3. Sequencing notes

1.1→1.2→(1.3‖1.4‖1.5)→1.6→(1.7‖1.9)→1.8→1.10. Static catalog remains the fallback until the cutover gate — no behavior change lands unflagged. The `warehouseQty` baseline replacement (1.6) is the one point touching live availability math; it ships behind parity tests against current outputs.

## 4. Migration strategy (O-8; execution NOT authorized)

1. Profile current data — including an authorized read-only inspection of any part-adjacent production collections (`suppliers`, `supplier_catalog`, `stock_locations`, `purchase_orders`, reorder collections), since Gate 0.4(a) evidenced only that `fieldops_wos` is empty; repo part data is synthetic and no Part Master collection exists in the schema. 2. Canonical IDs: grandfather existing sku strings as `partId` for anything referenced by ledger/workflow/test fixtures; opaque IDs for new parts. 3. Alias map: sku → INTERNAL_PN + LEGACY aliases. 4. Create `parts` records (seed via 1.8 CSV dry-run → authorized run). 5. Supplier items from real supplier data (dormant `supplier_catalog` content, if any, mapped — not deleted). 6. Backfill references only where a field is absent; **never rewrite ledger/snapshot history**. 7. Dual-read (Part Master first, static catalog fallback). 8. Validation: parity report (counts, availability math, alias resolution) as evidence artifact. 9. Controlled cutover (Owner gate): fallback removed. 10. Legacy deprecation: static catalog files retired; dormant Epic 5 surfaces retired per D-3's later migration gate. Rollback pre-cutover: additive collections unused, fallback intact. Reconciliation: re-runnable parity report.

## 5. Registration in the enterprise plan

`docs/implementation-plans/enterprise-inventory-architecture.md` §7c records: Phase 0 CLOSED (evidence merged, PR #379); **ADR-008 Accepted (O-1…O-12 approved, DECISIONS.md #40); Phase 1 implementation NOT started; PR 1.1 is the recommended next separately authorized unit; PRs 1.2–1.10 remain unauthorized.** No prior governance history rewritten.

## 6. Owner decisions (APPROVED 2026-07-22 — recorded in `docs/DECISIONS.md` #40)

| # | Decision | Disposition |
|---|---|---|
| O-1 | Canonical identity | **APPROVED** — Option D hybrid + sku-grandfathering; ledger history never rewritten (Spec §1) |
| O-2 | Data model | **APPROVED** — Option C normalized top-level collections; Option D partial embedding remains a measured fallback only for bounded metadata proven necessary by implementation evidence (Spec §4) |
| O-3 | Alias storage | **APPROVED** — separately indexed alias docs, deterministic normalized doc IDs, structural uniqueness, explicit conflicts, active/inactive + source/audit metadata, tenant-prefix-compatible (Spec §2) |
| O-4 | Unit-of-measure | **APPROVED** — stockingUnit on Part + per-supplier purchaseUnit/conversion; one pure conversion authority; precision/rounding rules; history preserved as transacted (Spec §11) |
| O-5 | Supplier catalog | **APPROVED** — normalized `part_supplier_items` owning supplier identity/SKU/cost/currency/leadTime/MOQ/multiple/contract/availability/preferred/verification; supplier change never alters Part identity (Spec §3) |
| O-6 | Control classification | **APPROVED** — controlType (STANDARD/SERIALIZED/LOT/SERIALIZED_LOT + expiry tracking) × stockingClass (STOCKED/NON_STOCK/SERVICE/KIT) + flags; fields definable in Phase 1, serial/lot/expiry *behavior* deferred to its governed later phase; ADR-006 Part/serialized-instance/company-asset/customer-equipment boundary preserved (Spec §6) |
| O-7 | Tenant posture | **APPROVED** — tenant-ready, tenant-inert; no tenant records/fields/Rules/company-scoped runtime behavior; partitioning documented for #140 (Spec §12) |
| O-8 | Migration | **APPROVED** — §4 additive ten-step, grandfathered IDs, dual-read, parity evidence, Owner-gated cutover; **no migration authorized by the ADR merge** |
| O-9 | CSV contract | **APPROVED** — dry-run-first per Spec §8; explicit authorization before mutation mode; **no CSV implementation authorized by the ADR merge** |
| O-10 | Phase 1 PR sequence | **APPROVED as roadmap** — approval of the sequence does not authorize any of the ten PRs; each requires its own governed gate |
| O-11 | ADR-008 status | **APPROVED** — Accepted; adopted as `DECISIONS.md` #40 |
| O-12 | First implementation PR | **APPROVED AS NEXT-GATE RECOMMENDATION** — PR 1.1 (pure types/enums/validators/normalization/domain model) may be separately authorized after the ADR PR merges; **not authorized by that merge** |

## 7. Validation (of this package)

All current-state claims verified against `origin/main` @ `8147c1a` code (catalog interfaces, units distribution, rules write-postures, indexes file, CSV precedent, ADR-006 boundary, free-text supplierName, DECISIONS tail #38); ADR numbered 008 after inspecting `docs/architecture/`; deployment claims grounded in DECISIONS #36/#38 and the Gate 0.4(a) evidence; docs-only diff; no schema/Rules/Functions/index/frontend/migration/production change; DECISIONS.md #40 records the adoption (appended at the finalization gate after Owner approval of O-1…O-12).

### 2a. PR status (recorded 2026-07-22)

- **PR 1.1 — implemented, pending Owner-reviewed merge.** Pure-domain scope only: `functions/src/partMaster/` (types/enums/branded IDs, single normalization authority + GS1 check-digit validator + deterministic alias-key helper, scaled-integer unit conversion, validators, barrel) + `functions/test/partMasterDomain.test.mjs` (44 assertions, `npm run test:partMasterDomain`). **No persistence, no Firestore collections/Rules/indexes, no Functions-export change (`functions/src/index.ts` untouched), no frontend, no deployment, no migration.** Client mirrors deferred to the first client consumer (PR 1.9) per house mirror-what-you-consume convention.
- **PR 1.2 — not started. PRs 1.2–1.10 remain unauthorized. Migration not started.**

- **PR 1.2 — implemented, pending Owner-reviewed merge.** Canonical Part repository + trusted write service: `functions/src/partMaster/partMasterRepository.ts` (storage-independent `PartRepository`/`ManufacturerRepository` contracts, strict Firestore adapters/serializers for `parts/{partId}` + `manufacturers/{manufacturerId}`, malformed-stored-data surfacing, no physical delete) and `partMasterCommands.ts` (six internal trusted services: createPart/updatePart/changePartStatus/createManufacturer/updateManufacturer/changeManufacturerStatus — capability checks via the real Enterprise Access resolver, PR 1.1 domain validation, allowlisted updates, version-based optimistic concurrency, house idempotency [deterministic audit-doc ID + request fingerprint; exact replay = replayed, conflicting replay rejected], atomic audit staged in the same transaction). Registered: 6 camelCase `AuditAction`s; 2 registered-but-ungranted capabilities (`inventory.catalog.manage`, `inventory.catalog.activate` — every real resolution DENIES today). **Tier 2 Rules blocks (deploy-gated, NOT deployed):** `parts` + `manufacturers` fully closed (`allow read, write: if false`) in both rules files; `partMasterRules.test.js` (16) registered in the pinned runner (423→439). Status transitions per the accepted 5-value enum (DRAFT→ACTIVE; ACTIVE↔INACTIVE; ACTIVE|INACTIVE→DISCONTINUED|SUPERSEDED; terminals closed); SUPERSEDED relationship records = PR 1.4 authority; internalPartNumber mutable under governance with historical-lookup alias creation documented as a **PR 1.3 dependency**. No callable export (`functions/src/index.ts` untouched), no frontend, no alias/supplier/relationship persistence, no indexes, no deployment, no migration.
- **PR 1.3 — not started.** Migration not started.
