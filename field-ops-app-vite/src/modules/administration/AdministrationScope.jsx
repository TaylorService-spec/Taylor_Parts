import { Outlet } from "react-router-dom";

// ADMINISTRATION STYLE SCOPE (ADMIN-UI-001..008, Owner-approved 2026-10-09). The layout element of the
// /administration route ONLY: it wraps Administration page content -- never the application shell, never another
// workspace -- in `.fo-admin`, and every Administration-specific presentation rule in index.css is written under that
// class. Shared components keep their global behavior and styling everywhere else.
export default function AdministrationScope() {
  return (
    <div className="fo-admin">
      <Outlet />
    </div>
  );
}
