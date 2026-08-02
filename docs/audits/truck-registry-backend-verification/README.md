# Truck Registry — Gate E4 Backend Verification Evidence

Sanitized, byte-exact evidence from governed, Owner-authorized, **read-only** runs of the merged
backend verifier (`functions/scripts/truckBackendVerifierCli.js` /
`functions/scripts/verifyTruckBackend.js`; runbook:
`docs/operations/truck-registry-backend-verifier.md`). Each run independently verifies the backend
facts the production Truck Inventory UI does not expose for a single Owner-named truck, and publishes a
sanitized `verification-report.json` + `SHA256SUMS.txt`. **No production mutation** is performed by the
verifier or by these imports.

## Runs

| Date | Truck | Governed commit | Result | Folder |
| --- | --- | --- | --- | --- |
| 2026-08-02 | `1` (quarantined test record) | `d9bd532dbdd8c6e38176f55274f993be2baabd38` | `verified=true`, 30/30 checks, final state **IDLE + unassigned** | [`verify-2026-08-02/`](verify-2026-08-02/) |

## Context

Truck ID 1 is a **quarantined production test record** (not operational): it was created as a test
during Gate E4, then contained to **IDLE + unassigned**. Gate E4 first-real-truck acceptance is
**NOT ACCEPTED**. This backend verification independently confirms the record's stored version,
truck/location/claim reciprocity, absence of hidden duplicates, the applied create + containment audit
events, version/audit coherence, and the final contained state. It does **not** authorize using the
record operationally, any deployment, activation of the ninth (delete) callable, or deletion of the
truck — each remains a separate governed gate.

See each run's `import-validation.md` for the provenance separation (facts read from the report vs.
repository-side integrity verification vs. transit provenance).
