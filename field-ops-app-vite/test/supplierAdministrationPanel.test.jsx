// DECISIONS #196 -- the Supplier administration panel: organization picked BY NAME, server-authored name, status never a delete,
// and a person without supplier authority sees no management controls (the server refused the organization read).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const calls = [];
let orgResult;
vi.mock("../src/services/partsOperationsReads.js", () => ({
  fetchSupplierOrganizationOptions: vi.fn(async () => { if (orgResult instanceof Error) throw orgResult; return orgResult; }),
  fetchSupplierList: vi.fn(async () => [{ id: "sup-coldchain", supplierId: "sup-coldchain", name: "ColdChain Components (SAMPLE)", status: "ACTIVE", version: 1 }]),
  createSupplierRelationship: vi.fn(async (input) => { calls.push(["createSupplier", input]); return { outcome: "created" }; }),
  setSupplierRelationshipStatus: vi.fn(async (input) => { calls.push(["setSupplierStatus", input]); return { outcome: "deactivated" }; }),
}));
const { default: SupplierAdministration, supplierIdIsValid } = await import("../src/modules/purchasing/SupplierAdministration.jsx");

describe("Supplier administration panel", () => {
  beforeEach(() => { calls.length = 0; orgResult = [{ crmAccountId: "acct-arctic", name: "Arctic Parts Supply (SAMPLE)" }]; });

  it("creates a supplier from an organization chosen by name -- no name is typed, no organization id is shown", async () => {
    render(<SupplierAdministration />);
    const select = await screen.findByLabelText("Vendor organization");
    expect(screen.getByRole("option", { name: "Arctic Parts Supply (SAMPLE)" })).toBeTruthy();
    expect(screen.queryByText("acct-arctic")).toBeNull();
    fireEvent.change(select, { target: { value: "acct-arctic" } });
    fireEvent.change(screen.getByLabelText("Supplier id"), { target: { value: "sup-arcticparts" } });
    fireEvent.click(screen.getByRole("button", { name: "Create supplier" }));
    await waitFor(() => expect(calls).toEqual([["createSupplier", { supplierId: "sup-arcticparts", crmAccountId: "acct-arctic" }]]));
    expect(calls[0][1]).not.toHaveProperty("name");
  });

  it("deactivates (never deletes) with the version it read", async () => {
    render(<SupplierAdministration />);
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(calls[0][0]).toBe("setSupplierStatus"));
    expect(calls[0][1]).toMatchObject({ supplierId: "sup-coldchain", status: "INACTIVE", expectedVersion: 1 });
  });

  it("shows no management controls to a person the server refuses", async () => {
    orgResult = Object.assign(new Error("refused"), { code: "FORBIDDEN" });
    const { container } = render(<SupplierAdministration />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("validates the supplier id shape the server enforces", () => {
    expect(supplierIdIsValid("sup-arcticparts")).toBe(true);
    for (const bad of ["", "has space", "x/y", "a".repeat(65)]) expect(supplierIdIsValid(bad)).toBe(false);
  });
});
