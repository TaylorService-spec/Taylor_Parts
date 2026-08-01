// EI Truck Registry -- a pure, bounded <select> for a governed pick-list (drivers or
// warehouses). It renders ONLY the options it is handed (a single bounded query upstream;
// never a per-row lookup), plus loading / failure / empty affordances. It holds no
// firebase import, so it is fully renderable in tests and the test-only preview.
export default function BoundedSelect({
  id,
  value,
  onChange,
  options = [],
  loading = false,
  error = false,
  disabled = false,
  placeholder = "Select…",
  emptyLabel = "None available",
  describedBy,
}) {
  const isDisabled = disabled || loading || Boolean(error);
  return (
    <>
      <select
        id={id}
        className="fo-wizard-control"
        value={value ?? ""}
        disabled={isDisabled}
        aria-describedby={describedBy}
        aria-busy={loading || undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{loading ? "Loading…" : options.length === 0 ? emptyLabel : placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="fo-warning" role="alert">
          Options couldn’t be loaded. Reopen to try again.
        </p>
      )}
    </>
  );
}
