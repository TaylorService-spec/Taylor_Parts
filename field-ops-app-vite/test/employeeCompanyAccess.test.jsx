// EMPLOYEE > COMPANY ACCESS (DECISIONS #249): explicit company-access grants, previewed by the server, committed with its digest.
// Fixtures follow the SERVED shape of listEmployeeCompanyAuthority (functions/src/adminPolicy/policyCommands.ts). What is proved: the screen
// draws exactly what the server returns (home company, grants with the server's state words, the companies it offers); says in words that
// access grants no permissions; sends dates only when chosen (as offset-carrying instants); previews before Confirm and sends the digest;
// removes with a stated reason; and shows the server's refusal verbatim. The server is the authority -- nothing here decides policy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import EmployeeCompanyAccess from "../src/modules/administration/EmployeeCompanyAccess.jsx";
import { createAdminControlPlaneClient } from "../src/services/adminControlPlaneClient.js";
import { PREVIEW_DIGEST, previewImpact, wouldApplyPreview } from "./support/authorityPreviewKit.js";

afterEach(cleanup);

const VIEW = {
  employeeId: "e-1",
  homeOperatingCompanyId: "taylor",
  grants: [
    { id: "g-1", employeeId: "e-1", operatingCompanyId: "ventana", status: "active", displayState: "ACTIVE", effectiveFrom: "2026-10-17T10:00:00.000Z",
      effectiveUntil: null, reason: "#2140-R transition preservation", grantedBy: "p-1", grantedAt: "2026-10-17T10:00:00.000Z", revokedBy: null, revokedAt: null, revokeReason: null },
    { id: "g-0", employeeId: "e-1", operatingCompanyId: "delta", status: "revoked", displayState: "REVOKED", effectiveFrom: "2026-09-01T10:00:00.000Z",
      effectiveUntil: null, reason: "old cover", grantedBy: "p-1", grantedAt: "2026-09-01T10:00:00.000Z", revokedBy: "p-1", revokedAt: "2026-09-20T10:00:00.000Z", revokeReason: "cover ended" },
  ],
  grantableCompanies: [{ value: "delta", label: "delta" }],
};

function makeApi(over = {}) {
  return {
    listEmployeeCompanyAuthority: vi.fn(async () => ({ ok: true, data: VIEW })),
    grantCompanyAuthority: vi.fn(async (input) => ({ ok: true, data: { id: "g-new", ...input, status: "active" } })),
    revokeCompanyAuthority: vi.fn(async (input) => ({ ok: true, data: { id: input.grantId, status: "revoked" } })),
    previewAuthorityChange: wouldApplyPreview({ operation: "grantCompanyAuthority" }),
    ...over,
  };
}
const addForm = () => screen.getByRole("form", { name: "Add company access" });

describe("Employee > Company access", () => {
  it("draws the server's answer: own company, the active grant with its state, past access in the history; and says it grants no permissions", async () => {
    render(<EmployeeCompanyAccess api={makeApi()} employeeId="e-1" employeeName="Jane" />);
    const table = await screen.findByRole("table", { name: "Company access held" });
    const row = table.querySelector('[data-company-grant="g-1"]');
    expect(row.getAttribute("data-company-grant-state")).toBe("ACTIVE");
    expect(within(row).getByText("ventana")).toBeTruthy();
    expect(within(row).getByText("Company access active")).toBeTruthy();
    expect(within(row).getByText("No end date")).toBeTruthy();
    expect(table.querySelector('[data-company-grant="g-0"]')).toBeNull();
    expect(document.querySelector("[data-home-company]").textContent).toMatch(/taylor/);
    expect(document.querySelector("[data-company-grant-history]").textContent).toMatch(/delta — Revoked, removed 2026-09-20 \(cover ended\)/);
    expect(document.body.textContent).toMatch(/It grants no permissions/);
    expect(document.body.textContent).toMatch(/does not give Finance access/);
  });

  it("offers only the companies the server lists", async () => {
    render(<EmployeeCompanyAccess api={makeApi()} employeeId="e-1" />);
    const select = await screen.findByRole("combobox", { name: "Company to add" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a company…", "delta"]);
  });

  it("an open-ended grant sends exactly { employeeId, operatingCompanyId, reason } after a server preview, with the digest", async () => {
    const api = makeApi();
    render(<EmployeeCompanyAccess api={api} employeeId="e-1" />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Company to add" }), { target: { value: "delta" } });
    fireEvent.change(within(addForm()).getByLabelText("Reason"), { target: { value: "cover for Ana" } });
    const submit = screen.getByRole("button", { name: "Add Company Access" });
    expect(submit.disabled).toBe(true); // complete, but not yet previewed
    await previewImpact(addForm());
    expect(api.previewAuthorityChange).toHaveBeenCalledWith("grantCompanyAuthority", { employeeId: "e-1", operatingCompanyId: "delta", reason: "cover for Ana", effectiveFrom: "", effectiveUntil: "" });
    expect(submit.disabled).toBe(false);
    await act(async () => { fireEvent.click(submit); });
    expect(api.grantCompanyAuthority).toHaveBeenCalledWith({ employeeId: "e-1", operatingCompanyId: "delta", reason: "cover for Ana", effectiveFrom: "", effectiveUntil: "", previewDigest: PREVIEW_DIGEST });
    await waitFor(() => expect(api.listEmployeeCompanyAuthority).toHaveBeenCalledTimes(2));
  });

  it("the seam sends dates only when chosen, and the grant input builder never invents a field", async () => {
    const call = vi.fn(async () => ({ ok: true, data: {} }));
    const client = createAdminControlPlaneClient(call);
    await client.grantCompanyAuthority({ employeeId: "e-1", operatingCompanyId: "ventana", reason: "r", effectiveFrom: "", effectiveUntil: "2031-01-01T00:00:00.000Z", previewDigest: PREVIEW_DIGEST });
    await client.grantCompanyAuthority({ employeeId: "e-1", operatingCompanyId: "ventana", reason: "r" });
    await client.revokeCompanyAuthority({ grantId: "g-1", reason: "done" });
    await client.listEmployeeCompanyAuthority("e-1");
    expect(call.mock.calls).toEqual([
      ["grantCompanyAuthority", { employeeId: "e-1", operatingCompanyId: "ventana", reason: "r", effectiveUntil: "2031-01-01T00:00:00.000Z", previewDigest: PREVIEW_DIGEST }],
      ["grantCompanyAuthority", { employeeId: "e-1", operatingCompanyId: "ventana", reason: "r" }],
      ["revokeCompanyAuthority", { grantId: "g-1", reason: "done" }],
      ["listEmployeeCompanyAuthority", { employeeId: "e-1" }],
    ]);
  });

  it("Remove asks for a reason, previews, and sends the grant id with the digest", async () => {
    const api = makeApi({ previewAuthorityChange: wouldApplyPreview({ operation: "revokeCompanyAuthority" }) });
    render(<EmployeeCompanyAccess api={api} employeeId="e-1" employeeName="Jane" />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove access to ventana" }));
    const form = screen.getByRole("form", { name: "Remove company access" });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "cover ended" } });
    await previewImpact(form);
    expect(api.previewAuthorityChange).toHaveBeenCalledWith("revokeCompanyAuthority", { grantId: "g-1", reason: "cover ended" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm Removal" })); });
    expect(api.revokeCompanyAuthority).toHaveBeenCalledWith({ grantId: "g-1", reason: "cover ended", previewDigest: PREVIEW_DIGEST });
  });

  it("shows the server's refusal verbatim", async () => {
    const api = makeApi({ grantCompanyAuthority: vi.fn(async () => ({ ok: false, code: "FORBIDDEN", message: "SELF_ADMINISTRATION: a principal may not grant company access to its own Employee" })) });
    render(<EmployeeCompanyAccess api={api} employeeId="e-1" />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Company to add" }), { target: { value: "delta" } });
    fireEvent.change(within(addForm()).getByLabelText("Reason"), { target: { value: "x" } });
    await previewImpact(addForm());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add Company Access" })); });
    await waitFor(() => expect(document.querySelector('[data-control-plane-refusal="FORBIDDEN"]')).toBeTruthy());
    expect(document.querySelector('[data-control-plane-refusal="FORBIDDEN"]').textContent)
      .toBe("FORBIDDEN: SELF_ADMINISTRATION: a principal may not grant company access to its own Employee");
  });

  it("an unreadable read is stated, not guessed", async () => {
    const api = makeApi({ listEmployeeCompanyAuthority: vi.fn(async () => ({ ok: false, code: "FORBIDDEN", message: "admin.principalAccess.read is required" })) });
    render(<EmployeeCompanyAccess api={api} employeeId="e-1" />);
    await waitFor(() => expect(document.body.textContent).toMatch(/FORBIDDEN|admin\.principalAccess\.read/));
    expect(screen.queryByRole("table", { name: "Company access held" })).toBeNull();
  });
});
