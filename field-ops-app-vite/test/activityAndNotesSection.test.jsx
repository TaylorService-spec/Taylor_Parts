import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ActivityAndNotesSection from "../src/modules/accounts/ActivityAndNotesSection.jsx";
import { useCrmActivities } from "../src/hooks/useCrmActivities.js";
import { useEmployeeDirectory } from "../src/hooks/useEmployeeDirectory.js";

vi.mock("../src/hooks/useCrmActivities.js", () => ({ useCrmActivities: vi.fn() }));
vi.mock("../src/hooks/useEmployeeDirectory.js", async () => {
  const actual = await vi.importActual("../src/hooks/useEmployeeDirectory.js");
  return { ...actual, useEmployeeDirectory: vi.fn() };
});

function mockEmployeeDirectory(byUserId = new Map()) {
  useEmployeeDirectory.mockReturnValue({ byUserId, loading: false, error: null });
}

describe("ActivityAndNotesSection -- honest states", () => {
  it("renders a loading state", () => {
    mockEmployeeDirectory();
    useCrmActivities.mockReturnValue({ loading: true, errorStatus: null, result: null, refetch: vi.fn() });
    render(<ActivityAndNotesSection accountId="acc-1" />);
    expect(screen.getByText(/Loading activity/)).toBeTruthy();
  });

  it("renders a denied state distinctly, never as empty", () => {
    mockEmployeeDirectory();
    useCrmActivities.mockReturnValue({ loading: false, errorStatus: "denied", result: null, refetch: vi.fn() });
    render(<ActivityAndNotesSection accountId="acc-1" />);
    expect(screen.getByText(/not authorized to view CRM activity/)).toBeTruthy();
    expect(screen.queryByText(/No activity logged/)).toBeNull();
  });

  it("renders an unavailable state on a failed read", () => {
    mockEmployeeDirectory();
    useCrmActivities.mockReturnValue({ loading: false, errorStatus: "unavailable", result: null, refetch: vi.fn() });
    render(<ActivityAndNotesSection accountId="acc-1" />);
    expect(screen.getByText(/currently unavailable/)).toBeTruthy();
  });

  it("renders empty honestly when the account genuinely has zero activity", () => {
    mockEmployeeDirectory();
    useCrmActivities.mockReturnValue({ loading: false, errorStatus: null, result: { status: "ready", activities: [] }, refetch: vi.fn() });
    render(<ActivityAndNotesSection accountId="acc-1" />);
    expect(screen.getByText(/No activity logged yet/)).toBeTruthy();
  });

  it("renders real activity rows with resolved actor names, never a raw uid", () => {
    mockEmployeeDirectory(new Map([["uid-abc", { displayName: "Jane Smith" }]]));
    useCrmActivities.mockReturnValue({
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        activities: [
          {
            id: "ACT-1", accountId: "acc-1", type: "CALL", body: "Discussed renewal timing.",
            occurredAtMillis: Date.now(), createdAtMillis: Date.now(), createdByUid: "uid-abc",
            contactId: null, opportunityId: null, salesOrderId: null,
          },
        ],
      },
      refetch: vi.fn(),
    });
    render(<ActivityAndNotesSection accountId="acc-1" />);
    expect(screen.getByText("Call")).toBeTruthy();
    expect(screen.getByText("Discussed renewal timing.")).toBeTruthy();
    expect(screen.getByText("Jane Smith")).toBeTruthy();
    // The raw Firebase uid must never appear in the rendered DOM (F-UID-1).
    expect(screen.queryByText("uid-abc")).toBeNull();
  });

  it("resolves an unlinked/legacy actor to the neutral label, never the raw uid", () => {
    mockEmployeeDirectory(new Map()); // no Employee link for this uid
    useCrmActivities.mockReturnValue({
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        activities: [
          { id: "ACT-2", accountId: "acc-1", type: "GENERAL", body: "note", occurredAtMillis: Date.now(), createdAtMillis: Date.now(), createdByUid: "uid-legacy" },
        ],
      },
      refetch: vi.fn(),
    });
    render(<ActivityAndNotesSection accountId="acc-1" />);
    expect(screen.getByText("Unknown user")).toBeTruthy();
    expect(screen.queryByText("uid-legacy")).toBeNull();
  });

  it("renders linked commercial context when present", () => {
    mockEmployeeDirectory();
    useCrmActivities.mockReturnValue({
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        activities: [
          { id: "ACT-3", accountId: "acc-1", type: "SALES_NOTE", body: "note", occurredAtMillis: Date.now(), createdAtMillis: Date.now(), createdByUid: "u", contactId: null, opportunityId: "OPP-9", salesOrderId: null },
        ],
      },
      refetch: vi.fn(),
    });
    render(<ActivityAndNotesSection accountId="acc-1" />);
    expect(screen.getByText(/Opportunity OPP-9/)).toBeTruthy();
  });

  it("renders the [+ Add Note] action", () => {
    mockEmployeeDirectory();
    useCrmActivities.mockReturnValue({ loading: false, errorStatus: null, result: { status: "ready", activities: [] }, refetch: vi.fn() });
    render(<ActivityAndNotesSection accountId="acc-1" />);
    expect(screen.getByText("+ Add Note")).toBeTruthy();
  });

  it("has NO assignee/due-date/status control anywhere in the rendered UI -- the PART 1.5 seam", () => {
    mockEmployeeDirectory();
    useCrmActivities.mockReturnValue({
      loading: false, errorStatus: null,
      result: { status: "ready", activities: [{ id: "ACT-4", accountId: "acc-1", type: "GENERAL", body: "note", occurredAtMillis: Date.now(), createdAtMillis: Date.now(), createdByUid: "u" }] },
      refetch: vi.fn(),
    });
    const { container } = render(<ActivityAndNotesSection accountId="acc-1" />);
    expect(container.querySelector('[name="assignee"]')).toBeNull();
    expect(container.querySelector('[name="dueDate"]')).toBeNull();
    expect(container.querySelector('[name="status"]')).toBeNull();
    expect(screen.queryByText(/Assign/)).toBeNull();
    expect(screen.queryByText(/Due date/)).toBeNull();
  });
});
