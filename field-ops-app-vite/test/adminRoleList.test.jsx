// Approved Administration IA, Phase 3 (DECISIONS #214) and Administration UI corrections ADMIN-UI-005/006/007
// (DECISIONS #217): Security Roles is a searchable, filterable, compact selectable list beside the selected Role's
// detail, which is populated by default; a ?role= link that names an unavailable Role says so instead of
// substituting another Role.
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

const setSearch = (s) => window.history.replaceState(null, "", `/administration/roles-permissions${s}`);
afterEach(() => { cleanup(); setSearch(""); });
const names = (list) => within(list).getAllByRole("button").map((b) => b.querySelector(".fo-admin-selectlist__name").textContent);
const detail = () => screen.queryByLabelText("detail")?.textContent ?? null;

describe("Security Roles master-detail", () => {
  it("opens with the first Role selected, and filters by search and by protected", () => {
    render(<RolesPermissionsSurface />);
    const list = screen.getByRole("group", { name: "Select a role" });
    expect(names(list)).toEqual(["Owner", "Administrator", "Salesperson", "Service Dispatcher"]);
    expect(detail()).toBe("detail:owner");
    expect(within(list).getByRole("button", { name: /^Owner/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Job Role").closest("p").textContent).toMatch(/grants nothing/);

    fireEvent.change(screen.getByLabelText("Search Security Roles"), { target: { value: "customer" } });
    expect(names(list)).toEqual(["Salesperson"]);
    expect(detail()).toBe("detail:salesperson");
    expect(screen.getByText("1 of 4")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search Security Roles"), { target: { value: "" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Role type" })).getByRole("button", { name: "Protected" }));
    expect(names(list)).toEqual(["Owner", "Administrator"]);
    expect(within(list).getAllByText("Protected")).toHaveLength(2);
  });

  it("keeps an explicit choice while it still matches; otherwise shows the first match; empty state when none", () => {
    render(<RolesPermissionsSurface />);
    const list = screen.getByRole("group", { name: "Select a role" });
    fireEvent.click(within(list).getByRole("button", { name: /^Service Dispatcher/ }));
    expect(detail()).toBe("detail:dispatcher");
    fireEvent.click(within(screen.getByRole("group", { name: "Role type" })).getByRole("button", { name: "Not protected" }));
    expect(detail()).toBe("detail:dispatcher");
    // Clicking the selected Role again keeps it selected (no empty panel).
    fireEvent.click(within(list).getByRole("button", { name: /^Service Dispatcher/ }));
    expect(detail()).toBe("detail:dispatcher");
    fireEvent.click(within(screen.getByRole("group", { name: "Role type" })).getByRole("button", { name: "Protected" }));
    expect(detail()).toBe("detail:owner");
    fireEvent.change(screen.getByLabelText("Search Security Roles"), { target: { value: "nothing-matches" } });
    expect(detail()).toBeNull();
    expect(screen.getByText(/No Security Role matches the search or filter/)).toBeTruthy();
  });

  it("a ?role= link selects that Role", () => {
    setSearch("?role=salesperson");
    render(<RolesPermissionsSurface />);
    expect(detail()).toBe("detail:salesperson");
  });

  it("a ?role= link to an unavailable Role says so and does not substitute another Role", () => {
    setSearch("?role=notARealRole");
    render(<RolesPermissionsSurface />);
    expect(detail()).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/linked Security Role isn.t available/);
    // The administrator can still choose one.
    fireEvent.click(within(screen.getByRole("group", { name: "Select a role" })).getByRole("button", { name: /^Administrator/ }));
    expect(detail()).toBe("detail:admin");
    expect(screen.queryByText(/linked Security Role isn.t available/)).toBeNull();
  });
});
