// Issue #214 PR-1 -- shared form primitive. A categorized, accessible error
// region. Renders nothing when there is no message. Reuses the existing
// `.fo-warning` visual token (unchanged red copy) plus `.fo-wizard-error`
// (System-A full-width sizing). Callers pass only SAFE, actionable copy --
// never a raw provider detail (the domain error-message helpers, e.g.
// accountSaveErrorMessage, do that mapping upstream).
//
// `role` is opt-in: form-level submit/save errors pass role="alert" so they are
// announced; per-field errors (rendered by Field) omit it and are instead
// linked to their control via aria-describedby, so live per-keystroke
// validation does not spam assertive announcements.
export default function FormError({ id, role, className, children }) {
  if (!children) return null;
  const cls = className ? `fo-warning fo-wizard-error ${className}` : "fo-warning fo-wizard-error";
  return (
    <div id={id} role={role} className={cls}>
      {children}
    </div>
  );
}
