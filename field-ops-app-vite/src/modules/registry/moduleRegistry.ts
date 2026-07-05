// Module Registry -- pure metadata, no routing authority.
//
// Informational only: label/description/uiGroup/icon per module, for
// future UI-grouping/display purposes. NO paths, NO route functions,
// NO navigation resolvers -- not imported by App.jsx or anything else.
// App.jsx's `NAV` array (src/App.jsx) + `ROLE_NAV_ACCESS`
// (domain/constants.js) remain the ONE AND ONLY navigation source of
// truth. React Router is not used anywhere in this app; this registry
// does not introduce it or assume it.
//
// Note: `dispatcherWorkspace` describes a screen that doesn't exist
// yet on this branch or `main` -- the real dispatcher screen today is
// `modules/dispatch/Dispatch.jsx` (App.jsx's "dispatch" NAV key). A
// full `DispatcherWorkspace` (queue/filters/KPIs) exists only on the
// still-unmerged `epic-2-work-order-interactive-ui` branch. Kept here
// as forward-looking metadata per this registry's requested shape --
// flagging it explicitly so it isn't mistaken for something live.
export const moduleRegistry = {
  workOrders: {
    label: "Work Orders",
    description: "Dispatcher Work Order Management",
    uiGroup: "dispatcher",
    icon: "clipboard",
  },

  dispatcherWorkspace: {
    label: "Dispatcher Workspace",
    description: "Real-time dispatch operations view",
    uiGroup: "dispatcher",
    icon: "dispatch",
  },

  controlTower: {
    label: "Control Tower",
    description: "Administrative oversight and monitoring",
    uiGroup: "admin",
    icon: "tower",
  },

  operationsDashboard: {
    label: "Operations Dashboard",
    description: "System analytics and reporting view",
    uiGroup: "executive",
    icon: "dashboard",
  },

  fieldMode: {
    label: "Field Mode",
    description: "Technician execution interface",
    uiGroup: "field",
    icon: "mobile",
  },
};
