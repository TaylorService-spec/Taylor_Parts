// The technician directory's REALTIME PARITY, proved with fake timers.
//
//   old  Firestore push (onSnapshot on fieldops_technicians)
//   new  automatic governed refresh, bounded <= 5 seconds
//
// This is a deliberate behaviour change, and these tests are what stop it from quietly becoming a
// worse one. The observable requirement is that a dispatcher with an open board sees a technician
// become AVAILABLE without reloading; every assertion below is about whether that still holds.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

const reads = { count: 0 };
let nextResult = { ok: true, result: "OK", items: [{ id: "t1", name: "Ada", status: "available" }] };

vi.mock("../src/access/governedCollectionClient", () => ({
  READ_RESULT: { OK: "OK", DENIED: "DENIED", INVALID: "INVALID", UNAVAILABLE: "UNAVAILABLE" },
  governedCollectionClient: {
    readGovernedList: async () => {
      reads.count += 1;
      return nextResult;
    },
  },
}));

const { useTechnicianDirectory } = await import("../src/hooks/useTechnicianDirectory.js");
const { notifyTechnicianDirectoryChanged } = await import("../src/domain/technicianDirectoryChanged.js");

// `document.hidden` is a getter on the real document; override it per test.
function setHidden(hidden) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * Flush pending microtasks.
 *
 * NOT `waitFor`: that polls on REAL timers, which these tests have replaced with fake ones, so it
 * can never advance and every assertion times out after five seconds. The fetch here resolves on a
 * microtask, so draining the queue is both sufficient and exact.
 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Advance timers AND flush the microtasks the async fetch resolves on. */
async function tick(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  reads.count = 0;
  nextResult = { ok: true, result: "OK", items: [{ id: "t1", name: "Ada", status: "available" }] };
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the technician directory refreshes automatically, bounded", () => {
  it("fetches immediately on mount -- not after the first interval", async () => {
    const { result } = renderHook(() => useTechnicianDirectory());
    await flush();
    expect(reads.count).toBe(1);
    await flush();
    expect(result.current.data).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  it("polls while the document is visible", async () => {
    renderHook(() => useTechnicianDirectory());
    await flush();
    expect(reads.count).toBe(1);
    await tick(5000);
    expect(reads.count).toBe(2);
    await tick(5000);
    expect(reads.count).toBe(3);
  });

  it("SUSPENDS the interval while the document is hidden", async () => {
    renderHook(() => useTechnicianDirectory());
    await flush();
    expect(reads.count).toBe(1);

    await act(async () => setHidden(true));
    const atHide = reads.count;
    // A forgotten background tab must cost nothing.
    await tick(30000);
    expect(reads.count).toBe(atHide);
  });

  it("refetches IMMEDIATELY when visibility returns, not after another full interval", async () => {
    renderHook(() => useTechnicianDirectory());
    await flush();
    expect(reads.count).toBe(1);
    await act(async () => setHidden(true));
    const atHide = reads.count;

    await act(async () => {
      setHidden(false);
      await Promise.resolve();
    });
    // The whole point: a dispatcher returning to the board is not looking at stale rows while a
    // five-second timer runs down.
    expect(reads.count).toBe(atHide + 1);

    await tick(5000);
    expect(reads.count).toBe(atHide + 2);
  });

  it("refetches immediately on window focus", async () => {
    renderHook(() => useTechnicianDirectory());
    await flush();
    expect(reads.count).toBe(1);
    const before = reads.count;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(reads.count).toBe(before + 1);
  });

  it("refetches immediately on a same-session technician mutation", async () => {
    renderHook(() => useTechnicianDirectory());
    await flush();
    expect(reads.count).toBe(1);
    const before = reads.count;
    await act(async () => {
      notifyTechnicianDirectoryChanged();
      await Promise.resolve();
    });
    expect(reads.count).toBe(before + 1);
  });

  it("tears down completely on unmount -- no interval, no listeners", async () => {
    const { unmount } = renderHook(() => useTechnicianDirectory());
    await flush();
    expect(reads.count).toBe(1);
    unmount();
    const afterUnmount = reads.count;

    await tick(30000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      setHidden(false);
      notifyTechnicianDirectoryChanged();
      await Promise.resolve();
    });
    // A hook that kept polling after unmount would leak one poller per visit to the board.
    expect(reads.count).toBe(afterUnmount);
  });

  it("A FAILED REFRESH KEEPS THE LAST GOOD DIRECTORY -- it never reads as 'no technicians'", async () => {
    // The property this whole file is really for. Replacing a working roster with [] on a transient
    // failure would tell a dispatcher the business has no technicians, and Dispatch.jsx would offer
    // nobody to assign. The rows stay; `error` is what says the list may be stale.
    const { result } = renderHook(() => useTechnicianDirectory());
    await flush();
    expect(result.current.data).toHaveLength(1);

    nextResult = { ok: false, result: "UNAVAILABLE", items: [] };
    await tick(5000);
    await flush();
    expect(result.current.error).toBeTruthy();
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].id).toBe("t1");

    // And it recovers: the next good read clears the error.
    nextResult = { ok: true, result: "OK", items: [{ id: "t1" }, { id: "t2" }] };
    await tick(5000);
    await flush();
    expect(result.current.data).toHaveLength(2);
    expect(result.current.error).toBe(null);
  });

  it("disabled is IDLE, never empty-and-loaded -- and reads nothing", async () => {
    const { result } = renderHook(() => useTechnicianDirectory(false));
    await tick(20000);
    expect(reads.count).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([]);
  });
});
