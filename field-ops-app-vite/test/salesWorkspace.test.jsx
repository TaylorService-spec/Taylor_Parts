// Sales Opportunity Operating Workspace (Cycle 2) — RENDER tests (vitest + jsdom). Exercises the read-first
// pipeline over the injected SYNTHETIC source: open opportunities appear (closed excluded from the queue),
// attention sorts to the top, selecting a row drives the detail aside, and the write affordance is inert.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import SalesWorkspace from "../src/modules/sales/SalesWorkspace.jsx";
import { opportunityEntity, opportunityIndexList } from "../src/metadata/definitions/opportunity.js";

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

  // Owner-reported gap: the queue showed WHAT state an Opportunity was in, never HOW FAR ALONG it
  // was. Stage chevrons existed only in the detail panel, so the pipeline -- the surface actually
  // scanned -- carried no progression at all. These pin the compact track on the list rows.
  it("shows a stage progression on each pipeline row, not just a state pill", () => {
    render(<SalesWorkspace />);
    const table = screen.getByRole("table");
    const row = within(table).getByText("Northgate Grocery").closest("tr");
    // The summary names the current stage AND its position, which is the progression information the
    // state pill alone could never carry.
    expect(within(row).getByText(/stage \d of \d/i)).toBeTruthy();
  });

  it("renders one track segment per stage, marked complete/current/future", () => {
    render(<SalesWorkspace />);
    const table = screen.getByRole("table");
    const row = within(table).getByText("Northgate Grocery").closest("tr");
    const bars = row.querySelectorAll(".fo-stagetrack__bar");
    expect(bars.length).toBeGreaterThan(1);
    // Exactly one current stage -- an open Opportunity is in one place, not several.
    expect(row.querySelectorAll(".fo-stagetrack__bar.is-current").length).toBe(1);
  });

  it("keeps the state pill: the track adds progression, it does not replace state", () => {
    render(<SalesWorkspace />);
    const table = screen.getByRole("table");
    const row = within(table).getByText("Northgate Grocery").closest("tr");
    expect(row.querySelector(".fo-stagetrack")).toBeTruthy();
    expect(row.querySelector(".fo-status-pill, .fo-statuspill, [class*='pill']")).toBeTruthy();
  });

  // The banner previously fired on `status === "ready"`, so a successfully-loaded GOVERNED pipeline told
  // the user its real Opportunities were samples. An honesty banner that fires on real data is worse than
  // none -- it teaches people to disbelieve true records. These pin it to the source's own flag.
  it("does NOT claim synthetic data when the source reports real governed rows", async () => {
    const governed = () => ({
      status: "ready",
      synthetic: false,
      opportunities: [{ id: "opp-live-1", accountId: "acct-harbor", stage: "IDENTIFIED", channel: "RETAIL" }],
      accountNameById: { "acct-harbor": "Harbor Foods" },
      error: null,
    });
    render(<SalesWorkspace source={governed} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(screen.queryByText(/synthetic sample opportunities/i)).toBeNull();
  });

  it("still says so when the source really is synthetic", async () => {
    const fixture = () => ({
      status: "ready",
      synthetic: true,
      opportunities: [{ id: "opp-fix-1", accountId: "acct-harbor", stage: "IDENTIFIED", channel: "RETAIL" }],
      accountNameById: { "acct-harbor": "Harbor Foods" },
      error: null,
    });
    render(<SalesWorkspace source={fixture} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(screen.getByText(/synthetic sample opportunities/i)).toBeTruthy();
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

  // Regression for the confirmed defect: write-readiness alone used to be enough to render Edit as fully
  // live, even though SectionEditForm's own Save is inert without a wired onSaveSection command (App.jsx's
  // production mount never passes one). A capability-holding user could open a section, edit fields, and only
  // discover on submit that Save was disabled. Edit must be gated on BOTH readiness AND a wired save command.
  it("readiness enabled but NO governed save command wired: Edit itself stays disabled + honest (does not invite a dead-end edit)", () => {
    render(<SalesWorkspace readiness={ENABLED} />); // no onSaveSection — mirrors the real production mount
    const editNeed = screen.getByRole("button", { name: /edit customer need/i });
    expect(editNeed.disabled).toBe(true);
    expect(editNeed.title).toMatch(/governed save command is not wired/i);
    // clicking a disabled Edit must not open the section form
    fireEvent.click(editNeed);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("entering a section edit (readiness enabled AND a wired save command) swaps read for a compact form; Cancel returns to read", () => {
    render(<SalesWorkspace readiness={ENABLED} onSaveSection={() => {}} />);
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
    render(<SalesWorkspace readiness={ENABLED} onSaveSection={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /edit customer need/i }));
    // while the need edits, other sections still show their Edit affordance (not all forced into edit)
    expect(screen.getByRole("button", { name: /edit commercial details/i })).toBeTruthy();
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

// New Opportunity create flow -- Wave 7. `readiness` enabled unlocks the button; a real create client is
// injected via `createDeps` so no firebase import is ever touched from a test.
describe("SalesWorkspace (New Opportunity create flow)", () => {
  const ENABLED = { enabled: true, reason: null };

  function createDepsFor(client) {
    return { client, useAccounts: () => ({ data: [{ id: "A1", name: "Northgate Grocery" }], loading: false, error: null }) };
  }

  it("readiness enabled: the New opportunity button is live and opens the create form", () => {
    render(<SalesWorkspace readiness={ENABLED} createDeps={createDepsFor({ createOpportunity: vi.fn() })} />);
    const btn = screen.getByRole("button", { name: /^new opportunity$/i });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(screen.getByRole("dialog", { name: /new opportunity/i })).toBeTruthy();
  });

  it("a successful create closes the form, refetches authoritatively, and selects the new opportunity -- never fabricating the row", async () => {
    let call = 0;
    const source = () => {
      call += 1;
      return call === 1
        ? { status: "ready", opportunities: [{ id: "EXIST-1", accountId: "A1", customerName: "Northgate Grocery", stage: "QUALIFYING" }], accountNameById: {}, error: null }
        : {
            status: "ready",
            opportunities: [
              { id: "EXIST-1", accountId: "A1", customerName: "Northgate Grocery", stage: "QUALIFYING" },
              { id: "NEW-OPP-1", accountId: "A1", customerName: "Northgate Grocery", stage: "IDENTIFIED", need: "Freezer replacement" },
            ],
            accountNameById: {},
            error: null,
          };
    };
    const client = { createOpportunity: vi.fn().mockResolvedValue({ result: { success: true, replayed: false, opportunityId: "NEW-OPP-1", stage: "IDENTIFIED" } }) };
    render(<SalesWorkspace readiness={ENABLED} source={source} createDeps={createDepsFor(client)} />);

    fireEvent.click(screen.getByRole("button", { name: /^new opportunity$/i }));
    fireEvent.change(screen.getByLabelText(/customer account/i), { target: { value: "A1" } });
    fireEvent.change(screen.getByLabelText(/owner \(employee id\)/i), { target: { value: "EMP-1" } });
    fireEvent.change(screen.getByLabelText(/^channel$/i), { target: { value: "RETAIL" } });
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // FLAKE FIX: the dialog closing and the authoritative refetch are SEPARATE async steps, so a
    // bare expect() here raced the refetch and failed intermittently in CI (observed on two
    // unrelated PRs). Waiting for the condition removes the race WITHOUT weakening the assertion:
    // it is still exactly 2, so a missing refetch OR a duplicate refetch still fails.
    await waitFor(() => expect(call).toBe(2)); // the authoritative refetch actually ran
    // The newly created Opportunity's own re-read data now shows in the detail -- not a client-fabricated row.
    await screen.findByText(/Freezer replacement/i);
  });

});

// S-CRM-OPPORTUNITIES — metadata list runtime migration EVALUATED, DECLINED (see the header
// comment block in SalesWorkspace.jsx for the full reasoning: three compounding blockers, any
// one disqualifying on its own). These tests do NOT exercise a migration — they lock the two
// facts of the real `opportunityIndexList`/`opportunityEntity` declarations that this decline
// depends on, so a future change to either definition that would remove the blocker fails here
// loudly and prompts re-evaluation, rather than the decline silently going stale.
describe("SalesWorkspace (metadata list runtime migration — declined, blocking facts locked)", () => {
  it("opportunityIndexList has no Attention/next-action column — this pipeline's real triage signal is not representable through the declared list", () => {
    const fieldIds = opportunityIndexList.columns.map((c) => c.fieldId);
    expect(fieldIds).not.toContain("nextAction");
    expect(fieldIds).not.toContain("attention");
  });

  it("opportunityEntity does not declare a nextAction field at all — there is no column this migration could even ask for", () => {
    const fieldIds = opportunityEntity.fields.map((f) => f.id);
    expect(fieldIds).not.toContain("nextAction");
  });

  it("opportunityEntity's accountId REFERENCE column has no denormalized name field beside it — a real resolveReference would require a second, per-row live read", () => {
    const accountIdField = opportunityEntity.fields.find((f) => f.id === "accountId");
    expect(accountIdField?.type).toBe("REFERENCE");
    const fieldIds = opportunityEntity.fields.map((f) => f.id);
    expect(fieldIds).not.toContain("accountName");
  });
});
