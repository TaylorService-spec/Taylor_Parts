import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./AppShell";
import { routes } from "./routes";

// Domain-routing scaffold (structural refactor only, per the "domain
// routing + shell" request): NOT wired into main.jsx yet, and does not
// replace App.jsx -- that remains the app's real entry point, fully
// unchanged, still covering Control Tower/Jobs/Technicians/Dispatch/
// Field Mode/Inventory/Operations exactly as before. This file exists
// so the domain-routing structure is in place in the codebase, ready
// for a future epic to actually wire in (migrate the other 6 existing
// screens into domains/, decide auth/role gating equivalent to
// ROLE_NAV_ACCESS, then swap main.jsx to render this instead of App).
// Importing this file has zero effect on the running app today.
export default function AppRouter() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/execution" replace />} />
          {routes.map(({ path, Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
