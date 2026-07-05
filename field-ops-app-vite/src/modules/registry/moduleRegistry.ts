// Module Registry -- pure metadata, no routing authority.
//
// Informational only: label/description/uiGroup/icon/screens per
// module, for future UI-grouping/display purposes. NO paths, NO route
// functions, NO navigation resolvers -- not imported by App.jsx or
// anything else. App.jsx's `NAV` array (src/App.jsx) +
// `ROLE_NAV_ACCESS` (domain/constants.js) remain the ONE AND ONLY
// navigation source of truth. React Router is not used anywhere in
// this app; this registry does not introduce it or assume it.
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

  controlTower: {
    label: "Control Tower",
    description: "Administrative oversight and system monitoring",
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
