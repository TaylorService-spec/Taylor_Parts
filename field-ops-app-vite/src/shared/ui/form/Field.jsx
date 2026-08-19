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
//
// Auto-wiring: when Field wraps exactly one control element, it clones that
// element to fill in `id` / `aria-describedby` / `aria-invalid` /
// `aria-required` -- the same values a caller would otherwise have to derive
// by hand with `describedBy()`/`hintId()`/`errorId()` from ./fieldA11y. A
// caller's own explicit attribute on the control always wins (this only FILLS
// IN what's missing, never overrides), so every existing call site that
// already wires these by hand renders identically. This exists because that
// hand-wiring has already been missed at at least one call site (an error was
// set on a Field but never reached the control's aria-describedby), silently
// leaving an error unannounced to assistive tech. When Field wraps more than
// one child (e.g. a control plus trailing help copy), it's left alone,
// unchanged -- there is no single control to attach these to.
import { Children, cloneElement, isValidElement } from "react";
import { hintId, errorId, describedBy } from "./fieldA11y";
import FormError from "./FormError";

export default function Field({ id, label, required = false, hint, error, className, children }) {
  const wrapCls = className ? `fo-form-field ${className}` : "fo-form-field";
  const hasHint = Boolean(hint);
  const hasError = Boolean(error);

  let control = children;
  if (isValidElement(children) && Children.count(children) === 1) {
    control = cloneElement(children, {
      id: children.props.id ?? id,
      "aria-describedby": children.props["aria-describedby"] ?? describedBy(id, { hasHint, hasError }),
      "aria-invalid": children.props["aria-invalid"] ?? (hasError ? true : undefined),
      "aria-required": children.props["aria-required"] ?? (required ? true : undefined),
    });
  }

  return (
    <div className={wrapCls}>
      <label className="fo-wizard-field-label" htmlFor={id}>
        {label}
        {required && <span className="fo-field-required"> (required)</span>}
      </label>
      {control}
      {hint && (
        <p className="fo-wizard-hint" id={hintId(id)}>
          {hint}
        </p>
      )}
      {error && <FormError id={errorId(id)}>{error}</FormError>}
    </div>
  );
}
