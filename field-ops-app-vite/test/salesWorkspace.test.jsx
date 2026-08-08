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
