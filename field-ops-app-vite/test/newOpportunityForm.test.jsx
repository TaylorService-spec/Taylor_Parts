// NewOpportunityForm -- component render tests (vitest + jsdom). `deps.useAccounts` and `deps.client` inject
// fakes so neither firebase nor a real callable ever loads. Covers: validation before submit, the exact
// payload sent to createOpportunity (idempotencyKey included), retry reuses the same idempotency key, a
// denied actor, an unavailable/error create, and that a raw uid is never rendered anywhere in the form.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import NewOpportunityForm from "../src/modules/sales/NewOpportunityForm.jsx";

afterEach(cleanup);

const ENABLED = { enabled: true, reason: null };
const DISABLED = { enabled: false, reason: "Creating opportunities is not enabled yet." };

function fakeUseAccounts(accounts = [{ id: "A1", name: "Northgate Grocery" }, { id: "A2", name: "Metro School District" }]) {
  return () => ({ data: accounts, loading: false, error: null });
}

function fillMinimalValidForm() {
  fireEvent.change(screen.getByLabelText(/customer account/i), { target: { value: "A1" } });
  fireEvent.change(screen.getByLabelText(/owner \(employee id\)/i), { target: { value: "EMP-1" } });
  fireEvent.change(screen.getByLabelText(/^channel$/i), { target: { value: "RETAIL" } });
}

describe("NewOpportunityForm -- validation", () => {
  it("does not submit (does not call the client) when required fields are missing", () => {
    const client = { createOpportunity: vi.fn() };
    render(<NewOpportunityForm readiness={ENABLED} onClose={vi.fn()} deps={{ client, useAccounts: fakeUseAccounts() }} />);
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    expect(client.createOpportunity).not.toHaveBeenCalled();
    expect(screen.getByText("Select a customer account.")).toBeTruthy();
    expect(screen.getByText("Enter the owning employee's id.")).toBeTruthy();
    expect(screen.getByText("Select a sales channel.")).toBeTruthy();
  });

  it("disables submit entirely (honest, no submit attempt) when write-readiness is disabled", () => {
    const client = { createOpportunity: vi.fn() };
    render(<NewOpportunityForm readiness={DISABLED} onClose={vi.fn()} deps={{ client, useAccounts: fakeUseAccounts() }} />);
    const submit = screen.getByRole("button", { name: /create opportunity/i });
    expect(submit.disabled).toBe(true);
    expect(screen.getByText(DISABLED.reason)).toBeTruthy();
  });
});

describe("NewOpportunityForm -- successful create calls the callable with the exact expected payload", () => {
  it("submits accountId/ownerEmployeeId/salesChannel + null-normalized optional fields + an idempotencyKey", async () => {
    const onCreated = vi.fn();
    const client = { createOpportunity: vi.fn().mockResolvedValue({ result: { success: true, replayed: false, opportunityId: "OPP-9", stage: "IDENTIFIED" } }) };
    render(<NewOpportunityForm readiness={ENABLED} onClose={vi.fn()} onCreated={onCreated} deps={{ client, useAccounts: fakeUseAccounts() }} />);
    fillMinimalValidForm();
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));

    await waitFor(() => expect(client.createOpportunity).toHaveBeenCalledTimes(1));
    const payload = client.createOpportunity.mock.calls[0][0];
    expect(payload.accountId).toBe("A1");
    expect(payload.ownerEmployeeId).toBe("EMP-1");
    expect(payload.salesChannel).toBe("RETAIL");
    expect(payload.expectedValue).toBeNull();
    expect(payload.expectedCloseAt).toBeNull();
    expect(typeof payload.idempotencyKey).toBe("string");
    expect(payload.idempotencyKey.length).toBeGreaterThan(0);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("OPP-9"));
  });

  it("includes need/expectedValue/expectedCloseAt when provided", async () => {
    const client = { createOpportunity: vi.fn().mockResolvedValue({ result: { success: true, replayed: false, opportunityId: "OPP-9", stage: "IDENTIFIED" } }) };
    render(<NewOpportunityForm readiness={ENABLED} onClose={vi.fn()} onCreated={vi.fn()} deps={{ client, useAccounts: fakeUseAccounts() }} />);
    fillMinimalValidForm();
    fireEvent.change(screen.getByLabelText(/customer need/i), { target: { value: "Freezer replacement" } });
    fireEvent.change(screen.getByLabelText(/estimated value/i), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));

    await waitFor(() => expect(client.createOpportunity).toHaveBeenCalledTimes(1));
    const payload = client.createOpportunity.mock.calls[0][0];
    expect(payload.need).toBe("Freezer replacement");
    expect(payload.expectedValue).toBe(5000);
  });
});

describe("NewOpportunityForm -- retry reuses the same idempotency key", () => {
  it("a failed submit followed by re-clicking Create reuses the SAME idempotencyKey", async () => {
    const client = {
      createOpportunity: vi.fn()
        .mockResolvedValueOnce({ errorStatus: "internal" })
        .mockResolvedValueOnce({ result: { success: true, replayed: false, opportunityId: "OPP-9", stage: "IDENTIFIED" } }),
    };
    render(<NewOpportunityForm readiness={ENABLED} onClose={vi.fn()} onCreated={vi.fn()} deps={{ client, useAccounts: fakeUseAccounts() }} />);
    fillMinimalValidForm();
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    await waitFor(() => expect(client.createOpportunity).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/could not be completed/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    await waitFor(() => expect(client.createOpportunity).toHaveBeenCalledTimes(2));

    const firstKey = client.createOpportunity.mock.calls[0][0].idempotencyKey;
    const secondKey = client.createOpportunity.mock.calls[1][0].idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });
});

describe("NewOpportunityForm -- honest denied/unavailable/error states", () => {
  it("a denied actor sees the safe denial message, and onCreated is never called", async () => {
    const onCreated = vi.fn();
    const client = { createOpportunity: vi.fn().mockResolvedValue({ errorStatus: "permission-denied" }) };
    render(<NewOpportunityForm readiness={ENABLED} onClose={vi.fn()} onCreated={onCreated} deps={{ client, useAccounts: fakeUseAccounts() }} />);
    fillMinimalValidForm();
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    await waitFor(() => expect(screen.getByText(/not authorized/i)).toBeTruthy());
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("an account-list read failure shows an honest error, not an empty-looking select", () => {
    const client = { createOpportunity: vi.fn() };
    const useAccounts = () => ({ data: [], loading: false, error: new Error("denied") });
    render(<NewOpportunityForm readiness={ENABLED} onClose={vi.fn()} deps={{ client, useAccounts }} />);
    expect(screen.getByText(/could not load customer accounts/i)).toBeTruthy();
    expect(screen.queryByLabelText(/customer account/i)).toBeNull();
  });
});

describe("NewOpportunityForm -- never renders a raw uid", () => {
  it("no 32+ char hex/base64-looking uid string appears anywhere in the rendered form", () => {
    const client = { createOpportunity: vi.fn() };
    render(<NewOpportunityForm readiness={ENABLED} onClose={vi.fn()} deps={{ client, useAccounts: fakeUseAccounts() }} />);
    const text = document.body.textContent;
    expect(text).not.toMatch(/[A-Za-z0-9]{28,}/);
  });
});
