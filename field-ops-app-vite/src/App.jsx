import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { routerBasenameFrom } from "./routerBasename";
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
import SalesWorkspace from "./modules/sales/SalesWorkspace";
import EquipmentWorkspace from "./modules/equipment/EquipmentWorkspace";
import EquipmentDetail from "./modules/equipment/EquipmentDetail";
import AccountDetail from "./modules/accounts/AccountDetail";
import PartsShadowParityDiagnostics from "./modules/inventory/PartsShadowParityDiagnostics";
import AdministrationOverview from "./modules/administration/AdministrationOverview";
import AdministrationUnavailable from "./modules/administration/AdministrationUnavailable";
import AdminUsers from "./modules/administration/AdminUsers";
import AdminRolesPermissions from "./modules/administration/AdminRolesPermissions";
import IntegrationsFaq from "./modules/administration/IntegrationsFaq";
import PurchaseOrders from "./modules/purchasing/PurchaseOrders";
import Receipts from "./modules/purchasing/Receipts";
import Suppliers from "./modules/purchasing/Suppliers";
import Receiving from "./modules/inventory/Receiving";
import Transfers from "./modules/inventory/Transfers";
import Warehouses from "./modules/inventory/Warehouses";
import SchedulingWorkspace from "./modules/scheduling/SchedulingWorkspace";
import CoordinatedVisitsWorkspace from "./modules/service/CoordinatedVisitsWorkspace";
import CoordinatedMissionView from "./modules/mobile/CoordinatedMissionView";
import WorkOrdersList from "./modules/workOrders/WorkOrdersList";
import WorkOrderWizard from "./modules/workOrders/WorkOrderWizard";
import WorkOrderDetailPage from "./modules/workOrders/WorkOrderDetailPage";
import PartsList from "./modules/inventory/PartsList";
import PartMasterList from "./modules/inventory/PartMasterList";
import Manufacturers from "./modules/inventory/Manufacturers";
import TruckInventory from "./modules/inventory/TruckInventory";
import { useTruckRegistrySource } from "./hooks/useTruckRegistrySource";
import { useTruckManagement } from "./hooks/useTruckManagement";
import { useDriverOptions } from "./hooks/useDriverOptions";
import { useWarehouseOptions } from "./hooks/useWarehouseOptions";
import PartDetail from "./modules/inventory/PartDetail";
import WarehouseManagerHome from "./modules/inventoryRole/WarehouseManagerHome";
import PartsManagerHome from "./modules/inventoryRole/PartsManagerHome";
import PartsAssociateHome from "./modules/inventoryRole/PartsAssociateHome";
import { useAuth } from "./auth/AuthContext";
import Login from "./auth/Login";
import { InventoryProvider } from "./demo/InventoryContext";
import { IS_DEMO } from "./config/env";
import { ROLE_NAV_ACCESS, ROLES } from "./domain/constants";
import { createPermissionPreviewer } from "./access/navPermissionPreview";
import { resolveEffectivePermission } from "./access/resolveEffectivePermission";
import { COMPATIBILITY_ROLES } from "./access/compatibilityRoles";
import { CAPABILITY_ACTIVATION_OVERRIDE_SET } from "./config/capabilityActivationOverrides";
import { useReportCapabilities } from "./access/useReportCapabilities";
import ReportBuilder from "./modules/reporting/ReportBuilder";
import SavedReports from "./modules/reporting/SavedReports";
import FailureState from "./shared/ui/FailureState";

const previewHasPermission = createPermissionPreviewer(
  resolveEffectivePermission,
  COMPATIBILITY_ROLES,
  CAPABILITY_ACTIVATION_OVERRIDE_SET,
);
// Issue #325 -- the Report Builder nav item is capability-gated (navConfig.js: `capabilityAccess`)
// and resolved by the TRUSTED effective-access feed (useReportCapabilities, in App() below), never
// from the raw `role`. A raw role must never confer a governed capability (the W1 correction);
// governed access lives only in RoleAssignments resolved server-side by the trusted engine, which
// the feed's callable reports back as ALLOW/DENY decisions. The feed is fail-closed in every
// non-success state, and its callable is undeployed, so production stays fail-closed until a
// separate deployment + Owner authorization.
import AppShell from "./navigation/AppShell";
import PlaceholderPage from "./navigation/PlaceholderPage";
import { NAV_DOMAINS, isDomainVisible, isNavItemVisible, deniedDomainIndexItem } from "./navigation/navConfig";
import EmptyState from "./shared/ui/EmptyState.jsx";

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
// BrowserRouter's `basename` is derived from the SAME build-time base as
// Vite (import.meta.env.BASE_URL) via routerBasename.js, so the router mount
// point always matches where the bundle is served -- "/Taylor_Parts/field-ops"
// on GitHub Pages, "/" on Firebase Hosting -- with no hard-coded host path.
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

// Admin/dispatcher personalized landing (W5). Real role-aware home -- quick-access
// cards to the primary operational surfaces both admin and dispatcher can reach --
// replacing the prior "isn't built yet" placeholder. Technician gets the real
// TechnicianDashboard. Every card links to a verified route; none is a dead link.
const LANDING_AREAS = [
  { to: "/dashboard/operations", label: "Inventory & Supply Overview", hint: "Cross-domain operational health" },
  { to: "/service", label: "Work Orders", hint: "Browse and manage work orders" },
  { to: "/service/dispatcher-board", label: "Dispatcher Board", hint: "Assign and dispatch work" },
  { to: "/customers", label: "Customers", hint: "Accounts, contacts, and locations" },
  { to: "/inventory", label: "Inventory", hint: "Parts and stock" },
];

function DashboardIndex({ role }) {
  if (role === "technician") return <TechnicianDashboard />;
  return (
    <div className="fo-panel">
      <h2>My Dashboard</h2>
      <p className="fo-muted">Quick access to your areas.</p>
      <div className="fo-landing-grid">
        {LANDING_AREAS.map((a) => (
          <Link key={a.to} to={a.to} className="fo-landing-card">
            <span className="fo-landing-card-title">{a.label}</span>
            <span className="fo-muted">{a.hint}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// EI-P1d-2-2b -- connects the client-direct Truck Registry reads to the frozen EI-P1d-1
// TruckInventory workspace. renderSubnavItem is a plain function (not a component), so the
// producer hook lives here in a real component; it threads the one accessVersion into both the
// producer and the workspace so their boundary keys match.
// EI Truck Management UI -- the same connector now also supplies the management surface.
// canManage is the client-side admin/dispatcher SECURITY-ROLE gate (defense-in-depth; the
// route is already admin/dispatcher-only and the trusted service re-checks the role). The
// write-readiness seam (config/truckManagementReadiness.js) is fail-closed by default, so
// useTruckManagement invokes NO callable today -- the controls render for review with the
// "not yet enabled" notice. onReconcile re-reads the registry after a (future) successful
// command. The option hooks (drivers/warehouses) hold the only firebase reads and are gated
// to fetch nothing until management is authorized AND write-ready.
function TruckInventoryConnected({ accessVersion, role }) {
  const { source, managementRecords, reload } = useTruckRegistrySource(accessVersion);
  const canManage = role === ROLES.ADMIN || role === ROLES.DISPATCHER;
  const isAdmin = role === ROLES.ADMIN; // admin-only capabilities (Created-in-Error delete)
  const { enabled, writeReady, commands } = useTruckManagement({ accessVersion, canManage, onReconcile: reload });
  const management = { canManage, isAdmin, writeReady, enabled, commands, useDriverOptions, useWarehouseOptions };
  return (
    <TruckInventory
      source={source}
      accessVersion={accessVersion}
      management={management}
      managementRecords={managementRecords}
      onReconcile={reload}
    />
  );
}

function renderSubnavItem(domain, item, role, operationalContext) {
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
  // Sales Cycle 2 -- the Opportunity Operating Workspace (READ-FIRST, synthetic source). Same brand-new-screen
  // pattern as AccountsList/PartMasterList: no legacyKey, explicit branch; admin/dispatcher via
  // PLACEHOLDER_DEFAULT_ROLES. Reads only; no governed write path is wired here yet.
  if (domain.key === "customers" && item.key === "opportunities") {
    return <SalesWorkspace />;
  }
  // Issue #232 E5 + INV-EQ-P1b -- the visible Equipment workspace (two tabs: Customer
  // Equipment = cross-customer paginated installed list; Available Equipment = honest
  // not-yet-connected Serialized Asset surface). accessVersion is threaded so the
  // list read resets on any access change (same convention as PartsList/Operations).
  if (domain.key === "equipment" && item.key === "equipment") {
    return <EquipmentWorkspace accessVersion={operationalContext?.accessVersion} />;
  }
  // Sprint 2.0.3 -- Work Order Experience. "Work Orders" now renders
  // the real workspace; the legacy Jobs.jsx screen it used to render
  // (via legacyKey "jobs") is relocated to the "Job Assignments" item
  // below, which keeps its legacyKey unchanged.
  // Service > Scheduling -- the WEEKLY dispatcher scheduling workspace, replacing the prior
  // PlaceholderPage for this existing nav item (admin/dispatcher via PLACEHOLDER_DEFAULT_ROLES).
  // Exposes the already-deployed governed transitionWorkOrder("Schedule", ...) transition (the
  // SCHEDULED gate that had no UI); repo-only, no Rules/Functions deploy, no grant, no direct
  // fieldops_wos write. The write re-authorizes server-side (Schedule = admin/dispatcher).
  if (domain.key === "service" && item.key === "scheduling") {
    return <SchedulingWorkspace />;
  }
  if (domain.key === "service" && item.key === "workOrders") {
    return <WorkOrdersList />;
  }
  // Coordinated Operations — user-consumable reads of the already-built coordinatedVisit /
  // coordinatedFieldMission projections. Brand-new screens, explicit branch (no legacyKey for Visits →
  // admin/dispatcher via PLACEHOLDER_DEFAULT_ROLES; Mission uses legacyKey "fieldMode" → admin + technician).
  // Read-only synthetic source; no authority invented, nothing written (no Job/Visit/WorkOrderGroup).
  if (domain.key === "service" && item.key === "coordinatedVisits") {
    return <CoordinatedVisitsWorkspace />;
  }
  if (domain.key === "service" && item.key === "coordinatedMission") {
    return <CoordinatedMissionView />;
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
    // accessVersion threaded so the canonical part-name read re-runs and its name map is
    // invalidated on any access change (governs the catalog, reorder/history tables, and the
    // embedded Inventory Health panel) -- same convention as PartDetail / Operations.
    return <PartsList accessVersion={operationalContext?.accessVersion} />;
  }
  // ADR-009 G2 -- governed Part Master administration workspace (read + FAIL-CLOSED write; see
  // PartMasterList.jsx header for the full invariant list). Same brand-new-screen pattern as
  // AccountsList/EquipmentRegister: no legacyKey, explicit branch. This item has no legacyKey, so nav
  // access falls to navConfig's PLACEHOLDER_DEFAULT_ROLES default (admin/dispatcher) -- NOT a
  // ROLE_NAV_ACCESS lookup. Catalog WRITE authority (inventory.catalog.manage/.activate) is enforced
  // server-side inside the trusted command; the UI gate is never the sole enforcement.
  if (domain.key === "inventory" && item.key === "partMaster") {
    return <PartMasterList />;
  }
  // Manufacturer administration workspace (catalog reference object Parts link to; read + FAIL-CLOSED
  // write). Closes the referential gap Part write created. Same posture as Part Master: no legacyKey ->
  // admin/dispatcher via navConfig's PLACEHOLDER_DEFAULT_ROLES default; catalog write authority
  // (inventory.catalog.manage/.activate) enforced server-side; the `manufacturers` read is still
  // Rules-closed (governed read-authority DEFERRED to the Owner -- R-1 legacy-surface interaction) so the
  // read fails closed until resolved.
  if (domain.key === "inventory" && item.key === "manufacturers") {
    return <Manufacturers />;
  }
  // EI-P1d-1 workspace + EI-P1d-2-2b read wiring -- the visible Truck Inventory workspace
  // (replaces the placeholder at /inventory/truck-inventory). The workspace stays frozen and
  // read-only; TruckInventoryConnected supplies its source from the client-direct Truck
  // Registry reads via useTruckRegistrySource, threading the SAME accessVersion into the
  // producer AND the workspace so the boundary key matches (same convention as
  // PartsList/Operations/EquipmentWorkspace). Fail-closed: no governed records -> honest
  // empty/not-connected; a denied/failed read -> the workspace's denied/error surface.
  if (domain.key === "inventory" && item.key === "truckInventory") {
    return <TruckInventoryConnected accessVersion={operationalContext?.accessVersion} role={role} />;
  }
  // Issue #100 PR 1b -- PARTS_MANAGER's dedicated, role-scoped surface.
  // Same operationalRoleAccess-gated pattern as PR 2b's WAREHOUSE_MANAGER
  // case below.
  if (domain.key === "inventoryRole" && item.key === "manager") {
    // accessVersion is threaded so the canonical part-name read re-runs and the prior
    // name map is invalidated on any access change (same convention as PartDetail).
    return <PartsManagerHome accessVersion={operationalContext?.accessVersion} />;
  }
  // Issue #100 PR 2b -- WAREHOUSE_MANAGER's dedicated, role-scoped
  // surface. No legacyKey (net-new screen); item.operationalRoleAccess
  // (navConfig.js) already keeps this route from being generated at all
  // for any role/session other than an ACTIVE, reciprocally linked
  // WAREHOUSE_MANAGER, so this case never renders for admin/dispatcher
  // or an ineligible technician.
  if (domain.key === "inventoryRole" && item.key === "warehouse") {
    // accessVersion threaded -- see the PartsList/Operations cases (governs WMH's catalog,
    // Part Activity, and Inventory Health panel name resolution).
    return <WarehouseManagerHome accessVersion={operationalContext?.accessVersion} />;
  }
  // Issue #100 PR 3b -- PARTS_ASSOCIATE's dedicated, role-scoped surface.
  // Same operationalRoleAccess-gated pattern as PR 1b/2b above.
  if (domain.key === "inventoryRole" && item.key === "mine") {
    // accessVersion threaded -- see the PartsManagerHome case above.
    return <PartsAssociateHome accessVersion={operationalContext?.accessVersion} />;
  }
  // Issue #226 Row 10 -- Admin Portal foundation. Same special-case pattern as
  // every other net-new, no-legacyKey screen above: a brand-new Overview hub,
  // not a re-homed one.
  if (domain.key === "administration" && item.key === "overview") {
    return <AdministrationOverview />;
  }
  // Issue #226 Row 12 -- Admin mutation UI (Task 17), gated inert. Users and
  // Roles & Permissions each get a real component showing their MVP mutation
  // affordance (setUserStatus / assignApprovedRole) visibly but disabled --
  // see AdminUsers.jsx/AdminRolesPermissions.jsx's own doc comments.
  if (domain.key === "administration" && item.key === "users") {
    // Explicit capability gating at the DISPATCHER (not nav visibility alone):
    // the password-reset surface inside AdminUsers is gated on the trusted feed's
    // hasCapability(admin.credentialReset.initiate). The Users nav item is
    // admin/dispatcher-visible (placeholder default), so nav does NOT hide this
    // route -- threading the fail-closed previewer here keeps the reset surface
    // hidden (and its list read un-attempted) even on a direct URL hit, until a
    // separate activation/grant gate. The setUserStatus preview is unaffected.
    return <AdminUsers hasCapability={operationalContext?.hasCapability} />;
  }
  if (domain.key === "administration" && item.key === "rolesPermissions") {
    return <AdminRolesPermissions />;
  }
  // Administration > Integrations -- static, informational FAQ on the platform's
  // approved integration boundary (no Firestore access, no writes). Replaces the
  // prior PlaceholderPage for this existing nav item. (Handoff from the parallel
  // session's App.jsx integration WIP.)
  if (domain.key === "administration" && item.key === "integrations") {
    return <IntegrationsFaq />;
  }
  // Issue #325 / ADR-007 -- the governed report builder. Net-new, no legacyKey; reached only
  // through the capability-gated item (isNavItemVisible checks capabilityAccess, resolved by the
  // trusted effective-access feed). The route is generated -- and this branch renders -- ONLY for a
  // principal the feed grants a wave-1 report capability; every fail-closed state (loading /
  // unavailable / denied / signed out / principal change / undeployed callable) hides it.
  if (domain.key === "reporting" && item.key === "builder") {
    return <ReportBuilder />;
  }
  // Issue #325 W-SAVE -- Saved Reports, backed by the trusted saved-definition callables. Reached
  // only through the capabilityAccess gate (report.definition.read from the feed); receives the
  // feed's hasCapability + accessVersion so it gates each action and re-lists on every access change.
  if (domain.key === "reporting" && item.key === "savedReports") {
    return <SavedReports hasCapability={operationalContext?.hasCapability} accessVersion={operationalContext?.accessVersion} />;
  }
  // Issue #226 Row 11 -- Read-only Admin MVP (Task 16). These two MVP
  // surfaces have no live data source yet and no MVP mutation of their own:
  // firestore.rules deny all client-direct access to the governed
  // collections (Row 3/PR #276), and no Cloud Function read path is
  // deployed (blocked on Issue #15, Spec sec17). Real content replaces this
  // once that backend ships and is verified -- see AdministrationUnavailable
  // .jsx's own doc comment.
  if (domain.key === "administration" && (item.key === "permissionPreview" || item.key === "auditLogs")) {
    return <AdministrationUnavailable title={item.label} />;
  }
  // Purchasing > Purchase Orders (item C) -- the real cross-request Reorder
  // Purchase Order workspace, replacing the prior PlaceholderPage for this
  // existing index nav item. Read-only; self-fetches the already-client-direct
  // reorder_requests + reorder_purchase_orders (admin/dispatcher). Surfaces
  // ORDERED/ORDERED receipt candidates for the (separately-authorized)
  // receiveInventoryStock action; performs no receipt/write itself. Receipts is
  // wired below (the received/result launch point); Suppliers/Quotes/Demand
  // Planning remain placeholders.
  if (domain.key === "purchasing" && item.key === "purchaseOrders") {
    return <PurchaseOrders />;
  }
  // Purchasing > Receipts -- NOT a separate capability: the received/result side of the ONE
  // governed Receiving capability, rendered as a reuse-only launch point into the CANONICAL PO
  // projection (buildPurchaseOrdersView, RECEIVED subset). It reads no receiving_orders (backend-
  // only) and adds no receive path; see DECISIONS. Replaces the prior PlaceholderPage.
  if (domain.key === "purchasing" && item.key === "receipts") {
    return <Receipts />;
  }
  // Purchasing > Suppliers -- the first-class registry workspace for the governed Supplier business
  // object (Supplier Master), replacing the PlaceholderPage for this existing nav item. Read-only;
  // REUSES the shared operationsQueries.fetchSuppliers read + the pure buildSuppliersView, surfacing
  // governed status (ACTIVE/INACTIVE) and honestly flagging legacy/ungoverned docs. No write path
  // (suppliers is Admin-SDK-write-only). accessVersion is threaded so the read re-runs on any access
  // change (the inventory/purchasing convention).
  if (domain.key === "purchasing" && item.key === "suppliers") {
    return <Suppliers accessVersion={operationalContext?.accessVersion} />;
  }
  // Inventory > Receiving -- the FIRST-CLASS Receiving workspace, replacing the prior
  // PlaceholderPage for this existing nav item (admin/dispatcher). It composes the ONE
  // canonical governed receive workflow (ReceiveAgainstPurchaseOrder) with all ORDERED
  // receipt candidates; the PartsScanner (in FieldMode) is a second launch point of the
  // SAME workflow, not an alternate implementation. Fail-closed (readiness FALSE +
  // capability-gated) -- no live receipt here.
  if (domain.key === "inventory" && item.key === "receiving") {
    return <Receiving />;
  }
  // Inventory > Transfers -- first-class workspace for the inventory-transfer capability
  // (movement between locations), replacing the placeholder (admin/dispatcher). Read-only:
  // it REUSES the shared operationsQueries read + the canonical buildTransferOrdersView (the
  // same view-model the Operations dashboard uses) -- no parallel read, no re-mapping.
  // accessVersion is threaded so the read re-runs on any access change (inventory convention).
  if (domain.key === "inventory" && item.key === "transfers") {
    return <Transfers accessVersion={operationalContext?.accessVersion} />;
  }
  // Inventory > Warehouses -- first-class registry workspace for the warehouse (inventory-
  // location) capability: warehouse list + governed status (ACTIVE/INACTIVE) + receiving-
  // eligibility, replacing the placeholder (admin/dispatcher). Read-only; REUSES the shared
  // operationsQueries.fetchWarehouses read and mirrors the I-LA receiving-eligibility resolver.
  // Does NOT duplicate the Operations WarehousePanel's stock/reconciliation; WarehouseManagerHome
  // (persona surface) is untouched.
  if (domain.key === "inventory" && item.key === "warehouses") {
    return <Warehouses accessVersion={operationalContext?.accessVersion} />;
  }
  // Operations owns the canonical part-name read for its dashboard panels; accessVersion
  // is threaded so that read re-runs and its name map is invalidated on any access change
  // (same convention as PartDetail / the inventoryRole surfaces).
  if (item.legacyKey === "operations") {
    return <Operations accessVersion={operationalContext?.accessVersion} />;
  }
  if (item.legacyKey) {
    const Component = LEGACY_COMPONENTS[item.legacyKey];
    return <Component />;
  }
  return <PlaceholderPage title={item.label} explanation={item.placeholderExplanation} />;
}

function AppRoutes({ role, allowedLegacyKeys, operationalContext }) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* INV-CONVERGENCE-E Stage A -- dedicated operator-only shadow-parity diagnostics
          route. NOT a navigation entry (no Inventory/nav exposure); reached only by
          direct URL. The component self-gates to admin/dispatcher via useAuth and shows
          the standard No Access state otherwise (real gate, not route obscurity);
          Firestore Rules are unchanged. Isolated from PartsList/PartDetail. */}
      <Route path="/admin/diagnostics/inventory-parts-parity" element={<PartsShadowParityDiagnostics />} />

      {NAV_DOMAINS.filter((d) => !d.future).map((domain) => (
        <Route key={domain.key} path={domain.path}>
          {domain.subnav
            .filter((item) => isNavItemVisible(item, role, allowedLegacyKeys, operationalContext))
            .map((item) => (
              <Route
                key={item.key}
                path={item.path || undefined}
                index={item.path === ""}
                element={renderSubnavItem(domain, item, role, operationalContext)}
              />
            ))}
          {/* Three independent missions landed on a blank page at /inventory and
              /purchasing. The domain index item (e.g. Inventory > Parts, path "") is
              gated -- Parts by legacyKey "inventory" -- so for a role without it the
              filter above emits NO index route, the parent matches with no child, and
              the user gets the shell with an empty body. The screen they were denied
              never rendered, so it could not say so itself.
              DENIED must not be presented as EMPTY. Emit the index route regardless and
              let it state the denial. Deliberately not a redirect: bouncing to another
              surface hides the reason and leaves the user believing the area is broken.
              Access is unchanged -- this only gives the refusal somewhere to be said. */}
          {(() => {
            const indexItem = deniedDomainIndexItem(domain, role, allowedLegacyKeys, operationalContext);
            if (!indexItem) return null;
            return (
              <Route
                index
                element={
                  <EmptyState
                    variant="filtered"
                    title={`${indexItem.label} isn't available to your role`}
                    message="Your account doesn't have access to this area. Contact an administrator if you believe this is an error."
                  />
                }
              />
            );
          })()}
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
          {/* Issue #232 unit E7 -- Equipment detail. Same shape and same reasoning as
              the /customers/:accountId route above: gated by isDomainVisible(), not
              just domain.key, so a role without Equipment nav access never MOUNTS the
              route and its Firestore listeners. E3's Rules (#289) deny a technician
              every Equipment read, so mounting this for them would only produce a
              permission-denied they cannot act on. Rules remain the boundary; this
              keeps the route from disagreeing with them. */}
          {domain.key === "equipment" && isDomainVisible(domain, role, allowedLegacyKeys, operationalContext) && (
            <Route path=":equipmentId" element={<EquipmentDetail />} />
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
          {/* Issue #226 Row 16 -- presentation-only permission preview
              (Spec sec8/sec12: never authoritative, UI visibility stays
              convenience only). Legacy admin/dispatcher check retained as
              the `fallback` -- see navPermissionPreview.js's own doc
              comment. workOrder.create is the representative permission
              for this combined Wizard+Detail gate; today only admin/
              dispatcher hold it, matching the original check exactly. */}
          {domain.key === "service" &&
            previewHasPermission("workOrder.create", role, {
              fallback: role === "admin" || role === "dispatcher",
            }) && (
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
            <Route path=":partId" element={<PartDetail hasCapability={operationalContext?.hasCapability} accessVersion={operationalContext?.accessVersion} />} />
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

// Computed once at build time: Vite replaces import.meta.env.BASE_URL with
// the resolved `base` for the active build (GitHub Pages vs Firebase).
const ROUTER_BASENAME = routerBasenameFrom(import.meta.env.BASE_URL);

export default function App() {
  const { user, role, loading, operationalRoles, employmentStatus, identityError, retryIdentityResolution } = useAuth();
  const allowedLegacyKeys = ROLE_NAV_ACCESS[role] ?? [];
  // Issue #325 -- capability gating from the TRUSTED effective-access feed (Inventory's
  // resolveEffectiveAccess callable), never from the raw role. The hook asks the callable for a
  // decision on the wave-1 Report Builder capabilities and yields a fail-closed hasCapability:
  // granted only from a successful, current-principal decision; denied while loading, on
  // error/unavailable/malformed, when signed out, and across a principal change. Since the callable
  // is undeployed, this stays fail-closed in production until a separate deployment + authorization.
  const { hasCapability, accessVersion } = useReportCapabilities(user);
  // Issue #100 -- PR 0. Threaded through as one stable object so every isNavItemVisible/
  // isDomainVisible call site can accept it uniformly. `hasCapability` gates the Report Builder and
  // Saved Reports items (navConfig.js capabilityAccess); the raw-role paths (legacyKey/
  // PLACEHOLDER_DEFAULT_ROLES/operationalRoleAccess) are unchanged. `accessVersion` is threaded to
  // Saved Reports so it re-lists from the server on every access change (freshness).
  const operationalContext = { operationalRoles, employmentStatus, hasCapability, accessVersion };
  const hasAnyAccess = NAV_DOMAINS.some((d) => isDomainVisible(d, role, allowedLegacyKeys, operationalContext));

  if (loading) return <div className="fo-panel">Loading...</div>;

  // Retention audit finding (#909): AuthContext has exposed identityError + retryIdentityResolution
  // since PR #909, but no consumer ever read them -- a failed session-identity read (role/employeeId/
  // operationalRoles/employmentStatus) silently fell through to the generic "No access" state below,
  // which wrongly implies the account needs a role granted rather than that the read simply failed.
  // The user IS authenticated here (AuthContext keeps `user` set on this path) -- this is a distinct,
  // retryable read failure, not an access decision.
  if (identityError) {
    return (
      <div className="fo-panel">
        <FailureState
          message={identityError}
          action={<button type="button" className="fo-btn" onClick={retryIdentityResolution}>Retry</button>}
        />
      </div>
    );
  }

  if (!user) return <Login />;

  if (!hasAnyAccess) {
    return (
      <div className="fo-panel">
        <h2>No access</h2>
        <p className="fo-muted">
          You're signed in as <strong>{user.email}</strong>, but your account isn't
          assigned a role with access yet.
        </p>
        <p className="fo-muted">
          Ask an administrator to grant your account a role — giving them the email above
          helps them find it. Once access is granted, choose <strong>Check again</strong>.
        </p>
        <button type="button" className="fo-btn" onClick={() => window.location.reload()}>
          Check again
        </button>
      </div>
    );
  }

  return (
    <InventoryProvider>
      <BrowserRouter basename={ROUTER_BASENAME}>
        <div className="fo-app">
          {IS_DEMO && <div className="fo-demo-banner">DEMO MODE ACTIVE (SAFE - NO WRITES TO PRODUCTION)</div>}
          {/* Gate 2 -- AppHeader is now mounted INSIDE AppShell, as the workspace
              column's utility bar, so it sits beside the navigation rail rather
              than above the whole shell. accessVersion is threaded through
              AppShell for the same reason as before: AppHeader's one canonical
              part-name read must re-run and its name map be invalidated on any
              access change (governs NotificationPanel names). */}
          <AppShell role={role} allowedLegacyKeys={allowedLegacyKeys} operationalContext={operationalContext}>
            <AppRoutes role={role} allowedLegacyKeys={allowedLegacyKeys} operationalContext={operationalContext} />
          </AppShell>
        </div>
      </BrowserRouter>
    </InventoryProvider>
  );
}
