// "EDIT PARTS PLAN" IS OFFERED FROM THE EOS WORK ORDER AUTHORITY, NOT FROM FIREBASE.
//
// Firebase exit (O-1) / EOS Core authority (O-2, DECISIONS #234): WorkOrderDetailPage used to gate the
// parts-plan editor on a Firestore users/{uid} listener plus the resolveEffectiveAccessCallable feed.
// It now reads the caller's own Work Order capabilities from the EOS API (readMyWorkOrderCapabilities)
// -- the same PostgreSQL-resolved set the setWorkOrderPartsPlan command re-checks server-side.
//
// This renders the REAL page and the REAL editor with only the transport mocked, and drives it with
// the REAL wrapper shape workOrderApiClient.call returns ({ ok, operation, result } / { ok:false, code }),
// so a contract drift between the hook and the server answer fails here, not on screen.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const state = {};

vi.mock("react-router-dom", () => ({
  useParams: () => ({ workOrderId: "wo-1" }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to, ...rest }) => <a href={String(to)} {...rest}>{children}</a>,
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ role: "admin", user: { uid: "u1" } }) }));
vi.mock("../src/hooks/useWorkOrder", () => ({
  useWorkOrder: () => ({ workOrder: state.workOrder, loading: false, error: null, retry: vi.fn() }),
}));
vi.mock("../src/hooks/useEquipment", () => ({ useEquipmentDoc: () => ({ equipment: null, loading: false, error: null }) }));
vi.mock("../src/hooks/useWorkOrderTechnicianDirectory.js", () => ({
  useWorkOrderTechnicianDirectory: () => ({ data: [], loading: false, error: null }),
}));
vi.mock("../src/hooks/useWorkOrderTechnicians", () => ({
  useWorkOrderTechnicians: () => ({ data: [], loading: false, error: null, retry: () => {} }),
}));
vi.mock("../src/hooks/useWorkOrderReadinessContext.js", () => ({ useWorkOrderReadinessContext: () => ({ context: null }) }));
vi.mock("../src/services/workOrderService", () => ({
  transitionWorkOrder: vi.fn(), updateWorkOrderExecutionData: vi.fn(), setWorkOrderPartsPlan: vi.fn(),
}));
// Unrelated to this gate (it issues its own scheduling-link reads); kept out so the suite isolates the gate.
vi.mock("../src/modules/workOrders/CustomerSchedulingLinkPanel.jsx", () => ({ default: () => null }));
// The ONLY seam this suite controls: the EOS Work Order transport. Real exports are kept; only the
// client's call is replaced, and it answers ONLY the capability read (anything else is unavailable).
vi.mock("../src/services/workOrderApiClient.js", async (importOriginal) => ({
  ...(await importOriginal()),
  workOrderApiClient: {
    call: (operation, input) => (operation === "readMyWorkOrderCapabilities"
      ? state.call(operation, input)
      : Promise.resolve({ ok: false, code: "UNAVAILABLE" })),
  },
}));

import WorkOrderDetailPage from "../src/modules/workOrders/WorkOrderDetailPage.jsx";

const workOrder = {
  id: "wo-1",
  woNumber: "WO-2026-000901",
  status: "DISPATCHED",
  type: "SERVICE_CALL",
  priority: 2,
  customerName: "Desert Sun Beverage Co.",
  locationName: "Broadway Plant",
  complaint: "Barrel temperature climbing.",
  inventorySnapshot: [{ partId: "X49463-3", sku: "X49463-3", name: "Scraper Blade Kit", qtyPlanned: 2 }],
};

beforeEach(() => {
  state.workOrder = { ...workOrder };
  state.calls = [];
});
afterEach(cleanup);

function answer(response) {
  state.call = (operation, input) => {
    state.calls.push({ operation, input });
    return response;
  };
}

const EDIT = /edit parts plan/i;
const NOT_ENABLED = /parts planning is not yet enabled for your role/i;
const CHECKING = /checking parts-planning access/i;

describe("Edit parts plan follows readMyWorkOrderCapabilities", () => {
  it("OFFERS the editor when the EOS authority returns workOrder.parts.plan", async () => {
    answer({ ok: true, operation: "readMyWorkOrderCapabilities", result: { capabilities: ["workOrder.parts.plan", "workOrder.record.read"] } });
    render(<WorkOrderDetailPage />);
    expect(await screen.findByRole("button", { name: EDIT })).toBeTruthy();
    expect(screen.queryByText(NOT_ENABLED)).toBeNull();
    // It asked the EOS Work Order authority, with no input, exactly the read the server defines.
    expect(state.calls.some((c) => c.operation === "readMyWorkOrderCapabilities")).toBe(true);
  });

  it("does NOT offer it when the caller holds other Work Order capabilities but not this one", async () => {
    answer({ ok: true, operation: "readMyWorkOrderCapabilities", result: { capabilities: ["workOrder.record.read"] } });
    render(<WorkOrderDetailPage />);
    expect(await screen.findByText(NOT_ENABLED)).toBeTruthy();
    expect(screen.queryByRole("button", { name: EDIT })).toBeNull();
  });

  it("FAILS CLOSED on a refusal from the EOS API (never turns a refusal into an offer)", async () => {
    answer({ ok: false, code: "FORBIDDEN", message: "refused" });
    render(<WorkOrderDetailPage />);
    expect(await screen.findByText(NOT_ENABLED)).toBeTruthy();
    expect(screen.queryByRole("button", { name: EDIT })).toBeNull();
  });

  it("shows the resolving copy, not the editor, while the read is pending", () => {
    answer(new Promise(() => {}));
    render(<WorkOrderDetailPage />);
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByRole("button", { name: EDIT })).toBeNull();
  });
});

describe("no Firebase on this gate's path", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = (rel) => readFileSync(path.resolve(here, "../src", rel), "utf8");

  it("the page and the capability hook import no Firebase module and no effective-access callable", () => {
    for (const rel of ["modules/workOrders/WorkOrderDetailPage.jsx", "hooks/useMyWorkOrderCapabilities.js"]) {
      const text = src(rel);
      expect(text, rel).not.toMatch(/from\s+["']firebase\//);
      expect(text, rel).not.toMatch(/firebase\/firebase/);
      expect(text, rel).not.toMatch(/resolveEffectiveAccess/);
    }
  });
});
