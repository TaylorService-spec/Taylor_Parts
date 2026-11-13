// Design-system foundation (PR 1) -- one page header per screen. Display
// typeface for the title (Barlow Condensed), interface typeface everywhere
// else. `actions` is a slot for primary/secondary Button primitives; this
// component lays them out but never decides what they do.
//
// Compact UX Standard (docs/design/compact-ux-standard.md §2): `description` is ONE line
// that says what the page is for; anything longer goes in `help`, which renders as an
// InfoTip beside the title (hover, focus and tap) instead of a paragraph above the work.
import InfoTip from "./InfoTip.jsx";

export default function PageHeader({ eyebrow, title, description, help, actions, className = "" }) {
  return (
    <header className={["fo-page-header", className].filter(Boolean).join(" ")}>
      <div className="fo-page-header__text">
        {eyebrow && <p className="fo-page-header__eyebrow">{eyebrow}</p>}
        {help ? (
          <div className="fo-page-header__title-row">
            <h1 className="fo-page-header__title">{title}</h1>
            <InfoTip label={`About ${typeof title === "string" ? title : "this page"}`}>{help}</InfoTip>
          </div>
        ) : (
          <h1 className="fo-page-header__title">{title}</h1>
        )}
        {description && <p className="fo-page-header__description">{description}</p>}
      </div>
      {actions && <div className="fo-page-header__actions">{actions}</div>}
    </header>
  );
}
