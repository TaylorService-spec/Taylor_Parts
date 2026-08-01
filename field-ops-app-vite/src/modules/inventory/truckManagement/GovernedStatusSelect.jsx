// EI Truck Registry -- the governed status <select>. Options come ONLY from the
// governed constant (never inferred / never row-derived). A truck status must be
// EXPLICITLY selected: the default placeholder is not a submittable value.
import { TRUCK_STATUS_OPTIONS, truckStatusLabel } from "../../../domain/truckManagement.js";

export default function GovernedStatusSelect({
  id,
  value,
  onChange,
  options = TRUCK_STATUS_OPTIONS,
  disabled = false,
  placeholder = "Select a status…",
  describedBy,
}) {
  return (
    <select
      id={id}
      className="fo-wizard-control"
      value={value ?? ""}
      disabled={disabled}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((s) => (
        <option key={s} value={s}>
          {truckStatusLabel(s)}
        </option>
      ))}
    </select>
  );
}
