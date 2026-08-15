// EI Receiving -- focused tests for the isolated, readiness-false callable transport (LF1b):
// the pure domain contract (domain/receivingTransport.js) + the thin PUBLIC client
// (services/receivingCallableClient.js). The client has NO production-importable seam and NO
// readiness override, so its ready branch is exercised via BUILD-TIME MODULE MOCKING of the
// readiness + firebase modules (a mutable hoisted holder), never a runtime bypass.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CALLABLE_NAMES,
  RECEIVING_OUTCOME,
  OPTIONS_REQUEST,
  buildReceiveRequest,
  validateOptionsResponse,
  validateReceiveResponse,
  mapCallableErrorToStatus,
} from "../src/domain/receivingTransport.js";
import { fetchReceivingLocationOptions, submitReceiveInventoryStock } from "../src/services/receivingCallableClient.js";

// Hoisted, mutable control for the mocked readiness + firebase transport.
const H = vi.hoisted(() => ({ ready: false, respond: () => ({}), calls: [] }));

// Mock the GOVERNED readiness module: a live getter driven by H.ready (no runtime override seam).
vi.mock("../src/config/receivingReadiness.js", () => ({ get RECEIVING_TRANSPORT_READY() { return H.ready; } }));
// Mock firebase so the client's lazy default invoker resolves to a controllable callable.
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions, name) => (payload) => {
    H.calls.push([name, payload]);
    return Promise.resolve().then(() => ({ data: H.respond(name, payload) })); // H.respond may throw to simulate a callable error
  },
}));
vi.mock("../src/firebase/firebase.js", () => ({ functions: {} }));

beforeEach(() => {
  H.ready = false;
  H.respond = () => ({});
  H.calls.length = 0;
});

const RECEIVE_REQ = () => ({
  source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "RR-1", purchaseOrderId: "PO-1" },
  receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
  lines: [{ lineId: "L1", partId: "P1", expectedQuantity: 2, receivedQuantity: 2 }],
  idempotencyKey: "recv-key-123",
});

describe("receivingTransport -- frozen names + requests", () => {
  it("pins the exact deployed callable names", () => {
    expect(CALLABLE_NAMES).toEqual({ receive: "receiveInventoryStock", listOptions: "listReceivingLocationOptions" });
  });
  it("the options request is the exact empty object", () => {
    expect(OPTIONS_REQUEST).toEqual({});
    expect(Object.keys(OPTIONS_REQUEST)).toEqual([]);
  });
});

describe("buildReceiveRequest -- SERIAL lines (Wave 7)", () => {
  const withSerials = (serialNumbers) => {
    const r = RECEIVE_REQ();
    r.lines[0].serialNumbers = serialNumbers;
    return r;
  };

  it("carries serialNumbers through when supplied", () => {
    const built = buildReceiveRequest(withSerials(["SN-1", "SN-2"]));
    expect(built.lines[0].serialNumbers).toEqual(["SN-1", "SN-2"]);
  });

  it("omits the key entirely for a NONE receipt -- never sends an empty array", () => {
    const built = buildReceiveRequest(RECEIVE_REQ());
    expect("serialNumbers" in built.lines[0]).toBe(false);
  });

  it("trims serials but preserves case (serial identity is case-significant)", () => {
    const built = buildReceiveRequest(withSerials(["  SN-1 ", "sn-1"]));
    expect(built.lines[0].serialNumbers).toEqual(["SN-1", "sn-1"]);
  });

  it("rejects a malformed serial list rather than silently dropping it", () => {
    expect(buildReceiveRequest(withSerials("SN-1"))).toBeNull();
    expect(buildReceiveRequest(withSerials([]))).toBeNull();
    expect(buildReceiveRequest(withSerials([""]))).toBeNull();
    expect(buildReceiveRequest(withSerials(["SN-1", 5]))).toBeNull();
  });

  it("still rejects any OTHER unknown line key", () => {
    const r = RECEIVE_REQ();
    r.lines[0].lotId = "LOT-1";
    expect(buildReceiveRequest(r)).toBeNull();
  });

  it("still requires every mandatory line field", () => {
    const r = withSerials(["SN-1"]);
    delete r.lines[0].partId;
    expect(buildReceiveRequest(r)).toBeNull();
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

// Export-surface regressions: no production-importable un-gated seam / runtime override.
describe("export surface -- no bypass", () => {
  it("receivingCallableClient exports ONLY the two governed public methods", async () => {
    const ns = await import("../src/services/receivingCallableClient.js");
    expect(Object.keys(ns).sort()).toEqual(["fetchReceivingLocationOptions", "submitReceiveInventoryStock"]);
  });
  it("receivingReadiness exposes ONLY the constant (no runtime override/resolver)", async () => {
    const real = await vi.importActual("../src/config/receivingReadiness.js");
    expect(Object.keys(real)).toEqual(["RECEIVING_TRANSPORT_READY"]);
    expect(real.RECEIVING_TRANSPORT_READY).toBe(false);
  });
});

// Public methods while readiness is FALSE: no invocation, and extra args cannot enable one.
describe("public API -- readiness false gate", () => {
  it("fetchReceivingLocationOptions() -> UNAVAILABLE, zero callable attempts", async () => {
    expect(await fetchReceivingLocationOptions()).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] });
    expect(H.calls).toEqual([]);
  });
  it("submitReceiveInventoryStock(request) -> UNAVAILABLE, zero callable attempts", async () => {
    expect(await submitReceiveInventoryStock(RECEIVE_REQ())).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE });
    expect(H.calls).toEqual([]);
  });
  it("extra arguments cannot enable invocation while readiness is false", async () => {
    await fetchReceivingLocationOptions({ readyOverride: true, invoke: () => ({ options: [] }) });
    await submitReceiveInventoryStock(RECEIVE_REQ(), { readyOverride: true, invoke: () => ({ outcome: "applied" }) });
    expect(H.calls).toEqual([]); // extra args are ignored; the governed constant still gates
  });
});

// Public methods with readiness mocked TRUE: the ready branch, exercised through the mocked
// firebase transport (no production-importable seam).
describe("public API -- ready branch (readiness mocked true)", () => {
  beforeEach(() => { H.ready = true; });

  it("fetch: calls the exact name with {} and adapts the options", async () => {
    H.respond = () => ({ options: [{ value: "WH-2", label: "Bravo", type: "WAREHOUSE" }, { value: "WH-1", label: "Alpha", type: "WAREHOUSE" }] });
    const r = await fetchReceivingLocationOptions();
    expect(H.calls).toEqual([["listReceivingLocationOptions", {}]]);
    expect(r.status).toBe(RECEIVING_OUTCOME.READY);
    expect(r.options.map((o) => o.value)).toEqual(["WH-1", "WH-2"]); // adapter sorts by label
  });
  it("fetch: malformed envelope -> UNAVAILABLE", async () => {
    H.respond = () => ({ options: 5 });
    expect(await fetchReceivingLocationOptions()).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] });
  });
  it("fetch: adapter failure (bad option row) -> UNAVAILABLE", async () => {
    H.respond = () => ({ options: [{ value: "a/b", label: "X", type: "WAREHOUSE" }] });
    expect(await fetchReceivingLocationOptions()).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE, options: [] });
  });
  it("fetch: maps a frozen callable error", async () => {
    H.respond = () => { throw { code: "functions/permission-denied" }; };
    expect(await fetchReceivingLocationOptions()).toEqual({ status: RECEIVING_OUTCOME.DENIED, options: [] });
  });

  it("submit: malformed request -> INVALID, zero callable attempts", async () => {
    expect(await submitReceiveInventoryStock({ ...RECEIVE_REQ(), extra: 1 })).toEqual({ status: RECEIVING_OUTCOME.INVALID });
    expect(H.calls).toEqual([]);
  });
  it("submit: applied -> exact name + sanitized payload, APPLIED + receipt", async () => {
    H.respond = () => ({ outcome: "applied", receivingId: "RCV-9", ledgerEventId: "LE-9" });
    const r = await submitReceiveInventoryStock(RECEIVE_REQ());
    expect(H.calls).toEqual([["receiveInventoryStock", RECEIVE_REQ()]]);
    expect(r).toEqual({ status: RECEIVING_OUTCOME.APPLIED, receipt: { outcome: "applied", receivingId: "RCV-9", ledgerEventId: "LE-9" } });
  });
  it("submit: replayed -> REPLAYED", async () => {
    H.respond = () => ({ outcome: "replayed", receivingId: "RCV-9", ledgerEventId: "LE-9" });
    expect((await submitReceiveInventoryStock(RECEIVE_REQ())).status).toBe(RECEIVING_OUTCOME.REPLAYED);
  });
  it("submit: preserves the SAME idempotencyKey across retries", async () => {
    H.respond = () => ({ outcome: "applied", receivingId: "R", ledgerEventId: "L" });
    const req = RECEIVE_REQ();
    await submitReceiveInventoryStock(req);
    await submitReceiveInventoryStock(req);
    const [k1, k2] = H.calls.map((c) => c[1].idempotencyKey);
    expect(k1).toBe("recv-key-123");
    expect(k2).toBe("recv-key-123");
    expect(k1).toBe(k2);
  });
  it("submit: malformed response (unknown field) -> UNAVAILABLE", async () => {
    H.respond = () => ({ outcome: "applied", receivingId: "R", ledgerEventId: "L", extra: 1 });
    expect(await submitReceiveInventoryStock(RECEIVE_REQ())).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE });
  });
  it.each([
    ["functions/unauthenticated", RECEIVING_OUTCOME.UNAUTHENTICATED],
    ["functions/permission-denied", RECEIVING_OUTCOME.DENIED],
    ["functions/invalid-argument", RECEIVING_OUTCOME.INVALID],
    ["functions/not-found", RECEIVING_OUTCOME.NOT_FOUND],
    ["functions/failed-precondition", RECEIVING_OUTCOME.CONFLICT],
    ["functions/internal", RECEIVING_OUTCOME.UNAVAILABLE],
  ])("submit: maps callable error %s", async (code, status) => {
    H.respond = () => { throw { code, message: "RAW-BACKEND-DETAIL", details: { path: "warehouses/secret" } }; };
    expect(await submitReceiveInventoryStock(RECEIVE_REQ())).toEqual({ status });
  });
  it("submit: never returns raw backend message/details/path on error", async () => {
    H.respond = () => { throw { code: "functions/internal", message: "RAW-BACKEND-DETAIL", details: { path: "warehouses/secret" } }; };
    const r = await submitReceiveInventoryStock(RECEIVE_REQ());
    const json = JSON.stringify(r);
    expect(json.includes("RAW-BACKEND-DETAIL")).toBe(false);
    expect(json.includes("warehouses/secret")).toBe(false);
    expect(Object.keys(r)).toEqual(["status"]);
  });
});
