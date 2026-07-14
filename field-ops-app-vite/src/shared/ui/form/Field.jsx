// Issue #214 PR-1 -- shared form primitive. A single labeled field: label
// ABOVE its control, with consistent hint + error placement below it.
//
// Thin and composable by design (NOT a schema-driven form framework): the
// caller owns the control and passes it as `children`, giving that control the
// SAME `id` as `htmlFor` here (label/control association) and, when it has a
// hint or error, `aria-describedby={describedBy(id, ...)}`. Field only supplies
// the label, the required indicator (as TEXT, never color alone), the hint, and
// the error region -- with stable ids derived the same way the caller derives
// its aria-describedby.
//
// Markup contract: the wrapper keeps the established `.fo-form-field` class so
// the account form's grid/flex layout (index.css) and the layout driver command
// continue to apply unchanged; the label/hint carry the System-A
// `.fo-wizard-field-label` / `.fo-wizard-hint` visual tokens. `className` is
// appended for per-field layout modifiers (e.g. full-width rows).
import { hintId, errorId } from "./fieldA11y";
import FormError from "./FormError";

export default function Field({ id, label, required = false, hint, error, className, children }) {
  const wrapCls = className ? `fo-form-field ${className}` : "fo-form-field";
  return (
    <div className={wrapCls}>
      <label className="fo-wizard-field-label" htmlFor={id}>
        {label}
        {required && <span className="fo-field-required"> (required)</span>}
      </label>
      {children}
      {hint && (
        <p className="fo-wizard-hint" id={hintId(id)}>
          {hint}
        </p>
      )}
      {error && <FormError id={errorId(id)}>{error}</FormError>}
    </div>
  );
}
