// Issue #214 PR-1 -- shared form primitive. The form's action row. Callers place
// the PRIMARY action first, then secondary/cancel, so the DOM (and tab) order is
// primary -> secondary. Reuses the established `.fo-btn-row` token (which already
// stacks to a column at narrow widths) plus the System-A `.fo-wizard-actions`
// alignment, so every migrated form's actions look and stack the same way.
export default function FormActions({ className, children }) {
  const cls = className ? `fo-btn-row fo-wizard-actions ${className}` : "fo-btn-row fo-wizard-actions";
  return <div className={cls}>{children}</div>;
}
