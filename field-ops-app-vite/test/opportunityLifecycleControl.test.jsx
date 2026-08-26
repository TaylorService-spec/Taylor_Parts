// OpportunityLifecycleControl -- component render tests (vitest + jsdom). Exercises the chevron progression
// visual over the ratified stages, that ONLY the legal next transition is actionable, WON only offered from
// DECISION, LOST offered from any open stage, a closed opportunity offers nothing, and a successful
// transition calls onChanged() (authoritative refresh) rather than mutating anything locally.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OpportunityLifecycleControl from "../src/modules/sales/OpportunityLifecycleControl.jsx";

afterEach(cleanup);

const ENABLED = { enabled: true, reason: null };
const DISABLED = { enabled: false, reason: "Writes are not enabled yet." };

function transitionsStub(overrides = {}) {
  return {
    pending: {},
    runTransition: vi.fn().mockResolvedValue({ kind: "applied" }),
    ...overrides,
  };
}

describe("OpportunityLifecycleControl -- chevron rendering", () => {
  it("renders all six ratified stages as chevron steps", () => {
    render(<OpportunityLifecycleControl row={{ stage: "SOLUTION" }} readiness={DISABLED} transitions={transitionsStub()} />);
    for (const label of ["Identified", "Qualifying", "Solution", "Quoting", "Customer review", "Decision"]) {
      expect(screen.getByText(label, { exact: false })).toBeTruthy();
    }
  });

  it("marks completed stages complete, the current stage current, later stages future (via status classes)", () => {
    const { container } = render(<OpportunityLifecycleControl row={{ stage: "SOLUTION" }} readiness={DISABLED} transitions={transitionsStub()} />);
    const steps = [...container.querySelectorAll(".fo-chevrons__step")];
    const byIndex = steps.map((s) => s.className);
    expect(byIndex[0]).toMatch(/is-complete/); // IDENTIFIED
    expect(byIndex[1]).toMatch(/is-complete/); // QUALIFYING
    expect(byIndex[2]).toMatch(/is-current/); // SOLUTION
    expect(byIndex[3]).toMatch(/is-future/); // QUOTING
    expect(byIndex[5]).toMatch(/is-future/); // DECISION
  });

  it("a closed (WON) opportunity shows a positive terminal badge and offers no transitions", () => {
    render(<OpportunityLifecycleControl row={{ stage: "DECISION", outcome: "WON" }} readiness={ENABLED} transitions={transitionsStub()} />);
    expect(screen.getByText("Won")).toBeTruthy();
    expect(screen.getByText(/closed.*no further lifecycle actions/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /mark/i })).toBeNull();
  });

  it("a closed (LOST) opportunity shows a muted terminal badge and offers no transitions", () => {
    render(<OpportunityLifecycleControl row={{ stage: "QUOTING", outcome: "LOST" }} readiness={ENABLED} transitions={transitionsStub()} />);
    expect(screen.getByText("Lost")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /mark/i })).toBeNull();
  });
});

describe("OpportunityLifecycleControl -- only legal transitions are actionable", () => {
  it("an open non-DECISION stage offers Advance (to the immediate next stage) and Mark Lost, never Mark Won", () => {
    render(<OpportunityLifecycleControl row={{ stage: "QUALIFYING" }} readiness={ENABLED} transitions={transitionsStub()} />);
    expect(screen.getByRole("button", { name: /advance to solution/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /mark lost/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /mark won/i })).toBeNull();
  });

  it("only DECISION offers Mark Won (WON is illegal from any earlier stage)", () => {
    render(<OpportunityLifecycleControl row={{ stage: "DECISION" }} readiness={ENABLED} transitions={transitionsStub()} />);
    expect(screen.getByRole("button", { name: /mark won/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /mark lost/i })).toBeTruthy();
    // DECISION is the last stage -- no further Advance is legal.
    expect(screen.queryByRole("button", { name: /advance to/i })).toBeNull();
  });

  it("LOST is offered from an early stage too (legal from any open stage)", () => {
    render(<OpportunityLifecycleControl row={{ stage: "IDENTIFIED" }} readiness={ENABLED} transitions={transitionsStub()} />);
    expect(screen.getByRole("button", { name: /mark lost/i })).toBeTruthy();
  });

  it("write-disabled readiness renders the Advance/Mark buttons but DISABLED, with the honest reason", () => {
    render(<OpportunityLifecycleControl row={{ stage: "DECISION" }} readiness={DISABLED} transitions={transitionsStub()} />);
    const advance = screen.queryByRole("button", { name: /advance to/i }); // none legal at DECISION anyway
    expect(advance).toBeNull();
    const won = screen.getByRole("button", { name: /mark won/i });
    const lost = screen.getByRole("button", { name: /mark lost/i });
    expect(won.disabled).toBe(true);
    expect(lost.disabled).toBe(true);
    expect(screen.getAllByText(DISABLED.reason).length).toBeGreaterThan(0);
  });
});

describe("OpportunityLifecycleControl -- transitions call the hook and refresh authoritatively", () => {
  it("clicking the legal advance step calls runTransition with the ADVANCE intent, then onChanged on success", async () => {
    const onChanged = vi.fn();
    const transitions = transitionsStub();
    render(<OpportunityLifecycleControl row={{ stage: "IDENTIFIED" }} readiness={ENABLED} transitions={transitions} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /advance to qualifying/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(transitions.runTransition).toHaveBeenCalledWith({ kind: "ADVANCE", toStage: "QUALIFYING" });
  });

  it("clicking Mark Won calls runTransition with the OUTCOME intent", async () => {
    const onChanged = vi.fn();
    const transitions = transitionsStub();
    render(<OpportunityLifecycleControl row={{ stage: "DECISION" }} readiness={ENABLED} transitions={transitions} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /mark won/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(transitions.runTransition).toHaveBeenCalledWith({ kind: "OUTCOME", outcome: "WON" });
  });

  it("a denied/invalid outcome is surfaced honestly and does NOT call onChanged (no fabricated success)", async () => {
    const onChanged = vi.fn();
    const transitions = transitionsStub({
      runTransition: vi.fn().mockRejectedValue(Object.assign(new Error("nope"), { outcome: { kind: "denied", message: "You are not authorized." } })),
    });
    render(<OpportunityLifecycleControl row={{ stage: "IDENTIFIED" }} readiness={ENABLED} transitions={transitions} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /advance to qualifying/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/not authorized/i);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST-WON: the control must show what the Won PRODUCED.
//
// Marking an Opportunity Won creates a Sales Order in the same transaction, and this control
// used to discard that entirely — it called onChanged() and the chevrons flipped to "Closed".
// The single most consequential moment in the sales process reported nothing, leaving the user
// to go and find the order they had just created with no evidence it existed. That is the same
// "coordination invisibility" shape as the unprojected Sales Order back-link, at the moment it
// matters most.
// ─────────────────────────────────────────────────────────────────────────────
describe("OpportunityLifecycleControl -- what the Won produced", () => {
  const DECISION = { stage: "DECISION", outcome: null, ownerEmployeeId: "emp-1", channel: "RETAIL" };

  const wonTransitions = (result) =>
    transitionsStub({ runTransition: vi.fn().mockResolvedValue({ kind: "applied", ...result }) });

  function renderWon(result) {
    const transitions = wonTransitions(result);
    render(
      <MemoryRouter>
        <OpportunityLifecycleControl row={DECISION} readiness={ENABLED} transitions={transitions} onChanged={() => {}} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /mark won/i }));
    return transitions;
  }

  it("names the Sales Order it created and links to it", async () => {
    renderWon({ salesOrderId: "so-1", salesOrderNumber: "SO-2026-0042" });
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/won/i);
    const link = within(status).getByRole("link", { name: "SO-2026-0042" });
    expect(link.getAttribute("href")).toMatch(/so-1$/);
  });

  it("states the absence when the number is missing, and NEVER labels the link with the document id", async () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE. It read `getByRole("link", { name: "so-2" })` and was
    // titled "falls back to the id — a reachable order beats a pretty label", which pinned a
    // DECISIONS #106 / R03 violation in place: a raw Firestore id printed as the link text of the
    // most consequential message in the sales process. The trade-off it described is a false one —
    // the link is reachable either way, because the id is in the href where a routing key belongs.
    // Only the LABEL changed.
    renderWon({ salesOrderId: "so-2", salesOrderNumber: null });
    const status = await screen.findByRole("status");
    const link = within(status).getByRole("link", { name: /reference unavailable/i });
    expect(link.getAttribute("href")).toMatch(/so-2$/);
    expect(status.textContent).not.toContain("so-2");
  });

  it("a RECOVERED order is described as found, never as created", async () => {
    // The Opportunity was already WON and its existing order was reconciled. Claiming a creation
    // that did not happen would be a small lie with real consequences: it invites the user to
    // believe a second order exists.
    renderWon({ salesOrderId: "so-3", salesOrderNumber: "SO-2026-0007", recovered: true });
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/already won/i);
    expect(status.textContent).not.toMatch(/was created/i);
  });

  it("LOST produces no Sales Order acknowledgement, because it creates nothing", async () => {
    const transitions = transitionsStub();
    render(
      <MemoryRouter>
        <OpportunityLifecycleControl row={{ stage: "SOLUTION", outcome: null }} readiness={ENABLED} transitions={transitions} onChanged={() => {}} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /mark lost/i }));
    await waitFor(() => expect(transitions.runTransition).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a Won that reports no Sales Order says nothing rather than inventing one", async () => {
    const transitions = wonTransitions({});
    render(
      <MemoryRouter>
        <OpportunityLifecycleControl row={DECISION} readiness={ENABLED} transitions={transitions} onChanged={() => {}} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /mark won/i }));
    await waitFor(() => expect(transitions.runTransition).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });
});
