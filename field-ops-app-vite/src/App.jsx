import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ControlTower from "./modules/controlTower/ControlTower";
import Jobs from "./modules/jobs/Jobs";
import Technicians from "./modules/technicians/Technicians";
import Dispatch from "./modules/dispatch/Dispatch";
import FieldMode from "./modules/mobile/FieldMode";
import Inventory from "./modules/inventory/Inventory";
import Operations from "./modules/operations/Operations";
import DispatcherBoard from "./modules/dispatcherBoard/DispatcherBoard";
import TechnicianDashboard from "./modules/technicianDashboard/TechnicianDashboard";
import AccountsList from "./modules/accounts/AccountsList";
import AccountDetail from "./modules/accounts/AccountDetail";
import WorkOrdersList from "./modules/workOrders/WorkOrdersList";
import WorkOrderWizard from "./modules/workOrders/WorkOrderWizard";
import WorkOrderDetailPage from "./modules/workOrders/WorkOrderDetailPage";
import PartsList from "./modules/inventory/PartsList";
import PartDetail from "./modules/inventory/PartDetail";
import WarehouseManagerHome from "./modules/inventoryRole/WarehouseManagerHome";
import { useAuth } from "./auth/AuthContext";
import Login from "./auth/Login";
import AppHeader from "./shared/ui/AppHeader";
import { InventoryProvider } from "./demo/InventoryContext";
import { IS_DEMO } from "./config/env";
import { ROLE_NAV_ACCESS } from "./domain/constants";
import AppShell from "./navigation/AppShell";
import PlaceholderPage from "./navigation/PlaceholderPage";
import { NAV_DOMAINS, isDomainVisible, isNavItemVisible } from "./navigation/navConfig";

// Sprint 2.0.1 -- Navigation Foundation (Release 2.0, Platform
// Experience). Real URL-based routing via react-router-dom, replacing
// the old flat useState tab model -- this is the source of truth for
// navigation now, not a NAV array in this file (removed; see
// navigation/navConfig.js and docs/architecture/SYSTEM_AUTHORITIES.md's
// "Navigation" row).
//
// This deliberately reintroduces react-router-dom after PR #22 tore
// out an earlier routing scaffold and removed the same dependency.
// That teardown was a scope-convergence decision (the scaffold was
// "structural only, not wired in" -- see PR #22's own body), not a
// permanent ban on client-side routing; Release 2.0 now has a real
// product requirement (working browser back/forward, route-aware
// business-domain navigation) the old tab-state model can't satisfy.
// See this sprint's PR description for the full before/after rationale.
//
// GitHub Pages has no server-side rewrite rules, so a deep link (or a
// refresh on any non-root path) needs the standard SPA fallback --
// see public/404.html + the redirect-restore script in index.html.
// BrowserRouter's `basename` matches vite.config's `base`
// ("/Taylor_Parts/field-ops/") so both agree on the same root.
//
// Legacy screen -> domain/sub-nav mapping lives in navConfig.js
// (`legacyKey` on each sub-nav item); this map below is just the
// key -> component lookup, since navConfig.js can't import .jsx
// components without becoming circular with App.jsx.
const LEGACY_COMPONENTS = {
  controlTower: ControlTower,
  jobs: Jobs,
  technicians: Technicians,
  dispatch: Dispatch,
  fieldMode: FieldMode,
  inventory: Inventory,
  operations: Operations,
  dispatcherBoard: DispatcherBoard,
  technicianDashboard: TechnicianDashboard,
};

function DashboardIndex({ role }) {
  // "My Dashboard" only has a real screen for the technician role
  // today (TechnicianDashboard.jsx, legacyKey "technicianDashboard").
  // Admin/dispatcher have no personalized-dashboard screen yet --
  // placeholder, per requirement #4, rather than forcing a screen
  // that doesn't fit their role.
  if (role === "technician") return <TechnicianDashboard />;
  return (
    <PlaceholderPage
      title="My Dashboard"
      note="A personalized dashboard for this role isn't built yet -- see Operations Dashboard for the current admin/dispatcher view."
    />
  );
}

function renderSubnavItem(domain, item, role) {
  if (domain.key === "dashboard" && item.key === "my") {
    return <DashboardIndex role={role} />;
  }
  // Sprint 2.0.2 -- Customer Foundation. Same special-case pattern as
  // DashboardIndex above: this item has no legacyKey (it's a brand
  // new screen, not a re-homed one), so it needs an explicit case
  // rather than the generic legacyKey/PlaceholderPage branches below.
  if (domain.key === "customers" && item.key === "customers") {
    return <AccountsList />;
  }
  // Sprint 2.0.3 -- Work Order Experience. "Work Orders" now renders
  // the real workspace; the legacy Jobs.jsx screen it used to render
  // (via legacyKey "jobs") is relocated to the "Job Assignments" item
  // below, which keeps its legacyKey unchanged.
  if (domain.key === "service" && item.key === "workOrders") {
    return <WorkOrdersList />;
  }
  // Sprint 2.1.1 -- Inventory Domain Foundation. "Parts" now renders
  // the real Inventory workspace; the legacy demo Inventory.jsx it
  // used to render (via legacyKey "inventory") is left in place,
  // untouched, and simply no longer routed to from this slot -- same
  // "deprecated, not deleted" treatment as domain/workOrderLifecycle.js.
  // legacyKey: "inventory" stays on this nav item unchanged so
  // existing role gating (ROLE_NAV_ACCESS, admin/dispatcher only) is
  // untouched.
  if (domain.key === "inventory" && item.key === "parts") {
    return <PartsList />;
  }
  // Issue #100 PR 2b -- WAREHOUSE_MANAGER's dedicated, role-scoped
  // surface. No legacyKey (net-new screen); item.operationalRoleAccess
  // (navConfig.js) already keeps this route from being generated at all
  // for any role/session other than an ACTIVE, reciprocally linked
  // WAREHOUSE_MANAGER, so this case never renders for admin/dispatcher
  // or an ineligible technician.
  if (domain.key === "inventoryRole" && item.key === "warehouse") {
    return <WarehouseManagerHome />;
  }
  if (item.legacyKey) {
    const Component = LEGACY_COMPONENTS[item.legacyKey];
    return <Component />;
  }
  return <PlaceholderPage title={item.label} />;
}

function AppRoutes({ role, allowedLegacyKeys, operationalContext }) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {NAV_DOMAINS.filter((d) => !d.future).map((domain) => (
        <Route key={domain.key} path={domain.path}>
          {domain.subnav
            .filter((item) => isNavItemVisible(item, role, allowedLegacyKeys, operationalContext))
            .map((item) => (
              <Route
                key={item.key}
                path={item.path || undefined}
                index={item.path === ""}
                element={renderSubnavItem(domain, item, role)}
              />
            ))}
          {/* Sprint 2.0.2 -- first parameterized route in this
              generic, subnav-driven route generator. navConfig.js's
              subnav items are all static paths; a per-record detail
              page needs a :param segment the generic loop above
              doesn't produce, so it's added here as one extra,
              domain-specific route rather than reshaping the whole
              generator for a single case.
              Gated by isDomainVisible(), not just domain.key -- a
              technician (no accounts/locations/contacts read access,
              deliberately, per firestore.rules) must not have this
              route mounted at all. Without this check, a technician
              directly navigating to /customers/:accountId would mount
              AccountDetail and its Firestore listeners regardless of
              nav visibility, hitting permission-denied. */}
          {domain.key === "customers" && isDomainVisible(domain, role, allowedLegacyKeys, operationalContext) && (
            <>
              {/* Customer hierarchy nav cleanup: the Contacts / Locations /
                  Equipment / Service History subnav entries were removed
                  (navConfig.js). Their retired paths redirect to /customers
                  so they can NEVER be captured by the :accountId detail route
                  (a static path segment outranks the dynamic :accountId in
                  React Router's match ranking; listed first here for clarity). */}
              {["contacts", "locations", "equipment", "service-history"].map((retired) => (
                <Route key={retired} path={retired} element={<Navigate to="/customers" replace />} />
              ))}
              <Route path=":accountId" element={<AccountDetail />} />
            </>
          )}
          {/* Sprint 2.0.3 -- gated to admin/dispatcher specifically,
              NOT isDomainVisible(service domain) -- a technician
              already has "service" domain visibility today (via the
              jobs/fieldMode legacyKeys on Dispatch/Job Assignments/
              Technician Workspace), so that check alone would still
              let a technician reach these two Work Order routes. Per
              the implementation plan's Section 7: WorkOrderActions.jsx
              embedded in the detail route is dispatcher-only in
              intent (hardcodes isOwnAssignment: false), and a
              technician's real lifecycle-action flow already lives on
              their own separate TechnicianDashboard route -- so these
              two routes simply don't exist for that role, same
              "route doesn't exist, falls through to the catch-all"
              behavior as the /customers/:accountId gate. */}
          {domain.key === "service" && (role === "admin" || role === "dispatcher") && (
            <>
              <Route path="work-orders/new" element={<WorkOrderWizard />} />
              <Route path="work-orders/:workOrderId" element={<WorkOrderDetailPage />} />
            </>
          )}
          {/* Platform Task 3 -- the retired /service/control-tower URL redirects
              to the new top-level /service-operations. A STATIC path segment, so
              React Router never lets a dynamic route capture it, and it's one
              declarative redirect (no double navigation). Unconditional: any role
              hitting the old URL lands on /service-operations, which itself fails
              closed for a role without Control Tower access (no index route ->
              catch-all -> /dashboard), same as before. */}
          {domain.key === "service" && (
            <Route path="control-tower" element={<Navigate to="/service-operations" replace />} />
          )}
          {/* Sprint 2.1.1 -- same pattern as /customers/:accountId above:
              gated by isDomainVisible() so this route isn't mounted at
              all for a role with no Inventory access (technician has no
              legacyKey/PLACEHOLDER_DEFAULT_ROLES access to any Inventory
              subnav item today, so isDomainVisible is already false for
              that role -- this route simply doesn't exist for them). */}
          {domain.key === "inventory" && isDomainVisible(domain, role, allowedLegacyKeys, operationalContext) && (
            <Route path=":partId" element={<PartDetail />} />
          )}
          {/* Platform Task 3 -- Service Operations fails CLOSED for a role without
              access. For admin/dispatcher the visible index item above renders
              Control Tower; for anyone else no index route is generated, so this
              explicit gated redirect (only when the domain is NOT visible) sends
              them to /dashboard instead of an empty shell -- a stronger denial
              than relying on the empty-Outlet fallthrough. */}
          {domain.key === "serviceOperations" && !isDomainVisible(domain, role, allowedLegacyKeys, operationalContext) && (
            <Route index element={<Navigate to="/dashboard" replace />} />
          )}
          {/* Issue #100 PR 2b -- per the Specification's "admin/dispatcher
              behavior: unchanged, and not reachable through the new
              routes" requirement: this domain's items all declare
              operationalRoleAccess, so isNavItemVisible() is already
              false for admin/dispatcher (hasEligibleOperationalRole()
              requires role === TECHNICIAN) -- no route under
              /inventory-role is ever generated for them. Left alone,
              that would fall through to the generic top-level catch-all
              (Navigate to="/dashboard"), same as any ineligible
              technician. Admin/dispatcher get an explicit, DIFFERENT
              redirect instead: the existing /inventory (Parts) domain is
              already a strict superset of every role-scoped surface this
              domain will ever offer, so a direct hit on any current or
              future /inventory-role/* path sends them there rather than
              /dashboard. path="*" (not index) so it also catches
              /inventory-role/warehouse itself, not just the bare
              /inventory-role index. An ineligible/inactive/broken-link/
              wrong-role TECHNICIAN gets no route here at all and falls
              through to the ordinary top-level catch-all below -- same
              mechanism as every other operationalRoleAccess-gated item,
              no separate handling needed. */}
          {domain.key === "inventoryRole" && (role === "admin" || role === "dispatcher") && (
            <Route path="*" element={<Navigate to="/inventory" replace />} />
          )}
          {/* Issue #100 PR 2b -- unlike Customers/Service Operations, this
              domain's sole subnav item has a real path segment ("warehouse"),
              not "" -- so, unlike those single-item domains, the top-level
              nav tab's own link (`/${domain.path}`, i.e. bare
              /inventory-role) does not itself match any generated child
              route. Without this index redirect, an eligible
              WAREHOUSE_MANAGER clicking the top-level tab would land on a
              blank Outlet instead of their page (confirmed live). Redirect
              to the first VISIBLE subnav item -- computed via the same
              isNavItemVisible() every other route/nav decision already
              uses, so this automatically keeps working, unchanged, once
              PR 1b/3b add their own sibling items (manager/mine) to this
              domain's subnav; nothing here needs to be revisited then. */}
          {domain.key === "inventoryRole" &&
            (() => {
              const firstVisible = domain.subnav.find((item) =>
                isNavItemVisible(item, role, allowedLegacyKeys, operationalContext)
              );
              return firstVisible ? <Route index element={<Navigate to={firstVisible.path} replace />} /> : null;
            })()}
        </Route>
      ))}

      {NAV_DOMAINS.filter((d) => d.future).map((domain) => (
        <Route
          key={domain.key}
          path={domain.path}
          element={<PlaceholderPage title={domain.label} note="This business area is planned for a future release (see docs/ROADMAP.md's Product Release Roadmap)." />}
        />
      ))}

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  const { user, role, loading, operationalRoles, employmentStatus } = useAuth();
  const allowedLegacyKeys = ROLE_NAV_ACCESS[role] ?? [];
  // Issue #100 -- PR 0. Threaded through as one stable object so every
  // isNavItemVisible/isDomainVisible call site can accept it uniformly;
  // no NAV_DOMAINS item declares operationalRoleAccess yet, so this has
  // no observable effect until a later PR adds one.
  const operationalContext = { operationalRoles, employmentStatus };
  const hasAnyAccess = NAV_DOMAINS.some((d) => isDomainVisible(d, role, allowedLegacyKeys, operationalContext));

  if (loading) return <div className="fo-panel">Loading...</div>;

  if (!user) return <Login />;

  if (!hasAnyAccess) {
    return (
      <div className="fo-panel">
        <h2>No access</h2>
        <p className="fo-muted">
          Your account isn't assigned a role yet. Contact an admin to get access.
        </p>
      </div>
    );
  }

  return (
    <InventoryProvider>
      <BrowserRouter basename="/Taylor_Parts/field-ops/">
        <div className="fo-app">
          {IS_DEMO && <div className="fo-demo-banner">DEMO MODE ACTIVE (SAFE - NO WRITES TO PRODUCTION)</div>}
          <AppHeader />
          <AppShell role={role} allowedLegacyKeys={allowedLegacyKeys} operationalContext={operationalContext}>
            <AppRoutes role={role} allowedLegacyKeys={allowedLegacyKeys} operationalContext={operationalContext} />
          </AppShell>
        </div>
      </BrowserRouter>
    </InventoryProvider>
  );
}
