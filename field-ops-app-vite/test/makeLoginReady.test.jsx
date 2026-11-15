import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MakeLoginReady from "../src/modules/administration/MakeLoginReady.jsx";
import { LOGIN_ACTION_DONE_WORDS } from "../src/modules/administration/EmployeeLoginAccount.jsx";
import { operationDecision } from "../src/access/operationGate.js";
import { isAdminOperation, makePersonLoginReady } from "../src/services/adminPolicyApiClient.js";

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
