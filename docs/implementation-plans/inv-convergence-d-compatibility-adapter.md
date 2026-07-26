---
artifact_type: implementation-note
unit: INV-CONVERGENCE-D — read-only compatibility adapter + offline shadow-parity
status: Draft — awaiting Owner and ChatGPT review (docs + additive code; draft PR)
date: 2026-07-25
owner: Claude Code (Inventory)
baseline: 33ade1731b51a9c9c9a6509281d78b94fda3e54d (origin/main)
implements: docs/architecture/inventory-parts-authority-contract.md (Decision #45)
related_decisions: "DECISIONS.md #43, #44, #45"
authorizes: nothing operational — no consumer wiring, source switch, Rules, Functions, writes, or deployment
---

# INV-CONVERGENCE-D — parts compatibility adapter (implementation note)

First additive compatibility layer for Inventory → Parts. Adds a **pure, read-only** adapter plus **deterministic offline** shadow-parity tests. **No UI or runtime consumer imports or calls it; no behavior changes.**

## Module boundary

`field-ops-app-vite/src/domain/partsCompatibilityAdapter.js` — a pure function of explicitly-injected inputs. It performs **no** network access and imports **no** Firebase SDK, **no** Firebase configuration, and **no** Firestore query service (in particular it does **not** import `services/partMasterQueries.js`, which remains the future canonical-row loader). It never writes and never mutates its inputs. Enforced by test group G (source scan + purity).

## Input / output contract

**Inputs** (all optional; nothing mutated):
- `canonicalParts` — canonical `parts` view records (`partId`, `internalPartNumber?`, `name?`, `category?`, `stockingUnit?`, `status?`, `controlType?`, `stockingClass?`).
- `staticCatalogParts` — static catalog rows (`sku`, `name`, `category`, `unit`, `cost`, `price`, `reorderThreshold`, `warehouseQty`).
- `overlayBySku` — **precomputed** `{ reserved?, released?, consumed?, availability? }` per sku (produced upstream by the existing behavior; see below).
- `workflowBySku` — `{ reorderState?, purchasingState? }` per sku (pass-through).
- `snapshotBySku` — optional historical Work Order snapshot values (test-only wiring).

**Output** — `{ rows, issues, totals }`, deterministic (rows sorted by key). Each row: `{ key, identityState, fields }`, where every field is `{ value, source, derivedFrom? }`.

## No new inventory mathematics

Availability is **not** computed here. The existing formula lives in `src/domain/inventoryAnalyticsEngine.ts` (`computeAvailableStockByPart`: `available = warehouseQty − (reserved − released)`, CONSUMED not re-subtracted). The adapter takes the already-computed `availability` as an **injected** value and passes it through **verbatim** — proven by test D (a sentinel value is returned unchanged; the adapter contains no arithmetic on it).

## Provenance semantics

Allowed primary classifications: `CANONICAL` · `STATIC_FALLBACK` · `LEDGER_DERIVED` · `WORKFLOW_DERIVED` · `HISTORICAL_SNAPSHOT`. Each output field exposes exactly one primary `source`; calculated values additionally disclose `derivedFrom`. Current availability is mixed-provenance and is disclosed as `source: "STATIC_FALLBACK", derivedFrom: ["STATIC_FALLBACK","LEDGER_DERIVED"]` (its value depends on the static `warehouseQty` baseline and ledger-derived reservations). The adapter must **not** describe availability as final physical-on-hand truth (authority contract §1).

Field authority in a `CANONICAL_MATCH` row: identity/governance (`partId`, `internalPartNumber`, `name`, `category`, `stockingUnit`, `status`, `controlType`, `stockingClass`) is canonical-preferred (`CANONICAL`), with static compatibility fallback where a canonical field is absent (source then reflects the actual origin). Commercial/`warehouseQty` fields are always `STATIC_FALLBACK` and are **never copied into `parts`**.

## Approved static-only exclusions

The ten INV-CONVERGENCE-B / Decision #44 records — `TST-1047, 1070, 1074, 1080, 1112, 1136, 1143, 1175, 1189, 1193` — may remain represented through static compatibility (`identityState: "STATIC_ONLY_EXCLUDED"`) to preserve current PartsList/PartDetail behavior. The adapter **never** represents them as canonical and **never** infers canonical status for them; their exclusion reason remains Decision #42 policy attribution.

## Deterministic failure behavior (never silent)

The adapter detects and reports, rather than hides, parity problems — surfaced in `issues`, never resolved by silently overwriting one source with another: `DUPLICATE_CANONICAL_PARTID`, `DUPLICATE_STATIC_SKU`, `CANONICAL_WITHOUT_STATIC`, `STATIC_WITHOUT_CANONICAL_UNAPPROVED` (any static-only record outside the approved ten — not emitted as a row), `NAME_DIVERGENCE`, `UNIT_DIVERGENCE`, `MISSING_IDENTIFIER`, and `UNKNOWN_PROVENANCE` (via `validateRowProvenance`). All covered by test group F.

## Offline parity ≠ live pre-cutover parity

The tests (`field-ops-app-vite/test/partsCompatibilityAdapter.test.mjs`) are deterministic and **offline** — fixtures are the committed INV-CONVERGENCE-B production read-back and the static catalog; they access no Firebase, need no credentials, and touch no production. **This offline parity is NOT the live shadow-parity that Decision #44 requires immediately before any future cutover.** Parity totals proven offline: 200 static · 190 `CANONICAL_MATCH` · 10 `STATIC_ONLY_EXCLUDED` · 0 name divergence · 0 normalized-unit divergence.

## No source switch authorized

This unit authorizes **no** consumer wiring and **no** source switch. No UI or runtime consumer imports the adapter; PartsList, PartDetail, PartMasterList, role homes, Operations panels, FieldMode, Work Order consumers, navigation, Rules, Functions, indexes, and Firebase/deploy configuration are unchanged. Any switch is a separate, later reviewed gate (Phase C), which also carries the operational-role `parts` read-broadening Rules decision. Decisions #43–#45 are unchanged; no contradiction was found during implementation.
