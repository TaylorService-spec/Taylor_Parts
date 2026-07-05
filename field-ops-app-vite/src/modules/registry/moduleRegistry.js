// Module Registry -- pure metadata, no routing authority.
//
// This describes the app's existing screens for future UI-grouping/
// display purposes ONLY (e.g. a future settings page listing "what
// modules exist"). It has NO paths, NO route functions, and is NOT
// imported or read by App.jsx's navigation today -- App.jsx's `NAV`
// array (src/App.jsx) plus `ROLE_NAV_ACCESS` (domain/constants.js)
// remain the ONE AND ONLY source of truth for what's navigable and by
// whom. Editing this file has zero effect on the running app.
//
// Every key here corresponds 1:1 to an existing, real NAV entry in
// App.jsx -- deliberately not aspirational/future domain names, so
// this stays grounded in what the app actually has today.
export const moduleRegistry = {
  controlTower: {
    label: "Control Tower",
    description: "Read-only dispatch intelligence layer (at-risk jobs, overload, activity timeline)",
    uiGroup: "admin",
  },
  jobs: {
    label: "Work Orders",
    description: "Job/Work Order list and management",
    uiGroup: "dispatcher",
  },
  technicians: {
    label: "Technicians",
    description: "Technician roster and availability",
    uiGroup: "dispatcher",
  },
  dispatch: {
    label: "Dispatch",
    description: "Assigns pending jobs to available technicians",
    uiGroup: "dispatcher",
  },
  fieldMode: {
    label: "Field Mode",
    description: "Technician-facing mobile view",
    uiGroup: "technician",
  },
  inventory: {
    label: "Inventory",
    description: "Demo warehouse/truck stock transfer view (visual-only, no Firestore)",
    uiGroup: "dispatcher",
  },
  operations: {
    label: "Operations",
    description: "Read-only executive/monitoring layer over the ledger, analytics, warehouse, and procurement systems",
    uiGroup: "executive",
  },
};
