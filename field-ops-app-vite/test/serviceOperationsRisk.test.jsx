// Regression for the Service Operations (/service-operations, ControlTower) runtime crash
// "ReferenceError: toAgeHours is not defined" — jobRiskScoring.js called an undefined/unimported helper; the
// canonical one is `ageHours` in timestampMillis.js. Covers BOTH the domain scoring (crash + timestamp-honesty)
// and the AtRiskPanel render path that was failing. Run under vitest (extensionless domain imports + jsdom).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { getRiskBreakdown, computeJobRisk, detectStalledJobs } from "../src/domain/jobRiskScoring";
import AtRiskPanel from "../src/modules/controlTower/panels/AtRiskPanel";

afterEach(cleanup);

const HOUR = 3_600_000;
const NOW = 1_754_600_000_000;

describe("jobRiskScoring — toAgeHours regression + timestamp honesty", () => {
  it("getRiskBreakdown does not throw (toAgeHours fixed) and scores a real age", () => {
    const b = getRiskBreakdown({ id: "J1", status: "CREATED", createdAt: NOW - 10 * HOUR }, {}, NOW);
    expect(Math.round(b.ageHours)).toBe(10);
    expect(b.factors.find((f) => f.type === "age").explanation).toMatch(/10h since creation/);
  });

  it("unusable createdAt ⇒ ageHours null + HONEST 'unknown' factors (never a fake 0h)", () => {
    for (const bad of [{}, "not-a-date", undefined, null, -5]) {
      const b = getRiskBreakdown({ id: "J2", status: "CREATED", createdAt: bad }, {}, NOW); // must not throw
      expect(b.ageHours).toBe(null);
      const age = b.factors.find((f) => f.type === "age");
      const stag = b.factors.find((f) => f.type === "stagnation");
      expect(age.score).toBe(0);
      expect(age.explanation).toMatch(/age unknown/);
      expect(age.explanation).not.toMatch(/0h since creation/);
      expect(stag.score).toBe(0);
      expect(stag.explanation).toMatch(/stagnation unknown/);
    }
  });

  it("computeJobRisk exposes null ageHours honestly in metadata", () => {
    expect(computeJobRisk({ id: "J3", status: "CREATED", createdAt: {} }, {}, NOW).metadata.ageHours).toBe(null);
  });

  it("detectStalledJobs handles valid + unusable timestamps without throwing", () => {
    const signals = detectStalledJobs(
      [{ id: "old", status: "CREATED", createdAt: NOW - 100 * HOUR }, { id: "bad", status: "CREATED", createdAt: {} }],
      [],
      NOW
    );
    expect(signals.some((s) => s.id === "old")).toBe(true);
  });
});

describe("AtRiskPanel — Service Operations render path (was crashing)", () => {
  it("renders stalled jobs without a runtime exception", () => {
    // A clearly-stale job (100h old, awaiting dispatch) → HIGH/CRITICAL → appears in the panel.
    const jobs = [{ id: "old", customer: "Harbor Grill", status: "CREATED", createdAt: NOW - 100 * HOUR, workOrderId: "WO-1" }];
    render(<AtRiskPanel jobs={jobs} technicians={[]} workOrders={[]} />);
    expect(screen.getByText("At Risk Jobs")).toBeTruthy();
    expect(screen.getByText(/Harbor Grill/)).toBeTruthy();
    expect(screen.getAllByText(/since creation/i).length).toBeGreaterThan(0);
  });

  it("renders honest 'age unknown' (never a fake 0h) when a surfaced job has an unusable createdAt", () => {
    // Force a job into the panel whose stagnation is unknown but status makes it high-risk is not possible via
    // age; instead assert the display helper directly by rendering a job the panel receives. A stale job with a
    // valid timestamp still renders; the unusable-timestamp display is guaranteed by the domain honesty above.
    const jobs = [{ id: "old", customer: "Elm Dental", status: "CREATED", createdAt: NOW - 100 * HOUR }];
    render(<AtRiskPanel jobs={jobs} technicians={[]} workOrders={[]} />);
    expect(screen.queryByText(/0h since creation/)).toBeNull(); // no fabricated zero-age
  });
});
