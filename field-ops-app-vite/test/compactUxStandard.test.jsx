// COMPACT UX STANDARD -- docs/design/compact-ux-standard.md.
// Run: npx vitest run test/compactUxStandard.test.jsx
//
// Holds the accessibility contract of the InfoTip (standard §4: hover, keyboard focus, Escape,
// touch, screen-reader description) and the rule that a compacted page moves explanation into a
// tip WITHOUT moving warnings, refusals or required instructions there (standard §6).
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import InfoTip from "../src/shared/ui/primitives/InfoTip.jsx";
import PageHeader from "../src/shared/ui/primitives/PageHeader.jsx";
import Field from "../src/shared/ui/form/Field.jsx";
import AdministrationOverview from "../src/modules/administration/AdministrationOverview.jsx";
import ScanWorkspace from "../src/modules/scan/ScanWorkspace.jsx";
import { RECEIVE_CAPABILITY } from "../src/access/scanWorkflows.js";

vi.mock("../src/hooks/useCurrentTechnician", () => ({
  useCurrentTechnician: () => ({ technicianId: null, loading: false, error: null, retry: () => {} }),
}));
vi.mock("../src/hooks/useAssignedWorkOrders", () => ({
  useAssignedWorkOrders: () => ({ data: [], loading: false, error: null }),
}));
vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ role: "technician", user: { uid: "U1" } }),
}));

afterEach(cleanup);

// jsdom has no PointerEvent, so `pointerType` would be dropped and hover could not be told from touch.
if (typeof window.PointerEvent === "undefined") {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "";
    }
  };
}

const tipFor = (button) => document.getElementById(button.getAttribute("aria-describedby"));

describe("InfoTip accessibility contract", () => {
  it("is a labelled button whose tip is its description, hidden until asked for", () => {
    render(<InfoTip label="About Users">Manage employee profiles.</InfoTip>);
    const button = screen.getByRole("button", { name: "About Users" });
    const tip = tipFor(button);
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.textContent).toBe("Manage employee profiles.");
    expect(tip.hidden).toBe(true);
    // Announced on focus even when not shown: the description is computed from the hidden node.
    expect(button.getAttribute("type")).toBe("button");
  });

  it("opens on mouse hover and closes on leave", () => {
    render(<InfoTip label="About X">Tip</InfoTip>);
    const button = screen.getByRole("button", { name: "About X" });
    const root = button.parentElement;
    fireEvent.pointerEnter(root, { pointerType: "mouse" });
    expect(tipFor(button).hidden).toBe(false);
    fireEvent.pointerLeave(root, { pointerType: "mouse" });
    expect(tipFor(button).hidden).toBe(true);
  });

  it("opens on keyboard focus, Escape closes it without moving focus, blur resets it", () => {
    render(<InfoTip label="About X">Tip</InfoTip>);
    const button = screen.getByRole("button", { name: "About X" });
    button.focus();
    fireEvent.focus(button);
    expect(tipFor(button).hidden).toBe(false);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(tipFor(button).hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    fireEvent.blur(button);
    fireEvent.focus(button);
    expect(tipFor(button).hidden).toBe(false);
  });

  it("toggles on tap (touch has no hover) and closes on a tap elsewhere", () => {
    render(
      <div>
        <InfoTip label="About X">Tip</InfoTip>
        <p>elsewhere</p>
      </div>,
    );
    const button = screen.getByRole("button", { name: "About X" });
    // A touch pointer must not count as hover.
    fireEvent.pointerEnter(button.parentElement, { pointerType: "touch" });
    expect(tipFor(button).hidden).toBe(true);
    fireEvent.click(button);
    expect(tipFor(button).hidden).toBe(false);
    fireEvent.pointerDown(screen.getByText("elsewhere"));
    expect(tipFor(button).hidden).toBe(true);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(tipFor(button).hidden).toBe(true);
  });
});

describe("PageHeader and Field carry secondary explanation as an InfoTip", () => {
  it("PageHeader: one-line description stays visible, help becomes a tip beside the h1", () => {
    render(<PageHeader title="Overview" description="One line." help="The long background." />);
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    expect(screen.getByText("One line.")).toBeTruthy();
    const button = screen.getByRole("button", { name: "About Overview" });
    expect(tipFor(button).textContent).toBe("The long background.");
  });

  it("PageHeader without help renders no tip (no change for existing callers)", () => {
    render(<PageHeader title="Overview" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("Field: help is a tip beside the label, hint stays visible under the control", () => {
    render(
      <Field id="qty" label="Quantity" hint="Whole numbers only." help="Counted at the bin.">
        <input />
      </Field>,
    );
    expect(screen.getByLabelText("Quantity")).toBeTruthy();
    expect(screen.getByText("Whole numbers only.").closest("[role=tooltip]")).toBeNull();
    expect(tipFor(screen.getByRole("button", { name: "About Quantity" })).textContent).toBe("Counted at the bin.");
  });
});

describe("Administration Overview — first compact page", () => {
  const manifest = (commit) => async () => ({
    ok: true,
    json: async () => ({ commit, buildTime: "2026-08-10T12:00:00.000Z", environmentId: "taylor-parts-sandbox", environmentRole: "sandbox" }),
  });

  it("each area is one row: a link, a one-line summary and its full description in a tip", () => {
    render(<MemoryRouter><AdministrationOverview fetchImpl={undefined} /></MemoryRouter>);
    const users = screen.getByRole("link", { name: "Users" });
    expect(users.getAttribute("href")).toBe("/administration/users");
    const row = users.closest("li");
    expect(row.textContent).toContain("Employee profiles, roles and access");
    const tip = tipFor(screen.getByRole("button", { name: "About Users" }));
    expect(tip.textContent).toMatch(/Job Roles, Work Eligibility, Operational Scope, Security Roles/);
    for (const name of ["Users", "Roles & Permissions", "Objects", "Workflows", "Data Import", "Audit Logs"]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
      expect(screen.getByRole("button", { name: `About ${name}` })).toBeTruthy();
    }
  });

  it("the 'behind' warning stays in the page, never inside a tip", async () => {
    render(<MemoryRouter><AdministrationOverview fetchImpl={manifest("not-the-running-commit")} /></MemoryRouter>);
    const warning = await waitFor(() => screen.getByTestId("version-status-behind"));
    expect(warning.getAttribute("role")).toBe("alert");
    expect(warning.closest("[role=tooltip]")).toBeNull();
  });
});

describe("Scan chooser — first compact Service page", () => {
  const deps = { hasCapability: (id) => id === RECEIVE_CAPABILITY, receivingReady: true, role: null, technicianId: null, assignedWorkOrderCount: 0 };

  it("the 'why this list' paragraph is the title's tip, not page text", () => {
    render(<ScanWorkspace deps={deps} />);
    const tip = tipFor(screen.getByRole("button", { name: "About Scan" }));
    expect(tip.textContent).toMatch(/shows only workflows you can actually complete/);
  });

  it("each workflow's description stays visible beside its button (a phone has no hover)", () => {
    render(<ScanWorkspace deps={deps} />);
    const lookupDescription = screen.getByText(/nothing is moved, counted or changed/i);
    expect(lookupDescription.closest("[role=tooltip]")).toBeNull();
    expect(lookupDescription.closest("li").querySelector("button")).toBeTruthy();
  });

  it("refusal reasons stay in the page, in their announced region", () => {
    render(<ScanWorkspace deps={deps} />);
    const region = screen.getByRole("region", { name: /not available to you/i });
    expect(within(region).getByRole("heading", { name: "Not Available to You" })).toBeTruthy();
    expect(region.closest("[role=tooltip]")).toBeNull();
    expect(region.querySelectorAll("li").length).toBeGreaterThan(0);
  });
});
