// THE WORK ORDER CLIENT -- the browser's route to the governed PostgreSQL Work Order authority
// (POST /operations/work-orders). Work Order domain cutover, client half.
//
// Proved through injected fetch / token / transport (no network, no Firebase): the closed operation list
// mirrors the server's EOS_WORK_ORDER_OPERATIONS + readWorkOrderAuthorityStatus EXACTLY (read from the
// server source text), 503 NOT_ACTIVATED is its own category, the client never throws, readiness is
// fail-closed, the service maps every legacy action onto its governed operation, and the adapter turns the
// server's summary/detail into the legacy WorkOrder shape the screens read.
//
// Run: node --test test/workOrderApiClient.test.mjs   (also `npm test`)
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  WORK_ORDER_COMMAND_OPERATIONS,
  WORK_ORDER_READ_OPERATIONS,
  WORK_ORDER_ROUTE,
  WORK_ORDER_READINESS,
  callWorkOrderApi,
  isWorkOrderOperation,
  readWorkOrderAuthorityStatus,
  workOrderFailureCategory,
} from "../src/services/workOrderApiClient.js";
import {
  adaptWorkOrder,
  adaptWorkOrderTechnician,
  eosInstant,
  techniciansFromWorkOrders,
} from "../src/domain/workOrderAdapter.js";
import {
  OPERATION_BY_ACTION,
  __setWorkOrderTransportForTests,
  buildTransitionRequest,
  createWorkOrder,
  getWorkOrder,
  listMyAssignedWorkOrders,
  listWorkOrderOperatingCompanies,
  subscribeToWorkOrders,
  transitionWorkOrder,
  updateWorkOrderExecutionData,
} from "../src/services/workOrderService.ts";
import { loadErrorMessage } from "../src/domain/loadErrorMessage.js";
import { workflowActionErrorMessage } from "../src/domain/workflowActionError.js";
import { workOrderSyncError } from "../src/offline/workOrderSyncError.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

/** A minimal recording fake: calls are kept, the answer is whatever `impl` returns. */
function spy(impl = () => undefined) {
  const fn = (...args) => {
    fn.calls.push(args);
    return impl(...args);
  };
  fn.calls = [];
  return fn;
}
const respond = (status, body) => spy(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
const opts = (fetchImpl, extra = {}) => ({ baseUrl: "https://eos.example.test/", getIdToken: async () => "tok-wo", fetchImpl, ...extra });
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

afterEach(() => __setWorkOrderTransportForTests(null));

describe("the closed operation list", () => {
  it("mirrors the server's EOS_WORK_ORDER_OPERATIONS keys + readWorkOrderAuthorityStatus exactly", () => {
    const server = read("../functions/src/eosOps/workOrderOperations.ts");
    const start = server.indexOf("export const EOS_WORK_ORDER_OPERATIONS");
    const block = server.slice(start, server.indexOf("} satisfies Record<string, Op>);", start));
    const keys = [...block.matchAll(/^ {2}([a-zA-Z]+):/gm)].map((m) => m[1]);
    assert.ok(keys.length > 15, `parsed ${keys.length} server operations`);
    const readsBlock = server.match(/WORK_ORDER_READ_OPERATIONS[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/)[1];
    const serverReads = readsBlock.match(/"([a-zA-Z]+)"/g).map((s) => s.slice(1, -1));
    // Customer self-scheduling (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30) SPREADS its reads from its own
    // module; the spread is resolved from that module's source so the mirror stays exact.
    if (/\.\.\.SELF_SCHEDULING_READ_OPERATIONS/.test(readsBlock)) {
      const ss = read("../functions/src/eosOps/selfScheduling.ts");
      serverReads.push(...ss.match(/SELF_SCHEDULING_READ_OPERATIONS[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/)[1]
        .match(/"([a-zA-Z]+)"/g).map((q) => q.slice(1, -1)));
    }

    assert.deepEqual([...WORK_ORDER_READ_OPERATIONS].sort(), [...serverReads].sort());
    assert.deepEqual(
      [...WORK_ORDER_READ_OPERATIONS, ...WORK_ORDER_COMMAND_OPERATIONS].sort(),
      [...keys, "readWorkOrderAuthorityStatus"].sort(),
    );
    assert.deepEqual([...WORK_ORDER_COMMAND_OPERATIONS], keys.filter((k) => !serverReads.includes(k)));
    assert.ok(WORK_ORDER_READ_OPERATIONS.includes("listWorkOrderOperatingCompanies"));
    for (const name of [...WORK_ORDER_READ_OPERATIONS, ...WORK_ORDER_COMMAND_OPERATIONS]) assert.equal(isWorkOrderOperation(name), true, name);
    // Installation IS a governed Work Order operation now (Controller EQUIPMENT ACTIVATION, OD-5, 2026-10-01) -- the INSTALL
    // Work Order is the only installation workflow. No standalone install, no consumption-source picking, no raw transition.
    assert.equal(isWorkOrderOperation("recordWorkOrderEquipmentInstall"), true);
    assert.ok(WORK_ORDER_READ_OPERATIONS.includes("listInstallableEquipmentForWorkOrder"));
    for (const name of ["transitionWorkOrder", "updateWorkOrderExecutionData", "listWorkOrderConsumptionSources",
      "installSerializedAsset", "installEquipment", "", null, 42]) {
      assert.equal(isWorkOrderOperation(name), false, String(name));
    }
  });

  it("posts to the server's route", () => {
    assert.match(read("../functions/src/eosOps/eosOpsHttp.ts"), /WORK_ORDER_ROUTE = "\/operations\/work-orders"/);
    assert.equal(WORK_ORDER_ROUTE, "/operations/work-orders");
  });
});

describe("callWorkOrderApi", () => {
  it("sends { operation, input } with the bearer and the stated tenant", async () => {
    const fetchImpl = respond(200, { ok: true, operation: "readWorkOrder", result: { workOrderId: "wo_1" } });
    const out = await callWorkOrderApi("readWorkOrder", { workOrderId: "wo_1" }, opts(fetchImpl, { tenantId: "t1" }));
    assert.deepEqual(out, { ok: true, operation: "readWorkOrder", result: { workOrderId: "wo_1" } });
    const [url, init] = fetchImpl.calls[0];
    assert.equal(url, "https://eos.example.test/operations/work-orders");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.authorization, "Bearer tok-wo");
    assert.equal(init.headers["x-eos-tenant"], "t1");
    assert.deepEqual(JSON.parse(init.body), { operation: "readWorkOrder", input: { workOrderId: "wo_1" } });
  });

  it("maps 503 NOT_ACTIVATED to its own category, and a dependency 503 to UNAVAILABLE", async () => {
    const notActive = await callWorkOrderApi("listWorkOrders", {},
      opts(respond(503, { ok: false, code: "NOT_ACTIVATED", message: "the PostgreSQL Work Order authority is not activated yet" })));
    assert.deepEqual(pick(notActive, ["ok", "code", "reason", "status"]), { ok: false, code: "NOT_ACTIVATED", reason: "NOT_ACTIVATED", status: 503 });
    const dep = await callWorkOrderApi("completeWorkOrder", { workOrderId: "w" },
      opts(respond(503, { ok: false, code: "SALES_ORDER_FULFILLMENT_AUTHORITY_UNAVAILABLE", message: "x" })));
    assert.deepEqual(pick(dep, ["code", "reason"]), { code: "UNAVAILABLE", reason: "SALES_ORDER_FULFILLMENT_AUTHORITY_UNAVAILABLE" });
    assert.equal(workOrderFailureCategory(503, "NOT_ACTIVATED"), "NOT_ACTIVATED");
    assert.equal(workOrderFailureCategory(412, "START_IN_PAST"), "PRECONDITION_FAILED");
    assert.equal(workOrderFailureCategory(409, "STALE_SCHEDULE"), "CONFLICT");
    assert.equal(workOrderFailureCategory(403, "CAPABILITY_MISSING"), "FORBIDDEN");
    assert.equal(workOrderFailureCategory(400, "INPUT_FIELD_NOT_ACCEPTED"), "INVALID_INPUT");
    assert.equal(workOrderFailureCategory(404, "WORK_ORDER_NOT_FOUND"), "NOT_FOUND");
    assert.equal(workOrderFailureCategory(500, "INTERNAL"), "INTERNAL");
  });

  it("never throws: unknown operation, no base URL, no token, a thrown fetch, a non-JSON body", async () => {
    assert.equal((await callWorkOrderApi("transitionWorkOrder", {}, opts(respond(200, {})))).code, "UNKNOWN_OPERATION");
    assert.equal((await callWorkOrderApi("listWorkOrders", {}, { baseUrl: "", getIdToken: async () => "t" })).code, "NOT_CONFIGURED");
    assert.equal((await callWorkOrderApi("listWorkOrders", {}, { baseUrl: "https://x", getIdToken: async () => null })).code, "NOT_SIGNED_IN");
    assert.equal((await callWorkOrderApi("listWorkOrders", {}, { baseUrl: "https://x", getIdToken: async () => { throw new Error("boom"); } })).code,
      "NOT_SIGNED_IN");
    assert.equal((await callWorkOrderApi("listWorkOrders", {}, opts(spy(async () => { throw new Error("offline"); })))).code, "UNREACHABLE");
    const html = await callWorkOrderApi("listWorkOrders", {}, opts(spy(async () => ({ ok: false, status: 502, json: async () => { throw new Error("html"); } }))));
    assert.deepEqual(pick(html, ["ok", "code", "status"]), { ok: false, code: "INTERNAL", status: 502 });
  });
});

describe("readiness is fail-closed (DQ-S4)", () => {
  const client = (res) => ({ call: async () => res });
  it("ACTIVE only on an explicit ACTIVE answer", async () => {
    assert.equal((await readWorkOrderAuthorityStatus(client({ ok: true, result: { postgres: "ACTIVE", readiness: "ACTIVE" } }))).readiness,
      WORK_ORDER_READINESS.ACTIVE);
    assert.equal((await readWorkOrderAuthorityStatus(client({ ok: true, result: { postgres: "INACTIVE", readiness: "NOT_YET_ACTIVATED" } }))).readiness,
      WORK_ORDER_READINESS.NOT_YET_ACTIVATED);
    assert.equal((await readWorkOrderAuthorityStatus(client({ ok: true, result: {} }))).readiness, WORK_ORDER_READINESS.NOT_YET_ACTIVATED);
    assert.equal((await readWorkOrderAuthorityStatus(client({ ok: false, code: "UNREACHABLE" }))).readiness, WORK_ORDER_READINESS.UNAVAILABLE);
  });

  it("the safe-copy helpers say NOT_YET_ACTIVATED, never 'no work orders' and never a raw code", () => {
    assert.match(loadErrorMessage({ code: "NOT_ACTIVATED" }, { entity: "work orders" }), /NOT_YET_ACTIVATED/);
    assert.match(workflowActionErrorMessage({ code: "NOT_ACTIVATED" }), /NOT_YET_ACTIVATED.*Nothing was changed/);
    assert.match(workflowActionErrorMessage({ code: "FORBIDDEN" }), /not allowed/i);
    assert.match(workflowActionErrorMessage({ code: "PRECONDITION_FAILED" }), /isn't valid/i);
  });

  it("an offline-queued command keeps NOT_ACTIVATED retryable and a refusal a refusal", () => {
    assert.deepEqual(workOrderSyncError({ code: "NOT_ACTIVATED", reason: "NOT_ACTIVATED" }), { code: "unavailable", details: "NOT_ACTIVATED" });
    assert.deepEqual(workOrderSyncError({ code: "FORBIDDEN", reason: "NOT_ASSIGNED" }), { code: "permission-denied", details: "NOT_ASSIGNED" });
    assert.deepEqual(workOrderSyncError({ code: "PRECONDITION_FAILED", reason: "STALE_WORK_ORDER_STATE" }),
      { code: "failed-precondition", details: "STALE_WORK_ORDER_STATE" });
  });
});

describe("the adapter: governed summary/detail -> the legacy WorkOrder shape", () => {
  const summary = {
    workOrderId: "wo_1", workOrderNumber: "WO-2026-000001", status: "SCHEDULED", workOrderType: "SERVICE_CALL", priority: 2,
    severity: null, operatingCompanyKey: "taylor", customerId: "acct_1", customerName: "Harbor Grill", locationId: "loc_1",
    locationName: "Main St", equipmentId: null, salesOrderId: null, scheduledStart: "2026-10-01T15:00:00.000Z",
    scheduledEnd: "2026-10-01T17:00:00.000Z", assigneeEmployeeId: "emp_9", assigneeDisplayName: "Dana Tech",
    complaint: "No cooling", provenance: "NATIVE", createdAt: "2026-09-30T10:00:00.000Z", updatedAt: "2026-09-30T11:00:00.000Z",
  };

  it("maps ids, numbers, the EMPLOYEE assignee and Timestamp-compatible instants", () => {
    const wo = adaptWorkOrder(summary);
    assert.deepEqual(pick(wo, ["id", "woNumber", "status", "type", "priority", "customerId", "customerName", "locationId", "locationName",
      "assignedTechId", "scheduledTechId", "assigneeEmployeeId", "assigneeDisplayName", "complaint"]), {
      id: "wo_1", woNumber: "WO-2026-000001", status: "SCHEDULED", type: "SERVICE_CALL", priority: 2,
      customerId: "acct_1", customerName: "Harbor Grill", locationId: "loc_1", locationName: "Main St",
      assignedTechId: "emp_9", scheduledTechId: "emp_9", assigneeEmployeeId: "emp_9", assigneeDisplayName: "Dana Tech",
      complaint: "No cooling",
    });
    assert.equal(wo.scheduledStart.toMillis(), Date.parse("2026-10-01T15:00:00.000Z"));
    assert.ok(wo.scheduledStart.toDate() instanceof Date);
    assert.equal(wo.scheduledStart.seconds, Math.floor(Date.parse("2026-10-01T15:00:00.000Z") / 1000));
    assert.equal(wo.createdAt.toMillis(), Date.parse("2026-09-30T10:00:00.000Z"));
    // Absent is absent: no equipment, no severity, and a summary carries no lifecycle timestamps or parts.
    for (const k of ["equipmentId", "severity", "completedAt", "inventorySnapshot"]) assert.equal(k in wo, false, k);
  });

  it("a DETAIL carries execution parts as inventorySnapshot, notes as executionLog, and lifecycle timestamps", () => {
    const wo = adaptWorkOrder({
      ...summary,
      timestamps: { dispatchedAt: null, acceptedAt: null, enRouteAt: null, arrivedAt: null, workStartedAt: "2026-10-01T15:10:00.000Z",
        completedAt: "2026-10-01T16:00:00.000Z", closedAt: null },
      diagnosis: "Fan", resolution: null, estimatedDurationMinutes: 90,
      execution: { parts: [{ partId: "part_a", qtyPlanned: 2, qtyUsed: 1 }],
        notes: [{ note: "arrived", recordedByPrincipalId: "p1", recordedAt: "2026-10-01T15:05:00.000Z" }] },
      transitions: [{ toStatus: "SCHEDULED" }], assignmentHistory: [],
    });
    assert.deepEqual(wo.inventorySnapshot, [{ sku: "part_a", partId: "part_a", qtyPlanned: 2, qtyUsed: 1 }]);
    assert.deepEqual(pick(wo.executionLog[0], ["note", "byPrincipalId"]), { note: "arrived", byPrincipalId: "p1" });
    assert.equal(wo.executionLog[0].at.toMillis(), Date.parse("2026-10-01T15:05:00.000Z"));
    assert.equal(wo.workStartedAt.toMillis(), Date.parse("2026-10-01T15:10:00.000Z"));
    assert.equal(wo.completedAt.toMillis(), Date.parse("2026-10-01T16:00:00.000Z"));
    assert.equal(wo.estimatedDurationMinutes, 90);
    assert.equal("dispatchedAt" in wo, false);
  });

  it("drops malformed rows and never fabricates an instant", () => {
    assert.equal(adaptWorkOrder(null), null);
    assert.equal(adaptWorkOrder({ status: "CREATED" }), null);
    assert.equal(eosInstant(null), undefined);
    assert.equal(eosInstant("not a date"), undefined);
  });

  it("technicians: the roster row's id IS the Employee id, and rows carry their own assignee names", () => {
    const t = adaptWorkOrderTechnician({ employeeId: "emp_9", displayName: "Dana Tech", employeeNumber: "E9", employmentStatus: "ACTIVE",
      operatingCompanyId: "taylor", jobTitle: "Tech" });
    assert.deepEqual(pick(t, ["id", "name", "operatingCompanyId"]), { id: "emp_9", name: "Dana Tech", operatingCompanyId: "taylor" });
    assert.deepEqual(techniciansFromWorkOrders([adaptWorkOrder(summary)]),
      [{ id: "emp_9", employeeId: "emp_9", name: "Dana Tech", displayName: "Dana Tech" }]);
  });
});

describe("the service routes every legacy call through the governed operations", () => {
  it("maps each ActionName to its governed operation", () => {
    assert.deepEqual({ ...OPERATION_BY_ACTION }, {
      MarkReady: "markWorkOrderReady", Accept: "acceptWorkOrder", Travel: "startWorkOrderTravel", Arrive: "arriveAtWorkOrder",
      WorkStart: "startWorkOrderWork", Complete: "completeWorkOrder", Close: "closeWorkOrder", Schedule: "scheduleWorkOrder",
      Unschedule: "unscheduleWorkOrder", Dispatch: "dispatchWorkOrder", Cancel: "cancelWorkOrder",
    });
    assert.deepEqual(buildTransitionRequest("w1", "Schedule", { scheduledStart: 1, scheduledEnd: 2, scheduledTechId: "emp_1" }),
      { operation: "scheduleWorkOrder", input: { workOrderId: "w1", employeeId: "emp_1", scheduledStart: 1, scheduledEnd: 2 } });
    assert.deepEqual(buildTransitionRequest("w1", "Unschedule", { unscheduleReason: "customer" }),
      { operation: "unscheduleWorkOrder", input: { workOrderId: "w1", reason: "customer" } });
    assert.deepEqual(buildTransitionRequest("w1", "Dispatch", { assignedTechId: "emp_2", reassignReason: "sick" }),
      { operation: "dispatchWorkOrder", input: { workOrderId: "w1", employeeId: "emp_2", reassignReason: "sick" } });
    assert.deepEqual(buildTransitionRequest("w1", "Cancel", { expectedStatus: "SCHEDULED" }),
      { operation: "cancelWorkOrder", input: { workOrderId: "w1", expectedStatus: "SCHEDULED" } });
    assert.throws(() => buildTransitionRequest("w1", "Cancel", {}), /cancelled from/);
    assert.deepEqual(buildTransitionRequest("w1", "Accept"), { operation: "acceptWorkOrder", input: { workOrderId: "w1" } });
  });

  it("a refusal throws a WorkOrderApiError carrying the category and the server's reason", async () => {
    __setWorkOrderTransportForTests(async () => ({ ok: false, code: "PRECONDITION_FAILED", reason: "START_IN_PAST", status: 412, message: "past" }));
    await assert.rejects(
      transitionWorkOrder("w1", "Schedule", { scheduledStart: 1, scheduledEnd: 2, scheduledTechId: "e" }),
      (err) => err.name === "WorkOrderApiError" && err.code === "PRECONDITION_FAILED" && err.reason === "START_IN_PAST"
        && err.operation === "scheduleWorkOrder",
    );
  });

  it("getWorkOrder: NOT_FOUND is a confirmed absence (null); NOT_ACTIVATED is thrown, never null", async () => {
    __setWorkOrderTransportForTests(async () => ({ ok: false, code: "NOT_FOUND", reason: "WORK_ORDER_NOT_FOUND", status: 404, message: "x" }));
    assert.equal(await getWorkOrder("w1"), null);
    __setWorkOrderTransportForTests(async () => ({ ok: false, code: "NOT_ACTIVATED", reason: "NOT_ACTIVATED", status: 503, message: "x" }));
    await assert.rejects(getWorkOrder("w1"), (err) => err.code === "NOT_ACTIVATED");
  });

  it("createWorkOrder refuses locally without an operating company -- nothing is inferred, nothing is sent", async () => {
    const call = spy(async () => ({ ok: true, operation: "createWorkOrder", result: { workOrderId: "wo_9", workOrderNumber: "WO-9" } }));
    __setWorkOrderTransportForTests(call);
    await assert.rejects(createWorkOrder({ customerId: "a", locationId: "l", priority: 3, type: "PM" }),
      (err) => err.code === "INVALID_INPUT" && err.reason === "OPERATING_COMPANY_REQUIRED");
    assert.equal(call.calls.length, 0);
    assert.deepEqual(await createWorkOrder({ operatingCompanyId: "taylor", customerId: "a", locationId: "l", priority: 3, type: "PM", complaint: "c" }),
      { id: "wo_9", woNumber: "WO-9", replayed: false });
    assert.deepEqual(call.calls.at(-1), ["createWorkOrder",
      { operatingCompanyId: "taylor", customerId: "a", locationId: "l", workOrderType: "PM", priority: 3, complaint: "c" }]);
  });

  it("createWorkOrder carries the stable idempotency key and reports a replay", async () => {
    const call = spy(async () => ({ ok: true, operation: "createWorkOrder", result: { workOrderId: "wo_9", workOrderNumber: "WO-9", replayed: true } }));
    __setWorkOrderTransportForTests(call);
    const out = await createWorkOrder({ operatingCompanyId: "taylor", customerId: "a", locationId: "l", priority: 3, type: "PM", idempotencyKey: " wo_k1 " });
    assert.deepEqual(out, { id: "wo_9", woNumber: "WO-9", replayed: true });
    assert.equal(call.calls[0][1].idempotencyKey, "wo_k1");
    await assert.rejects(
      createWorkOrder({ operatingCompanyId: "taylor", customerId: "a", locationId: "l", priority: 3, type: "PM", idempotencyKey: "k".repeat(151) }),
      (err) => err.reason === "IDEMPOTENCY_KEY_INVALID");
    assert.equal(call.calls.length, 1, "an over-long key is refused before any request");
    __setWorkOrderTransportForTests(async () => ({ ok: false, code: "CONFLICT", reason: "IDEMPOTENCY_KEY_REUSED", status: 409, message: "x" }));
    await assert.rejects(
      createWorkOrder({ operatingCompanyId: "taylor", customerId: "a", locationId: "l", priority: 3, type: "PM", idempotencyKey: "wo_k1" }),
      (err) => err.code === "CONFLICT" && err.reason === "IDEMPOTENCY_KEY_REUSED");
  });

  it("listWorkOrderOperatingCompanies returns the governed companies, and a refusal is thrown -- never an empty list", async () => {
    const call = spy(async () => ({ ok: true, operation: "listWorkOrderOperatingCompanies",
      result: { items: [{ operatingCompanyId: "taylor", operatingCompanyKey: "TAYLOR" }, { operatingCompanyKey: "no-id" }] } }));
    __setWorkOrderTransportForTests(call);
    assert.deepEqual(await listWorkOrderOperatingCompanies(), [{ operatingCompanyId: "taylor", operatingCompanyKey: "TAYLOR" }]);
    assert.deepEqual(call.calls[0], ["listWorkOrderOperatingCompanies", {}]);
    __setWorkOrderTransportForTests(async () => ({ ok: false, code: "NOT_ACTIVATED", reason: "NOT_ACTIVATED", status: 503, message: "x" }));
    await assert.rejects(listWorkOrderOperatingCompanies(), (err) => err.code === "NOT_ACTIVATED");
  });

  it("execution capture -> recordWorkOrderExecution with partUsage deltas and an idempotency key", async () => {
    const call = spy(async () => ({ ok: true, operation: "recordWorkOrderExecution", result: { outcome: "RECORDED", inventoryBoundary: "NO_STOCK_MOVEMENT" } }));
    __setWorkOrderTransportForTests(call);
    const out = await updateWorkOrderExecutionData("w1", { qtyUsedUpdates: [{ sku: "part_a", delta: 1 }], executionNote: " done ", idempotencyKey: "k1" });
    assert.equal(out.success, true);
    assert.equal(out.inventoryBoundary, "NO_STOCK_MOVEMENT");
    assert.deepEqual(call.calls[0], ["recordWorkOrderExecution",
      { workOrderId: "w1", idempotencyKey: "k1", partUsage: [{ partId: "part_a", qtyDelta: 1 }], note: "done" }]);
    await updateWorkOrderExecutionData("w1", { executionNote: "x" });
    assert.match(call.calls[1][1].idempotencyKey, /^woexec_/);
  });

  it("the technician's own work comes from listMyAssignedWorkOrders only -- no technician id is sent", async () => {
    const call = spy(async (op) => (op === "listMyAssignedWorkOrders"
      ? { ok: true, operation: op, result: { employeeId: "emp_9", items: [{ workOrderId: "wo_1", status: "DISPATCHED", createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z" }] } }
      : { ok: true, operation: op, result: { workOrderId: "wo_1", status: "DISPATCHED", execution: { parts: [], notes: [] }, createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z" } }));
    __setWorkOrderTransportForTests(call);
    const out = await listMyAssignedWorkOrders({ withDetail: true });
    assert.equal(out.employeeId, "emp_9");
    assert.equal(out.items[0].id, "wo_1");
    assert.deepEqual(out.items[0].inventorySnapshot, []);
    assert.deepEqual(call.calls[0], ["listMyAssignedWorkOrders", {}]);
  });

  it("the refresh loop loads immediately, stops on NOT_ACTIVATED, and unsubscribes cleanly", async () => {
    const call = spy(async () => ({ ok: false, code: "NOT_ACTIVATED", reason: "NOT_ACTIVATED", status: 503, message: "x" }));
    __setWorkOrderTransportForTests(call);
    const changes = [];
    const errors = [];
    const unsub = subscribeToWorkOrders((v) => changes.push(v), (e) => errors.push(e), { intervalMs: 20 });
    await new Promise((r) => setTimeout(r, 120));
    unsub();
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, "NOT_ACTIVATED");
    assert.equal(call.calls.length, 1, "a NOT_ACTIVATED answer is not polled");
    assert.equal(changes.length, 0);
  });
});

describe("no Work Order Firestore read and no Work Order Firebase callable in the converted client", () => {
  const files = [
    "src/services/workOrderService.ts", "src/services/workOrderApiClient.js", "src/hooks/useWorkOrder.js",
    "src/hooks/useWorkOrders.js", "src/hooks/useAssignedWorkOrders.js", "src/hooks/useWorkOrderSearch.js",
    "src/hooks/useSchedulingData.js", "src/hooks/usePartWorkOrderDemand.js", "src/domain/accountWorkOrders.js",
    "src/metadata/workOrderListSource.js", "src/services/schedulingCommandClient.js",
  ];
  it("none of the converted modules imports firebase/firestore or names a Work Order callable", () => {
    for (const f of files) {
      const src = read(f);
      assert.doesNotMatch(src, /from "firebase\/firestore"/, f);
      assert.doesNotMatch(src,
        /["'](createWorkOrder|transitionWorkOrder|updateWorkOrderExecutionData|setWorkOrderPartsPlan|listWorkOrderConsumptionSources|rescheduleWorkOrderCallable|reassignScheduledWorkOrderCallable|setWorkOrderEstimatedDurationCallable)["']\s*\)/,
        f);
    }
    assert.doesNotMatch(read("src/services/workOrderService.ts"), /firebase/);
  });

  it("across src/, no file calls one of the five retired Work Order callables", () => {
    const walk = (dir) => readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const offenders = walk(path.resolve(process.cwd(), "src"))
      .filter((p) => /\.(js|jsx|ts|tsx)$/.test(p))
      .filter((p) => /httpsCallable\([^)]*["'](createWorkOrder|transitionWorkOrder|updateWorkOrderExecutionData|setWorkOrderPartsPlan|listWorkOrderConsumptionSources)["']/
        .test(readFileSync(p, "utf8")));
    assert.deepEqual(offenders, []);
  });

  it("the Work Order metadata entity reads through the governed route, not Firestore", () => {
    assert.match(read("src/metadata/definitions/workOrder.js"), /readVia: "EOS_API"/);
    assert.match(read("src/hooks/useMetadataList.js"), /entity\?\.id === "workOrder"\) return fetchWorkOrderPage/);
  });
});
