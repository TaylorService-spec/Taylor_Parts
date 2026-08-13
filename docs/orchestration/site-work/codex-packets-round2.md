# Codex work packets — site-work round 2 (backend / `functions/` only)

Repo: TaylorService-spec/Taylor_Parts. Each packet = one PR to `main`. Global rules for ALL packets:
- Work ONLY inside `functions/`. Do NOT touch `field-ops-app-vite/` (frontend is owned by the other fleet) or `firestore.rules`. No deploy.
- Revalidate the defect on current `main` first; make the SMALLEST correct change; add focused regression tests that FAIL pre-fix and PASS after.
- Match the repo's existing test convention (see sibling `functions/test/*.test.mjs`; many run `npm run build` then `node --test`, some use the Firestore emulator like sibling command tests).
- Open a PR, do NOT merge. Return: PR #/URL, files changed, the defect mechanism, and test output (before/after).

---

## C1 — createOpportunity / createSalesOrder have no idempotency guard  (P1, data-integrity, S)
**Files:** `functions/src/opportunity/opportunityCallables.ts` (createOpportunity ~L62-85), `functions/src/salesOrder/salesOrderCallables.ts` (createSalesOrder ~L53-72). Pattern reference: `functions/src/coverage/coverageCallables.ts` (already implements idempotency correctly).
**Defect:** both callables accept a payload and immediately `db.collection(...).add({...})` with no idempotency key — a network retry / double-submit creates duplicate Opportunities / Sales Orders that flow into fulfillment/allocation math as authoritative demand.
**Fix:** add an optional client-supplied `idempotencyKey` to each callable's input, and replay the already-created doc atomically on a repeat key — mirroring the exact convention `coverageCallables.ts` (and `createWorkOrder.ts`) already use. Keep validation/auth unchanged.
**Tests:** add behavioral coverage proving a repeated key replays (no duplicate) and a new key creates — matching sibling callable tests.

## C2 — updateWorkOrderExecutionData accepts writes on terminal Work Orders  (P1, data-integrity, S)
**Files:** `functions/src/updateWorkOrderExecutionData.ts` (only checks `wo.assignedTechId !== caller.technicianId` ~L123; never checks `wo.status`). **Server-side only — do NOT edit the frontend ExecutionCapture files (separate item).**
**Defect:** a technician can keep rewriting `qtyUsed` / execution notes on COMPLETED / CLOSED / CANCELLED Work Orders, corrupting billing/audit records treated as final.
**Fix:** inside the existing transaction, reject the write when `wo.status` is terminal (COMPLETED/CLOSED/CANCELLED — confirm the exact terminal set from `transitionEngine.ts`) with a `failed-precondition` HttpsError. Allow only the in-progress states that legitimately accept execution data.
**Tests:** prove the write is rejected from each terminal status and accepted from a valid in-progress status.

## C3 — Schedule transition has no technician double-booking check  (P3, reliability, M)
**Files:** `functions/src/transitionWorkOrder.ts` (Schedule branch ~L113-116 writes scheduledStart/End/scheduledTechId with no overlap check), `functions/src/workOrderAvailability.ts` (already has `findDoubleBookingConflict`, used by the Dispatch branch). **Server-side only.**
**Defect:** the Dispatch branch guards double-booking, but the Schedule branch does not — two dispatchers can schedule the same technician to overlapping windows with no server-side rejection (only a passive UI badge).
**Fix:** add a server-side scheduling-overlap check to the Schedule branch, reusing/extending the existing `workOrderAvailability.ts` conflict-check pattern (time-window overlap for the same technician). Reject on conflict with a `failed-precondition` HttpsError. Keep it minimal and consistent with the Dispatch-branch guard.
**Tests:** prove overlapping schedule for the same tech is rejected; non-overlapping / different-tech is allowed.

## C4 — warehouseService negative-stock floor + zero test coverage (warehouse/procurement/supplier)  (P3 fix + P2 tests, data-integrity + missing-test, S+M)
**Files:** `functions/src/warehouseService.ts` (`applyStockDelta` ~L35-54 applies a delta with no floor/sufficiency check; `completeTransferOrder` ~L106-120 calls it with `-order.quantity`), `functions/src/procurementService.ts`, `functions/src/supplierService.ts`.
**Defect:** a transfer for more than on-hand silently drives `StockLocation.quantity` negative instead of failing (dormant today — module not yet wired to a live caller, but a latent data-integrity hole). And these three services have NO test coverage anywhere.
**Fix:** add a floor/sufficiency check to `applyStockDelta` (or its caller) so an over-draw fails closed (throw / reject) rather than writing a negative quantity — preserve existing behavior for valid deltas.
**Tests:** add behavioral coverage for warehouseService (transfer completion incl. the over-draw rejection + the negative-floor), procurementService (PO lifecycle transitions), and supplierService (tie-breaking logic) — matching sibling emulator/unit test convention.

---

### Coordination
- The register (`docs/orchestration/site-work/register.json`) tracks each item's `worker` (codex/claude) + status so the two fleets don't collide. Claude integrates: reviews every PR (both fleets), confirms CI, merges, keeps the register current.
- If Codex finds the defect does NOT reproduce on current main, make no change and return evidence.
