// DQ-036(b): the client's acquire-existing-unit transport is picked by ONE governed switch that mirrors the server's.
// ACTIVATED (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01): { FROZEN, ACTIVE } on both sides -- the
// EOS API only, no Firebase fallback, the command's code carried in `details` exactly as the callable carried it, so
// the screen's interpretation is unchanged. A state other than ACTIVE refuses locally; the Firebase callable is gone.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";


const { callAcquireSerializedAsset, callAcquireSerializedAssetOnEos, EOS_SERIALIZED_ASSET_ROUTE } =
  await import("../src/services/serializedAssetAcquireCallableClient.js");
const { SERIALIZED_ASSET_ACQUIRE_WRITER_AUTHORITY } = await import("../src/services/serializedAssetAcquireWriterState.js");
const { interpretAcquireResult } = await import("../src/domain/serializedAssetAcquireForm.js");

const REQ = { partId: "P", serialNo: "S", locationId: "WH-A", reason: "OPENING_BALANCE", idempotencyKey: "k" };
const fetchReturning = (status, body) => vi.fn(async () => ({ ok: status < 300, status, json: async () => body }));

describe("serialized asset acquire transport switch", () => {
  it("the client mirror equals the server's governed constant, and both are { FROZEN, ACTIVE }", () => {
    expect({ ...SERIALIZED_ASSET_ACQUIRE_WRITER_AUTHORITY }).toEqual({ firestore: "FROZEN", postgres: "ACTIVE" });
    const server = readFileSync("../functions/src/serializedAsset/acquireWriterState.ts", "utf8");
    expect(server).toMatch(/ACQUIRE_WRITER_AUTHORITY: AcquireWriterAuthority = Object\.freeze\(\{ firestore: "FROZEN", postgres: "ACTIVE" \}\)/);
  });

  it("the client carries no Firebase acquire path at all", () => {
    const src = readFileSync("src/services/serializedAssetAcquireCallableClient.js", "utf8");
    expect(src).not.toMatch(/firebase\/functions|httpsCallable/);
  });

  it("not ACTIVE: refused locally as NOT_ACTIVATED, and nothing is sent anywhere", async () => {
    const fetchImpl = vi.fn();
    const r = await callAcquireSerializedAsset(REQ, { writerAuthority: { firestore: "OPEN", postgres: "INACTIVE" }, fetchImpl });
    expect(r.error.details).toBe("NOT_ACTIVATED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ACTIVE: the EOS route only, with the bearer; a success is the command's own result", async () => {
    const fetchImpl = fetchReturning(200, { ok: true, result: { outcome: "acquired", serializedAssetId: "sa_eos" } });
    const call = vi.fn();
    const r = await callAcquireSerializedAsset(REQ, { writerAuthority: { firestore: "FROZEN", postgres: "ACTIVE" }, call, fetchImpl, baseUrl: "https://eos.test/", getIdToken: async () => "tok" });
    expect(call).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://eos.test${EOS_SERIALIZED_ASSET_ROUTE}`);
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ operation: "acquireSerializedAsset", input: REQ });
    expect(interpretAcquireResult(r).status).toBe(interpretAcquireResult({ outcome: { outcome: "acquired", serializedAssetId: "x" } }).status);
  });

  it("ACTIVE: a refusal carries the command's code in details, so the screen reads it exactly as before; no fallback", async () => {
    const call = vi.fn();
    const r = await callAcquireSerializedAssetOnEos(REQ, { fetchImpl: fetchReturning(409, { ok: false, code: "ALREADY_EXISTS_CONFLICT", message: "m" }), baseUrl: "https://eos.test", getIdToken: async () => "t", call });
    expect(r.error.details).toBe("ALREADY_EXISTS_CONFLICT");
    expect(interpretAcquireResult(r).code).toBe("ALREADY_EXISTS_CONFLICT");
    expect(call).not.toHaveBeenCalled();
    const nc = await callAcquireSerializedAssetOnEos(REQ, { baseUrl: null });
    expect(nc.error.details).toBe("NOT_CONFIGURED");
    const unreachable = await callAcquireSerializedAssetOnEos(REQ, { baseUrl: "https://eos.test", getIdToken: async () => "t", fetchImpl: async () => { throw new Error("down"); } });
    expect(unreachable.error.details).toBe("UNREACHABLE");
  });
});
