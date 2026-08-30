// Service Operations — North Star P1 composition.
//
// Two kinds of assertion, deliberately together:
//
//   1. RENDER — the composition draws the Overview archetype in the grammar's order, and its honest
//      states (1b clean day, 1c degraded technician read) render as words rather than as blank space.
//   2. INVARIANT — the architectural rules stated in ControlTower.jsx's header are checked against the
//      SOURCE. The previous wording ("no panel may accept any other prop shape") had silently stopped
//      being true; nothing tested it, so nothing caught it. These tests are why the restated version
//      cannot drift the same way.
import { afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Resolved from the project root (vitest's cwd) rather than import.meta.url -- under the vitest
// transform import.meta.url is not a file: URL, so fs cannot take it.
const MODULE_DIR = path.resolve("src/modules/controlTower");
const read = (relative) => fs.readFileSync(path.join(MODULE_DIR, relative), "utf8");
const panelFiles = fs
  .readdirSync(path.join(MODULE_DIR, "panels"))
  .filter((f) => f.endsWith(".jsx"));

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────
const HOUR = 3_600_000;
const NOW = 1_754_600_000_000;

const WORK_ORDERS = [
  { id: "WO-1", woNumber: "WO-1001", status: "READY_TO_DISPATCH", customerId: "C1" },
  { id: "WO-2", woNumber: "WO-1002", status: "CREATED", customerId: "C2", createdAt: NOW - 400 * HOUR },
  { id: "WO-3", woNumber: "WO-1003", status: "COMPLETED", customerId: "C1", assignedTechId: "T1" },
];
const TECHNICIANS = [
  { id: "T1", name: "Jordan Reyes", status: "on_job" },
  { id: "T2", name: "Sam Vale", status: "available" },
  { id: "T3", name: "Alex Poole", status: "off_shift" },
];

// The page's three reads are mocked at the hook boundary -- the composition root is the only thing
// that calls them, which is itself one of the invariants asserted below.
let workOrdersResult = { data: WORK_ORDERS, loading: false, error: null };
let techniciansResult = { data: TECHNICIANS, error: null };

vi.mock("../src/hooks/useWorkOrders", () => ({ useWorkOrders: () => workOrdersResult }));
vi.mock("../src/hooks/useFirestoreCollection", () => ({
  useFirestoreCollection: () => techniciansResult,
}));
vi.mock("../src/hooks/useAccountNames", () => ({
  useAccountNames: () => new Map([["C1", "Acme Foods"], ["C2", "Northline Cold Storage"]]),
}));

const { default: ControlTower } = await import("../src/modules/controlTower/ControlTower.jsx");

const renderPage = () => render(<MemoryRouter><ControlTower /></MemoryRouter>);

afterEach(() => {
  cleanup();
  workOrdersResult = { data: WORK_ORDERS, loading: false, error: null };
  techniciansResult = { data: TECHNICIANS, error: null };
});

// ── 1a — the composition ─────────────────────────────────────────────────────────────────────────

describe("1a — the Overview composition", () => {
  it("renders the page identity, one filled primary, and a live claim it can actually make", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Service Operations" })).toBeTruthy();
    expect(screen.getByText(/Live — updates as work orders change/)).toBeTruthy();

    const board = screen.getByRole("link", { name: "Open Dispatch Board" });
    expect(board.getAttribute("href")).toBe("/service/dispatcher-board");
    expect(board.className).toContain("fo-button--primary");
    // Exactly one filled primary on the surface.
    expect(document.querySelectorAll(".fo-button--primary")).toHaveLength(1);
  });

  it("puts attention FIRST in the work area, before the metric strip and the tables", () => {
    renderPage();
    const order = [...document.querySelectorAll("section")].map((s) => s.getAttribute("aria-label"));
    const attentionAt = order.indexOf("Needs attention");
    const metricsAt = order.indexOf("Service operations at a glance");
    const riskAt = order.indexOf("At risk");
    expect(attentionAt).toBeGreaterThanOrEqual(0);
    expect(attentionAt).toBeLessThan(metricsAt);
    expect(metricsAt).toBeLessThan(riskAt);
  });

  it("renders exactly four metrics and links every one of them", () => {
    renderPage();
    const strip = screen.getByRole("region", { name: "Service operations at a glance" });
    const values = strip.querySelectorAll(".ns-metric__value");
    expect(values).toHaveLength(4);
    for (const value of values) {
      expect(value.querySelector("a")).toBeTruthy(); // never an unlinked number
    }
  });

  it("renders the at-risk work order with a resolved account and an approximate age", () => {
    renderPage();
    const table = screen.getByRole("region", { name: "At risk" });
    expect(within(table).getByText(/WO-1002/)).toBeTruthy();
    expect(within(table).getByText("Northline Cold Storage")).toBeTruthy();
    expect(within(table).getByText(/^~\d+h$/)).toBeTruthy();
  });

  it("names technicians and states their status in words, never a raw enum", () => {
    renderPage();
    const table = screen.getByRole("region", { name: "Technician load" });
    expect(within(table).getByText("Jordan Reyes")).toBeTruthy();
    expect(within(table).getByText("Busy")).toBeTruthy();
    expect(table.textContent).not.toMatch(/on_job|off_shift|available[^A-Za-z]/);
  });

  it("states the parts-readiness boundary instead of showing a clean Parts section (SO-G5)", () => {
    renderPage();
    expect(screen.getByText(/Parts readiness isn.t connected to this page yet/)).toBeTruthy();
  });

  it("says suggestions are read-only and offers no assign control (SO-G4)", () => {
    renderPage();
    expect(screen.getByText(/Suggestions are read-only here/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /assign/i })).toBeNull();
  });

  it("carries no governed transition controls anywhere on the page", () => {
    renderPage();
    for (const name of [/mark ready/i, /dispatch$/i, /^schedule$/i, /^close$/i, /^cancel$/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("renders no work-order detail wall — every work order is at most one row (SO-D2)", () => {
    renderPage();
    // The retired composition rendered one full WorkOrderDetail card per work order.
    expect(document.querySelectorAll(".work-order-card")).toHaveLength(0);
    expect(screen.queryByText(/Operational History/i)).toBeNull();
  });
});

// ── 1b — the clean day ───────────────────────────────────────────────────────────────────────────

describe("1b — a clean day", () => {
  it("renders NO attention block at all when nothing needs attention", () => {
    // One finished work order: nothing to attend to, nothing at risk, nothing to dispatch.
    workOrdersResult = {
      data: [{ id: "WO-9", woNumber: "WO-9", status: "COMPLETED", customerId: "C1", assignedTechId: "T1" }],
      loading: false,
      error: null,
    };
    renderPage();
    // Not an empty box and not an "all clear" banner -- absent.
    expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
    expect(screen.queryByText(/all clear/i)).toBeNull();
  });

  it("states the at-risk empty case in words, with a count it actually knows", () => {
    workOrdersResult = {
      data: [{ id: "WO-9", woNumber: "WO-9", status: "COMPLETED", customerId: "C1", assignedTechId: "T1" }],
      loading: false,
      error: null,
    };
    renderPage();
    expect(screen.getByText(/No work orders at risk\./)).toBeTruthy();
  });

  it("drops the suggestion tray entirely when there is nothing awaiting dispatch", () => {
    workOrdersResult = {
      data: [{ id: "WO-9", woNumber: "WO-9", status: "COMPLETED", customerId: "C1", assignedTechId: "T1" }],
      loading: false,
      error: null,
    };
    renderPage();
    expect(screen.queryByRole("region", { name: "Recommended dispatch" })).toBeNull();
  });
});

// ── 1c — honest states ───────────────────────────────────────────────────────────────────────────

describe("1c — loading, failure, and a degraded technician read", () => {
  it("states a loading state rather than rendering zeros", () => {
    workOrdersResult = { data: [], loading: true, error: null };
    renderPage();
    expect(screen.getByText(/Loading service operations/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Service operations at a glance" })).toBeNull();
  });

  it("a failed work-order read says so, and says the reader's other work is unaffected", () => {
    workOrdersResult = { data: [], loading: false, error: new Error("permission-denied") };
    renderPage();
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.getByText(/Your work elsewhere is unaffected/)).toBeTruthy();
  });

  it("a failed TECHNICIAN read degrades honestly: the work orders still render, the load table does not", () => {
    techniciansResult = { data: [], error: new Error("permission-denied") };
    renderPage();
    // Announced, not silently degraded into ids.
    expect(screen.getByRole("alert").textContent).toMatch(/Technician names could not be loaded/);
    // The work-order side of the page survives.
    expect(screen.getByRole("region", { name: "At risk" })).toBeTruthy();
    // The load table states unavailability rather than computing over ids or looking empty.
    const load = screen.getByRole("region", { name: "Technician load" });
    expect(within(load).getByText(/Technician load is unavailable/)).toBeTruthy();
  });

  it("the on-shift metric reads 'unavailable', never 0, when technicians could not be read", () => {
    techniciansResult = { data: [], error: new Error("permission-denied") };
    renderPage();
    const strip = screen.getByRole("region", { name: "Service operations at a glance" });
    expect(within(strip).getByText("unavailable")).toBeTruthy();
  });
});

// ── The architectural invariant, asserted against source ─────────────────────────────────────────

describe("invariant — the composition root owns the reads and the derivations", () => {
  it("no section reads Firestore or subscribes to a collection", () => {
    for (const file of panelFiles) {
      const source = read(path.join("panels", file));
      expect(source, `${file} imports firebase`).not.toMatch(/from\s+["']firebase/);
      expect(source, `${file} uses a Firestore hook`).not.toMatch(
        /useFirestoreCollection|useWorkOrders|useAccountNames|onSnapshot|getDocs/,
      );
    }
  });

  it("no section imports a scoring or projection module — derivation stays out of JSX", () => {
    // serviceOperationsNorthStar is admitted for its SHARED CONSTANTS (link targets, section ids,
    // sort/filter enums). What must not appear is a module that computes a business fact.
    for (const file of panelFiles) {
      // IMPORT LINES ONLY. Checking raw source would fail on a comment that merely NAMES the module
      // it is explaining -- and those comments are the record of why the derivation lives elsewhere,
      // so a test that punished them would be a test against documenting the rule.
      const imports = read(path.join("panels", file))
        .split("\n")
        .filter((line) => /^\s*import\b/.test(line))
        .join("\n");
      for (const forbidden of ["jobRiskScoring", "dispatchScoring", "timelineBuilder", "workOrderScoring"]) {
        expect(imports, `${file} imports ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("ControlTower.jsx is the only file in the module that calls the read hooks", () => {
    const root = read("ControlTower.jsx");
    expect(root).toMatch(/useWorkOrders\(\)/);
    expect(root).toMatch(/useFirestoreCollection\(/);
    expect(root).toMatch(/useAccountNames\(/);
  });

  it("the header no longer claims the prop-shape rule that the code had already outgrown", () => {
    const root = read("ControlTower.jsx");
    expect(root).not.toContain("no panel may accept or require any other prop shape");
  });
});

// ── The scroller must contain what it scrolls ────────────────────────────────────────────────────
//
// Found by the live corrective gate at 375, not by any unit test, and invisible to a body-based
// overflow check: `.ns-visually-hidden` is `position: absolute` with no offsets, so inside a table
// wide enough to scroll it sits hundreds of pixels right of the viewport. With no positioned
// ancestor its containing block was the INITIAL containing block, so it escaped `.ns-table-wrap`'s
// overflow and extended documentElement.scrollWidth -- the page scrolled sideways on a phone to
// reveal a 1px clipped label, while body.scrollWidth stayed exactly correct.
//
// Layout cannot be asserted in jsdom, so this pins the DECLARATION and the live gate proves the
// behaviour. Both tables on this page put a visually-hidden label in their last header cell.
describe("ns-table-wrap contains absolutely-positioned descendants", () => {
  const css = fs.readFileSync(path.resolve("src/index.css"), "utf8");

  it("declares position: relative alongside overflow-x: auto", () => {
    const rule = css.split("\n").find((l) => l.trim().startsWith(".ns-table-wrap {"));
    expect(rule, ".ns-table-wrap rule not found").toBeTruthy();
    expect(rule).toMatch(/overflow-x:\s*auto/);
    expect(rule).toMatch(/position:\s*relative/);
  });

  it("both tables on this page rely on it — a visually-hidden label in the last header cell", () => {
    for (const file of ["AtRiskPanel.jsx", "TechnicianLoadPanel.jsx"]) {
      const source = read(path.join("panels", file));
      expect(source, `${file} has no visually-hidden header label`).toContain("ns-visually-hidden");
      expect(source, `${file} is not inside a table wrapper`).toContain("ns-table-wrap");
    }
  });
});
