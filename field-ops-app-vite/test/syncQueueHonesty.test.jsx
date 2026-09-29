// @vitest-environment jsdom
// XLF-007. The technician sync queue must never reassure a technician about work it could not read. An
// unreadable device store leaves the in-memory queue EMPTY -- which is not the same as nothing waiting.
// Mirrors warehouseSyncQueueHonesty.test.jsx (the warehouse twin).
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import SyncQueue from "../src/modules/mobile/SyncQueue.jsx";

afterEach(cleanup);

const runtime = (over = {}) => ({
  queue: [], summary: { unsynced: 0, attentionCount: 0, synced: 0 }, syncing: false, durable: true,
  saveProblem: null, loadProblem: false, sync: () => {}, retry: () => {}, discard: () => {}, clearSettled: () => {},
  ...over,
});

describe("SyncQueue honesty", () => {
  it("a store that could not be read is NOT reported as 'everything is on the platform' or 'nothing waiting'", () => {
    render(<SyncQueue runtime={runtime({ loadProblem: true })} />);
    const text = document.body.textContent;
    expect(text).toMatch(/could not be read/i);
    expect(text).not.toMatch(/Everything you have entered is on the platform/);
    expect(text).not.toMatch(/Nothing waiting/);
  });

  it("a readable, empty store still says so", () => {
    render(<SyncQueue runtime={runtime()} />);
    const text = document.body.textContent;
    expect(text).toMatch(/Everything you have entered is on the platform/);
    expect(text).toMatch(/Nothing waiting/);
  });
});
