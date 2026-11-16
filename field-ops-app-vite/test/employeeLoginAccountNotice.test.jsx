import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EmployeeLoginAccount from "../src/modules/administration/EmployeeLoginAccount.jsx";
import MakeLoginReady from "../src/modules/administration/MakeLoginReady.jsx";
import { LOGIN_ACTION_DONE_WORDS } from "../src/modules/administration/EmployeeLoginAccount.jsx";
import { operationDecision } from "../src/access/operationGate.js";
import { isAdminOperation, makePersonLoginReady } from "../src/services/adminPolicyApiClient.js";

const account = {
  loginIdentifier: "liam.patel@sample.invalid", status: "active", mfaEnrolled: true, mfaRequired: true,
  recoveryCodesRemaining: 10, liveSessions: 0, lastLoginAt: null, lockedUntil: null, failedAttempts: 0,
};

function apiReturning(result) {
  return vi.fn(async (operation) => (operation === "readLoginAccount"
    ? { ok: true, data: { account, eosIdentity: null, recentEvents: [] } }
    : result));
}

async function stopRequiringTwoStep(api) {
  render(<EmployeeLoginAccount api={api} principalId="p-1" />);
  fireEvent.change(await screen.findByRole("textbox"), { target: { value: "testing" } });
  fireEvent.click(screen.getByText("Stop requiring two-step verification"));
}

describe("EmployeeLoginAccount action feedback", () => {
  it("confirms a completed action", async () => {
    await stopRequiringTwoStep(apiReturning({ ok: true, data: { mfaRequired: false } }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Two-step verification requirement updated."));
  });

  it("shows the refusal, never a confirmation, when the server refuses", async () => {
    await stopRequiringTwoStep(apiReturning({ ok: false, code: "FORBIDDEN", message: "not authorized" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("not authorized"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("EmployeeLoginAccount create (D7)", () => {
  it("offers no opt-out and never sends mfaRequired", async () => {
    const api = vi.fn(async (op) => (op === "readLoginAccount" ? { ok: true, data: { account: null, eosIdentity: null, recentEvents: [] } } : { ok: true, data: { enrollmentTicket: "t", enrollmentTicketExpiresAt: null } }));
    render(<EmployeeLoginAccount api={api} principalId="p-1" />);
    await screen.findByText("Create sign-in");
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "testing" } });
    fireEvent.click(screen.getByText("Create sign-in"));
    await waitFor(() => expect(api.mock.calls.some(([op]) => op === "provisionLoginAccount")).toBe(true));
    expect(JSON.stringify(api.mock.calls.find(([op]) => op === "provisionLoginAccount"))).not.toContain("mfaRequired");
  });
});

// ---- A13 Make login-ready (folded here so the suite runs in the administration-users workflow) ----

const KEY = "admin.loginReadyPerson.provision";
const ASSIGN = "admin.roleAssignment.write";
const OK = { ok: true, data: { enrollmentTicket: "enrollment_SECRET_ONCE", enrollmentTicketExpiresAt: "2030-01-01T00:00:00Z" } };

describe("MakeLoginReady (A13)", () => {
  it("prefills the work email (locked), requires a reason, and sends only employeeId, loginIdentifier and reason", async () => {
    const api = vi.fn(async () => OK);
    render(<MakeLoginReady api={api} employeeId="emp-1" workEmail="new.hire@example.test" />);
    const [name] = screen.getAllByRole("textbox");
    expect(name.value).toBe("new.hire@example.test");
    expect(name.readOnly).toBe(true);
    fireEvent.click(screen.getByText("Make login-ready"));
    expect(screen.getByRole("alert").textContent).toMatch(/reason/i);
    expect(api).not.toHaveBeenCalled();
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "new hire onboarding" } });
    fireEvent.click(screen.getByText("Make login-ready"));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(api).toHaveBeenCalledWith("makePersonLoginReady", { employeeId: "emp-1", loginIdentifier: "new.hire@example.test", reason: "new hire onboarding" });
    expect(JSON.stringify(api.mock.calls[0])).not.toMatch(/principalId|mfaRequired/);
  });

  it("lets the Administrator type the sign-in name when the Employee has no work email", async () => {
    const api = vi.fn(async () => OK);
    render(<MakeLoginReady api={api} employeeId="emp-2" workEmail="" />);
    const [name, reason] = screen.getAllByRole("textbox");
    expect(name.readOnly).toBe(false);
    fireEvent.change(name, { target: { value: " field.tech@example.test " } });
    fireEvent.change(reason, { target: { value: "new technician" } });
    fireEvent.click(screen.getByText("Make login-ready"));
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(api.mock.calls[0][1].loginIdentifier).toBe("field.tech@example.test");
  });

  it("shows the setup code once, says Roles are separate, and reloads only when Done is pressed", async () => {
    const onDone = vi.fn();
    render(<MakeLoginReady api={async () => OK} employeeId="emp-1" workEmail="a@example.test" onDone={onDone} />);
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "new hire" } });
    fireEvent.click(screen.getByText("Make login-ready"));
    expect(await screen.findByText("enrollment_SECRET_ONCE")).toBeTruthy();
    expect(screen.getByText(LOGIN_ACTION_DONE_WORDS.makePersonLoginReady)).toBeTruthy();
    expect(LOGIN_ACTION_DONE_WORDS.makePersonLoginReady).toBe("Sign-in created. Assign Roles separately.");
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Done"));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("enrollment_SECRET_ONCE")).toBeNull();
  });

  it("shows the server's refusal as worded and never a code", async () => {
    const api = vi.fn(async () => ({ ok: false, code: "FORBIDDEN", message: "not authorized: \"admin.loginReadyPerson.provision\" is required" }));
    render(<MakeLoginReady api={api} employeeId="emp-1" workEmail="" />);
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "x.y@example.test" } });
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "reason" } });
    fireEvent.click(screen.getByText("Make login-ready"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("is required"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the gate for the control (the server's own access map)", () => {
  const session = (...held) => ({ eosSource: true, settled: true, holds: (k) => held.includes(k), grantsSurface: () => false });
  it("is hidden without the new key (the state at release), without roleAssignment.write, and shown only with both", () => {
    expect(operationDecision(session(ASSIGN), "makePersonLoginReady")).toBe(false);
    expect(operationDecision(session(KEY), "makePersonLoginReady")).toBe(false);
    expect(operationDecision(session(), "makePersonLoginReady")).toBe(false);
    expect(operationDecision(session(KEY, ASSIGN), "makePersonLoginReady")).toBe(true);
  });
  it("the client knows the operation and has the one call", () => {
    expect(isAdminOperation("makePersonLoginReady")).toBe(true);
    expect(typeof makePersonLoginReady).toBe("function");
  });
});

describe("MakeLoginReady keeps the one-time code with its caller (A13 review L1)", () => {
  it("hands the issued code to onIssued, and shows a caller-held result after a remount", async () => {
    const api = vi.fn(async () => OK);
    const onIssued = vi.fn();
    render(<MakeLoginReady api={api} employeeId="emp-1" workEmail="a@example.test" onIssued={onIssued} result={null} />);
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "onboarding" } });
    fireEvent.click(screen.getByText("Make login-ready"));
    await waitFor(() => expect(onIssued).toHaveBeenCalledTimes(1));
    const held = onIssued.mock.calls[0][0];
    expect(held.code).toBe("enrollment_SECRET_ONCE");
    render(<MakeLoginReady api={api} employeeId="emp-1" onIssued={onIssued} result={held} />);
    expect(screen.getByText(/enrollment_SECRET_ONCE/)).toBeTruthy();
  });
});
