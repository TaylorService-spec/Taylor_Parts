// THE AUTHORITY IMPACT PREVIEW STEP (PR 4) -- between "reason" and "Confirm" on every Administration authority change.
//
// What is proved: Confirm is disabled until a FRESH server preview of EXACTLY the inputs on screen answered WOULD_APPLY;
// any input change discards it; NO_OP and WOULD_REFUSE never commit; the commit carries the preview's digest; a
// STALE_PREVIEW commit refusal discards the preview and requires a new one; counts-only previews name nobody; a preview
// that could not be taken keeps Confirm disabled (fail closed); the matrix's single-click toggle no longer commits on one
// click; and the client seam builds the preview input and the commit input with ONE builder.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { GrantCellControls } from "../src/modules/administration/GrantControls.jsx";
import ObjectAuthorityMatrix from "../src/modules/administration/ObjectAuthorityMatrix.jsx";
import { isStalePreview } from "../src/modules/administration/AuthorityImpactPreview.jsx";
import { AUTHORITY_CHANGE_INPUT, AUTHORITY_CHANGE_OPERATIONS, createAdminControlPlaneClient } from "../src/services/adminControlPlaneClient.js";
import { PREVIEW_DIGEST, previewImpact, previewReport, wouldApplyPreview } from "./support/authorityPreviewKit.js";

afterEach(cleanup);

const STALE = { ok: false, code: "CONFLICT", message: "STALE_PREVIEW: the authority state changed since the preview" };

function renderCell(api, cell = { held: true, source: "ADMIN_GRANTED" }) {
  render(<GrantCellControls api={api} objectKey="workOrder" actionKey="dispatch" roleKey="dispatcher"
    capabilityKey="workOrder.lifecycle.dispatch" cell={cell} vocabulary={{ status: "ready", kinds: [] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Revoke dispatch from dispatcher" }));
  return screen.getByRole("form", { name: "Revoke dispatch for dispatcher" });
}
const typeReason = (form, text) => fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: text } });
const confirmOf = (form) => within(form).getByRole("button", { name: "Confirm Revoke" });

describe("the preview step gates Confirm", () => {
  it("Confirm is disabled before a preview, enabled on WOULD_APPLY, and disabled again when an input changes", async () => {
    const api = { previewAuthorityChange: wouldApplyPreview(), revokeObjectActionFromRole: vi.fn(async () => ({ ok: true, data: {} })) };
    const form = renderCell(api);
    // The preview needs the complete change, reason included: it is part of what is previewed and committed.
    expect(within(form).getByRole("button", { name: "Preview impact" }).disabled).toBe(true);
    typeReason(form, "dispatch moves");
    expect(confirmOf(form).disabled).toBe(true);
    await previewImpact(form);
    expect(api.previewAuthorityChange).toHaveBeenCalledWith("revokeObjectActionFromRole",
      { objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher", reason: "dispatch moves" });
    expect(confirmOf(form).disabled).toBe(false);
    typeReason(form, "dispatch moves to field managers");
    expect(confirmOf(form).disabled).toBe(true);
    expect(form.querySelector('[data-authority-preview="IDLE"]')).toBeTruthy();
    expect(api.revokeObjectActionFromRole).not.toHaveBeenCalled();
  });

  it("the commit carries the preview's digest", async () => {
    const api = { previewAuthorityChange: wouldApplyPreview(), revokeObjectActionFromRole: vi.fn(async () => ({ ok: true, data: {} })) };
    const form = renderCell(api);
    typeReason(form, "dispatch moves");
    await previewImpact(form);
    await act(async () => { fireEvent.click(confirmOf(form)); });
    expect(api.revokeObjectActionFromRole).toHaveBeenCalledWith({
      objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher", reason: "dispatch moves", previewDigest: PREVIEW_DIGEST });
  });

  it("NO_OP says nothing changes and offers no commit", async () => {
    const api = { previewAuthorityChange: wouldApplyPreview({ outcome: "NO_OP", affectedCount: 0 }), revokeObjectActionFromRole: vi.fn() };
    const form = renderCell(api);
    typeReason(form, "x");
    await previewImpact(form, "NO_OP");
    expect(form.textContent).toMatch(/Nothing changes/);
    expect(confirmOf(form).disabled).toBe(true);
    fireEvent.submit(form);
    expect(api.revokeObjectActionFromRole).not.toHaveBeenCalled();
  });

  it("WOULD_REFUSE shows the server's refusal verbatim -- including a protected-Owner refusal -- and offers no commit", async () => {
    const api = {
      previewAuthorityChange: wouldApplyPreview({ outcome: "WOULD_REFUSE", refusal: { code: "WOULD_REMOVE_LAST_ADMINISTRATION_PATH", category: "CONFLICT",
        message: "WOULD_REMOVE_LAST_ADMINISTRATION_PATH: the tenant would be left with no holder of admin.securityPolicy.write" } }),
      revokeObjectActionFromRole: vi.fn(),
    };
    const form = renderCell(api);
    typeReason(form, "x");
    await previewImpact(form, "WOULD_REFUSE");
    const refusal = form.querySelector('[data-preview-refusal="WOULD_REMOVE_LAST_ADMINISTRATION_PATH"]');
    expect(refusal.textContent).toMatch(/CONFLICT: WOULD_REMOVE_LAST_ADMINISTRATION_PATH: the tenant would be left/);
    expect(confirmOf(form).disabled).toBe(true);
    fireEvent.submit(form);
    expect(api.revokeObjectActionFromRole).not.toHaveBeenCalled();
  });

  it("STALE_PREVIEW on commit discards the preview, says so, and requires a NEW preview before Confirm", async () => {
    const revoke = vi.fn().mockResolvedValueOnce(STALE).mockResolvedValueOnce({ ok: true, data: {} });
    const api = { previewAuthorityChange: wouldApplyPreview(), revokeObjectActionFromRole: revoke };
    const form = renderCell(api);
    typeReason(form, "x");
    await previewImpact(form);
    await act(async () => { fireEvent.click(confirmOf(form)); });
    expect(revoke).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(form.querySelector("[data-preview-stale]")).toBeTruthy());
    expect(confirmOf(form).disabled).toBe(true);
    fireEvent.submit(form);
    expect(revoke).toHaveBeenCalledTimes(1);
    await previewImpact(form);
    expect(api.previewAuthorityChange).toHaveBeenCalledTimes(2);
    await act(async () => { fireEvent.click(confirmOf(form)); });
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it("a preview that cannot be taken keeps Confirm disabled (fail closed), whatever the reason", async () => {
    for (const answer of [
      { ok: false, code: "UNKNOWN_OPERATION", message: '"previewAuthorityChange" is not an Administration operation' },
      { ok: false, code: "FORBIDDEN", message: "admin.securityPolicy.write is required" },
      { ok: false, code: "UNREACHABLE", message: "the Administration API could not be reached" },
    ]) {
      cleanup();
      const api = { previewAuthorityChange: vi.fn(async () => answer), revokeObjectActionFromRole: vi.fn() };
      const form = renderCell(api);
      typeReason(form, "x");
      fireEvent.click(within(form).getByRole("button", { name: "Preview impact" }));
      await waitFor(() => expect(form.querySelector(`[data-preview-failure="${answer.code}"]`)).toBeTruthy());
      expect(confirmOf(form).disabled).toBe(true);
      expect(api.revokeObjectActionFromRole).not.toHaveBeenCalled();
    }
  });

  it("PREVIEW_BUSY asks for a retry and offers no commit", async () => {
    const api = { previewAuthorityChange: wouldApplyPreview({ outcome: "PREVIEW_BUSY", busy: { reason: "LOCK_TIMEOUT" } }), revokeObjectActionFromRole: vi.fn() };
    const form = renderCell(api);
    typeReason(form, "x");
    await previewImpact(form, "PREVIEW_BUSY");
    expect(form.querySelector('[data-preview-busy="LOCK_TIMEOUT"]')).toBeTruthy();
    expect(within(form).getByRole("button", { name: "Preview impact again" })).toBeTruthy();
    expect(confirmOf(form).disabled).toBe(true);
  });
});

describe("what the preview shows", () => {
  it("COUNTS_ONLY renders counts and names nobody", async () => {
    const api = { previewAuthorityChange: wouldApplyPreview({ affectedCount: 3, unaffectedHolders: 2, detail: "COUNTS_ONLY" }), revokeObjectActionFromRole: vi.fn() };
    const form = renderCell(api);
    typeReason(form, "x");
    await previewImpact(form);
    expect(form.querySelector("[data-preview-counts]").textContent).toMatch(/3 people affected · 2 current holder\(s\) unaffected/);
    expect(form.querySelector('[data-preview-detail="COUNTS_ONLY"]')).toBeTruthy();
    expect(form.querySelector("[data-preview-principal]")).toBeNull();
  });

  it("FULL detail lists each affected person with gains and losses, notes, and a protected-standing badge and warning", async () => {
    const affected = [
      { principalId: "pr-dana", protectedStanding: null, status: null, notes: [],
        changes: { flat: { added: [], removed: ["workOrder.lifecycle.dispatch"] }, surfaces: { added: [], removed: ["service.dispatch"] } } },
      { principalId: "pr-owner", protectedStanding: "OWNER", status: null, notes: ["PROTECTED_OWNER_REDUCED: a protected Owner loses authority"],
        changes: { flat: { added: ["x.read"], removed: ["workOrder.lifecycle.dispatch"] } } },
    ];
    const api = { previewAuthorityChange: wouldApplyPreview({ detail: "FULL", affectedCount: 2, affected, protectedAffected: { owners: 1, administrators: 0 } }),
      revokeObjectActionFromRole: vi.fn() };
    const form = renderCell(api);
    typeReason(form, "x");
    await previewImpact(form);
    const dana = form.querySelector('[data-preview-principal="pr-dana"]');
    expect(dana.querySelector('[data-preview-change="flat"] [data-preview-losses]').textContent).toBe("loses workOrder.lifecycle.dispatch");
    expect(dana.querySelector('[data-preview-change="surfaces"]').textContent).toMatch(/surfaces: loses service.dispatch/);
    const owner = form.querySelector('[data-preview-principal="pr-owner"]');
    expect(owner.querySelector('[data-preview-protected="OWNER"]').textContent).toBe("Protected Owner");
    expect(owner.querySelector("[data-preview-gains]").textContent).toBe("gains x.read");
    expect(owner.textContent).toMatch(/PROTECTED_OWNER_REDUCED/);
    expect(form.querySelector("[data-preview-protected-affected]").textContent).toMatch(/1 protected Owner\(s\)/);
  });

  it("object-wide authority shows each action's previewed outcome", async () => {
    const perAction = [
      { actionKey: "dispatch", capabilityKey: "workOrder.lifecycle.dispatch", outcome: "GRANTED", refusalCode: null },
      { actionKey: "issueSchedulingLink", capabilityKey: "workOrder.selfScheduling.issue", outcome: "REFUSED", refusalCode: "SYSTEM_INVARIANT" },
    ];
    const MATRIX = { objectKey: "workOrder", label: "Work Orders", actions: [
      { actionKey: "dispatch", actionKind: "BUSINESS_ACTION", displayLabel: "Dispatch", capabilityKey: "workOrder.lifecycle.dispatch", roles: [], principals: [] }] };
    const api = {
      listObjectsWithActions: vi.fn(async () => ({ ok: true, data: [{ key: "workOrder", label: "Work Orders", actions: MATRIX.actions }] })),
      getObjectActionGrantMatrix: vi.fn(async () => ({ ok: true, data: MATRIX })),
      listRoles: vi.fn(async () => ({ ok: true, data: [{ key: "generalManager", name: "General Manager" }] })),
      previewAuthorityChange: wouldApplyPreview({ operation: "applyObjectWideRoleAuthority", perAction }),
      applyObjectWideRoleAuthority: vi.fn(),
    };
    render(<ObjectAuthorityMatrix api={api} initialObjectKey="workOrder" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Permissions" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for General Manager" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Grant All Listed Actions…" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "GM dispatches" } });
    await previewImpact(dialog);
    expect(api.previewAuthorityChange).toHaveBeenCalledWith("applyObjectWideRoleAuthority", { objectKey: "workOrder", roleKey: "generalManager", mode: "GRANT", reason: "GM dispatches" });
    expect(dialog.querySelector('[data-preview-action="issueSchedulingLink"]').textContent).toMatch(/REFUSED — SYSTEM_INVARIANT/);
  });
});

describe("the matrix single-click toggle (it used to commit on ONE click)", () => {
  const MATRIX = { objectKey: "account", label: "Accounts", actions: [
    { actionKey: "read", actionKind: "READ", displayLabel: "View Customers", capabilityKey: "customer.record.read", roles: [{ roleKey: "salesperson", held: true, source: "SYSTEM_DEFAULT" }], principals: [] }] };
  const makeApi = (over = {}) => ({
    listObjectsWithActions: vi.fn(async () => ({ ok: true, data: [{ key: "account", label: "Accounts", actions: MATRIX.actions }] })),
    getObjectActionGrantMatrix: vi.fn(async () => ({ ok: true, data: MATRIX })),
    listRoles: vi.fn(async () => ({ ok: true, data: [{ key: "salesperson", name: "Salesperson" }] })),
    grantObjectActionToRole: vi.fn(),
    revokeObjectActionFromRole: vi.fn(async () => ({ ok: true, data: null })),
    previewAuthorityChange: wouldApplyPreview({ operation: "revokeObjectActionFromRole" }),
    ...over,
  });
  async function clickCell(api) {
    render(<ObjectAuthorityMatrix api={api} initialObjectKey="account" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Permissions" }));
    fireEvent.change(screen.getByLabelText("Reason for Changes (Recorded in the Audit Trail)"), { target: { value: "sellers stop reading" } });
    fireEvent.click(await screen.findByLabelText("Salesperson — View Customers (customer.record.read)"));
    return screen.findByRole("dialog");
  }

  it("one click opens a confirmation and commits NOTHING; Cancel closes it with nothing sent", async () => {
    const api = makeApi();
    const dialog = await clickCell(api);
    expect(api.revokeObjectActionFromRole).not.toHaveBeenCalled();
    expect(api.grantObjectActionToRole).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText(/Reason/).value).toBe("sellers stop reading");
    expect(within(dialog).getByRole("button", { name: "Confirm Revoke" }).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.previewAuthorityChange).not.toHaveBeenCalled();
    expect(api.revokeObjectActionFromRole).not.toHaveBeenCalled();
  });

  it("commits only after the server's preview and an explicit Confirm, with the digest, then re-reads", async () => {
    const api = makeApi();
    const dialog = await clickCell(api);
    await previewImpact(dialog);
    expect(api.previewAuthorityChange).toHaveBeenCalledWith("revokeObjectActionFromRole", { objectKey: "account", actionKey: "read", roleKey: "salesperson", reason: "sellers stop reading" });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Revoke" })); });
    expect(api.revokeObjectActionFromRole).toHaveBeenCalledWith({ objectKey: "account", actionKey: "read", roleKey: "salesperson", reason: "sellers stop reading", previewDigest: PREVIEW_DIGEST });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/Revoked View Customers from Salesperson/)).toBeTruthy();
    expect(api.getObjectActionGrantMatrix.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("a STALE_PREVIEW keeps the confirmation open and requires a new preview", async () => {
    const api = makeApi({ revokeObjectActionFromRole: vi.fn(async () => STALE) });
    const dialog = await clickCell(api);
    await previewImpact(dialog);
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Revoke" })); });
    await waitFor(() => expect(dialog.querySelector("[data-preview-stale]")).toBeTruthy());
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(within(dialog).getByRole("button", { name: "Confirm Revoke" }).disabled).toBe(true);
  });
});

describe("the client seam: one builder for the preview and the commit", () => {
  it("covers exactly the nine authority changes", () => {
    expect([...AUTHORITY_CHANGE_OPERATIONS].sort()).toEqual([
      "applyObjectWideRoleAuthority", "assignRole", "grantObjectActionToPrincipal", "grantObjectActionToRole",
      "retireGrantCondition", "revokeObjectActionFromPrincipal", "revokeObjectActionFromRole", "revokeRole", "setGrantCondition"]);
  });

  it("previewAuthorityChange sends { change: { operation, input } } with the commit's own input; the commit adds previewDigest only when given", async () => {
    const call = vi.fn(async () => ({ ok: true, data: previewReport() }));
    const client = createAdminControlPlaneClient(call);
    const args = { principalId: "p", roleId: "r", reason: "why", scopeType: "salesChannel", scopeValue: "RETAIL" };
    await client.previewAuthorityChange("assignRole", args);
    await client.assignRole({ ...args, previewDigest: PREVIEW_DIGEST });
    await client.assignRole(args);
    expect(call.mock.calls).toEqual([
      ["previewAuthorityChange", { change: { operation: "assignRole", input: AUTHORITY_CHANGE_INPUT.assignRole(args) } }],
      ["assignRole", { ...AUTHORITY_CHANGE_INPUT.assignRole(args), previewDigest: PREVIEW_DIGEST }],
      ["assignRole", AUTHORITY_CHANGE_INPUT.assignRole(args)],
    ]);
    const unknown = await client.previewAuthorityChange("createRole", {});
    expect(unknown.code).toBe("UNKNOWN_OPERATION");
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("isStalePreview recognises only the STALE_PREVIEW refusal", () => {
    expect(isStalePreview(STALE)).toBe(true);
    expect(isStalePreview({ ok: false, code: "CONFLICT", message: "WOULD_REMOVE_LAST_ADMINISTRATION_PATH: x" })).toBe(false);
    expect(isStalePreview({ ok: true })).toBe(false);
  });
});
