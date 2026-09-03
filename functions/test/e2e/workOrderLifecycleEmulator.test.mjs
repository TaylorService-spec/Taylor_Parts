// Emulator E2E harness -- Chain 1: the full Work Order lifecycle.
//
// Proves ONE governed chain end-to-end, through the REAL exported onCall handlers (`.run(request)`,
// the established pattern in this repo -- see functions/test/workOrderEngineFunctions.test.js), against
// a real Firestore emulator: create -> plan parts -> MarkReady -> Schedule -> Dispatch (reserves real
// ledger stock) -> Accept -> Travel -> Arrive -> WorkStart -> capture execution (records qtyUsed) ->
// Complete (consumes the ledger reservation) -> Close. Asserts the resulting Work Order status, the
// inventory_transactions ledger entries, and the auditEvents this chain stages, at each governed step.
//
// Run via `npm run test:e2eEmulatorSuite` (functions/scripts/runE2eEmulatorSuite.mjs) or, against an
// already-running emulator on the default port, `npm run build && node test/e2e/workOrderLifecycleEmulator.test.mjs`.
// See functions/test/e2e/README.md.
import assert from "node:assert/strict";
import { HttpsError } from "firebase-functions/v2/https";
import {
  db,
  makeCheckRunner,
  seedAdmin,
  seedDispatcher,
  seedTechnicianWithRecord,
  seedPart,
  grantWorkOrderPartsPlanRole,
  callReq,
  getWorkOrder,
  ledgerEntries,
  auditEvents,
  CATALOG_SKUS,
  E2E_WAREHOUSE,
} from "./lib/testKit.mjs";

const { createWorkOrder } = await import("../../lib/createWorkOrder.js");
const { setWorkOrderPartsPlan } = await import("../../lib/workOrderPartsPlan/setWorkOrderPartsPlan.js");
const { transitionWorkOrder } = await import("../../lib/transitionWorkOrder.js");
const { updateWorkOrderExecutionData } = await import("../../lib/updateWorkOrderExecutionData.js");

const { check, summarize } = makeCheckRunner("workOrderLifecycleEmulator");

await check("full chain: create -> plan -> schedule -> dispatch -> accept -> travel -> arrive -> workStart -> capture execution -> complete -> close", async () => {
  // ---- Seed a minimal governed dataset ----
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { uid: techUid, technicianId } = await seedTechnicianWithRecord();
  const plannerUid = await seedAdmin(); // a second admin, distinct principal, holding the SEPARATE parts-plan capability
  await grantWorkOrderPartsPlanRole(plannerUid);
  const partId = await seedPart(CATALOG_SKUS.COMPRESSOR);

  // ---- 1) create ----
  const createIdemKey = "e2e-create-1";
  const created = await createWorkOrder.run(
    callReq(adminUid, {
      customerId: "cust-e2e-1",
      locationId: "loc-e2e-1",
      priority: 2,
      type: "SERVICE_CALL",
      idempotencyKey: createIdemKey,
    }),
  );
  assert.ok(created.id && created.woNumber, "createWorkOrder returned an id + woNumber");
  const workOrderId = created.id;

  let wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "CREATED");

  // createWorkOrder's own idempotency Audit Event proves this callable was genuinely exercised.
  const createAudits = await auditEvents({ action: "createWorkOrder", targetId: workOrderId });
  assert.equal(createAudits.length, 1);
  assert.equal(createAudits[0].outcome, "applied");

  // ---- 2) plan parts (governed capability workOrder.parts.plan; a principal WITHOUT the Role is denied) ----
  await assert.rejects(
    setWorkOrderPartsPlan.run(callReq(adminUid, { workOrderId, plan: [{ partId, qtyPlanned: 2 }] })),
    (e) => e instanceof HttpsError && e.code === "permission-denied",
    "an admin with no workOrderPartsPlanner roleAssignment is denied -- proves the capability gate is real, not a role bypass",
  );

  const planned = await setWorkOrderPartsPlan.run(
    callReq(plannerUid, { workOrderId, plan: [{ partId, qtyPlanned: 2 }] }),
  );
  assert.deepEqual(planned, { success: true, workOrderId, plannedCount: 1 });

  wo = await getWorkOrder(workOrderId);
  assert.equal(wo.inventorySnapshot.length, 1);
  assert.equal(wo.inventorySnapshot[0].partId, partId);
  assert.equal(wo.inventorySnapshot[0].sku, CATALOG_SKUS.COMPRESSOR.sku);
  assert.equal(wo.inventorySnapshot[0].qtyPlanned, 2);

  // ---- 3) MarkReady ----
  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "MarkReady" }));
  wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "READY_TO_DISPATCH");

  // ---- 4) Schedule ----
  const scheduledStart = Date.now() + 60 * 60 * 1000;
  const scheduledEnd = scheduledStart + 60 * 60 * 1000;
  await transitionWorkOrder.run(
    callReq(dispatcherUid, { workOrderId, action: "Schedule", scheduledStart, scheduledEnd, scheduledTechId: technicianId }),
  );
  wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "SCHEDULED");
  assert.equal(wo.scheduledTechId, technicianId);

  // ---- 5) Dispatch -- post-commit triggerInventoryEffects() reserves the planned parts on the REAL ledger ----
  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "Dispatch", assignedTechId: technicianId }));
  wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "DISPATCHED");
  assert.equal(wo.assignedTechId, technicianId);

  // The trigger runs asynchronously post-commit inside transitionWorkOrder's own await, so by the time
  // .run() resolves the ledger write has already committed -- no polling needed (see transitionWorkOrder.ts's
  // header comment: `await triggerInventoryEffects(...)` is awaited before the callable returns).
  let entries = await ledgerEntries({ workOrderId, partId: CATALOG_SKUS.COMPRESSOR.sku });
  assert.equal(entries.length, 1, "exactly one ledger entry after Dispatch");
  assert.equal(entries[0].type, "RESERVED");
  assert.equal(entries[0].quantity, 2);

  // ---- 6) Accept / Travel / Arrive / WorkStart -- technician-only, own-assignment enforced ----
  for (const action of ["Accept", "Travel", "Arrive", "WorkStart"]) {
    await transitionWorkOrder.run(callReq(techUid, { workOrderId, action }));
  }
  wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "WORK_IN_PROGRESS");
  assert.ok(wo.acceptedAt && wo.enRouteAt && wo.arrivedAt && wo.workStartedAt);

  // ---- 7) capture execution data (updateWorkOrderExecutionData) -- the technician records actual usage ----
  const execIdemKey = "e2e-exec-1";
  const execResult = await updateWorkOrderExecutionData.run(
    callReq(techUid, {
      workOrderId,
      qtyUsedUpdates: [{ sku: CATALOG_SKUS.COMPRESSOR.sku, delta: 1 }],
      // Decision #171: a positive qtyUsed names the governed source it came from. The harness already
      // seeds this warehouse ACTIVE and stocks it, so this is the source the parts genuinely left.
      consumptionSources: [{ sku: CATALOG_SKUS.COMPRESSOR.sku, locationId: E2E_WAREHOUSE }],
      executionNote: "Replaced compressor, 1 used of 2 planned.",
      idempotencyKey: execIdemKey,
    }),
  );
  assert.equal(execResult.success, true);
  assert.deepEqual(execResult.updatedFields.sort(), ["executionLog", "inventorySnapshot", "lastUpdated"]);

  wo = await getWorkOrder(workOrderId);
  assert.equal(wo.inventorySnapshot[0].qtyUsed, 1);
  assert.equal(wo.executionLog.length, 1);

  const execAudits = await auditEvents({ action: "updateWorkOrderExecutionData", targetId: workOrderId });
  assert.equal(execAudits.length, 1);

  // Replay with the SAME idempotency key is a no-op -- proves the harness genuinely exercises the
  // callable's replay guard, not just its happy path.
  const execReplay = await updateWorkOrderExecutionData.run(
    callReq(techUid, {
      workOrderId,
      qtyUsedUpdates: [{ sku: CATALOG_SKUS.COMPRESSOR.sku, delta: 1 }],
      // Decision #171: a positive qtyUsed names the governed source it came from. The harness already
      // seeds this warehouse ACTIVE and stocks it, so this is the source the parts genuinely left.
      consumptionSources: [{ sku: CATALOG_SKUS.COMPRESSOR.sku, locationId: E2E_WAREHOUSE }],
      executionNote: "Replaced compressor, 1 used of 2 planned.",
      idempotencyKey: execIdemKey,
    }),
  );
  assert.equal(execReplay.replayed, true);
  wo = await getWorkOrder(workOrderId);
  assert.equal(wo.inventorySnapshot[0].qtyUsed, 1, "replay did not double-apply the qtyUsed delta");

  // ---- 8) Complete -- post-commit consumeParts(): CONSUMED (actual=1) + RELEASED (remainder=1) ----
  await transitionWorkOrder.run(callReq(techUid, { workOrderId, action: "Complete" }));
  wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "COMPLETED");
  assert.ok(wo.completedAt);

  entries = await ledgerEntries({ workOrderId, partId: CATALOG_SKUS.COMPRESSOR.sku });
  assert.equal(entries.length, 3, "RESERVED (Dispatch) + CONSUMED + RELEASED (Complete)");
  const byType = Object.fromEntries(entries.map((e) => [e.type, e.quantity]));
  assert.equal(byType.RESERVED, 2);
  assert.equal(byType.CONSUMED, 1);
  assert.equal(byType.RELEASED, 1);

  // A completed-but-not-yet-planned/executed-again Work Order is terminal for both the parts plan and
  // execution-capture paths -- proves those governed guards actually fire inside this real chain.
  await assert.rejects(
    setWorkOrderPartsPlan.run(callReq(plannerUid, { workOrderId, plan: [{ partId, qtyPlanned: 3 }] })),
    (e) => e instanceof HttpsError && e.code === "failed-precondition",
  );
  await assert.rejects(
    updateWorkOrderExecutionData.run(callReq(techUid, { workOrderId, executionNote: "too late" })),
    (e) => e instanceof HttpsError && e.code === "failed-precondition",
  );

  // ---- 9) Close ----
  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "Close" }));
  wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "CLOSED");
  assert.ok(wo.closedAt);

  // CLOSED is terminal -- TRANSITIONS["CLOSED"] === [], so every further action is failed-precondition.
  await assert.rejects(
    transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "Cancel" })),
    (e) => e instanceof HttpsError && e.code === "failed-precondition",
  );
});

const ok = summarize();
process.exit(ok ? 0 : 1);
