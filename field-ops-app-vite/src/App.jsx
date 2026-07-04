import { useState } from "react";
import ControlTower from "./modules/controlTower/ControlTower";
import Jobs from "./modules/jobs/Jobs";
import Technicians from "./modules/technicians/Technicians";
import Dispatch from "./modules/dispatch/Dispatch";
import FieldMode from "./modules/mobile/FieldMode";
import Inventory from "./modules/inventory/Inventory";
import { useAuth } from "./auth/AuthContext";
import AppHeader from "./shared/ui/AppHeader";
import { InventoryProvider } from "./demo/InventoryContext";

const NAV = [
  { key: "controlTower", label: "Control Tower", Component: ControlTower },
  { key: "jobs", label: "Work Orders", Component: Jobs },
  { key: "technicians", label: "Technicians", Component: Technicians },
  { key: "dispatch", label: "Dispatch", Component: Dispatch },
  { key: "fieldMode", label: "Field Mode", Component: FieldMode },
  { key: "inventory", label: "Inventory", Component: Inventory },
];

export default function App() {
  // Hero-story follow-up: lands on Dispatch instead of Control Tower so a
  // shared demo link opens straight onto the hero job. UI default only --
  // NAV/routing itself is unchanged, and every tab remains one click away.
  const [activeTab, setActiveTab] = useState("dispatch");
  const { user, login, loading } = useAuth();
  const ActiveView = NAV.find((n) => n.key === activeTab)?.Component ?? Dispatch;

  if (loading) return <div className="fo-panel">Loading...</div>;

  if (!user) {
    return (
      <div className="fo-panel">
        <h2>Field Ops Login</h2>
        <button onClick={() => login("fieldops@test.com", "ASU!123!")}>
          Sign In
        </button>
      </div>
    );
  }

  return (
    <InventoryProvider>
      <div className="fo-app">
        <AppHeader />
        <header className="fo-header">
          <h1>Field Ops</h1>
          <nav className="fo-nav">
            {NAV.map((item) => (
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
