// SHARED SCAN WORKSPACE — the assembled entry point (vitest + jsdom).
//
// The availability rules are proved as pure functions in test/scanWorkflows.test.mjs. These cover
// what only the assembled workspace shows: that it composes the three journeys rather than
// reimplementing any of them, that a workflow the caller cannot use still explains itself, and that
// the Phase D receiving properties survive being launched from here — because it is the same
// component. Lookup's own behaviour lives in test/lookupScan.test.jsx.
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

afterEach(() => {
  cleanup();
  // The workspace REMEMBERS which workflow the operator was in (Phase N), in real session storage.
  // Without clearing it, one test's choice would land the next test inside that workflow.
  try { window.sessionStorage.clear(); } catch { /* storage may be unavailable */ }
});

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
  // Phase F changed the shape of this. Lookup needs no capability and no readiness, so the LEAST
  // authorized caller now lands on something they can actually do rather than on an explanation of
  // why they cannot. What must survive is that the workflows they CANNOT use still say so.
  it("the least-authorized caller gets lookup, and every absence still explains itself", () => {
    render(<ScanWorkspace deps={{ hasCapability: () => false, receivingReady: false, role: null, technicianId: null, assignedWorkOrderCount: 0 }} />);
    expect(screen.getByRole("button", { name: /look something up/i })).toBeTruthy();
    const notAvailable = screen.getByRole("region", { name: /not available to you/i });
    expect(within(notAvailable).getByText(/not authorized to receive stock/i)).toBeTruthy();
    expect(within(notAvailable).getByText(/for technicians working an assigned job/i)).toBeTruthy();
  });

  it("the empty-workspace guard is kept, and is unreachable today rather than deleted", () => {
    // It becomes reachable again the moment any future gating is put on lookup. Asserting its
    // absence here records that this is by construction, not an accident.
    render(<ScanWorkspace deps={{ hasCapability: () => false, receivingReady: false, role: null, technicianId: null, assignedWorkOrderCount: 0 }} />);
    expect(screen.queryByRole("heading", { name: /no scanning workflows are available/i })).toBeNull();
  });

  it("a technician with no assigned work gets that reason, not a permission message", () => {
    render(<ScanWorkspace deps={technicianUser({ assignedWorkOrderCount: 0 })} />);
    expect(screen.getByText(/no assigned work orders to scan against/i)).toBeTruthy();
  });
});

// ────────────────────────────────────────────── absent, not disabled

describe("Scan workspace (operations that do not exist are ABSENT)", () => {
  it("offers returns now that it has an authority — and still offers no truck handoff or disposition", () => {
    render(<ScanWorkspace deps={{ hasCapability: () => true, receivingReady: true, role: "technician", technicianId: "T1", assignedWorkOrderCount: 3 }} />);
    // The list has grown one phase at a time, each time a REAL governed authority was found: lookup
    // (F), transfers (J1), counting (J2), put-away (L), picking (M), and returns intake once
    // recordReturnIntake was deployed, activated and granted.
    //
    // WHAT STILL HAS NO CONTROL, and must not gain one by association:
    //   TRUCK HANDOFF — a handoff IS a transfer with a mobile endpoint, not a second state machine.
    //   DISPOSITION   — deciding what becomes of a return is a separate authority that does not
    //                   exist (#118). Taking returns in must never imply putting them back.
    //   STAGE         — staging is how a pick ends, not its own workflow.
    for (const forbidden of [/truck/i, /disposition/i, /back to stock/i, /restock/i]) {
      expect(screen.queryByRole("button", { name: forbidden })).toBeNull();
    }
    for (const present of [
      /look something up/i, /send or receive a transfer/i, /count what is on the shelf/i,
      /put stock away/i, /pick and stage for a job/i, /take a return in/i,
    ]) {
      expect(screen.getByRole("button", { name: present })).toBeTruthy();
    }
  });  it("has NO disabled workflow buttons at all", () => {
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

// ────────────────────────────────────────────── Phase F: lookup, composed

describe("Scan workspace (lookup is composed like the others)", () => {
  it("launches lookup for a caller with no capability and no readiness at all", async () => {
    render(<ScanWorkspace deps={{ hasCapability: () => false, receivingReady: false, role: null, technicianId: null, assignedWorkOrderCount: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: /look something up/i }));
    // LookupScan's own control, not one the workspace invented.
    expect(await screen.findByLabelText(/part code/i)).toBeTruthy();
    expect(screen.getByText(/reads only/i)).toBeTruthy();
  });

  it("says on the chooser that lookup changes nothing, before it is opened", () => {
    render(<ScanWorkspace deps={warehouseUser()} />);
    expect(screen.getByText(/nothing is moved, counted or changed/i)).toBeTruthy();
  });

  it("leaving lookup returns to the full workflow list", async () => {
    render(<ScanWorkspace deps={warehouseUser()} />);
    fireEvent.click(screen.getByRole("button", { name: /look something up/i }));
    await screen.findByLabelText(/part code/i);
    fireEvent.click(screen.getByRole("button", { name: /all scanning workflows/i }));
    expect(screen.getByRole("button", { name: /receive a supplier purchase order/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /look something up/i })).toBeTruthy();
  });

  it("adding lookup did not change the RECEIVING journey", async () => {
    const rd = receivingDeps();
    render(<ScanWorkspace deps={warehouseUser({ receivingDeps: rd })} />);
    fireEvent.click(screen.getByRole("button", { name: /receive a supplier purchase order/i }));
    fireEvent.click(await screen.findByRole("button", { name: "PO-1" }));
    await screen.findByLabelText(/^part$/i);
    fireEvent.change(screen.getByLabelText(/^part$/i), { target: { value: "P1" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByText(/1 scan · 1 unit queued/i)).toBeTruthy();
  });

  it("adding lookup did not change the TECHNICIAN scanner", async () => {
    render(<ScanWorkspace deps={technicianUser()} />);
    fireEvent.click(screen.getByRole("button", { name: /scan parts for my work order/i }));
    expect(await screen.findByLabelText(/part or work order code/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /scan a code/i })).toBeTruthy();
  });

  it("lookup and the technician scanner are separate surfaces, not one merged input", async () => {
    render(<ScanWorkspace deps={technicianUser()} />);
    fireEvent.click(screen.getByRole("button", { name: /look something up/i }));
    await screen.findByLabelText(/part code/i);
    expect(screen.queryByLabelText(/part or work order code/i)).toBeNull();
  });
});

// ────────────────────────────────────────────── where the operator left off (Phase N)

describe("Scan workspace (it remembers where you were)", () => {
  it("returns to the workflow the operator was in", () => {
    const { unmount } = render(<ScanWorkspace deps={warehouseUser()} />);
    fireEvent.click(screen.getByRole("button", { name: /look something up/i }));
    unmount();

    // A locked phone, a reclaimed tab: on the way back they should not have to re-choose.
    render(<ScanWorkspace deps={warehouseUser()} />);
    expect(screen.getByLabelText(/part code or barcode/i)).toBeTruthy();
  });

  it("leaving a workflow forgets it — going back to the list is a choice too", () => {
    const { unmount } = render(<ScanWorkspace deps={warehouseUser()} />);
    fireEvent.click(screen.getByRole("button", { name: /look something up/i }));
    fireEvent.click(screen.getByRole("button", { name: /all scanning workflows/i }));
    unmount();

    render(<ScanWorkspace deps={warehouseUser()} />);
    expect(screen.getByRole("button", { name: /look something up/i })).toBeTruthy();
  });

  it("remembers ONLY the choice — nothing scanned is resumed", () => {
    // Resuming a half-finished physical count from an hour ago would be worse than starting again:
    // the shelf has moved on and the operator has not.
    const rd = receivingDeps();
    const { unmount } = render(<ScanWorkspace deps={warehouseUser({ receivingDeps: rd })} />);
    fireEvent.click(screen.getByRole("button", { name: /receive a supplier purchase order/i }));
    unmount();

    render(<ScanWorkspace deps={warehouseUser({ receivingDeps: receivingDeps() })} />);
    // Back in receiving, but at its own start — no queue, no purchase order selected.
    expect(screen.queryByText(/scans ·/i)).toBeNull();
  });

  it("a STALE or tampered stored value routes nowhere", () => {
    window.sessionStorage.setItem("eos.scan.activeWorkflow", "PUT_AWAY_TO_MARS");
    render(<ScanWorkspace deps={warehouseUser()} />);
    expect(screen.getByRole("button", { name: /look something up/i })).toBeTruthy();
  });

  it("storage being unavailable does not stop the workspace rendering", () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() { throw new Error("blocked by the browser"); },
    });
    try {
      render(<ScanWorkspace deps={warehouseUser()} />);
      expect(screen.getByRole("button", { name: /look something up/i })).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
    }
  });
});
