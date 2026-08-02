# Gate D — Trusted Truck Functions Deployment Report (TEMPLATE)

> Operator-completed at deployment time. Do not fill in until a real, Owner-authorized deploy +
> verification has run. Leave every `<…>` placeholder until then. Attach only sanitized evidence.

| Field | Value |
| --- | --- |
| Governed commit (deployed) | `<40-hex commit>` |
| Project | `taylor-parts` |
| Region | `us-central1` |
| Deploy authorization ref | `<Owner authorization message id / date>` |
| Deploy date (UTC) | `<YYYY-MM-DDThh:mm:ssZ>` |
| Verify date | `<YYYY-MM-DD>` |
| Verifier evidence | `verify-<YYYY-MM-DD>/verification-report.json` (sha256: `<…>`) |

## Deployment

- [ ] Clean exact-head checkout confirmed (`git status --porcelain` empty; `HEAD` == governed commit).
- [ ] `functions` built (`npm ci && npm run build`).
- [ ] Pre-deploy inventory captured (`functions-before.json`); the eight callables were absent.
- [ ] Deployed with the **exact eight-name allowlist** (no broad `--only functions`).
- [ ] Post-deploy inventory shows exactly the eight added; nothing else changed.

## Verification (from `verification-report.json`)

| Section | Total | Passed |
| --- | --- | --- |
| Discovery (@ us-central1) | 8 | `<…>` |
| Denial (unauth + unauthorized × 8) | 16 | `<…>` |
| Sequence (7 applied + deactivate fail-closed) | 8 | `<…>` |
| **matrix_total** | **32** | `<…>` |

- Deactivate outcome: `<failed-precondition — expected fail-closed>`.
- Cleanup: `<CLEANUP-DONE>` — residual docs: `<0>`, residual Auth users: `<0>`.

## Readiness

- [ ] `TRUCK_MANAGEMENT_WRITE_READY` remains `false` (Gate D does not activate the UI).

## Stop conditions encountered

`<none / describe + recovery manifest path + resolution>`
