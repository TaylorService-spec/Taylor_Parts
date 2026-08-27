// Emulator E2E harness -- Chain 1 edge-case fixtures.
//
// A prior read-only review found that no fixture ANYWHERE in this repo produces a cancelled Sales
// Order, a partially-invoiced Sales Order, or a LOST Opportunity -- every seed only ever represents
// the boring middle of a happy path. This file closes the equivalent gap for the Work Order chain:
// three governed states the happy-path chain (workOrderLifecycleEmulator.test.mjs) never visits.
//
//   EMPTY:      a Work Order that reaches Dispatch/Complete with NO planned parts at all -- proves
//               reserveParts()/consumeParts() are genuinely no-ops (not silently skipped/erroring)
//               when inventorySnapshot is empty, and that zero ledger entries is the CORRECT outcome,
//               not a missed write.
//   TERMINAL:   a Work Order driven all the way to CLOSED, then proving every mutating governed path
//               (parts plan, execution capture, further transitions) fails closed against it.
//   CANCELLED:  a Work Order cancelled AFTER Dispatch (i.e. after real stock was reserved) -- proves
//               the CANCELLED trigger (releaseParts) actually releases the outstanding reservation,
//               not just that the status flips.
//
// Same harness, same `.run(request)` pattern as the happy-path file -- see functions/test/e2e/README.md.
import assert from "node:assert/strict";
import { HttpsError } from "firebase-functions/v2/https";
import {
  makeCheckRunner,
  seedAdmin,
  seedDispatcher,
  seedTechnicianWithRecord,
  seedPart,
  grantWorkOrderPartsPlanRole,
  callReq,
  getWorkOrder,
  ledgerEntries,
  CATALOG_SKUS,
} from "./lib/testKit.mjs";

const { createWorkOrder } = await import("../../lib/createWorkOrder.js");
const { setWorkOrderPartsPlan } = await import("../../lib/workOrderPartsPlan/setWorkOrderPartsPlan.js");
const { transitionWorkOrder } = await import("../../lib/transitionWorkOrder.js");
const { updateWorkOrderExecutionData } = await import("../../lib/updateWorkOrderExecutionData.js");

const { check, summarize } = makeCheckRunner("workOrderLifecycleEdgeCasesEmulator");

async function createBareWorkOrder(adminUid) {
  const created = await createWorkOrder.run(
    callReq(adminUid, { customerId: "cust-e2e-edge", locationId: "loc-e2e-edge", priority: 3, type: "PM" }),
  );
  return created.id;
}

await check("EMPTY case: no planned parts -- Dispatch and Complete are clean no-ops on the ledger", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { uid: techUid, technicianId } = await seedTechnicianWithRecord();

  const workOrderId = await createBareWorkOrder(adminUid);
  let wo = await getWorkOrder(workOrderId);
  assert.deepEqual(wo.inventorySnapshot, undefined, "freshly created Work Order has no inventorySnapshot at all");

  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "MarkReady" }));
  const scheduledStart = Date.now() + 3600_000;
  await transitionWorkOrder.run(
    callReq(dispatcherUid, { workOrderId, action: "Schedule", scheduledStart, scheduledEnd: scheduledStart + 3600_000, scheduledTechId: technicianId }),
  );
  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "Dispatch", assignedTechId: technicianId }));

  wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "DISPATCHED");
  assert.deepEqual(await ledgerEntries({ workOrderId }), [], "reserveParts() over an empty plan writes NOTHING");

  for (const action of ["Accept", "Travel", "Arrive", "WorkStart", "Complete"]) {
    await transitionWorkOrder.run(callReq(techUid, { workOrderId, action }));
  }
  wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "COMPLETED");
  assert.deepEqual(await ledgerEntries({ workOrderId }), [], "consumeParts() over an empty plan also writes NOTHING");
});

await check("TERMINAL case: a CLOSED Work Order fails closed on every mutating path", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { uid: techUid, technicianId } = await seedTechnicianWithRecord();
  const plannerUid = await seedAdmin();
  await grantWorkOrderPartsPlanRole(plannerUid);
  const partId = await seedPart(CATALOG_SKUS.COMPRESSOR);

  const workOrderId = await createBareWorkOrder(adminUid);
  await setWorkOrderPartsPlan.run(callReq(plannerUid, { workOrderId, plan: [{ partId, qtyPlanned: 1 }] }));
  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "MarkReady" }));
  const scheduledStart = Date.now() + 3600_000;
  await transitionWorkOrder.run(
    callReq(dispatcherUid, { workOrderId, action: "Schedule", scheduledStart, scheduledEnd: scheduledStart + 3600_000, scheduledTechId: technicianId }),
  );
  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "Dispatch", assignedTechId: technicianId }));
  for (const action of ["Accept", "Travel", "Arrive", "WorkStart", "Complete"]) {
    await transitionWorkOrder.run(callReq(techUid, { workOrderId, action }));
  }
  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "Close" }));

  const wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "CLOSED");

  await assert.rejects(
    setWorkOrderPartsPlan.run(callReq(plannerUid, { workOrderId, plan: [{ partId, qtyPlanned: 5 }] })),
    (e) => e instanceof HttpsError && e.code === "failed-precondition",
    "parts plan cannot change on a CLOSED Work Order",
  );
  await assert.rejects(
    updateWorkOrderExecutionData.run(callReq(techUid, { workOrderId, executionNote: "post-close note" })),
    (e) => e instanceof HttpsError && e.code === "failed-precondition",
    "execution data cannot change on a CLOSED Work Order",
  );
  for (const action of ["MarkReady", "Schedule", "Dispatch", "Cancel", "Complete"]) {
    await assert.rejects(
      transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action, scheduledStart, scheduledEnd: scheduledStart + 1, scheduledTechId: technicianId, assignedTechId: technicianId })),
      (e) => e instanceof HttpsError && e.code === "failed-precondition",
      `CLOSED has no outgoing transition (attempted ${action})`,
    );
  }
});

await check("CANCELLED case (exceptional/partial record): cancelling AFTER Dispatch releases the outstanding reservation", async () => {
  const adminUid = await seedAdmin();
  const dispatcherUid = await seedDispatcher();
  const { technicianId } = await seedTechnicianWithRecord();
  const plannerUid = await seedAdmin();
  await grantWorkOrderPartsPlanRole(plannerUid);
  const partId = await seedPart(CATALOG_SKUS.COMPRESSOR);

  const workOrderId = await createBareWorkOrder(adminUid);
  await setWorkOrderPartsPlan.run(callReq(plannerUid, { workOrderId, plan: [{ partId, qtyPlanned: 3 }] }));
  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "MarkReady" }));
  const scheduledStart = Date.now() + 3600_000;
  await transitionWorkOrder.run(
    callReq(dispatcherUid, { workOrderId, action: "Schedule", scheduledStart, scheduledEnd: scheduledStart + 3600_000, scheduledTechId: technicianId }),
  );
  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "Dispatch", assignedTechId: technicianId }));

  let entries = await ledgerEntries({ workOrderId, partId: CATALOG_SKUS.COMPRESSOR.sku });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "RESERVED");
  assert.equal(entries[0].quantity, 3);

  await transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "Cancel" }));
  const wo = await getWorkOrder(workOrderId);
  assert.equal(wo.status, "CANCELLED");
  assert.ok(wo.closedAt, "Cancel reuses closedAt -- CANCELLED has no dedicated timestamp field (transitionEngine.ts)");

  entries = await ledgerEntries({ workOrderId, partId: CATALOG_SKUS.COMPRESSOR.sku });
  assert.equal(entries.length, 2, "RESERVED (Dispatch) + RELEASED (Cancel)");
  const byType = Object.fromEntries(entries.map((e) => [e.type, e.quantity]));
  assert.equal(byType.RESERVED, 3);
  assert.equal(byType.RELEASED, 3, "the FULL outstanding reservation is released -- nothing left stranded");

  // CANCELLED is terminal (TRANSITIONS["CANCELLED"] === []).
  await assert.rejects(
    transitionWorkOrder.run(callReq(dispatcherUid, { workOrderId, action: "Close" })),
    (e) => e instanceof HttpsError && e.code === "failed-precondition",
  );
});

const ok = summarize();
process.exit(ok ? 0 : 1);
