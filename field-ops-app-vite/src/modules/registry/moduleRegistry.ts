// Module Registry -- pure metadata, no routing authority.
//
// Informational only: label/description/uiGroup/icon/screens per
// module. NO paths, NO route functions, NO navigation resolvers --
// not imported by App.jsx or anything else, still.
//
// STALE AS OF SPRINT 2.0.1 (Release 2.0): the claim this comment used
// to make -- "App.jsx's NAV array + ROLE_NAV_ACCESS remain the ONE AND
// ONLY navigation source of truth, React Router is not used anywhere"
// -- is no longer true. App.jsx's old flat `NAV` array is gone;
// `navigation/navConfig.js` is now the real navigation source of
// truth, wired into real `react-router-dom` routes. See
// `docs/Architecture.md`'s "SPA routing" section and
// `docs/architecture/SYSTEM_AUTHORITIES.md`'s "Navigation" row. This
// file remains exactly what it always was -- unused, descriptive-only
// metadata, still not imported anywhere -- just no longer describing
// the current routing model accurately below; treat the "Accuracy
// notes" as doubly aspirational now.
//
// Accuracy notes (this registry is aspirational/descriptive, not a
// reflection of current real structure):
// - `dispatcherWorkspace` and its `screens` describe a module that
//   doesn't exist yet on this branch or `main` -- the real dispatcher
//   screen today is `modules/dispatch/Dispatch.jsx` (App.jsx's
//   "dispatch" NAV key), a single flat screen with no Queue/
//   DispatchBoard sub-views. A `DispatcherWorkspace` with real
//   queue/filter/KPI sub-components exists only on the separate,
//   still-unmerged `epic-2-work-order-interactive-ui` branch.
// - `controlTower.screens` lists Jobs/Technicians/Inventory/Operations
//   as if nested under Control Tower -- in the real app (App.jsx's
//   `NAV` array) these are independent sibling top-level tabs, not
//   children of Control Tower. Listed here as a wishlist grouping
//   only; does not reflect any real parent/child relationship.
// - `operationsDashboard.screens` (KPIs/Reports/Trends) don't match
//   Operations.jsx's actual 3 panels (Inventory Health/Warehouse/
//   Procurement) -- also aspirational.
// - `workOrders.screens`' `CreateWorkOrderWizard` exists only on the
//   unmerged `epic-2-work-order-interactive-ui` branch, not here/main.
export const moduleRegistry = {
  dispatcherWorkspace: {
    label: "Dispatcher Workspace",
    description: "Real-time dispatch operations and Work Order management",
    uiGroup: "dispatcher",
    icon: "dispatch",
    screens: ["WorkOrders", "Queue", "DispatchBoard"],
  },

  // Platform Task 3 -- user-facing rename to "Service Operations" (promoted to a
  // top-level area at /service-operations). Internal key stays "controlTower"
  // (stable -- it's the legacyKey wired to LEGACY_COMPONENTS/ROLE_NAV_ACCESS).
  controlTower: {
    label: "Service Operations",
    description: "Service operations oversight and system monitoring",
    uiGroup: "admin",
    icon: "tower",
    screens: ["Jobs", "Technicians", "Inventory", "Operations"],
  },

  operationsDashboard: {
    label: "Operations Dashboard",
    description: "Executive-level reporting and analytics view",
    uiGroup: "executive",
    icon: "dashboard",
    screens: ["KPIs", "Reports", "Trends"],
  },

  fieldMode: {
    label: "Field Mode",
    description: "Technician mobile execution interface",
    uiGroup: "field",
    icon: "mobile",
    screens: ["ActiveJob", "Navigation", "WorkCompletion"],
  },

  workOrders: {
    label: "Work Orders",
    description: "Core Work Order entity and lifecycle views",
    uiGroup: "dispatcher",
    icon: "clipboard",
    screens: ["WorkOrderDetail", "CreateWorkOrderWizard"],
  },
};
