import Autocomplete, { searchLoaded } from "../../shared/ui/Autocomplete.jsx";
import { useEquipmentForAccount } from "../../hooks/useEquipment";
import { equipmentDisplayName, equipmentSummary } from "../../domain/equipment";
import { WORK_ORDER_EQUIPMENT_RULE } from "../../domain/workOrderEquipmentRule.js";

// CHOOSE THE MACHINE, BY WHAT IT IS — never by typing an id.
//
// ════════════════════ WHY A PICKER AND NOT A FIELD ════════════════════
//
// `equipmentId` is a Firestore document key. Nobody knows one, nobody can check one, and a text box
// asking for one is a field that can only be filled in wrongly. Every option here is labelled with
// what a person standing in front of the unit can read off it — name, then manufacturer / model /
// serial / asset tag through `equipmentSummary`, which is the same disambiguating line the Equipment
// register uses and which never renders a raw id.
//
// Duplicate names are legal, which is exactly why the summary is there.
//
// ════════════════════ SCOPED, AND THE SCOPE IS NOT THE VALIDATION ════════════════════
//
// Options come from `useEquipmentForAccount`, so a dispatcher sees this customer's machines and not
// the estate. That is a convenience for the person choosing.
//
// IT IS NOT EVIDENCE. The server re-reads the Equipment document inside the create transaction and
// checks account and location against it (functions/src/workOrderEquipment.ts), because a caller can
// send any id regardless of what this control offered. A filtered list and a validated relationship
// are different things, and only one of them is enforcement.
//
// ════════════════════ INSTALL IS NOT OFFERED A UNIT ════════════════════
//
// On an INSTALL the machine does not exist yet — it is created at completion from the serialized
// asset that was delivered. Rather than showing an empty or misleading list, the control explains
// that, which is the same rule the server enforces rather than a second opinion about it.

export default function EquipmentPicker({ accountId, locationId = null, type, value, onChange }) {
  const rule = type ? WORK_ORDER_EQUIPMENT_RULE[type] : "OPTIONAL_EXISTING";
  const { data: equipment, loading, error } = useEquipmentForAccount(accountId || null);

  if (rule === "FORBIDDEN_AT_CREATE") {
    return (
      <p className="fo-muted" data-equipment-picker="not-applicable">
        An install creates the equipment record when the installation is completed, from the
        serialized unit that was delivered — so there is nothing to choose here yet.
      </p>
    );
  }

  if (!accountId) {
    return <p className="fo-muted" data-equipment-picker="no-account">Choose a customer first to list their equipment.</p>;
  }
  if (loading) return <p className="fo-muted" data-equipment-picker="loading">Loading equipment…</p>;
  if (error) {
    // A failed read is not "this customer has no equipment". Saying so would send somebody to
    // create a duplicate record for a machine that is already there.
    return (
      <p className="fo-warning" role="status" data-equipment-picker="error">
        Equipment could not be loaded, so it cannot be selected here. The work order can still be
        created without it.
      </p>
    );
  }

  // Where a site is already chosen, narrow to that site's units — a machine installed elsewhere is
  // not the one being visited, and the server refuses that pairing anyway.
  const options = (equipment ?? []).filter(
    (e) => !locationId || !e.locationId || e.locationId === locationId,
  );

  if (options.length === 0) {
    return (
      <p className="fo-muted" data-equipment-picker="empty">
        No equipment is recorded for this customer{locationId ? " at this location" : ""}. The work
        order can be created without it.
      </p>
    );
  }

  // TYPEAHEAD (UI corrections item E): find the unit by name, manufacturer, model, serial or asset tag among THIS
  // customer's machines (the server-scoped list above). Not choosing stays a real answer ("Not Specified").
  const selected = options.find((e) => e.id === value) ?? null;
  return (
    <div data-equipment-picker="ready">
      <Autocomplete
        id="wo-equipment"
        label="Equipment"
        hideLabel
        placeholder={`Type to find one of ${options.length} unit${options.length === 1 ? "" : "s"}`}
        search={searchLoaded(options, (e) => `${equipmentDisplayName(e)} ${equipmentSummary(e) ?? ""}`)}
        selected={selected}
        getKey={(e) => e.id}
        getLabel={(e) => equipmentDisplayName(e)}
        getContext={(e) => equipmentSummary(e) || null}
        onSelect={(e) => onChange(e ? e.id : null)}
      />
      <p className="fo-muted">
        {selected ? `Selected: ${equipmentDisplayName(selected)}. ` : "Not specified — a service call can be raised before anyone knows the unit. "}
        {selected ? <button type="button" className="fo-linkbutton" onClick={() => onChange(null)}>Not Specified</button> : null}
      </p>
    </div>
  );
}
