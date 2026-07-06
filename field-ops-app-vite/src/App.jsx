import { useEffect, useState } from "react";
import ControlTower from "./modules/controlTower/ControlTower";
import Jobs from "./modules/jobs/Jobs";
import Technicians from "./modules/technicians/Technicians";
import Dispatch from "./modules/dispatch/Dispatch";
import FieldMode from "./modules/mobile/FieldMode";
import Inventory from "./modules/inventory/Inventory";
import Operations from "./modules/operations/Operations";
import DispatcherBoard from "./modules/dispatcherBoard/DispatcherBoard";
import TechnicianDashboard from "./modules/technicianDashboard/TechnicianDashboard";
import { useAuth } from "./auth/AuthContext";
import Login from "./auth/Login";
import AppHeader from "./shared/ui/AppHeader";
import { InventoryProvider } from "./demo/InventoryContext";
import { IS_DEMO } from "./config/env";
import { ROLE_NAV_ACCESS } from "./domain/constants";

const NAV = [
  { key: "controlTower", label: "Control Tower", Component: ControlTower },
  { key: "jobs", label: "Work Orders", Component: Jobs },
  { key: "technicians", label: "Technicians", Component: Technicians },
  { key: "dispatch", label: "Dispatch", Component: Dispatch },
  { key: "fieldMode", label: "Field Mode", Component: FieldMode },
  { key: "inventory", label: "Inventory", Component: Inventory },
  { key: "operations", label: "Operations", Component: Operations },
  { key: "dispatcherBoard", label: "Dispatcher Board", Component: DispatcherBoard },
  { key: "technicianDashboard", label: "My Work Orders", Component: TechnicianDashboard },
];

export default function App() {
  // Hero-story follow-up: lands on Dispatch instead of Control Tower so a
  // shared demo link opens straight onto the hero job. UI default only --
  // NAV/routing itself is unchanged, and every tab remains one click away.
  const [activeTab, setActiveTab] = useState("dispatch");
  const { user, role, loading } = useAuth();
  const allowedKeys = ROLE_NAV_ACCESS[role] ?? [];
  const visibleNav = NAV.filter((n) => allowedKeys.includes(n.key));

  useEffect(() => {
    if (visibleNav.length && !allowedKeys.includes(activeTab)) {
      setActiveTab(visibleNav[0].key);
    }
  }, [role]);

  const ActiveView = visibleNav.find((n) => n.key === activeTab)?.Component ?? visibleNav[0]?.Component;

  if (loading) return <div className="fo-panel">Loading...</div>;

  if (!user) return <Login />;

  if (!visibleNav.length) {
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
      <div className="fo-app">
        {IS_DEMO && <div className="fo-demo-banner">DEMO MODE ACTIVE (SAFE - NO WRITES TO PRODUCTION)</div>}
        <AppHeader />
        <header className="fo-header">
          <h1>Field Ops</h1>
          <nav className="fo-nav">
            {visibleNav.map((item) => (
              <button
                key={item.key}
                className={activeTab === item.key ? "fo-nav-btn fo-nav-btn-active" : "fo-nav-btn"}
                onClick={() => setActiveTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>
        <main className="fo-main">
          <ActiveView />
        </main>
      </div>
    </InventoryProvider>
  );
}
