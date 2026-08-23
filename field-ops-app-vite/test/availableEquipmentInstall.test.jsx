// The Available Equipment surface, rendered — labels, the line split, and who sees the Install action.
//
// The pure modules already prove what a row SAYS and when the button may be pressed. What only a
// render can prove is that the component actually uses them: that the product name reaches the
// screen instead of the part id, that both lines are named, and that the Install control is absent
// — not merely disabled — for somebody who does not hold equipment.install.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AvailableEquipment from "../src/modules/equipment/AvailableEquipment.jsx";
import InstallAtCustomer from "../src/modules/equipment/InstallAtCustomer.jsx";
import { useAvailableEquipmentSource } from "../src/hooks/useAvailableEquipmentSource.js";
import { useWholeUnitParts } from "../src/hooks/useWholeUnitParts.js";
import { useEquipmentInstallCapability } from "../src/access/useEquipmentInstallCapability.js";
import { useAccountPicker } from "../src/hooks/useAccountPicker.js";
import { useLocationDisplaySource } from "../src/hooks/useLocationDisplaySource.js";
import { useLocationsForAccount } from "../src/hooks/useLocationsForAccount.js";
import { useAuth } from "../src/auth/AuthContext.jsx";
import { callInstallSerializedAsset } from "../src/services/equipmentInstallCallableClient.js";

vi.mock("../src/hooks/useAvailableEquipmentSource.js", () => ({ useAvailableEquipmentSource: vi.fn() }));
vi.mock("../src/hooks/useWholeUnitParts.js", () => ({ useWholeUnitParts: vi.fn() }));
vi.mock("../src/access/useEquipmentInstallCapability.js", () => ({ useEquipmentInstallCapability: vi.fn() }));
vi.mock("../src/hooks/useAccountPicker.js", () => ({ useAccountPicker: vi.fn() }));
vi.mock("../src/hooks/useLocationDisplaySource.js", () => ({ useLocationDisplaySource: vi.fn() }));
vi.mock("../src/hooks/useLocationsForAccount.js", () => ({ useLocationsForAccount: vi.fn() }));
vi.mock("../src/auth/AuthContext.jsx", () => ({ useAuth: vi.fn() }));
vi.mock("../src/services/equipmentInstallCallableClient.js", () => ({ callInstallSerializedAsset: vi.fn() }));
// Only useNavigate is replaced. Mocking the whole module strips MemoryRouter and every other export
// the suite relies on.
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
}));

const TAYLOR_PART = {
  partId: "CW-WU-TAYLOR--C161", wholeUnit: true, name: "Taylor C161",
  category: "Whole Unit Equipment", equipmentModelId: "TAYLOR--C161",
};
const ICETRO_PART = {
  partId: "CW-WU-ICETRO--IM-0460-AH", wholeUnit: true, name: "Icetro IM-0460-AH",
  category: "Whole Unit Equipment", equipmentModelId: "ICETRO--IM-0460-AH",
};
// THE PROJECTED SHAPE, not the raw governed envelope. By the time the component sees a row it has
// been through mapProjectionRowToAsset, which renames inventoryState -> status and
// currentLocationId -> location and re-derives availableForAssignment. Mocking the raw shape here
// was the mistake that hid a real field-name bug behind fifteen passing unit tests.
const ASSETS = [
  { serialNo: "CW-C161-0001", partId: TAYLOR_PART.partId, location: "wh-main",
    status: "AVAILABLE", availableForAssignment: true, currentEquipmentId: null },
  { serialNo: "CW-IM0460AH-0001", partId: ICETRO_PART.partId, location: "wh-main",
    status: "AVAILABLE", availableForAssignment: true, currentEquipmentId: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ user: { uid: "u1" } });
  useAvailableEquipmentSource.mockReturnValue({ status: "ready", connected: true, assets: ASSETS });
  useWholeUnitParts.mockReturnValue({ parts: [TAYLOR_PART, ICETRO_PART], loading: false, denied: false, unavailable: false });
  useEquipmentInstallCapability.mockReturnValue({ canInstall: true });
  useAccountPicker.mockReturnValue({ options: [{ id: "acct-a", name: "Harbor Grill" }], message: null });
  useLocationDisplaySource.mockReturnValue({ displayMap: {} });
  useLocationsForAccount.mockReturnValue({ data: [{ id: "loc-a1", accountId: "acct-a", name: "Airport" }], loading: false });
});

describe("Available Equipment", () => {
  it("labels a unit by its PRODUCT, not by its part id", () => {
    render(<AvailableEquipment />);
    expect(screen.getAllByText("Taylor C161").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Icetro IM-0460-AH").length).toBeGreaterThan(0);
    // The raw part id must not be the primary label anywhere.
    expect(screen.queryByText("CW-WU-TAYLOR--C161")).toBeNull();
  });

  it("keeps the serial visible beside the product", () => {
    render(<AvailableEquipment />);
    expect(screen.getByText(/CW-C161-0001/)).toBeTruthy();
  });

  it("groups by business line and names BOTH lines", () => {
    render(<AvailableEquipment />);
    expect(screen.getByRole("region", { name: /Taylor available equipment/i })).toBeTruthy();
    expect(screen.getByRole("region", { name: /Ventana \/ Icetro available equipment/i })).toBeTruthy();
  });

  it("counts the two lines separately in the summary", () => {
    render(<AvailableEquipment />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Taylor: 1/);
    expect(status.textContent).toMatch(/Ventana \/ Icetro: 1/);
  });

  it("shows the Install action for an authorized installer", () => {
    render(<AvailableEquipment />);
    expect(screen.getAllByRole("button", { name: /Install \/ Assign to Customer/i }).length).toBe(2);
  });

  it("HIDES the Install action entirely when the capability is absent", () => {
    // Absent, not merely disabled. An unauthorized user should not be invited to start a flow that
    // ends in a refusal -- the defect SalesOrderActions had before its own capability gate.
    useEquipmentInstallCapability.mockReturnValue({ canInstall: false });
    render(<AvailableEquipment />);
    expect(screen.queryByRole("button", { name: /Install \/ Assign to Customer/i })).toBeNull();
    // The inventory itself is still visible -- seeing what the company owns is a different question.
    expect(screen.getAllByText("Taylor C161").length).toBeGreaterThan(0);
  });

  it("still lists units when the Part read fails, falling back to ids rather than hiding stock", () => {
    useWholeUnitParts.mockReturnValue({ parts: [], loading: false, denied: true, unavailable: false });
    render(<AvailableEquipment />);
    expect(screen.getByText("CW-WU-TAYLOR--C161")).toBeTruthy();
    expect(screen.getByText(/CW-C161-0001/)).toBeTruthy();
  });
});

describe("InstallAtCustomer", () => {
  const unit = {
    serializedAssetId: "sa_1", serialNo: "CW-C161-0001", title: "Taylor C161",
    manufacturer: "Taylor", modelNumber: "C161", lineLabel: "Taylor",
    location: "wh-main", available: true,
  };
  const accounts = [{ id: "acct-a", name: "Harbor Grill" }];

  it("reads the whole thing back before it becomes permanent", () => {
    render(<InstallAtCustomer unit={unit} accounts={accounts} canInstall onClose={() => {}} />);
    expect(screen.getAllByText("Taylor C161").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CW-C161-0001").length).toBeGreaterThan(0);
  });

  it("the location select is dead until a customer is chosen", () => {
    useLocationsForAccount.mockReturnValue({ data: [], loading: false });
    render(<InstallAtCustomer unit={unit} accounts={accounts} canInstall onClose={() => {}} />);
    expect(screen.getByRole("combobox", { name: /Customer location/i }).disabled).toBe(true);
  });

  it("Install stays disabled, with a reason, until the form is complete", () => {
    render(<InstallAtCustomer unit={unit} accounts={accounts} canInstall onClose={() => {}} />);
    const button = screen.getByRole("button", { name: /Install at customer/i });
    expect(button.disabled).toBe(true);
    // A greyed control with no explanation is the failure mode this surface exists to avoid.
    expect(screen.getAllByText(/Choose the customer this unit is for/i).length).toBeGreaterThan(0);
  });

  it("warns, in the confirmation, that it cannot be undone", () => {
    render(<InstallAtCustomer unit={unit} accounts={accounts} canInstall onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox", { name: /^Customer$/i }), { target: { value: "acct-a" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Customer location/i }), { target: { value: "loc-a1" } });
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Install at customer/i }).disabled).toBe(false);
  });

  it("ALREADY_INSTALLED is shown as a state, and no retry is offered", async () => {
    callInstallSerializedAsset.mockResolvedValue({
      outcome: null, error: { code: "failed-precondition", details: "ALREADY_INSTALLED", message: "…" },
    });
    render(<InstallAtCustomer unit={unit} accounts={accounts} canInstall onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox", { name: /^Customer$/i }), { target: { value: "acct-a" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Customer location/i }), { target: { value: "loc-a1" } });
    fireEvent.click(screen.getByRole("button", { name: /Install at customer/i }));
    expect(await screen.findByText(/already installed at a customer/i)).toBeTruthy();
  });

  it("a successful install reports the Equipment it created", async () => {
    const onInstalled = vi.fn();
    callInstallSerializedAsset.mockResolvedValue({ outcome: { outcome: "installed", equipmentId: "eq_1" }, error: null });
    render(<InstallAtCustomer unit={unit} accounts={accounts} canInstall onClose={() => {}} onInstalled={onInstalled} />);
    fireEvent.change(screen.getByRole("combobox", { name: /^Customer$/i }), { target: { value: "acct-a" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Customer location/i }), { target: { value: "loc-a1" } });
    fireEvent.click(screen.getByRole("button", { name: /Install at customer/i }));
    expect(await screen.findByText(/^Installed\.$/)).toBeTruthy();
    expect(onInstalled).toHaveBeenCalledWith("eq_1", { replayed: false });
  });

  it("ONE request per confirm -- a second click while in flight sends nothing more", async () => {
    let resolve;
    callInstallSerializedAsset.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<InstallAtCustomer unit={unit} accounts={accounts} canInstall onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox", { name: /^Customer$/i }), { target: { value: "acct-a" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Customer location/i }), { target: { value: "loc-a1" } });
    const button = screen.getByRole("button", { name: /Install at customer/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(callInstallSerializedAsset).toHaveBeenCalledTimes(1);
    resolve({ outcome: { outcome: "installed", equipmentId: "eq_1" }, error: null });
  });

  it("an unauthorized caller cannot press Install even if the dialog is open", () => {
    render(<InstallAtCustomer unit={unit} accounts={accounts} canInstall={false} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /Install at customer/i }).disabled).toBe(true);
    expect(screen.getByText(/not authorized to install equipment/i)).toBeTruthy();
  });
});
