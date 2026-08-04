// EI Receiving -- focused tests for the isolated, readiness-false callable transport (LF1b):
// the pure domain contract (domain/receivingTransport.js) + the thin client
// (services/receivingCallableClient.js) driven through an INJECTED invoker + readiness override,
// so no Firebase is loaded. Pure logic; placed under test/ with .test.jsx for auto-discovery.
import { describe, it, expect, vi } from "vitest";
import {
  CALLABLE_NAMES,
  RECEIVING_OUTCOME,
  OPTIONS_REQUEST,
  buildReceiveRequest,
  validateOptionsResponse,
  validateReceiveResponse,
  mapCallableErrorToStatus,
} from "../src/domain/receivingTransport.js";
import { fetchReceivingLocationOptions, submitReceiveInventoryStock, __test__ as CLIENT } from "../src/services/receivingCallableClient.js";
const { fetchOptionsCore, submitReceiveCore } = CLIENT;

// A well-formed receive request carrying the exact frozen fields.
const RECEIVE_REQ = () => ({
  source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "RR-1", purchaseOrderId: "PO-1" },
  receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
  lines: [{ lineId: "L1", partId: "P1", expectedQuantity: 2, receivedQuantity: 2 }],
  idempotencyKey: "recv-key-123",
});
const okInvoke = (data) => vi.fn().mockResolvedValue(data);
const throwInvoke = (err) => vi.fn().mockRejectedValue(err);

describe("receivingTransport -- frozen names + requests", () => {
  it("pins the exact deployed callable names", () => {
    expect(CALLABLE_NAMES).toEqual({ receive: "receiveInventoryStock", listOptions: "listReceivingLocationOptions" });
  });
  it("the options request is the exact empty object", () => {
    expect(OPTIONS_REQUEST).toEqual({});
    expect(Object.keys(OPTIONS_REQUEST)).toEqual([]);
  });
});

describe("buildReceiveRequest -- exact frozen fields, sanitized, verbatim key", () => {
  it("builds the exact sanitized payload for a valid request", () => {
    expect(buildReceiveRequest(RECEIVE_REQ())).toEqual(RECEIVE_REQ());
  });
  it("preserves the idempotencyKey verbatim (never generated)", () => {
    expect(buildReceiveRequest(RECEIVE_REQ()).idempotencyKey).toBe("recv-key-123");
  });
  it("strips unknown top-level fields by failing closed (null)", () => {
    expect(buildReceiveRequest({ ...RECEIVE_REQ(), extra: 1 })).toBeNull();
  });
  it.each([
    ["missing idempotencyKey", (r) => { delete r.idempotencyKey; }],
    ["blank idempotencyKey", (r) => { r.idempotencyKey = "  "; }],
    ["wrong source.type", (r) => { r.source.type = "OTHER"; }],
    ["unknown source key", (r) => { r.source.extra = 1; }],
    ["blank reorderRequestId", (r) => { r.source.reorderRequestId = ""; }],
    ["wrong location.type", (r) => { r.receivingLocation.type = "BIN"; }],
    ["unknown location key", (r) => { r.receivingLocation.extra = 1; }],
    ["zero lines", (r) => { r.lines = []; }],
    ["two lines", (r) => { r.lines = [r.lines[0], r.lines[0]]; }],
    ["unknown line key", (r) => { r.lines[0].extra = 1; }],
    ["non-finite expectedQuantity", (r) => { r.lines[0].expectedQuantity = NaN; }],
    ["string receivedQuantity", (r) => { r.lines[0].receivedQuantity = "2"; }],
    ["non-object request", () => {}, "notanobject"],
  ])("rejects %s -> null", (_l, mutate, override) => {
    if (override !== undefined) { expect(buildReceiveRequest(override)).toBeNull(); return; }
    const r = RECEIVE_REQ();
    mutate(r);
    expect(buildReceiveRequest(r)).toBeNull();
  });
  it("does not mutate the input request", () => {
    const r = RECEIVE_REQ();
    const before = JSON.stringify(r);
    buildReceiveRequest(r);
    expect(JSON.stringify(r)).toBe(before);
  });
});

describe("validateOptionsResponse -- exact { options: [...] }", () => {
  it("accepts { options: [...] }", () => {
    expect(validateOptionsResponse({ options: [{ value: "a" }] })).toEqual([{ value: "a" }]);
  });
  it.each([
    ["unknown field", { options: [], extra: 1 }],
    ["options not array", { options: 5 }],
    ["missing options", {}],
    ["non-object", "x"],
    ["null", null],
  ])("rejects %s -> null", (_l, data) => {
    expect(validateOptionsResponse(data)).toBeNull();
  });
});

describe("validateReceiveResponse -- exact receipt envelope", () => {
  it.each([["applied"], ["replayed"]])("accepts a %s outcome", (outcome) => {
    expect(validateReceiveResponse({ outcome, receivingId: "RCV-1", ledgerEventId: "LE-1" })).toEqual({ outcome, receivingId: "RCV-1", ledgerEventId: "LE-1" });
  });
  it.each([
    ["unknown field", { outcome: "applied", receivingId: "R", ledgerEventId: "L", extra: 1 }],
    ["bad outcome", { outcome: "done", receivingId: "R", ledgerEventId: "L" }],
    ["blank receivingId", { outcome: "applied", receivingId: "", ledgerEventId: "L" }],
    ["missing ledgerEventId", { outcome: "applied", receivingId: "R" }],
    ["non-object", 5],
  ])("rejects %s -> null", (_l, data) => {
    expect(validateReceiveResponse(data)).toBeNull();
  });
});

describe("mapCallableErrorToStatus -- frozen codes only", () => {
  it.each([
    ["unauthenticated", RECEIVING_OUTCOME.UNAUTHENTICATED],
    ["permission-denied", RECEIVING_OUTCOME.DENIED],
    ["invalid-argument", RECEIVING_OUTCOME.INVALID],
    ["not-found", RECEIVING_OUTCOME.NOT_FOUND],
    ["failed-precondition", RECEIVING_OUTCOME.CONFLICT],
    ["internal", RECEIVING_OUTCOME.UNAVAILABLE],
  ])("maps %s (and the functions/-prefixed form)", (code, status) => {
    expect(mapCallableErrorToStatus({ code })).toBe(status);
    expect(mapCallableErrorToStatus({ code: `functions/${code}` })).toBe(status);
  });
  it.each([
    ["unknown code", { code: "resource-exhausted" }],
    ["no code", { message: "boom" }],
    ["null", null],
    ["non-error", "x"],
  ])("fails closed on %s -> UNAVAILABLE", (_l, err) => {
    expect(mapCallableErrorToStatus(err)).toBe(RECEIVING_OUTCOME.UNAVAILABLE);
  });
});

// The PUBLIC production methods take no readiness override and no injectable invoker: they
// consult ONLY the governed constant (currently false), so nothing can invoke while readiness
// is false, and no extra option can enable invocation.
describe("receivingCallableClient -- production readiness gate (no override)", () => {
  it("fetchReceivingLocationOptions() -> UNAVAILABLE while readiness is false", async () => {
    expect(await fetchReceivingLocationOptions()).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] });
  });
  it("submitReceiveInventoryStock(request) -> UNAVAILABLE while readiness is false", async () => {
    expect(await submitReceiveInventoryStock(RECEIVE_REQ())).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE });
  });
  it("passing extra options (readyOverride/invoke) to the PUBLIC API cannot enable invocation", async () => {
    const invoke = okInvoke({ options: [{ value: "WH-1", label: "A", type: "WAREHOUSE" }] });
    // The public methods ignore any extra argument; readiness stays governed by the constant.
    expect(await fetchReceivingLocationOptions({ readyOverride: true, invoke })).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] });
    expect(await submitReceiveInventoryStock(RECEIVE_REQ(), { readyOverride: true, invoke })).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE });
    expect(invoke).not.toHaveBeenCalled();
  });
});

// The ready branch is exercised through the test-only invocation core (no production seam).
describe("fetchOptionsCore -- invocation (test seam)", () => {
  it("calls the exact name with {} and adapts the options", async () => {
    const invoke = okInvoke({ options: [{ value: "WH-2", label: "Bravo", type: "WAREHOUSE" }, { value: "WH-1", label: "Alpha", type: "WAREHOUSE" }] });
    const r = await fetchOptionsCore(invoke);
    expect(invoke).toHaveBeenCalledWith("listReceivingLocationOptions", {});
    expect(r.status).toBe(RECEIVING_OUTCOME.READY);
    expect(r.options.map((o) => o.value)).toEqual(["WH-1", "WH-2"]); // adapter sorts by label
  });
  it("malformed envelope -> UNAVAILABLE", async () => {
    expect(await fetchOptionsCore(okInvoke({ options: 5 }))).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] });
  });
  it("adapter failure (bad option row) -> UNAVAILABLE", async () => {
    expect(await fetchOptionsCore(okInvoke({ options: [{ value: "a/b", label: "X", type: "WAREHOUSE" }] }))).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] });
  });
  it("maps a frozen callable error", async () => {
    expect(await fetchOptionsCore(throwInvoke({ code: "functions/permission-denied" }))).toEqual({ status: RECEIVING_OUTCOME.DENIED, options: [] });
  });
});

describe("submitReceiveCore -- invocation (test seam)", () => {
  it("malformed request -> INVALID, ZERO callable attempts", async () => {
    const invoke = okInvoke({ outcome: "applied", receivingId: "R", ledgerEventId: "L" });
    expect(await submitReceiveCore({ ...RECEIVE_REQ(), extra: 1 }, invoke)).toEqual({ status: RECEIVING_OUTCOME.INVALID });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("applied: sends exact name + sanitized payload; returns APPLIED + receipt", async () => {
    const invoke = okInvoke({ outcome: "applied", receivingId: "RCV-9", ledgerEventId: "LE-9" });
    const r = await submitReceiveCore(RECEIVE_REQ(), invoke);
    expect(invoke).toHaveBeenCalledWith("receiveInventoryStock", RECEIVE_REQ());
    expect(r).toEqual({ status: RECEIVING_OUTCOME.APPLIED, receipt: { outcome: "applied", receivingId: "RCV-9", ledgerEventId: "LE-9" } });
  });
  it("replayed outcome -> REPLAYED", async () => {
    const r = await submitReceiveCore(RECEIVE_REQ(), okInvoke({ outcome: "replayed", receivingId: "RCV-9", ledgerEventId: "LE-9" }));
    expect(r.status).toBe(RECEIVING_OUTCOME.REPLAYED);
  });
  it("preserves the SAME idempotencyKey across retries (no replacement key)", async () => {
    const invoke = okInvoke({ outcome: "applied", receivingId: "R", ledgerEventId: "L" });
    const req = RECEIVE_REQ();
    await submitReceiveCore(req, invoke);
    await submitReceiveCore(req, invoke);
    const [k1, k2] = invoke.mock.calls.map((c) => c[1].idempotencyKey);
    expect(k1).toBe("recv-key-123");
    expect(k2).toBe("recv-key-123");
    expect(k1).toBe(k2);
  });
  it("malformed response (unknown field) -> UNAVAILABLE", async () => {
    expect(await submitReceiveCore(RECEIVE_REQ(), okInvoke({ outcome: "applied", receivingId: "R", ledgerEventId: "L", extra: 1 }))).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE });
  });
  it.each([
    ["functions/unauthenticated", RECEIVING_OUTCOME.UNAUTHENTICATED],
    ["functions/permission-denied", RECEIVING_OUTCOME.DENIED],
    ["functions/invalid-argument", RECEIVING_OUTCOME.INVALID],
    ["functions/not-found", RECEIVING_OUTCOME.NOT_FOUND],
    ["functions/failed-precondition", RECEIVING_OUTCOME.CONFLICT],
    ["functions/internal", RECEIVING_OUTCOME.UNAVAILABLE],
  ])("maps callable error %s", async (code, status) => {
    const r = await submitReceiveCore(RECEIVE_REQ(), throwInvoke({ code, message: "RAW-BACKEND-DETAIL", details: { path: "warehouses/secret" } }));
    expect(r).toEqual({ status }); // ONLY the bounded status -- no raw message/details/path
  });
  it("never returns raw backend message/details/path on error", async () => {
    const r = await submitReceiveCore(RECEIVE_REQ(), throwInvoke({ code: "functions/internal", message: "RAW-BACKEND-DETAIL", details: { path: "warehouses/secret" } }));
    const json = JSON.stringify(r);
    expect(json.includes("RAW-BACKEND-DETAIL")).toBe(false);
    expect(json.includes("warehouses/secret")).toBe(false);
    expect(Object.keys(r)).toEqual(["status"]);
  });
  it("is deterministic across calls with the same inputs", async () => {
    const a = await submitReceiveCore(RECEIVE_REQ(), okInvoke({ outcome: "applied", receivingId: "R", ledgerEventId: "L" }));
    const b = await submitReceiveCore(RECEIVE_REQ(), okInvoke({ outcome: "applied", receivingId: "R", ledgerEventId: "L" }));
    expect(a).toEqual(b);
  });
});
