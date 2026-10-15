// TECHNICIAN JOB CONTEXT (UAT P1-4).
//
// The Work Order detail page is mounted by everyone holding the service.workOrders surface — the
// assigned technician included. It used to take the customer and site from the CRM authority
// (useAccount -> getAccount, useLocation -> getAccountLocation), which refuses a technician (no
// customer.record.read), so the technician's OWN job read "Customer — not available to you".
//
// The governed Work Order read already carries the job context behind the per-record decision
// (customerName, locationName, location {street, city, state, postalCode, accessNotes}). These tests
// pin that the page renders it from there and ONLY from there:
//   - names and the site address render;
//   - no CRM read is issued from this page;
//   - a null name is "reference unavailable", never the raw id, never "not available to you";
//   - access notes are never rendered, even when the projection carries them (Owner D-TECH-1);
//   - no link into the customer record is offered.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

const state = {};
const crm = vi.hoisted(() => ({ callCrmApi: vi.fn(), useAccount: vi.fn(), useLocation: vi.fn() }));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ workOrderId: "wodocidaaaaaaaaaaaaa" }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to, ...rest }) => <a href={String(to)} {...rest}>{children}</a>,
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ role: "technician", user: { uid: "u-tech" } }) }));
vi.mock("../src/hooks/useWorkOrder", () => ({
  useWorkOrder: () => ({ workOrder: state.workOrder, loading: false, error: null, retry: vi.fn() }),
}));
// Spies, not stand-ins: if the page ever calls the CRM hooks or the CRM client again, these record it.
vi.mock("../src/hooks/useAccount", () => ({ useAccount: crm.useAccount }));
vi.mock("../src/hooks/useLocation", () => ({ useLocation: crm.useLocation }));
vi.mock("../src/services/crmApiClient.js", async (orig) => ({ ...(await orig()), callCrmApi: crm.callCrmApi }));
vi.mock("../src/hooks/useEquipment", () => ({ useEquipmentDoc: () => ({ equipment: null, loading: false, error: null }) }));
vi.mock("../src/hooks/useWorkOrderTechnicianDirectory.js", () => ({
  useWorkOrderTechnicianDirectory: () => ({ data: [{ id: "techdocidaaaaaaaaaaa", name: "J. Barela" }], loading: false, error: null }),
}));
vi.mock("../src/hooks/useWorkOrderTechnicians", () => ({
  useWorkOrderTechnicians: () => ({ data: [], loading: false, error: null, retry: () => {} }),
}));
vi.mock("../src/hooks/useMyWorkOrderCapabilities.js", () => ({
  useMyWorkOrderCapabilities: () => ({ status: "ready", has: () => false }),
}));
vi.mock("../src/hooks/useWorkOrderReadinessContext.js", () => ({ useWorkOrderReadinessContext: () => ({ context: null }) }));
vi.mock("../src/modules/workOrders/WorkOrderPartsPlanEditor", () => ({ default: () => null }));
vi.mock("../src/services/workOrderService", () => ({ transitionWorkOrder: vi.fn(), updateWorkOrderExecutionData: vi.fn() }));

import WorkOrderDetailPage from "../src/modules/workOrders/WorkOrderDetailPage.jsx";

const CUSTOMER_ID = "acctdocidaaaaaaaaaaa";
const LOCATION_ID = "locdocidaaaaaaaaaaaa";
const ACCESS_NOTES = "Gate code 4471 — back door";

// The adapter's shape (src/domain/workOrderAdapter.js): customerName/locationName on the record,
// the projection's location under siteLocation.
const projectedWo = (over = {}) => ({
  id: "wodocidaaaaaaaaaaaaa",
  woNumber: "WO-2026-000103",
  status: "SCHEDULED",
  type: "SERVICE_CALL",
  priority: 2,
  customerId: CUSTOMER_ID,
  customerName: "Harbor Grill (SAMPLE)",
  locationId: LOCATION_ID,
  locationName: "Main kitchen",
  siteLocation: { street: "1 Pier Rd", city: "Portsmouth", state: "NH", postalCode: "03801", accessNotes: ACCESS_NOTES },
  scheduledTechId: "techdocidaaaaaaaaaaa",
  complaint: "Walk-in cooler warm.",
  ...over,
});

function visibleText(root) {
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const parts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue);
  return parts.join("\n");
}

beforeEach(() => {
  state.workOrder = projectedWo();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the job context comes from the governed Work Order projection", () => {
  it("renders the customer name, site name and site address (postalCode -> zip)", () => {
    const { container } = render(<WorkOrderDetailPage />);
    const text = visibleText(container);
    expect(text).toContain("Harbor Grill (SAMPLE)");
    expect(text).toContain("Main kitchen");
    expect(text).toContain("1 Pier Rd, Portsmouth, NH, 03801");
  });

  it("makes NO CRM call — neither getAccount nor getAccountLocation, nor the CRM hooks", () => {
    render(<WorkOrderDetailPage />);
    expect(crm.callCrmApi).not.toHaveBeenCalled();
    expect(crm.useAccount).not.toHaveBeenCalled();
    expect(crm.useLocation).not.toHaveBeenCalled();
  });

  it("NEVER renders access notes, even when the projection carries them", () => {
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.textContent).not.toContain("Gate code");
    expect(container.textContent).not.toContain(ACCESS_NOTES);
    expect(container.textContent).not.toMatch(/access notes?:/i);
  });

  it("offers no link into the customer record", () => {
    const { container } = render(<WorkOrderDetailPage />);
    for (const a of container.querySelectorAll("a")) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/customer|account/i);
    }
  });

  it("never says 'not available to you' — that CRM-denied state is retired", () => {
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.textContent).not.toMatch(/not available to you/i);
  });
});

describe("a name the projection could not resolve", () => {
  it("null names with ids present read 'reference unavailable' and NEVER the raw id", () => {
    state.workOrder = projectedWo({ customerName: undefined, locationName: undefined, siteLocation: undefined });
    const { container } = render(<WorkOrderDetailPage />);
    const text = visibleText(container);
    expect(text).toContain("Customer — reference unavailable");
    expect(text).toContain("Site — reference unavailable");
    expect(text).not.toContain(CUSTOMER_ID);
    expect(text).not.toContain(LOCATION_ID);
    expect(text).not.toMatch(/not available to you/i);
    expect(crm.callCrmApi).not.toHaveBeenCalled();
  });

  it("an address with no parts renders no address line (never stray commas)", () => {
    state.workOrder = projectedWo({ siteLocation: { street: null, city: null, state: null, postalCode: null, accessNotes: ACCESS_NOTES } });
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.querySelector(".ns-rail__meta")).toBeNull();
    expect(container.textContent).not.toContain("Gate code");
  });
});
