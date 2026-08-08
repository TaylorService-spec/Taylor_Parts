// Sales Opportunity Operating Workspace (Cycle 2) — RENDER tests (vitest + jsdom). Exercises the read-first
// pipeline over the injected SYNTHETIC source: open opportunities appear (closed excluded from the queue),
// attention sorts to the top, selecting a row drives the detail aside, and the write affordance is inert.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import SalesWorkspace from "../src/modules/sales/SalesWorkspace.jsx";

afterEach(cleanup);

describe("SalesWorkspace (read-first pipeline)", () => {
  it("renders the pipeline with open synthetic opportunities and excludes closed ones from the queue", () => {
    render(<SalesWorkspace />);
    expect(screen.getByRole("heading", { name: "Opportunities" })).toBeTruthy();
    const table = screen.getByRole("table");
    // an open opportunity is present in the queue
    expect(within(table).getByText("Northgate Grocery")).toBeTruthy();
    // Riverside Diner is LOST (closed) -> must NOT be a queue row
    expect(within(table).queryByText("Riverside Diner")).toBeNull();
  });

  it("shows an honest synthetic-data banner and an inert (disabled) create control", () => {
    render(<SalesWorkspace />);
    expect(screen.getByText(/synthetic sample opportunities/i)).toBeTruthy();
    const btn = screen.getByRole("button", { name: /new opportunity/i });
    expect(btn.disabled).toBe(true);
  });

  it("surfaces the needs-attention count above the queue", () => {
    render(<SalesWorkspace />);
    // fixtures include a QUOTING opp with no next action + DECISION opps => attention > 0
    expect(screen.getByText(/need attention/i)).toBeTruthy();
  });

  it("selecting a pipeline row updates the detail aside", () => {
    render(<SalesWorkspace />);
    const table = screen.getByRole("table");
    const row = within(table).getByText("Metro School District").closest("tr");
    fireEvent.click(row);
    // the detail aside now shows this opportunity's need
    expect(screen.getByText(/Cafeteria refresh/i)).toBeTruthy();
  });

  it("pipeline rows are keyboard-operable (SALES-001 accessibility fix): role, tabindex, Enter selects", () => {
    render(<SalesWorkspace />);
    const table = screen.getByRole("table");
    const metroCell = within(table).getByText("Metro School District");
    const row = metroCell.closest("tr");
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("tabindex")).toBe("0");
    // Enter selects the row → its detail (customer need) renders in the aside
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByText(/Cafeteria refresh/i)).toBeTruthy();
  });

  it("surfaces the ratified lifecycle actions as DISABLED, honest affordances (write-readiness seam)", () => {
    render(<SalesWorkspace />);
    // Select an IDENTIFIED opportunity (Metro School District) — it offers a forward Advance + Mark Lost.
    const table = screen.getByRole("table");
    fireEvent.click(within(table).getByText("Metro School District").closest("tr"));
    const advance = screen.getByRole("button", { name: /advance to qualifying/i });
    expect(advance.disabled).toBe(true);
    const markLost = screen.getByRole("button", { name: /mark lost/i });
    expect(markLost.disabled).toBe(true);
    // the honest reason is shown (governed write built but inactive), not a silent dead button
    expect(screen.getAllByText(/not enabled yet/i).length).toBeGreaterThan(0);
  });
});

// EDITING-READY composition. The detail pane is built to become an OPERATING surface: editable sections carry
// contextual, section-level edit affordances that are fail-closed (disabled/honest) until the write-readiness
// seam flips. These tests exercise the composition WITHOUT activating anything — readiness is injected.
describe("SalesWorkspace (editing-ready detail composition)", () => {
  const DISABLED = { enabled: false, reason: "Editing is not enabled yet — governed write path inactive." };
  const ENABLED = { enabled: true, reason: null };

  it("reads by default: editable sections show a DISABLED Edit affordance (no wall of form controls)", () => {
    render(<SalesWorkspace readiness={DISABLED} />);
    // detail renders the first pipeline row; the editable sections expose Edit buttons, all disabled + honest
    const editButtons = screen.getAllByRole("button", { name: /^edit /i });
    expect(editButtons.length).toBeGreaterThan(0);
    editButtons.forEach((b) => expect(b.disabled).toBe(true));
    // no edit form is present in the read state (no textbox/spinbutton standing controls)
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("entering a section edit (readiness enabled) swaps read for a compact form; Cancel returns to read", () => {
    render(<SalesWorkspace readiness={ENABLED} />);
    // Customer need is an editable section; enter its edit mode
    const editNeed = screen.getByRole("button", { name: /edit customer need/i });
    expect(editNeed.disabled).toBe(false);
    fireEvent.click(editNeed);
    // the section form is now present (a textbox for the need); a Save + Cancel are offered
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeTruthy();
    // Cancel returns to read (no standing controls)
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("only one section edits at a time (section-level editing, not a whole-detail form)", () => {
    render(<SalesWorkspace readiness={ENABLED} />);
    fireEvent.click(screen.getByRole("button", { name: /edit customer need/i }));
    // while the need edits, other sections still show their Edit affordance (not all forced into edit)
    expect(screen.getByRole("button", { name: /edit commercial details/i })).toBeTruthy();
  });

  it("save stays inert when readiness is enabled but no governed command is wired", () => {
    render(<SalesWorkspace readiness={ENABLED} />); // no onSaveSection
    fireEvent.click(screen.getByRole("button", { name: /edit customer need/i }));
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save.disabled).toBe(true); // command not wired => honest, inert
  });

  it("with readiness enabled AND a wired command, saving hands the section draft to the governed command", () => {
    const saved = [];
    render(<SalesWorkspace readiness={ENABLED} onSaveSection={(id, draft) => saved.push([id, draft])} />);
    fireEvent.click(screen.getByRole("button", { name: /edit customer need/i }));
    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "Revised need text" } });
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(saved.length).toBe(1);
    expect(saved[0][0]).toBe("need");
    expect(saved[0][1]).toEqual({ need: "Revised need text" });
  });

  it("system-derived + read-only sections expose NO edit affordance", () => {
    render(<SalesWorkspace readiness={ENABLED} />);
    // attention (derived) and record (audit) must not offer an Edit button
    expect(screen.queryByRole("button", { name: /edit needs attention/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /edit record/i })).toBeNull();
  });
});

// PIPELINE RESPONSIVE CONTENT PRIORITY. The original observed defect was at intermediate width: the 6-column
// pipeline overflowed its grid cell and collided with the detail rail. The fix recomposes narrower widths via
// an overflow-safe wrapper + a content-priority strategy (defer Channel + Expected close — both shown in the
// detail) + a phone block recomposition. jsdom has no layout engine, so these lock the STRUCTURE that drives
// the responsive CSS (the actual geometry was verified in a real browser at ~400/768/900/1360 widths).
describe("SalesWorkspace (pipeline responsive content priority)", () => {
  it("wraps the pipeline in an overflow-safe container so it can never overlap the detail rail", () => {
    const { container } = render(<SalesWorkspace />);
    const table = container.querySelector("table.fo-sales-pipeline");
    expect(table).toBeTruthy();
    expect(table.closest(".fo-sales-pipeline-wrap")).toBeTruthy();
  });

  it("marks the lower-priority columns (Channel, Expected close) as secondary/deferrable in header and rows", () => {
    const { container } = render(<SalesWorkspace />);
    // both header cells flagged
    const secHeaders = [...container.querySelectorAll("thead th.fo-sales-col--secondary")].map((th) => th.textContent);
    expect(secHeaders).toEqual(["Channel", "Expected close"]);
    // and every row's Channel + Expected close cells flagged (2 per row)
    const firstRow = container.querySelector("tbody tr");
    const secCells = firstRow.querySelectorAll("td.fo-sales-col--secondary");
    expect(secCells.length).toBe(2);
    // the priority columns are NOT flagged secondary
    expect(firstRow.querySelector("td.fo-sales-row__customer").classList.contains("fo-sales-col--secondary")).toBe(false);
    expect(firstRow.querySelector("td.fo-sales-row__value").classList.contains("fo-sales-col--secondary")).toBe(false);
  });

  it("labels every pipeline cell (data-label) so the phone block recomposition stays legible", () => {
    const { container } = render(<SalesWorkspace />);
    const labels = [...container.querySelectorAll("tbody tr:first-child td")].map((td) => td.getAttribute("data-label"));
    expect(labels).toEqual(["Customer", "Stage", "Channel", "Est. value", "Expected close", "Attention / next"]);
  });
});
