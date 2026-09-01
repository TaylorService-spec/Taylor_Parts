// LAZY ROUTES — the technician does not download the desktop.
//
// Measured before this change: ONE chunk, 1,965 kB (545 kB gzip), because 78 static imports put
// every surface -- CRM, sales, purchasing, administration, reporting, the whole inventory suite --
// into the entry bundle. A technician opening their next job on weak cellular downloaded all of it.
//
// Desktop-only surfaces are now lazy. FieldMode, TechnicianDashboard and Jobs deliberately stay
// EAGER: they are the technician's own screens, and making them wait on a second round trip would
// move the cost rather than remove it.
//
// This changes WHEN code loads, never WHO may load it. Route visibility is still isDomainVisible()
// and the authority is still Rules and the governed resolvers -- a lazily-loaded module a principal
// may not use is a module that still denies.
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { recordNavigation, recordIdentity, diagnosticsVisible } from "./diagnostics/crashDiagnostics.js";
import { routerBasenameFrom } from "./routerBasename";
const ControlTower = lazy(() => import("./modules/controlTower/ControlTower"));
import Jobs from "./modules/jobs/Jobs";
import Technicians from "./modules/technicians/Technicians";
import Dispatch from "./modules/dispatch/Dispatch";
import FieldMode from "./modules/mobile/FieldMode";
// THE HANDHELD SHELL. Eager, not lazy: it is the technician's first screen, and deferring the thing
// somebody opens first moves the wait rather than removing it. FieldMode is already eager for the
// same reason, and the shell composes it.
import TechnicianShell from "./modules/technician/TechnicianShell";
// The warehouse handheld. Eager for the same reason the technician shell is: it is the first screen
// a warehouse worker opens, and the scanning workspace it composes stays lazy behind it.
import WarehouseShell from "./modules/warehouse/WarehouseShell";
import { useIsPhone } from "./navigation/useIsPhone.js";
// LAZY, like every other route-level surface. It was the one eager import among them, which put the
// whole scanning workspace in the entry chunk for every user who never scans -- and made the
// technician shell's own lazy boundary around it do nothing at all.
const ScanWorkspace = lazy(() => import("./modules/scan/ScanWorkspace"));
const Inventory = lazy(() => import("./modules/inventory/Inventory"));
const Operations = lazy(() => import("./modules/operations/Operations"));
const DispatcherBoard = lazy(() => import("./modules/dispatcherBoard/DispatcherBoard"));
import TechnicianDashboard from "./modules/technicianDashboard/TechnicianDashboard";
const AccountsList = lazy(() => import("./modules/accounts/AccountsList"));
// The Opportunity collection (North Star P1v4). SalesWorkspace -- the master-detail pipeline that
// used to render here -- is NO LONGER ROUTED anywhere in the app as of this change. Its file and
// tests remain in the tree: the pane's retirement is behavioral, and deleting the module is a
// separate cleanup because several of its tests still guard shared domain behaviour that has no
// other home yet. It is unreachable from the product either way.
const OpportunityList = lazy(() => import("./modules/sales/OpportunityList.jsx"));
// The Opportunity RECORD page (North Star family 4). Until it existed an Opportunity had no URL at
// all -- it was reachable only as the selected row of a pipeline someone had already loaded.
const OpportunityDetail = lazy(() => import("./modules/sales/OpportunityDetail"));
const SalesOrderDetail = lazy(() => import("./modules/sales/SalesOrderDetail.jsx"));
// The Sales Agreement RECORD page (North Star family 5). Owner ruling DECISIONS #134: a first-class
// routed record page. The route nests under opportunities/ following the Sales Order precedent
// (#129) -- a URL shape is not ownership, and the Opportunity does not own the Agreement record UX.
const SalesAgreementDetail = lazy(() => import("./modules/sales/SalesAgreementDetail.jsx"));
const SalesOrdersList = lazy(() => import("./modules/sales/SalesOrdersList.jsx"));
import { governedOpportunitySource } from "./access/opportunitySource.js";
import { useOpportunityCapabilities } from "./access/useOpportunityCapabilities.js";
import { OPPORTUNITY_WRITE_CAPABILITY } from "./access/opportunityCapabilityAccess.js";
import { opportunityWriteReadiness } from "./access/opportunityWriteReadiness.js";
import { useSalesOrderCapabilities } from "./access/useSalesOrderCapabilities.js";
const EquipmentWorkspace = lazy(() => import("./modules/equipment/EquipmentWorkspace"));
const EquipmentDetail = lazy(() => import("./modules/equipment/EquipmentDetail"));
const AccountDetail = lazy(() => import("./modules/accounts/AccountDetail"));
const PartsShadowParityDiagnostics = lazy(() => import("./modules/inventory/PartsShadowParityDiagnostics"));
const AdministrationOverview = lazy(() => import("./modules/administration/AdministrationOverview"));
const AdministrationUnavailable = lazy(() => import("./modules/administration/AdministrationUnavailable"));
const AdminUsers = lazy(() => import("./modules/administration/AdminUsers"));
const AdminRolesPermissions = lazy(() => import("./modules/administration/AdminRolesPermissions"));
const AdminDuplicateRules = lazy(() => import("./modules/administration/AdminDuplicateRules"));
const AdminObjects = lazy(() => import("./modules/administration/AdminObjects.jsx"));
const EmployeesList = lazy(() => import("./modules/administration/EmployeesList.jsx"));
const IntegrationsFaq = lazy(() => import("./modules/administration/IntegrationsFaq"));
const PurchaseOrders = lazy(() => import("./modules/purchasing/PurchaseOrders"));
const Receipts = lazy(() => import("./modules/purchasing/Receipts"));
const Suppliers = lazy(() => import("./modules/purchasing/Suppliers"));
const Receiving = lazy(() => import("./modules/inventory/Receiving"));
const Transfers = lazy(() => import("./modules/inventory/Transfers"));
const CycleCounts = lazy(() => import("./modules/inventory/CycleCounts"));
const Warehouses = lazy(() => import("./modules/inventory/Warehouses"));
const SchedulingWorkspace = lazy(() => import("./modules/scheduling/SchedulingWorkspace"));
import DispatchSchedulingWorkspace from "./modules/dispatch/DispatchSchedulingWorkspace";
const CoordinatedVisitsWorkspace = lazy(() => import("./modules/service/CoordinatedVisitsWorkspace"));
import CoordinatedMissionView from "./modules/mobile/CoordinatedMissionView";
import WorkOrdersList from "./modules/workOrders/WorkOrdersList";
import WorkOrderWizard from "./modules/workOrders/WorkOrderWizard";
import WorkOrderDetailPage from "./modules/workOrders/WorkOrderDetailPage";
const PartsList = lazy(() => import("./modules/inventory/PartsList"));
const PartMasterList = lazy(() => import("./modules/inventory/PartMasterList"));
const Manufacturers = lazy(() => import("./modules/inventory/Manufacturers"));
const TruckInventory = lazy(() => import("./modules/inventory/TruckInventory"));
import { useTruckRegistrySource } from "./hooks/useTruckRegistrySource";
import { useTruckManagement } from "./hooks/useTruckManagement";
import { useDriverOptions } from "./hooks/useDriverOptions";
import { useWarehouseOptions } from "./hooks/useWarehouseOptions";
const PartDetail = lazy(() => import("./modules/inventory/PartDetail"));
const WarehouseManagerHome = lazy(() => import("./modules/inventoryRole/WarehouseManagerHome"));
const PartsManagerHome = lazy(() => import("./modules/inventoryRole/PartsManagerHome"));
const PartsAssociateHome = lazy(() => import("./modules/inventoryRole/PartsAssociateHome"));
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
const ReportBuilder = lazy(() => import("./modules/reporting/ReportBuilder"));
const SavedReports = lazy(() => import("./modules/reporting/SavedReports"));
// Financials North Star P1, Wave UX-1 (design: docs/north-star/financials/). Desktop/admin
// surfaces — lazy like every other non-technician module. Data authorization is server-side
// (finance.read + finance.visibility.*, all inactive today); these pages compose governed
// reads and honest states only.
const FinancialsOverview = lazy(() => import("./modules/financials/FinancialsOverview.jsx"));
const FinancialsInvoices = lazy(() => import("./modules/financials/FinancialsInvoices.jsx"));
const FinancialsAccountsReceivable = lazy(() => import("./modules/financials/FinancialsAccountsReceivable.jsx"));
const FinancialsPayments = lazy(() => import("./modules/financials/FinancialsPayments.jsx"));
const FinancialsCustomerFinancials = lazy(() => import("./modules/financials/FinancialsCustomerFinancials.jsx"));
// Wave UX-2 — billing / corrections.
const FinancialsBillingQueue = lazy(() => import("./modules/financials/FinancialsBillingQueue.jsx"));
const FinancialsCreditsAdjustments = lazy(() => import("./modules/financials/FinancialsCreditsAdjustments.jsx"));
// Wave UX-3 — plan / forecast.
const FinancialsSalesToGoal = lazy(() => import("./modules/financials/FinancialsSalesToGoal.jsx"));
const FinancialsCostToBudget = lazy(() => import("./modules/financials/FinancialsCostToBudget.jsx"));
const FinancialsForecasting = lazy(() => import("./modules/financials/FinancialsForecasting.jsx"));
const FinancialsBudgets = lazy(() => import("./modules/financials/FinancialsBudgets.jsx"));
const FinancialsGoals = lazy(() => import("./modules/financials/FinancialsGoals.jsx"));
// Wave UX-4 — performance.
const FinancialsProfitability = lazy(() => import("./modules/financials/FinancialsProfitability.jsx"));
const FinancialsCompanyPerformance = lazy(() => import("./modules/financials/FinancialsCompanyPerformance.jsx"));
const FinancialsEmployeePerformance = lazy(() => import("./modules/financials/FinancialsEmployeePerformance.jsx"));
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
import LandingPage from "./navigation/LandingPage";
import { NAV_DOMAINS, isDomainVisible, isNavItemVisible } from "./navigation/navConfig";
import EmptyState from "./shared/ui/EmptyState.jsx";
import { Button } from "./shared/ui/primitives";

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

// Role-aware landing. A technician has a real, data-backed home (TechnicianDashboard)
// and keeps it. Everyone else used to get a hard-coded list of five links that was the
// same for every non-technician: an admin without Reporting saw the identical five as
// one with it, so the screen asserted access it had not checked. LandingPage computes
// the destination set from isDomainVisible/isNavItemVisible -- the SAME functions the
// rail and the route table use for this exact principal -- so it can neither show a
// destination this person cannot open nor omit one they can.
function DashboardIndex({ role, allowedLegacyKeys, operationalContext }) {
  if (role === "technician") return <TechnicianDashboard />;
  return (
    <LandingPage
      role={role}
      allowedLegacyKeys={allowedLegacyKeys}
      operationalContext={operationalContext}
    />
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

// Sales Wave 7 -- connects the REAL trusted write-capability signal (access/useOpportunityCapabilities,
// the resolveEffectiveAccessCallable feed requested for opportunity.write) to SalesWorkspace's injected
// `readiness` prop. This is the fix for the known defect where SalesWorkspace called
// opportunityWriteReadiness() with NO args at its own default (always fail-closed regardless of the real
// grant): the seam function itself stays pure and still defaults to fail-closed for any caller that does
// not inject `readiness` (every unit/component test), but THIS is the one production call site, and it now
// feeds the seam real deps. There is no separate client signal for "is the callable deployed" (mirrors
// services/salesOrderCommandClient.js's posture once its capability went live) -- the SAME live capability
// decision is used for both `capabilityGranted` and `commandDeployed`, since server-side authorization
// (resolveEffectiveAccess) is re-checked on every call regardless, and a genuinely undeployed/unreachable
// callable still surfaces honestly through the write hooks' own denied/unavailable/error mapping
// (domain/opportunityCommandOutcome.js) rather than through a fabricated second static flag.
/**
 * The navigation trail and the non-sensitive identity behind a crash diagnostic.
 *
 * Renders nothing. Lives INSIDE the Router (so it can observe location) and inside AuthProvider (so
 * it knows the role), while the boundary that reads its output sits above both — which is why this
 * writes to a module rather than a context.
 *
 * ROLE, NEVER A UID. A role reproduces a crash; a uid identifies a person and reproduces nothing.
 */
/**
 * THE BOUNDARY MUST BE ABLE TO FAIL, and be seen doing it.
 *
 * The RAW_ID detector in the certification harness sat inert for months reporting a confident zero,
 * and only a mutation proof exposed it. A crash boundary is the same kind of instrument: it reports
 * nothing almost all of the time, and "nothing" is indistinguishable from "broken" until something
 * deliberately makes it fire.
 *
 * `?__crashtest=1` throws during render, so the regression gate can prove -- against the DEPLOYED
 * build, not a unit test -- that the boundary catches, that a crash id is issued, and that the
 * diagnostic is complete and free of anything sensitive.
 *
 * NON-PRODUCTION ONLY, and it needs an explicit query parameter nobody types by accident.
 * diagnosticsVisible() fails closed on an unknown environment, so a build that cannot say what it
 * is does not get a crash trigger.
 */
function CrashTest() {
  const location = useLocation();
  if (!diagnosticsVisible()) return null;
  if (!new URLSearchParams(location.search).get("__crashtest")) return null;
  throw new Error("Deliberate crash test (?__crashtest=1) — proving the error boundary and its diagnostic work.");
}

function CrashTrailRecorder() {
  const location = useLocation();
  const { user, role } = useAuth();
  useEffect(() => {
    recordNavigation(`${location.pathname}${location.search || ""}`);
  }, [location.pathname, location.search]);
  useEffect(() => {
    recordIdentity({ signedIn: Boolean(user), role: role ?? null });
  }, [user, role]);
  return null;
}

// The Opportunity COLLECTION mount (North Star P1v4). Replaces OpportunityWorkspaceConnected, which
// mounted the master-detail SalesWorkspace here.
//
// `hasCapability` is deliberately NOT threaded: the collection reads no Sales Agreement data. The
// workspace needed it because its pane embedded the agreement panel; a list that shows only whether
// an agreement EXISTS -- from a field the Opportunity read already returns -- needs no agreement
// capability at all, and asking for one would imply a read this page never performs.
function OpportunityListConnected() {
  const { user } = useAuth();
  const { hasCapability } = useOpportunityCapabilities(user);
  const granted = hasCapability(OPPORTUNITY_WRITE_CAPABILITY);
  const readiness = opportunityWriteReadiness({ capabilityGranted: granted, commandDeployed: granted });
  // The viewer's uid is threaded so "My opportunities" can resolve WHO is looking, from the
  // employee directory the page already subscribes to for owner names. No extra read, and an
  // account with no linked employee record gets that view's honest unresolved state.
  return <OpportunityList source={governedOpportunitySource} readiness={readiness} viewerUid={user?.uid ?? null} />;
}

// Fixes the known defect (SalesOrderActions.jsx) where the Sales Order Advance/Cancel/Allocate/
// Create Service buttons rendered live from the client-side STATE mirror alone, with no capability
// check -- so a principal holding salesOrder.read but not salesOrder.write/.fulfill/.service
// (salesManager, accountingManager, financeManager) saw fully enabled action buttons and only learned
// they were unauthorized after confirming and hitting the server's denial. This is the one production
// call site that feeds SalesOrderDetail's `hasCapability` prop the REAL trusted
// resolveEffectiveAccessCallable decision (access/useSalesOrderCapabilities) -- mirrors
// OpportunityWorkspaceConnected above exactly. Every unit/component test still gets the fail-closed
// default (no `hasCapability` injected).
// The Opportunity record page's production mount. It takes the SAME readiness value
// OpportunityWorkspaceConnected feeds the workspace -- derived from the real trusted
// resolveEffectiveAccessCallable decision for opportunity.write -- so the record page and the
// pipeline pane can never disagree about whether a governed transition is offerable. Every
// unit/component test still gets the fail-closed default (no `readiness` injected).
function OpportunityDetailConnected() {
  const { user } = useAuth();
  const { hasCapability } = useOpportunityCapabilities(user);
  const granted = hasCapability(OPPORTUNITY_WRITE_CAPABILITY);
  // `hasCapability` MUST be threaded, not merely resolved.
  //
  // It was resolved here and dropped on the floor, so OpportunityDetail fell back to its own
  // fail-closed default (`() => false`). The consequence was invisible and total: the Sales
  // Agreement card called useSalesAgreement with `enabled: false` and rendered
  // "Sales agreements aren't enabled in this environment yet" on EVERY record, forever -- while
  // salesAgreement.read/.create/.updateDraft/.accept are in fact ACTIVATED for platform-sandbox
  // (access/environmentCapabilityOverrides.ts). "Create Sales Agreement" could never appear either.
  //
  // The state was honest about what the component was told. The component was told something false,
  // which is worse than an obviously broken panel: a truthful-looking NOT_ENABLED reads as a
  // deliberate environment gate and invites nobody to investigate. It survived a Quick Gate for
  // exactly that reason.
  //
  // The SAME trusted feed answers both capability families in one request
  // (OPPORTUNITY_CAPABILITY_REQUEST includes SALES_AGREEMENT_CAPABILITY_REQUEST), so this costs no
  // extra round trip -- the answer was already in hand.
  return (
    <OpportunityDetail
      readiness={opportunityWriteReadiness({ capabilityGranted: granted, commandDeployed: granted })}
      hasCapability={hasCapability}
    />
  );
}

function SalesOrderDetailConnected() {
  const { user } = useAuth();
  const { hasCapability } = useSalesOrderCapabilities(user);
  return <SalesOrderDetail hasCapability={hasCapability} />;
}

// The Sales Agreement record page mount. OPPORTUNITY_CAPABILITY_REQUEST already includes all four
// SALES_AGREEMENT_CAPABILITY_REQUEST ids, resolved in ONE trusted request -- so this costs no extra
// round trip and the page can never render an ACCEPT decided under a different accessVersion than
// the EDIT beside it. hasCapability is fail-closed: the page reads nothing without salesAgreement.read.
function SalesAgreementDetailConnected() {
  const { user } = useAuth();
  const { hasCapability } = useOpportunityCapabilities(user);
  return <SalesAgreementDetail hasCapability={hasCapability} />;
}

function renderSubnavItem(domain, item, role, operationalContext, allowedLegacyKeys) {
  if (domain.key === "dashboard" && item.key === "my") {
    return (
      <DashboardIndex
        role={role}
        allowedLegacyKeys={allowedLegacyKeys}
        operationalContext={operationalContext}
      />
    );
  }
  // Sprint 2.0.2 -- Customer Foundation. Same special-case pattern as
  // DashboardIndex above: this item has no legacyKey (it's a brand
  // new screen, not a re-homed one), so it needs an explicit case
  // rather than the generic legacyKey/PlaceholderPage branches below.
  if (domain.key === "customers" && item.key === "customers") {
    return <AccountsList />;
  }
  // Sales -- the Opportunity COLLECTION (North Star P1v4). Was the master-detail operating
  // workspace; it is now a list whose only job is finding one opportunity, because the record it
  // used to preview in a pane has had its own certified route since P1v2. Reads the same governed
  // listOpportunityContext callable through the same source seam, and carries the governed create
  // form (NewOpportunityForm) that the retiring workspace was the only mount for.
  //
  // Historical note kept because it still explains the branch: this is dispatched HERE rather than
  // as a <Route>, like AccountsList/PartMasterList, because the generic subnav loop emits a route
  // for every visible nav item and would otherwise win the match.
  // Sales Cycle 2 -- the Opportunity Operating Workspace. Same brand-new-screen pattern as
  // AccountsList/PartMasterList: no legacyKey, explicit branch; admin/dispatcher via
  // PLACEHOLDER_DEFAULT_ROLES. Post-Wave-5: reads the real governed listOpportunityContext
  // callable (opportunity.read is granted + sandbox-activated) instead of the synthetic
  // fixture source -- an authorized principal now sees real Opportunities; an unauthorized one
  // (or production, where activation is off) gets the seam's honest denied/unavailable state,
  // never fabricated data. Wave 7: the write path (create + lifecycle transitions) is now wired through
  // OpportunityWorkspaceConnected, which feeds SalesWorkspace's readiness seam the real
  // resolveEffectiveAccessCallable decision for opportunity.write instead of a hardcoded fail-closed value.
  if (domain.key === "customers" && item.key === "opportunities") {
    return <OpportunityListConnected />;
  }
  // The Sales Order INDEX must be dispatched HERE, not by a separate <Route>. The generic
  // subnav loop below emits a route for EVERY visible nav item and renders whatever this
  // function returns; an item with no branch and no legacyKey falls through to
  // PlaceholderPage. Adding a second <Route> at the same path did not win -- the generic
  // one is emitted first and React Router matched it -- so the deployed page said
  // "This area isn't built yet" over a list that was very much built. Tests and build
  // both passed, because neither renders the route table the way the browser does.
  // Dispatched here, not as a separate <Route> -- the generic subnav loop emits the route
  // and renders whatever this returns, so a second Route at the same path never wins.
  // Owner ruling 2026-08-20: "technician is a role". The Employees item keeps its
  // legacyKey (so WHO can see it is unchanged) but renders the governed employee
  // directory instead of the fieldops_technicians roster it used to. The two had drifted
  // into parallel identities for the same people; the directory is `employees`.
  if (domain.key === "administration" && item.key === "employees") {
    return <EmployeesList />;
  }
  if (domain.key === "administration" && item.key === "objects") {
    return <AdminObjects />;
  }
  if (domain.key === "customers" && item.key === "salesOrders") {
    return <SalesOrdersList />;
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
  // Wave 7 completion, PART 1 -- the combined Dispatch/Scheduling operating workspace (technician rows x
  // horizontal time axis, drag-drop through the SAME governed Schedule transition, one below-the-board
  // Ready-for-Work queue). ADDITIVE: Dispatcher Board and Scheduling above are untouched. No legacyKey ->
  // admin/dispatcher via PLACEHOLDER_DEFAULT_ROLES.
  if (domain.key === "service" && item.key === "dispatchScheduling") {
    return <DispatchSchedulingWorkspace />;
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
  // THE TECHNICIAN WORKSPACE, composed for the device it is opened on.
  //
  // This slot used to fall through to legacyKey "fieldMode" and render FieldMode at every width. On a
  // phone that meant a desktop-shaped surface with no thumb navigation, and TechnicianShell -- built
  // in WO-02 for exactly this -- was reachable from nowhere at all.
  //
  // WIDTH CHOOSES COMPOSITION, NEVER AUTHORITY. Both branches render the same governed surfaces
  // underneath, resolve capability identically, and read the same technician-scoped Work Orders. A
  // desktop user is not demoted to a phone shell, and a phone user does not gain or lose a single
  // permission by rotating the device.
  if (domain.key === "service" && item.key === "technicianWorkspace") {
    return <TechnicianWorkspaceSurface />;
  }
  // THE WAREHOUSE / PARTS HANDHELD, composed for the device it is opened on -- the same rule the
  // technician workspace follows, for the same reason. Both branches reach the SAME governed
  // workflows and resolve capability identically on the server.
  if (domain.key === "inventory" && item.key === "warehouseWorkspace") {
    return <WarehouseWorkspaceSurface operationalContext={operationalContext} role={role} />;
  }
  // THE SHARED SCAN WORKSPACE (Phase E). Composes the two scanning journeys that exist -- the Phase D
  // supplier receiving journey and the existing technician PartsScanner -- and derives which of them
  // to offer from the TRUSTED effective-access feed already threaded through operationalContext,
  // never from a role name. FieldMode still composes PartsScanner itself, so the technician journey
  // is not moved, only additionally reachable.
  if (domain.key === "service" && item.key === "scan") {
    return (
      <ScanWorkspace
        deps={{ hasCapability: operationalContext?.hasCapability, role }}
      />
    );
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
  // Administration > Duplicate Rules -- reads the seeded ruleset and renders every
  // edit control as protected+disabled with the reason, because the governed rules
  // service does not exist yet. No Firestore access, no writes.
  if (domain.key === "administration" && item.key === "duplicateRules") {
    return <AdminDuplicateRules />;
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
  // Inventory > Cycle Counts -- first-class workspace for the Cycle Count operating authority
  // (functions/src/cycleCount/*), replacing the prior route stub (navConfig.js's `cycleCounts` entry
  // stays `navHidden: true` -- that flag is owned by the nav orchestrator, not changed here). There is
  // NO live Firestore read for cycle_counts (Rules-denied, Admin-SDK-only like receiving_orders), so
  // this workspace has no accessVersion-driven read to thread; its state is session-scoped, built
  // entirely from the four governed callables' own responses (see useCycleCountActions.js).
  if (domain.key === "inventory" && item.key === "cycleCounts") {
    return <CycleCounts />;
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
  // Financials North Star P1 — Wave UX-1 (lifecycle read spine). Dispatched HERE like every
  // other real subnav page: the generic loop emits the route and renders what this returns,
  // so a separate <Route> at the same path would never win (see the Sales Order note above).
  // Remaining Financials items keep falling through to PlaceholderPage until their wave lands.
  if (domain.key === "financials" && item.key === "overview") {
    return <FinancialsOverview />;
  }
  if (domain.key === "financials" && item.key === "invoices") {
    return <FinancialsInvoices />;
  }
  if (domain.key === "financials" && item.key === "accountsReceivable") {
    return <FinancialsAccountsReceivable />;
  }
  if (domain.key === "financials" && item.key === "payments") {
    return <FinancialsPayments />;
  }
  if (domain.key === "financials" && item.key === "customerFinancials") {
    return <FinancialsCustomerFinancials />;
  }
  if (domain.key === "financials" && item.key === "billingQueue") {
    return <FinancialsBillingQueue />;
  }
  if (domain.key === "financials" && item.key === "creditsAdjustments") {
    return <FinancialsCreditsAdjustments />;
  }
  if (domain.key === "financials" && item.key === "salesToGoal") {
    return <FinancialsSalesToGoal />;
  }
  if (domain.key === "financials" && item.key === "costToBudget") {
    return <FinancialsCostToBudget />;
  }
  if (domain.key === "financials" && item.key === "forecasting") {
    return <FinancialsForecasting />;
  }
  if (domain.key === "financials" && item.key === "budgets") {
    return <FinancialsBudgets />;
  }
  if (domain.key === "financials" && item.key === "goals") {
    return <FinancialsGoals />;
  }
  if (domain.key === "financials" && item.key === "profitability") {
    return <FinancialsProfitability />;
  }
  if (domain.key === "financials" && item.key === "companyPerformance") {
    return <FinancialsCompanyPerformance />;
  }
  if (domain.key === "financials" && item.key === "employeePerformance") {
    return <FinancialsEmployeePerformance />;
  }
  if (item.legacyKey) {
    const Component = LEGACY_COMPONENTS[item.legacyKey];
    return <Component />;
  }
  return <PlaceholderPage title={item.label} explanation={item.placeholderExplanation} />;
}

/**
 * Phone -> the handheld shell. Anything wider -> the existing desktop composition.
 *
 * A component rather than an inline ternary so the media subscription lives in one place and the
 * shell genuinely UNMOUNTS at desktop widths: a hidden-but-mounted shell would still hold an offline
 * runtime, still sit in the tab order, and still run its effects.
 */
function TechnicianWorkspaceSurface() {
  return useIsPhone() ? <TechnicianShell /> : <FieldMode />;
}

/**
 * Phone -> the warehouse handheld. Anything wider -> the shared Scan workspace it composes.
 *
 * The desktop branch is deliberately ScanWorkspace rather than a warehouse dashboard: that IS the
 * existing desktop entry point for these workflows, and inventing a second one here would be a
 * surface nobody asked for competing with the one people already use.
 */
function WarehouseWorkspaceSurface({ operationalContext, role }) {
  const deps = { hasCapability: operationalContext?.hasCapability, role };
  return useIsPhone() ? <WarehouseShell deps={deps} /> : <ScanWorkspace deps={deps} />;
}

function AppRoutes({ role, allowedLegacyKeys, operationalContext }) {
  return (
    // ONE boundary around every route. A lazily-loaded surface that arrives a moment later shows this
    // instead of a blank frame -- and a blank frame is indistinguishable from a broken app on the slow
    // connection this whole change exists to serve.
    <Suspense fallback={<p className="fo-muted" role="status">Loading…</p>}>
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
                element={renderSubnavItem(domain, item, role, operationalContext, allowedLegacyKeys)}
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
          {/* GENERALIZED from the index item to EVERY denied subnav item, for the same
              reason and one more.
              The loop above emits routes only for VISIBLE items, so a hidden item's path
              matched nothing in this domain and fell through to the domain's dynamic child
              route below -- which read the path segment as a RECORD ID. A warehouse manager
              opening /inventory/receiving was told `Unknown part "receiving"`: not a denial,
              not a 404, but a confident claim about a part that was never a part. The same
              shape existed on /customers/:accountId and /equipment/:equipmentId.
              A static segment outranks a dynamic one in the router's own ranking, so simply
              emitting these routes takes the path back from the record lookup.
              Access is unchanged -- this only gives the refusal somewhere to be said. */}
          {domain.subnav
            .filter((item) => !isNavItemVisible(item, role, allowedLegacyKeys, operationalContext))
            .map((item) => (
              <Route
                key={`denied-${item.key}`}
                path={item.path || undefined}
                index={item.path === ""}
                element={
                  <EmptyState
                    variant="filtered"
                    title={`${item.label} isn't available to your role`}
                    message="Your account doesn't have access to this area. Contact an administrator if you believe this is an error."
                  />
                }
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
              {/* Post-Wave-5 -- minimum usable Sales Order view (Owner-ratified 2026-08-15).
                  Nested under opportunities/ since the Sales Order back-link is reached from an
                  Opportunity's detail pane; a static "opportunities/sales-order" prefix outranks
                  the dynamic :accountId sibling route, same reasoning as the retired-paths block
                  above. Reads the trusted getSalesOrderContext callable (salesOrder.read). */}
              <Route path="opportunities/sales-order/:salesOrderId" element={<SalesOrderDetailConnected />} />
              {/* Declared BEFORE opportunities/:opportunityId for the same reason the Sales Order
                  route above is: both are children of opportunities/, and React Router must read
                  "sales-agreement" as a static segment rather than as an Opportunity id. */}
              <Route path="opportunities/sales-agreement/:salesAgreementId" element={<SalesAgreementDetailConnected />} />
              {/* THE OPPORTUNITY GETS A URL (North Star family 4). Listed AFTER the sales-order
                  route above deliberately -- both are children of `opportunities/`, and React
                  Router ranks the static "sales-order" segment above this dynamic one, so an
                  address like /customers/opportunities/sales-order/xyz can never be read as an
                  opportunity id. `opportunities` itself (the workspace) is an exact match emitted
                  by the generic subnav loop and outranks both. Reads the trusted
                  getOpportunityContext callable (opportunity.read). */}
              <Route path="opportunities/:opportunityId" element={<OpportunityDetailConnected />} />
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
    </Suspense>
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
  const { hasCapability, accessVersion, accessResolving } = useReportCapabilities(user);
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
          action={<Button type="button" variant="primary" onClick={retryIdentityResolution}>Retry</Button>}
        />
      </div>
    );
  }

  if (!user) return <Login />;

  // Governed access is not known YET. Rendering the route table now would emit the route set for a
  // principal whose capabilities have not resolved, and the router's catch-all would immediately
  // redirect a capability-gated deep link to /dashboard -- destroying the URL before the answer
  // arrives. Waiting grants nothing (hasCapability still denies until a positive decision lands);
  // it only stops the shell from acting on an absence as though it were a refusal.
  if (accessResolving) return <div className="fo-panel">Loading...</div>;

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
        <Button type="button" variant="primary" onClick={() => window.location.reload()}>
          Check again
        </Button>
      </div>
    );
  }

  return (
    <InventoryProvider>
      <BrowserRouter basename={ROUTER_BASENAME}>
        {/* Records WHERE the user was when a crash happens. The root error boundary sits above the
            Router and cannot ask react-router anything -- least of all when the crash IS a routing
            problem -- so the trail is kept in a module the boundary can read without context. */}
        <CrashTrailRecorder />
        <CrashTest />
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
