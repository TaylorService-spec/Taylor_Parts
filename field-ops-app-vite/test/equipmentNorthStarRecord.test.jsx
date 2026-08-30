// Equipment North Star P1v2.1 — the RECORD composition, at the render (vitest + jsdom).
//
// The projection suite proves what the derivation layer may and may not say. What only a render can
// prove is that the page actually uses it — that the identity header reaches the screen, that the
// warranty date is the recorded one and carries no judgment beside it, that a failed Customer or
// Location read is not presented as a known absence, and that the lifecycle actions are still
// disabled with their reason after the shell was replaced.
//
// Every hook is mocked (no Firebase, no network) so each state can be driven directly.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/hooks/useEquipment", () => ({
  useEquipmentDoc: vi.fn(),
  useWorkOrdersForEquipment: vi.fn(),
}));
vi.mock("../src/hooks/useAccount", () => ({ useAccount: vi.fn() }));
vi.mock("../src/hooks/useLocationsForAccount", () => ({ useLocationsForAccount: vi.fn() }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useParams: () => ({ equipmentId: "eq_8Xy2QrT" }) };
});

import { useEquipmentDoc, useWorkOrdersForEquipment } from "../src/hooks/useEquipment";
import { useAccount } from "../src/hooks/useAccount";
import { useLocationsForAccount } from "../src/hooks/useLocationsForAccount";
import EquipmentDetail from "../src/modules/equipment/EquipmentDetail.jsx";

const EQUIPMENT = {
  id: "eq_8Xy2QrT",
  name: "Soft Serve Freezer 2",
  status: "ACTIVE",
  manufacturer: "Taylor",
  model: "C712",
  serialNumber: "K1122873",
  accountId: "acct_desert_sun",
  locationId: "loc_broadway",
  warrantyExpiresDate: "2024-03-14",
  assetTag: null,
  notes: null,
};

function stub({ equipment = EQUIPMENT, account = {}, locations = {} } = {}) {
  useEquipmentDoc.mockReturnValue({ equipment, loading: false, error: null });
  useWorkOrdersForEquipment.mockReturnValue({ data: [], loading: false, error: null });
  useAccount.mockReturnValue({
    account: { id: "acct_desert_sun", name: "Desert Sun" }, loading: false, error: null, retry: vi.fn(), ...account,
  });
  useLocationsForAccount.mockReturnValue({
    data: [{ id: "loc_broadway", accountId: "acct_desert_sun", name: "Broadway Plant" }],
    loading: false, error: null, retry: vi.fn(), ...locations,
  });
}

const renderRecord = () => render(<MemoryRouter><EquipmentDetail /></MemoryRouter>);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ═════════════════════════════════ 1c — the identity header

describe("the record identity", () => {
  it("titles the page with the NAME and states the status in words", () => {
    stub();
    renderRecord();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Soft Serve Freezer 2");
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
  });

  it("NEVER renders the document id as content, anywhere on the page", () => {
    stub();
    const { container } = renderRecord();
    expect(container.textContent).not.toContain("eq_8Xy2QrT");
    expect(container.textContent).not.toContain("acct_desert_sun");
    expect(container.textContent).not.toContain("loc_broadway");
  });

  it("a unit with no name renders the truthful generic name, not the key", () => {
    stub({ equipment: { ...EQUIPMENT, name: null } });
    const { container } = renderRecord();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Unnamed equipment");
    expect(container.textContent).not.toContain("eq_8Xy2QrT");
  });

  it("states the record's state ONCE — the header owns it, the field grid does not repeat it", () => {
    stub();
    const { container } = renderRecord();
    // The INVENTORY-CONTROL panel legitimately has a "Status" row of its own: it is a different
    // fact about a different axis (D-5), not a second rendering of the record's ACTIVE/INACTIVE/
    // RETIRED state. Scoped out rather than counted, so this test cannot pass by accident.
    const inventoryControl = container.querySelector("[data-inventory-control-section]");
    const statusLabels = [...container.querySelectorAll("dt, th, .fo-field-label")]
      .filter((el) => !inventoryControl?.contains(el))
      .filter((el) => /^status$/i.test(el.textContent.trim()));
    expect(statusLabels).toHaveLength(0);
    // And the record's own state is stated exactly once, in the header.
    expect(screen.getAllByText("Active")).toHaveLength(1);
  });

  it("carries exactly ONE h1 — the shell it replaced would have made two", () => {
    stub();
    renderRecord();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

// ═════════════════════════════════ EQ-D2 — warranty as recorded, and nothing more

describe("Warranty Expires", () => {
  // THE RECORDED DAY, IN ANY TIME ZONE. `2024-03-14` used to render "Mar 13, 2024" for every
  // reader west of Greenwich: a bare `YYYY-MM-DD` parses as UTC midnight, and formatting that
  // instant locally lands on the previous day. A warranty that expires a day earlier than recorded
  // is not "the recorded date only", so `formatDateOnly` now formats a calendar date in the
  // calendar. Asserted against the STORED day rather than a pinned string, so this cannot pass by
  // agreeing with whatever the formatter happens to do.
  it("renders the recorded warrantyExpiresDate — the recorded DAY, not one shifted by the zone", () => {
    stub();
    const { container } = renderRecord();
    expect(container.textContent).toMatch(/Warranty Expires/i);
    const expected = new Date(2024, 2, 14)
      .toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    expect(container.textContent).toContain(expected);
    expect(container.textContent).not.toContain(
      new Date(2024, 2, 13).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    );
  });

  it("derives NO warranty status beside it", () => {
    stub();
    const { container } = renderRecord();
    expect(container.textContent).not.toMatch(/in warranty|out of warranty|expired|days remaining|coverage/i);
  });

  it("an absent warranty date is an absence, not a judgment", () => {
    stub({ equipment: { ...EQUIPMENT, warrantyExpiresDate: null } });
    const { container } = renderRecord();
    expect(container.textContent).not.toMatch(/expired|no warranty|out of warranty/i);
  });
});

// ═════════════════════════════════ 1c — "we could not look" is never "there is no value"

describe("Customer and Location fail independently, and honestly", () => {
  it("a FAILED customer read shows the failure and a Retry — never 'Unknown customer'", () => {
    stub({ account: { account: null, error: "You do not have permission to view these customers." } });
    const { container } = renderRecord();
    expect(container.textContent).not.toMatch(/Unknown customer/i);
    expect(screen.getByText(/do not have permission to view these customers/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("a CONFIRMED absence still says 'Unknown customer' — the two are different facts", () => {
    stub({ account: { account: null, error: null } });
    renderRecord();
    expect(screen.getByText(/Unknown customer/i)).toBeTruthy();
  });

  it("a FAILED location read renders 'Location unavailable', not a genuinely-unset location", () => {
    stub({ locations: { data: [], error: "Locations could not be loaded." } });
    const { container } = renderRecord();
    const cell = container.querySelector("[data-equipment-location]");
    expect(cell.textContent).not.toMatch(/Unknown location/i);
    expect(within(cell).getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("a SUCCEEDED read that resolves to nothing says 'Unknown location'", () => {
    stub({ locations: { data: [], error: null } });
    const cell = renderRecord().container.querySelector("[data-equipment-location]");
    expect(cell.textContent).toMatch(/Unknown location/i);
  });

  it("neither panel states an operating company (EQ-G5)", () => {
    stub();
    const { container } = renderRecord();
    expect(container.textContent).not.toMatch(/Ventana/i);
    expect(container.textContent).not.toMatch(/operating company|line of business/i);
  });
});

// ═════════════════════════════════ inventory control, and the lifecycle authority

describe("inventory control and lifecycle authority are unchanged", () => {
  it("a serial-linked unit renders the honest UNKNOWN and STATES the reason", () => {
    // Linked: control began and installation is complete by definition, so the only unknown is the
    // sale-close signal — which is a Sales Order authority this surface does not have (D-5).
    stub({ equipment: { ...EQUIPMENT, serializedAssetId: "sa_1" } });
    const { container } = renderRecord();
    const section = container.querySelector("[data-inventory-control-section]");
    expect(section.textContent).toMatch(/unknown/i);
    expect(container.querySelector("[data-inventory-control-reason]").textContent)
      .toMatch(/sale-close status not available on this surface/i);
    // Never a fabricated state.
    expect(section.textContent).not.toMatch(/Inventory control ended|Under Taylor inventory control/i);
  });

  it("an UNLINKED unit is still UNKNOWN — a missing signal is never resolved into a state", () => {
    stub();
    const section = renderRecord().container.querySelector("[data-inventory-control-section]");
    expect(section.textContent).toMatch(/unknown/i);
    expect(section.textContent).not.toMatch(/Inventory control ended|Under Taylor inventory control/i);
  });

  it("Move and Retire stay present, disabled, and say why", () => {
    stub();
    const { container } = renderRecord();
    expect(container.querySelector('[data-equipment-action="move"]').disabled).toBe(true);
    expect(container.querySelector('[data-equipment-action="retire"]').disabled).toBe(true);
    expect(container.querySelector(".fo-action-reason").textContent.trim().length).toBeGreaterThan(0);
  });

  it("a RETIRED asset offers Reactivate, also disabled, and Edit stays LIVE", () => {
    stub({ equipment: { ...EQUIPMENT, status: "RETIRED" } });
    const { container } = renderRecord();
    expect(container.querySelector('[data-equipment-action="reactivate"]').disabled).toBe(true);
    // The Owner's E3 decision: descriptive corrections stay allowed after an asset leaves service.
    expect(container.querySelector('[data-equipment-action="edit"]').disabled).toBe(false);
  });

  it("no lifecycle action was ENABLED by the migration, and none was added", () => {
    stub();
    const { container } = renderRecord();
    const actions = [...container.querySelectorAll("[data-equipment-action]")]
      .map((el) => el.getAttribute("data-equipment-action"));
    expect(new Set(actions)).toEqual(new Set(["edit", "move", "retire"]));
  });
});

// ═════════════════════════════════ deferred concepts stay deferred

describe("deferred concepts do not appear as functionality", () => {
  it("no repair economics (EQ-D1), Opportunity linkage (EQ-D3) or compatible parts (EQ-D4)", () => {
    stub();
    const { container } = renderRecord();
    expect(container.textContent).not.toMatch(/repair spend|repair-heavy|replacement score|replace instead/i);
    expect(container.textContent).not.toMatch(/opportunit/i);
    expect(container.textContent).not.toMatch(/compatible parts/i);
  });
});
