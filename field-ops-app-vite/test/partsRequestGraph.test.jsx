// THE CI GUARD FOR THE ACCESS MAP: the Parts pages ask the server only what the session may be told (vitest + jsdom).
// Run: npx vitest run test/partsRequestGraph.test.jsx
//
// The suites before this one mocked the read hooks, the catalog / alias / employee / work-order transports, or the session itself, so a read the
// server was certain to refuse (listEmployees, listWorkOrders, listPartAliases, the archived notes) could never be recorded. Here NOTHING between the
// pages and the wire is mocked except the token seam, the readiness flags (ON, as in nonprod), the receiving workflow components and the part
// catalog's own fixture rows. The session is the REAL capability feed (resolveMyCapabilities) composed as App.jsx composes it, and every request
// to any EOS route is recorded and answered by the generated access map (access/operationAccess.generated.js) -- which functions/test/
// operationAccessMap.test.mjs proves is what the commands themselves apply.
//
// It fails when:
//   * the client sends an operation that is NOT in the access map (a new read added without a row, i.e. without a gate);
//   * the client sends an operation the persona's session cannot be told (a read that bypassed the gate), on any Parts page, in any order of
//     navigation; or asks a gated read before the session answered;
//   * a read the persona IS authorised for is no longer sent (the page lost a panel it is allowed to show).
// Personas' authority is DERIVED from the governed UAT manifest (docs/uat/data/personas.csv + role-capability-grants.csv), not hand-typed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef } from "react";

vi.mock("../src/services/adminPolicyApiClient.js", async (orig) => ({
  ...(await orig()),
  policyApiBaseUrl: () => "https://eos.test",
  currentIdToken: async () => "test-token",
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" }, role: null, operationalRoles: [] }) }));
vi.mock("../src/access/eosSessionSource.js", () => ({ EOS_SESSION_SOURCE: true }));
// Nonprod has these ON; the readiness flags are the only configuration this suite sets.
vi.mock("../src/config/partIdentifierReadiness.js", async (o) => ({ ...(await o()), PART_IDENTIFIER_TRANSPORT_READY: true }));
vi.mock("../src/config/inventoryBalanceReadiness.js", async (o) => ({ ...(await o()), INVENTORY_BALANCE_READ_READY: true }));
vi.mock("../src/config/receivingReadiness.js", async (o) => ({ ...(await o()), RECEIVING_TRANSPORT_READY: true }));
vi.mock("../src/config/partMasterWriteReadiness.js", async (o) => ({ ...(await o()), PART_MASTER_WRITE_READY: true }));
vi.mock("../src/config/workOrderReadinessContextReadiness.js", async (o) => ({ ...(await o()), WORK_ORDER_READINESS_CONTEXT_READY: true }));
// Workflow components that only mount once a row is opened; they make no read on a page load.
vi.mock("../src/modules/receiving/MultiScanReceiving", () => ({ default: () => null }));
vi.mock("../src/modules/receiving/ReceiveAgainstPurchaseOrder", () => ({ default: () => null }));
vi.mock("../src/modules/receiving/AcquireExistingUnit", () => ({ default: () => null }));

import { OPERATION_ACCESS } from "../src/access/operationAccess.generated.js";
import { SessionAccessContext } from "../src/access/sessionAccess.js";
import { useEosReportCapabilities } from "../src/access/useEosCapabilityFeed.js";
import { resetGovernedEmployeeDirectory } from "../src/hooks/useGovernedEmployeeDirectory.js";
import PartsList from "../src/modules/inventory/PartsList.jsx";
import PartDetail from "../src/modules/inventory/PartDetail.jsx";
import Receiving from "../src/modules/inventory/Receiving.jsx";

// ── persona authority, from the governed manifest ───────────────────────────────────────────────────────────────────────────────────────
const UAT_DATA = resolve(__dirname, "../../docs/uat/data");
const rows = (file) => {
  const [head, ...lines] = readFileSync(resolve(UAT_DATA, file), "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));
};
const PERSONA_ROWS = rows("personas.csv");
const GRANTS = rows("role-capability-grants.csv");
function personaAuthority(key) {
  const p = PERSONA_ROWS.find((r) => r.persona === key);
  if (!p) throw new Error(`no persona ${key} in docs/uat/data/personas.csv`);
  const roles = new Set(p.globalRoles.split("|").filter(Boolean));
  const held = new Set(GRANTS.filter((g) => roles.has(g.role) && g.source.startsWith("DB role_capabilities")).map((g) => g.capability));
  const scopes = new Set(p.operationalScopes.split("|").filter(Boolean).map((s) => s.split(":")[0]));
  return { key, held, scopes };
}
// The four Parts personas, plus the two edges: a person with the catalog door and nothing else, and a Service Technician.
const AUTHORITIES = [
  personaAuthority("warehouseAssociate"),
  personaAuthority("partsAssociate"),
  personaAuthority("partsManager"),
  personaAuthority("warehouseManager"),
  personaAuthority("serviceTechnician"),
  { key: "catalogDoorOnly", held: new Set(["inventory.catalog.read"]), scopes: new Set() },
];

// ── the server, as the generated map states it ──────────────────────────────────────────────────────────────────────────────────────────
const surfaceGranted = (a, surface) => (surface === "inventory.reorderQueue" ? a.held.has("reorder.request.read") && a.scopes.has("REORDER_QUEUE") : a.held.has("inventory.stock.receive"));
function mayAsk(a, operation) {
  const row = OPERATION_ACCESS[operation];
  if (row.surface) return surfaceGranted(a, row.surface);
  return row.allOf.every((k) => a.held.has(k)) && (!row.anyOf || row.anyOf.some((k) => a.held.has(k)));
}

const PART = { id: "PRT-1001", partId: "PRT-1001", internalPartNumber: "PRT-1001", name: "CANONICAL-PART", category: "Valves", stockingUnit: "EACH", status: "ACTIVE", controlType: "STANDARD", stockingClass: "STOCKED", version: 1 };
const RESULT = {
  searchParts: { parts: [PART], nextCursor: null },
  readPartsByIds: [PART],
  readReorderQueue: [],
  readMyAssignedReorders: [],
  listReorderWarehouseOptions: { options: [], reason: null },
  readInventoryOnHand: { totals: [], scopedWarehouseIds: [] },
  readInventoryMovements: { items: [], scopedWarehouseIds: [] },
  readPartBalance: { partId: "PRT-1001", trackingMode: "NONE", scopedWarehouseIds: [], onHand: { state: "KNOWN", value: 0 }, reserved: { state: "KNOWN", value: 0 }, available: { state: "KNOWN", value: 0 }, onOrder: { state: "KNOWN", value: 0 }, byLocation: [] },
  listReceipts: { items: [] },
  listSuppliers: { items: [] },
  listPartSupplierItems: { partId: "PRT-1001", stockingUnit: "each", fieldAccess: {}, recordAccess: {}, items: [], supplierOptions: null },
  listLegacyInventoryActionNotes: { partId: "PRT-1001", archiveLoaded: true, items: [] },
  listReceivableSupplierPurchaseOrders: { purchaseOrders: [] },
  listInventoryWarehouses: { items: [] },
  listPartAliases: { aliases: [], truncated: false },
  listManufacturers: { items: [], truncated: false },
  listWorkOrders: { items: [], truncated: false },
  listEmployees: { items: [], nextCursor: null },
};

function installServer(authority) {
  const sent = [];
  let capabilitiesAnswered = false;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const operation = body.operation;
    sent.push({ operation, path: new URL(url).pathname, afterSession: capabilitiesAnswered });
    if (operation === "resolveMyCapabilities") {
      capabilitiesAnswered = true;
      return new Response(JSON.stringify({ ok: true, result: { capabilities: [...authority.held] } }), { status: 200 });
    }
    if (!OPERATION_ACCESS[operation]) return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    if (!mayAsk(authority, operation)) {
      return new Response(JSON.stringify({ ok: false, code: "CAPABILITY_MISSING", message: "refused" }), { status: 403 });
    }
    return new Response(JSON.stringify({ ok: true, result: RESULT[operation] ?? {} }), { status: 200 });
  }));
  return sent;
}

// ── the shell: the real capability feed, composed as App.jsx composes the session ───────────────────────────────────────────────────────────
let navigate;
function Shell({ authority }) {
  const user = useMemo(() => ({ uid: "u1" }), []);
  const feed = useEosReportCapabilities(user);
  const session = useMemo(() => ({
    eosSource: true,
    settled: feed.feedStatus === "ready" || feed.feedStatus === "failed",
    holds: feed.hasEosKey,
    // The experience context arrives AFTER the capability feed in the app, so a surface is never granted before the session has answered.
    grantsSurface: (key) => feed.feedStatus === "ready" && surfaceGranted(authority, key),
    reload: feed.reload,
  }), [feed, authority]);
  const location = useLocation();
  navigate = useNavigate();
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } feed.reload(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SessionAccessContext.Provider value={session}>
      <Routes>
        <Route path="/inventory" element={<PartsList />} />
        <Route path="/inventory/receiving" element={<Receiving />} />
        <Route path="/inventory/:partId" element={<PartDetail hasCapability={feed.hasCapability} />} />
      </Routes>
    </SessionAccessContext.Provider>
  );
}

// The pages' own DOOR reads: the route mounts a Parts page only for a session that holds inventory.catalog.read (navigation is decided from the
// experience context), so these are asked on mount by design and are not "optional reads". Every other gated read waits for the session.
const DOOR_READS = new Set(["searchParts", "readPartsByIds"]);

const QUIET_MS = 120;
async function settle(sent) {
  let last = -1;
  for (let i = 0; i < 60; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, QUIET_MS)); });
    if (sent.length === last) return;
    last = sent.length;
  }
}

const WALK = [
  ["Parts Catalog", "/inventory"],
  ["Part detail", "/inventory/PRT-1001"],
  ["Part detail with requestId", "/inventory/PRT-1001?requestId=RR-1"],
  ["Receiving", "/inventory/receiving"],
  ["Parts Catalog again", "/inventory"],
  ["Part detail again", "/inventory/PRT-1001"],
];

// What each page asks when the session may be told: the two-sided half of the guard.
const PART_DETAIL_READS = ["readInventoryOnHand", "readInventoryMovements", "readPartBalance", "listPartAliases", "listLegacyInventoryActionNotes", "listWorkOrders", "listPartSupplierItems"];

// What Receiving asks when the session may be told: receipts, the warehouse labels that name them, the receivable POs and the Supplier names.
const RECEIVING_READS = ["listReceipts", "listInventoryWarehouses", "listReceivableSupplierPurchaseOrders", "listSuppliers"];

beforeEach(() => { vi.unstubAllGlobals(); resetGovernedEmployeeDirectory(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the Parts pages ask only what the session may be told (access map)", () => {
  for (const authority of AUTHORITIES) {
    it(`${authority.key}: Catalog, Part detail, ?requestId=, Receiving -- every request is mapped, authorised and after the session answered`, async () => {
      const sent = installServer(authority);
      render(<MemoryRouter initialEntries={["/inventory"]}><Shell authority={authority} /></MemoryRouter>);
      await settle(sent);
      let receivingFrom = 0;
      let receivingTo = 0;
      for (const [, path] of WALK.slice(1)) {
        if (path === "/inventory/receiving") receivingFrom = sent.length;
        await act(async () => { navigate(path); });
        await settle(sent);
        if (path === "/inventory/receiving") receivingTo = sent.length;
      }
      await act(async () => { window.dispatchEvent(new Event("focus")); });
      await settle(sent);

      const operations = sent.map((s) => s.operation);
      const unmapped = [...new Set(operations.filter((o) => !OPERATION_ACCESS[o]))];
      expect(unmapped, "an operation the client sends has no row in the access map -- add it to functions/src/eosOps/operationAccessMap.ts").toEqual([]);

      const refusedAsked = [...new Set(operations.filter((o) => !mayAsk(authority, o)))];
      expect(refusedAsked, "the page asked a read the session cannot be told (it bypassed the gate)").toEqual([]);

      const early = sent.filter((s) => s.operation !== "resolveMyCapabilities" && !s.afterSession && !DOOR_READS.has(s.operation) && OPERATION_ACCESS[s.operation].allOf.length > 0);
      expect(early.map((s) => s.operation), "a gated read was asked before the session answered").toEqual([]);

      // Authorised -> unchanged: Part detail still asks every read this person may be told.
      const askedOnDetail = new Set(operations);
      for (const op of PART_DETAIL_READS) {
        if (mayAsk(authority, op) && authority.held.has("inventory.catalog.read")) {
          expect(askedOnDetail.has(op), `${authority.key} is authorised for ${op} but the page no longer asks it`).toBe(true);
        } else {
          expect(askedOnDetail.has(op), `${authority.key} is not authorised for ${op} but the page asked it`).toBe(false);
        }
      }

      // Authorised -> unchanged, on Receiving too: the reads asked while Receiving was the page are exactly those this person may be told.
      const askedOnReceiving = new Set(sent.slice(receivingFrom, receivingTo).map((s) => s.operation));
      for (const op of RECEIVING_READS) {
        expect(askedOnReceiving.has(op), `${authority.key}: Receiving ${mayAsk(authority, op) ? "no longer asks" : "asked"} ${op}`).toBe(mayAsk(authority, op));
      }
    }, 120_000);
  }
});
