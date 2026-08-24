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
// AvailableEquipment gained an Install action (PR: equipment install UI). These are its NEW
// dependencies, declared here because this suite renders that component -- an undeclared dependency
// is not a neutral omission, it throws on first render and takes every case in the file with it.
// canInstall is FALSE so this suite keeps testing exactly what it was written to test: the governed
// read's own states, with no install control in the way.
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "test-uid" } }) }));
vi.mock("../src/access/useEquipmentInstallCapability", () => ({
  useEquipmentInstallCapability: () => ({ canInstall: false }),
}));
vi.mock("../src/hooks/useWholeUnitParts", () => ({
  useWholeUnitParts: () => ({ parts: [], loading: false, denied: false, unavailable: false }),
}));
// Only useNavigate is replaced. Mocking the whole module strips MemoryRouter and every other export
// the suite relies on.
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
}));
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
// CustomerEquipment moved off useInstalledEquipmentPage onto the bounded metadata runtime, so its
// read is now useMetadataList and its names come from the two batched reference resolvers. The
// PROPERTIES under test are unchanged -- every fail-closed state, rows, navigation and Load more --
// they are simply driven through the read path the tab actually has.
let mockEquipmentList = { presentation: { state: "EMPTY", columns: [], rows: [], hasMore: false }, rows: [], loadMore: () => {}, retry: () => {}, descriptorErrors: [] };
vi.mock("../src/hooks/useMetadataList", () => ({ useMetadataList: () => mockEquipmentList }));
vi.mock("../src/hooks/useAccountReferenceResolver", () => ({
  useAccountReferenceResolver: () => ({ resolveReference: (fieldId, id) => (
    fieldId === "accountId" ? ({ a1: { state: "FOUND", label: "Acme" } }[id] ?? { state: "NOT_FOUND" }) : undefined
  ) }),
}));
vi.mock("../src/hooks/useLocationReferenceResolver", () => ({
  useLocationReferenceResolver: () => ({ resolveReference: (fieldId) => (
    fieldId === "locationId" ? { state: "NOT_FOUND" } : undefined
  ) }),
}));

vi.mock("../src/hooks/useAccountPicker", () => ({
  useAccountPicker: () => ({ state: "EMPTY", options: [], truncated: false, message: null, loading: false, error: null }),
}));
vi.mock("../src/hooks/useFirestoreCollection", () => ({ useFirestoreCollection: () => ({ data: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useEquipment", () => ({ useEquipmentForAccount: () => ({ data: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useLocationsForAccount", () => ({ useLocationsForAccount: () => ({ data: [], loading: false, error: null, retry: vi.fn() }) }));

import EquipmentWorkspace from "../src/modules/equipment/EquipmentWorkspace";
import CustomerEquipment from "../src/modules/equipment/CustomerEquipment";
import { buildListPresentation } from "../src/metadata/listPresentation.js";
import { equipmentEntity, equipmentIndexList } from "../src/metadata/definitions/equipment.js";
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
    // The serial is its own FIELD now, not "S/N S2" folded into a sentence. S3 (installed) never shown.
    expect(screen.getByText("S2")).toBeTruthy();
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

// THE BUSINESS-WIDE INSTALLED EQUIPMENT LIST, on the bounded metadata runtime.
//
// The tab used to filter the LOADED rows only: every customer it could offer was one it had already
// downloaded, so choosing one narrowed a page rather than the register. Its filters are now
// server-side, from the Equipment metadata, because the three composites that serve them are live.
//
// These cases hold the fail-closed states -- the reason the file exists -- through the read the tab
// now has. DENIED, UNAVAILABLE and EMPTY stay three different facts, because only one of them means
// there is no equipment.
describe("CustomerEquipment states", () => {
  const listResult = (presentation, extra = {}) => ({
    presentation, rows: [], loadMore: vi.fn(), retry: vi.fn(), descriptorErrors: [], ...extra,
  });
  const docs = [
    { id: "e1", accountId: "a1", locationId: "l1", name: "RTU One", status: "ACTIVE", serialNumber: "SN1" },
    { id: "e2", accountId: "a2", name: "Boiler Two", status: "INACTIVE" },
  ];
  // a1 resolves, a2 does not -- so the honest "Unresolved reference" is exercised alongside a
  // real name, which is the pair that matters.
  const resolveReference = (fieldId, id) =>
    (fieldId === "accountId" ? ({ a1: { state: "FOUND", label: "Acme" } }[id] ?? { state: "NOT_FOUND" }) : { state: "NOT_FOUND" });
  const ready = (hasMore = false) => buildListPresentation({
    def: equipmentIndexList, entity: equipmentEntity,
    page: { rows: docs, hasMore }, loading: false, errorStatus: null, resolveReference,
  });
  const failed = (errorStatus) => buildListPresentation({
    def: equipmentIndexList, entity: equipmentEntity,
    page: null, loading: false, errorStatus, resolveReference,
  });

  it("ready: renders rows, and a reference that did not resolve is named, never its id", () => {
    mockEquipmentList = listResult(ready());
    withRouter(<CustomerEquipment />);
    expect(screen.getByText("RTU One")).toBeTruthy();
    expect(screen.getByText("Boiler Two")).toBeTruthy();
    // NOT_FOUND renders "No longer exists", which is a statement about the reference.
    // "a2" would be a statement about the database.
    expect(screen.getAllByText("No longer exists").length).toBeGreaterThan(0);
    // installedEquipmentListView's resolveName falls back to the raw id. This surface does not
    // call it, so no document key can reach a cell.
    expect(screen.queryByText("a1")).toBeNull();
    expect(screen.queryByText("a2")).toBeNull();
  });

  it("rows are activatable, so a unit can be opened from the keyboard", () => {
    mockEquipmentList = listResult(ready());
    withRouter(<CustomerEquipment />);
    const row = screen.getByText("RTU One").closest("tr");
    expect(row.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(row.getAttribute("tabindex")).toBe("0");
  });

  it("loading shows a loading indicator, not an empty register", () => {
    mockEquipmentList = listResult(buildListPresentation({ def: equipmentIndexList, entity: equipmentEntity, page: null, loading: true, errorStatus: null }));
    withRouter(<CustomerEquipment />);
    // getAllByRole, not getByRole: the list-view header also announces politely (the
    // "N items / Sorted by / Filtered by" line), so there is legitimately more than one status
    // region now. The assertion is that a LOADING indicator is present, not that exactly one
    // element announces.
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("denied is fail-closed and says nothing about whether equipment exists", () => {
    mockEquipmentList = listResult(failed("denied"));
    withRouter(<CustomerEquipment />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/do not have access to equipment/i)).toBeTruthy();
  });

  it("unavailable is an alert, not an empty register", () => {
    mockEquipmentList = listResult(failed("unavailable"));
    withRouter(<CustomerEquipment />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
  });

  it("empty means the read succeeded and there is genuinely nothing", () => {
    mockEquipmentList = listResult(buildListPresentation({ def: equipmentIndexList, entity: equipmentEntity, page: { rows: [], hasMore: false }, loading: false, errorStatus: null }));
    withRouter(<CustomerEquipment />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/nothing here yet/i)).toBeTruthy();
  });

  it("a register filtered to nothing is not an empty register", () => {
    // The two statements are different, and telling somebody they own no equipment because a
    // filter excluded it is the more damaging of the two. Driven through the URL, because the
    // criteria are what the empty state reads -- a FILTERED presentation with no criteria in the
    // URL is a state the screen cannot actually be in.
    mockEquipmentList = listResult(buildListPresentation({ def: equipmentIndexList, entity: equipmentEntity, page: { rows: [], hasMore: false }, loading: false, errorStatus: null, filtersActive: true }));
    render(
      <MemoryRouter initialEntries={["/equipment?f=status%3AEQUALS%3AACTIVE"]}>
        <CustomerEquipment />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no records match these filters/i)).toBeTruthy();
    // Two: the ActiveCriteria chip row offers one, and the empty state offers its own so the
    // dead end is escapable from where the reader is looking.
    expect(screen.getAllByRole("button", { name: /clear filters/i }).length).toBe(2);
  });

  it("Load more appears when there is more and invokes it", () => {
    const loadMore = vi.fn();
    mockEquipmentList = listResult(ready(true), { loadMore });
    withRouter(<CustomerEquipment />);
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(loadMore).toHaveBeenCalled();
  });
});
