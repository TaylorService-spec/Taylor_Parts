// Context Band (Wave-0 composition primitive) — a compact business-context strip that REPLACES repeated
// context cards. It is not another card: a horizontal run of label/value pairs (with inline relationships)
// plus an optional trailing action. Used where several surfaces need the same compact context (a Work
// Order's number/customer/site/window/tech/readiness; a PO's supplier/destination/status/linked-demand; an
// asset's identity/site/model/status). Hierarchy over containers.
export default function ContextBand({ items = [], action = null, className = "" }) {
  const shown = items.filter((it) => it && it.label != null);
  return (
    <div className={`fo-context-band ${className}`.trim()}>
      <dl className="fo-context-band__items">
        {shown.map((it, i) => (
          <div className="fo-context-band__item" key={it.key ?? `${it.label}-${i}`}>
            <dt>{it.label}</dt>
            <dd>{it.value ?? "—"}</dd>
          </div>
        ))}
      </dl>
      {action ? <div className="fo-context-band__action">{action}</div> : null}
    </div>
  );
}
