# Gate D — Trusted Truck Functions Deployment Report

> Populated from the imported, sanitized verification evidence of one governed, Owner-authorized
> operator run (2026-08-01). Values are split into **evidence-backed** (from `verify-2026-08-01/
> verification-report.json`, SHA-256 `66e41b7c…`) and **operator-relayed** (terminal facts not part of
> the evidence). Operator-relayed facts NOT supplied to this evidence-import are marked as such and are
> deliberately not fabricated — see `verify-2026-08-01/import-validation.md` §C.

| Field | Value | Source |
| --- | --- | --- |
| Governed commit (deployed) | `1d9d6854ba531dfd13d467f9d02a03656b37c18a` | evidence (`governedCommit`) |
| Project | `taylor-parts` | evidence (`project`) |
| Region | `us-central1` | evidence (`region`) |
| Deploy authorization | Owner Gate D targeted-deploy + single-verification authorization (2026-08-01) | authorization |
| Deploy date/time (UTC) | operator-relayed — **not supplied** in this evidence-import | — |
| Verify date | `2026-08-01` | evidence (`verify_date`) |
| Verifier evidence | `verify-2026-08-01/verification-report.json` (sha256 `66e41b7c2e5a1edec21346fa9fdb7f8a6fabdb8f8049af7d3ffaa226e023b80e`) | evidence |
| Archive transit anchor | `fade7013389813efef5cf198a72188079d636aa92db6789fff7134a5f5b9c9e4` | sidecar (recomputed = posted) |

## Deployment

Evidence-attested:
- [x] All eight target callables are **deployed and reachable at us-central1** — verifier `discovery`
      = 8/8 (positive live verification recorded in the report).

Operator-relayed (terminal facts, **not supplied** to this evidence-import; not fabricated):
- [ ] deploy exit code (expected 0) — not supplied here.
- [ ] pre-deploy inventory showing the eight callables absent — not supplied here.
- [ ] exact eight-name allowlist deploy command / no broad deploy — not supplied here.
- [ ] post-deploy inventory hashes — not supplied here.

(These may be attached later by the operator in a clearly-attributed relay if required for closure.)

## Verification (from `verification-report.json`)

| Section | Total | Passed |
| --- | --- | --- |
| Discovery (@ us-central1) | 8 | 8 |
| Denial (unauth + unauthorized × 8) | 16 | 16 |
| Sequence (7 applied + deactivate fail-closed) | 8 | 8 |
| **matrix_total** | **32** | **32** |

- Deactivate outcome: **FAIL_CLOSED_AS_EXPECTED** (`seq:deactivate:deactivateTruckCallable`) — the
  governed fail-closed result (INVENTORY_STATE_UNKNOWN → failed-precondition), as designed.
- Cleanup: `cleanup_complete = true` — residual documents: **0**, residual Auth users: **0**.

## Readiness

- [x] `TRUCK_MANAGEMENT_WRITE_READY` remains `false` (repository-verifiable at the governed head; this
      import changes nothing). Gate D does not activate the UI.

## Stop conditions encountered

None recorded in the imported evidence (matrix 32/32, cleanup complete, zero residual). No recovery was
invoked per the evidence.
