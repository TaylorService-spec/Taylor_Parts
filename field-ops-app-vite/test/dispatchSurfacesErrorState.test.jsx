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
// Work Order cutover: technicians are the governed roster (listWorkOrderTechnicians), Employee-keyed.
vi.mock("../src/hooks/useWorkOrderTechnicians", () => ({ useWorkOrderTechnicians: vi.fn() }));
vi.mock("../src/shared/ui/WorkOrderAuthorityNotice.jsx", () => ({ default: () => null }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: vi.fn() }));
// The Board's availability read: no failure unless a test says so.
vi.mock("../src/hooks/useTechnicianAvailability", () => ({
  useTechnicianAvailability: vi.fn(() => ({ byTechnicianId: new Map(), loading: false, error: null, refresh: () => {} })),
}));
// MyWorkspace mounts WorkflowWork; answer its client locally so nothing settles after jsdom is torn down.
vi.mock("../src/services/workflowRuntimeClient", () => ({ callWorkflowRuntimeApi: vi.fn(async () => ({ ok: true, result: { items: [], total: 0, truncated: false } })) }));

import { useWorkOrders } from "../src/hooks/useWorkOrders";
import { useMetadataList } from "../src/hooks/useMetadataList";
import { useWorkOrderTechnicians } from "../src/hooks/useWorkOrderTechnicians";
import { useAuth } from "../src/auth/AuthContext";
import { useTechnicianAvailability } from "../src/hooks/useTechnicianAvailability";
import WorkOrdersList from "../src/modules/workOrders/WorkOrdersList";
import Dispatch from "../src/modules/dispatch/Dispatch";
import DispatcherBoard from "../src/modules/dispatcherBoard/DispatcherBoard";
import Jobs from "../src/modules/jobs/Jobs.jsx";
import MyWorkspace from "../src/modules/workspace/MyWorkspace.jsx";

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
    useWorkOrderTechnicians.mockReturnValue({ data: [], loading: false, error: null });
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
    useWorkOrderTechnicians.mockReturnValue({ data: [], loading: false, error: null });
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
    useWorkOrderTechnicians.mockReturnValue({ data: [], loading: false, error: null });
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
    useWorkOrderTechnicians.mockReturnValue({ data: [], loading: false, error: null });
    render(<Dispatch />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/no work orders yet\./i)).toBeNull();
  });

  it("still shows the honest empty state when there is no error", () => {
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    useWorkOrderTechnicians.mockReturnValue({ data: [], loading: false, error: null });
    render(<Dispatch />);
    expect(screen.getByText(/no work orders yet\./i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("DispatcherBoard -- error is not swallowed into the empty state", () => {
  it("renders an alert, not 'No work orders exist yet.', when useWorkOrders returns an error", () => {
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: PERMISSION_ERROR });
    useWorkOrderTechnicians.mockReturnValue({ data: [], loading: false, error: null });
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
    useWorkOrderTechnicians.mockReturnValue({ data: [], loading: false, error: null });
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
  it("renders an alert, not the technicians empty state, when the governed technician roster read returns an error", () => {
    useWorkOrders.mockReturnValue({
      data: [{ id: "wo1", woNumber: "WO-1", status: "SCHEDULED", customerId: "c1" }],
      loading: false,
      error: null,
    });
    useWorkOrderTechnicians.mockReturnValue({ data: [], loading: false, error: PERMISSION_ERROR });
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

// EOS Core company authority (DECISIONS #235; #2110 company-isolates the office Work Order list). A caller who holds
// workOrder.record.read but no operating company is REFUSED (403 COMPANY_AUTHORITY_REQUIRED). Every surface must SAY
// so, in words, with the remedy -- never render an empty "no work orders" queue and never show the raw code.
describe("COMPANY_AUTHORITY_REQUIRED is a stated refusal on every Work Order surface", () => {
  const COMPANY_REFUSAL = { code: "FORBIDDEN", reason: "COMPANY_AUTHORITY_REQUIRED", status: 403 };
  const SAID = /No operating company is linked to your login/;

  it("Work Orders list: the denied state carries the reason", async () => {
    const { buildListPresentation } = await import("../src/metadata/listPresentation.js");
    const { workOrderEntity, workOrderIndexList } = await import("../src/metadata/definitions/workOrder.js");
    const { COMPANY_AUTHORITY_MESSAGE } = await import("../src/domain/workOrderOutcome.js");
    useMetadataList.mockReturnValue({
      presentation: buildListPresentation({ def: workOrderIndexList, entity: workOrderEntity, errorStatus: "denied", errorDetail: COMPANY_AUTHORITY_MESSAGE }),
      rows: [], loadMore: () => {}, retry: () => {}, descriptorErrors: [],
    });
    useWorkOrderTechnicians.mockReturnValue({ data: [], loading: false, error: null });
    render(<MemoryRouter><WorkOrdersList /></MemoryRouter>);
    expect(screen.getByRole("alert").textContent).toMatch(SAID);
    expect(screen.queryByText(/nothing here yet/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/COMPANY_AUTHORITY_REQUIRED/);
  });

  it("Dispatch: the alert says why", () => {
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: COMPANY_REFUSAL });
    useWorkOrderTechnicians.mockReturnValue({ data: [], loading: false, error: null });
    render(<Dispatch />);
    expect(screen.getByRole("alert").textContent).toMatch(SAID);
    expect(screen.queryByText(/no work orders yet\./i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/COMPANY_AUTHORITY_REQUIRED/);
  });

  it("Dispatcher Board: the alert says why", () => {
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: COMPANY_REFUSAL });
    useWorkOrderTechnicians.mockReturnValue({ data: [], loading: false, error: null });
    useAuth.mockReturnValue({ role: "dispatcher" });
    render(<MemoryRouter><DispatcherBoard /></MemoryRouter>);
    expect(screen.getAllByRole("alert").some((a) => SAID.test(a.textContent))).toBe(true);
    expect(screen.queryByText(/no work orders exist yet\./i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/COMPANY_AUTHORITY_REQUIRED/);
  });

  it("Jobs: the refusal says why", () => {
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: COMPANY_REFUSAL });
    useWorkOrderTechnicians.mockReturnValue({ data: [], loading: false, error: null });
    useAuth.mockReturnValue({ role: "dispatcher" });
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    expect(document.body.textContent).toMatch(SAID);
    expect(screen.queryByText(/no work orders yet./i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/COMPANY_AUTHORITY_REQUIRED/);
  });

  it("My Work: the dispatch queue section states the server's refusal, never an empty queue", async () => {
    // myWork.ts guarded() turns the 403 into NOT_AUTHORIZED with the server's sentence as the reason (pinned server-side
    // in functions/test/support/workOrderListQuerySuite.mjs).
    const reason = "no operating-company authority: requires one access-eligible linked Employee with an active home company, or an operating-company assignment";
    const work = {
      me: { principalId: "p1", employeeId: "e1", displayName: "Dana Dispatch", jobRole: { id: "service-coordinator-dispatcher", label: "Dispatcher" } },
      persona: { key: "service-coordinator-dispatcher", label: "Dispatcher", fromJobRole: true, analysisArea: "service" },
      operatingCompanyId: null, aiRequired: false,
      sections: [{ key: "dispatchQueue", title: "Work to schedule and dispatch", status: "NOT_AUTHORIZED", reason, hasMore: false, items: [] }],
    };
    const callApi = vi.fn(async () => ({ ok: true, result: work }));
    const { container, findByText } = render(<MemoryRouter><MyWorkspace callApi={callApi} /></MemoryRouter>);
    await findByText("Dana Dispatch", { selector: "dd" });
    expect(container.textContent.includes(`Not available to you — ${reason}`)).toBe(true);
    expect(container.textContent).not.toMatch(/COMPANY_AUTHORITY_REQUIRED|Nothing here|no work/i);
  });
});

// The Board's availability paragraph: a REFUSED read says the refusal; only a genuine outage says "could not be read".
describe("DispatcherBoard -- the availability read: refusal vs outage", () => {
  const board = (availabilityError) => {
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    useWorkOrderTechnicians.mockReturnValue({ data: [], loading: false, error: null });
    useAuth.mockReturnValue({ role: "dispatcher" });
    useTechnicianAvailability.mockReturnValue({ byTechnicianId: new Map(), loading: false, error: availabilityError, refresh: () => {} });
    render(<MemoryRouter><DispatcherBoard /></MemoryRouter>);
    return screen.getAllByRole("alert").map((a) => a.textContent).join(" | ");
  };

  it("no company authority: the stated refusal, never 'the server still enforces both'", () => {
    const text = board({ status: "forbidden", code: "COMPANY_AUTHORITY_REQUIRED" });
    expect(text).toMatch(/No operating company is linked to your login/);
    expect(text).not.toMatch(/still enforces both|could not be read/);
    expect(text).not.toMatch(/COMPANY_AUTHORITY_REQUIRED/);
  });

  it("another refusal (no capability): the classified refusal", () => {
    const text = board({ status: "forbidden", code: "CAPABILITY_MISSING" });
    expect(text).toMatch(/You do not have permission to view these working hours and blocked time./);
    expect(text).not.toMatch(/still enforces both/);
  });

  it("a genuine outage keeps the outage sentence", () => {
    const text = board({ status: "unavailable", code: "UNAVAILABLE" });
    expect(text).toMatch(/Working hours and blocked time could not be read, so shifts and capacity are not shown./);
    expect(text).toMatch(/Scheduling still works and the server still enforces both./);
  });
});
