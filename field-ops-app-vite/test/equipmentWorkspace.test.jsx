// INV-EQ-P1b -- component tests (vitest + jsdom) for the visible Equipment workspace.
// Proves: two WAI-ARIA tabs with roving tabindex + arrow/Home/End keyboard nav;
// Customer Equipment is the default; the Available tab shows an honest not-yet-
// connected surface (never blank); and CustomerEquipment renders each fail-closed
// state, the loaded-only filter note, row -> detail links, and Load more.
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

import EquipmentWorkspace from "../src/modules/equipment/EquipmentWorkspace";
import CustomerEquipment from "../src/modules/equipment/CustomerEquipment";
import AvailableEquipment from "../src/modules/equipment/AvailableEquipment";

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
  it("renders two ARIA tabs with Customer Equipment selected by default", () => {
    mockPageState = pageState({ loading: true });
    withRouter(<EquipmentWorkspace accessVersion={1} />);
    expect(screen.getByRole("tablist", { name: /equipment views/i })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    const customer = screen.getByRole("tab", { name: "Customer Equipment" });
    const available = screen.getByRole("tab", { name: "Available Equipment" });
    expect(customer.getAttribute("aria-selected")).toBe("true");
    expect(customer.getAttribute("tabindex")).toBe("0");
    expect(available.getAttribute("aria-selected")).toBe("false");
    expect(available.getAttribute("tabindex")).toBe("-1");
  });

  it("selecting the Available tab makes it the selected tab (click)", () => {
    mockPageState = pageState({ loading: true });
    withRouter(<EquipmentWorkspace accessVersion={1} />);
    fireEvent.click(screen.getByRole("tab", { name: "Available Equipment" }));
    expect(screen.getByRole("tab", { name: "Available Equipment" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Customer Equipment" }).getAttribute("aria-selected")).toBe("false");
  });

  it("ArrowRight/ArrowLeft/Home/End move tab selection", () => {
    mockPageState = pageState({ loading: true });
    withRouter(<EquipmentWorkspace accessVersion={1} />);
    const tablist = screen.getByRole("tablist", { name: /equipment views/i });
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Available Equipment" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Customer Equipment" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tablist, { key: "End" });
    expect(screen.getByRole("tab", { name: "Available Equipment" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(screen.getByRole("tab", { name: "Customer Equipment" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("AvailableEquipment honest state", () => {
  it("renders an explicit not-yet-connected surface (never blank, no fabricated inventory)", () => {
    render(<AvailableEquipment />);
    expect(screen.getByText(/governed Serialized Asset registry/i)).toBeTruthy();
    expect(screen.getByText(/not available yet/i)).toBeTruthy();
  });
});

describe("CustomerEquipment states", () => {
  const rowDocs = [
    { id: "e1", accountId: "a1", locationId: "l1", name: "RTU One", status: "ACTIVE", serialNumber: "SN1" },
    { id: "e2", accountId: "a2", name: "Boiler Two", status: "INACTIVE" },
  ];

  it("ready: renders the loaded-only note and a row link to Equipment Detail", () => {
    const usePage = () => pageState({ docs: rowDocs, accountNames: new Map([["a1", "Acme"], ["a2", "Beta"]]) });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    expect(screen.getByText(/not a global search/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /RTU One/i });
    expect(link.getAttribute("href")).toMatch(/e1$/);
    expect(screen.getByRole("link", { name: /Boiler Two/i })).toBeTruthy();
  });

  it("loading state shows a loading indicator", () => {
    const usePage = () => pageState({ loading: true, docs: [] });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    expect(screen.getByText(/loading equipment/i)).toBeTruthy();
  });

  it("denied state is fail-closed", () => {
    const usePage = () => pageState({ denied: true });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    expect(screen.getByText(/not able to view/i)).toBeTruthy();
  });

  it("unavailable state on a first-page error", () => {
    const usePage = () => pageState({ error: "boom", docs: [] });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    expect(screen.getByText(/couldn’t load equipment/i)).toBeTruthy();
  });

  it("empty state when nothing loaded", () => {
    const usePage = () => pageState({ docs: [] });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    expect(screen.getByText(/has been loaded/i)).toBeTruthy();
  });

  it("partial state keeps rows and shows a non-destructive notice", () => {
    const usePage = () => pageState({ docs: rowDocs, partialError: "couldn’t load more" });
    withRouter(<CustomerEquipment accessVersion={1} usePage={usePage} />);
    expect(screen.getByRole("link", { name: /RTU One/i })).toBeTruthy(); // rows retained
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
