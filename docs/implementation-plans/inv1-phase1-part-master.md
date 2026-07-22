---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft — awaiting Owner decisions O-1…O-12
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

1. Profile current data (production parts data: none — Gate 0.4(a) found zero WOs; repo data is synthetic). 2. Canonical IDs: grandfather existing sku strings as `partId` for anything referenced by ledger/workflow/test fixtures; opaque IDs for new parts. 3. Alias map: sku → INTERNAL_PN + LEGACY aliases. 4. Create `parts` records (seed via 1.8 CSV dry-run → authorized run). 5. Supplier items from real supplier data (dormant `supplier_catalog` content, if any, mapped — not deleted). 6. Backfill references only where a field is absent; **never rewrite ledger/snapshot history**. 7. Dual-read (Part Master first, static catalog fallback). 8. Validation: parity report (counts, availability math, alias resolution) as evidence artifact. 9. Controlled cutover (Owner gate): fallback removed. 10. Legacy deprecation: static catalog files retired; dormant Epic 5 surfaces retired per D-3's later migration gate. Rollback pre-cutover: additive collections unused, fallback intact. Reconciliation: re-runnable parity report.

## 5. Registration in the enterprise plan

`docs/implementation-plans/enterprise-inventory-architecture.md` §7b is updated in this PR to add: Phase 0 CLOSED (evidence merged, PR #379); **Part Master ADR (ADR-008) Proposed — in Owner review; Phase 1 implementation NOT started; first implementation PR NOT authorized.** No prior governance history rewritten.

## 6. Owner decisions required (none assumed)

| # | Decision | Recommendation |
|---|---|---|
| O-1 | Canonical identity | Option D hybrid + sku-grandfathering (Spec §1) |
| O-2 | Data model | Option C normalized top-level collections (Spec §4) |
| O-3 | Alias storage | Separate indexed `part_aliases`, doc-ID structural uniqueness (Spec §2) |
| O-4 | Unit-of-measure | Stocking unit on Part + per-supplier purchase unit/conversion; history preserved as transacted (Spec §11) |
| O-5 | Supplier catalog | Normalized `part_supplier_items`; dormant `supplier_catalog` superseded, not deleted (Spec §3) |
| O-6 | Control classification | controlType × stockingClass + flags, stored inert in Phase 1 (Spec §6) |
| O-7 | Tenant posture | Tenant-ready-tenant-inert per Spec §12; no fields now |
| O-8 | Migration strategy | §4 ten-step, grandfathered IDs, no history rewrite |
| O-9 | CSV contract | Spec §8, contactCsvImport pattern, dry-run default |
| O-10 | Phase 1 PR sequence | §2 (1.1–1.10) |
| O-11 | ADR-008 status | Accept (currently Proposed) |
| O-12 | First implementation PR | Authorize PR 1.1 (pure types/domain — zero Rules/index/deploy surface) as the next gate after O-1…O-11 |

## 7. Validation (of this package)

All current-state claims verified against `origin/main` @ `8147c1a` code (catalog interfaces, units distribution, rules write-postures, indexes file, CSV precedent, ADR-006 boundary, free-text supplierName, DECISIONS tail #38); ADR numbered 008 after inspecting `docs/architecture/`; deployment claims grounded in DECISIONS #36/#38 and the Gate 0.4(a) evidence; docs-only diff; no schema/Rules/Functions/index/frontend/migration/production change; DECISIONS.md untouched (posture per gate §24: ADR Proposed, decisions presented, no entry before Owner approval).
