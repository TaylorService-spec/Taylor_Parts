// Domain-routing scaffold (structural only, not yet wired into main.jsx
// -- see src/app/AppRouter.jsx's header comment). No relation to
// App.jsx's existing NAV/ROLE_NAV_ACCESS, which remains the live nav.
export const navItems = [
  { id: "execution", label: "Execution", path: "/execution" },
  { id: "inventory", label: "Inventory", path: "/inventory" },
  { id: "analytics", label: "Analytics", path: "/analytics" },
  { id: "warehouse", label: "Warehouse", path: "/warehouse" },
  { id: "procurement", label: "Procurement", path: "/procurement" },
  { id: "optimization", label: "Optimization", path: "/optimization" },
];
