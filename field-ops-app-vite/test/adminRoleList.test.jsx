// Approved Administration IA, Phase 3 (DECISIONS #214): Security Roles is a searchable list beside the selected
// Role's detail, with Job Role / Security Role / permission kept distinct in plain words.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const ROLES = [
  { id: "r1", key: "owner", name: "Owner", protected: true },
  { id: "r2", key: "admin", name: "Administrator", protected: true },
  { id: "r3", key: "salesperson", name: "Salesperson", protected: false, description: "Works customer accounts" },
  { id: "r4", key: "dispatcher", name: "Service Dispatcher", protected: false },
];

vi.mock("../src/services/adminPolicyApiClient.js", async (importOriginal) => ({ ...(await importOriginal()), isPolicyApiConfigured: () => true }));
vi.mock("../src/modules/administration/usePolicyStore.js", () => ({
  usePolicyStore: (operation) => (operation === "listRoles"
    ? { status: "ready", data: ROLES, error: null, reload: () => {}, mutate: vi.fn() }
    : { status: "ready", data: [], error: null, reload: () => {} }),
}));
vi.mock("../src/modules/administration/SecurityRoleDetail.jsx", () => ({
  default: ({ roleKey }) => <section aria-label="detail">detail:{roleKey}</section>,
}));

import { RolesPermissionsSurface } from "../src/modules/administration/AdminPolicySurfaces.jsx";

afterEach(cleanup);

describe("Security Roles master-detail", () => {
  it("filters the list by search and by protected, and shows the chosen Role beside it", () => {
    render(<RolesPermissionsSurface />);
    const list = screen.getByRole("group", { name: "Select a role" });
    expect(within(list).getAllByRole("button")).toHaveLength(4);
    expect(screen.getByText("Job Role").closest("p").textContent).toMatch(/grants nothing/);

    fireEvent.change(screen.getByLabelText("Search Security Roles"), { target: { value: "customer" } });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(["Salesperson"]);
    fireEvent.click(within(list).getByRole("button", { name: "Salesperson" }));
    expect(screen.getByLabelText("detail").textContent).toBe("detail:salesperson");

    fireEvent.change(screen.getByLabelText("Search Security Roles"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Protected" }));
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(["Owner · Protected", "Administrator · Protected"]);
  });
});
