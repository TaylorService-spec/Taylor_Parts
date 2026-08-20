// SHARED SCAN WORKSPACE — the assembled entry point (vitest + jsdom).
//
// The availability rules are proved as pure functions in test/scanWorkflows.test.mjs. These cover
// what only the assembled workspace shows: that it composes the two existing journeys rather than
// reimplementing either, that an empty workspace explains itself, and that the Phase D receiving
// properties survive being launched from here — because it is the same component.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import ScanWorkspace from "../src/modules/scan/ScanWorkspace.jsx";
import { RECEIVING_OUTCOME } from "../src/domain/receivingTransport.js";
import { RECEIVE_CAPABILITY } from "../src/access/scanWorkflows.js";

// The technician hooks reach Firestore; the workspace resolves them itself (renderSubnavItem cannot
// call hooks), so they are mocked at module level and the identity is injected through `deps`.
vi.mock("../src/hooks/useCurrentTechnician", () => ({
  useCurrentTechnician: () => ({ technicianId: null, loading: false, error: null, retry: () => {} }),
}));
vi.mock("../src/hooks/useAssignedWorkOrders", () => ({
  useAssignedWorkOrders: () => ({ data: [], loading: false, error: null }),
}));
// PartsScanner reads the role from auth itself. Mocked so the composed scanner mounts; its own
// behaviour is covered by test/partsScanner.test.jsx and is deliberately not re-proved here.
vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ role: "technician", user: { uid: "U1" } }),
}));

afterEach(cleanup);

const receivingDeps = (over = {}) => ({
  fetchReceivablePurchaseOrders: vi.fn().mockResolvedValue({
    status: RECEIVING_OUTCOME.READY,
    purchaseOrders: [{ purchaseOrderId: "PO-1", supplierId: "SUP-1", storedStatus: "SENT", lineCount: 1 }],
  }),
  fetchPurchaseOrderProgress: vi.fn().mockResolvedValue({
    status: RECEIVING_OUTCOME.READY,
    progress: {
      purchaseOrderId: "PO-1", supplierId: "SUP-1", supplierName: "Acme", storedStatus: "SENT",
      derivedState: "NOT_RECEIVED", receivable: true, version: 0,
      lines: [{ lineId: "L1", partId: "P1", trackingMode: "NONE", orderedQuantity: 5, receivedQuantity: 0, remainingQuantity: 5, state: "NOT_RECEIVED" }],
    },
  }),
  fetchReceivingLocationOptions: vi.fn().mockResolvedValue({ status: RECEIVING_OUTCOME.READY, options: [{ locationId: "WH-1", label: "Main" }] }),
  submitCanonicalReceive: vi.fn().mockResolvedValue({ status: RECEIVING_OUTCOME.APPLIED, receipt: null }),
  ...over,
});

const warehouseUser = (over = {}) => ({
  hasCapability: (id) => id === RECEIVE_CAPABILITY,
  receivingReady: true,
  role: null,           // a governed persona with NO legacy role
  technicianId: null,
  assignedWorkOrderCount: 0,
  receivingDeps: receivingDeps(),
  ...over,
});

const technicianUser = (over = {}) => ({
  hasCapability: () => false,
  receivingReady: false,
  role: "technician",
  technicianId: "T1",
  assignedWorkOrderCount: 2,
  ...over,
});

// ────────────────────────────────────────────── eligibility

describe("Scan workspace (eligibility comes from authority, not role name)", () => {
  it("a governed persona with NO legacy role sees supplier receiving", () => {
    render(<ScanWorkspace deps={warehouseUser()} />);
    expect(screen.getByRole("button", { name: /receive a supplier purchase order/i })).toBeTruthy();
  });

  it("a caller without the capability does NOT get the receiving action", () => {
    render(<ScanWorkspace deps={warehouseUser({ hasCapability: () => false })} />);
    expect(screen.queryByRole("button", { name: /receive a supplier purchase order/i })).toBeNull();
    expect(screen.getByText(/not authorized to receive stock/i)).toBeTruthy();
  });

  it("AUTHORIZED but readiness-false is explained as readiness, not denial", () => {
    render(<ScanWorkspace deps={warehouseUser({ receivingReady: false })} />);
    expect(screen.queryByRole("button", { name: /receive a supplier purchase order/i })).toBeNull();
    const text = screen.getByText(/not switched on in this environment/i);
    expect(text.textContent).not.toMatch(/not authorized/i);
  });

  it("readiness-false attempts NO protected callable", async () => {
    const deps = receivingDeps();
    render(<ScanWorkspace deps={warehouseUser({ receivingReady: false, receivingDeps: deps })} />);
    await waitFor(() => expect(screen.getByText(/not switched on/i)).toBeTruthy());
    expect(deps.fetchReceivablePurchaseOrders).not.toHaveBeenCalled();
    expect(deps.submitCanonicalReceive).not.toHaveBeenCalled();
  });

  it("a technician sees the work order scan and NOT receiving", () => {
    render(<ScanWorkspace deps={technicianUser()} />);
    expect(screen.getByRole("button", { name: /scan parts for my work order/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /receive a supplier purchase order/i })).toBeNull();
  });
});

// ────────────────────────────────────────────── the empty state

describe("Scan workspace (nothing available is SAID, never a blank screen)", () => {
  it("states plainly that nothing is available, and why", () => {
    render(<ScanWorkspace deps={{ hasCapability: () => false, receivingReady: false, role: null, technicianId: null, assignedWorkOrderCount: 0 }} />);
    expect(screen.getByRole("heading", { name: /no scanning workflows are available/i })).toBeTruthy();
    expect(screen.getByText(/nothing here is broken/i)).toBeTruthy();
    // and every missing workflow explains itself
    const notAvailable = screen.getByRole("region", { name: /not available to you/i });
    expect(within(notAvailable).getByText(/not authorized to receive stock/i)).toBeTruthy();
    expect(within(notAvailable).getByText(/for technicians working an assigned job/i)).toBeTruthy();
  });

  it("a technician with no assigned work gets that reason, not a permission message", () => {
    render(<ScanWorkspace deps={technicianUser({ assignedWorkOrderCount: 0 })} />);
    expect(screen.getByText(/no assigned work orders to scan against/i)).toBeTruthy();
  });
});

// ────────────────────────────────────────────── absent, not disabled

describe("Scan workspace (operations that do not exist are ABSENT)", () => {
  it("offers no put-away, pick, stage, transfer, return, cycle count or truck handoff — enabled or disabled", () => {
    render(<ScanWorkspace deps={{ hasCapability: () => true, receivingReady: true, role: "technician", technicianId: "T1", assignedWorkOrderCount: 3 }} />);
    for (const forbidden of [/put.?away/i, /^pick/i, /stage/i, /transfer/i, /return/i, /cycle count/i, /truck/i, /look ?up/i]) {
      expect(screen.queryByRole("button", { name: forbidden })).toBeNull();
    }
  });

  it("has NO disabled workflow buttons at all", () => {
    // A disabled control would imply the operation exists and access is the only obstacle.
    render(<ScanWorkspace deps={warehouseUser()} />);
    for (const b of screen.getAllByRole("button")) expect(b.disabled).toBeFalsy();
  });
});

// ────────────────────────────────────────────── Phase D integration

describe("Scan workspace (composes Phase D receiving, does not reimplement it)", () => {
  const openReceiving = (deps) => {
    render(<ScanWorkspace deps={deps} />);
    fireEvent.click(screen.getByRole("button", { name: /receive a supplier purchase order/i }));
  };

  it("launches the Phase D receiving journey", async () => {
    const rd = receivingDeps();
    openReceiving(warehouseUser({ receivingDeps: rd }));
    await waitFor(() => expect(rd.fetchReceivablePurchaseOrders).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "PO-1" })).toBeTruthy();
  });

  it("the Phase D queue behaviour is unchanged when launched from here", async () => {
    const rd = receivingDeps();
    openReceiving(warehouseUser({ receivingDeps: rd }));
    fireEvent.click(await screen.findByRole("button", { name: "PO-1" }));
    await screen.findByLabelText(/^part$/i);

    // scan twice -> aggregates to 2
    for (let i = 0; i < 2; i += 1) {
      fireEvent.change(screen.getByLabelText(/^part$/i), { target: { value: "P1" } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    }
    expect(screen.getByText(/2 scans · 2 units queued/i)).toBeTruthy();
  });

  it("a BLOCKED observation still blocks submission from here", async () => {
    const rd = receivingDeps();
    openReceiving(warehouseUser({ receivingDeps: rd }));
    fireEvent.click(await screen.findByRole("button", { name: "PO-1" }));
    await screen.findByLabelText(/^part$/i);
    fireEvent.change(screen.getByLabelText(/^part$/i), { target: { value: "GHOST" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    expect(await screen.findByText(/not on this purchase order/i)).toBeTruthy();
    const submit = screen.getByRole("button", { name: /submit receipt/i });
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(rd.submitCanonicalReceive).not.toHaveBeenCalled();
  });

  it("UNKNOWN tracking mode is still surfaced as UNKNOWN, not silently NONE", async () => {
    const rd = receivingDeps({
      fetchPurchaseOrderProgress: vi.fn().mockResolvedValue({
        status: RECEIVING_OUTCOME.READY,
        progress: {
          purchaseOrderId: "PO-1", supplierId: null, supplierName: null, storedStatus: "SENT",
          derivedState: "NOT_RECEIVED", receivable: true, version: 0,
          lines: [{ lineId: "L1", partId: "P1", trackingMode: "UNKNOWN", orderedQuantity: 1, receivedQuantity: 0, remainingQuantity: 1, state: "NOT_RECEIVED" }],
        },
      }),
    });
    openReceiving(warehouseUser({ receivingDeps: rd }));
    fireEvent.click(await screen.findByRole("button", { name: "PO-1" }));
    expect(await screen.findByText(/unknown part/i)).toBeTruthy();
  });

  it("a successful submission still sends ONE canonical receipt intent", async () => {
    const rd = receivingDeps({
      submitCanonicalReceive: vi.fn().mockResolvedValue({
        status: RECEIVING_OUTCOME.APPLIED,
        receipt: {
          outcome: "applied", receivingId: "rcvc_1", purchaseOrderId: "PO-1", ledgerEventId: "l1",
          derivedState: "PARTIALLY_RECEIVED", storedStatus: "SENT",
          lines: [{ lineId: "L1", partId: "P1", orderedQuantity: 5, previouslyReceived: 0, receivedNow: 1, remainingQuantity: 4, state: "PARTIALLY_RECEIVED" }],
        },
      }),
    });
    openReceiving(warehouseUser({ receivingDeps: rd }));
    fireEvent.click(await screen.findByRole("button", { name: "PO-1" }));
    await screen.findByLabelText(/^part$/i);
    fireEvent.change(screen.getByLabelText(/^part$/i), { target: { value: "P1" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    fireEvent.change(screen.getByLabelText(/receiving location/i), { target: { value: "WH-1" } });
    fireEvent.click(screen.getByRole("button", { name: /submit receipt/i }));

    await waitFor(() => expect(rd.submitCanonicalReceive).toHaveBeenCalledTimes(1));
    const payload = rd.submitCanonicalReceive.mock.calls[0][0];
    expect(payload.source).toEqual({ type: "PURCHASE_ORDER", purchaseOrderId: "PO-1" });
    expect(payload.idempotencyKey).toBeTruthy();
  });

  it("returns to the workflow list without losing the other workflows", async () => {
    openReceiving(warehouseUser());
    await screen.findByRole("button", { name: "PO-1" });
    fireEvent.click(screen.getByRole("button", { name: /all scanning workflows/i }));
    expect(screen.getByRole("button", { name: /receive a supplier purchase order/i })).toBeTruthy();
  });
});

// ────────────────────────────────────────────── technician regression

describe("Scan workspace (the technician journey is composed, not rewritten)", () => {
  const openTechnician = (deps = technicianUser()) => {
    render(<ScanWorkspace deps={deps} />);
    fireEvent.click(screen.getByRole("button", { name: /scan parts for my work order/i }));
  };

  it("launches the EXISTING PartsScanner, identified by ITS OWN surface", async () => {
    openTechnician();
    // These are PartsScanner's controls, not the workspace's -- the workspace adds no scan entry of
    // its own. Their presence is what proves composition rather than reimplementation.
    expect(await screen.findByLabelText(/part or work order code/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /scan a code/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^find$/i })).toBeTruthy();
  });

  it("adds NO second scan entry point of its own", () => {
    openTechnician();
    expect(screen.getAllByLabelText(/part or work order code/i)).toHaveLength(1);
  });

  it("the workspace can be left again without stranding the technician", async () => {
    openTechnician();
    await screen.findByLabelText(/part or work order code/i);
    fireEvent.click(screen.getByRole("button", { name: /all scanning workflows/i }));
    expect(screen.getByRole("button", { name: /scan parts for my work order/i })).toBeTruthy();
  });
});

// ────────────────────────────────────────────── reachable by keyboard and thumb

describe("Scan workspace (reachable without a mouse)", () => {
  it("every workflow control is a REAL button, so tab and Enter work with no key handling of ours", () => {
    render(<ScanWorkspace deps={{ hasCapability: () => true, receivingReady: true, role: "technician", technicianId: "T1", assignedWorkOrderCount: 1 }} />);
    for (const name of [/receive a supplier purchase order/i, /scan parts for my work order/i]) {
      const control = screen.getByRole("button", { name });
      expect(control.tagName).toBe("BUTTON");
      expect(control.getAttribute("tabindex")).not.toBe("-1");
    }
  });

  it("the back control is a button too, not a bare clickable element", async () => {
    render(<ScanWorkspace deps={warehouseUser()} />);
    fireEvent.click(screen.getByRole("button", { name: /receive a supplier purchase order/i }));
    await screen.findByRole("button", { name: "PO-1" });   // let the PO read settle first
    expect(screen.getByRole("button", { name: /all scanning workflows/i }).tagName).toBe("BUTTON");
  });

  it("the unavailable list is an announced region, not unlabelled decoration", () => {
    render(<ScanWorkspace deps={{ hasCapability: () => false, receivingReady: false, role: null, technicianId: null, assignedWorkOrderCount: 0 }} />);
    expect(screen.getByRole("region", { name: /not available to you/i })).toBeTruthy();
    expect(screen.getByRole("region", { name: /no scanning workflows available/i })).toBeTruthy();
  });
});

// ────────────────────────────────────────────── loading and failure, in Phase D's hands

describe("Scan workspace (a failed read is Phase D's own state, not a blank panel)", () => {
  it("surfaces the receiving journey's failure state rather than swallowing it", async () => {
    const rd = receivingDeps({
      fetchReceivablePurchaseOrders: vi.fn().mockResolvedValue({ status: RECEIVING_OUTCOME.FAILED, message: "Purchase orders could not be loaded." }),
    });
    render(<ScanWorkspace deps={warehouseUser({ receivingDeps: rd })} />);
    fireEvent.click(screen.getByRole("button", { name: /receive a supplier purchase order/i }));
    expect(await screen.findByText(/could not be loaded/i)).toBeTruthy();
    // and the user is not trapped there
    expect(screen.getByRole("button", { name: /all scanning workflows/i })).toBeTruthy();
  });
});
