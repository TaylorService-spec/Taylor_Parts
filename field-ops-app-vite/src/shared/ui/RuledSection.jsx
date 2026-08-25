// A SECTION, SEPARATED BY A RULE RATHER THAN A BOX.
//
// The North Star's structure is whitespace and rules — "hierarchy comes from type scale and
// whitespace, not boxes". The pilot's own diagnosis of current EOS is that `.fo-panel` (a bordered,
// padded, rounded, shadowed card) became the de-facto page model, so ~35 screens return a card as
// their root and every section inside becomes another card.
//
// This is the replacement: a titled region with a rule above it and nothing around it.
//
// ════════════════════ WHY THE PANEL VARIANT EXISTS, AND ITS LIMIT ════════════════════
//
// The Subpage Expansion report found whitespace-only sections failing inside editors and admitted
// the ruled panel as a THIRD structural element — "for editors, dialogs, and suggestion bands only,
// never for read-only layout" (Grammar R13). `panel` is that variant, and its scope is exactly that
// sentence. Using it for read-only content re-creates the card farm with better typography.
export default function RuledSection({
  title,
  meta = null,
  actions = null,
  panel = false,
  children,
  id = undefined,
}) {
  return (
    <section className={panel ? "ns-section ns-section--panel" : "ns-section"} id={id}>
      {title ? (
        <div className="ns-section__head">
          <h2 className="ns-section__title">{title}</h2>
          {meta ? <span className="ns-section__meta">{meta}</span> : null}
          {actions ? <div className="ns-section__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="ns-section__body">{children}</div>
    </section>
  );
}
