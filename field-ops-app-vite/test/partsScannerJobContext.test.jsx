// CONTEXTUAL SCANNING -- the scanner stays on the job it was opened from.
//
// ============================ THE DEFECT ============================
//
// PartsScanner resolved its target as `active[0]` unconditionally: the FIRST active work order in
// the technician's list, whichever that happened to be.
//
// A technician with three jobs who opened the scanner from inside job two therefore had the part
// recorded against JOB ONE. Silently. The confirmation named job one, and nothing refused it --
// because the server was told a work order the technician genuinely is assigned to, so every
// authorization check passed. The only thing wrong was which job got the part.
//
// That is the worst shape a defect can take on a phone: no error, plausible confirmation, wrong
// record, discovered weeks later when somebody reconciles parts against jobs.
//
// ============================ THE FIX ============================
//
// Opened from a Work Order, the caller passes `workOrderId` and the scanner stays there. Opened
// standalone from the tool tray, nothing is passed and the previous "current job" behaviour is kept
// -- honest, because with no context to inherit the current job is the best available guess.
//
// A supplied id is still matched against the technician's OWN assigned work, so the prop can widen
// nothing: an id that is not theirs resolves to null rather than being trusted.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ role: "technician" }) }));

// THREE active jobs, deliberately. With one job the defect is invisible.
const JOBS = [
  { id: "wo-1", woNumber: "WO-AAA-111", assignedTechId: "TECH-1", status: "WORK_IN_PROGRESS",
    inventorySnapshot: [{ partId: "PRT-1001", sku: "PRT-1001", name: "Fan Motor", qtyPlanned: 4 }] },
  { id: "wo-2", woNumber: "WO-BBB-222", assignedTechId: "TECH-1", status: "WORK_IN_PROGRESS",
    inventorySnapshot: [{ partId: "PRT-1001", sku: "PRT-1001", name: "Fan Motor", qtyPlanned: 4 }] },
  { id: "wo-3", woNumber: "WO-CCC-333", assignedTechId: "TECH-1", status: "WORK_IN_PROGRESS",
    inventorySnapshot: [{ partId: "PRT-1001", sku: "PRT-1001", name: "Fan Motor", qtyPlanned: 4 }] },
];

vi.mock("../src/hooks/useAssignedWorkOrders", () => ({
  useAssignedWorkOrders: () => ({ data: JOBS, loading: false, error: null }),
}));

vi.mock("../src/services/workOrderService", () => ({ updateWorkOrderExecutionData: vi.fn() }));

const { default: PartsScanner } = await import("../src/modules/mobile/PartsScanner.jsx");

afterEach(cleanup);

/**
 * Scan a part. The job the scanner is working against only becomes visible once a scan RESOLVES --
 * which is the point: the label on the result card is what the technician reads before pressing
 * record, and it is the thing that used to name the wrong job.
 */
function scan(code = "PRT-1001") {
  fireEvent.change(screen.getByLabelText("Part or work order code"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
}

const shownJob = () => {
  const text = document.body.textContent ?? "";
  return ["WO-AAA-111", "WO-BBB-222", "WO-CCC-333"].filter((n) => text.includes(n));
};

describe("the scanner inherits the job it was opened from", () => {
  it("OPENED FROM JOB TWO, it works against JOB TWO -- not the first in the list", () => {
    render(<PartsScanner technicianId="TECH-1" workOrderId="wo-2" />);
    scan();
    const shown = shownJob();
    expect(shown, "the scanner must name the job it was opened from").toContain("WO-BBB-222");
    expect(shown, "it must NOT silently fall back to the first active job").not.toContain("WO-AAA-111");
  });

  it("opened from job three, it works against job three", () => {
    render(<PartsScanner technicianId="TECH-1" workOrderId="wo-3" />);
    scan();
    const shown = shownJob();
    expect(shown).toContain("WO-CCC-333");
    expect(shown).not.toContain("WO-AAA-111");
  });

  it("accepts the human-readable WO number as well as the document id", () => {
    // The number is what an operator reads off a screen; the id is what the system stores. A caller
    // holding either should not have to translate.
    render(<PartsScanner technicianId="TECH-1" workOrderId="WO-CCC-333" />);
    scan();
    expect(shownJob()).toContain("WO-CCC-333");
  });
});

describe("opened standalone", () => {
  it("falls back to the current job, which is the honest guess with no context to inherit", () => {
    render(<PartsScanner technicianId="TECH-1" />);
    scan();
    expect(shownJob()).toContain("WO-AAA-111");
  });
});

describe("the prop widens nothing", () => {
  it("a work order that is NOT the technician's resolves to no job, never to that job", () => {
    // The id is matched against their own assigned work. Trusting a caller-supplied id here would
    // turn a UI convenience into an authorization hole.
    render(<PartsScanner technicianId="TECH-1" workOrderId="wo-belonging-to-someone-else" />);
    scan();
    expect(shownJob(), "no other technician's job may appear").toEqual([]);
  });
});
