// UAT R2.2 PARTS-403 follow-up -- the REAL client, driven as a persona, records the /operations/inventory operations it sends (vitest + jsdom).
// Run: npx vitest run test/warehouseAssociateInventoryReads.test.jsx
//
// #2213 gated the Reorder queue / assigned / history / warehouse-option / Manufacturer / Supplier reads, and proved it with a suite that
// MOCKS the hooks, so it could only prove the reads it knew about. Codex then recorded one background 403 for the Warehouse Associate.
// This suite mocks NOTHING between the page and the wire except the Firebase-free token seam: the page's own hooks and services run, and
// every POST /operations/inventory is recorded and answered by a model of the server's per-operation gates (capability + REORDER_QUEUE
// scope), each cited to the function that applies it. The persona's capability set is DERIVED from the governed UAT manifest (#2202,
// docs/uat/data/personas.csv + role-capability-grants.csv: persona -> Roles -> role_capabilities), not hand-typed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../src/services/adminPolicyApiClient.js", async (orig) => ({
  ...(await orig()),
  policyApiBaseUrl: () => "https://eos.test",
  currentIdToken: async () => "test-token",
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" }, role: null, operationalRoles: [] }) }));
vi.mock("../src/services/partMasterQueries", () => {
  const part = { partId: "PRT-1001", name: "CANONICAL-PART", category: "Valves", stockingUnit: "each" };
  const searchParts = vi.fn(async () => ({ ok: true, parts: [part], invalid: [] }));
  return { searchParts, readPartsForView: async () => ({ ok: true, parts: [part], invalid: [] }), isCatalogReadRefused: () => false };
});
vi.mock("../src/data/partsCatalog", () => ({ PARTS_CATALOG: [{ sku: "PRT-1001", name: "STATIC", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }], getCatalogItem: () => undefined }));
vi.mock("../src/access/eosSessionSource.js", () => ({ EOS_SESSION_SOURCE: true }));
vi.mock("../src/hooks/useGovernedEmployeeDirectory.js", () => ({
  useGovernedEmployeeDirectory: () => ({ byEmployeeId: new Map(), byUserId: new Map(), loading: false, error: null }),
}));
// Other transports (the Catalog API for Manufacturer names, the Work Order route, the alias callable) are not /operations/inventory.
vi.mock("../src/hooks/useManufacturerCatalog", () => ({ useManufacturerCatalog: () => ({ loading: false, errorStatus: "denied", result: null }) }));
vi.mock("../src/hooks/usePartWorkOrderDemand", async () => {
  const actual = await vi.importActual("../src/hooks/usePartWorkOrderDemand");
  return { ...actual, usePartWorkOrderDemand: () => ({ status: actual.PART_WORK_ORDER_DEMAND_STATE.READY, rows: [], scannedCount: 0, totalOpenWorkOrders: 0 }) };
});
vi.mock("../src/hooks/usePartIdentifiers.js", () => ({ usePartIdentifiers: () => ({ status: "unavailable", identifiers: [] }) }));
vi.mock("../src/modules/receiving/MultiScanReceiving", () => ({ default: () => null }));
vi.mock("../src/modules/receiving/ReceiveAgainstPurchaseOrder", () => ({ default: () => null }));
vi.mock("../src/modules/receiving/AcquireExistingUnit", () => ({ default: () => null }));

import { SessionAccessContext } from "../src/access/sessionAccess.js";
import PartsList from "../src/modules/inventory/PartsList.jsx";
import PartDetail from "../src/modules/inventory/PartDetail.jsx";
import Receiving from "../src/modules/inventory/Receiving.jsx";

// ── the persona's authority, from the governed manifest ─────────────────────────────────────────────────────────────────────────────────
const UAT_DATA = resolve(__dirname, "../../docs/uat/data");
const rows = (file) => {
  const [head, ...lines] = readFileSync(resolve(UAT_DATA, file), "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));
};
const PERSONAS = rows("personas.csv");
const GRANTS = rows("role-capability-grants.csv");

/** Persona -> { held capability keys (stored grants of its global Roles), operational scope types }. */
export function personaAuthority(key) {
  const p = PERSONAS.find((r) => r.persona === key);
  if (!p) throw new Error(`no persona ${key} in docs/uat/data/personas.csv`);
  const roles = new Set(p.globalRoles.split("|").filter(Boolean));
  const held = new Set(GRANTS.filter((g) => roles.has(g.role) && g.source.startsWith("DB role_capabilities")).map((g) => g.capability));
  const scopes = new Set(p.operationalScopes.split("|").filter(Boolean).map((s) => s.split(":")[0]));
  return { held, scopes };
}

// ── the server's gates, per operation (functions/src/eosOps/*) ──────────────────────────────────────────────────────────────────────────
// [required capabilities (ALL), needs the REORDER_QUEUE scope?, the function that applies it]
const GATES = {
  resolveMyCapabilities: [[], false, "eosOpsHttp.ts resolveMyCapabilities (any signed-in principal)"],
  readReorderQueue: [["reorder.request.read"], true, "reorderLifecycleCommands.readReorderQueue: requireActor(REORDER_READ) + requireQueueReach"],
  readMyAssignedReorders: [["reorder.request.read"], false, "reorderLifecycleCommands.readMyAssignedReorders"],
  readMyReorderHistory: [["reorder.request.read"], false, "reorderLifecycleCommands.readMyReorderHistory"],
  readReorderRequest: [["reorder.request.read"], false, "reorderLifecycleCommands.readReorderRequest (then queue reach OR assignee)"],
  readReorderPurchaseOrders: [["reorder.request.read"], false, "reorderLifecycleCommands.readReorderPurchaseOrders"],
  listReorderWarehouseOptions: [["reorder.request.create.manual"], false, "reorderLifecycleCommands.listReorderWarehouseOptions"],
  listReorderAssignmentTargets: [["reorder.request.assign"], false, "reorderAssignmentAuthority.listReorderAssignmentTargets"],
  readInventoryOnHand: [["inventory.transaction.read"], false, "partsReads.readInventoryOnHand"],
  readInventoryMovements: [["inventory.transaction.read"], false, "partsReads.readInventoryMovements"],
  readPartBalance: [["inventory.transaction.read"], false, "partsReads.readPartBalance"],
  listReceipts: [["receivingOrder.record.read"], false, "partsReads.listReceipts"],
  listSuppliers: [["supplier.record.read"], false, "partsReads.listSuppliers"],
  listPartSupplierItems: [["inventory.supplierTerms.read"], false, "partSupplierTerms.listPartSupplierItems"],
  listLegacyInventoryActionNotes: [["inventory.action.read"], false, "legacyInventoryActionNotes.listLegacyInventoryActionNotes"],
  listReceivableSupplierPurchaseOrders: [[], false, "supplierPurchaseOrderReceiving.listReceivableSupplierPurchaseOrders (company reach only)"],
  listInventoryWarehouses: [[["warehouse.record.read", "inventory.transaction.read"]], false, "partsReads.listInventoryWarehouses"],
};
const RESULT = {
  resolveMyCapabilities: { capabilities: [] },
  readReorderQueue: [],
  readMyAssignedReorders: [],
  readMyReorderHistory: [],
  readReorderPurchaseOrders: [],
  listReorderWarehouseOptions: { options: [], reason: null },
  listReorderAssignmentTargets: { items: [] },
  readInventoryOnHand: { totals: [], scopedWarehouseIds: [] },
  readInventoryMovements: { items: [], scopedWarehouseIds: [] },
  readPartBalance: { partId: "PRT-1001", trackingMode: "NONE", scopedWarehouseIds: [], onHand: { state: "KNOWN", value: 0 }, reserved: { state: "KNOWN", value: 0 }, available: { state: "KNOWN", value: 0 }, onOrder: { state: "KNOWN", value: 0 }, byLocation: [] },
  listReceipts: { items: [] },
  listSuppliers: { items: [] },
  listPartSupplierItems: { partId: "PRT-1001", stockingUnit: "each", fieldAccess: {}, recordAccess: {}, items: [], supplierOptions: null },
  listLegacyInventoryActionNotes: { partId: "PRT-1001", archiveLoaded: true, items: [] },
  listReceivableSupplierPurchaseOrders: { purchaseOrders: [] },
  listInventoryWarehouses: { items: [] },
};

/** Install a fetch that records every /operations/inventory POST and answers it as the server would for `authority`. */
function installServer(authority) {
  const sent = [];
  const refused = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    if (!String(url).endsWith("/operations/inventory")) return new Response(JSON.stringify({ ok: false, code: "NOT_FOUND" }), { status: 404 });
    sent.push({ operation: body.operation, input: body.input });
    const gate = GATES[body.operation];
    if (!gate) throw new Error(`the harness has no server model for ${body.operation}: add it with the function that gates it`);
    const [needs, needsQueueScope] = gate;
    const missing = needs.find((k) => !(Array.isArray(k) ? k.some((x) => authority.held.has(x)) : authority.held.has(k)));
    const outsideScope = needsQueueScope && !authority.scopes.has("REORDER_QUEUE");
    if (missing || outsideScope) {
      refused.push(body.operation);
      return new Response(JSON.stringify({ ok: false, code: missing ? "CAPABILITY_MISSING" : "OUTSIDE_OPERATIONAL_SCOPE", message: "refused" }), { status: 403 });
    }
    return new Response(JSON.stringify({ ok: true, result: RESULT[body.operation] ?? {} }), { status: 200 });
  }));
  return { sent, refused, ops: () => sent.map((s) => s.operation) };
}

/** The session answer the shell hands every page (App.jsx sessionAccess): capabilities from resolveMyCapabilities, surfaces from the experience context. */
const sessionFor = (authority) => ({
  eosSource: true,
  settled: true,
  holds: (k) => authority.held.has(k),
  grantsSurface: (k) => (k === "inventory.reorderQueue" ? authority.held.has("reorder.request.read") && authority.scopes.has("REORDER_QUEUE") : true),
  reload: () => {},
});

const mountAt = (authority, path, element, route) =>
  render(
    <SessionAccessContext.Provider value={sessionFor(authority)}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </SessionAccessContext.Provider>,
  );

// Let every mount effect, and the requests they chain, finish.
const settle = async (server, quietMs = 60) => {
  let last = -1;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, quietMs));
    if (server.sent.length === last) return;
    last = server.sent.length;
  }
};

const PAGES = {
  "Parts Catalog": (a) => mountAt(a, "/inventory", <PartsList />, "/inventory"),
  "Part detail": (a) => mountAt(a, "/inventory/PRT-1001", <PartDetail hasCapability={(k) => a.held.has(k)} />, "/inventory/:partId"),
  Receiving: (a) => mountAt(a, "/inventory/receiving", <Receiving />, "/inventory/receiving"),
};

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });


import NotificationControl from "../src/shared/ui/NotificationControl.jsx";
import { NO_SESSION_ACCESS } from "../src/access/sessionAccess.js";
import { partsReadGates, supplierTermsReadable, PART_REORDER_STATUS_NOT_AVAILABLE_COPY } from "../src/access/partsReadGates.js";

const REFUSED_BY_PART_DETAIL = ["readReorderQueue", "readReorderRequest", "listPartSupplierItems"];
const WA = personaAuthority("warehouseAssociate");

describe("the Warehouse Associate's authority, derived from the governed manifest", () => {
  it("holds the stock / receipt reads it works with and NOT the Reorder, supplier or supplier-terms reads", () => {
    for (const k of ["inventory.transaction.read", "receivingOrder.record.read", "inventory.stock.receive", "inventory.action.read", "inventory.catalog.read"]) expect(WA.held.has(k)).toBe(true);
    for (const k of ["reorder.request.read", "reorder.request.create.manual", "reorder.request.assign", "supplier.record.read", "inventory.supplierTerms.read"]) expect(WA.held.has(k)).toBe(false);
    expect(WA.held.size).toBe(Number(PERSONAS.find((p) => p.persona === "warehouseAssociate").flatCaps)); // the derivation reproduces the manifest's own count
    expect(WA.scopes.has("REORDER_QUEUE")).toBe(false);
  });

  it("the pure gates: no queue, no own-assigned read, no supplier-terms read; a Parts Manager and the legacy path keep every read", () => {
    expect(partsReadGates(sessionFor(WA))).toMatchObject({ queue: false, myAssigned: false, suppliers: false, warehouseOptions: false });
    expect(supplierTermsReadable(sessionFor(WA))).toBe(false);
    expect(partsReadGates(sessionFor(personaAuthority("partsManager")))).toMatchObject({ queue: true, myAssigned: true });
    expect(supplierTermsReadable(sessionFor(personaAuthority("partsManager")))).toBe(true);
    expect(partsReadGates(NO_SESSION_ACCESS)).toMatchObject({ queue: true, myAssigned: true });
    expect(supplierTermsReadable(NO_SESSION_ACCESS)).toBe(true);
  });
});

describe("Warehouse Associate -- what the real client sends (the refused operation is never requested)", () => {
  it("Parts Catalog: only the stock reads it holds; nothing is refused", async () => {
    const server = installServer(WA);
    PAGES["Parts Catalog"](WA);
    await settle(server);
    expect(server.ops()).toContain("readInventoryOnHand");
    expect(server.refused).toEqual([]);
    for (const op of REFUSED_BY_PART_DETAIL) expect(server.ops()).not.toContain(op);
  });

  it("Part detail: no readReorderQueue and no listPartSupplierItems; the stock reads and the archived-notes read it holds are still sent; nothing is refused", async () => {
    const server = installServer(WA);
    PAGES["Part detail"](WA);
    await screen.findByText("CANONICAL-PART");
    await settle(server);
    expect(server.ops()).toEqual(expect.arrayContaining(["readInventoryOnHand", "readInventoryMovements", "listLegacyInventoryActionNotes"]));
    for (const op of REFUSED_BY_PART_DETAIL) expect(server.ops()).not.toContain(op);
    expect(server.refused).toEqual([]);
  });

  it("Part detail STATES both absences: the Reorder status is not shown to them, supplier terms are a denial -- never 'could not be loaded', never an empty list", async () => {
    const server = installServer(WA);
    PAGES["Part detail"](WA);
    await screen.findByText("CANONICAL-PART");
    await settle(server);
    expect(screen.getByText(PART_REORDER_STATUS_NOT_AVAILABLE_COPY)).toBeTruthy();
    expect(screen.getByText(/Supplier terms are not shown: reading them needs the supplier-terms read permission/)).toBeTruthy();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
    expect(screen.queryByText(/No supplier terms are recorded/)).toBeNull();
    // Request Reorder is withheld while the person cannot see whether a request is already open (fail closed, as it was on the refusal).
    expect(screen.queryByRole("button", { name: "Request Reorder" })).toBeNull();
  });

  it("Part detail opened from a Reorder link (?requestId=): readReorderRequest is not sent either", async () => {
    const server = installServer(WA);
    mountAt(WA, "/inventory/PRT-1001?requestId=RR-1", <PartDetail hasCapability={(k) => WA.held.has(k)} />, "/inventory/:partId");
    await screen.findByText("CANONICAL-PART");
    await settle(server);
    expect(server.ops()).not.toContain("readReorderRequest");
    expect(server.refused).toEqual([]);
    expect(screen.queryByText(/does not belong to this part|could not be found/)).toBeNull();
  });

  it("Receiving: nothing is refused", async () => {
    const server = installServer(WA);
    PAGES.Receiving(WA);
    await settle(server);
    expect(server.ops()).toEqual(expect.arrayContaining(["listReceivableSupplierPurchaseOrders", "listReceipts"]));
    expect(server.refused).toEqual([]);
  });

  it("the shell's notification bell (mounted on every landing) sends nothing and renders nothing", async () => {
    const server = installServer(WA);
    const { container } = render(
      <SessionAccessContext.Provider value={sessionFor(WA)}><MemoryRouter><NotificationControl /></MemoryRouter></SessionAccessContext.Provider>,
    );
    await settle(server);
    expect(server.ops()).toEqual([]);
    expect(container.textContent).toBe("");
  });

  it("before the session answer arrives nothing refusable is sent and no absence is claimed", async () => {
    const server = installServer(WA);
    const unsettled = { ...sessionFor(WA), settled: false, holds: () => false, grantsSurface: () => false };
    render(
      <SessionAccessContext.Provider value={unsettled}>
        <MemoryRouter initialEntries={["/inventory/PRT-1001"]}>
          <Routes><Route path="/inventory/:partId" element={<PartDetail hasCapability={() => false} />} /></Routes>
        </MemoryRouter>
      </SessionAccessContext.Provider>,
    );
    await screen.findByText("CANONICAL-PART");
    await settle(server);
    for (const op of REFUSED_BY_PART_DETAIL) expect(server.ops()).not.toContain(op);
    expect(screen.queryByText(PART_REORDER_STATUS_NOT_AVAILABLE_COPY)).toBeNull();
    expect(screen.queryByText(/Supplier terms are not shown/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Request Reorder" })).toBeNull();
  });
});

describe("roles the server allows are unchanged -- the reads still fire and render", () => {
  it("Parts Manager (reorder.request.read + REORDER_QUEUE scope + supplierTerms.read): Part detail sends the Part's Reorder read AND the supplier-terms read, none refused, no absence copy", async () => {
    const pm = personaAuthority("partsManager");
    const server = installServer(pm);
    PAGES["Part detail"](pm);
    await screen.findByText("CANONICAL-PART");
    await settle(server);
    expect(server.sent.filter((s) => s.operation === "readReorderQueue" && s.input?.partId === "PRT-1001")).toHaveLength(1);
    expect(server.ops()).toContain("listPartSupplierItems");
    expect(server.refused).toEqual([]);
    expect(screen.queryByText(PART_REORDER_STATUS_NOT_AVAILABLE_COPY)).toBeNull();
    expect(screen.queryByText(/Supplier terms are not shown/)).toBeNull();
    expect(screen.getByText(/No supplier terms are recorded for/)).toBeTruthy(); // the read answered, and is rendered
    expect(screen.getByRole("button", { name: "Request Reorder" })).toBeTruthy();
  });

  it("Parts Manager by Reorder link: readReorderRequest is sent", async () => {
    const pm = personaAuthority("partsManager");
    const server = installServer(pm);
    mountAt(pm, "/inventory/PRT-1001?requestId=RR-1", <PartDetail hasCapability={(k) => pm.held.has(k)} />, "/inventory/:partId");
    await screen.findByText("CANONICAL-PART");
    await settle(server);
    expect(server.ops()).toContain("readReorderRequest");
  });

  it("Parts Associate (queue scope, no supplier-terms key): keeps the Reorder read, does not send the supplier-terms read it cannot make", async () => {
    const pa = personaAuthority("partsAssociate");
    const server = installServer(pa);
    PAGES["Part detail"](pa);
    await screen.findByText("CANONICAL-PART");
    await settle(server);
    expect(server.ops()).toContain("readReorderQueue");
    expect(server.ops()).not.toContain("listPartSupplierItems");
    expect(server.refused).not.toContain("readReorderQueue");
    expect(screen.getByText(/Supplier terms are not shown/)).toBeTruthy();
  });

  it("legacy (no EOS session): both reads are sent exactly as before", async () => {
    const pm = personaAuthority("partsManager");
    const server = installServer(pm);
    render(
      <SessionAccessContext.Provider value={NO_SESSION_ACCESS}>
        <MemoryRouter initialEntries={["/inventory/PRT-1001"]}>
          <Routes><Route path="/inventory/:partId" element={<PartDetail hasCapability={() => true} />} /></Routes>
        </MemoryRouter>
      </SessionAccessContext.Provider>,
    );
    await screen.findByText("CANONICAL-PART");
    await settle(server);
    expect(server.ops()).toEqual(expect.arrayContaining(["readReorderQueue", "listPartSupplierItems"]));
  });
});
