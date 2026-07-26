---
artifact_type: implementation-handoff
unit: INV-CONVERGENCE-E Stage A — live shadow-read orchestration & parity reporting
status: Draft — HANDOFF ONLY, awaiting Owner and ChatGPT review; authorizes no implementation
date: 2026-07-26
owner: Claude Code (Inventory)
baseline: fce7e3f005dce79e4baae93bb6fb6bca9e0bf006 (origin/main)
implements: docs/implementation-plans/inv-convergence-e-shadow-read-and-convergence.md (Stage A)
builds_on: docs/implementation-plans/inv-convergence-d-compatibility-adapter.md
related_decisions: "DECISIONS.md #43, #44, #45"
authorizes: nothing — this is a scope/handoff for a future, separately-authorized Stage A implementation
---

# INV-CONVERGENCE-E Stage A — implementation handoff

Scope and acceptance criteria for the **future** Stage A implementation unit (live shadow-read orchestration + parity reporting). **This document is a handoff only; it authorizes no code, no wiring, no Rules change, no write, and no deployment.** Stage A has not begun.

Stage A produces the **Decision #44 live pre-cutover parity** evidence. It is diagnostic and **non-authoritative** — it changes no product behavior and is not a data source.

## 1. Hard constraints (Stage A must satisfy all)

- **admin/dispatcher only** under the current Rules (uses the existing `parts` read grant unchanged);
- **non-authoritative** — evidence only, never a source consumers read from;
- **read-only** — no Firestore writes of any kind;
- **isolated from PartsList and PartDetail** — Stage A imports neither, and neither imports Stage A; no consumer is wired;
- **no Rules changes**, **no source switching**, **no deployment authorization**;
- reuses the merged read-only adapter (`src/domain/partsCompatibilityAdapter.js`) and the existing read-only query service (`services/partMasterQueries.js`, `fetchPartMasterList()`); adds **no** new query surface.

## 2. Module boundary (proposed shape)

Two layers, so the comparison stays deterministically testable in plain Node:

1. **Pure parity core** — e.g. `src/domain/partsShadowParity.js` — a pure function `runShadowParity(bundle)` that takes one **already-captured** immutable bundle and returns `{ status, evidence }`. No Firebase, no network, no `partMasterQueries` import, no clock/random; deterministic; does not mutate inputs. (Same purity discipline as the merged adapter; enforced by a source scan test.)
2. **Thin capture orchestrator** — e.g. `src/domain/partsShadowParityCapture.js` (or a hook/service) — captures the bundle from the existing read-only services and hands it to the pure core. This layer is the only place that touches live reads; it performs **no writes** and is **not** unit-tested against live data. It must translate a failed canonical read into a `canonicalRead` status (below), never into empty data.

A diagnostic surface (admin/dispatcher-gated) renders the result. It must **not** be reachable by, or wired into, PartsList/PartDetail.

## 3. Deterministic run boundary (from the plan §A.1)

`runShadowParity` consumes ONE immutable bundle; **both** the current operational model and the shadow model are built **only** from it — no independent refetch/subscribe during comparison:

```
bundle = {
  runId,                       // opaque id supplied by the caller (no clock in the pure core)
  capturedAtStart, capturedAtEnd,   // ISO timestamps supplied by the orchestrator
  adapterCommit,               // adapter/app commit SHA
  canonicalRead: { status: "OK" | "PERMISSION_DENIED" | "UNAVAILABLE", rows: [...]|null },
  staticCatalog: { version, contentHash, rows: [...] },
  ledgerSnapshot: [...]|null,        // the transactions used by current availability
  reorderSnapshot: [...]|null,
  poSnapshot: [...]|null,            // where included
  sourceCounts: { canonical, static, ledger, reorder, po },
}
```

The current-model builder must be given these same snapshots (not live subscriptions). The pure core recomputes nothing live.

## 4. Result states (exactly one per run)

- `PASS` — full bundle captured; shadow model matches the current model within the accepted parity rules (200 source / 190 CANONICAL_MATCH / 10 STATIC_ONLY_EXCLUDED / 0 name / 0 unit divergence / 0 unexpected unmatched / 0 provenance issues).
- `FAIL_PARITY` — full bundle captured, but a real divergence exists (name/unit divergence, unexpected unmatched, provenance issue, or count mismatch).
- `BLOCKED_PERMISSION` — `canonicalRead.status === "PERMISSION_DENIED"`.
- `BLOCKED_UNAVAILABLE` — `canonicalRead.status === "UNAVAILABLE"`.
- `BLOCKED_INCOMPLETE_INPUT` — any required bundle input missing/uncaptured (e.g. `staticCatalog.rows == null`, missing `ledgerSnapshot` when required).

**Non-negotiable:** a permission-denied or unavailable canonical read MUST yield the corresponding `BLOCKED_*` — it must **never** be converted into an empty canonical list, "190 missing", or `FAIL_PARITY`. `BLOCKED_*` short-circuits before any divergence computation.

## 5. Diagnostic output — exact location and retention

- **Location:** the result is **ephemeral, in-memory**, rendered to an **admin/dispatcher-gated diagnostics view** (and/or returned to the caller). It is **NOT persisted to Firestore** — persistence would be a write, which is prohibited in Stage A.
- **Retention:** **none by default.** The result exists for the session/render and is recomputed on demand; there is no automatic persistence, log-shipping, or background retention.
- **Optional archival (separate, reviewed step — not Stage A runtime):** an operator may **manually export** the sanitized result JSON and commit it under `docs/audits/inv-convergence-e-stage-a/` (SHA-256 + attestation), following the INV-CONVERGENCE-B evidence pattern. This is an operator action in a separate PR, not a runtime behavior of Stage A.
- **Sanitization (enforced):** the emitted result contains only `runId`, `adapterCommit`, `staticCatalog.contentHash`, timestamps, `sourceCounts`, the parity counts (§6), and a `reason` when not `PASS`. It **must not** contain credentials, tokens, UIDs, emails, or full production part records; per-field divergences are reported as **summaries** (e.g. `{ key, field, kind }`), never full record dumps.

## 6. Evidence fields (result payload)

`runId · adapterCommit · staticCatalogHash · capturedAtStart · capturedAtEnd · sourceCounts · canonicalMatchCount (expect 190) · staticOnlyExcludedCount (expect 10) · unexpectedUnmatchedCount · nameDivergenceCount · normalizedUnitDivergenceCount · provenanceIssueCount · status · reason(when not PASS)`.

## 7. Required tests (offline, plain Node; house convention; registered in `npm test`)

Deterministic, fixture-driven (committed INV-CONVERGENCE-B read-back + static catalog; no Firebase/credentials/network). Must cover **every** result state:

- **PASS** — full valid bundle → `PASS` with 190/10/0/0/0/0.
- **FAIL_PARITY** — inject a name divergence, a normalized-unit divergence, and an unexpected unmatched record (separately) → `FAIL_PARITY` with the right non-zero counts.
- **BLOCKED_PERMISSION** — `canonicalRead.status = "PERMISSION_DENIED"` → `BLOCKED_PERMISSION`; assert canonical is treated as **absent, not empty**; assert **no** `FAIL_PARITY`, **no** "190 missing", **no** count fabrication.
- **BLOCKED_UNAVAILABLE** — `canonicalRead.status = "UNAVAILABLE"` → `BLOCKED_UNAVAILABLE`; same non-conversion assertions.
- **BLOCKED_INCOMPLETE_INPUT** — a missing required input (e.g. `staticCatalog.rows = null`) → `BLOCKED_INCOMPLETE_INPUT`.
- **Determinism/purity** — same frozen bundle → deep-equal result; inputs not mutated; pure core imports no Firebase / no `partMasterQueries` / no network.
- **Sanitization** — result payload contains none of: UIDs, emails, tokens, credentials, or full record objects (only counts/hash/summaries).
- **Isolation** — a source scan proving Stage A modules neither import nor are imported by `PartsList.jsx` / `PartDetail.jsx`.

## 8. Explicit non-authorizations

Stage A, when later authorized, may add the diagnostic read-orchestration and parity reporting above and its tests — nothing else. It does **not** authorize consumer wiring, PartsList/PartDetail changes, Rules changes or deployment, source switching, or any Firestore write. Decisions #43–#45 remain unchanged; any contradiction found during implementation is reported, not reconciled.
