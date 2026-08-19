// Design-system foundation (PR 1) -- one page header per screen. Display
// typeface for the title (Barlow Condensed), interface typeface everywhere
// else. `actions` is a slot for primary/secondary Button primitives; this
// component lays them out but never decides what they do.
export default function PageHeader({ eyebrow, title, description, actions, className = "" }) {
  return (
    <header className={["fo-page-header", className].filter(Boolean).join(" ")}>
      <div className="fo-page-header__text">
        {eyebrow && <p className="fo-page-header__eyebrow">{eyebrow}</p>}
        <h1 className="fo-page-header__title">{title}</h1>
        {description && <p className="fo-page-header__description">{description}</p>}
      </div>
      {actions && <div className="fo-page-header__actions">{actions}</div>}
    </header>
  );
}
