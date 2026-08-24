// site-work #3 (dispatch-surfaces-drop-workorders-error) -- RENDER tests (vitest + jsdom).
// useWorkOrders() intentionally exposes { data, loading, error } (see
// src/hooks/useWorkOrders.js: "Fail VISIBLY. A swallowed permission-denied left this
// surface spinning indefinitely..."). Before this fix, WorkOrdersList.jsx, Dispatch.jsx,
// and DispatcherBoard.jsx destructured only { data, loading } and branched on
// data.length === 0, so a permission-denied or unavailable read rendered the exact same
// "no work orders" empty copy as a genuinely empty queue -- a dispatcher could miss real,
// urgent jobs with no indication anything failed and no way to retry.
//
// These tests pin the fix: each surface must render a distinct, alert-role error state
// (mirroring Jobs.jsx's existing "fail visibly" pattern) instead of its empty state when
// useWorkOrders() returns a truthy error. useWorkOrders and useFirestoreCollection are
// mocked (no Firebase, no network) so the two states can be driven directly.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/hooks/useWorkOrders", () => ({ useWorkOrders: vi.fn() }));
// WorkOrdersList moved off useWorkOrders onto the bounded metadata runtime. The PROPERTY under
// test is unchanged and is the whole point of this file -- a failed read must never render as an
// empty queue -- so the surface is still tested, through the read path it actually has now.
vi.mock("../src/hooks/useMetadataList", () => ({ useMetadataList: vi.fn() }));
vi.mock("../src/hooks/useWorkOrderSearch", () => ({ useWorkOrderSearch: () => ({ state: "IDLE", results: [], truncated: false, message: null }) }));
vi.mock("../src/hooks/useAccountReferenceResolver", () => ({ useAccountReferenceResolver: () => ({ resolveReference: () => undefined }) }));
vi.mock("../src/hooks/useFirestoreCollection", () => ({ useFirestoreCollection: vi.fn() }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: vi.fn() }));

import { useWorkOrders } from "../src/hooks/useWorkOrders";
import { useMetadataList } from "../src/hooks/useMetadataList";
import { useFirestoreCollection } from "../src/hooks/useFirestoreCollection";
import { useAuth } from "../src/auth/AuthContext";
import WorkOrdersList from "../src/modules/workOrders/WorkOrdersList";
import Dispatch from "../src/modules/dispatch/Dispatch";
import DispatcherBoard from "../src/modules/dispatcherBoard/DispatcherBoard";

const PERMISSION_ERROR = { code: "permission-denied" };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkOrdersList -- error is not swallowed into the empty state", () => {
  const listResult = (presentation) => ({
    presentation, rows: [], loadMore: () => {}, retry: () => {}, descriptorErrors: [],
  });

  it("renders an alert, not an empty queue, when the bounded read is denied", () => {
    // DENIED and EMPTY are different facts about the business, and only one of them means
    // there is no work. Collapsing them is what let a dispatcher miss real, urgent jobs.
    useMetadataList.mockReturnValue(listResult({
      state: "DENIED", columns: [], rows: [], hasMore: false,
      emptyMessage: "You do not have access to work orders.",
    }));
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });
    render(
      <MemoryRouter>
        <WorkOrdersList />
      </MemoryRouter>
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/nothing here yet/i)).toBeNull();
  });

  it("renders an alert when the read fails for any other reason", () => {
    useMetadataList.mockReturnValue(listResult({
      state: "UNAVAILABLE", columns: [], rows: [], hasMore: false,
      emptyMessage: "Work orders could not be loaded.",
    }));
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });
    render(
      <MemoryRouter>
        <WorkOrdersList />
      </MemoryRouter>
    );
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("still shows the honest empty state when the read succeeded and found nothing", () => {
    useMetadataList.mockReturnValue(listResult({
      state: "EMPTY", columns: [], rows: [], hasMore: false, emptyMessage: null,
    }));
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });
    render(
      <MemoryRouter>
        <WorkOrdersList />
      </MemoryRouter>
    );
    expect(screen.getByText(/nothing here yet/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Dispatch -- error is not swallowed into the empty state", () => {
  it("renders an alert, not 'No work orders yet.', when useWorkOrders returns an error", () => {
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: PERMISSION_ERROR });
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });
    render(<Dispatch />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/no work orders yet\./i)).toBeNull();
  });

  it("still shows the honest empty state when there is no error", () => {
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });
    render(<Dispatch />);
    expect(screen.getByText(/no work orders yet\./i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("DispatcherBoard -- error is not swallowed into the empty state", () => {
  it("renders an alert, not 'No work orders exist yet.', when useWorkOrders returns an error", () => {
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: PERMISSION_ERROR });
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });
    useAuth.mockReturnValue({ role: "dispatcher" });
    render(
      <MemoryRouter>
        <DispatcherBoard />
      </MemoryRouter>
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/no work orders exist yet\./i)).toBeNull();
  });

  it("still shows the honest empty state when there is no error", () => {
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });
    useAuth.mockReturnValue({ role: "dispatcher" });
    render(
      <MemoryRouter>
        <DispatcherBoard />
      </MemoryRouter>
    );
    expect(screen.getByText(/no work orders exist yet\./i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // A denied/failed technicians read used to fall through to
  // TechnicianBoard's "No technicians exist yet." empty state -- a
  // dispatcher would read that as "there are genuinely no technicians"
  // rather than "this read just failed," with no recommendations, no drop
  // targets, and no indication anything is wrong.
  it("renders an alert, not the technicians empty state, when useFirestoreCollection(technicians) returns an error", () => {
    useWorkOrders.mockReturnValue({
      data: [{ id: "wo1", woNumber: "WO-1", status: "SCHEDULED", customerId: "c1" }],
      loading: false,
      error: null,
    });
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: PERMISSION_ERROR });
    useAuth.mockReturnValue({ role: "dispatcher" });
    render(
      <MemoryRouter>
        <DispatcherBoard />
      </MemoryRouter>
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/no technicians exist yet\./i)).toBeNull();
  });
});
