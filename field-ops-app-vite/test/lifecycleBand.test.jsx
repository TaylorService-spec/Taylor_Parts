// THE LIFECYCLE BAND, AS RENDERED.
//
// workOrderNorthStar.test.mjs proves the derivations behind the band (which stage is current, what
// each stage recorded). This proves the SURFACE the Work Order design handoff added: that the spine
// is reachable rather than decorative, that the current stage is announced to assistive technology
// and not by colour alone, and that opening a stage shows that stage's fact and only that one.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LifecycleBand from "../src/shared/ui/LifecycleBand.jsx";
import { workOrderSpine, workOrderStageDetail } from "../src/domain/workOrderNorthStar.js";

const detailFor = (workOrder) => (key) => workOrderStageDetail(workOrder, key, () => "Aug 21, 3:12 PM");

function bandFor(workOrder) {
  const spine = workOrderSpine(workOrder.status);
  return render(
    <LifecycleBand
      steps={spine.steps}
      terminal={spine.terminal}
      detailFor={detailFor(workOrder)}
      ariaLabel="Work order lifecycle"
    />,
  );
}

describe("LifecycleBand", () => {
  it("IS A LABELLED LIST OF REACHABLE STAGES, not a decorative strip", () => {
    bandFor({ status: "DISPATCHED", dispatchedAt: {} });
    const band = screen.getByRole("list", { name: "Work order lifecycle" });
    expect(band).toBeTruthy();
    for (const label of ["Created", "Scheduled", "Dispatched", "On site", "Complete", "Closed"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("the CURRENT stage is announced, not signalled by colour alone", () => {
    bandFor({ status: "WORK_IN_PROGRESS" });
    const current = screen.getByRole("button", { name: /On site/ });
    expect(current.getAttribute("aria-current")).toBe("step");
  });

  it("a COMPLETED stage carries a glyph as well as its colour", () => {
    bandFor({ status: "DISPATCHED" });
    expect(screen.getByRole("button", { name: /Created/ }).textContent).toContain("✓");
  });

  it("THE CURRENT STAGE IS OPEN ON MOUNT — the band always says something", () => {
    bandFor({ status: "DISPATCHED", dispatchedAt: {} });
    expect(screen.getByText("You are here.")).toBeTruthy();
  });

  it("opening another stage shows THAT stage’s fact, and only one at a time", () => {
    bandFor({ status: "DISPATCHED", dispatchedAt: {} });
    fireEvent.click(screen.getByRole("button", { name: /Closed/ }));
    expect(screen.getByText("Not reached.")).toBeTruthy();
    expect(screen.queryByText("You are here.")).toBeNull();
  });

  it("clicking the open stage again RETURNS TO THE RECORD rather than closing to a blank strip", () => {
    bandFor({ status: "DISPATCHED", dispatchedAt: {} });
    fireEvent.click(screen.getByRole("button", { name: /Complete/ }));
    fireEvent.click(screen.getByRole("button", { name: /Complete/ }));
    expect(screen.getByText("You are here.")).toBeTruthy();
  });

  it("A CANCELLED RECORD SHOWS ITS TERMINAL OUTCOME, and never as a reached step", () => {
    bandFor({ status: "CANCELLED" });
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancelled" })).toBeNull();
    // Nothing pulses on a record that is over.
    expect(document.querySelector(".ns-chip__pulse")).toBeNull();
  });

  it("renders the tail the composition puts beside the band, when one is supplied", () => {
    render(<LifecycleBand steps={workOrderSpine("CREATED").steps} tail={<span>from SO-1</span>} />);
    expect(screen.getByText("from SO-1")).toBeTruthy();
  });
});
