// Regression for the Service Operations (/service-operations, ControlTower) runtime crash
// "ReferenceError: toAgeHours is not defined" — jobRiskScoring.js called an undefined/unimported helper; the
// canonical one is `ageHours` in timestampMillis.js. Covers BOTH the domain scoring (crash + timestamp-honesty)
// and the AtRiskPanel render path that was failing. Run under vitest (extensionless domain imports + jsdom).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { getRiskBreakdown, computeJobRisk, detectStalledJobs } from "../src/domain/jobRiskScoring";
import { MemoryRouter } from "react-router-dom";
import AtRiskPanel from "../src/modules/controlTower/panels/AtRiskPanel";
import { atRiskRows } from "../src/domain/serviceOperationsNorthStar";

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

// ── Render path ──────────────────────────────────────────────────────────────────────────────────
//
// The panel is now a pure presenter: the Service Operations composition root derives rows once via
// domain/serviceOperationsNorthStar.js's atRiskRows() and hands them over. These tests drive the same
// seam the page does — projection first, table second — so what they prove is what a dispatcher sees.
//
// The assertions are the originals, plus what the North Star P1 recomposition added: severity renders
// as a WORD (the panel this replaces printed the raw enum "CRITICAL"), the account resolves to a name,
// and the table is never wrapped in a card.
describe("AtRiskPanel — Service Operations render path (was crashing)", () => {
  const renderTable = (workOrders, { technicians = [], accountNames, sort = "severity" } = {}) =>
    render(
      <MemoryRouter>
        <AtRiskPanel rows={atRiskRows({ workOrders, technicians, accountNames, sort })} sort={sort} />
      </MemoryRouter>,
    );

  it("renders stalled work orders without a runtime exception", () => {
    const workOrders = [{ id: "old", woNumber: "WO-2026-000042", status: "CREATED", createdAt: NOW - 100 * HOUR }];
    renderTable(workOrders);
    expect(screen.getByRole("heading", { name: "At risk" })).toBeTruthy();
    expect(screen.getByText(/WO-2026-000042/)).toBeTruthy();
  });

  it("renders a real age for a valid timestamp — never a fabricated leading 0h", () => {
    // atRiskRows derives age from live Date.now(), so the hour count is large and drifts; the honesty
    // guarded here is "no fabricated ZERO age". A genuine count like ~8870h legitimately contains the
    // substring "0h", so the assertion anchors on the whole cell rather than a substring.
    const workOrders = [{ id: "old", woNumber: "WO-2026-000043", status: "CREATED", createdAt: NOW - 100 * HOUR }];
    renderTable(workOrders);
    expect(screen.getByText(/^~\d+h$/)).toBeTruthy();
    expect(screen.queryByText("~0h")).toBeNull();
  });

  it("labels a governed WorkOrder with its woNumber, not the raw Firestore doc id", () => {
    const rawDocId = "aZ9xK2mQpL7vT4wR8nJc";
    const workOrders = [
      { id: rawDocId, woNumber: "WO-2026-000099", customerId: "cust-1", status: "CREATED", createdAt: NOW - 100 * HOUR },
    ];
    renderTable(workOrders);
    expect(screen.getByText(/WO-2026-000099/)).toBeTruthy();
    expect(screen.queryByText(new RegExp(rawDocId))).toBeNull();
  });

  it("renders severity as a word, never the raw enum", () => {
    const workOrders = [{ id: "old", woNumber: "WO-2026-000044", status: "CREATED", createdAt: NOW - 400 * HOUR }];
    renderTable(workOrders);
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.queryByText("CRITICAL")).toBeNull();
  });

  it("resolves the account name and says 'Unassigned' rather than leaving a blank cell", () => {
    const workOrders = [
      { id: "old", woNumber: "WO-2026-000045", customerId: "C1", status: "CREATED", createdAt: NOW - 400 * HOUR },
    ];
    renderTable(workOrders, { accountNames: new Map([["C1", "Acme Foods"]]) });
    expect(screen.getByText("Acme Foods")).toBeTruthy();
    expect(screen.getByText("Unassigned")).toBeTruthy();
  });

  it("uses the one table pattern and is never wrapped in a card", () => {
    const workOrders = [{ id: "old", woNumber: "WO-2026-000046", status: "CREATED", createdAt: NOW - 400 * HOUR }];
    const { container } = renderTable(workOrders);
    expect(container.querySelector("table.ns-table")).toBeTruthy();
    expect(container.querySelector(".work-order-card")).toBeNull();
    expect(container.querySelector(".fo-card")).toBeNull();
  });

  it("states the empty case in words rather than rendering a blank region", () => {
    renderTable([]);
    expect(screen.getByText(/No work orders at risk\./)).toBeTruthy();
  });
});
