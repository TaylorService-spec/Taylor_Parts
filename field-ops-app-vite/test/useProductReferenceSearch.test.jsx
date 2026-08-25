// THE PICKER'S READ BEHAVIOUR — debounce, race ordering, and states that stay distinct.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useProductReferenceSearch,
  stateForError,
  PRODUCT_SEARCH_STATE as S,
  MIN_SEARCH_LENGTH,
  SEARCH_DEBOUNCE_MS,
} from "../src/hooks/useProductReferenceSearch.js";
import { searchProductReferences } from "../src/services/salesAgreementCommandClient.js";

vi.mock("../src/services/salesAgreementCommandClient.js", () => ({
  searchProductReferences: vi.fn(),
}));

// NO waitFor IN THIS FILE. waitFor polls on REAL timers, and this suite runs on fake ones so the
// debounce is assertable at all. The two deadlock, and the failure surfaces as a 5s test timeout
// that reads like a hung product rather than like the harness contradiction it actually is --
// a measurement defect wearing the costume of a defect.
//
// flush advances the debounce and then drains the promise microtasks explicitly, which is the thing
// waitFor was being asked to guess at.
const flush = async (ms = SEARCH_DEBOUNCE_MS + 10) => {
  await act(async () => { vi.advanceTimersByTime(ms); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

const okResult = (results, extra = {}) => ({ result: { status: "ready", results, truncated: false, ...extra } });

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe("error mapping", () => {
  it("DENIED and UNAVAILABLE never collapse into one another", () => {
    // Reporting a denial as unavailable sends somebody to check the network; reporting
    // unavailability as a denial sends them to ask for a permission they already hold.
    expect(stateForError("permission-denied")).toBe(S.DENIED);
    expect(stateForError("internal")).toBe(S.UNAVAILABLE);
    expect(stateForError("unavailable")).toBe(S.UNAVAILABLE);
    expect(stateForError(undefined)).toBe(S.UNAVAILABLE);
  });
});

describe("part typeahead", () => {
  it("ASKS NOTHING below the minimum query length", async () => {
    const { rerender } = renderHook(({ q }) => useProductReferenceSearch("PART", q), {
      initialProps: { q: "C" },
    });
    await flush(SEARCH_DEBOUNCE_MS * 4);
    expect(searchProductReferences).not.toHaveBeenCalled();
    rerender({ q: "" });
    await flush(SEARCH_DEBOUNCE_MS * 4);
    expect(searchProductReferences).not.toHaveBeenCalled();
    expect(MIN_SEARCH_LENGTH).toBeGreaterThanOrEqual(2);
  });

  it("DEBOUNCES: typing four characters issues ONE read, not four", async () => {
    searchProductReferences.mockResolvedValue(okResult([]));
    const { rerender } = renderHook(({ q }) => useProductReferenceSearch("PART", q), {
      initialProps: { q: "CW" },
    });
    rerender({ q: "CW-" });
    rerender({ q: "CW-P" });
    rerender({ q: "CW-P-" });
    await flush();
    expect(searchProductReferences).toHaveBeenCalledTimes(1);
    expect(searchProductReferences).toHaveBeenCalledWith({ kind: "PART", query: "CW-P-" });
  });

  it("reports READY with results", async () => {
    searchProductReferences.mockResolvedValue(okResult([{ ref: "CW-P-0000", displayName: "Fan" }]));
    const { result } = renderHook(() => useProductReferenceSearch("PART", "CW-P"));
    await flush();
    expect(result.current.state).toBe(S.READY);
    expect(result.current.results.map((r) => r.ref)).toEqual(["CW-P-0000"]);
  });

  it("a DENIED read is DENIED, never READY-with-zero-results", async () => {
    // The specific defect this guards: an empty list under a denial tells a salesperson the catalog
    // is empty, and they go hunting for missing data instead of a missing permission.
    searchProductReferences.mockResolvedValue({ errorStatus: "permission-denied" });
    const { result } = renderHook(() => useProductReferenceSearch("PART", "CW-P"));
    await flush();
    expect(result.current.state).toBe(S.DENIED);
    expect(result.current.results).toEqual([]);
  });

  it("the server's own below-threshold answer is IDLE, not an error", async () => {
    searchProductReferences.mockResolvedValue({ result: { status: "below-threshold", results: [] } });
    const { result } = renderHook(() => useProductReferenceSearch("PART", "CW-P"));
    await flush();
    expect(result.current.state).toBe(S.IDLE);
  });

  it("THE NEWEST QUERY WINS, not the last response to arrive", async () => {
    // "CW" and "CW-P" can return out of order. A stale response landing last would show results for
    // a prefix the user has already typed past.
    let resolveFirst;
    searchProductReferences
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce(okResult([{ ref: "NEW-1", displayName: "New" }]));

    const { result, rerender } = renderHook(({ q }) => useProductReferenceSearch("PART", q), {
      initialProps: { q: "CW" },
    });
    await flush();
    rerender({ q: "CW-P" });
    await flush();
    expect(result.current.results.map((r) => r.ref)).toEqual(["NEW-1"]);

    // The stale FIRST response lands LAST and must be discarded.
    await act(async () => { resolveFirst(okResult([{ ref: "STALE-1", displayName: "Stale" }])); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.results.map((r) => r.ref)).toEqual(["NEW-1"]);
  });

  it("surfaces truncation so the surface can say 'refine' rather than imply completeness", async () => {
    searchProductReferences.mockResolvedValue({ result: { status: "ready", results: [], truncated: true } });
    const { result } = renderHook(() => useProductReferenceSearch("PART", "CW"));
    await flush();
    expect(result.current.truncated).toBe(true);
  });
});

describe("equipment model list", () => {
  it("reads ONCE without debounce and without any query text", async () => {
    searchProductReferences.mockResolvedValue(okResult([{ ref: "taylor--c713", displayName: "Taylor C713" }]));
    const { result } = renderHook(() => useProductReferenceSearch("EQUIPMENT_MODEL", null));
    await flush(0);
    expect(result.current.state).toBe(S.READY);
    expect(searchProductReferences).toHaveBeenCalledTimes(1);
    expect(searchProductReferences).toHaveBeenCalledWith({ kind: "EQUIPMENT_MODEL", query: "" });
  });
});

describe("disabled", () => {
  it("an unenabled picker issues no read at all", async () => {
    renderHook(() => useProductReferenceSearch("EQUIPMENT_MODEL", null, { enabled: false }));
    await flush(SEARCH_DEBOUNCE_MS * 4);
    expect(searchProductReferences).not.toHaveBeenCalled();
  });
});
