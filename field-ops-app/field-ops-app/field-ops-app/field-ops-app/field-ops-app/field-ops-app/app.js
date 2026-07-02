// ---------- App shell ----------
//
// Top-level nav + view switcher. Each tab's component lives in its own
// file (jobs.js, technicians.js, dispatch.js, controlTower.js) and is
// registered on window.FieldOps by that file.

const NAV = [
  { key: "controlTower", label: "Control Tower" },
  { key: "jobs", label: "Jobs" },
  { key: "technicians", label: "Technicians" },
  { key: "dispatch", label: "Dispatch" },
];

function FieldOpsApp() {
  const [activeTab, setActiveTab] = React.useState("controlTower");

  const ActiveView =
    {
      controlTower: window.FieldOps.ControlTowerView,
      jobs: window.FieldOps.JobsView,
      technicians: window.FieldOps.TechniciansView,
      dispatch: window.FieldOps.DispatchView,
    }[activeTab] || window.FieldOps.ControlTowerView;

  return (
    <div className="fo-app">
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
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<FieldOpsApp />);
