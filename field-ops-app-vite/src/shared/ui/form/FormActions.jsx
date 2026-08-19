// Issue #214 PR-1 -- shared form primitive. The form's action row. Callers place
// the PRIMARY action first, then secondary/cancel, so the DOM (and tab) order is
// primary -> secondary. Reuses the established `.fo-btn-row` token (which already
// stacks to a column at narrow widths) plus the System-A `.fo-wizard-actions`
// alignment, so every migrated form's actions look and stack the same way.
//
// `submitting` is optional and additive: when true it marks the whole action
// row `aria-busy`, so assistive tech announces the busy state of the row (not
// just whichever individual button happens to change its own label). It does
// NOT by itself make a submit button's width stable while its label changes
// ("Save" -> "Saving...") -- that guarantee lives in the `Button` primitive's
// own `loading` state (`fo-button--loading`, see src/shared/ui/primitives/
// Button.jsx), which reserves the label's layout space instead of reflowing
// it. FormActions renders whatever children it's given, plain `<button>`
// elements included, so a caller must migrate its submit/cancel controls to
// `Button` to get that width-stable behaviour -- this row only orders and
// aligns them.
export default function FormActions({ className, submitting = false, children }) {
  const cls = className ? `fo-btn-row fo-wizard-actions ${className}` : "fo-btn-row fo-wizard-actions";
  return (
    <div className={cls} aria-busy={submitting ? "true" : undefined}>
      {children}
    </div>
  );
}
