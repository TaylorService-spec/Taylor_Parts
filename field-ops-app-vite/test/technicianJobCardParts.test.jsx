// DISPLAY BATCH (Finley proof, 2026-10-19): the Jobs card said "parts unknown" for a job with no parts planned. The governed field
// context STATES the plan (an AVAILABLE parts subdomain with no lines), so a job with no plan says "No parts planned"; a job whose plan is
// not known (still loading, refused) or that has planned parts keeps the readiness the card was composed with.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const ctx = vi.hoisted(() => ({ current: { context: null, denied: false, failure: null, loading: false } }));
vi.mock("../src/hooks/useWorkOrderFieldContext.js", () => ({ useWorkOrderFieldContext: () => ctx.current }));
vi.mock("../src/hooks/useCurrentTechnician.js", () => ({ useCurrentTechnician: vi.fn(() => ({ technicianId: "tech-1", loading: false })) }));
vi.mock("../src/hooks/useAssignedWorkOrders.js", () => ({
  useAssignedWorkOrders: vi.fn(() => ({
    data: [{ id: "wo1", woNumber: "WO-2026-000081", status: "SCHEDULED", type: "SERVICE_CALL", customerId: "acct_1", locationId: "site_1", assignedTechId: "tech-1" }],
    loading: false, error: null,
  })),
}));
vi.mock("../src/modules/mobile/FieldMode.jsx", () => ({ default: () => <div data-testid="fieldmode" /> }));
vi.mock("../src/modules/scan/ScanWorkspace.jsx", () => ({ default: () => <div data-testid="scan" /> }));

import TechnicianShell from "../src/modules/technician/TechnicianShell.jsx";

const named = { customer: { state: "RESOLVED", displayName: "Harbor Grill" }, site: { state: "RESOLVED", displayLabel: "Airport site" } };
const openJobs = () => fireEvent.click(screen.getAllByRole("button", { name: "Jobs" })[0]);
const card = () => screen.getByRole("button", { name: /Open WO-2026-000081/ });

beforeEach(() => { ctx.current = { context: null, denied: false, failure: null, loading: false }; });

describe("the Jobs card parts line", () => {
  it("a job whose governed plan has no parts says No parts planned", () => {
    ctx.current = { ...ctx.current, context: { ...named, parts: { state: "AVAILABLE", lines: [] } } };
    render(<TechnicianShell />);
    openJobs();
    expect(card().textContent).toContain("No parts planned");
    expect(card().textContent).not.toMatch(/parts unknown/i);
  });

  it("a job with planned parts keeps the composed readiness (the card does not claim a plan state it did not read)", () => {
    ctx.current = { ...ctx.current, context: { ...named, parts: { state: "AVAILABLE", lines: [{ partId: "PRT-1005", qtyPlanned: 1 }] } } };
    render(<TechnicianShell />);
    openJobs();
    expect(card().textContent).toMatch(/parts unknown/i);
    expect(card().textContent).not.toContain("No parts planned");
  });

  it("a context that is still loading (null so far) keeps parts unknown and never claims there is no plan", () => {
    ctx.current = { context: null, denied: false, failure: null, loading: true };
    render(<TechnicianShell />);
    openJobs();
    expect(card().textContent).not.toContain("No parts planned");
    expect(card().textContent).toMatch(/parts unknown/i);
  });

  it.each(["UNAVAILABLE", "NOT_AUTHORIZED", "ERROR"])("a parts subdomain in state %s with no lines is NOT a stated empty plan: parts unknown stays", (state) => {
    ctx.current = { ...ctx.current, context: { ...named, parts: { state, lines: [] } } };
    render(<TechnicianShell />);
    openJobs();
    expect(card().textContent).not.toContain("No parts planned");
    expect(card().textContent).toMatch(/parts unknown/i);
  });

  it("a job whose context was refused or is still unread never claims there is no plan", () => {
    ctx.current = { context: null, denied: true, failure: { code: "FORBIDDEN" }, loading: false };
    render(<TechnicianShell />);
    openJobs();
    expect(card().textContent).not.toContain("No parts planned");
  });
});
