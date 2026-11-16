// UAT RO-01 -- the Parts-family pages do not fire reads the server is certain to refuse (vitest + jsdom).
// Run: npx vitest run test/partsReadGates.test.jsx
//
// Codex recorded a background 403 on the Parts pages for a Parts-family persona. Cause (functions/src/eosOps/reorderLifecycleCommands.ts,
// partsReads.ts, catalogMaster/catalogHttp.ts), by persona (D:/eos-lanes/evidence/uat personas.csv + role-capability-grants.csv):
//   serviceTechnician  holds reorder.request.read but has a MOBILE scope only      -> readReorderQueue 403 OUTSIDE_OPERATIONAL_SCOPE;
//                      no reorder.request.create.manual                              -> listReorderWarehouseOptions 403;
//                      no inventory.manufacturer.read                                -> listManufacturers 403.
//   warehouseAssociate no reorder.request.read, no supplier.record.read              -> readReorderQueue / readMyAssignedReorders /
//                      listReorderWarehouseOptions / listSuppliers 403.
// Each page fired those on mount regardless. These tests pin that the page now asks only what the session says it may be told, that the
// person with the authority is unchanged, and that the absence is STATED rather than rendered as an empty list or "try again shortly".
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => { const searchParts = vi.fn(); return { searchParts, readPartsForView: (partIds) => searchParts({ partIds }), isCatalogReadRefused: () => false }; });
vi.mock("../src/data/partsCatalog", () => ({ PARTS_CATALOG: [], getCatalogItem: () => undefined }));
vi.mock("../src/hooks/useInventoryLedger", () => ({ useInventoryLedger: () => ({ healthEntries: [], loading: false, error: null }) }));

const calls = vi.hoisted(() => ({ byStatus: [], assigned: [], statuses: [], history: [], pending: [], warehouses: [], manufacturers: [], suppliers: [] }));
vi.mock("../src/hooks/useReorderRequests", () => {
  const base = { data: [], loading: false, error: null, hasMore: false, loadMore: () => {}, refresh: () => {} };
  return {
    useReorderRequests: (enabled) => { calls.pending.push(enabled); return base; },
    useReorderRequestsByStatus: (status, enabled) => { calls.byStatus.push(enabled); return base; },
    useMyAssignedReorderRequests: (status, enabled) => { calls.assigned.push(enabled); return base; },
    useReorderRequestsByStatuses: (statuses, enabled) => { calls.statuses.push(enabled); return base; },
    useReorderRequestsHistory: (args) => { calls.history.push(args.enabled); return base; },
    useReorderRequestById: () => base,
    fetchReorderRequestsHistoryPage: async () => ({ items: [], hasMore: false }),
  };
});
vi.mock("../src/hooks/useReorderWarehouseOptions", () => ({
  useReorderWarehouseOptions: (enabled) => { calls.warehouses.push(enabled); return { options: [], reason: null, loading: false, error: false }; },
}));
vi.mock("../src/hooks/useManufacturerCatalog", () => ({
  useManufacturerCatalog: (enabled) => { calls.manufacturers.push(enabled); return { loading: false, errorStatus: "denied", result: null }; },
}));
vi.mock("../src/hooks/useSuppliers", () => ({
  useSuppliers: (accessVersion, enabled) => { calls.suppliers.push(enabled); return { loading: false, error: null, suppliers: [], truncated: false }; },
}));
vi.mock("../src/hooks/usePurchaseOrdersByIds", () => ({ usePurchaseOrdersByIds: () => ({ purchaseOrdersById: {}, loading: false }) }));
vi.mock("../src/hooks/useGovernedEmployeeDirectory.js", () => ({
  useGovernedEmployeeDirectory: () => ({ byEmployeeId: new Map(), byUserId: new Map(), loading: false, error: null }),
}));
vi.mock("../src/domain/inventoryReorderRequests", () => ({ requestReorderForRecommendation: vi.fn(), getDisplayQty: (r) => r.requestedQty ?? 0 }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" }, role: null, operationalRoles: [] }) }));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({ hasUsageHistory: () => false }));
vi.mock("../src/shared/search/GlobalSearch", () => ({ default: () => null }));
vi.mock("../src/shared/ui/WorkspaceHeader", () => ({ default: () => null }));
vi.mock("../src/shared/ui/FilterBar", () => ({ default: () => null }));
vi.mock("../src/modules/operations/panels/InventoryHealthPanel", () => ({ default: () => null }));
vi.mock("../src/modules/receiving/MultiScanReceiving", () => ({ default: () => null }));
vi.mock("../src/modules/receiving/ReceiveAgainstPurchaseOrder", () => ({ default: () => null }));
vi.mock("../src/modules/receiving/AcquireExistingUnit", () => ({ default: () => null }));
vi.mock("../src/modules/receiving/RecentReceipts.jsx", () => ({ default: () => null }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useSearchParams: () => [new URLSearchParams(), () => {}], Link: ({ children }) => children };
});

import { searchParts } from "../src/services/partMasterQueries";
import { SessionAccessContext, NO_SESSION_ACCESS } from "../src/access/sessionAccess.js";
import { partsReadGates, REORDER_QUEUE_NOT_AVAILABLE_COPY } from "../src/access/partsReadGates.js";
import { RECEIVING_OUTCOME } from "../src/domain/receivingTransport.js";
import PartsList from "../src/modules/inventory/PartsList.jsx";
import Receiving from "../src/modules/inventory/Receiving.jsx";

// The capability / surface answers of the personas, from the UAT census (role-capability-grants.csv, personas.csv, experienceAuthority.ts).
const session = (held, surfaces) => ({
  eosSource: true,
  settled: true,
  holds: (key) => held.includes(key),
  grantsSurface: (key) => surfaces.includes(key),
  reload: () => {},
});
const SERVICE_TECHNICIAN = session(
  ["inventory.catalog.read", "inventory.transaction.read", "reorder.request.read"], // reorder.request.read, but a MOBILE scope only
  ["inventory.catalog", "inventory.balances"], // NOT inventory.reorderQueue
);
const WAREHOUSE_ASSOCIATE = session(
  ["inventory.catalog.read", "inventory.manufacturer.read", "inventory.transaction.read", "inventory.stock.receive", "receivingOrder.record.read", "supplier.purchaseOrder.read"],
  ["inventory.catalog", "receiving.checkIn"],
);
const PARTS_MANAGER = session(
  ["inventory.catalog.read", "inventory.manufacturer.read", "reorder.request.read", "reorder.request.create.manual", "reorder.request.assign"],
  ["inventory.catalog", "inventory.reorderQueue"],
);
const PARTS_ASSOCIATE = session(
  ["inventory.catalog.read", "inventory.manufacturer.read", "reorder.request.read", "reorder.request.create.manual", "supplier.record.read", "inventory.stock.receive"],
  ["inventory.catalog", "inventory.reorderQueue", "receiving.checkIn"],
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  for (const k of Object.keys(calls)) calls[k].length = 0;
});

const lastOf = (list) => list[list.length - 1];

describe("partsReadGates -- the pure answers", () => {
  it("where EOS is not the session source every read stays on (the legacy behaviour is unchanged)", () => {
    const all = { queue: true, myAssigned: true, settled: true, warehouseOptions: true, manufacturers: true, suppliers: true };
    expect(partsReadGates(NO_SESSION_ACCESS)).toEqual(all);
    expect(partsReadGates(undefined)).toEqual(all);
  });

  it("Service Technician: holds reorder.request.read but NOT the queue surface -- own assigned work yes, every refused read no", () => {
    expect(partsReadGates(SERVICE_TECHNICIAN)).toEqual({ queue: false, myAssigned: true, settled: true, warehouseOptions: false, manufacturers: false, suppliers: false });
  });

  it("Warehouse Associate: no queue, no reorder request, manufacturers yes, suppliers no", () => {
    expect(partsReadGates(WAREHOUSE_ASSOCIATE)).toEqual({ queue: false, myAssigned: false, settled: true, warehouseOptions: false, manufacturers: true, suppliers: false });
  });

  it("Parts Associate: every read is allowed", () => {
    expect(partsReadGates(PARTS_ASSOCIATE)).toEqual({ queue: true, myAssigned: true, settled: true, warehouseOptions: true, manufacturers: true, suppliers: true });
  });

  it("Parts Manager: full queue access is unchanged", () => {
    expect(partsReadGates(PARTS_MANAGER)).toMatchObject({ queue: true, myAssigned: true, warehouseOptions: true, manufacturers: true });
  });

  it("my-assigned is reorder.request.read ONLY, never the queue surface (MUTATION PROOF: the surface alone does not grant it, the capability alone does)", () => {
    expect(partsReadGates(session(["reorder.request.read"], [])).myAssigned).toBe(true);
    expect(partsReadGates(session([], ["inventory.reorderQueue"])).myAssigned).toBe(false);
  });

  it("settled is false until the EOS session answer arrives", () => {
    expect(partsReadGates({ ...session([], []), settled: false }).settled).toBe(false);
  });

  it("the queue answer is the SURFACE, not the bare capability (MUTATION PROOF: reorder.request.read alone must not allow it)", () => {
    expect(partsReadGates(session(["reorder.request.read"], [])).queue).toBe(false);
    expect(partsReadGates(session([], ["inventory.reorderQueue"])).queue).toBe(true);
  });
});

describe("Parts Catalog -- the reads it fires on mount", () => {
  const mount = async (access) => {
    searchParts.mockResolvedValue({ ok: true, parts: [], invalid: [] });
    render(
      <SessionAccessContext.Provider value={access}>
        <PartsList />
      </SessionAccessContext.Provider>,
    );
    await waitFor(() => expect(searchParts).toHaveBeenCalled());
  };

  it("a MOBILE-only Service Technician with reorder.request.read fires readMyAssignedReorders but NO queue, history, warehouse-option or Manufacturer read", async () => {
    await mount(SERVICE_TECHNICIAN);
    expect(lastOf(calls.pending)).toBe(false);
    expect(lastOf(calls.byStatus)).toBe(false);
    expect(lastOf(calls.assigned)).toBe(true); // the OWN reach: reorder.request.read only
    expect(lastOf(calls.statuses)).toBe(false);
    expect(lastOf(calls.history)).toBe(false);
    expect(lastOf(calls.warehouses)).toBe(false);
    expect(lastOf(calls.manufacturers)).toBe(false);
  });

  it("shows the technician their own My-assigned work, states the absence of the shared queues, and never renders them or a retry", async () => {
    await mount(SERVICE_TECHNICIAN);
    expect(screen.getByText(REORDER_QUEUE_NOT_AVAILABLE_COPY)).toBeTruthy();
    expect(screen.queryByText(/Parts Manager Queue/)).toBeNull();
    expect(screen.queryByText(/Team Work/)).toBeNull();
    // own work stays: Waiting and In Progress are read and rendered
    expect(screen.getAllByText(/Waiting/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/In Progress/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Try again shortly/)).toBeNull();
    expect(screen.queryByText(/Find by Exact Request ID/)).toBeNull();
    // and it does not say "no warehouses": it says the person cannot request a reorder at all
    expect(screen.queryByText(/No warehouses are available/)).toBeNull();
    expect(document.querySelector("[data-reorder-request-unavailable]")).toBeTruthy();
  });

  it("a Parts Associate (the queue surface, create.manual, manufacturer.read) fires every read and sees the queue panels", async () => {
    await mount(PARTS_ASSOCIATE);
    for (const list of [calls.pending, calls.byStatus, calls.assigned, calls.statuses, calls.history, calls.warehouses, calls.manufacturers]) {
      expect(lastOf(list)).toBe(true);
    }
    expect(screen.queryByText(REORDER_QUEUE_NOT_AVAILABLE_COPY)).toBeNull();
    expect(screen.getAllByText(/Parts Manager Queue/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Team Work/).length).toBeGreaterThan(0);
  });

  it("legacy (no EOS session): everything is fired exactly as before", async () => {
    await mount(NO_SESSION_ACCESS);
    for (const list of [calls.pending, calls.byStatus, calls.assigned, calls.statuses, calls.history, calls.warehouses, calls.manufacturers]) {
      expect(lastOf(list)).toBe(true);
    }
    expect(screen.getAllByText(/Parts Manager Queue/).length).toBeGreaterThan(0);
  });
});

describe("Parts Catalog -- full queue access and the settle gate", () => {
  const mount = async (access) => {
    searchParts.mockResolvedValue({ ok: true, parts: [], invalid: [] });
    render(<SessionAccessContext.Provider value={access}><PartsList /></SessionAccessContext.Provider>);
    await waitFor(() => expect(searchParts).toHaveBeenCalled());
  };

  it("a Parts Manager (queue surface) is unchanged: every read fires and every panel renders, with no absence note", async () => {
    await mount(PARTS_MANAGER);
    for (const list of [calls.pending, calls.byStatus, calls.assigned, calls.statuses, calls.history, calls.warehouses, calls.manufacturers]) expect(lastOf(list)).toBe(true);
    expect(screen.queryByText(REORDER_QUEUE_NOT_AVAILABLE_COPY)).toBeNull();
    expect(screen.getAllByText(/Parts Manager Queue/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Team Work/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Waiting/).length).toBeGreaterThan(0);
  });

  it("a Warehouse Associate (no reorder.request.read) fires no reorder read, has no own-work panels, and is told so", async () => {
    await mount(WAREHOUSE_ASSOCIATE);
    expect(lastOf(calls.assigned)).toBe(false);
    expect(lastOf(calls.byStatus)).toBe(false);
    expect(screen.getByText(REORDER_QUEUE_NOT_AVAILABLE_COPY)).toBeTruthy();
    expect(screen.queryByText(/No requests currently waiting on you/)).toBeNull();
  });

  it("before the EOS session answer arrives nothing is fired and the absence note does not flash", async () => {
    await mount({ ...session([], []), settled: false });
    expect(lastOf(calls.byStatus)).toBe(false);
    expect(lastOf(calls.assigned)).toBe(false);
    expect(screen.queryByText(REORDER_QUEUE_NOT_AVAILABLE_COPY)).toBeNull();
  });
});

describe("Receiving -- the reads it fires on mount", () => {
  const fetchReceivable = vi.fn();
  const mount = async (access) => {
    fetchReceivable.mockResolvedValue({ status: RECEIVING_OUTCOME.READY, purchaseOrders: [] });
    render(
      <SessionAccessContext.Provider value={access}>
        <Receiving deps={{ fetchReceivablePurchaseOrders: fetchReceivable }} />
      </SessionAccessContext.Provider>,
    );
    await waitFor(() => expect(fetchReceivable).toHaveBeenCalled());
  };

  it("a Warehouse Associate does not ask for the Reorder queue or the Supplier list, and is told the Reorder source is not theirs to read", async () => {
    await mount(WAREHOUSE_ASSOCIATE);
    expect(lastOf(calls.statuses)).toBe(false);
    expect(lastOf(calls.suppliers)).toBe(false);
    // the existing DENIED wording -- not "could not be loaded", not an empty list
    expect(await screen.findByText(/Reorder purchase orders awaiting receipt cannot be shown/)).toBeTruthy();
    expect(screen.getByText(/you are not authorized to read them/)).toBeTruthy();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it("a Parts Associate asks for both and sees no denial notice", async () => {
    await mount(PARTS_ASSOCIATE);
    expect(lastOf(calls.statuses)).toBe(true);
    expect(lastOf(calls.suppliers)).toBe(true);
    expect(screen.queryByText(/cannot be shown/)).toBeNull();
  });
});
