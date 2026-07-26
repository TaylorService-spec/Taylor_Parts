---
artifact_type: implementation-note
unit: INV-CONVERGENCE-E Stage A FOUNDATION — shadow-parity comparison engine (implementation)
status: Draft — awaiting Owner and ChatGPT review (additive code + tests; draft PR)
date: 2026-07-26
owner: Claude Code (Inventory)
baseline: 39dec8246c2a23f762dd82e1f3a16e78ebaa2d27 (origin/main)
implements: docs/implementation-plans/inv-convergence-e-stage-a-handoff.md
related_decisions: "DECISIONS.md #43, #44, #45"
authorizes: nothing operational — non-authoritative; no consumer wiring, Rules, writes, source switch, or deployment
---

# INV-CONVERGENCE-E Stage A FOUNDATION — implementation note

**Option B — foundation only.** This unit implements the full Stage A **comparison engine** (real current-vs-shadow model comparison + snapshot-derived overlays + tests) but **does not** wire the live ledger/reorder/PO readers or a reviewed diagnostics route, so it **cannot yet produce Decision #44 live pre-cutover parity**. Completing Stage A (live one-shot readers + a real build identifier + an explicitly-reviewed admin/dispatcher diagnostics route) remains a **separate, reviewed step**. Read-only, non-authoritative; no consumer wiring, no Rules, no writes, no source switch, no deployment. Isolated from PartsList/PartDetail; not registered in navigation.

## What Stage A now does (comparison engine — complete)
`runShadowParity(bundle)` builds **two models from the same immutable captured bundle** and compares them explicitly:
- **CURRENT operational model** — reproduces the identity/values PartsList/PartDetail derive today: **static-catalog identity** + snapshot-derived overlay.
- **SHADOW model** — the same fields sourced through `buildPartsWorkspace()` (**canonical identity**).
- **`compareModels()`** emits deterministic sanitized `{ key, kind }` divergences: `CURRENT_SHADOW_ROW_MISSING`, `CURRENT_SHADOW_FIELD_DIVERGENCE`, `CURRENT_SHADOW_AVAILABILITY_DIVERGENCE`, `CURRENT_SHADOW_WORKFLOW_DIVERGENCE`. Compared fields: partId/sku, name, category, normalized unit, cost, price, reorderThreshold, warehouseQty, reserved/released/consumed, availability, reorder state, purchasing state. A **PASS requires the two models to agree**; adapter self-validation issues are additional evidence, not a substitute.

## Overlays derived inside the run boundary (no caller authority)
`deriveLedgerOverlay()` computes reserved/released/consumed by sku and `availability = warehouseQty − (reserved − released)` (CONSUMED not re-subtracted) — the **existing** `computeAvailableStockByPart` semantics (inventoryAnalyticsEngine.ts), re-expressed as a pure browser-safe helper, no new mathematics. `deriveWorkflowBySku()` derives reorder/purchasing state from the reorder/PO snapshots. **Caller-supplied `overlayBySku`/`workflowBySku` are ignored** — a test proves injecting a bogus overlay cannot change the result. Both model builders consume the same derived structures, so evidence counts and the comparison always describe the same data.

## Blocked/derived integrity
- Canonical `PERMISSION_DENIED`/`UNAVAILABLE` → matching `BLOCKED_*` before any comparison; canonical `rows: null` (never `[]`).
- Missing required input (canonical rows / static rows / ledger / reorder / PO snapshot) → `BLOCKED_INCOMPLETE_INPUT`.
- **Missing/`"unknown"` `adapterCommit` → `BLOCKED_INCOMPLETE_INPUT`** (a run without a real build identifier cannot PASS).
- Counts + static-catalog hash are **derived** from captured arrays; supplied-metadata mismatch → `BLOCKED_INCOMPLETE_INPUT`.

## Modules
- `src/domain/partsShadowParity.js` — pure engine: `runShadowParity`, `deriveLedgerOverlay`, `deriveWorkflowBySku`, `buildCurrentModel`, `buildShadowModel`, `compareModels`, `deriveCounts`, `deriveStaticCatalogHash`, `PARITY_STATES`, `DIVERGENCE_KINDS`. No Firebase/network/`partMasterQueries`/clock/random; no input mutation.
- `src/domain/partsShadowParityCapture.js` — DI capture orchestrator; injected readers; no writes; one-shot reads; ≤1 call/reader; failed canonical → `canonicalRead.status` (`rows:null`); blocked canonical short-circuits (other readers not called); derives nothing itself (passes snapshots to the core).
- `src/domain/partsShadowParityView.js` — sanitized view mapper (model-comparison + adapter counts) + `isDiagnosticsAuthorized(role)` (admin/dispatcher).
- `src/modules/inventory/PartsShadowParityDiagnostics.jsx` — admin/dispatcher-gated surface; isolated; **not nav-wired**.
- `src/modules/inventory/partsShadowParityReaders.js` — **foundation** reader bundle: canonical+static wired; ledger/reorder/PO report `unavailable`; `adapterCommit: null` → a live run resolves `BLOCKED_INCOMPLETE_INPUT` (honest, never a false PASS). `isLiveReaderBundleComplete()` returns false for it.

## Tests (offline; registered in `npm test`)
- `partsShadowParity.test.mjs` (21) — two independent models from one bundle; PASS requires equality; deliberate field/availability/reorder/purchasing/row-missing divergences → the right kinds; overlays derived from captured rows; injected overlays cannot bypass; every BLOCKED incl. missing-commit; counts/hash derivation + mismatch; determinism/purity/sanitization.
- `partsShadowParityCapture.test.mjs` (8) — DI fakes: permission/unavailable/success translation; absent-not-empty; short-circuit; incomplete-input; missing-commit→BLOCKED; ≤1 call/reader; no-write/no-subscription.
- `partsShadowParityView.test.mjs` (10) — authorization; mapping (PASS/FAIL/every BLOCKED); sanitization; PartsList/PartDetail isolation (both directions); **reader bundle classified foundation**; diagnostics not nav-wired.

Full `npm test` chain, `typecheck`, `oxlint`, and `build` are green. Diagnostic output ephemeral in-memory only; **not persisted to Firestore**. Offline parity is NOT the live pre-cutover parity (Decision #44). Decisions #43–#45 unchanged; no contradiction found.

## Remaining to complete Stage A (separate reviewed step)
Wire one-shot live readers for ledger/reorder/PO (reusing existing read paths; no new query surface, no subscriptions, one call each), provide a real deterministic build/commit identifier, and add an explicitly-reviewed admin/dispatcher diagnostics route (or host it in an existing administration diagnostics surface) — kept isolated from PartsList/PartDetail. Only then can a live `PASS` constitute Decision #44 evidence.
