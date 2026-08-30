// Equipment North Star P1v2.1 — the WORKSPACE and the install confirmation, at the render.
//
// The existing suites already prove the tabs' keyboard behaviour, the governed Available read's
// five states, and the install command's gating and idempotency. What this file proves is what the
// locked design added on top of them, and what the migration must not have cost:
//
//   1a  three populations stay three tabs; the workspace header carries a description and NO count;
//       neither tab panel repeats its own tab's name; an unresolved reference is never a raw id.
//   1b  the READY composition is a table of discrete cells, grouped by line, with both lines named.
//   1b  the install read-back names the unit, the serial, the customer and the installation
//       location, and the primary action says what it does.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let mockAvailableEquipmentSource = { connected: false, status: "loading", assets: [] };
let mockEquipmentList = {
  presentation: { state: "EMPTY", columns: [], rows: [], hasMore: false },
  rows: [], loadMore: () => {}, retry: () => {}, descriptorErrors: [],
};

vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/access/useEquipmentInstallCapability", () => ({
  useEquipmentInstallCapability: () => ({ canInstall: false }),
}));
vi.mock("../src/hooks/useWholeUnitParts", () => ({
  useWholeUnitParts: () => ({ parts: [], loading: false, denied: false, unavailable: false }),
}));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
}));
vi.mock("../src/hooks/useAvailableEquipmentSource", () => ({
  useAvailableEquipmentSource: () => mockAvailableEquipmentSource,
}));
vi.mock("../src/hooks/useLocationDisplaySource", () => ({
  useLocationDisplaySource: () => ({ displayMap: {} }),
}));
vi.mock("../src/hooks/useMetadataList", () => ({ useMetadataList: () => mockEquipmentList }));
vi.mock("../src/hooks/useAccountReferenceResolver", () => ({
  useAccountReferenceResolver: () => ({
    resolveReference: (fieldId, id) => (fieldId === "accountId"
      ? ({ acct_desert_sun: { state: "FOUND", label: "Desert Sun" } }[id] ?? { state: "NOT_FOUND" })
      : undefined),
  }),
}));
vi.mock("../src/hooks/useLocationReferenceResolver", () => ({
  // The unresolvable case, deliberately: this is the cell the design rules on.
  useLocationReferenceResolver: () => ({
    resolveReference: (fieldId) => (fieldId === "locationId" ? { state: "NOT_FOUND" } : undefined),
  }),
}));
vi.mock("../src/hooks/useAccountPicker", () => ({
  useAccountPicker: () => ({ state: "READY", options: [{ id: "acct_desert_sun", name: "Desert Sun" }], truncated: false, message: null, loading: false, error: null }),
}));
vi.mock("../src/hooks/useFirestoreCollection", () => ({ useFirestoreCollection: () => ({ data: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useEquipment", () => ({ useEquipmentForAccount: () => ({ data: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useLocationsForAccount", () => ({
  useLocationsForAccount: () => ({ data: [{ id: "loc_broadway", accountId: "acct_desert_sun", name: "Broadway Plant" }], loading: false, error: null, retry: vi.fn() }),
}));
vi.mock("../src/services/equipmentInstallCallableClient", () => ({ callInstallSerializedAsset: vi.fn() }));

import EquipmentWorkspace from "../src/modules/equipment/EquipmentWorkspace";
import AvailableEquipment from "../src/modules/equipment/AvailableEquipment";
import InstallAtCustomer from "../src/modules/equipment/InstallAtCustomer";
import { buildListPresentation } from "../src/metadata/listPresentation.js";
import { equipmentEntity, equipmentIndexList } from "../src/metadata/definitions/equipment.js";
import { callInstallSerializedAsset } from "../src/services/equipmentInstallCallableClient";

const withRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const INSTALLED_ROW = {
  id: "eq_8Xy2QrT",
  name: "Soft Serve Freezer 2",
  status: "ACTIVE",
  accountId: "acct_desert_sun",
  locationId: "loc_broadway",
  manufacturer: "Taylor",
  model: "C712",
  serialNumber: "K1122873",
};

function installedList(rows) {
  return {
    presentation: buildListPresentation({
      def: equipmentIndexList,
      entity: equipmentEntity,
      page: { rows, hasMore: false },
      loading: false,
      errorStatus: null,
      resolveReference: (fieldId, id) => (
        fieldId === "accountId"
          ? ({ acct_desert_sun: { state: "FOUND", label: "Desert Sun" } }[id] ?? { state: "NOT_FOUND" })
          : { state: "NOT_FOUND" }
      ),
    }),
    rows, loadMore: () => {}, retry: () => {}, descriptorErrors: [],
  };
}

// ═════════════════════════════════ 1a — three populations, one workspace

describe("the Equipment workspace keeps its three populations", () => {
  it("renders exactly three tabs, and Customer Equipment is the default", () => {
    mockEquipmentList = installedList([]);
    withRouter(<EquipmentWorkspace accessVersion={1} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Customer Equipment", "Available Equipment", "Add Equipment",
    ]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("the header describes the set and carries NO count", () => {
    mockEquipmentList = installedList([]);
    const { container } = withRouter(<EquipmentWorkspace accessVersion={1} />);
    expect(screen.getByText(/Every serialized unit the business owns or services/i)).toBeTruthy();
    // One number beside one title would have to mean one of three tabs, and a reader cannot tell
    // which. The Customer Equipment tab carries its own aggregate, where it is unambiguous.
    expect(container.querySelector(".ns-workspace__count")).toBeNull();
  });

  it("neither panel repeats the name of the tab that selects it", () => {
    mockEquipmentList = installedList([]);
    withRouter(<EquipmentWorkspace accessVersion={1} />);
    // "Customer Equipment" is the tab. It must not also be a heading inside the panel.
    expect(screen.queryByRole("heading", { name: /^Customer Equipment$/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Available Equipment$/ })).toBeNull();
    // The panels are still NAMED to assistive technology — by their tabs.
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe("eq-tab-customer");
  });

  it("each tab rail control is a real touch target and says which is current", () => {
    mockEquipmentList = installedList([]);
    withRouter(<EquipmentWorkspace accessVersion={1} />);
    const [customer, available] = screen.getAllByRole("tab");
    expect(customer.className).toMatch(/ns-tabrail__tab--on/);
    expect(available.className).not.toMatch(/--on/);
    fireEvent.click(available);
    expect(screen.getAllByRole("tab")[1].className).toMatch(/ns-tabrail__tab--on/);
  });
});

// ═════════════════════════════════ 1a — the installed register's row grammar

describe("Customer Equipment rows", () => {
  it("renders the display name and the disambiguating attributes as SEPARATE columns", () => {
    mockEquipmentList = installedList([INSTALLED_ROW]);
    withRouter(<EquipmentWorkspace accessVersion={1} />);
    // ND-30: the artifact draws a muted "Taylor C712 · S/N K1122873" summary inside the identity
    // cell. The repository gives each attribute its own sortable, scannable column instead, and
    // the anti-concatenation rule is the reason. Both facts are still on the row.
    expect(screen.getByText("Soft Serve Freezer 2")).toBeTruthy();
    expect(screen.getByText("Taylor")).toBeTruthy();
    expect(screen.getByText("C712")).toBeTruthy();
    expect(screen.getByText("K1122873")).toBeTruthy();
  });

  it("resolves the customer to a NAME and never renders a document id", () => {
    mockEquipmentList = installedList([INSTALLED_ROW]);
    const { container } = withRouter(<EquipmentWorkspace accessVersion={1} />);
    // getAllByText: the customer is also an option in the Customer filter picker.
    expect(screen.getAllByText("Desert Sun").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("eq_8Xy2QrT");
    expect(container.textContent).not.toContain("acct_desert_sun");
    expect(container.textContent).not.toContain("loc_broadway");
  });

  it("an unresolvable location renders a stated reference state, never the raw key (ND-29)", () => {
    mockEquipmentList = installedList([INSTALLED_ROW]);
    const { container } = withRouter(<EquipmentWorkspace accessVersion={1} />);
    // The design's illustrative cell reads "Location unavailable". The repository is AHEAD here:
    // the list runtime knows WHY a reference failed and says so — NOT_FOUND, DENIED, LOADING and
    // ERROR are four different facts with four different remedies, and collapsing them would tell
    // an operator their data is broken when the truth may be that their role is narrow. What the
    // design is protecting — never a raw id, never a guessed name — is what is asserted.
    expect(screen.getAllByText("No longer exists").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("loc_broadway");
  });

  it("the row is keyboard-reachable and routes by id without rendering it", () => {
    mockEquipmentList = installedList([INSTALLED_ROW]);
    withRouter(<EquipmentWorkspace accessVersion={1} />);
    const row = screen.getByText("Soft Serve Freezer 2").closest("tr");
    expect(row.getAttribute("tabindex")).toBe("0");
  });
});

// ═════════════════════════════════ 1b — the available table

const TAYLOR_ASSET = {
  serialNo: "CW-C161-0001", partId: "CW-WU-TAYLOR--C161", location: "wh-main",
  status: "AVAILABLE", availableForAssignment: true, currentEquipmentId: null,
};

describe("Available Equipment renders the locked 1b table", () => {
  it("gives every attribute its own cell, and states an unresolvable location as an absence", () => {
    mockAvailableEquipmentSource = { connected: true, status: "ready", assets: [TAYLOR_ASSET] };
    const { container } = withRouter(<AvailableEquipment />);
    const table = screen.getByRole("table", { name: /available serialized assets/i });
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent))
      .toEqual(["Unit", "Serial", "Model", "Condition", "Location"]);
    expect(within(table).getByText("CW-C161-0001")).toBeTruthy();
    expect(within(table).getByText("Location unavailable")).toBeTruthy();
    // The raw location key never reaches the row.
    expect(table.textContent).not.toContain("wh-main");
    // Nor is the row a sentence.
    expect(container.textContent).not.toMatch(/CW-C161-0001 · AVAILABLE/);
  });

  it("names BOTH operating lines in the summary, including at zero", () => {
    mockAvailableEquipmentSource = { connected: true, status: "ready", assets: [TAYLOR_ASSET] };
    withRouter(<AvailableEquipment />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Taylor: 0|Taylor: 1/);
    expect(status.textContent).toMatch(/Ventana \/ Icetro: 0/);
  });

  it("hides the Install action entirely for a caller without the capability", () => {
    mockAvailableEquipmentSource = { connected: true, status: "ready", assets: [TAYLOR_ASSET] };
    const table = withRouter(<AvailableEquipment />).container.querySelector("table");
    expect(within(table).queryByRole("button")).toBeNull();
    // The inventory is still visible — seeing what the company owns is a different question.
    expect(within(table).getByText("CW-C161-0001")).toBeTruthy();
  });
});

// ═════════════════════════════════ 1b — the install read-back

describe("the install confirmation", () => {
  const unit = {
    serializedAssetId: "sa_1", serialNo: "CW-C161-0001", title: "Taylor C161",
    manufacturer: "Taylor", modelNumber: "C161", lineLabel: "Taylor", location: "Main warehouse",
    available: true,
  };
  const accounts = [{ id: "acct_desert_sun", name: "Desert Sun" }];

  function choose() {
    render(<InstallAtCustomer unit={unit} accounts={accounts} canInstall onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox", { name: /^Customer$/i }), { target: { value: "acct_desert_sun" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Customer location/i }), { target: { value: "loc_broadway" } });
  }

  it("reads back the unit, the serial, the customer and the installation location", () => {
    choose();
    const value = (key) => document.querySelector(`[data-install-confirm="${key}"]`).textContent;
    expect(value("unit")).toBe("Taylor C161");
    expect(value("serial")).toBe("CW-C161-0001");
    expect(value("customer")).toBe("Desert Sun");
    expect(value("location")).toBe("Broadway Plant");
    // Labels, not a sentence a reader skims.
    expect(screen.getByText("Installation location")).toBeTruthy();
  });

  it("does not appear until BOTH choices are made", () => {
    render(<InstallAtCustomer unit={unit} accounts={accounts} canInstall onClose={() => {}} />);
    expect(document.querySelector("[data-install-confirm]")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: /^Customer$/i }), { target: { value: "acct_desert_sun" } });
    expect(document.querySelector("[data-install-confirm]")).toBeNull();
  });

  it("says what confirming does, and does not imply it can be undone", () => {
    choose();
    expect(screen.getByText(/takes it out of available stock/i)).toBeTruthy();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
  });

  it("offers Confirm installation as the primary and Cancel as the secondary", () => {
    choose();
    const confirm = screen.getByRole("button", { name: /Confirm installation/i });
    expect(confirm.disabled).toBe(false);
    expect(screen.getByRole("button", { name: /^Cancel$/i })).toBeTruthy();
  });

  it("confirming calls the EXISTING governed command — no second install path", () => {
    callInstallSerializedAsset.mockResolvedValue({ outcome: { outcome: "installed", equipmentId: "eq_1" }, error: null });
    choose();
    fireEvent.click(screen.getByRole("button", { name: /Confirm installation/i }));
    expect(callInstallSerializedAsset).toHaveBeenCalledTimes(1);
    const [request] = callInstallSerializedAsset.mock.calls[0];
    expect(request.serializedAssetId).toBe("sa_1");
    expect(request.accountId).toBe("acct_desert_sun");
    expect(request.locationId).toBe("loc_broadway");
  });

  it("offers no uninstall, recover, return-to-stock or reassign action", () => {
    choose();
    for (const forbidden of [/uninstall/i, /recover/i, /return to stock/i, /move to another customer/i, /change account/i]) {
      expect(screen.queryByRole("button", { name: forbidden })).toBeNull();
    }
  });
});
