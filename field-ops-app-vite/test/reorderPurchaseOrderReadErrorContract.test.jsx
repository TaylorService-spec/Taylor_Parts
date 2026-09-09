// H14 (reorder pair) -- hooks/useReorderPurchaseOrders.js's
// usePurchaseOrderForReorderRequest() and hooks/useReorderPurchaseOrderVoids.js's
// useReorderPurchaseOrderVoid() used to write the SAME state ({ data: null, loading: false })
// whether the read was DENIED or the document genuinely did not exist -- a Parts Associate whose
// read was denied saw the identical "Purchase Order details unavailable" copy as a genuine
// not-yet-recorded PO.
//
// `error` is `"not_found"` ONLY when the read succeeds and the document does not exist, and a real
// failure code otherwise. A caller can tell "you cannot see it" apart from "there is nothing to
// see". That distinction matters most on the VOID hook, where absent is the ordinary case -- most
// purchase orders are never voided -- which is exactly why a failed read must not resemble it.
//
// MIGRATED TO THE GOVERNED SEAM. Both hooks read through readGovernedList now rather than a
// Firestore doc subscription, so this drives the seam instead of a captured onSnapshot callback.
// The contract under test is unchanged; only its producer moved. DENIED maps to
// "permission-denied" and every other failure to "unknown", which are the same two strings the
// Firestore error codes produced.
//
// vitest + @testing-library/react (jsdom). No Firebase.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

let outcome;
vi.mock("../src/access/governedCollectionClient", () => ({
  governedCollectionClient: {
    readGovernedList: () => Promise.resolve(outcome),
  },
}));

import { usePurchaseOrderForReorderRequest } from "../src/hooks/useReorderPurchaseOrders";
import { useReorderPurchaseOrderVoid } from "../src/hooks/useReorderPurchaseOrderVoids";

const DENIED = { ok: false, result: "DENIED", items: [] };
const UNAVAILABLE = { ok: false, result: "UNAVAILABLE", items: [] };
/** A SUCCESSFUL read that found nothing -- the only thing that may produce "not_found". */
const ABSENT = { ok: true, result: "OK", items: [] };

/** Render, and let the seam's promise settle so the hook holds its answer. */
async function renderSettled(fn) {
  let rendered;
  await act(async () => {
    rendered = renderHook(fn);
  });
  return rendered;
}

beforeEach(() => {
  outcome = ABSENT;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePurchaseOrderForReorderRequest -- denied vs absent (H14)", () => {
  it("a denied read sets a failure code, NOT 'not_found'", async () => {
    outcome = DENIED;
    const { result } = await renderSettled(() => usePurchaseOrderForReorderRequest("req-1"));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe("permission-denied");
    expect(result.current.error).not.toBe("not_found");
  });

  it("a genuinely absent document sets error 'not_found' -- distinct from a denied read", async () => {
    outcome = ABSENT;
    const { result } = await renderSettled(() => usePurchaseOrderForReorderRequest("req-1"));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe("not_found");
  });

  it("a successful read with data clears error", async () => {
    outcome = { ok: true, result: "OK", items: [{ id: "req-1", supplierName: "Acme" }] };
    const { result } = await renderSettled(() => usePurchaseOrderForReorderRequest("req-1"));
    expect(result.current.error).toBe(null);
    expect(result.current.data).toEqual({ id: "req-1", supplierName: "Acme" });
  });

  it("a non-denial failure falls back to 'unknown', still distinct from 'not_found'", async () => {
    outcome = UNAVAILABLE;
    const { result } = await renderSettled(() => usePurchaseOrderForReorderRequest("req-1"));
    expect(result.current.error).toBe("unknown");
    expect(result.current.error).not.toBe("not_found");
  });
});

describe("useReorderPurchaseOrderVoid -- denied vs absent (H14)", () => {
  it("a denied read sets a failure code, NOT 'not_found'", async () => {
    outcome = DENIED;
    const { result } = await renderSettled(() => useReorderPurchaseOrderVoid("req-1"));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe("permission-denied");
    expect(result.current.error).not.toBe("not_found");
  });

  it("a genuinely absent void record sets error 'not_found' -- distinct from a denied read", async () => {
    // The ordinary case for this hook, which is why the distinction is load-bearing here.
    outcome = ABSENT;
    const { result } = await renderSettled(() => useReorderPurchaseOrderVoid("req-1"));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe("not_found");
  });
});
