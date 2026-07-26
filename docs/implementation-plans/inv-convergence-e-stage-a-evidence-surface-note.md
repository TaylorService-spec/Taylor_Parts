---
artifact_type: implementation-note
unit: INV-CONVERGENCE-E Stage A — evidence-surface correction (implementation)
status: Draft — awaiting Owner and ChatGPT review (additive code + tests; draft PR)
date: 2026-07-26
owner: Claude Code (Inventory)
baseline: e93913851b7f1939236f1dade573b523afb61432 (origin/main)
related_decisions: "DECISIONS.md #43, #44, #45"
authorizes: no deployment; read-only diagnostic surface only; no Rules/Functions/index/data change
---

# INV-CONVERGENCE-E Stage A — evidence-surface correction (note)

The first live run returned `PASS` (technical parity proven), but `PartsShadowParityDiagnostics.jsx` rendered only a subset of fields — it omitted the **capture timestamps** and **sourceCounts** that `toDiagnosticsView()` already preserves. Decision #44 requires capture timestamps in the committed PASS artifact, so this correction makes the full sanitized evidence **visible and copyable** without inventing any missing values.

## Changes (additive, scoped)
- `src/modules/inventory/PartsShadowParityDiagnostics.jsx` — renders, for **every recognized result**, the sanitized fields: `status`, `capturedAtStart`, `capturedAtEnd`, `runId`, `buildId` (`adapterCommit`), `staticCatalogHash`, `sourceCounts`, and all eight parity counts (`—` where absent). Adds a **manual "Copy sanitized evidence"** button.
- `src/domain/partsShadowParityView.js` — adds the pure `sanitizedEvidencePayload(view)` builder. **Scope note:** the review's permitted-change list named the component; this one additive export lives in the pure view module because requirement #5 (prove the payload contains every required field and no prohibited fields) needs an **offline-testable** function, and a `.jsx` cannot be imported by the plain-Node tests. It is purely additive — no existing behavior changed.
- `test/partsShadowParityView.test.mjs` — evidence-surface tests (below).

## Copy action semantics
Manual only (button, gated on a result existing — unavailable before execution). It copies **only** `JSON.stringify(sanitizedEvidencePayload(view))` via `navigator.clipboard.writeText`. It performs **no Firestore write, no network request, no automatic download, no persistence**, and exposes **no** credentials, tokens, UIDs, emails, raw records, or per-row divergence values. Payload shape:
```
{ status, counts:{canonicalMatch,staticOnlyExcluded,rowMissing,fieldDivergence,
  availabilityDivergence,workflowDivergence,unexpectedUnmatched,structuralIssue},
  sourceCounts, staticCatalogHash, buildId, runId, capturedAtStart, capturedAtEnd }
```
Only a `status = PASS` payload can qualify for Decision #44; `FAIL_PARITY`/`BLOCKED_*` payloads are diagnostic evidence only (surfaced in the UI copy).

## Tests (offline; `partsShadowParityView.test.mjs`, 22 total)
Added: timestamps render; sourceCounts render; copied payload contains **every** required field; payload contains **no** prohibited identity/raw-record/divergence-value fields; copy is null (unavailable) before a result; BLOCKED/FAIL yield copyable diagnostic payloads (no divergence values; absent fields → null, never fabricated); component renders the sanitized fields + a manual Copy action gated on a result; copy performs no write/network/download/persistence. Preserved: authorization, dedicated route + no nav entry, single active run, isolation, rejection handling, reader wiring, run-id provider.

Full `npm test` chain, `typecheck`, `oxlint`, and `build` are green. **No deployment.** Decisions #43–#45 unchanged.

## First PASS status
The first live `PASS` (runId `run-f8f26d71-1`, buildId `5609496`, staticCatalogHash `fnv1a32:f65d57fb`, 190/10/0…0) **remains valid technical parity evidence** but is **not** used as the final Decision #44 artifact — its capture timestamps were not surfaced/exported. A subsequent run on the redeployed bundle produces the qualifying artifact; no timestamps are fabricated. Evidence export + repository commit remain a separate reviewed operator step.
