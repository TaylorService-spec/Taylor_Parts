// Product reference search after the Catalog activation: PART and EQUIPMENT_MODEL both read the governed
// PostgreSQL Catalog (searchParts / listEquipmentModels, DQ-030), never the frozen Firestore snapshot. The Firebase
// `searchProductReferences` callable is never reached for either kind.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

const httpsCallable = vi.fn();
vi.mock("firebase/functions", () => ({ httpsCallable: (...a) => httpsCallable(...a) }));
vi.mock("../src/firebase/firebase.js", () => ({ functions: {}, auth: { currentUser: null }, db: {} }));

const {
  searchProductReferences, PRODUCT_SEARCH_MAX_LIMIT,
} = await import("../src/services/salesAgreementCommandClient.js");

const clientAnswering = (answer) => {
  const calls = [];
  return { calls, client: { call: async (operation, input) => { calls.push({ operation, input }); return answer; } } };
};

describe("searchProductReferences -- PART reads the PostgreSQL Catalog", () => {
  it("asks searchParts and projects the picker's { ref, kind, displayName, status } shape", async () => {
    const { calls, client } = clientAnswering({ ok: true, result: {
      parts: [{ id: "CW-P-0001", name: "Fan motor", status: "ACTIVE" }, { id: "CW-P-0002", name: "", status: "INACTIVE" }],
      nextCursor: null,
    } });
    const res = await searchProductReferences({ kind: "PART", query: " fan " }, { client });
    expect(calls).toEqual([{ operation: "searchParts", input: { query: "fan", limit: 20 } }]);
    expect(res).toEqual({ result: { status: "ready", kind: "PART", truncated: false, results: [
      { ref: "CW-P-0001", kind: "PART", displayName: "Fan motor", status: "ACTIVE" },
      { ref: "CW-P-0002", kind: "PART", displayName: null, status: "INACTIVE" },
    ] } });
  });

  it("reports more matches honestly and bounds the page", async () => {
    const { calls, client } = clientAnswering({ ok: true, result: { parts: [], nextCursor: "c1" } });
    const res = await searchProductReferences({ kind: "PART", query: "ab", limit: 500 }, { client });
    expect(calls[0].input.limit).toBe(PRODUCT_SEARCH_MAX_LIMIT);
    expect(res.result.truncated).toBe(true);
  });

  it("keeps DENIED apart from UNAVAILABLE", async () => {
    expect(await searchProductReferences({ kind: "PART", query: "ab" }, clientAnswering({ ok: false, code: "FORBIDDEN" })))
      .toEqual({ errorStatus: "permission-denied" });
    expect(await searchProductReferences({ kind: "PART", query: "ab" }, clientAnswering({ ok: false, code: "UNREACHABLE" })))
      .toEqual({ errorStatus: "unavailable" });
    expect(await searchProductReferences({ kind: "PART", query: "ab" }, clientAnswering({ ok: true, result: {} })))
      .toEqual({ errorStatus: "unavailable" });
  });
});

describe("searchProductReferences -- EQUIPMENT_MODEL reads the PostgreSQL Catalog (DQ-030)", () => {
  it("asks listEquipmentModels and projects the picker's shape, with modelNumber as the display fallback", async () => {
    const { calls, client } = clientAnswering({ ok: true, result: {
      models: [
        { id: "taylor--c713", displayName: "Taylor C713", modelNumber: "C713", status: "ACTIVE" },
        { id: "taylor--c161", displayName: "", modelNumber: "C161", status: "INACTIVE" },
        { id: "", displayName: "no identity" },
      ],
      nextCursor: null,
    } });
    const res = await searchProductReferences({ kind: "EQUIPMENT_MODEL", query: "" }, { client });
    expect(calls).toEqual([{ operation: "listEquipmentModels", input: {} }]);
    expect(res).toEqual({ result: { status: "ready", kind: "EQUIPMENT_MODEL", truncated: false, results: [
      { ref: "taylor--c713", kind: "EQUIPMENT_MODEL", displayName: "Taylor C713", status: "ACTIVE" },
      { ref: "taylor--c161", kind: "EQUIPMENT_MODEL", displayName: "C161", status: "INACTIVE" },
    ] } });
    expect(httpsCallable).not.toHaveBeenCalled();
  });

  it("says the list is capped when the server says more exist", async () => {
    const { client } = clientAnswering({ ok: true, result: { models: [], nextCursor: "taylor--z" } });
    expect((await searchProductReferences({ kind: "EQUIPMENT_MODEL" }, { client })).result.truncated).toBe(true);
  });

  it("keeps a server refusal (no inventory.catalog.read) DENIED, and a failure UNAVAILABLE -- never an empty list", async () => {
    expect(await searchProductReferences({ kind: "EQUIPMENT_MODEL" }, clientAnswering({ ok: false, code: "FORBIDDEN" })))
      .toEqual({ errorStatus: "permission-denied" });
    expect(await searchProductReferences({ kind: "EQUIPMENT_MODEL" }, clientAnswering({ ok: false, code: "NOT_SIGNED_IN" })))
      .toEqual({ errorStatus: "permission-denied" });
    expect(await searchProductReferences({ kind: "EQUIPMENT_MODEL" }, clientAnswering({ ok: false, code: "PRECONDITION_FAILED" })))
      .toEqual({ errorStatus: "unavailable" });
    expect(await searchProductReferences({ kind: "EQUIPMENT_MODEL" }, clientAnswering({ ok: true, result: {} })))
      .toEqual({ errorStatus: "unavailable" });
  });

  it("the Firebase callable is not named by the client transport any more", () => {
    const src = readFileSync("src/services/salesAgreementCommandClient.js", "utf8")
      .replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/httpsCallable|firebase\/functions|"searchProductReferences"/);
  });
});
