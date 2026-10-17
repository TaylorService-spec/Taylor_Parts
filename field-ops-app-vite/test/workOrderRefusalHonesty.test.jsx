// A REFUSAL READS AS A REFUSAL (controller assignment, 2026-10-16; found by #2110's lane). Two Work Order read surfaces
// framed an EOS refusal as an outage:
//   * Jobs.jsx checked the Firebase code "permission-denied", but the EOS client refuses with "FORBIDDEN"
//     (WorkOrderApiError), so a 403 rendered the UNAVAILABLE alert ("try again");
//   * MyDashboard's ServiceAttentionModule said "Work orders could not be read just now." for every error.
// Both now ask the one Work Order outcome classifier (domain/workOrderOutcome.js). COMPANY_AUTHORITY_REQUIRED is said
// with its remedy (COMPANY_AUTHORITY_MESSAGE). No surface ever prints the raw code.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ role: "dispatcher" }) }));
vi.mock("../src/hooks/useWorkOrders", () => ({ useWorkOrders: vi.fn() }));

import { useWorkOrders } from "../src/hooks/useWorkOrders";
import Jobs from "../src/modules/jobs/Jobs.jsx";
import { ServiceAttentionModule } from "../src/modules/dashboard/MyDashboard.jsx";
import { COMPANY_AUTHORITY_MESSAGE } from "../src/domain/workOrderOutcome.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const FORBIDDEN = { code: "FORBIDDEN", status: 403, message: "workOrder.record.read is required" };
const COMPANY = { code: "FORBIDDEN", reason: "COMPANY_AUTHORITY_REQUIRED", status: 403 };
const DOWN = { code: "UNAVAILABLE", status: 503 };
const NOT_ACTIVATED = { code: "NOT_ACTIVATED", status: 503 };
const COMPANY_SAID = /No operating company is linked to your login/;
const RAW = /FORBIDDEN|COMPANY_AUTHORITY_REQUIRED|permission-denied|\b403\b|\b503\b/;

const renderJobs = (error) => {
  useWorkOrders.mockReturnValue({ data: [], loading: false, error });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
};
const renderAttention = (error) => render(<ServiceAttentionModule grouped={[]} loading={false} error={error} />);
const denied = (container) => container.querySelector(".ns-state--denied");
const alerting = () => screen.queryByRole("alert");

describe("Jobs: an EOS refusal is DENIED, never UNAVAILABLE", () => {
  it("FORBIDDEN renders the refusal, with the Technician Workspace pointer, and no retry alert", () => {
    const { container } = renderJobs(FORBIDDEN);
    expect(denied(container)).toBeTruthy();
    expect(denied(container).textContent).toMatch(/do not have permission to view these work orders/);
    expect(denied(container).textContent).toMatch(/Technician Workspace/);
    expect(alerting()).toBeNull();
    expect(container.textContent).not.toMatch(RAW);
  });

  it("COMPANY_AUTHORITY_REQUIRED says why and how to fix it -- and does not point at a workspace the same rule refuses", () => {
    const { container } = renderJobs(COMPANY);
    expect(denied(container).textContent).toContain(COMPANY_AUTHORITY_MESSAGE);
    expect(denied(container).textContent).not.toMatch(/Technician Workspace/);
    expect(alerting()).toBeNull();
    expect(container.textContent).not.toMatch(RAW);
  });

  it("an outage is still the UNAVAILABLE alert, and is never phrased as a refusal", () => {
    const { container } = renderJobs(DOWN);
    expect(alerting()).toBeTruthy();
    expect(denied(container)).toBeNull();
    expect(container.textContent).not.toMatch(/permission|operating company/i);
    expect(container.textContent).not.toMatch(RAW);
  });

  it("the legacy Firebase permission-denied code still reads as a refusal", () => {
    const { container } = renderJobs({ code: "firestore/permission-denied" });
    expect(denied(container)).toBeTruthy();
    expect(container.textContent).not.toMatch(RAW);
  });

  it("not-yet-activated is a readiness state, neither a refusal nor an outage", () => {
    const { container } = renderJobs(NOT_ACTIVATED);
    expect(container.querySelector(".ns-state--not-enabled")).toBeTruthy();
    expect(denied(container)).toBeNull();
    expect(alerting()).toBeNull();
  });
});

describe("My Dashboard Service attention: a refusal is not 'could not be read just now'", () => {
  it("FORBIDDEN renders the refusal, not the outage sentence", () => {
    const { container } = renderAttention(FORBIDDEN);
    expect(denied(container)).toBeTruthy();
    expect(container.textContent).not.toMatch(/could not be read just now/);
    expect(alerting()).toBeNull();
    expect(container.textContent).not.toMatch(RAW);
  });

  it("COMPANY_AUTHORITY_REQUIRED carries its remedy", () => {
    const { container } = renderAttention(COMPANY);
    expect(denied(container).textContent).toMatch(COMPANY_SAID);
    expect(container.textContent).not.toMatch(/could not be read just now/);
    expect(container.textContent).not.toMatch(RAW);
  });

  it("an outage keeps the outage sentence as an alert, and never mentions permission", () => {
    const { container } = renderAttention(DOWN);
    expect(alerting()).toBeTruthy();
    expect(container.textContent).toMatch(/could not be read just now/);
    expect(container.textContent).not.toMatch(/permission|operating company/i);
    expect(container.textContent).not.toMatch(RAW);
  });

  it("not-yet-activated is not an outage", () => {
    const { container } = renderAttention(NOT_ACTIVATED);
    expect(container.querySelector(".ns-state--not-enabled")).toBeTruthy();
    expect(container.textContent).not.toMatch(/could not be read just now/);
  });
});
