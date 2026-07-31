// INV-EQ-P1b -- the visible Equipment workspace: two tabs over the /equipment route.
// Customer Equipment (default) shows the cross-customer paginated installed list;
// Available Equipment is a visible second tab that honestly reports "not yet
// connected" until the Serialized Asset registry ships. WAI-ARIA Tabs pattern with
// roving tabindex + arrow/Home/End keyboard navigation. Both panels stay mounted
// (inactive one hidden) so the Customer tab's paginated state survives a tab switch.
import { useRef, useState } from "react";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import CustomerEquipment from "./CustomerEquipment";
import AvailableEquipment from "./AvailableEquipment";

const TABS = [
  { id: "customer", label: "Customer Equipment" },
  { id: "available", label: "Available Equipment" },
];

export default function EquipmentWorkspace({ accessVersion }) {
  const [active, setActive] = useState("customer");
  const tabRefs = useRef({});

  const onKeyDown = (e) => {
    const idx = TABS.findIndex((t) => t.id === active);
    let next = null;
    if (e.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const id = TABS[next].id;
    setActive(id);
    tabRefs.current[id]?.focus();
  };

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Equipment" />

      <div role="tablist" aria-label="Equipment views" onKeyDown={onKeyDown}>
        {TABS.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => { tabRefs.current[t.id] = el; }}
              type="button"
              role="tab"
              id={`eq-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`eq-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="eq-panel-customer" aria-labelledby="eq-tab-customer" hidden={active !== "customer"}>
        <CustomerEquipment accessVersion={accessVersion} />
      </div>
      <div role="tabpanel" id="eq-panel-available" aria-labelledby="eq-tab-available" hidden={active !== "available"}>
        <AvailableEquipment />
      </div>
    </div>
  );
}
