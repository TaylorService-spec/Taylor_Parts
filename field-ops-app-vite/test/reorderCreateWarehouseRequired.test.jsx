// WORKSTREAM 2B -- createReorderRequest refuses to author a request with no governed warehouse.
//
// The trusted callable is the authority and needs no help: it re-reads the warehouse inside its
// own transaction and refuses WAREHOUSE_REQUIRED. This is the client-side half of the same
// "validated here as well, since this is the sole write path" discipline every other field on this
// function already follows -- an unanswered selector should read as a sentence, not as a round
// trip that comes back with a code.
//
// The load-bearing case is the last one. A required-field check is trivially satisfiable by
// supplying a default, and a default here would author a governed operating company nobody chose
// -- the exact thing the check exists to prevent. So the absence of any fallback is asserted too.
import { describe, it, expect, vi, beforeEach } from "vitest";

const submitCreateReorderRequest = vi.fn(() => Promise.resolve({ id: "r1" }));
vi.mock("../src/services/reorderCallableClient.js", () => ({
  submitCreateReorderRequest: (...args) => submitCreateReorderRequest(...args),
  submitRecordReorderPurchaseOrder: vi.fn(),
}));
// The retired direct-write path must not be reachable from this test either: if createReorderRequest
// ever falls back to it, this store throws rather than quietly succeeding.
vi.mock("../src/firebase/collectionStore", () => ({
  makeCollectionStore: () => ({
    add: () => { throw new Error("the direct reorder_requests write path is retired"); },
    update: vi.fn(),
    doc: vi.fn(),
  }),
}));
vi.mock("../src/config/env", () => ({ isWriteBlocked: () => false }));

import { createReorderRequest, requestReorderForRecommendation } from "../src/domain/inventoryReorderRequests.js";

const READY = {
  partId: "TST-1",
  recommendationStatus: "READY",
  urgency: "HIGH",
  quantitySource: "ANALYTICS",
  recommendedQty: 10,
  requestedQty: 10,
};

const refusal = (input) => {
  try {
    createReorderRequest(input);
    return null;
  } catch (err) {
    return err.message;
  }
};

describe("createReorderRequest -- the governed warehouse is required", () => {
  beforeEach(() => submitCreateReorderRequest.mockClear());

  it("refuses a request that names no warehouse", () => {
    expect(refusal({ ...READY })).toMatch(/warehouse is required/i);
    expect(submitCreateReorderRequest).not.toHaveBeenCalled();
  });

  it("treats null, empty and whitespace-only as no warehouse", () => {
    // Whitespace matters: trimmed-to-nothing passes a truthiness check and would then travel as a
    // governed id that resolves to no warehouse at all.
    for (const warehouseId of [null, undefined, "", "   ", "\t"]) {
      expect(refusal({ ...READY, warehouseId })).toMatch(/warehouse is required/i);
    }
    expect(submitCreateReorderRequest).not.toHaveBeenCalled();
  });

  it("refuses a non-string rather than coercing one into an id", () => {
    for (const warehouseId of [1, {}, ["wh-main"], true]) {
      expect(refusal({ ...READY, warehouseId })).toMatch(/warehouse is required/i);
    }
  });

  it("sends a stated warehouse VERBATIM, and never sends a company", async () => {
    await createReorderRequest({ ...READY, warehouseId: "wh-north" });
    const payload = submitCreateReorderRequest.mock.calls[0][0];
    expect(payload.warehouseId).toBe("wh-north");
    // The server derives the operating company and REFUSES a caller that supplies one, so the
    // browser must not have an opinion to send.
    expect("operatingCompanyId" in payload).toBe(false);
  });

  it("threads the warehouse through the recommendation wrapper on BOTH paths", async () => {
    // requestReorderForRecommendation is what the three surfaces actually call. A warehouse lost
    // in the wrapper would be indistinguishable, at the UI, from one that was never chosen.
    await requestReorderForRecommendation({
      partId: "TST-1",
      warehouseId: "wh-main",
      recommendation: { recommendationStatus: "READY", urgency: "HIGH", recommendedOrderQty: 4 },
    });
    expect(submitCreateReorderRequest.mock.calls[0][0].warehouseId).toBe("wh-main");

    await requestReorderForRecommendation({
      partId: "TST-1",
      warehouseId: "wh-north",
      recommendation: { recommendationStatus: "NEEDS_PLANNING", urgency: null },
      manualQty: 3,
    });
    expect(submitCreateReorderRequest.mock.calls[1][0].warehouseId).toBe("wh-north");
  });

  // The "no fallback" half of this contract is asserted where source-reading belongs: see
  // reorderTrustedWritePathContract.test.mjs, which pins the absence of a parameter default, of a
  // ||/?? fallback expression, and of any hard-coded warehouse id in this module.
});
