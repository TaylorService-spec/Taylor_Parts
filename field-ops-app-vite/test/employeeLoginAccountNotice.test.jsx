import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EmployeeLoginAccount from "../src/modules/administration/EmployeeLoginAccount.jsx";

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
