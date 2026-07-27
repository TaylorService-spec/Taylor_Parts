# Firestore deployment-verification automation — governed production evidence

Run completed at `2026-07-27T00:21:24.714Z` against project `taylor-parts`.

## Result

- Five governed personas authenticated before the first Firestore request.
- Complete production matrix: **55/55 PASS**.
- All 30 write probes returned `403`; Firestore mutations: **NONE**.
- Live extracted Rules source SHA-256 matched the governed Git/LF source:
  `cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381`.
- Deployment log passed Firestore-Rules-only scope validation.
- Current live Functions inventory was captured and sanitized.
- Evidence-file checksums independently reverified after generation.

## Approved limitation

The original raw predeployment Functions inventory was not retained. The Owner explicitly approved using the merged Stage B `FUNCTIONS-UNCHANGED` deployment-scope attestation for this retroactive run. The verifier required both exact governed markers, hashed that attestation, and recorded the limitation in `verification-summary.json`. This exception is not equivalent to an exact raw pre/post Functions inventory comparison and does not apply to future deployments.

## Boundaries

No deployment, Firebase Auth mutation, Firestore mutation, role/claim change, PR merge, or C1/C2 work occurred.
