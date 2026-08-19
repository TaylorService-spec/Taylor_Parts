// Design-system foundation (PR 1) -- a repeatable, quieter header for a
// section within a screen. Interface typeface throughout (display type is
// reserved for the one PageHeader per screen).
export default function SectionHeader({ title, description, actions, level = 2, className = "" }) {
  const Heading = `h${level}`;
  return (
    <div className={["fo-section-header", className].filter(Boolean).join(" ")}>
      <div>
        <Heading className="fo-section-header__title">{title}</Heading>
        {description && <p className="fo-section-header__description">{description}</p>}
      </div>
      {actions && <div className="fo-section-header__actions">{actions}</div>}
    </div>
  );
}
