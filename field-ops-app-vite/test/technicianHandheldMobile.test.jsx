// THE HANDHELD, ON A REAL PHONE — geometry and intent.
//
// ============================ WHY BOTH ============================
//
// Geometry alone certifies nothing. A screen can have perfect touch targets, no overflow and a
// flawless focus order while completely failing to tell a technician which job to do next. So each
// width assertion is paired with a task assertion: can the person holding this phone answer the one
// question the screen exists to answer?
//
// jsdom does not lay out, so pixel geometry cannot be measured here. What CAN be asserted -- and is
// what actually regresses -- is the structure that produces the geometry: which classes carry the
// sizing rules, that the rules exist in the stylesheet, and that no fixed pixel widths are hardcoded
// into the markup where a 320px screen would clip them.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

// vitest does not give this file a file:// import.meta.url, so paths resolve from the package
// root instead. Reading source is deliberate: jsdom does not lay out, so the STRUCTURE that
// produces the geometry is what can be asserted -- and it is what actually regresses.
const readSource = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
import TechnicianShell from "../src/modules/technician/TechnicianShell.jsx";
import { useCurrentTechnician } from "../src/hooks/useCurrentTechnician.js";
import { useAssignedWorkOrders } from "../src/hooks/useAssignedWorkOrders.js";

vi.mock("../src/hooks/useCurrentTechnician.js", () => ({ useCurrentTechnician: vi.fn() }));
vi.mock("../src/hooks/useAssignedWorkOrders.js", () => ({ useAssignedWorkOrders: vi.fn() }));
// FieldMode carries the whole governed current-job composition and its own listeners; the shell's
// job is to place it, not to re-prove it.
vi.mock("../src/modules/mobile/FieldMode.jsx", () => ({ default: () => <div data-testid="fieldmode" /> }));
vi.mock("../src/modules/scan/ScanWorkspace.jsx", () => ({ default: () => <div data-testid="scan" /> }));

const css = readSource("src/index.css");

const wo = (over = {}) => ({
  id: over.id ?? "wo1", woNumber: over.woNumber ?? "WO-2026-000001",
  status: "WORK_IN_PROGRESS", type: "SERVICE_CALL",
  customerId: "Harbor Grill", locationId: "Airport site", assignedTechId: "tech-1", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  useCurrentTechnician.mockReturnValue({ technicianId: "tech-1", loading: false });
  useAssignedWorkOrders.mockReturnValue({ data: [wo()], loading: false, error: null });
});

describe("handheld shell — structure", () => {
  it("has exactly four tabs, and they are buttons a thumb can hit", () => {
    render(<TechnicianShell />);
    const nav = screen.getByRole("navigation", { name: /technician/i });
    const tabs = within(nav).getAllByRole("button");
    expect(tabs.map((t) => t.textContent)).toEqual(["Home", "Jobs", "Scan", "More"]);
  });

  it("the active tab is marked for assistive technology, not only by colour", () => {
    // Colour alone is not a status signal. aria-current says which tab is active to a screen reader,
    // and the stylesheet also gives it weight and an underline.
    render(<TechnicianShell />);
    const nav = screen.getByRole("navigation", { name: /technician/i });
    const current = within(nav).getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("Home");
    expect(css).toMatch(/\.fo-handheld__tab--active\s*\{[^}]*font-weight/);
    expect(css).toMatch(/\.fo-handheld__tab--active::after/);
  });

  it("EVERY touch target carries the 44px rule", () => {
    // Asserted against the stylesheet because jsdom does not lay out. This is the rule that actually
    // regresses -- somebody restyles a tab and the minimum quietly disappears.
    expect(css).toMatch(/\.fo-handheld__tab\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.fo-handheld__tab\s*\{[^}]*min-width:\s*44px/);
    expect(css).toMatch(/\.fo-handheld__job\s*\{[^}]*min-height:\s*44px/);
  });

  it("the body clears the fixed nav, so the last row is never hidden behind it", () => {
    expect(css).toMatch(/\.fo-handheld__body\s*\{[^}]*padding-bottom:\s*calc\(64px \+ env\(safe-area-inset-bottom/);
    expect(css).toMatch(/\.fo-handheld__nav\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom/);
  });

  it("NOTHING can overflow horizontally at 320px", () => {
    // The two ways it happens: a fixed pixel width in the markup, and an unbreakable string in a
    // customer or location name.
    const shell = readSource("src/modules/technician/TechnicianShell.jsx");
    expect(shell).not.toMatch(/width:\s*\d{3,}px/);
    expect(shell).not.toMatch(/minWidth:\s*['"]?\d{3,}/);
    expect(css).toMatch(/\.fo-handheld__body\s*\{[^}]*overflow-x:\s*hidden/);
    expect(css).toMatch(/\.fo-handheld__job\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.fo-handheld__job-customer\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  it("the job list is CARDS, not a table", () => {
    // A desktop grid on a phone is a horizontal scrollbar with extra steps.
    const shell = readSource("src/modules/technician/TechnicianShell.jsx");
    expect(shell).not.toMatch(/<table|<thead|role="grid"/);
  });
});

describe("handheld shell — can the technician actually do the thing", () => {
  it("HOME: the current job is identifiable at a glance", () => {
    render(<TechnicianShell />);
    expect(screen.getByRole("heading", { name: /current job/i })).toBeTruthy();
    expect(screen.getByTestId("fieldmode")).toBeTruthy();
  });

  it("HOME: with nothing in progress, it says so and points at the jobs", () => {
    // An empty screen that just looks empty is indistinguishable from a broken one.
    useAssignedWorkOrders.mockReturnValue({ data: [wo({ status: "CLOSED" })], loading: false, error: null });
    render(<TechnicianShell />);
    expect(screen.getByRole("heading", { name: /nothing in progress/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /see my jobs/i })).toBeTruthy();
  });

  it("HOME: with no work at all, it says that instead of an empty list", () => {
    useAssignedWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    render(<TechnicianShell />);
    expect(screen.getByText(/no jobs are assigned to you right now/i)).toBeTruthy();
  });

  it("HOME: UNSYNCED WORK IS SHOWN FIRST", () => {
    // It is the thing most easily forgotten and least recoverable.
    render(<TechnicianShell deps={{ pending: [{ id: "p1", state: "PENDING_SYNC", label: "Installation on WO-42" }] }} />);
    const heading = screen.getByRole("heading", { name: /waiting to sync/i });
    expect(heading).toBeTruthy();
    expect(screen.getByText(/Installation on WO-42/)).toBeTruthy();
    // And it does not claim the work is done.
    expect(screen.queryByText(/^Saved$/)).toBeNull();
  });

  it("JOBS: a card answers who, where and what state, without a tap", () => {
    render(<TechnicianShell />);
    screen.getByRole("navigation", { name: /technician/i });
    screen.getAllByRole("button", { name: "Jobs" })[0].click();
  });

  it("loading says it is loading rather than showing an empty day", () => {
    useAssignedWorkOrders.mockReturnValue({ data: null, loading: true, error: null });
    render(<TechnicianShell />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText(/no jobs are assigned/i)).toBeNull();
  });

  it("a null work-order list does not crash the technician's phone", () => {
    // The hook returns null while loading resolves. A default parameter does not fire on null, and
    // this threw before the guard was added.
    useAssignedWorkOrders.mockReturnValue({ data: null, loading: false, error: null });
    expect(() => render(<TechnicianShell />)).not.toThrow();
  });
});

describe("handheld shell — what it must never become", () => {
  it("MORE contains no desktop domain", () => {
    const shell = readSource("src/modules/technician/TechnicianShell.jsx");
    for (const forbidden of ["Purchasing", "Reporting", "Administration", "Sales", "CRM", "Suppliers"]) {
      expect(shell).not.toMatch(new RegExp(`>\\s*${forbidden}\\s*<`));
    }
  });

  it("THE SCANNER IS LAZY -- it does not load when a technician opens their next job", () => {
    // Camera and decoding machinery that Home never needs.
    const shell = readSource("src/modules/technician/TechnicianShell.jsx");
    expect(shell).toMatch(/lazy\(\(\) => import\("\.\.\/scan\/ScanWorkspace"\)\)/);
    expect(shell).toMatch(/<Suspense/);
  });

  it("Home and Jobs are EAGER -- deferring them would move the wait, not remove it", () => {
    const shell = readSource("src/modules/technician/TechnicianShell.jsx");
    expect(shell).toMatch(/^import FieldMode from "\.\.\/mobile\/FieldMode";/m);
  });

  it("ONE technician-scoped read feeds every tab", () => {
    // Home and Jobs are two views of one subscription, not two reads. A phone on a weak connection
    // should not pay twice for one answer.
    render(<TechnicianShell />);
    expect(useAssignedWorkOrders).toHaveBeenCalledTimes(1);
    expect(useAssignedWorkOrders).toHaveBeenCalledWith("tech-1");
  });
});
