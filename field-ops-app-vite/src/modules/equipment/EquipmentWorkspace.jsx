// INV-EQ-P1b -- the visible Equipment workspace: three tabs over the /equipment route.
// Customer Equipment (default) shows the cross-customer paginated installed list;
// Available Equipment reports "not yet connected" until the Serialized Asset registry
// ships. WAI-ARIA Tabs pattern with roving tabindex + arrow/Home/End keyboard
// navigation. All panels stay mounted (inactive ones hidden) so the Customer tab's
// paginated state survives a tab switch.
//
// site-work #10 -- Add Equipment. EquipmentRegister (Issue #232 unit E5) is the
// existing, tested Account-scoped register + create flow (EquipmentCreateModal +
// domain/equipmentRepository's createEquipment write): built, wired to its own tests,
// but never reachable from the routed UI, so no permitted user could actually create
// Equipment through the shipped app. It is wired in here as a third tab rather than
// rebuilt or merged into CustomerEquipment -- CustomerEquipment is a deliberately
// read-only, cross-customer, LOADED-only-filtered list (see its own header comment);
// EquipmentRegister's account-first bounding is what the create flow requires
// (EquipmentCreateModal's Location options -- and the write itself -- are scoped to
// one fixed Account, never a picker of its own). No new role gating is added: the
// whole /equipment domain is already admin/dispatcher-only (navConfig.js -- no
// legacyKey defaults to PLACEHOLDER_DEFAULT_ROLES), so this tab inherits that gate
// exactly like the other two.
import { useRef, useState } from "react";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import CustomerEquipment from "./CustomerEquipment";
import AvailableEquipment from "./AvailableEquipment";
import EquipmentRegister from "./EquipmentRegister";

const TABS = [
  { id: "customer", label: "Customer Equipment" },
  { id: "available", label: "Available Equipment" },
  { id: "add", label: "Add Equipment" },
];

// `accessVersion` is still ACCEPTED and no longer used. App.jsx passes it, and the Customer
// Equipment tab was its only consumer — it keyed the accessVersion-scoped paging hook that tab
// no longer reads. Kept in the signature rather than removed from the call site, because the
// access-version seam is a governance contract and quietly dropping the prop would make it look
// as though this workspace had never been inside it. Underscored so lint agrees it is deliberate.
export default function EquipmentWorkspace({ accessVersion: _accessVersion }) {
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
      {/* THE COLLECTION HEADER, WITH NO COUNT — and the omission is the honest answer rather than
          a gap. This page hosts THREE tabs that answer three different questions: the business-wide
          installed register, the not-yet-connected serialized-asset surface, and an Account-scoped
          create flow. One number beside one title would have to mean one of them, and a reader has
          no way to tell which. Lists P2 is explicit that the workload line is "omitted entirely when
          nothing can be counted", and the same rule reaches the count itself.
          The Customer Equipment tab carries its OWN governed aggregate through ListViewHeader,
          where it is unambiguous because it sits over the rows it counts. */}
      <WorkspaceIdentity crumb="Equipment" title="Equipment" />

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
        {/* The business-wide installed register: bounded metadata runtime, server-side filters.
            Distinct from the Add Equipment tab below, which stays Account-scoped by design. */}
        <CustomerEquipment />
      </div>
      <div role="tabpanel" id="eq-panel-available" aria-labelledby="eq-tab-available" hidden={active !== "available"}>
        <AvailableEquipment />
      </div>
      <div role="tabpanel" id="eq-panel-add" aria-labelledby="eq-tab-add" hidden={active !== "add"}>
        <EquipmentRegister />
      </div>
    </div>
  );
}
