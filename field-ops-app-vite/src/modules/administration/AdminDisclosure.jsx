// ADMINISTRATION DISCLOSURE ROW (ADMIN-UI-002). Expanding an Object is navigation within the page, not an action,
// so it is a full-width row with a chevron rather than an outlined button (cross-cutting rule 1). A real <button>
// keeps keyboard and screen-reader behavior; `aria-expanded` carries the state the chevron draws. Styled only under
// `.fo-admin` (index.css).
export default function AdminDisclosure({ open, onToggle, children, meta = null }) {
  return (
    <button type="button" className="fo-admin-disclosure" aria-expanded={open} onClick={onToggle}>
      <span className="fo-admin-disclosure__chevron" aria-hidden="true" />
      <span className="fo-admin-disclosure__label">{children}</span>
      {meta ? <span className="fo-admin-disclosure__meta">{meta}</span> : null}
    </button>
  );
}
