// Product reference search after the Catalog activation: PART reads the governed PostgreSQL Catalog, and
// EQUIPMENT_MODEL is refused rather than served from the frozen Firestore snapshot. The Firebase
// `searchProductReferences` callable is never reached for either kind.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

const httpsCallable = vi.fn();
vi.mock("firebase/functions", () => ({ httpsCallable: (...a) => httpsCallable(...a) }));
vi.mock("../src/firebase/firebase.js", () => ({ functions: {}, auth: { currentUser: null }, db: {} }));

const {
  searchProductReferences, PRODUCT_SEARCH_AUTHORITY_UNAVAILABLE, PRODUCT_SEARCH_MAX_LIMIT,
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

describe("searchProductReferences -- EQUIPMENT_MODEL has no current authority to search", () => {
  it("is refused with NO read of any kind", async () => {
    const { calls, client } = clientAnswering({ ok: true, result: { parts: [] } });
    expect(await searchProductReferences({ kind: "EQUIPMENT_MODEL", query: "" }, { client }))
      .toEqual({ errorStatus: PRODUCT_SEARCH_AUTHORITY_UNAVAILABLE });
    expect(calls).toEqual([]);
    expect(httpsCallable).not.toHaveBeenCalled();
  });

  it("the Firebase callable is not named by the client transport any more", () => {
    const src = readFileSync("src/services/salesAgreementCommandClient.js", "utf8")
      .replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/httpsCallable|firebase\/functions|"searchProductReferences"/);
  });
});
