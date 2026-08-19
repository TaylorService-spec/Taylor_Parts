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
    // Governed WorkOrder docs carry `woNumber`, never `customer` (see functions/src/types/workOrder.ts) —
    // fixtures here match that real shape rather than a legacy `customer` field.
    const jobs = [{ id: "old", woNumber: "WO-2026-000042", status: "CREATED", createdAt: NOW - 100 * HOUR, workOrderId: "WO-1" }];
    render(<AtRiskPanel jobs={jobs} technicians={[]} workOrders={[]} />);
    expect(screen.getByText("At Risk Jobs")).toBeTruthy();
    expect(screen.getByText(/WO-2026-000042/)).toBeTruthy();
    expect(screen.getAllByText(/since creation/i).length).toBeGreaterThan(0);
  });

  it("renders a real age for a valid timestamp — never a fabricated leading 0h", () => {
    // A stale job with a VALID timestamp renders a real age. NOTE: AtRiskPanel derives age from live
    // Date.now() (not the test's NOW), so the displayed hour count is large and drifts over real time — the
    // assertion must therefore be robust to that. The honesty being guarded is "no fabricated ZERO age":
    // a real count like 8870h legitimately contains the substring "0h", so anchor with \b so only a genuine
    // leading "0h since creation" (a fabricated zero) can match. The unusable-timestamp ⇒ "age unknown" path
    // is covered deterministically by the domain tests above.
    const jobs = [{ id: "old", woNumber: "WO-2026-000043", status: "CREATED", createdAt: NOW - 100 * HOUR }];
    render(<AtRiskPanel jobs={jobs} technicians={[]} workOrders={[]} />);
    expect(screen.getAllByText(/since creation/i).length).toBeGreaterThan(0); // a real age renders
    expect(screen.queryByText(/\b0h since creation/)).toBeNull(); // no fabricated zero-age
  });

  it("labels a governed WorkOrder (no `customer` field) with its woNumber, not the raw Firestore doc id", () => {
    // Regression: a real WorkOrder doc has no `customer` field (only `customerId`), so a label built as
    // `job.customer || job.id` always fell back to the opaque auto-generated doc id. A dispatcher scanning
    // this panel must see a human-readable work order number, never a raw id like this one.
    const rawDocId = "aZ9xK2mQpL7vT4wR8nJc";
    const jobs = [
      { id: rawDocId, woNumber: "WO-2026-000099", customerId: "cust-1", status: "CREATED", createdAt: NOW - 100 * HOUR },
    ];
    render(<AtRiskPanel jobs={jobs} technicians={[]} workOrders={[]} />);
    expect(screen.getByText(/WO-2026-000099/)).toBeTruthy();
    expect(screen.queryByText(new RegExp(rawDocId))).toBeNull();
  });
});
