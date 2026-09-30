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
import { fetchReceivingLocationOptions } from "../src/services/receivingCallableClient.js";
import { submitReorderReceipt, receiveOutcomeForFailure } from "../src/services/reorderReceivingClient.js";

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
    // Phase D added two READS. They are pinned here for the same reason the original two are: a
    // rename must never silently point the transport at a different function. Both are gated on the
    // SAME inventory.stock.receive capability as the write, and behind the same readiness constant.
    expect(CALLABLE_NAMES).toEqual({
      receive: "receiveInventoryStock",
      listOptions: "listReceivingLocationOptions",
      progress: "getPurchaseOrderReceivingProgress",
      listReceivable: "listReceivablePurchaseOrders",
    });
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
  it("receivingCallableClient exports ONLY governed public methods — no bypass seam", async () => {
    // The property is unchanged: every export must be a readiness-gated public method, and there
    // must be no invoker, override, or core exposed alongside them. Phase D added three (two reads
    // and the canonical submit), each behind the SAME constant — the readiness-false assertions
    // below cover all five, so widening this list does not widen what it protects.
    const ns = await import("../src/services/receivingCallableClient.js");
    expect(Object.keys(ns).sort()).toEqual([
      "fetchPurchaseOrderProgress",
      "fetchReceivablePurchaseOrders",
      "fetchReceivingLocationOptions",
      "submitCanonicalReceive",
    ]);
    // THE REORDER ACTIVATION: the legacy REORDER_PURCHASE_ORDER submit is gone from the Firebase
    // transport entirely, not merely unused -- an unused wrapper is a second authority one import away.
    expect(ns.submitReceiveInventoryStock).toBeUndefined();
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

  // The Phase D methods are gated by the SAME constant, and firebase is never even loaded while it
  // is false. Asserted individually rather than by inspection, because "it reads the constant" and
  // "it never invokes" are different claims and only the second one matters.
  it("fetchReceivablePurchaseOrders() -> UNAVAILABLE, zero callable attempts", async () => {
    const { fetchReceivablePurchaseOrders } = await import("../src/services/receivingCallableClient.js");
    expect(await fetchReceivablePurchaseOrders()).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE, purchaseOrders: [] });
    expect(H.calls).toEqual([]);
  });

  it("fetchPurchaseOrderProgress(id) -> UNAVAILABLE, zero callable attempts", async () => {
    const { fetchPurchaseOrderProgress } = await import("../src/services/receivingCallableClient.js");
    expect(await fetchPurchaseOrderProgress("PO-1")).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE, progress: null });
    expect(H.calls).toEqual([]);
  });

  it("submitCanonicalReceive(request) -> UNAVAILABLE, and does not even validate first", async () => {
    // The readiness gate is checked BEFORE the request is built, so a malformed request while
    // readiness is false still reports UNAVAILABLE rather than INVALID -- the environment's state is
    // the more important fact, and reporting "invalid" would send someone to fix a payload that was
    // never going to be sent.
    const { submitCanonicalReceive } = await import("../src/services/receivingCallableClient.js");
    expect(await submitCanonicalReceive({ nonsense: true })).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE, receipt: null });
    expect(H.calls).toEqual([]);
  });
  it("extra arguments cannot enable invocation while readiness is false", async () => {
    await fetchReceivingLocationOptions({ readyOverride: true, invoke: () => ({ options: [] }) });
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

  it("the canonical submit refuses a REORDER_PURCHASE_ORDER source client-side, with zero callable attempts", async () => {
    // The ONE client path that still names receiveInventoryStock cannot carry a Reorder source to it.
    const { submitCanonicalReceive } = await import("../src/services/receivingCallableClient.js");
    expect(await submitCanonicalReceive(RECEIVE_REQ())).toEqual({ status: RECEIVING_OUTCOME.INVALID, receipt: null });
    expect(H.calls).toEqual([]);
  });
});

// A REORDER PURCHASE ORDER is received through the governed PostgreSQL Receiving authority
// (services/reorderReceivingClient.js -> receiveReorderStock), never the Firebase callable -- even with the
// Firebase receiving readiness TRUE.
describe("submitReorderReceipt -- the governed PostgreSQL receipt", () => {
  beforeEach(() => { H.ready = true; });
  const clientAnswering = (answer) => {
    const calls = [];
    return { calls, client: { call: async (operation, input) => { calls.push([operation, input]); return typeof answer === "function" ? answer() : answer; } } };
  };
  const APPLIED = { ok: true, operation: "receiveReorderStock", result: {
    outcome: "applied", receivingId: "RCV-9", receivingOrderNumber: "RO-0009", sourceKind: "REORDER_PURCHASE_ORDER",
    purchaseOrderId: "PO-1", reorderRequestId: "RR-1", movementIds: ["m1"], lines: [], reorderStatus: "RECEIVED" } };

  it("malformed request -> INVALID, zero calls of any kind", async () => {
    const { calls, client } = clientAnswering(APPLIED);
    expect(await submitReorderReceipt({ ...RECEIVE_REQ(), extra: 1 }, { client })).toEqual({ status: RECEIVING_OUTCOME.INVALID });
    expect(calls).toEqual([]);
    expect(H.calls).toEqual([]);
  });
  it("a canonical PURCHASE_ORDER source is refused client-side -- it has its own authority", async () => {
    const { calls, client } = clientAnswering(APPLIED);
    const canonical = { ...RECEIVE_REQ(), source: { type: "PURCHASE_ORDER", reorderRequestId: "RR-1", purchaseOrderId: "PO-1" } };
    expect(await submitReorderReceipt(canonical, { client })).toEqual({ status: RECEIVING_OUTCOME.INVALID });
    expect(calls).toEqual([]);
  });
  it("applied -> receiveReorderStock with the exact frozen payload; the Firebase callable is never invoked", async () => {
    const { calls, client } = clientAnswering(APPLIED);
    const r = await submitReorderReceipt(RECEIVE_REQ(), { client });
    expect(calls).toEqual([["receiveReorderStock", RECEIVE_REQ()]]);
    expect(H.calls).toEqual([]);
    expect(r).toEqual({ status: RECEIVING_OUTCOME.APPLIED, receipt: { outcome: "applied", receivingId: "RCV-9", receivingOrderNumber: "RO-0009" } });
  });
  it("replayed -> REPLAYED", async () => {
    const { client } = clientAnswering({ ok: true, result: { ...APPLIED.result, outcome: "replayed" } });
    expect((await submitReorderReceipt(RECEIVE_REQ(), { client })).status).toBe(RECEIVING_OUTCOME.REPLAYED);
  });
  it("preserves the SAME idempotencyKey across retries", async () => {
    const { calls, client } = clientAnswering(APPLIED);
    const req = RECEIVE_REQ();
    await submitReorderReceipt(req, { client });
    await submitReorderReceipt(req, { client });
    expect(calls.map((c) => c[1].idempotencyKey)).toEqual(["recv-key-123", "recv-key-123"]);
  });
  it("a malformed success is not trusted as a receipt -> UNAVAILABLE", async () => {
    const { client } = clientAnswering({ ok: true, result: { outcome: "done" } });
    expect(await submitReorderReceipt(RECEIVE_REQ(), { client })).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE });
  });
  it.each([
    ["NOT_SIGNED_IN", RECEIVING_OUTCOME.UNAUTHENTICATED],
    ["UNAUTHENTICATED", RECEIVING_OUTCOME.UNAUTHENTICATED],
    ["FORBIDDEN", RECEIVING_OUTCOME.DENIED],
    ["INVALID_INPUT", RECEIVING_OUTCOME.INVALID],
    ["NOT_FOUND", RECEIVING_OUTCOME.NOT_FOUND],
    ["CONFLICT", RECEIVING_OUTCOME.CONFLICT],
    ["PRECONDITION_FAILED", RECEIVING_OUTCOME.CONFLICT],
    ["NOT_CONFIGURED", RECEIVING_OUTCOME.UNAVAILABLE],
    ["UNREACHABLE", RECEIVING_OUTCOME.UNAVAILABLE],
    ["INTERNAL", RECEIVING_OUTCOME.UNAVAILABLE],
  ])("maps the governed refusal %s", async (code, status) => {
    const { client } = clientAnswering({ ok: false, code, reason: "RAW-SERVER-CODE", status: 409, message: "RAW-BACKEND-DETAIL warehouses/secret" });
    const r = await submitReorderReceipt(RECEIVE_REQ(), { client });
    expect(r).toEqual({ status });
    expect(JSON.stringify(r)).not.toMatch(/RAW-BACKEND-DETAIL|warehouses\/secret|RAW-SERVER-CODE/);
    expect(receiveOutcomeForFailure({ code })).toBe(status);
  });
  it("a transport that throws is UNAVAILABLE, never an unhandled rejection", async () => {
    const { client } = clientAnswering(() => { throw new Error("boom"); });
    expect(await submitReorderReceipt(RECEIVE_REQ(), { client })).toEqual({ status: RECEIVING_OUTCOME.UNAVAILABLE });
  });
});
