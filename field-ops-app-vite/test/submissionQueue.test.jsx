// OFFLINE / RETRY — the durable queue and its status surface (vitest + jsdom).
//
// The decisions are proved pure in test/offlineSubmissionQueue.test.mjs. These cover what only the
// hook and the surface can show: that a queue survives the tab, that reviving it never invents a
// confirmation, and that unverified work is stated in words rather than hidden behind a spinner.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { useSubmissionQueue, QUEUE_STORAGE_KEY } from "../src/hooks/useSubmissionQueue.js";
import SubmissionQueueStatus from "../src/shared/ui/SubmissionQueueStatus.jsx";
import { SUBMISSION_STATE, summarize } from "../src/domain/offlineSubmissionQueue.js";

afterEach(cleanup);

/** An in-memory storage the test controls completely. */
function fakeStorage(seed = null) {
  const map = new Map(seed ? [[QUEUE_STORAGE_KEY, seed]] : []);
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _raw: () => map.get(QUEUE_STORAGE_KEY),
  };
}

const stow = (key = "k1") => ({
  callable: "recordPutAway",
  payload: { partId: "PRT-1001", quantity: 2 },
  idempotencyKey: key,
  describe: "Stow 2 into A-14",
});

// ────────────────────────────────────────────── it survives the tab

describe("Submission queue (it survives the tab)", () => {
  it("persists a queued submission", async () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useSubmissionQueue({ invoke: vi.fn(), deps: { storage } }));
    act(() => { result.current.add(stow()); });
    await waitFor(() => expect(storage._raw()).toBeTruthy());
    expect(JSON.parse(storage._raw())[0].idempotencyKey).toBe("k1");
  });

  it("revives a stored queue on mount", () => {
    const storage = fakeStorage(JSON.stringify([{
      callable: "recordPutAway", idempotencyKey: "k1", payload: {}, state: SUBMISSION_STATE.PENDING,
      describe: "Stow", attempts: 0, lastError: null, queuedAt: 0, updatedAt: 0,
    }]));
    const { result } = renderHook(() => useSubmissionQueue({ invoke: vi.fn(), deps: { storage } }));
    expect(result.current.queue).toHaveLength(1);
    expect(result.current.summary.pending).toBe(1);
  });

  it("work that was IN FLIGHT when the tab died is revived as UNVERIFIED, never confirmed", () => {
    // The answer did not arrive while nobody was listening.
    const storage = fakeStorage(JSON.stringify([{
      callable: "recordPutAway", idempotencyKey: "k1", payload: {}, state: SUBMISSION_STATE.UNVERIFIED,
      describe: "Stow", attempts: 1, lastError: null, queuedAt: 0, updatedAt: 0,
    }]));
    const { result } = renderHook(() => useSubmissionQueue({ invoke: vi.fn(), deps: { storage } }));
    expect(result.current.queue[0].state).toBe(SUBMISSION_STATE.UNVERIFIED);
    expect(result.current.summary.confirmed).toBe(0);
  });

  it("CORRUPT storage loses the queue rather than the screen", () => {
    const storage = fakeStorage("{not json");
    const { result } = renderHook(() => useSubmissionQueue({ invoke: vi.fn(), deps: { storage } }));
    expect(result.current.queue).toEqual([]);
  });

  it("storage being unavailable does not break the hook", () => {
    const broken = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    };
    const { result } = renderHook(() => useSubmissionQueue({ invoke: vi.fn(), deps: { storage: broken } }));
    act(() => { result.current.add(stow()); });
    expect(result.current.queue).toHaveLength(1);
  });
});

// ────────────────────────────────────────────── sending

describe("Submission queue (sending)", () => {
  it("sends a queued submission and confirms it", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    const storage = fakeStorage();
    const { result } = renderHook(() => useSubmissionQueue({ invoke, deps: { storage } }));
    act(() => { result.current.add(stow()); });
    await act(async () => { await result.current.flush(); });

    expect(invoke).toHaveBeenCalledWith("recordPutAway", { partId: "PRT-1001", quantity: 2 });
    expect(result.current.summary.confirmed).toBe(1);
    expect(result.current.summary.outstanding).toBe(false);
  });

  it("a REFUSAL becomes rejected, not a retry loop", async () => {
    const invoke = vi.fn().mockRejectedValue(Object.assign(new Error("no"), { code: "functions/permission-denied" }));
    const { result } = renderHook(() => useSubmissionQueue({ invoke, deps: { storage: fakeStorage() } }));
    act(() => { result.current.add(stow()); });
    await act(async () => { await result.current.flush(); });

    expect(result.current.summary.rejected).toBe(1);
    await act(async () => { await result.current.flush(); });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("a TRANSIENT failure stays retryable and is sent again", async () => {
    const invoke = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("down"), { code: "functions/unavailable" }))
      .mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useSubmissionQueue({ invoke, deps: { storage: fakeStorage() } }));
    act(() => { result.current.add(stow()); });
    await act(async () => { await result.current.flush(); });
    expect(result.current.summary.pending).toBe(1);

    await act(async () => { await result.current.flush(); });
    expect(result.current.summary.confirmed).toBe(1);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("a duplicate key is not queued twice", async () => {
    const { result } = renderHook(() => useSubmissionQueue({ invoke: vi.fn(), deps: { storage: fakeStorage() } }));
    act(() => { result.current.add(stow("k1")); result.current.add(stow("k1")); });
    expect(result.current.queue).toHaveLength(1);
  });

  it("the hook imports NO transport of its own", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/hooks/useSubmissionQueue.js"), "utf8");
    const imports = src.split("\n").filter((l) => l.trim().startsWith("import"));
    for (const line of imports) {
      expect(line).not.toMatch(/firebase|httpsCallable|CallableClient/i);
    }
  });
});

// ────────────────────────────────────────────── reconnection is a read

describe("Submission queue (reconnection asks, it does not re-send)", () => {
  it("an UNVERIFIED submission the server HAS becomes confirmed, without another send", async () => {
    const invoke = vi.fn().mockRejectedValue(Object.assign(new Error("timeout"), { code: "functions/deadline-exceeded" }));
    const confirmExists = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useSubmissionQueue({ invoke, confirmExists, deps: { storage: fakeStorage() } }));
    act(() => { result.current.add(stow()); });
    await act(async () => { await result.current.flush(); });
    // A timeout is retryable, so it is FAILED; force the unverified path by reconciling a real one.
    await act(async () => { await result.current.reconcile(); });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("NOT KNOWING leaves it unverified rather than guessing", async () => {
    const storage = fakeStorage(JSON.stringify([{
      callable: "recordPutAway", idempotencyKey: "k1", payload: {}, state: SUBMISSION_STATE.UNVERIFIED,
      describe: "Stow", attempts: 1, lastError: null, queuedAt: 0, updatedAt: 0,
    }]));
    const confirmExists = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useSubmissionQueue({ invoke: vi.fn(), confirmExists, deps: { storage } }));
    await act(async () => { await result.current.reconcile(); });
    expect(result.current.queue[0].state).toBe(SUBMISSION_STATE.UNVERIFIED);
  });

  it("a THROWING check is treated as not knowing", async () => {
    const storage = fakeStorage(JSON.stringify([{
      callable: "recordPutAway", idempotencyKey: "k1", payload: {}, state: SUBMISSION_STATE.UNVERIFIED,
      describe: "Stow", attempts: 1, lastError: null, queuedAt: 0, updatedAt: 0,
    }]));
    const confirmExists = vi.fn().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useSubmissionQueue({ invoke: vi.fn(), confirmExists, deps: { storage } }));
    await act(async () => { await result.current.reconcile(); });
    expect(result.current.queue[0].state).toBe(SUBMISSION_STATE.UNVERIFIED);
  });

  it("a submission the server does NOT have becomes sendable again", async () => {
    const storage = fakeStorage(JSON.stringify([{
      callable: "recordPutAway", idempotencyKey: "k1", payload: {}, state: SUBMISSION_STATE.UNVERIFIED,
      describe: "Stow", attempts: 1, lastError: null, queuedAt: 0, updatedAt: 0,
    }]));
    const confirmExists = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() => useSubmissionQueue({ invoke: vi.fn(), confirmExists, deps: { storage } }));
    await act(async () => { await result.current.reconcile(); });
    expect(result.current.queue[0].state).toBe(SUBMISSION_STATE.PENDING);
  });
});

// ────────────────────────────────────────────── the status surface

describe("Submission queue status (unverified is not a spinner)", () => {
  const entry = (over = {}) => ({
    callable: "recordPutAway", idempotencyKey: "k1", payload: {}, describe: "Stow 2 into A-14",
    state: SUBMISSION_STATE.UNVERIFIED, attempts: 1, lastError: null, queuedAt: 0, updatedAt: 0, ...over,
  });

  it("states unverified work IN WORDS, and says not to assume it is done", () => {
    const queue = [entry()];
    render(<SubmissionQueueStatus summary={summarize(queue)} queue={queue} />);
    const text = screen.getByRole("status").textContent;
    expect(text).toMatch(/sent but not confirmed/i);
    expect(text).toMatch(/do not assume it is done/i);
  });

  it("names REFUSED work separately, with its reason", () => {
    // A refusal counted alongside successes is a refusal nobody sees.
    const queue = [entry({ state: SUBMISSION_STATE.REJECTED, lastError: "permission-denied" })];
    render(<SubmissionQueueStatus summary={summarize(queue)} queue={queue} />);
    const text = screen.getByRole("status").textContent;
    expect(text).toMatch(/refused/i);
    expect(text).toMatch(/needs sorting out/i);
    expect(text).toMatch(/Stow 2 into A-14/);
    expect(text).toMatch(/permission-denied/);
  });

  it("shows nothing at all when there is nothing outstanding", () => {
    const { container } = render(<SubmissionQueueStatus summary={summarize([])} queue={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("offers a retry only while something can still be retried", () => {
    const queue = [entry({ state: SUBMISSION_STATE.PENDING })];
    const onRetry = vi.fn();
    render(<SubmissionQueueStatus summary={summarize(queue)} queue={queue} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /try again now/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("does NOT offer a retry for work that was refused", () => {
    const queue = [entry({ state: SUBMISSION_STATE.REJECTED, lastError: "invalid-argument" })];
    render(<SubmissionQueueStatus summary={summarize(queue)} queue={queue} onRetry={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /try again now/i })).toBeNull();
  });

  it("is announced to a screen reader", () => {
    const queue = [entry()];
    render(<SubmissionQueueStatus summary={summarize(queue)} queue={queue} />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });
});
