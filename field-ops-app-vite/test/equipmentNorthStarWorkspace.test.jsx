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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// ══════════════════════ THE PAGE IS A PAGE, NOT A CARD ══════════════════════
//
// Owner, from the deployed sandbox: "the formatting of the page is wrong also. doesn't match the
// site." It did not, and the cause was structural rather than cosmetic.
//
// The workspace composed `<div className="fo-panel">` with a SELF-CLOSING `<WorkspaceIdentity />`,
// then the tab rail and panels as its SIBLINGS. `.ns-workspace` is what carries the collection
// container — max-width 1360, centred, 32px side padding — so only the title block was inside it.
// The title sat inset and centred while the tab rail and every row below ran hard against the left
// edge with no measure. And `.fo-panel` is the retired CARD treatment (elevated surface, radius,
// drop shadow), which no other North Star collection page renders inside.
//
// `WorkspaceIdentity` takes `children` for exactly this, and every shipped collection page uses it
// that way. These assertions are structural because the defect was: a screenshot diff would have
// caught the symptom, and this catches the cause.

describe("the workspace is composed as a page, not a card", () => {
  it("the tab rail and every panel live INSIDE the ns-workspace container", () => {
    mockEquipmentList = installedList([INSTALLED_ROW]);
    const { container } = withRouter(<EquipmentWorkspace accessVersion={1} />);
    const workspace = container.querySelector(".ns-workspace");
    expect(workspace, "the page must compose .ns-workspace").toBeTruthy();

    const rail = container.querySelector(".ns-tabrail");
    expect(rail, "the tab rail must exist").toBeTruthy();
    expect(
      workspace.contains(rail),
      "the tab rail rendered OUTSIDE .ns-workspace — it gets none of the container's measure or padding",
    ).toBe(true);

    for (const id of ["customer", "available", "add"]) {
      const panel = container.querySelector(`#eq-panel-${id}`);
      expect(panel, `#eq-panel-${id} must exist`).toBeTruthy();
      expect(workspace.contains(panel), `#eq-panel-${id} rendered outside .ns-workspace`).toBe(true);
    }
  });

  it("no retired card treatment wraps the workspace or its tab bodies", () => {
    mockEquipmentList = installedList([INSTALLED_ROW]);
    const { container } = withRouter(<EquipmentWorkspace accessVersion={1} />);
    // `.fo-panel` is the card this family left behind. The record page's own rail sections still use
    // it legitimately — this assertion is scoped to the COLLECTION, which must read as a page.
    const cards = container.querySelectorAll(".fo-panel");
    expect(
      [...cards].map((c) => c.className),
      "a .fo-panel card is wrapping the Equipment collection or one of its tab bodies",
    ).toEqual([]);
  });

  it("the header and the rows share one measure — the container is not applied twice", () => {
    mockEquipmentList = installedList([INSTALLED_ROW]);
    const { container } = withRouter(<EquipmentWorkspace accessVersion={1} />);
    // Exactly ONE .ns-workspace. Two nested containers would double the 32px inset and put the rows
    // out of line with the title again, which is the symptom this fix removes.
    expect(container.querySelectorAll(".ns-workspace")).toHaveLength(1);
  });
});

// ══════════════════════ ONE PAGE IDENTITY PER PAGE, ON EVERY TAB ══════════════════════
//
// Owner, from the deployed sandbox: selecting Add Equipment produced a SECOND visible "Equipment"
// title inside an Equipment page that already had one. `EquipmentRegister` was a standalone route
// when Wave 3 wrote it, and site-work #10 mounted it as a tab without removing its
// `WorkspaceShell title="Equipment"`.
//
// The shell is removed, not hidden: a CSS-hidden h1 would satisfy a gate while leaving the
// architecture lying about who owns the page. These assertions are about OWNERSHIP and VISIBILITY,
// never about a total h1 count across the mounted DOM — all three panels stay mounted so each keeps
// its state, and a heading inside a hidden one is not on screen.

describe("one visible page identity, whichever tab is selected", () => {
  // jsdom computes no layout, so `hidden` is the observable a test can use — it is exactly what the
  // inactive panels carry, and what the live gate confirms geometrically.
  const visibleH1s = (container) =>
    [...container.querySelectorAll("h1")]
      .filter((h) => !h.closest("[hidden]"))
      .map((h) => h.textContent.trim());

  for (const [tabName, panelId] of [
    ["Customer Equipment", "customer"],
    ["Available Equipment", "available"],
    ["Add Equipment", "add"],
  ]) {
    it(`${tabName} selected — exactly one visible Equipment identity`, () => {
      mockEquipmentList = installedList([INSTALLED_ROW]);
      const { container } = withRouter(<EquipmentWorkspace accessVersion={1} />);
      fireEvent.click(screen.getByRole("tab", { name: tabName, exact: true }));
      expect(container.querySelector(`#eq-panel-${panelId}`).hasAttribute("hidden")).toBe(false);

      const shown = visibleH1s(container);
      expect(shown, `visible h1s with ${tabName} selected`).toEqual(["Equipment"]);
      // And the one that is visible is the WORKSPACE's, not a panel's.
      const workspaceTitle = container.querySelector("h1.ns-workspace__title");
      expect(workspaceTitle.closest("[hidden]")).toBeNull();
      expect(container.querySelector(`#eq-panel-${panelId}`).contains(workspaceTitle)).toBe(false);
    });
  }

  it("the Add Equipment panel hosts no page shell of its own", () => {
    mockEquipmentList = installedList([INSTALLED_ROW]);
    const { container } = withRouter(<EquipmentWorkspace accessVersion={1} />);
    fireEvent.click(screen.getByRole("tab", { name: "Add Equipment", exact: true }));
    const panel = container.querySelector("#eq-panel-add");
    // `.fo-workspace` is WorkspaceShell's root. Its presence inside a tab is the defect itself.
    expect(panel.querySelectorAll(".fo-workspace")).toHaveLength(0);
    expect(panel.querySelectorAll("h1")).toHaveLength(0);
  });

  it("the tab still works — its controls and account-scoped prompt survive the shell removal", () => {
    mockEquipmentList = installedList([INSTALLED_ROW]);
    const { container } = withRouter(<EquipmentWorkspace accessVersion={1} />);
    fireEvent.click(screen.getByRole("tab", { name: "Add Equipment", exact: true }));
    const panel = container.querySelector("#eq-panel-add");
    // The customer picker was the shell's `actions` region and is now the tab's control row.
    expect(panel.querySelector("#equipment-account")).toBeTruthy();
    // And the account-scoped empty state — nothing read until a customer is chosen.
    expect(panel.textContent).toMatch(/Choose a customer/i);
  });

  it("a heading inside a HIDDEN panel is not a second identity", () => {
    mockEquipmentList = installedList([INSTALLED_ROW]);
    const { container } = withRouter(<EquipmentWorkspace accessVersion={1} />);
    // Default tab: the other two panels are mounted and hidden. Whatever they contain, the page
    // still states its identity exactly once.
    expect(container.querySelector("#eq-panel-available").hasAttribute("hidden")).toBe(true);
    expect(container.querySelector("#eq-panel-add").hasAttribute("hidden")).toBe(true);
    expect(visibleH1s(container)).toEqual(["Equipment"]);
  });
});

// ══════════════════════ THE PAGE'S OWN PALETTE ══════════════════════
//
// Owner, from the deployed Available Equipment tab: "still has a white background". It did. Every
// colour in `.fo-filters` was a hardcoded COOL-GREY hex — background #F7F9F8, border #E1E6E5, labels
// #445559, controls #fff on #C8D1CF — while the product's ground is warm stone (#F3F0E9 page,
// #FCFAF6 card, #EDE8DE sunken). A cold near-white card on a warm page does not read as a slightly
// different white; it reads as a component from another application.
//
// Asserted against the STYLESHEET rather than a render, because jsdom computes no cascade — the
// defect lives in the rule, so that is where it is caught. It is scoped to this one block: a
// repo-wide no-hex rule is a different, larger decision and is not smuggled in here.

describe("the Available Equipment filter block is on the palette", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.css"),
    "utf8",
  );
  // The block's own rules: from `.fo-filters {` up to the responsive override that closes it out.
  const block = css.slice(css.indexOf(".fo-filters {"), css.indexOf("@media (max-width: 760px)", css.indexOf(".fo-filters {")));

  it("declares no off-palette hex — the exact six that shipped", () => {
    // These are the literals the Owner was looking at. Naming them keeps the failure diagnosable
    // instead of "some hex somewhere".
    for (const offPalette of ["#F7F9F8", "#E1E6E5", "#445559", "#C8D1CF", "#23383D", "#2E4A50"]) {
      expect(block, `${offPalette} is a cool-grey literal on a warm-stone page`)
        .not.toContain(offPalette);
    }
    // And no bare white, which is the one that reads worst against warm stone.
    expect(block).not.toMatch(/background:\s*#fff\b/i);
  });

  it("takes its surface, border and text from tokens", () => {
    expect(block).toMatch(/background:\s*var\(--color-surface-sunken\)/);
    expect(block).toMatch(/border:\s*1px solid var\(--color-border\)/);
    expect(block).toMatch(/color:\s*var\(--color-text-secondary\)/);
  });

  it("changes colour only — the grid and spacing are untouched", () => {
    // A palette fix that quietly re-laid-out the filters would be a different change wearing this
    // one's clothes.
    expect(block).toMatch(/grid-template-columns:\s*minmax\(220px, 1\.7fr\) repeat\(4, minmax\(110px, 1fr\)\)/);
    expect(block).toMatch(/padding:\s*16px/);
    expect(block).toMatch(/gap:\s*12px/);
  });
});

// ── THE TAB RAIL'S HOVER, and the specificity trap it was sitting in.
//
// Owner: the three tabs should carry the same hover as the Opportunity list — the fill turns dark
// green and the text turns white. They did not, and the reason is documented on `.ns-view` because
// that control hit it first: setting only a COLOUR on hover leaves the global `button:hover`
// (0-1-1) to supply a dark evergreen BACKGROUND, while the more specific rule (0-2-0) wins the
// colour back to near-black. Dark text on a dark fill. Neither rule is wrong alone; the pair is.

describe("the tab rail matches the ratified collection view chips", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.css"),
    "utf8",
  );
  const rail = css.slice(css.indexOf(".ns-tabrail {"), css.indexOf(".ns-tabrail__tab:focus-visible"));

  it("states BOTH halves of hover — the fill and the text", () => {
    expect(rail).toMatch(/\.ns-tabrail__tab:hover\s*\{[^}]*background:\s*var\(--color-brand-secondary\)/);
    expect(rail).toMatch(/\.ns-tabrail__tab:hover\s*\{[^}]*color:\s*#FFFFFF/);
  });

  it("the selected tab inverts on hover too — it must not read as disabled", () => {
    expect(rail).toMatch(/\.ns-tabrail__tab--on:hover\s*\{[^}]*background:\s*var\(--color-brand-secondary\)/);
    expect(rail).toMatch(/\.ns-tabrail__tab--on:hover\s*\{[^}]*color:\s*#FFFFFF/);
  });

  it("a colour-only hover cannot come back", () => {
    // The regression itself: a `:hover` that sets `color` and no `background` re-opens the trap,
    // because the global button rule then decides the fill.
    const hoverRules = [...rail.matchAll(/\.ns-tabrail__tab[^{]*:hover\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(hoverRules.length).toBeGreaterThan(0);
    for (const body of hoverRules) {
      expect(body, `a :hover rule sets colour without a background: ${body.trim()}`)
        .toMatch(/background:/);
    }
  });

  it("the chips carry their own padding and a real touch target", () => {
    // 44px, and horizontal padding so the green fill is not flush against the words.
    expect(rail).toMatch(/min-height:\s*44px/);
    expect(rail).toMatch(/padding:\s*0 14px/);
  });
});

// ══════════════════════ THE TWO RAILS RUN THE SAME FOUR STATES ══════════════════════
//
// Customer Equipment carries TWO rails: the primary Equipment tabs (.ns-tabrail__tab) and the saved
// -view row beneath them, All Equipment / Active (.ns-view). The Owner reported they did not share
// the same shading and interaction grammar, and they did not — in one state.
//
// `.ns-view:hover` and `.ns-view.is-active` have IDENTICAL specificity (0-2-0) and `.is-active` is
// declared later, so it won: hovering the SELECTED chip took the green background from `:hover` and
// the near-black colour from `.is-active`. Dark text on a dark fill — the same trap the stylesheet
// already documents for the UN-selected state, reproduced in the one state that comment did not
// name, and the same trap the primary rail hit before `.ns-tabrail__tab--on:hover` was written.
//
// Asserted against the STYLESHEET, because jsdom computes no cascade and the defect lives in the
// rule ordering rather than in any rendered element.

describe("the saved-view rail runs the same four states as the Equipment tab rail", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.css"),
    "utf8",
  );
  // One rule body, by exact selector — never a slice of the file, so a rule moving cannot silently
  // empty the haystack and pass everything.
  // A plain string scan rather than a built regex: CSS selectors are full of regex metacharacters
  // and escaping them correctly is a second thing to get wrong. This finds the selector where it
  // begins a declaration — preceded by a newline and followed by " {" — so `.ns-view` cannot match
  // inside `.ns-view.is-active`, which is the confusion that would make every assertion below read
  // the wrong rule body.
  const rule = (selector) => {
    const needle = `\n${selector} {`;
    const at = css.indexOf(needle);
    if (at < 0) return null;
    const open = at + needle.length;
    const close = css.indexOf("}", open);
    return close < 0 ? null : css.slice(open, close);
  };

  it("1. RESTING — both rails sit on no background and the same secondary text token", () => {
    for (const sel of [".ns-tabrail__tab", ".ns-view"]) {
      const body = rule(sel);
      expect(body, `${sel} must exist`).toBeTruthy();
      expect(body, `${sel} resting background`).toMatch(/background:\s*none/);
      expect(body, `${sel} resting colour`).toMatch(/color:\s*var\(--color-text-secondary\)/);
    }
  });

  it("2. HOVER — both state BOTH halves, background and text, at the level that owns the control", () => {
    for (const sel of [".ns-tabrail__tab:hover", ".ns-view:hover"]) {
      const body = rule(sel);
      expect(body, `${sel} must exist`).toBeTruthy();
      expect(body, `${sel} needs an explicit fill`).toMatch(/background:\s*var\(--color-brand-secondary\)/);
      expect(body, `${sel} needs explicit white text`).toMatch(/color:\s*#FFFFFF/);
    }
  });

  it("3. SELECTED — both mark it the same way, and not by colour alone", () => {
    for (const sel of [".ns-tabrail__tab--on", ".ns-view.is-active"]) {
      const body = rule(sel);
      expect(body, `${sel} must exist`).toBeTruthy();
      expect(body, `${sel} selected colour`).toMatch(/color:\s*var\(--color-text-primary\)/);
      expect(body, `${sel} selected weight`).toMatch(/font-weight:\s*600/);
      // WCAG 1.4.1 — the rule underneath is the non-colour channel, so the state survives greyscale.
      expect(body, `${sel} selected rule`).toMatch(/border-bottom-color:\s*var\(--color-text-primary\)/);
    }
  });

  it("4. SELECTED + HOVER — both invert explicitly, so neither is decided by rule order", () => {
    // THE DEFECT. Without this rule `.ns-view.is-active` (0-2-0, declared later) beats
    // `.ns-view:hover` (0-2-0) and puts near-black text on the green fill.
    for (const sel of [".ns-tabrail__tab--on:hover", ".ns-view.is-active:hover"]) {
      const body = rule(sel);
      expect(body, `${sel} must exist — otherwise rule order decides the contrast`).toBeTruthy();
      expect(body, `${sel} fill`).toMatch(/background:\s*var\(--color-brand-secondary\)/);
      expect(body, `${sel} text`).toMatch(/color:\s*#FFFFFF/);
    }
    // And the count travels with the label, or a number stays dark on the green.
    expect(rule(".ns-view.is-active:hover .ns-view__count")).toMatch(/color:\s*#FFFFFF/);
  });

  it("5. no hardcoded off-palette colour is introduced by either rail", () => {
    for (const sel of [
      ".ns-tabrail__tab", ".ns-tabrail__tab:hover", ".ns-tabrail__tab--on", ".ns-tabrail__tab--on:hover",
      ".ns-view", ".ns-view:hover", ".ns-view.is-active", ".ns-view.is-active:hover",
    ]) {
      const body = rule(sel) ?? "";
      // #FFFFFF is the one literal both rails use deliberately: inverted text on the brand fill,
      // which is not a palette choice but the readable pair for it. Anything else must be a token.
      const literals = (body.match(/#[0-9A-Fa-f]{3,8}/g) ?? []).filter((h) => h.toUpperCase() !== "#FFFFFF");
      expect(literals, `${sel} introduced an off-palette literal`).toEqual([]);
    }
  });

  it("6. a colour-only hover cannot come back on EITHER rail", () => {
    // The regression itself, on both families: a `:hover` that sets colour and no background hands
    // the fill to the global `button:hover` and re-opens the specificity trap.
    const hovers = [...css.matchAll(/(\.ns-tabrail__tab[^{,]*|\.ns-view[^{,]*):hover\s*\{([^}]*)\}/g)]
      .filter(([, sel]) => !sel.includes("__count"));
    expect(hovers.length).toBeGreaterThanOrEqual(4);
    for (const [, sel, body] of hovers) {
      if (!/color:/.test(body)) continue;   // a rule that sets no colour cannot create the mismatch
      expect(body, `${sel}:hover sets colour without a background`).toMatch(/background:/);
    }
  });
});
