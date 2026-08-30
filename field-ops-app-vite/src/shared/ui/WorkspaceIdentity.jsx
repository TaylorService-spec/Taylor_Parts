// THE WORKSPACE HEADER (North Star). The list's counterpart to RecordIdentity.
//
// ════════════════════ WHY A SECOND IDENTITY PRIMITIVE ════════════════════
//
// The pilot report is explicit that these are two patterns, not one: the enterprise record header
// is for detail pages, and "Don't use on index/workspace pages (they get a workspace header)."
// The recovered `Subpages - Lists and States.dc.html` shows what the workspace header actually is,
// and it differs from the record header in three measured ways:
//
//   - the serif title is 34px, not 40px — step 2 of the three-step header scale;
//   - the title is followed by a COUNT and an operational summary line, not by record facts;
//   - the primary action ("New work order") sits beside the title rather than in an action cluster.
//
// The crumb and the thick–thin rule pair are IDENTICAL to the record page. That is deliberate and is
// the point of the correction this file belongs to: a person entering Work Orders and then opening
// one must not feel they crossed between two products.
//
// ════════════════════ THE SUMMARY LINE IS NOT DECORATION ════════════════════
//
// "4 past due · 11 unassigned · 38 this week" is what makes this a workspace rather than a table —
// it answers "what matters" before the rows answer "what exists" (NS-P2).
//
// It takes already-derived items and renders them. It computes nothing, because a count computed
// from a PAGE is a claim about a COLLECTION, and this list is bounded and cursor-paged. The status
// chips on this very screen had their counts removed for exactly that reason. A caller that cannot
// count truthfully passes nothing and the line does not render — the same rule the attention band
// follows.
// ════════════════════ `description` IS NOT THE SUMMARY LINE ════════════════════
//
// Added for the Equipment North Star (P1v2.1), whose 1a frame puts a sentence under the title
// saying what the workspace CONTAINS: "Every serialized unit the business owns or services —
// installed at customers, available in company stock, and the account-scoped register that creates
// them." That is a standing description of the set, not a reading of its current state, and the two
// must not share a slot: `summaryItems` says what needs attention TODAY and changes with the data,
// while this does not change at all.
//
// It earns its place on a workspace that hosts several populations under one title, where "which of
// these am I looking at" is a real question. Optional and rendered only when supplied, so the
// fifteen collection pages that shipped without one are untouched.
export default function WorkspaceIdentity({
  crumb,
  title,
  description = null,
  count = null,
  countLabel = null,
  summaryItems = [],
  action = null,
  children = null,
}) {
  const shown = summaryItems.filter((s) => s && s.label);

  return (
    <div className="ns-workspace">
      <div className="ns-page__crumb">
        <span>Enterprise Operations OS</span>
        {crumb ? <span className="ns-page__crumb-right">{crumb}</span> : null}
      </div>
      <div className="ns-rulepair" />

      <header className="ns-workspace__head">
        <div className="ns-workspace__titleblock">
          <div className="ns-workspace__titlerow">
            <h1 className="ns-workspace__title">{title}</h1>
            {count != null ? (
              <span className="ns-workspace__count">
                {count}
                {countLabel ? <span className="ns-workspace__count-label"> {countLabel}</span> : null}
              </span>
            ) : null}
          </div>
          {description ? <p className="ns-workspace__description">{description}</p> : null}
          {shown.length > 0 ? (
            <p className="ns-workspace__summary">
              {shown.map((s, i) => (
                <span key={s.key ?? s.label}>
                  {i > 0 ? <span aria-hidden="true"> · </span> : null}
                  <span className={s.tone === "attention" ? "is-attention" : undefined}>{s.label}</span>
                </span>
              ))}
            </p>
          ) : null}
        </div>
        {action ? <div className="ns-workspace__action">{action}</div> : null}
      </header>

      {children}
    </div>
  );
}
