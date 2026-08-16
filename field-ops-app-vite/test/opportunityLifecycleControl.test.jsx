// OpportunityLifecycleControl -- component render tests (vitest + jsdom). Exercises the chevron progression
// visual over the ratified stages, that ONLY the legal next transition is actionable, WON only offered from
// DECISION, LOST offered from any open stage, a closed opportunity offers nothing, and a successful
// transition calls onChanged() (authoritative refresh) rather than mutating anything locally.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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
