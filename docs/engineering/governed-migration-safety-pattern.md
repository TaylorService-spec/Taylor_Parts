# Governed Migration Safety Pattern

A reusable pattern for any future governed data migration (backfilling/linking fields on a live
collection). Distilled from the Supplier Master reorder-PO linkage migration
(`functions/src/supplierMaster/reorderPurchaseOrderSupplierMigration*.ts`) and the warehouse-governance
migration. Follow this chain; each link is a fail-closed gate.

1. **Explicit manifest.** The set of changes is a frozen, authored manifest (per-item intended target +
   a pre-state fingerprint), validated against a deterministic dry-run **plan** whose fingerprint the
   manifest must match. No plan/manifest → no run.
2. **Explicit destination.** The caller names the target `{projectId, databaseId}` and, for a write run,
   passes a confirmation token equal to `${projectId}/${databaseId}`. Execute is **impossible by
   accidental default** (default is DRY_RUN).
3. **Connected-destination proof.** Verify the *connected* client's `projectId`/`databaseId` actually
   equal the named target. The token proves operator *intent*; this proves the writes' *destination*.
   A mismatch fails closed. (The Admin SDK exposes `db.projectId` / `db.databaseId`.)
4. **Source fingerprint gate.** Before writing an item, re-read it in a transaction and require its
   current fingerprint to equal the manifest's pre-state fingerprint — a document that drifted since the
   manifest was authored fails closed (per-item, bounded).
5. **Additive / idempotent execution.** Write only the new field(s); never destroy or replace existing
   authoritative data. Re-running is a no-op for already-correct items; an item already carrying a
   *different* value fails closed (never overwritten). Prefer per-item isolated transactions with
   **bounded failure reporting** (record + continue) over an unbounded throw.
6. **Postcondition verification.** After writing, re-read and confirm the intended state. **Record**
   verification failures — never throw them — because the writes already committed.
7. **Rollback artifact preserved even on verification failure.** Always return the result **and** the
   rollback artifact (covering everything actually applied). A postcondition (or any late) failure must
   NOT discard the artifact needed to undo committed writes. (This was a HIGH review finding on the
   Supplier Master execute tool — fixed + test-locked.)
8. **Separately tested rollback.** Provide rollback tooling under the *same* destination guards,
   additive-field-only removal, idempotent (already-absent is a no-op), and test it independently.

**Verification depth follows risk:** offline unit tests for the manifest fail-closed matrix + guards,
and an emulator lifecycle test proving DRY_RUN-writes-nothing, additive-only execution, idempotency,
drift/conflict fail-closed, and rollback. Do not run EXECUTE against production from a repo/sandbox
workstream — production execution is a separate protected step.
