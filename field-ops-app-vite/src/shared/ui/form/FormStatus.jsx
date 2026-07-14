// Issue #214 PR-1 -- shared form primitive. A polite live region for transient
// form status (e.g. "Saving..."). Always rendered so assistive tech observes the
// text change and announces it; visually hidden by default (`.fo-sr-only`) since
// the submit button already shows the saving state visually. Pass `visible` to
// render it on-screen instead.
export default function FormStatus({ children, visible = false, className }) {
  const cls = [visible ? "" : "fo-sr-only", className].filter(Boolean).join(" ") || undefined;
  return (
    <p className={cls} role="status" aria-live="polite">
      {children}
    </p>
  );
}
