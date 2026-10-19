// THE TECHNICIAN'S FIELD WORKFLOW -- the defects found by the Finley proof run (2026-10-19), proved through the real screens.
//
//   TW1  a job card on the phone's Jobs tab OPENS the governed current-job surface (the one FieldMode draws)
//   TW2  that card shows customer and site NAMES from the governed field context -- never acct_... / site_... ids
//   TW3  "My Day" says "N scheduled, not yet dispatched" -- not "No assigned work orders" -- for SCHEDULED jobs
//   TW4  Parts readiness reads the technician's OWN truck stock (readTruckStock): planned vs on-truck
//   #6   technician identity in the EOS build is the governed Employee: no Firestore read happens, and the consumers
//        (shell, scanner, offline queue) no longer take an id from the Firestore-derived technician link
//
// Real components, real hooks. Faked: the network (eosOperationOrThrow, the Work Order service), the field-context read,
// the assigned-work read, and the lazy scanner chunk. EOS_SESSION_SOURCE is forced true so useCurrentTechnician runs its
// EOS arm; firebase/firestore is a SPY, so any Firestore subscription would be seen.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => ({
  firestore: { onSnapshot: vi.fn(() => () => {}), doc: vi.fn(() => ({})) },
  wos: [],
  contexts: {},
  transition: vi.fn(async () => ({})),
  eos: vi.fn(),
  // the technician-roster read (listWorkOrderTechnicians) and the caller's own Work Order capability keys
  roster: vi.fn(async () => ({ items: [], operatingCompanyId: null })),
  caps: new Set(),
}));

vi.mock("firebase/firestore", () => ({ onSnapshot: h.firestore.onSnapshot, doc: h.firestore.doc }));
vi.mock("../src/firebase/firebase", () => ({ db: { __spy: true } }));
vi.mock("../src/access/eosSessionSource.js", () => ({ EOS_SESSION_SOURCE: true }));
vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({
    user: { uid: "uid-finley" }, role: "technician", employeeId: "emp-1", displayName: "Finley",
    loading: false, identityError: null, retryIdentityResolution: () => {}, operationalRoles: [],
  }),
  AuthProvider: ({ children }) => children,
}));
vi.mock("../src/services/workOrderService", () => ({
  transitionWorkOrder: (...a) => h.transition(...a),
  updateWorkOrderExecutionData: vi.fn(async () => ({ success: true, outcome: "RECORDED", usage: [] })),
  getWorkOrder: vi.fn(),
  subscribeToWorkOrders: vi.fn(() => () => {}),
  listWorkOrderTechnicians: (...a) => h.roster(...a),
}));
vi.mock("../src/hooks/useWorkOrders", () => ({ useWorkOrders: () => ({ data: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useMyWorkOrderCapabilities.js", () => ({
  useMyWorkOrderCapabilities: () => ({ status: "ready", has: (key) => h.caps.has(key) }),
  WORK_ORDER_CREATE_CAPABILITY: "workOrder.create",
}));
vi.mock("../src/hooks/useAssignedWorkOrders", () => ({
  useAssignedWorkOrders: () => ({ data: h.wos, loading: false, error: null, employeeId: "emp-1", unlinked: false, notActivated: false }),
}));
vi.mock("../src/hooks/useWorkOrderFieldContext", () => ({
  useWorkOrderFieldContext: (id) => h.contexts[id] ?? { context: null, denied: false, loading: false },
}));
vi.mock("../src/services/eosOperationsClient.js", async (orig) => ({ ...(await orig()), eosOperationOrThrow: (...a) => h.eos(...a) }));
vi.mock("../src/modules/scan/ScanWorkspace", () => ({ default: () => <div>Scan workspace</div> }));

const { default: TechnicianShell } = await import("../src/modules/technician/TechnicianShell.jsx");
const { default: FieldMode } = await import("../src/modules/mobile/FieldMode.jsx");
const { default: Jobs } = await import("../src/modules/jobs/Jobs.jsx");
const { MemoryRouter } = await import("react-router-dom");

const HARBOR = {
  context: {
    customer: { state: "RESOLVED", displayName: "Harbor Grill" },
    site: { state: "RESOLVED", displayLabel: "Main kitchen" },
    inventory: { state: "NOT_YET_ACTIVATED" },
  },
  denied: false, loading: false,
};

const wo = (over = {}) => ({
  id: "wo-103", woNumber: "WO-2026-000103", status: "DISPATCHED", type: "SERVICE_CALL", assignedTechId: "emp-1",
  customerId: "acct_9f2c1d", locationId: "site_41ab07", complaint: "Walk-in cooler warm",
  scheduledStart: "2026-10-20T15:00:00.000Z",
  inventorySnapshot: [{ partId: "PRT-1005", sku: "PRT-1005", qtyPlanned: 1, qtyUsed: 0 }],
  ...over,
});
const scheduled = (over = {}) => wo({ id: "wo-81", woNumber: "WO-2026-000081", status: "SCHEDULED", customerId: "synthetic-np-acct-retail", locationId: "site_zz", inventorySnapshot: [], ...over });

/** The technician's truck, as the EOS operations transport answers it. */
function truck({ stock = [{ partId: "PRT-1005", onHand: 1 }], roster = true, stockFails = false } = {}) {
  h.eos.mockImplementation(async (_route, operation, input) => {
    if (operation === "listTruckRoster") {
      return roster
        ? { trucks: [{ truckId: "taylor-truck-01", displayLabel: "Service Truck 01", mobileLocation: { locationId: "loc-truck-1", displayLabel: "Service Truck 01", active: true } }], mobileLocationIds: ["loc-truck-1"] }
        : { trucks: [], mobileLocationIds: [] };
    }
    if (operation === "readTruckStock") {
      if (stockFails) throw Object.assign(new Error("denied"), { category: "FORBIDDEN" });
      expect(input).toEqual({ mobileLocationId: "loc-truck-1" });
      return { quantities: stock, serializedUnits: [] };
    }
    throw new Error(`unexpected operation ${operation}`);
  });
}

beforeEach(() => {
  h.wos = [wo(), scheduled()];
  h.contexts = { "wo-103": HARBOR };
  h.transition.mockClear();
  h.roster.mockClear();
  h.caps = new Set();
  h.firestore.onSnapshot.mockClear();
  truck();
  window.localStorage.clear();
});
afterEach(cleanup);

const openJobsTab = () => fireEvent.click(within(screen.getByRole("navigation", { name: /technician/i })).getByRole("button", { name: "Jobs" }));

describe("TW1: a phone job card opens the governed current-job surface", () => {
  it("each card is a BUTTON; pressing it shows that job with its next governed action and the field tools", async () => {
    render(<TechnicianShell />);
    openJobsTab();
    const open = screen.getByRole("button", { name: /Open WO-2026-000103/ });
    fireEvent.click(open);
    expect(screen.getByRole("heading", { name: "Job" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Harbor Grill" })).toBeTruthy();
    // the SAME governed surface: lifecycle action + scan / note / time
    expect(screen.getByRole("button", { name: "Accept job" })).toBeTruthy();
    for (const tool of ["Scan a Part", "Add a Note", "Time"]) expect(screen.getByRole("button", { name: tool })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Accept job" })); });
    expect(h.transition).toHaveBeenCalledWith("wo-103", "Accept");
  });

  it("Back returns to the list; opening the other card shows THAT job (a scheduled one has no Accept)", async () => {
    render(<TechnicianShell />);
    openJobsTab();
    fireEvent.click(screen.getByRole("button", { name: /Open WO-2026-000103/ }));
    fireEvent.click(screen.getByRole("button", { name: /My jobs/ }));
    expect(screen.getAllByRole("button", { name: /^Open WO-/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Open WO-2026-000081/ }));
    expect(screen.getByText("WO-2026-000081")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept job" })).toBeNull();
    expect(screen.getByText(/Scheduled, not yet dispatched\. You can start it once dispatch sends it to you/)).toBeTruthy();
  });

  it("an id that is not one of the technician's own jobs opens nothing", () => {
    render(<FieldMode workOrderId="someone-elses-wo" />);
    expect(screen.getByText("This job is no longer on your list.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept job" })).toBeNull();
  });
});

describe("TW2: cards show names, never raw ids", () => {
  it("resolved names render; no acct_ / site_ / synthetic id reaches the list", () => {
    render(<TechnicianShell />);
    openJobsTab();
    const list = screen.getByRole("region", { name: "My jobs" });
    expect(within(list).getByText("Harbor Grill")).toBeTruthy();
    expect(within(list).getByText("Main kitchen")).toBeTruthy();
    expect(list.textContent).not.toMatch(/acct_|site_|synthetic-np-acct/);
  });

  it("an unresolved name says WHY (loading / not allowed / none on record), and still never prints the id", () => {
    h.contexts["wo-81"] = { context: null, denied: false, loading: true };
    const { unmount } = render(<TechnicianShell />);
    openJobsTab();
    expect(screen.getByText("Loading customer…")).toBeTruthy();
    unmount();
    h.contexts["wo-81"] = { context: null, denied: true, loading: false };
    const second = render(<TechnicianShell />);
    openJobsTab();
    expect(screen.getByText("Customer details unavailable to your role")).toBeTruthy();
    second.unmount();
    h.contexts["wo-81"] = { context: { customer: { state: "ABSENT" }, site: { state: "ABSENT" } }, denied: false, loading: false };
    const third = render(<TechnicianShell />);
    openJobsTab();
    expect(screen.getByText("No customer on record")).toBeTruthy();
    expect(third.container.textContent).not.toMatch(/acct_|site_|synthetic-np-acct/);
  });
});

describe("TW3: scheduled work is not 'no assigned work orders'", () => {
  it("only SCHEDULED jobs -> 'N scheduled jobs, not yet dispatched', with the WO numbers, and not 'No assigned work orders'", () => {
    h.wos = [wo({ id: "wo-103", status: "SCHEDULED" }), scheduled()];
    render(<FieldMode />);
    expect(screen.getByText("Nothing dispatched")).toBeTruthy();
    expect(screen.getByText(/2 scheduled jobs, not yet dispatched/)).toBeTruthy();
    expect(screen.getByText("WO-2026-000103")).toBeTruthy();
    expect(screen.getByText("WO-2026-000081")).toBeTruthy();
    expect(screen.queryByText("No assigned work orders.")).toBeNull();
  });

  it("one scheduled job reads in the singular; with no jobs at all the old sentence is still true", () => {
    h.wos = [scheduled()];
    const { unmount } = render(<FieldMode />);
    expect(screen.getByText(/1 scheduled job, not yet dispatched/)).toBeTruthy();
    unmount();
    h.wos = [];
    render(<FieldMode />);
    expect(screen.getByText("No assigned work orders.")).toBeTruthy();
    expect(screen.getByText("Nothing assigned")).toBeTruthy();
  });

  it("a dispatched job is shown as before (the scheduled note does not replace My Day)", () => {
    render(<FieldMode />);
    expect(screen.getByText("1 job")).toBeTruthy();
    expect(screen.queryByText(/not yet dispatched\./)).toBeNull();
  });
});

describe("TW4: parts readiness reads the technician's own truck", () => {
  it("the part is ON the truck -> Parts ready, planned vs on-truck shown, and no 'truck stock isn't available'", async () => {
    render(<FieldMode />);
    await waitFor(() => expect(screen.getByText(/Parts ready/)).toBeTruthy());
    expect(screen.getByText(/Planned 1 · On your truck 1/)).toBeTruthy();
    expect(screen.queryByText(/Truck stock isn't available for this job/)).toBeNull();
    // the boundary is still said out loud (warehouse stock), now with the truck that IS read
    expect(screen.getByText("Inventory readiness is not activated yet — warehouse stock is not checked. This shows the stock on your truck.")).toBeTruthy();
  });

  it("the truck is EMPTY -> a real zero, 'not enough', and NOT 'Parts ready'", async () => {
    truck({ stock: [] });
    render(<FieldMode />);
    await waitFor(() => expect(screen.getByText(/Planned 1 · On your truck 0/)).toBeTruthy());
    expect(screen.getByText(/not enough/)).toBeTruthy();
    expect(screen.queryByText(/Parts ready/)).toBeNull();
  });

  it("no truck in scope, or the stock read refused -> readiness stays UNKNOWN and says the truck stock is unavailable", async () => {
    truck({ roster: false });
    const { unmount } = render(<FieldMode />);
    await waitFor(() => expect(screen.getByText(/Truck stock isn't available for this job/)).toBeTruthy());
    expect(screen.queryByText(/On your truck/)).toBeNull();
    expect(screen.queryByText(/Parts ready/)).toBeNull();
    expect(screen.getByText("Inventory readiness is not activated yet — stock on hand is not checked.")).toBeTruthy();
    unmount();
    truck({ stockFails: true });
    render(<FieldMode />);
    await waitFor(() => expect(h.eos.mock.calls.some((c) => c[1] === "readTruckStock")).toBe(true));
    expect(screen.getByText(/Truck stock isn't available for this job/)).toBeTruthy();
    expect(screen.queryByText(/Parts ready/)).toBeNull();
  });
});

describe("TW4 round 2: consumed truck stock does not turn the job UNKNOWN", () => {
  it("plan 2, used 2, truck now 0 -> Parts ready (the parts were used, not missing)", async () => {
    h.wos = [wo({ inventorySnapshot: [{ partId: "PRT-1005", sku: "PRT-1005", qtyPlanned: 2, qtyUsed: 2 }] })];
    truck({ stock: [] });
    render(<FieldMode />);
    await waitFor(() => expect(screen.getByText(/Planned 2 · Used 2 · On your truck 0/)).toBeTruthy());
    expect(screen.getByText(/Parts ready/)).toBeTruthy();
    expect(screen.queryByText(/not enough/)).toBeNull();
  });

  it("plan 3, used 2, exactly the remainder (1) on the truck -> Parts ready; none left -> 'not enough', not ready", async () => {
    h.wos = [wo({ inventorySnapshot: [{ partId: "PRT-1005", sku: "PRT-1005", qtyPlanned: 3, qtyUsed: 2 }] })];
    truck({ stock: [{ partId: "PRT-1005", onHand: 1 }] });
    const { unmount } = render(<FieldMode />);
    await waitFor(() => expect(screen.getByText(/Planned 3 · Used 2 · On your truck 1/)).toBeTruthy());
    expect(screen.getByText(/Parts ready/)).toBeTruthy();
    expect(screen.queryByText(/not enough/)).toBeNull();
    unmount();
    truck({ stock: [] });
    render(<FieldMode />);
    await waitFor(() => expect(screen.getByText(/Planned 3 · Used 2 · On your truck 0 · not enough/)).toBeTruthy());
    expect(screen.queryByText(/Parts ready/)).toBeNull();
  });
});

describe("TW2 round 2: the unresolved-name copy tells the truth about WHY", () => {
  it("before the first read answers it is 'Loading', never 'No customer on record'", () => {
    // no context, not denied, not flagged loading: the state before the effect has produced anything
    h.contexts["wo-81"] = { context: null, denied: false, loading: false };
    render(<TechnicianShell />);
    openJobsTab();
    expect(screen.getAllByText("Loading customer…").length).toBeGreaterThan(0);
    expect(screen.queryByText("No customer on record")).toBeNull();
  });

  it("an unreachable service reads 'unavailable offline'; a refusal reads 'unavailable to your role'", () => {
    h.contexts["wo-81"] = { context: null, denied: true, loading: false, failure: { code: "UNREACHABLE", reason: null } };
    const { unmount } = render(<TechnicianShell />);
    openJobsTab();
    expect(screen.getByText("Customer details unavailable offline")).toBeTruthy();
    expect(screen.getByText("Site details unavailable offline")).toBeTruthy();
    expect(screen.queryByText("Customer details unavailable to your role")).toBeNull();
    unmount();
    h.contexts["wo-81"] = { context: null, denied: true, loading: false, failure: { code: "FORBIDDEN", reason: "NOT_ASSIGNED" } };
    render(<TechnicianShell />);
    openJobsTab();
    expect(screen.getByText("Customer details unavailable to your role")).toBeTruthy();
  });
});

describe("a technician fires no listWorkOrderTechnicians 403 from the office list screens", () => {
  const renderJobs = () => render(<MemoryRouter><Jobs /></MemoryRouter>);

  it("Jobs: a technician (no schedule/dispatch) makes NO roster read", async () => {
    renderJobs();
    await act(async () => {});
    expect(h.roster).not.toHaveBeenCalled();
  });

  it("Jobs: a caller holding workOrder.lifecycle.dispatch (or schedule) still reads the roster", async () => {
    h.caps = new Set(["workOrder.lifecycle.dispatch"]);
    renderJobs();
    await waitFor(() => expect(h.roster).toHaveBeenCalled());
  });

  it("the other roster-resolving screens are gated by the same shared check", () => {
    for (const file of ["src/modules/workOrders/WorkOrdersList.jsx", "src/modules/jobs/Jobs.jsx", "src/modules/controlTower/ControlTower.jsx", "src/modules/workOrders/WorkOrderDetailPage.jsx"]) {
      const src = readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(src, file).toMatch(/canReadWorkOrderRoster\(/);
      expect(src, file).toMatch(/useWorkOrderTechnicianDirectory\([^)]*\{\s*enabled:/);
    }
  });
});

describe("item 6: the technician identity is the governed Employee -- no Firestore, no Firebase-derived id", () => {
  it("rendering the shell, a job and the field screen reads NOTHING from Firestore (EOS source)", async () => {
    render(<TechnicianShell />);
    openJobsTab();
    fireEvent.click(screen.getByRole("button", { name: /Open WO-2026-000103/ }));
    await waitFor(() => expect(screen.getByText(/Parts ready/)).toBeTruthy());
    expect(h.firestore.onSnapshot).not.toHaveBeenCalled();
    expect(h.firestore.doc).not.toHaveBeenCalled();
    // and the offline queue is the signed-in principal's, not a technician id's
    expect(Object.keys(window.localStorage).every((k) => !/tech-/.test(k))).toBe(true);
  });

  const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
  const CONSUMERS = [
    "src/modules/mobile/FieldMode.jsx", "src/modules/technician/TechnicianShell.jsx", "src/modules/scan/ScanWorkspace.jsx",
    "src/modules/mobile/PartsScanner.jsx", "src/hooks/useOfflineRuntime.js", "src/modules/technicianDashboard/TechnicianDashboard.jsx",
  ];

  it("no consumer imports Firestore or the technician collections itself", () => {
    for (const file of CONSUMERS) {
      const src = read(file);
      expect(src, file).not.toMatch(/from "firebase\/firestore"/);
      expect(src, file).not.toMatch(/TECHNICIANS_COLLECTION|USERS_COLLECTION/);
    }
  });

  it("the shell and the scanner take NO identity from useCurrentTechnician; FieldMode takes only its profile state, never an id", () => {
    const takesIdentity = /import \{ useCurrentTechnician \}|useCurrentTechnician\(/;
    expect(read("src/modules/technician/TechnicianShell.jsx")).not.toMatch(takesIdentity);
    expect(read("src/modules/scan/ScanWorkspace.jsx")).not.toMatch(takesIdentity);
    const field = read("src/modules/mobile/FieldMode.jsx");
    expect(field).not.toMatch(/technicianId:\s*\(\)\s*=>/);          // no id handed to the offline runtime
    expect(field).not.toMatch(/<PartsScanner[^>]*technicianId/);       // no id handed to the scanner
    expect(field).not.toMatch(/^\s*technicianId,\s*$/m);               // not destructured from the hook
  });

  it("the Firestore arm of useCurrentTechnician is inert when EOS is the source (and held for the production recovery release)", () => {
    const hook = read("src/hooks/useCurrentTechnician.js");
    expect(hook).toMatch(/useFirebaseCurrentTechnician\(\{ enabled: !eos \}\)/);
    expect(hook).toMatch(/FIREBASE ARM: HELD FOR THE PRODUCTION RECOVERY RELEASE/);
  });
});
