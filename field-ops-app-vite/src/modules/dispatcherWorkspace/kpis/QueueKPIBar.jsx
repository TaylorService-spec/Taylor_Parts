import { useMemo } from "react";
import { KPI_CONFIG } from "./kpiConfig";

// Renders purely from KPI_CONFIG -- computed over the FULL Work Order
// set (see kpiConfig.js's comment on why), not the currently-filtered
// queue. Adding a KPI means adding a config entry.
export default function QueueKPIBar({ workOrders }) {
  const values = useMemo(
    () => KPI_CONFIG.map((kpi) => ({ key: kpi.key, label: kpi.label, value: kpi.compute(workOrders) })),
    [workOrders]
  );

  return (
    <div className="fo-stat-grid fo-kpi-bar">
      {values.map((kpi) => (
        <div className="fo-stat" key={kpi.key}>
          <div className="fo-stat-value">{kpi.value}</div>
          <div className="fo-stat-label">{kpi.label}</div>
        </div>
      ))}
    </div>
  );
}
