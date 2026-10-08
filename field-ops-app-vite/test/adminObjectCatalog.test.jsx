// Approved Administration IA, Phase 2 (DECISIONS #213): Objects opens with a searchable catalog, technical keys sit
// behind "Show technical details", and a Reference custom field picks its target by business name.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const OBJECTS = [
  { id: "1", key: "customer", label: "Accounts", labelPlural: "Accounts", description: "Customers you sell to", origin: "SYSTEM", supportsDelete: false },
  { id: "2", key: "workOrder", label: "Work Orders", labelPlural: "Work Orders", origin: "SYSTEM", supportsDelete: false },
  { id: "3", key: "contact", label: "Contacts", labelPlural: "Contacts", origin: "SYSTEM", supportsDelete: false },
];
const FIELDS = [
  { id: "f1", key: "name", label: "Account Name", dataType: "STRING", origin: "SYSTEM", required: true, sensitivity: "NORMAL", lifecycle: "ACTIVE" },
];
const mutate = vi.fn(async () => ({ ok: true }));

vi.mock("../src/services/adminPolicyApiClient.js", async (importOriginal) => ({ ...(await importOriginal()), isPolicyApiConfigured: () => true }));
vi.mock("../src/modules/administration/usePolicyStore.js", () => ({
  usePolicyStore: (operation) => {
    if (operation === "listObjects") return { status: "ready", data: OBJECTS, error: null, reload: () => {} };
    if (operation === "readObjectWithFields") return { status: "ready", data: { fields: FIELDS }, error: null, mutate };
    return { status: "unconfigured", data: null, error: null };
  },
}));

import { ObjectsSurface, suggestFieldKey } from "../src/modules/administration/AdminPolicySurfaces.jsx";

afterEach(cleanup);

describe("Objects catalog", () => {
  it("searches by business name and hides keys until technical details are on", () => {
    render(<ObjectsSurface />);
    expect(screen.queryByText("customer")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search Objects"), { target: { value: "work" } });
    expect(screen.getByText(/1 of 3 objects/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Work Orders/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Accounts/ })).toBeNull();
    fireEvent.click(screen.getByLabelText("Show Technical Details"));
    expect(screen.getByText("workOrder")).toBeTruthy();
  });

  it("creates a Reference field by choosing the target object by name, as a Draft", async () => {
    render(<ObjectsSurface />);
    fireEvent.click(screen.getByRole("button", { name: /Accounts/ }));
    const form = screen.getByRole("form", { name: "Create a custom field" });
    fireEvent.change(within(form).getByLabelText("Label"), { target: { value: "Service Contract" } });
    expect(within(form).getByLabelText("Key").value).toBe("serviceContract");
    fireEvent.change(within(form).getByLabelText("Type"), { target: { value: "REFERENCE" } });
    fireEvent.change(within(form).getByLabelText("Links To"), { target: { value: "contact" } });
    fireEvent.submit(form);
    await screen.findByRole("status");
    expect(mutate).toHaveBeenCalledWith("createCustomField", expect.objectContaining({
      objectKey: "customer", key: "serviceContract", label: "Service Contract", dataType: "REFERENCE", referenceTo: "contact",
    }));
    expect(screen.getByRole("status").textContent).toMatch(/Draft/);
  });

  it("suggests a camelCase key from a label", () => {
    expect(suggestFieldKey("Preferred Delivery Window")).toBe("preferredDeliveryWindow");
    expect(suggestFieldKey("  ")).toBe("");
    expect(suggestFieldKey("2nd Contact")).toBe("field2ndContact");
  });
});
