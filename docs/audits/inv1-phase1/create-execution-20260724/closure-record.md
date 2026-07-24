# INV-1 CREATE Production Execution — Record & Closure (2026-07-24)

**Outcome:** the first governed Part Master data is live in production — **190 canonical Parts** created through the trusted `createPart` command, fully reconciled, with the temporary migration authority granted and revoked under audit. This directory is the byte-exact, checksum-verified evidence import.

## Provenance (pinned)

| Field | Value |
|---|---|
| Tool | `functions/scripts/executePartMasterCreate.js` (`--execute`) |
| Execution commit | `d0dad859ca67fbcfc955c41f4713ec4467a7206c` |
| Project | `taylor-parts` (production) |
| Approved input SHA-256 | `53471fcdd5c24f5c6cd24443ffe67073153f817d2001e27b52ae0dd48613744b` |
| Actor UID | `JBslDvmpq8RqQAiyzfvwne9yCWc2` (bootstrapped admin; temporary `inventoryCreateExecutor`) |
| Rollback export (pre-write) | `gs://taylor-parts-firestore-backups/inv1-create-rollback-20260723T233118Z` |
| PART_MASTER_REFERENCE | OFF |

## Verification performed at import

- **Transfer archive:** `taylor-inv1-create-closure-transfer-20260724.tar.gz` SHA-256 =
  `b3d58c8f0d356f2316a2fe684b9634f1fbd9c2b42fa68b43dd89dc6ced2b27a9` (matches operator sidecar).
- **Internal manifests:** both `execution/checksums.sha256` and `postwrite-analyzer/checksums.sha256`
  re-verified from the imported bytes **and** from the staged git blobs — zero mismatches.
  `.gitattributes` pins this directory `-text` so `core.autocrlf` cannot alter the bytes.
- **Sensitive scan:** CLEAN across every artifact; a full email/secret scan of the transfer found
  no email/PII or credentials in any file.

## Execution result (`execution/`)

- run-metadata: tool `executePartMasterCreate`, runKind `CREATE_IMPORT`, mode `EXECUTE`, project
  `taylor-parts`, approvedInputSha256 matches, expectedCount 190, commit `d0dad85`, operator
  `JBslDvmpq8RqQAiyzfvwne9yCWc2`, `productionWriteAcknowledged: true`, `partMasterReferenceOff: true`,
  `complete: true`.
- **Counts: SUCCESS=190 · ALREADY_APPLIED=0 · FAILED=0 · NOT_ATTEMPTED=0** (per-row-results: 190 rows,
  all SUCCESS). Exit code 0.
- Trusted `createPart` audit events for the run: **190** (operator-reported; each row created only
  through the trusted command).

## Production reconciliation (`postwrite-analyzer/`)

- Collection counts (post-write): **parts=190 · part_aliases=0 · part_supplier_items=0**.
- Read-only post-write analyzer over the same approved input against production state:
  **CREATE=0 · UPDATE=0 · NO_CHANGE=190 · CONFLICT=0 · INVALID=0** (exit 0, zero-write read
  confirmed). Every previously-CREATE row now resolves NO_CHANGE — full reconciliation.
  (The analyzer's `cutover-readiness.json` remains BLOCKED by design — execution-gate approvals are
  per-gate; the reconciliation signal is the classification totals, not the readiness verdict.)

## Temporary access grant + revocation (`audit-events/`)

- GRANT `assign-inventory-create-executor-20260724T134344Z`: `assignApprovedRole`, applied,
  roleId `inventoryCreateExecutor`, scope global, accessVersionAfter 2 (single-admin, audited).
- REVOKE `revoke-inventory-create-executor-20260724T140005Z`: `revokeRole`, applied,
  targetId = the assignment above, accessVersionAfter 3. Assignment final status **disabled**.
- Net: the temporary migration authority is removed; the assignment is retained as a governed
  historical record. `inventory.catalog.manage` no longer resolves for the operator.

## Governance state at closure

Migration authority removed · no raw Firestore administration used · no Rules deployed ·
`PART_MASTER_REFERENCE` OFF · production `parts` remain client-write-closed (PR 1.9 read grant
undeployed) · **no aliases, supplier items, or quantities migrated · no UPDATE processing** — those
remain their own future Owner-gated units (Decision #42 D-M1/D-M2/D-M4).

## INV-1 CREATE execution record: CLOSED.
