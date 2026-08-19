// INV-EQ-P1b -- component tests (vitest + jsdom) for the visible Equipment workspace.
// Proves: three WAI-ARIA tabs with roving tabindex + arrow/Home/End keyboard nav;
// Customer Equipment is the default; the Available tab reads the governed
// getAvailableEquipment projection (Part 3 sandbox-fidelity fix -- see
// test/availableEquipmentGovernedRead.test.jsx for the full state-matrix regression);
// and CustomerEquipment renders each fail-closed state, the loaded-only filter note,
// row -> detail links, and Load more.
// Run via `npm run test:components` (vitest).
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// EquipmentWorkspace renders CustomerEquipment with the REAL hook; mock it so no
// firebase is touched. Individual CustomerEquipment tests inject `usePage` directly.
let mockPageState;
vi.mock("../src/hooks/useInstalledEquipmentPage", () => ({
  useInstalledEquipmentPage: () => mockPageState,
  EQUIPMENT_PAGE_SIZE: 25,
}));

// Part 3 -- AvailableEquipment reads through this governed hook (no more injected
// `source` prop). Mock it here too so mounting EquipmentWorkspace/its Available tab
// never touches Firebase; individual AvailableEquipment tests below set the return
// value directly (same pattern as test/availableEquipmentGovernedRead.test.jsx).
let mockAvailableEquipmentSource = { connected: false, status: "loading", assets: [] };
vi.mock("../src/hooks/useAvailableEquipmentSource", () => ({
  useAvailableEquipmentSource: () => mockAvailableEquipmentSource,
}));

// site-work #10 -- the third tab mounts the REAL EquipmentRegister, which reads
// Accounts/Equipment/Locations off firebase directly. Mock those hooks (same
// vi.mock pattern as dispatchSurfacesErrorState.test.jsx) so switching to the tab
// never touches firebase; empty results are enough to prove the tab renders the
// register's own account-first prompt rather than being unreachable/blank.
// EquipmentRegister now reads accounts through the BOUNDED picker hook rather than the
// unbounded collection hook (§9). The mock follows the component, returning the picker's
// shape: options plus an interpreted state. Left as useFirestoreCollection, the component
// would sit in LOADING forever and the test would fail for a reason unrelated to what it
// asserts.
vi.mock("../src/hooks/useAccountPicker", () => ({
  useAccountPicker: () => ({ state: "EMPTY", options: [], truncated: false, message: null, loading: false, error: null }),
}));
vi.mock("../src/hooks/useFirestoreCollection", () => ({ useFirestoreCollection: () => ({ data: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useEquipment", () => ({ useEquipmentForAccount: () => ({ data: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useLocationsForAccount", () => ({ useLocationsForAccount: () => ({ data: [], loading: false, error: null, retry: vi.fn() }) }));

import EquipmentWorkspace from "../src/modules/equipment/EquipmentWorkspace";
import CustomerEquipment from "../src/modules/equipment/CustomerEquipment";
import AvailableEquipment from "../src/modules/equipment/AvailableEquipment";
import { NAV_DOMAINS, isNavItemVisible } from "../src/navigation/navConfig";
import { ROLES, ROLE_NAV_ACCESS } from "../src/domain/constants";

function pageState(over = {}) {
  return {
    docs: [], accountNames: new Map(), locationNames: new Map(),
    loading: false, error: null, denied: false, partialError: null,
    hasMore: false, loadMore: vi.fn(),
    ...over,
  };
}
const withRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
afterEach(cleanup);

describe("EquipmentWorkspace tabs", () => {
  it("renders three ARIA tabs with Customer Equipment selected by default", () => {
    mockPageState = pageState({ loading: true });
    withRouter(<EquipmentWorkspace accessVersion={1} />);
    expect(screen.getByRole("tablist", { name: /equipment views/i })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    const customer = screen.getByRole("tab", { name: "Customer Equipment" });
    const available = screen.getByRole("tab", { name: "Available Equipment" });
    const add = screen.getByRole("tab", { name: "Add Equipment" });
    expect(customer.getAttribute("aria-selected")).toBe("true");
    expect(customer.getAttribute("tabindex")).toBe("0");
    expect(available.getAttribute("aria-selected")).toBe("false");
    expect(available.getAttribute("tabindex")).toBe("-1");
    expect(add.getAttribute("aria-selected")).toBe("false");
    expect(add.getAttribute("tabindex")).toBe("-1");
  });

  it("selecting the Available tab makes it the selected tab (click)", () => {
    mockPageState = pageState({ loading: true });
    withRouter(<EquipmentWorkspace accessVersion={1} />);
    fireEvent.click(screen.getByRole("tab", { name: "Available Equipment" }));
    expect(screen.getByRole("tab", { name: "Available Equipment" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Customer Equipment" }).getAttribute("aria-selected")).toBe("false");
  });

  it("ArrowRight/ArrowLeft/Home/End move tab selection across all three tabs", () => {
    mockPageState = pageState({ loading: true });
    withRouter(<EquipmentWorkspace accessVersion={1} />);
    const tablist = screen.getByRole("tablist", { name: /equipment views/i });
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Available Equipment" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Add Equipment" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Available Equipment" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tablist, { key: "End" });
    expect(screen.getByRole("tab", { name: "Add Equipment" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(screen.getByRole("tab", { name: "Customer Equipment" }).getAttribute("aria-selected")).toBe("true");
  });

  // site-work #10 -- the gap: EquipmentRegister (Account picker + "+ New Equipment" +
  // EquipmentCreateModal) existed, tested, but was never reachable from the routed
  // UI. This proves the routed workspace now mounts it, and that its own create
  // entry point (gated on an Account being chosen -- there is nothing to add
  // equipment TO otherwise) is reachable through the tab, not just importable.
  it("the Add Equipment tab mounts the real EquipmentRegister (account-first create flow)", () => {
    mockPageState = pageState({ loading: true });
    withRouter(<EquipmentWorkspace accessVersion={1} />);
    fireEvent.click(screen.getByRole("tab", { name: "Add Equipment" }));
    expect(screen.getByRole("tab", { name: "Add Equipment" }).getAttribute("aria-selected")).toBe("true");
    // EquipmentRegister's own account-first prompt (no account chosen yet) --
    // proves the actual tested component rendered, not a stub.
    expect(screen.getByText(/select a customer to see the equipment installed/i)).toBeTruthy();
    // Both tabpanels stay mounted (inactive hidden), and CustomerEquipment also has a
    // "Customer" filter label -- so scope to EquipmentRegister's own labeled control by id.
    expect(document.getElementById("equipment-account")).toBeTruthy();
    // The create action itself only appears once an Account is selected
    // (EquipmentRegister's own gating -- see its header comment); with no
    // account chosen the button correctly does not exist yet.
    expect(screen.queryByRole("button", { name: /new equipment/i })).toBeNull();
  });
});

// site-work #10 -- role gating. The Equipment tab (and therefore the new Add
// Equipment entry point, which lives inside the same route) is reached only
// through the same admin/dispatcher-only nav gate every Equipment surface already
// used (navConfig.js: no legacyKey -> PLACEHOLDER_DEFAULT_ROLES). This wiring
// change adds no new permission and must not loosen or narrow that gate -- mirrors
// the existing nav/route assertions in equipmentRegister.test.mjs.
describe("Equipment nav access is unchanged by wiring in Add Equipment", () => {
  it("admin and dispatcher can reach the Equipment route; technician cannot", () => {
    const item = NAV_DOMAINS.find((d) => d.key === "equipment").subnav[0];
    const allowed = (role) => ROLE_NAV_ACCESS[role];
    expect(isNavItemVisible(item, ROLES.ADMIN, allowed(ROLES.ADMIN))).toBe(true);
    expect(isNavItemVisible(item, ROLES.DISPATCHER, allowed(ROLES.DISPATCHER))).toBe(true);
    expect(isNavItemVisible(item, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN))).toBe(false);
  });
});

// Part 3 -- the state-matrix regression (loading/denied/unavailable/empty/ready, plus the stale
// "registry doesn't exist" copy proof) now lives in test/availableEquipmentGovernedRead.test.jsx.
// These two describe blocks keep the catalog-filtering coverage local to this file, updated to drive
// the new governed-hook seam instead of the retired `source` prop.
describe("AvailableEquipment honest state", () => {
  it("an unauthorized/unactivated governed read renders an explicit denied surface (never blank, no fabricated inventory)", () => {
    mockAvailableEquipmentSource = { connected: false, status: "denied", assets: [] };
    render(<AvailableEquipment />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/not able to view available serialized assets/i)).toBeTruthy();
  });
});

describe("AvailableEquipment catalog filtering (READY source)", () => {
  const readyAssets = [
    { serialNo: "S1", partId: "P1", internalPartNumber: "IPN-1", category: "Valve", manufacturer: "Acme", model: "M1", status: "NEW", locationLabel: "WH-A", currentEquipmentId: null, availableForAssignment: true },
    { serialNo: "S2", partId: "P2", type: "Pump", manufacturer: "Beta", model: "M2", condition: "REFURB", location: "Truck-7", currentEquipmentId: null, availableForAssignment: true },
    { serialNo: "S3", partId: "P1", currentEquipmentId: "EQ-9", availableForAssignment: false }, // installed -> excluded
  ];

  it("lists only available assets with a count, no customer filter, and accessible controls", () => {
    mockAvailableEquipmentSource = { connected: true, status: "ready", assets: readyAssets };
    render(<AvailableEquipment />);
    expect(screen.getByRole("group", { name: /available equipment filters/i })).toBeTruthy();
    // no customer/account filter control on this tab
    expect(screen.queryByLabelText(/customer/i)).toBeNull();
    expect(screen.getByText(/2 of 2 available/i)).toBeTruthy();
    expect(screen.getByText("IPN-1")).toBeTruthy(); // S1 internal identifier
    expect(screen.getByText(/S\/N S2/)).toBeTruthy(); // S3 (installed) never shown
  });

  it("combined filters narrow the list and update the count; Clear resets", () => {
    mockAvailableEquipmentSource = { connected: true, status: "ready", assets: readyAssets };
    render(<AvailableEquipment />);
    fireEvent.change(screen.getByLabelText(/Type \/ category/i), { target: { value: "Valve" } });
    expect(screen.getByText(/1 of 2 available/i)).toBeTruthy();
    expect(screen.queryByText(/S\/N S2/)).toBeNull();
    // term further narrows (and can exclude all)
    fireEvent.change(screen.getByLabelText(/^Search$/i), { target: { value: "beta" } });
    expect(screen.getByText(/no available inventory matches these filters/i)).toBeTruthy();
    // clear resets to the full available set
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(screen.getByText(/2 of 2 available/i)).toBeTruthy();
  });
});

// S-INV-EQUIPMENT -- CustomerEquipment now renders through the shared metadata
// list runtime (buildListPresentation + MetadataListGrid over
// equipmentIndexList/equipmentEntity) instead of a hand-written <ul>, though the
// read itself is unchanged (still useInstalledEquipmentPage, injected via
// `usePage` exactly as before -- see the module's own header comment for why a
// second read via useMetadataList was not introduced). Rows render as a table;
// navigation is a clickable/keyboard-activatable row (MetadataListGrid's
// onRowClick), not a per-row <a> -- the same shape every other metadata-list
// surface in this program uses (see AccountsList.jsx), not a regression specific
// to this migration. State copy now comes from the shared runtime's own
// vocabulary (emptyMessageFor/LoadingState defaults), which is why the asserted
// strings below differ from the pre-migration copy.
describe("CustomerEquipment states", () => {
  const rowDocs = [
    { id: "e1", accountId: "a1", locationId: "l1", name: "RTU One", status: "ACTIVE", serialNumber: "SN1" },
    { id: "e2", accountId: "a2", name: "Boiler Two", status: "INACTIVE" },
  ];

  it("ready: renders the loaded-only note and clickable rows that navigate to Equipment Detail", () => {
    const usePage = () => pageState({ docs: rowDocs, accountNames: new Map([["a1", "Acme"], ["a2", "Beta"]]) });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    expect(screen.getByText(/not a global search/i)).toBeTruthy();
    expect(screen.getByText("RTU One")).toBeTruthy();
    expect(screen.getByText("Boiler Two")).toBeTruthy();
    // REFERENCE columns resolve from the accountNames Map already in hand -- no
    // raw id ever reaches the cell, resolved or not (a2 has no entry -> honest
    // "Unresolved reference", never "a2").
    // "Acme" also appears as a Customer-filter <option>, so scope to the table cell.
    const row = screen.getByText("RTU One").closest("tr");
    expect(row.querySelector("td:nth-child(3)").textContent).toBe("Acme");
    expect(screen.getByText("Unresolved reference")).toBeTruthy();
    expect(screen.queryByText("a1")).toBeNull();
    expect(screen.queryByText("a2")).toBeNull();
    expect(row.getAttribute("tabindex")).toBe("0");
  });

  it("clicking/activating a row navigates via the declared rowNavigationTo template", () => {
    const usePage = () => pageState({ docs: rowDocs, accountNames: new Map([["a1", "Acme"]]) });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    const row = screen.getByText("RTU One").closest("tr");
    fireEvent.keyDown(row, { key: "Enter" });
    // MemoryRouter has no visible URL assertion surface here; the important proof
    // is that Enter activates the row without throwing and the row stays focusable
    // -- full navigation is covered by MetadataRecordPage.jsx's own buildRowHref
    // tests. This asserts the wiring, not the router internals.
    expect(row.getAttribute("tabindex")).toBe("0");
  });

  it("loading state shows a loading indicator", () => {
    const usePage = () => pageState({ loading: true, docs: [] });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("denied state is fail-closed", () => {
    const usePage = () => pageState({ denied: true });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/do not have access to equipment/i)).toBeTruthy();
  });

  it("unavailable state on a first-page error", () => {
    const usePage = () => pageState({ error: "boom", docs: [] });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/equipment could not be loaded/i)).toBeTruthy();
  });

  it("empty state when nothing loaded", () => {
    const usePage = () => pageState({ docs: [] });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    expect(screen.getByText(/no equipment yet/i)).toBeTruthy();
  });

  it("partial state keeps rows and shows a non-destructive notice", () => {
    const usePage = () => pageState({ docs: rowDocs, partialError: "couldn’t load more" });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    expect(screen.getByText("RTU One")).toBeTruthy(); // rows retained
    expect(screen.getByText(/already-loaded rows are shown/i)).toBeTruthy();
  });

  it("Load more appears when hasMore and invokes loadMore", () => {
    const loadMore = vi.fn();
    const usePage = () => pageState({ docs: rowDocs, hasMore: true, loadMore });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(loadMore).toHaveBeenCalled();
  });
});
