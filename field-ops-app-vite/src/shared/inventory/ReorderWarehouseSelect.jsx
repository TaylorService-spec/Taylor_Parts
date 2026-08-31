// WORKSTREAM 2B -- the Reorder Request warehouse picker.
//
// A Reorder Request now carries a governed `warehouseId`, and the trusted createReorderRequest
// command derives the record's operatingCompanyId FROM that warehouse. So the warehouse is a
// governed identity the user states, never something this app works out.
//
// WHAT THIS IS: presentational only -- it renders whatever options it is handed.
// WHAT THIS IS NOT: authority, and not a reader either. Owner rulings -- "Client filtering is
// convenience. Server validation is authority."
//
// R-17: the options come from the trusted `listReorderWarehouseOptions` projection
// (hooks/useReorderWarehouseOptions.js), NOT from a `warehouses` collection read. The browser holds
// no LIST authority there and is not gaining one. The server returns only the warehouses this
// principal may actually raise a reorder for, and `createReorderRequest` enforces the SAME
// eligibility -- so every option here is accepted by the command, and a warehouseId that was never
// offered is refused even if it is posted by hand.
//
// THREE THINGS IT DELIBERATELY DOES NOT DO, each one forbidden by ruling rather than merely
// unimplemented:
//   - No default selection. Not the first option, not the only option, not "taylor". The empty
//     value is a real state meaning "not stated yet", and the caller must refuse to submit in it.
//   - No free text. The value is always a governed warehouse document id from the read below,
//     so an id that was never in the collection cannot be typed into a request.
//   - No inference from the part, the user, the truck, the page, or any company. There is no
//     rule mapping any of those to a warehouse, and there must not be one.
//
// Loading and error are rendered as themselves. An unavailable pick-list disables the choice --
// it never degrades into a guess.
export default function ReorderWarehouseSelect({ id, options, loading, error, value, onChange, disabled = false }) {
  if (loading) {
    return <p className="fo-muted">Loading warehouses...</p>;
  }
  if (error) {
    return (
      <p className="fo-muted" role="alert">
        Unable to load warehouses right now, so a reorder cannot be requested. Try again shortly.
      </p>
    );
  }
  if (options.length === 0) {
    return <p className="fo-muted">No warehouses are available to request against.</p>;
  }

  return (
    <label className="fo-muted" htmlFor={id}>
      Reorder for warehouse{" "}
      <select id={id} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {/* The empty option is not a placeholder trick: it is the honest initial state, and it
            stays selectable so a chooser can withdraw a choice rather than being locked into
            the first one they happened to click. */}
        <option value="">Select a warehouse...</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
