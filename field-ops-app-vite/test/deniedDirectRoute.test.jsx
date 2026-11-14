// UAT AUTH-UI-01 -- an unauthorized DIRECT URL renders the governed denial inside the application shell, with a way
// back, and mounts nothing that belongs to the screen it refused.
//
// The route table is the real one (AppRoutes) inside the real shell (AppShell); only the screens' data surfaces are
// stubbed. AdminUsers is replaced by a stub that records every mount: the Users directory subscribes on mount, so
// "it never mounted" IS "no admin subscription" -- the same proof the isDomainVisible gating is meant to give.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { AppRoutes } from "../src/App.jsx";
import AppShell from "../src/navigation/AppShell.jsx";
import { firstAuthorizedDestination } from "../src/navigation/firstAuthorizedDestination.js";
import { buildNavigationAuthority, EXPERIENCE_STATE } from "../src/access/experienceContext.js";
import { NAV_DOMAINS, isNavItemVisible } from "../src/navigation/navConfig.js";

const mounted = vi.hoisted(() => ({ adminUsers: 0 }));

vi.mock("../src/firebase/firebase", () => ({ db: null, auth: null, functions: null, APP_ENVIRONMENT: { id: "test", role: "sandbox", deployment: "platform" } }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { email: "t@example.test" }, role: "technician", logout: () => {} }) }));
vi.mock("../src/shared/ui/AppHeader", () => ({ default: () => <header data-testid="app-header" /> }));
vi.mock("../src/shared/ui/NotificationControl.jsx", () => ({ default: () => null }));
vi.mock("../src/modules/search/SiteSearch.jsx", () => ({ default: () => null }));
vi.mock("../src/modules/employees/MyEmployeeProfile.jsx", () => ({ default: () => <p>my profile page</p> }));
vi.mock("../src/modules/administration/AdminUsers", () => ({
  default: () => {
    mounted.adminUsers += 1;
    return <p>ADMIN USERS DIRECTORY</p>;
  },
}));

const eos = (surfaces) => ({
  hasCapability: () => false,
  eosNavigationAuthority: buildNavigationAuthority({
    state: EXPERIENCE_STATE.READY,
    context: { tenantId: "t", principalId: "p", securityRoleKeys: [], employeeId: null, workEligibility: [], operationalScopes: [], surfaces },
  }),
});

// serviceTechnician: holds Work Order work and nothing in Administration. A second unauthorized role (inventory only).
const SERVICE_TECHNICIAN = eos(["service.workOrders"]);
const INVENTORY_ONLY = eos(["inventory.balances", "inventory.catalog"]);
const ADMIN_USERS = eos(["administration.users"]);

let nav;
function Probe() {
  const location = useLocation();
  nav = { navigate: useNavigate(), pathname: location.pathname };
  return null;
}

function mount(entries, operationalContext, index) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Probe />
      <AppShell role={null} allowedLegacyKeys={[]} operationalContext={operationalContext}>
        <AppRoutes role="technician" allowedLegacyKeys={[]} operationalContext={operationalContext} />
      </AppShell>
    </MemoryRouter>,
  );
}

const denial = () => screen.findByText("Employees & Users isn't available to your role");

function expectDeniedInsideShell(container) {
  expect(container.querySelector(".fo-shell")).toBeTruthy();
  expect(container.querySelector("aside.fo-rail")).toBeTruthy();
  expect(container.querySelector("main#fo-main")).toBeTruthy();
  expect(container.querySelector("main .fo-admin")).toBeTruthy();
  expect(screen.queryByText("ADMIN USERS DIRECTORY")).toBeNull();
  expect(mounted.adminUsers).toBe(0);
}

beforeEach(() => {
  mounted.adminUsers = 0;
  Element.prototype.scrollIntoView = () => {}; // jsdom has none; the rail scrolls the active item into view
});

describe("unauthorized direct route renders the governed denial in the shell", () => {
  it("(a) serviceTechnician on /administration/users: shell, denial, route back to an authorized workspace, no admin content", async () => {
    const { container } = mount(["/administration/users"], SERVICE_TECHNICIAN);
    await denial();
    expectDeniedInsideShell(container);
    const back = firstAuthorizedDestination(null, [], SERVICE_TECHNICIAN);
    expect(back).not.toBeNull();
    // The route back is a destination this principal can really open, and the link says where it goes.
    const link = screen.getByRole("link", { name: `Go to ${back.label}` });
    expect(link.getAttribute("href")).toBe(back.to);
    const target = NAV_DOMAINS.flatMap((d) => (d.subnav ?? []).map((i) => ({ d, i })))
      .find(({ d, i }) => (i.path ? `/${d.path}/${i.path}` : `/${d.path}`) === back.to);
    expect(isNavItemVisible(target.i, null, [], SERVICE_TECHNICIAN)).toBe(true);
    expect(link.closest("main")).toBeTruthy();
  });

  it("(b) a fresh mount at that URL (a refresh) gives the same answer", async () => {
    const first = mount(["/administration/users"], SERVICE_TECHNICIAN);
    await denial();
    first.unmount();
    const { container } = mount(["/administration/users"], SERVICE_TECHNICIAN);
    await denial();
    expectDeniedInsideShell(container);
    expect(nav.pathname).toBe("/administration/users");
  });

  it("(c) Back from the denial lands on the prior authorized page", async () => {
    const { container } = mount(["/my-profile", "/administration/users"], SERVICE_TECHNICIAN, 1);
    await denial();
    expectDeniedInsideShell(container);
    act(() => nav.navigate(-1));
    await screen.findByText("my profile page");
    expect(nav.pathname).toBe("/my-profile");
  });

  it.each(["/administration", "/administration/employees"])("(d) %s as serviceTechnician: same denial, nothing mounted", async (url) => {
    const { container } = mount([url], SERVICE_TECHNICIAN);
    await denial();
    expectDeniedInsideShell(container);
    // The redirect moves the address and decides no access.
    expect(nav.pathname).toBe("/administration/users");
  });

  it("(e) an authorized Administration role still reaches the Users page", async () => {
    mount(["/administration/users"], ADMIN_USERS);
    await screen.findByText("ADMIN USERS DIRECTORY");
    expect(mounted.adminUsers).toBe(1);
    expect(screen.queryByText(/isn't available to your role/)).toBeNull();
  });

  it("(f) another unauthorized role gets the same denial, and a different denied domain does too", async () => {
    const { container, unmount } = mount(["/administration/users"], INVENTORY_ONLY);
    await denial();
    expectDeniedInsideShell(container);
    const back = firstAuthorizedDestination(null, [], INVENTORY_ONLY);
    expect(back).not.toBeNull();
    expect(screen.getByRole("link", { name: `Go to ${back.label}` })).toBeTruthy();
    unmount();

    // Shared path, not a Users special case: a denied item in another domain states its refusal the same way.
    const other = mount(["/administration/audit-logs"], SERVICE_TECHNICIAN);
    await screen.findByText(/isn't available to your role/);
    expect(other.container.querySelector("[data-empty-variant='denied']")).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Go to / })).toBeTruthy();
  });
});
