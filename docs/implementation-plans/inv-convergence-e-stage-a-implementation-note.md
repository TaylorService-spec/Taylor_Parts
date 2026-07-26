---
artifact_type: implementation-note
unit: INV-CONVERGENCE-E Stage A — live shadow-read orchestration & parity reporting (implementation)
status: Draft — awaiting Owner and ChatGPT final review (additive code + tests; draft PR)
date: 2026-07-26
owner: Claude Code (Inventory)
baseline: 39dec8246c2a23f762dd82e1f3a16e78ebaa2d27 (origin/main)
implements: docs/implementation-plans/inv-convergence-e-stage-a-handoff.md
related_decisions: "DECISIONS.md #43, #44, #45"
authorizes: nothing operational — non-authoritative diagnostic; no consumer wiring, Rules, writes, source switch, or deployment
---

# INV-CONVERGENCE-E Stage A — implementation note

Implements the approved Stage A handoff: a **read-only, non-authoritative** shadow-parity diagnostic. **No consumer wiring, no Rules change, no Firestore write, no source switch, no deployment.** Isolated from PartsList and PartDetail; not registered in navigation in this unit.

## Modules added (all additive)
- `src/domain/partsShadowParity.js` — **pure core** `runShadowParity(bundle)`. Deterministic; imports no Firebase, no network, no `partMasterQueries`, no clock/random; no input mutation. Derives counts + static-catalog hash (FNV-1a, browser-safe) from the captured arrays; verifies any supplied metadata; short-circuits canonical `BLOCKED_*` before comparison; builds the shadow model via the merged adapter and reports sanitized `{ status, evidence }`.
- `src/domain/partsShadowParityCapture.js` — **dependency-injected capture orchestrator** `captureShadowParity(readers)`. Assembles one immutable bundle from injected readers; no writes; one-shot reads (no subscriptions); each reader invoked at most once; a blocked canonical read short-circuits capture (other readers not called); failed canonical read → `canonicalRead.status` with `rows: null` (never `[]`).
- `src/domain/partsShadowParityView.js` — **pure sanitized view mapper** `toDiagnosticsView(result)` + `isDiagnosticsAuthorized(role)` (admin/dispatcher only). Exposes counts/hash/timestamps/`{key,kind}` summaries only.
- `src/modules/inventory/PartsShadowParityDiagnostics.jsx` — **admin/dispatcher-gated diagnostics surface**, isolated from PartsList/PartDetail, not wired into nav. Renders the sanitized view.
- `src/modules/inventory/partsShadowParityReaders.js` — production reader bundle (wires canonical + static; clock/runId here, never in the core; ledger/reorder/PO live readers are a later isolated wiring step — until then they report unavailable → `BLOCKED_INCOMPLETE_INPUT`).

## Result states
`PASS` / `FAIL_PARITY` / `BLOCKED_PERMISSION` / `BLOCKED_UNAVAILABLE` / `BLOCKED_INCOMPLETE_INPUT`. A denied/unavailable canonical read → the matching `BLOCKED_*` (never empty/"190 missing"/`FAIL_PARITY`). Any supplied-metadata↔content mismatch → `BLOCKED_INCOMPLETE_INPUT`.

## Tests (offline; registered in `npm test`)
- `test/partsShadowParity.test.mjs` (16) — PASS; FAIL_PARITY (name/unit/unmatched); every BLOCKED state; counts/hash derivation + mismatch→BLOCKED; determinism/purity; sanitization; summary shape.
- `test/partsShadowParityCapture.test.mjs` (7) — injected fakes: permission-denied/unavailable/success mappings; absent-not-empty; short-circuit (other readers not called); failed-required→BLOCKED_INCOMPLETE_INPUT; ≤1 call/reader; no-write/no-subscription source scan.
- `test/partsShadowParityView.test.mjs` (8) — authorization; view mapping for PASS/FAIL/every BLOCKED; sanitization; PartsList/PartDetail isolation (both directions).

Full `npm test` chain, `typecheck`, `lint` (oxlint), and `build` are green. Diagnostic output is ephemeral in-memory only; **not persisted to Firestore**; optional sanitized export remains a separate reviewed operator step. Offline parity is not the live pre-cutover parity (Decision #44). Decisions #43–#45 unchanged; no contradiction found.
