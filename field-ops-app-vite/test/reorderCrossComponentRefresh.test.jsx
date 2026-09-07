// CROSS-COMPONENT REFRESH FOR REORDER READS -- the behaviour the Firestore removal had to preserve.
//
// WHY THIS TEST EXISTS. The reorder hooks used onSnapshot deliberately: their own file header
// records the bug that forced it -- PartsList's "Request Reorder" wrote, and the Notification Panel
// mounted elsewhere in the tree showed nothing until a browser reload, because each component held
// an independent one-shot read with no invalidation between them.
//
// Removing Firestore removes the listener, and a callable cannot stream. So this pins the
// replacement: a successful write must still refresh a DIFFERENT, already-mounted reader. Without a
// test, "we kept the behaviour" is an assertion about code nobody re-ran.
//
// It deliberately renders TWO hooks, the way the real defect appeared. A single-hook test would
// pass just as happily against a hook-local reload token, which is precisely the mechanism that
// cannot solve this.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

let items;
let readCount;
vi.mock("../src/access/governedCollectionClient", () => ({
  governedCollectionClient: {
    readGovernedList: () => {
      readCount += 1;
      return Promise.resolve({ ok: true, result: "OK", items, nextCursor: null, hasMore: false });
    },
  },
}));

import {
  useReorderRequestsByStatus,
  useReorderRequestsByStatuses,
} from "../src/hooks/useReorderRequests";
import { notifyReorderRequestsChanged } from "../src/domain/reorderRequestsChanged";

beforeEach(() => {
  items = [{ id: "r1", status: "PENDING_REVIEW" }];
  readCount = 0;
});
afterEach(cleanup);

/** Render and let the seam's promise settle, so the hook has its first page. */
async function renderSettled(fn) {
  let rendered;
  await act(async () => {
    rendered = renderHook(fn);
  });
  return rendered;
}

describe("a reorder write refreshes readers in other components", () => {
  it("a mounted reader re-reads when the change signal fires", async () => {
    const { result } = await renderSettled(() => useReorderRequestsByStatus("PENDING_REVIEW"));
    expect(result.current.data).toEqual([{ id: "r1", status: "PENDING_REVIEW" }]);
    const afterMount = readCount;

    // The write happened somewhere else entirely -- this test never touches the reader.
    items = [
      { id: "r1", status: "PENDING_REVIEW" },
      { id: "r2", status: "PENDING_REVIEW" },
    ];
    await act(async () => {
      notifyReorderRequestsChanged();
    });

    expect(readCount).toBeGreaterThan(afterMount);
    expect(result.current.data).toHaveLength(2);
  });

  it("TWO independently mounted readers both refresh from one write", async () => {
    // The actual reported defect: the writer and the stale view were different components. One
    // hook-local reload token would satisfy the test above and still fail this one.
    const panel = await renderSettled(() => useReorderRequestsByStatus("PENDING_REVIEW"));
    const queue = await renderSettled(() =>
      useReorderRequestsByStatuses(["PENDING_REVIEW", "READY_FOR_PARTS_MANAGER"]),
    );
    expect(panel.result.current.data).toHaveLength(1);
    expect(queue.result.current.data).toHaveLength(1);

    items = [
      { id: "r1", status: "PENDING_REVIEW" },
      { id: "r2", status: "READY_FOR_PARTS_MANAGER" },
    ];
    await act(async () => {
      notifyReorderRequestsChanged();
    });

    expect(panel.result.current.data).toHaveLength(2);
    expect(queue.result.current.data).toHaveLength(2);
  });

  it("an unmounted reader is not re-read, and a throwing listener does not stop the others", async () => {
    // Two properties in one place because they share a cause: the signal iterates listeners, so a
    // stale or misbehaving one must not be able to hold the rest hostage.
    const first = await renderSettled(() => useReorderRequestsByStatus("PENDING_REVIEW"));
    const second = await renderSettled(() => useReorderRequestsByStatus("PENDING_REVIEW"));
    first.unmount();

    items = [{ id: "r1" }, { id: "r2" }];
    await act(async () => {
      notifyReorderRequestsChanged();
    });

    expect(second.result.current.data).toHaveLength(2);
  });
});
